import type { FlatColumn, Grid, TableBlock } from './types';
import { cellAt, rowNonEmptyCount, textAt } from './grid';
import { isBlank, lightNormalize, normalizeText, stripParenthetical } from './text-utils';
import { looksNumeric, parseNumber } from './numbers';
import { extractUnit } from './units';
import { parsePeriod, type PeriodInfo } from './period';
import { exactLookup } from './mapper';

const CN_QUARTER: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, '1': 1, '2': 2, '3': 3, '4': 4 };

/** 仅含季度词（无年份）的表头，如 "二季度"、"第3季度"、"Q2"，用兜底年份补全 */
function parseQuarterOnly(text: string, fallbackYear?: number): PeriodInfo | null {
  if (!fallbackYear) return null;
  const t = normalizeText(text);
  let m = /第?([1-4一二三四])季度/.exec(t);
  if (!m) m = /q([1-4])/i.exec(t);
  if (!m) return null;
  const q = CN_QUARTER[m[1]];
  if (!q) return null;
  return { period: `${fallbackYear}Q${q}`, year: fallbackYear, quarter: q };
}

/**
 * 定位表头行区间。
 * 从第一个数值行向上收连续的"表头样式"行，遇到空行停止；
 * 遇到标题/县名/单位类"信息行"也停止（信息行特征：含冒号标签、或文本像标题）。
 */
export function locateHeaderRows(
  grid: Grid,
  firstBody: number,
  bottom: number,
  c0: number,
  c1: number,
): number[] {
  void bottom;
  const rows: number[] = [];
  let r = firstBody - 1;
  // 窗口放宽到 5 行：两层表头 + 可能的分组横幅/空行
  const lower = Math.max(0, firstBody - 5);
  let bannersSkipped = 0;
  let dataRowHit = false;
  while (r >= lower) {
    if (isRowBlankGrid(grid, r, c0, c1)) {
      r--;
      continue;
    }
    // 首列能映射为标准指标的行是数据行（即便数值缺失），表头到此为止
    const firstColText = textAt(grid, r, c0);
    if (firstColText && exactLookup(firstColText)) {
      dataRowHit = true;
      break;
    }
    // 分组横幅行（"一、xxx"）不是表头，跳过继续向上
    if (isBannerRow(grid, r, c0, c1)) {
      bannersSkipped++;
      if (bannersSkipped > 2) break;
      r--;
      continue;
    }
    // 信息行（县名/标题/单位）：已收集到表头时作为上边界；
    // 尚未找到表头时（信息行与表头之间隔着横幅）允许穿过，继续向上找
    if (isInfoRow(grid, r, c0, c1)) {
      if (rows.length > 0) break;
      r--;
      continue;
    }
    if (isHeaderLikeRow(grid, r, c0, c1)) {
      rows.unshift(r);
      r--;
    } else {
      break;
    }
  }
  if (rows.length === 0 && firstBody > 0) {
    if (dataRowHit) {
      // 首数据行就在 firstBody 附近：向上找最近的非空行作为表头（横幅/标题行不会被当数据）
      let hr = firstBody - 1;
      while (hr >= 0 && isRowBlankGrid(grid, hr, c0, c1)) hr--;
      if (hr >= 0 && !exactLookup(textAt(grid, hr, c0))) rows.push(hr);
      else rows.push(Math.max(0, firstBody - 1));
    } else {
      rows.push(firstBody - 1);
    }
  }
  return rows;
}

/** 信息行：标题/县名/单位/填报说明，特点是含标签词或为合并长标题 */
function isInfoRow(grid: Grid, r: number, c0: number, c1: number): boolean {
  const text = joinRow(grid, r, c0, c1);
  // 显式标签：填报单位：xx / 单位：万元 / 地区：xx
  if (/(填报单位|报送单位|编制单位|单位名称|上报单位|填表单位|地区|单位)[：:]/.test(text)) return true;
  const nonBlank = countNonBlank(grid, r, c0, c1);
  if (nonBlank !== 1) return false;
  // 唯一文本格是合并锚点且横跨 >=3 列：标题/县名横幅
  const anchor = grid.merges.find((m) => m.s.r === r);
  if (anchor && anchor.e.c - anchor.s.c + 1 >= 3) return true;
  // 单列长标题（>=8 字）
  if (text.length >= 8) return true;
  return false;
}

function joinRow(grid: Grid, r: number, c0: number, c1: number): string {
  const parts: string[] = [];
  for (let c = c0; c <= c1; c++) {
    const t = textAt(grid, r, c);
    if (t) parts.push(t);
  }
  return parts.join('');
}

function countNonBlank(grid: Grid, r: number, c0: number, c1: number): number {
  let n = 0;
  for (let c = c0; c <= c1; c++) {
    const cell = grid.cells[r]?.[c];
    if (cell && !isBlank(cell.value)) n++;
  }
  return n;
}

/** 分组横幅行：仅首列有文本，且形如 "一、xxx" / "（一）xxx"（用轻量规范化，保留顿号） */
function isBannerRow(grid: Grid, r: number, c0: number, c1: number): boolean {
  if (countNonBlank(grid, r, c0, c1) !== 1) return false;
  const t = lightNormalize(textAt(grid, r, c0));
  return /^[一二三四五六七八九十]+[、.．]/.test(t) || /^（[一二三四五六七八九十]+）/.test(t);
}

function isRowBlankGrid(grid: Grid, r: number, c0: number, c1: number): boolean {
  for (let c = c0; c <= c1; c++) {
    const cell = grid.cells[r]?.[c];
    if (cell && !isBlank(cell.value)) return false;
  }
  return true;
}

function isHeaderLikeRow(grid: Grid, r: number, c0: number, c1: number): boolean {
  let numeric = 0;
  let nonBlank = 0;
  const occupiedCols: number[] = [];
  for (let c = c0; c <= c1; c++) {
    const cell = cellAt(grid, r, c);
    if (!cell || isBlank(cell.value)) continue;
    nonBlank++;
    occupiedCols.push(c);
    if (typeof cell.value === 'number' || looksNumeric(cell.value)) numeric++;
  }
  if (nonBlank === 0) return false;
  if (numeric > 0) return false;
  // 标题/县名/单位行特征：只占 1~2 列（常为合并单元格），不是跨列表头
  const span = occupiedCols.length > 1 ? occupiedCols[occupiedCols.length - 1] - occupiedCols[0] + 1 : 1;
  if (nonBlank <= 2 && span <= 2) return false;
  return true;
}

/**
 * 展开多层表头：逐列收集各表头层级文本（合并填充已在网格阶段完成），
 * 合并格在相邻列重复时去重，层级用 "/" 拼接成 fullName。
 */
export function flattenHeader(block: TableBlock, headerRows: number[]): FlatColumn[] {
  const { grid, colStart, colEnd } = block;
  const out: FlatColumn[] = [];

  for (let c = colStart; c <= colEnd; c++) {
    const levels: string[] = [];
    for (const hr of headerRows) {
      const t = lightNormalize(textAt(grid, hr, c));
      if (!t) continue;
      // 与上一层完全相同（合并向下填充）则去重
      if (levels.length > 0 && levels[levels.length - 1] === t) continue;
      levels.push(t);
    }
    const leafName = levels.length ? levels[levels.length - 1] : '';
    const fullName = levels.join('/');
    out.push({
      index: c,
      levels,
      fullName,
      leafName,
      role: 'ignore',
    });
  }
  return out;
}

/** 标签列常见表头词 */
const LABEL_HEADER_WORDS = ['指标', '项目', '指标名称', '项目名称', '名称', '科目', '产品名称', '经济指标'];
/** 单位列表头词 */
const UNIT_HEADER_WORDS = ['计量单位', '单位'];
/** 代码列表头词 */
const CODE_HEADER_WORDS = ['代码', '编码', '指标代码'];

/**
 * 给列打角色标签：label / unit / period / data / ignore
 * @param fallbackYear 标题/角落提取的年份，用于"一季度"这类缺年份表头
 */
export function classifyColumns(
  block: TableBlock,
  columns: FlatColumn[],
  headerRows: number[],
  bodyStart: number,
  fallbackYear?: number,
  transposed = false,
): FlatColumn[] {
  const { grid, rowEnd, colStart, colEnd } = block;
  // 转置表首列固定为标签轴，不参与猜测
  const labelColGuess = transposed ? colStart : guessLabelColumn(block, headerRows, bodyStart);

  return columns.map((col) => {
    const head = normalizeText(col.fullName);

    // 转置表首列固定为时期轴标签列
    if (transposed && col.index === colStart) {
      return { ...col, role: 'label' };
    }

    // 1) 代码列
    if (CODE_HEADER_WORDS.some((w) => head === w || head.includes(w))) {
      return { ...col, role: 'ignore' };
    }
    // 2) 单位列：任一层表头为"计量单位/单位"即判定（两层表头全名可能是"计量单位/..."）
    const levelTexts = col.levels.map((l) => normalizeText(l));
    if (
      UNIT_HEADER_WORDS.some((w) => levelTexts.includes(normalizeText(w)) || head === normalizeText(w)) &&
      !head.includes('其中')
    ) {
      return { ...col, role: 'unit' };
    }
    // 3) 标签列（转置表首列已在前面处理）
    if (
      !transposed &&
      (col.index === labelColGuess ||
        LABEL_HEADER_WORDS.some((w) => head === w || head.includes(normalizeText(w))))
    ) {
      return { ...col, role: 'label' };
    }

    // 4) 时期列（表头带季度/月份）。剥掉单位括号再解析，兼容 "二季度(万元)"
    const periodInfo =
      parsePeriod(col.fullName, fallbackYear) ??
      parsePeriod(stripParenthetical(col.fullName), fallbackYear) ??
      parseQuarterOnly(col.fullName, fallbackYear);
    if (periodInfo) {
      // 表头里可能同时带单位，如 "2026年三季度（万元）"
      const unit = extractUnit(col.fullName);
      return { ...col, role: 'period', period: periodInfo.period, unit: unit ?? undefined };
    }

    // 5) 数据列：正文区该列出现过数字
    let numericHits = 0;
    for (let r = bodyStart; r <= rowEnd; r++) {
      if (parseNumber(textAt(grid, r, col.index)) !== null) {
        numericHits++;
        if (numericHits >= 1) break;
      }
    }
    if (numericHits > 0) {
      const unit = extractUnit(col.fullName);
      return { ...col, role: 'data', unit: unit ?? undefined };
    }

    // 6) 兜底：表头为空且整列无数字 -> ignore
    void colStart;
    void colEnd;
    return { ...col, role: 'ignore' };
  });
}

/**
 * 猜标签列：正文区文本占比最高、数字占比最低的列；
 * 同时优先表头含"指标/项目"的列。
 */
function guessLabelColumn(block: TableBlock, headerRows: number[], bodyStart: number): number {
  const { grid, colStart, colEnd, rowEnd } = block;
  let best = colStart;
  let bestScore = -Infinity;

  for (let c = colStart; c <= colEnd; c++) {
    const head = normalizeText(headerRows.map((hr) => textAt(grid, hr, c)).join(''));
    let textHits = 0;
    let numHits = 0;
    let blankHits = 0;
    for (let r = bodyStart; r <= rowEnd; r++) {
      const v = textAt(grid, r, c);
      if (isBlank(v)) blankHits++;
      else if (parseNumber(v) !== null) numHits++;
      else textHits++;
    }
    let score = textHits * 2 - numHits * 5 - blankHits * 0.1;
    if (LABEL_HEADER_WORDS.some((w) => head.includes(normalizeText(w)))) score += 10;
    // 最左列小幅加权（多数表标签列在最前）
    if (c === colStart) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** 块内第一行正文（跳过表头前的辅助行由 parser 决定；这里只做数据行探测） */
/**
 * 正文起点探测：第一个含数值的行；
 * 若首列出现时期词（转置表，且首行可能是缺失记号无数值），也作为正文起点。
 * 标题/信息行（含"表/单位：/填报单位"等）跳过，避免标题中的年份被误判。
 */
export function firstNumericRow(block: TableBlock, afterRow: number): number {
  const { grid, rowStart, rowEnd, colStart, colEnd } = block;
  for (let r = Math.max(rowStart, afterRow); r <= rowEnd; r++) {
    const firstText = textAt(grid, r, colStart);
    const joined = joinRowLite(grid, r, colStart, colEnd);
    // 标题/县名/单位信息行：只含文本标签，不含业务数值
    if (/(填报单位|报送单位|编制单位|单位名称|上报单位|填表单位|地区|单位)[：:]/.test(joined)) continue;
    // 首列像标题（含"表/统计/报表"且本身不是时期）或整行是合并的长标题
    if ((/表|统计|报表|季报|年报/.test(firstText) && !parsePeriod(firstText)) || isMergedTitleRow(grid, r, colStart, colEnd)) {
      continue;
    }
    for (let c = colStart; c <= colEnd; c++) {
      if (parseNumber(textAt(grid, r, c)) !== null) return r;
    }
    // 首列可映射为标准指标的行也是数据行起点（数值可能缺失）
    if (exactLookup(firstText)) return r;
    if (parsePeriod(firstText)) return r;
  }
  return rowEnd + 1;
}

/** 是否为合并的长标题行（单个文本格横跨 >=3 列） */
function isMergedTitleRow(grid: Grid, r: number, c0: number, c1: number): boolean {
  const distinct = new Set<string>();
  for (let c = c0; c <= c1; c++) {
    const v = grid.cells[r]?.[c]?.value;
    if (v !== null && v !== undefined && v !== '') distinct.add(String(v));
  }
  if (distinct.size !== 1) return false;
  const m = grid.merges.find((mm) => mm.s.r === r);
  return Boolean(m && m.e.c - m.s.c + 1 >= 3);
}

function joinRowLite(grid: Grid, r: number, c0: number, c1: number): string {
  const parts: string[] = [];
  for (let c = c0; c <= c1; c++) {
    const t = textAt(grid, r, c);
    if (t) parts.push(t);
  }
  return parts.join('');
}

/** 块内数字列数量（parser 判断转置/常规版式用） */
export function countNumericColumns(block: TableBlock, bodyStart: number): number {
  const { grid, colStart, colEnd, rowEnd } = block;
  let n = 0;
  for (let c = colStart; c <= colEnd; c++) {
    for (let r = bodyStart; r <= rowEnd; r++) {
      if (parseNumber(textAt(grid, r, c)) !== null) {
        n++;
        break;
      }
    }
  }
  return n;
}

/**
 * 转置表判断（数据驱动）：
 * 线索 A：首列表头为"时期/季度/时间"等；
 * 线索 B：正文首列出现 >=1 个可解析时期，且数值列 >=3；
 * 线索 C：正文首列出现 >=2 个时期；
 * 线索 D：正文首列多数行（>=2）是时期，即使数值缺失也算转置。
 */
export function looksTransposed(
  block: TableBlock,
  bodyStart: number,
  headerRows: number[],
  fallbackYear?: number,
): boolean {
  const { grid, rowEnd, colStart } = block;
  let periodRows = 0;
  let bodyRows = 0;
  for (let r = bodyStart; r <= rowEnd; r++) {
    const label = textAt(grid, r, colStart);
    if (!label) continue;
    bodyRows++;
    if (parsePeriod(label, fallbackYear)) periodRows++;
  }
  const numericCols = countNumericColumns(block, bodyStart);
  // 首列任一层表头命中时期轴词即可（两层表头全名可能是"时期/时期"）
  const headLevels = headerRows.map((hr) => normalizeText(textAt(grid, hr, colStart)));
  const headIsPeriod = headLevels.some(
    (t) => t.includes('时期') || t.includes('季度') || t === '时间' || t === '报告期',
  );

  if (headIsPeriod && (periodRows >= 1 || numericCols >= 2)) return true;
  if (periodRows >= 2 && numericCols >= 1) return true;
  // 正文行绝大多数是时期词（数值可能整列缺失）
  if (bodyRows >= 2 && periodRows / bodyRows >= 0.75) return true;
  return false;
}

// rowNonEmptyCount 供 parser 复用，re-export 避免循环引用感受
export { rowNonEmptyCount };
