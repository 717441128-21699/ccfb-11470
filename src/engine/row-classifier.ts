import type { ClassifiedRow, Grid } from './types';
import { textAt } from './grid';
import { isBlank, lightNormalize, normalizeText } from './text-utils';
import { GRAND_TOTAL_LABELS, GROUP_BY_CODE } from './standards';
import { parseNumber } from './numbers';
import { exactLookup } from './mapper';

export interface RowClassifyContext {
  grid: Grid;
  r0: number;
  r1: number;
  c0: number;
  c1: number;
  labelCol: number;
  /** 标签列的可选次列（"其中"缩进列），一般为 labelCol+1 */
  indentCol?: number;
}

const GRAND_SET = new Set(GRAND_TOTAL_LABELS.map(normalizeText));
const SUBTOTAL_SET = new Set<string>();
const SUBTOTAL_GROUP = new Map<string, string>();
for (const group of GROUP_BY_CODE.values()) {
  for (const label of group.subtotalLabels) {
    SUBTOTAL_SET.add(normalizeText(label));
    SUBTOTAL_GROUP.set(normalizeText(label), group.code);
  }
}

/** 标签是否为全表总计 */
export function isGrandTotalLabel(label: string): boolean {
  const t = normalizeText(label);
  if (GRAND_SET.has(t)) return true;
  return /^(全县|全市|全旗)?(总计|合计)$/.test(t);
}

/** 标签是否为某组小计；返回组编码 */
export function matchSubtotal(label: string): string | null {
  const t = normalizeText(label);
  const direct = SUBTOTAL_GROUP.get(t);
  if (direct) return direct;
  for (const g of GROUP_BY_CODE.values()) {
    if (g.subtotalLabels.some((l) => normalizeText(l) === t)) return g.code;
  }
  // 宽松：以"小计"结尾且文本中能找到组名
  if (/小计$/.test(t)) {
    for (const g of GROUP_BY_CODE.values()) {
      if (t.includes(normalizeText(g.name))) return g.code;
    }
  }
  return null;
}

/** 备注行：备注/注/说明/附注 开头，且整行没有数值 */
export function isNoteRow(ctx: RowClassifyContext, r: number): boolean {
  const label = rowLabel(ctx, r);
  if (!label) return false;
  const t = normalizeText(label);
  // 规范化后冒号已去除，匹配词干即可
  const stems = ['备注', '注', '说明', '附注'];
  const startsWithNote = stems.some((p) => t.startsWith(p));
  if (!startsWithNote) return false;
  for (let c = ctx.c0; c <= ctx.c1; c++) {
    if (parseNumber(textAt(ctx.grid, r, c)) !== null) return false;
  }
  return true;
}

/** 空行：块列范围内全空 */
export function isBlankRow(ctx: RowClassifyContext, r: number): boolean {
  for (let c = ctx.c0; c <= ctx.c1; c++) {
    if (!isBlank(textAt(ctx.grid, r, c))) return false;
  }
  return true;
}

/** 取行标签：优先标签列，其次缩进列 */
export function rowLabel(ctx: RowClassifyContext, r: number): string {
  const primary = lightNormalize(textAt(ctx.grid, r, ctx.labelCol));
  if (primary) return primary;
  if (ctx.indentCol !== undefined) {
    return lightNormalize(textAt(ctx.grid, r, ctx.indentCol));
  }
  // 兜底：行内第一个文本格
  for (let c = ctx.c0; c <= ctx.c1; c++) {
    const t = textAt(ctx.grid, r, c);
    if (t && parseNumber(t) === null) return lightNormalize(t);
  }
  return '';
}

/** 行内是否含至少一个数值 */
function hasNumber(ctx: RowClassifyContext, r: number): boolean {
  for (let c = ctx.c0; c <= ctx.c1; c++) {
    if (parseNumber(textAt(ctx.grid, r, c)) !== null) return true;
  }
  return false;
}

/**
 * 逐行分类。输出保持原始行序，blank/note 也返回（不进明细，但保留溯源与展示）。
 */
export function classifyRows(ctx: RowClassifyContext): ClassifiedRow[] {
  const out: ClassifiedRow[] = [];
  for (let r = ctx.r0; r <= ctx.r1; r++) {
    const label = rowLabel(ctx, r);

    if (isBlankRow(ctx, r)) {
      out.push({ r, kind: 'blank', label: '' });
      continue;
    }
    if (isNoteRow(ctx, r)) {
      out.push({ r, kind: 'note', label, note: rowFullText(ctx, r) });
      continue;
    }

    // 小计/总计标签优先识别（数值可能缺失，但行类型仍成立）
    if (isGrandTotalLabel(label)) {
      out.push({ r, kind: 'grandtotal', label });
      continue;
    }
    const subGroup = matchSubtotal(label);
    if (subGroup) {
      out.push({ r, kind: 'subtotal', label, groupCode: subGroup });
      continue;
    }

    // 有标签但无数值：先看标签能否映射为标准指标，能映射则是缺数的数据行，否则归 unknown（横幅/说明）
    if (!hasNumber(ctx, r)) {
      if (exactLookup(label)) {
        out.push({ r, kind: 'data', label });
      } else {
        out.push({ r, kind: 'unknown', label });
      }
      continue;
    }

    if (isGrandTotalLabel(label)) {
      out.push({ r, kind: 'grandtotal', label });
      continue;
    }
    const group = matchSubtotal(label);
    if (group) {
      out.push({ r, kind: 'subtotal', label, groupCode: group });
      continue;
    }
    out.push({ r, kind: 'data', label });
  }
  return out;
}

function rowFullText(ctx: RowClassifyContext, r: number): string {
  const parts: string[] = [];
  for (let c = ctx.c0; c <= ctx.c1; c++) {
    const t = textAt(ctx.grid, r, c);
    if (t) parts.push(t);
  }
  return parts.join(' ');
}

/** 仅保留明细行（data），小计/合计/空行/备注全部排除 */
export function detailRows(rows: ClassifiedRow[]): ClassifiedRow[] {
  return rows.filter((x) => x.kind === 'data');
}
