import type { Grid, TableBlock } from './types';
import { cellAt, contentBounds, isRowBlank, rowNonEmptyCount, rowText } from './grid';
import { isBlank } from './text-utils';
import { looksNumeric } from './numbers';

interface Band {
  c0: number;
  c1: number;
}

interface RowGroup {
  r0: number;
  r1: number;
}

/**
 * 一个 sheet 切成多张逻辑表：
 * - 横向：整列全空 -> 列栏（并排表）
 * - 纵向：连续 ≥2 空行，或 1 空行后接"标题行" -> 分块
 * 表内单空行保留，后续行分类阶段识别为 blank。
 */
export function splitTables(grid: Grid, sheetName: string): TableBlock[] {
  const bounds = contentBounds(grid);
  if (!bounds) return [];
  const { r0, c0, r1, c1 } = bounds;

  const bands = findColumnBands(grid, r0, r1, c0, c1);
  const blocks: TableBlock[] = [];
  let seq = 0;

  for (const band of bands) {
    const groups = findRowGroups(grid, band.c0, band.c1, r0, r1);
    for (const g of groups) {
      // 收窄列范围到本组真实内容
      let bc0 = band.c1;
      let bc1 = band.c0;
      for (let r = g.r0; r <= g.r1; r++) {
        for (let c = band.c0; c <= band.c1; c++) {
          const cell = cellAt(grid, r, c);
          if (cell && !isBlank(cell.value)) {
            bc0 = Math.min(bc0, c);
            bc1 = Math.max(bc1, c);
          }
        }
      }
      if (bc0 > bc1) continue;
      // 组内至少要有 2 个内容行且含数值，否则是表间残余碎片（如表头错位块）
      const contentRows = countContentRows(grid, g.r0, g.r1, bc0, bc1);
      const numericHits = countNumericHits(grid, g.r0, g.r1, bc0, bc1);
      if (contentRows < 2 || numericHits === 0) continue;
      seq += 1;
      const title = detectTitle(grid, g.r0, g.r1, bc0, bc1);
      blocks.push({
        id: `${sanitize(sheetName)}_b${seq}`,
        sheetName,
        rowStart: g.r0,
        rowEnd: g.r1,
        colStart: bc0,
        colEnd: bc1,
        grid,
        title,
        transposed: false,
      });
    }
  }
  return blocks;
}

function countContentRows(grid: Grid, top: number, bottom: number, c0: number, c1: number): number {
  let n = 0;
  for (let r = top; r <= bottom; r++) {
    if (!isRowBlank(grid, r, c0, c1)) n++;
  }
  return n;
}

function countNumericHits(grid: Grid, top: number, bottom: number, c0: number, c1: number): number {
  let n = 0;
  for (let r = top; r <= bottom; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = cellAt(grid, r, c);
      if (cell && !isBlank(cell.value)) {
        const v = cell.value;
        if (typeof v === 'number' || /^[-+]?[\d,，.]+$/.test(String(v).trim())) {
          n++;
          if (n >= 1) return n;
        }
      }
    }
  }
  return n;
}

/** 找列栏：内容区中全空列作为分隔 */
function findColumnBands(grid: Grid, top: number, bottom: number, left: number, right: number): Band[] {
  const blankCol: boolean[] = [];
  for (let c = left; c <= right; c++) {
    let blank = true;
    for (let r = top; r <= bottom; r++) {
      const cell = cellAt(grid, r, c);
      if (cell && !isBlank(cell.value)) {
        blank = false;
        break;
      }
    }
    blankCol[c] = blank;
  }
  const bands: Band[] = [];
  let c = left;
  while (c <= right) {
    if (blankCol[c]) {
      c++;
      continue;
    }
    const start = c;
    while (c <= right && !blankCol[c]) c++;
    bands.push({ c0: start, c1: c - 1 });
  }
  return bands;
}

/** 纵向分块 */
function findRowGroups(grid: Grid, c0: number, c1: number, top: number, bottom: number): RowGroup[] {
  const groups: RowGroup[] = [];
  let start = -1;
  let blankRun = 0;

  for (let r = top; r <= bottom; r++) {
    const blank = isRowBlank(grid, r, c0, c1);
    if (!blank) {
      if (start < 0) {
        start = r;
      } else if (blankRun > 0) {
        // 遇到空行后的新内容行：判断是否构成表间边界
        const boundary =
          blankRun >= 2 ||
          isTitleLikeRow(grid, r, c0, c1) ||
          // 单行间隔后紧跟新表标题序列（标题含"表/报表"或带括号单位）
          isNewTableTitle(grid, r, c0, c1);
        if (boundary) {
          groups.push({ r0: start, r1: r - blankRun - 1 });
          start = r;
        }
      }
      blankRun = 0;
    } else if (start >= 0) {
      blankRun++;
    }
  }
  if (start >= 0) groups.push({ r0: start, r1: bottom });
  // 去掉组尾空行
  return groups.map((g) => {
    let r1 = g.r1;
    while (r1 >= g.r0 && isRowBlank(grid, r1, c0, c1)) r1--;
    return { r0: g.r0, r1: Math.max(r1, g.r0) };
  });
}

/**
 * 标题行特征：栏内只有 1~2 个非空文本格、无数值，常带合并。
 * 典型如 "青山县2026年三季度主要经济指标表"
 */
/** 缺失记号（出现这些文本的格不视为有效文本内容） */
const MISSING_LITERALS = new Set(['-', '—', '－', '--', '…', '...', '／', '/']);

function isMissingLiteral(v: unknown): boolean {
  return typeof v === 'string' && MISSING_LITERALS.has(v.trim());
}

function isTitleLikeRow(grid: Grid, r: number, c0: number, c1: number): boolean {
  let nonBlank = 0;
  let numeric = 0;
  let mergedText = 0;
  const texts: string[] = [];
  for (let c = c0; c <= c1; c++) {
    const cell = cellAt(grid, r, c);
    if (!cell || isBlank(cell.value)) continue;
    if (isMissingLiteral(cell.value)) continue; // 缺失记号不算文本内容
    nonBlank++;
    if (typeof cell.value === 'string') texts.push(cell.value);
    if (looksNumeric(cell.value)) numeric++;
    if (cell.merged && typeof cell.value === 'string') mergedText++;
  }
  if (numeric > 0 || nonBlank === 0) return false;
  const joined = texts.join('');
  // 县名/填报单位/单位行不是标题
  if (/(填报单位|报送单位|编制单位|单位名称|上报单位|填表单位|地区|单位)[：:]/.test(joined)) return false;
  // 标题必须有标题特征：含"表/统计/报表"字样，或是合并单元格（普通指标名再长也不是标题）
  const hasTitleWord = /表|统计|报表|季报|年报/.test(joined);
  const isMerged = mergedText >= 1;
  if (!hasTitleWord && !isMerged) return false;
  if (nonBlank <= 2) return true;
  // 整行合并为一格的长标题
  return mergedText >= 1 && nonBlank <= 3;
}

/** 新表标题：含"表/报表/统计"字样，或带单位括号，且为合并/少列文本行 */
function isNewTableTitle(grid: Grid, r: number, c0: number, c1: number): boolean {
  let numeric = 0;
  const distinct = new Set<string>();
  for (let c = c0; c <= c1; c++) {
    const cell = cellAt(grid, r, c);
    if (!cell || isBlank(cell.value) || isMissingLiteral(cell.value)) continue;
    if (typeof cell.value === 'number' || looksNumeric(cell.value)) numeric++;
    else distinct.add(String(cell.value));
  }
  if (numeric > 0 || distinct.size === 0 || distinct.size > 2) return false;
  const text = [...distinct].join('');
  return /表|报表|统计/.test(text) || /单位[：:]/.test(text) || /[（(].*[）)]/.test(text);
}

/** 取块顶部标题（标题行通常独立一行；也可能没有） */
function detectTitle(grid: Grid, r0: number, r1: number, c0: number, c1: number): string {
  const maxScan = Math.min(r1, r0 + 2);
  for (let r = r0; r <= maxScan; r++) {
    if (isTitleLikeRow(grid, r, c0, c1)) {
      const t = rowText(grid, r, c0, c1).trim();
      if (t) return t;
    }
  }
  return '';
}

/** 块内首行是否标题行（供表头定位用） */
export function blockTitleRow(block: TableBlock): number | null {
  const { grid, rowStart, colStart, colEnd } = block;
  const maxScan = Math.min(block.rowEnd, rowStart + 2);
  for (let r = rowStart; r <= maxScan; r++) {
    if (isTitleLikeRow(grid, r, colStart, colEnd)) return r;
  }
  return null;
}

/** 块内"单位行"检测：单位：xxx 独立成行 */
export function findUnitRow(block: TableBlock): number | null {
  const { grid, rowStart, rowEnd, colStart, colEnd } = block;
  for (let r = rowStart; r <= Math.min(rowEnd, rowStart + 4); r++) {
    const t = rowText(grid, r, colStart, colEnd);
    if (/单位[：:]/.test(t) && rowNonEmptyCount(grid, r, colStart, colEnd) <= 2) return r;
  }
  return null;
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9一-龥_]/g, '_');
}
