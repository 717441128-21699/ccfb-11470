import { state } from './state';
import { loadWorkbook } from '../engine/grid';
import { parseWorkbook } from '../engine/parser';

/** 应用人工覆盖/模板后重新解析当前所有文件（内存中，基于原始 ArrayBuffer 缓存） */
const bufferCache = new Map<string, ArrayBuffer>();

export function cacheBuffer(name: string, buf: ArrayBuffer): void {
  bufferCache.set(name, buf);
}

export async function reparseAll(): Promise<void> {
  const overrides = state.overrides;
  for (const fileName of [...bufferCache.keys()]) {
    const buf = bufferCache.get(fileName)!;
    const sheets = loadWorkbook(buf);
    const r = parseWorkbook(sheets, fileName, { overrides, templateMapping: {} });
    const idx = state.files.findIndex((f) => f.fileName === fileName);
    if (idx >= 0) state.files[idx] = r;
  }
}

export async function reparseCurrent(): Promise<void> {
  await reparseAll();
}
