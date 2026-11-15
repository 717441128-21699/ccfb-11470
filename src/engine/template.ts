import type { LayoutTemplate } from './types';
import { normalizeText } from './text-utils';

const STORAGE_KEY = 'rsr.layoutTemplates.v1';

/**
 * 版式指纹：不依赖文件名/县名，只看结构——
 * 表头各列规范化文本 + 列数 + 表头行数 + 块内行数。
 * 同版式文件（哪怕县名、数值不同）指纹一致，可自动套用人工映射。
 */
export interface FingerprintInput {
  headerDepth: number;
  bodyRows: number;
  columns: { fullName: string }[];
}

export function fingerprint(input: FingerprintInput): string {
  const colSig = input.columns
    .map((c) => normalizeText(c.fullName) || '·')
    .join('|');
  const raw = `${input.headerDepth}#${input.bodyRows}#${input.columns.length}#${colSig}`;
  // FNV-1a 32bit，短且稳定
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fp_${h.toString(16).padStart(8, '0')}`;
}

/** 浏览器本地模板库（localStorage，文件不出本机） */
export class TemplateStore {
  private templates = new Map<string, LayoutTemplate>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw) as LayoutTemplate[];
      for (const t of arr) this.templates.set(t.fingerprint, t);
    } catch {
      this.templates.clear();
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.templates.values()]));
    } catch {
      // 存储满/隐私模式：静默降级为内存态
    }
  }

  get(fp: string): LayoutTemplate | null {
    return this.templates.get(fp) ?? null;
  }

  list(): LayoutTemplate[] {
    return [...this.templates.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  save(fp: string, columnMapping: Record<string, string>, note?: string): LayoutTemplate {
    const existing = this.templates.get(fp);
    const tpl: LayoutTemplate = {
      id: existing?.id ?? `tpl_${fp}`,
      fingerprint: fp,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      columnMapping: { ...(existing?.columnMapping ?? {}), ...columnMapping },
      note,
    };
    this.templates.set(fp, tpl);
    this.persist();
    return tpl;
  }

  delete(fp: string): void {
    this.templates.delete(fp);
    this.persist();
  }

  clear(): void {
    this.templates.clear();
    this.persist();
  }
}
