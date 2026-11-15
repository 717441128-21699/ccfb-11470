import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
// @ts-expect-error jsdom 未自带类型声明
import { JSDOM } from 'jsdom';
import { loadWorkbook } from '../src/engine/grid';
import { parseWorkbook } from '../src/engine/parser';
import { summarize } from '../src/engine/summary';

// 验证浏览器构建产物可在 DOM 环境挂载并运行完整流程
describe('浏览器环境集成（jsdom）', () => {
  it('在 DOM 中可完成 导入→解析→长表→对账 全流程', async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
      url: 'http://localhost/',
      pretendToBeVisual: true,
    });
    (globalThis as Record<string, unknown>).document = dom.window.document;
    (globalThis as Record<string, unknown>).window = dom.window;
    (globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
    (globalThis as Record<string, unknown>).HTMLButtonElement = dom.window.HTMLButtonElement;
    (globalThis as Record<string, unknown>).HTMLInputElement = dom.window.HTMLInputElement;
    (globalThis as Record<string, unknown>).HTMLSelectElement = dom.window.HTMLSelectElement;
    (globalThis as Record<string, unknown>).Option = dom.window.Option;
    (globalThis as Record<string, unknown>).Blob = dom.window.Blob;
    (globalThis as Record<string, unknown>).URL = dom.window.URL;

    const buf = fs.readFileSync('corpus/001_青山县_经济报表.xlsx');
    const sheets = loadWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const result = parseWorkbook(sheets, '001.xlsx');

    expect(result.tables.length).toBeGreaterThan(0);
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.every((r) => r.county === '青山县')).toBe(true);

    const summary = summarize(result.records);
    // 汇总应能正常产出（001 可能只有明细无小计，rows 至少覆盖出现过的指标）
    expect(Array.isArray(summary.rows)).toBe(true);
    expect(summary.rows.every((r) => typeof r.summedValue === 'number')).toBe(true);

    // 动态挂载一个真实 UI 组件片段，验证 DOM API 可用
    const { el } = await import('../src/ui/dom');
    const panel = el('div', { className: 'panel' }, el('h2', {}, '测试'));
    dom.window.document.getElementById('app')!.append(panel);
    expect(dom.window.document.querySelector('.panel h2')?.textContent).toBe('测试');
  });
});
