/**
 * 时期解析：把 "2026年三季度"、"1-3月"、"Q3" 等写法统一成 2026Q3
 */

export interface PeriodInfo {
  /** 标准时期，如 2026Q3 */
  period: string;
  year: number;
  quarter: number;
}

const QUARTER_WORDS: Record<string, number> = {
  '1': 1, '一': 1, '壹': 1,
  '2': 2, '二': 2, '贰': 2,
  '3': 3, '三': 3, '叁': 3,
  '4': 4, '四': 4, '肆': 4,
};

/** 仅匹配季度词，不带年份（用于表头 "一季度"，年份需外部补） */
const QUARTER_ONLY_RE = /^(?:第?\s*([1-4一二三四壹贰叁肆])\s*季度|Q\s*([1-4]))$/i;

/** 完整时期：2026年第三季度 / 2026Q3 / 2026年1-3月 等 */
const FULL_PERIOD_RE =
  /(20\d{2})\s*年?\s*(?:第?\s*([1-4一二三四壹贰叁肆])\s*季度|Q\s*([1-4])|(\d{1,2})\s*[-~～至]\s*(\d{1,2})\s*月)/i;

/** 只有年份 */
const YEAR_ONLY_RE = /(20\d{2})\s*年/;

function quarterFromMatch(g2?: string, g3?: string, g4?: string): number | null {
  const token = g2 ?? g3 ?? g4;
  if (!token) return null;
  return QUARTER_WORDS[token] ?? null;
}

/** 从月份区间推断季度 */
function quarterFromMonth(m: number): number {
  return Math.min(4, Math.floor((m - 1) / 3) + 1);
}

/**
 * 解析完整时期字符串；年份缺失时可用 fallbackYear 补全
 */
export function parsePeriod(text: string, fallbackYear?: number): PeriodInfo | null {
  if (!text) return null;
  const t = text.replace(/[\s　]+/g, '');

  const full = FULL_PERIOD_RE.exec(t);
  if (full) {
    const year = Number(full[1]);
    let q = quarterFromMatch(full[2], full[3]);
    if (q === null && full[4] !== undefined) {
      // 月份区间按起始月归季度（1-3月=Q1，4-6月=Q2 …）
      q = quarterFromMonth(Number(full[4]));
    }
    if (q === null) return null;
    return { period: `${year}Q${q}`, year, quarter: q };
  }

  const qo = QUARTER_ONLY_RE.exec(t);
  if (qo) {
    const q = quarterFromMatch(qo[1], qo[2]);
    if (q !== null && fallbackYear) {
      return { period: `${fallbackYear}Q${q}`, year: fallbackYear, quarter: q };
    }
  }

  const yo = YEAR_ONLY_RE.exec(t);
  if (yo && /季|q/i.test(t) === false) {
    // 纯年份不构成季度时期
    return null;
  }
  return null;
}

/** 宽松判断：文本中是否含有时期（标题/角落用） */
export function findPeriodInText(text: string): PeriodInfo | null {
  if (!text) return null;
  const t = text.replace(/[\s　]+/g, '');
  const m = FULL_PERIOD_RE.exec(t);
  if (!m) return null;
  const year = Number(m[1]);
  let q = quarterFromMatch(m[2], m[3]);
  if (q === null && m[4] !== undefined) q = quarterFromMonth(Number(m[4]));
  if (q === null) return null;
  return { period: `${year}Q${q}`, year, quarter: q };
}

/** 从文本中提取年份（兜底用）；要求年份后紧跟"年"字，避免把 205046 这类数值误判 */
export function findYear(text: string): number | null {
  const m = /(20\d{2})\s*年/.exec(text);
  return m ? Number(m[1]) : null;
}
