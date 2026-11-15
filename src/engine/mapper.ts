import type { MetricDef } from './types';
import { METRICS } from './standards';
import { extractParenthetical, matchScore, normalizeText, stripParenthetical } from './text-utils';
import { extractUnit } from './units';

export interface MatchCandidate {
  metric: MetricDef;
  score: number;
}

export interface MatchResult {
  metric: MetricDef | null;
  score: number;
  /** 模糊命中（阈值以下时 metric 为 null，但保留候选供 UI 展示） */
  fuzzy: boolean;
  candidates: MatchCandidate[];
}

/** 自动接受阈值：>= 该分数直接落映射 */
export const AUTO_ACCEPT_THRESHOLD = 0.8;
/** 候选展示阈值 */
const CANDIDATE_THRESHOLD = 0.55;

interface IndexEntry {
  key: string;
  metric: MetricDef;
}

const exactIndex: IndexEntry[] = [];
const initialized = { done: false };

function ensureIndex(): void {
  if (initialized.done) return;
  for (const m of METRICS) {
    exactIndex.push({ key: normalizeText(m.name), metric: m });
    for (const alias of m.aliases) {
      exactIndex.push({ key: normalizeText(alias), metric: m });
    }
  }
  initialized.done = true;
}

/** 剥离"其中："/"其中"前缀，返回核心标签 */
function stripSubitemPrefix(text: string): string {
  return text.replace(/^\s*其中\s*[：:]?\s*/, '').trim();
}

/** 精确（规范化后）别名/标准名查找；自动剥离括号中的单位/注释与"其中："前缀 */
export function exactLookup(text: string): MetricDef | null {
  ensureIndex();
  const key = normalizeText(text);
  if (!key) return null;
  const hit = exactIndex.find((e) => e.key === key);
  if (hit) return hit.metric;
  // 剥离"其中："前缀再试（如 "其中：渔业总产值" -> "渔业总产值"）
  const strippedPrefix = normalizeText(stripSubitemPrefix(text));
  if (strippedPrefix && strippedPrefix !== key) {
    const hit2 = exactIndex.find((e) => e.key === strippedPrefix);
    if (hit2) return hit2.metric;
  }
  // 剥离括号内容再试（如 "农业产值（万元）" -> "农业产值"）
  const stripped = normalizeText(stripParenthetical(text));
  if (stripped && stripped !== key) {
    const hit3 = exactIndex.find((e) => e.key === stripped);
    if (hit3) return hit3.metric;
  }
  return null;
}

/** 文本括号里是否带单位（带单位的括号不参与模糊匹配文本） */
function hasUnitInParen(text: string): boolean {
  return extractParenthetical(text).some((p) => extractUnit(p) !== null);
}

/**
 * 映射一个文本到标准指标。
 * 先精确，再对全部标准名+别名算模糊分，取最高。
 */
export function matchMetric(text: string): MatchResult {
  ensureIndex();
  const exact = exactLookup(text);
  if (exact) {
    return { metric: exact, score: 1, fuzzy: false, candidates: [{ metric: exact, score: 1 }] };
  }
  // 模糊匹配前剥掉单位括号与"其中："前缀，避免干扰相似度
  let probe = hasUnitInParen(text) ? stripParenthetical(text) : text;
  probe = stripSubitemPrefix(probe);
  const scored: MatchCandidate[] = [];
  const seen = new Set<string>();
  for (const m of METRICS) {
    const names = [m.name, ...m.aliases];
    let best = 0;
    for (const name of names) best = Math.max(best, matchScore(probe, name));
    if (best >= CANDIDATE_THRESHOLD && !seen.has(m.code)) {
      seen.add(m.code);
      scored.push({ metric: m, score: Number(best.toFixed(4)) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0] ?? null;
  if (top && top.score >= AUTO_ACCEPT_THRESHOLD) {
    return { metric: top.metric, score: top.score, fuzzy: true, candidates: scored.slice(0, 5) };
  }
  return { metric: null, score: top?.score ?? 0, fuzzy: true, candidates: scored.slice(0, 5) };
}

/** 带人工覆盖的映射：override 优先，其次自动匹配 */
export function resolveMetric(
  text: string,
  override?: Record<string, string>,
): { code: string | null; auto: boolean } {
  if (override && Object.prototype.hasOwnProperty.call(override, text)) {
    return { code: override[text], auto: false };
  }
  const r = matchMetric(text);
  return { code: r.metric?.code ?? null, auto: r.metric !== null };
}
