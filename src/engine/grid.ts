import * as XLSX from 'xlsx';
import type { Cell, Grid, MergeRange } from './types';
import { isBlank } from './text-utils';

/** SheetJS 读出的原始工作表 */
export interface RawSheet {
  name: string;
  aoa: unknown[][];
  merges: MergeRange[];
}

/** 在浏览器/Node 中读取 ArrayBuffer，得到所有 sheet 的原始数据（全程本地，无网络） */
export function loadWorkbook(buffer: ArrayBuffer): RawSheet[] {
  const wb = XLSX.read(buffer, { type: 'array', cellStyles: true, cellDates: false });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    const merges: MergeRange[] = (ws['!merges'] ?? []).map((m) => ({
      s: { r: m.s.r, c: m.s.c },
      e: { r: m.e.r, c: m.e.c },
    }));
    return { name, aoa, merges };
  });
}

/**
 * 构建还原网格：
 * 1. 按 !ref/实际行列补齐稀疏格；
 * 2. 合并区域锚点值向下/向右填充，从属格记录锚点坐标。
 */
export function buildGrid(raw: RawSheet): Grid {
  const aoa = raw.aoa;
  let rows = aoa.length;
  let cols = 0;
  for (const row of aoa) cols = Math.max(cols, Array.isArray(row) ? row.length : 0);
  for (const m of raw.merges) {
    rows = Math.max(rows, m.e.r + 1);
    cols = Math.max(cols, m.e.c + 1);
  }
  rows = Math.max(rows, 1);
  cols = Math.max(cols, 1);

  const cells: Cell[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: Cell[] = [];
    for (let c = 0; c < cols; c++) {
      const rawVal = aoa[r] && c < aoa[r].length ? aoa[r][c] : null;
      line.push({ r, c, raw: normalizeScalar(rawVal), value: normalizeScalar(rawVal) });
    }
    cells.push(line);
  }

  // 合并填充
  for (const m of raw.merges) {
    const anchor = cells[m.s.r]?.[m.s.c];
    const anchorVal = anchor ? anchor.raw : null;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const cell = cells[r][c];
        if (r === m.s.r && c === m.s.c) {
          cell.merged = true;
          cell.value = anchorVal;
        } else {
          cell.mergeAnchor = { r: m.s.r, c: m.s.c };
          cell.merged = true;
          cell.value = anchorVal;
        }
      }
    }
  }

  return { rows, cols, cells, merges: raw.merges };
}

function normalizeScalar(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  const s = String(v);
  return s;
}

export function cellAt(grid: Grid, r: number, c: number): Cell | null {
  return grid.cells[r]?.[c] ?? null;
}

export function textAt(grid: Grid, r: number, c: number): string {
  const cell = cellAt(grid, r, c);
  if (!cell || cell.value === null || cell.value === undefined) return '';
  return String(cell.value);
}

/** 一行中非空格的数量（可限定列范围） */
export function rowNonEmptyCount(grid: Grid, r: number, c0 = 0, c1 = grid.cols - 1): number {
  let n = 0;
  for (let c = c0; c <= c1; c++) {
    const cell = cellAt(grid, r, c);
    if (cell && !isBlank(cell.value)) n++;
  }
  return n;
}

/** 一列中非空格的数量 */
export function colNonEmptyCount(grid: Grid, c: number, r0 = 0, r1 = grid.rows - 1): number {
  let n = 0;
  for (let r = r0; r <= r1; r++) {
    const cell = cellAt(grid, r, c);
    if (cell && !isBlank(cell.value)) n++;
  }
  return n;
}

/** 非空内容的包围盒；全空返回 null */
export function contentBounds(grid: Grid): { r0: number; c0: number; r1: number; c1: number } | null {
  let r0 = -1;
  let c0 = grid.cols;
  let r1 = -1;
  let c1 = -1;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = cellAt(grid, r, c);
      if (cell && !isBlank(cell.value)) {
        if (r0 < 0) r0 = r;
        r1 = r;
        c0 = Math.min(c0, c);
        c1 = Math.max(c1, c);
      }
    }
  }
  if (r0 < 0) return null;
  return { r0, c0, r1, c1 };
}

/** 判断某行在给定列范围内是否全空 */
export function isRowBlank(grid: Grid, r: number, c0: number, c1: number): boolean {
  return rowNonEmptyCount(grid, r, c0, c1) === 0;
}

/** 拼接一行的文本（调试/标题识别用） */
export function rowText(grid: Grid, r: number, c0 = 0, c1 = grid.cols - 1): string {
  const parts: string[] = [];
  for (let c = c0; c <= c1; c++) {
    const t = textAt(grid, r, c);
    if (t) parts.push(t);
  }
  return parts.join(' ');
}
