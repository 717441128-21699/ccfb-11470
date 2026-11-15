import type { MergeRange } from '../src/engine/types';

/**
 * 底层 sheet 构建器：稀疏坐标写入 + 合并区域管理，
 * 生成器各版式在这之上拼装。
 */
export class SheetBuilder {
  private data = new Map<string, string | number | null>();
  readonly merges: MergeRange[] = [];
  maxRow = -1;
  maxCol = -1;

  constructor(readonly name: string) {}

  private key(r: number, c: number): string {
    return `${r},${c}`;
  }

  set(r: number, c: number, v: string | number | null): this {
    if (v !== null && v !== undefined && v !== '') {
      this.data.set(this.key(r, c), v);
      this.maxRow = Math.max(this.maxRow, r);
      this.maxCol = Math.max(this.maxCol, c);
    }
    return this;
  }

  get(r: number, c: number): string | number | null {
    return this.data.get(this.key(r, c)) ?? null;
  }

  /** 合并区域：锚点写值，其余格留空，由引擎的合并填充还原 */
  merge(r0: number, c0: number, r1: number, c1: number, v: string | number | null): this {
    this.set(r0, c0, v);
    this.merges.push({ s: { r: r0, c: c0 }, e: { r: r1, c: c1 } });
    this.maxRow = Math.max(this.maxRow, r1);
    this.maxCol = Math.max(this.maxCol, c1);
    return this;
  }

  /** 输出 SheetJS 需要的 AOA（含空洞）与 merges */
  toAoa(): { aoa: (string | number | null)[][]; merges: MergeRange[] } {
    const rows = this.maxRow + 1;
    const cols = this.maxCol + 1;
    const aoa: (string | number | null)[][] = [];
    for (let r = 0; r < rows; r++) {
      const line: (string | number | null)[] = new Array(cols).fill(null);
      for (let c = 0; c < cols; c++) {
        const v = this.data.get(this.key(r, c));
        if (v !== undefined) line[c] = v;
      }
      aoa.push(line);
    }
    return { aoa, merges: [...this.merges] };
  }
}

export interface BuiltSheet {
  name: string;
  aoa: (string | number | null)[][];
  merges: MergeRange[];
}
