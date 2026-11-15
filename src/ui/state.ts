/**
 * 前端全局状态：当前已解析文件、选中表/行、人工映射、模板。
 * 纯浏览器内存，不上传任何文件。
 */
import type { FileResult, ParsedTable, LongRecord } from '../engine/types';

export interface AppState {
  files: FileResult[];
  selectedFile: string | null;
  selectedBlock: string | null;
  /** 人工覆盖：blockId -> 列/行全名 -> 指标编码 */
  overrides: Record<string, Record<string, string>>;
  /** 模板库：fingerprint -> 列映射 */
  templates: Record<string, Record<string, string>>;
}

export const state: AppState = {
  files: [],
  selectedFile: null,
  selectedBlock: null,
  overrides: {},
  templates: {},
};

export function addFiles(results: FileResult[]): void {
  const existing = new Set(state.files.map((f) => f.fileName));
  for (const r of results) if (!existing.has(r.fileName)) state.files.push(r);
  if (!state.selectedFile && state.files.length > 0) {
    state.selectedFile = state.files[0].fileName;
    state.selectedBlock = state.files[0].tables[0]?.block.id ?? null;
  }
}

export function selectFile(fileName: string): void {
  state.selectedFile = fileName;
  const f = state.files.find((x) => x.fileName === fileName);
  state.selectedBlock = f?.tables[0]?.block.id ?? null;
}

export function selectBlock(blockId: string): void {
  state.selectedBlock = blockId;
}

export function currentFile(): FileResult | undefined {
  return state.files.find((f) => f.fileName === state.selectedFile);
}

export function currentTable(): ParsedTable | undefined {
  return currentFile()?.tables.find((t) => t.block.id === state.selectedBlock);
}

export function allRecords(): LongRecord[] {
  return state.files.flatMap((f) => f.records);
}

export function setOverride(blockId: string, label: string, code: string): void {
  if (!state.overrides[blockId]) state.overrides[blockId] = {};
  state.overrides[blockId][label] = code;
}

export function clearOverride(blockId: string, label: string): void {
  if (state.overrides[blockId]) delete state.overrides[blockId][label];
}
