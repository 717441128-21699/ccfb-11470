/**
 * 数值解析：报表里数字可能是真数字，也可能是 "1,234.5"、"－"、"..." 这类文本
 */

/** 缺失值的常见写法 */
const MISSING_TOKENS = new Set(['', '-', '—', '－', '--', '…', '...', '／', '/', 'na', 'n/a', '无', '空格']);

/** 判断单元格是否"数值样子"：真正的数字，或只含数字/千分位/小数点/正负号/货币符号的文本 */
export function looksNumeric(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  const s = v.trim();
  if (!s) return false;
  const half = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  if (MISSING_TOKENS.has(half.toLowerCase())) return false;
  // 含字母/汉字的一律不是纯数值（保护 2026Q1、万元 等）
  if (/[a-zA-Z一-鿿]/.test(half)) return false;
  return /^[-+]?[￥$€]?[\d,，]+(\.\d+)?([eE][-+]?\d+)?$/.test(half.replace(/[\s]/g, ''));
}

/** 解析单元格数值；无法解析或属于缺失记号时返回 null */
export function parseNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = v.trim();
  if (!s) return null;
  // 全角转半角
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  if (MISSING_TOKENS.has(s.toLowerCase())) return null;
  // 含字母/汉字的不是数值
  if (/[a-zA-Z一-鿿]/.test(s)) return null;
  // 去掉千分位逗号、空白、货币符号
  const cleaned = s.replace(/[,，\s]/g, '').replace(/[￥$€]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  if (!/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 浮点容差比较（汇总对账用） */
export function nearlyEqual(a: number, b: number, absTol = 0.01): boolean {
  return Math.abs(a - b) <= absTol;
}

/** 格式化展示（保留原始小数位最多 4 位，去掉多余 0） */
export function formatValue(v: number | null): string {
  if (v === null) return '';
  return String(Number(v.toFixed(4)));
}
