import './styles.css';
import { el } from './dom';
import { getPage, setPage, onPageChange, type PageId } from './router';
import { state, addFiles } from './state';
import { loadWorkbook } from '../engine/grid';
import { parseWorkbook } from '../engine/parser';
import { TemplateStore } from '../engine/template';
import { cacheBuffer } from './reparse';
import { pageImport, pageInspect, pageMapping, pagePreview, pageSummary } from './pages';
import type { FileResult } from '../engine/types';

const PAGES: { id: PageId; label: string }[] = [
  { id: 'import', label: '① 导入' },
  { id: 'inspect', label: '② 结构识别' },
  { id: 'mapping', label: '③ 表头映射' },
  { id: 'preview', label: '④ 结果预览' },
  { id: 'summary', label: '⑤ 汇总对账' },
];

export const templateStore = new TemplateStore();

async function handleFiles(fileList: FileList | File[]): Promise<void> {
  const files = Array.from(fileList);
  const results: FileResult[] = [];
  for (const file of files) {
    const buf = await file.arrayBuffer();
    cacheBuffer(file.name, buf);
    const sheets = loadWorkbook(buf);
    const r = parseWorkbook(sheets, file.name, { overrides: state.overrides, templateMapping: {} });
    results.push(r);
  }
  addFiles(results);
  setPage('inspect');
}

function render(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = '';
  app.append(renderHeader(), renderNav(), renderMain());
}

function renderHeader(): HTMLElement {
  return el(
    'header',
    { className: 'app-header' },
    el('h1', {}, '县级统计报表结构还原工具'),
    el('span', { className: 'privacy' }, '🔒 纯本地解析 · 文件不出本机'),
  );
}

function renderNav(): HTMLElement {
  const nav = el('nav', { className: 'tabs' });
  for (const p of PAGES) {
    const btn = el('button', { className: p.id === getPage() ? 'active' : '' }, p.label) as HTMLButtonElement;
    btn.onclick = () => setPage(p.id);
    nav.append(btn);
  }
  return nav;
}

function renderMain(): HTMLElement {
  const main = el('main', {});
  switch (getPage()) {
    case 'import': main.append(pageImport(handleFiles)); break;
    case 'inspect': main.append(pageInspect()); break;
    case 'mapping': main.append(pageMapping(templateStore)); break;
    case 'preview': main.append(pagePreview()); break;
    case 'summary': main.append(pageSummary()); break;
  }
  return main;
}

onPageChange(render);
render();
