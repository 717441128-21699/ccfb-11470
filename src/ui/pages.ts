import { el, toast } from './dom';
import { setPage } from './router';
import { state, selectFile, selectBlock, currentFile, currentTable, allRecords, setOverride } from './state';
import { textAt } from '../engine/grid';
import { METRICS } from '../engine/standards';
import { summarize } from '../engine/summary';
import { fingerprint, type TemplateStore } from '../engine/template';
import { formatValue } from '../engine/numbers';
import type { ParsedTable, LongRecord } from '../engine/types';

const KIND_LABEL: Record<string, string> = {
  data: '明细', subtotal: '小计', grandtotal: '合计', note: '备注', blank: '空行', unknown: '其它', header: '表头',
};

function kindBadge(kind: string): HTMLElement {
  return el('span', { className: `badge ${kind}` }, KIND_LABEL[kind] ?? kind);
}

function emptyHint(msg: string): HTMLElement {
  const p = el('div', { className: 'panel' }, el('h2', {}, msg));
  const btn = el('button', { className: 'btn' }, '去导入') as HTMLButtonElement;
  btn.onclick = () => setPage('import');
  p.append(btn);
  return p;
}

function tableFingerprint(t: ParsedTable): string {
  return fingerprint({
    headerDepth: t.headerRows.length,
    bodyRows: t.rows.length,
    columns: t.columns.map((c) => ({ fullName: c.fullName })),
  });
}

// ---------------------------------------------------------------- ① 导入
export function pageImport(handleFiles: (f: FileList | File[]) => Promise<void>): HTMLElement {
  const panel = el('div', { className: 'panel' });
  panel.append(el('h2', {}, '导入 Excel 报表（支持 .xlsx，可多选）'));

  const zone = el('div', { className: 'drop-zone' });
  zone.innerHTML =
    '<div><strong>点击选择文件</strong> 或将文件拖拽到此处</div><div style="margin-top:8px">所有解析均在浏览器本地完成，文件不会上传</div>';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx';
  input.multiple = true;
  input.style.display = 'none';
  input.onchange = () => {
    if (input.files?.length) void handleFiles(input.files);
  };
  zone.onclick = () => input.click();
  zone.ondragover = (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  };
  zone.ondragleave = () => zone.classList.remove('dragover');
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) void handleFiles(e.dataTransfer.files);
  };
  panel.append(zone, input);

  if (state.files.length === 0) return panel;

  const list = el('div', { className: 'panel' });
  list.append(el('h2', {}, `已导入 ${state.files.length} 个文件`));
  const fl = el('div', { className: 'file-list' });
  for (const f of state.files) {
    const item = el(
      'div',
      { className: 'file-item' + (f.fileName === state.selectedFile ? ' selected' : '') },
      el('span', {}, f.fileName),
      el('span', { className: 'muted' }, `${f.tables.length} 表 · ${f.records.length} 记录`),
    );
    item.onclick = () => {
      selectFile(f.fileName);
      setPage('inspect');
    };
    fl.append(item);
  }
  list.append(fl);
  return el('div', {}, panel, list);
}

// ---------------------------------------------------------------- ② 结构识别
export function pageInspect(): HTMLElement {
  if (state.files.length === 0) return emptyHint('请先在「导入」页选择文件');
  const wrap = el('div', {});
  const f = currentFile()!;

  const sel = el('div', { className: 'select-wrap' });
  const fileSel = document.createElement('select');
  for (const x of state.files) fileSel.append(new Option(x.fileName, x.fileName));
  fileSel.value = f.fileName;
  fileSel.onchange = () => {
    selectFile(fileSel.value);
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    renderInspect(wrap);
  };
  const blockSel = document.createElement('select');
  for (const t of f.tables) blockSel.append(new Option(`${t.block.id}（${t.layout}）`, t.block.id));
  blockSel.value = state.selectedBlock ?? f.tables[0]?.block.id;
  blockSel.onchange = () => {
    selectBlock(blockSel.value);
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    renderInspect(wrap);
  };
  sel.append(el('span', {}, '文件:'), fileSel, el('span', {}, '表块:'), blockSel);
  wrap.append(el('div', { className: 'panel' }, sel));
  renderInspect(wrap);
  return wrap;
}

function renderInspect(wrap: HTMLElement): void {
  while (wrap.children.length > 1) wrap.lastChild?.remove();
  const t = currentTable()!;
  wrap.append(renderMetaPanel(t), renderGridPanel(t));
}

function renderMetaPanel(t: ParsedTable): HTMLElement {
  const p = el('div', { className: 'panel' });
  p.append(el('h2', {}, '识别元信息'));
  const kv = el('dl', { className: 'kv' });
  const rows: [string, string][] = [
    ['版式', t.layout + (t.block.transposed ? '（转置表）' : '')],
    ['县名', t.county ?? '—'],
    ['时期', t.period ?? '—'],
    ['表级单位', t.tableUnit ?? '（混合单位，逐行标注）'],
    ['表头行', t.headerRows.join(', ')],
    ['标签列', `第 ${t.labelColumn} 列`],
    ['单位列', t.unitColumn !== undefined ? `第 ${t.unitColumn} 列` : '无'],
    ['指纹', t.fingerprint],
  ];
  for (const [k, v] of rows) kv.append(el('dt', {}, k), el('dd', { className: 'mono' }, v));
  p.append(kv);
  if (t.warnings.length) {
    p.append(el('h3', {}, '告警'));
    p.append(el('div', { className: 'warn-text' }, t.warnings.join('；') || '无'));
  }
  return p;
}

function renderGridPanel(t: ParsedTable): HTMLElement {
  const p = el('div', { className: 'panel' });
  p.append(el('h2', {}, `还原网格（${t.rows.length} 行 × ${t.columns.length} 列）`));
  const table = document.createElement('table');
  table.className = 'grid';
  const thead = document.createElement('thead');
  const headTr = document.createElement('tr');
  headTr.append(el('th', {}, '行号'), el('th', {}, '类型'), el('th', {}, '标签/时期'));
  for (const c of t.columns) {
    const th = el('th', {}, c.fullName || '(空)');
    th.title = `角色: ${c.role}${c.period ? ' / ' + c.period : ''}${c.unit ? ' / 单位:' + c.unit : ''}`;
    headTr.append(th);
  }
  thead.append(headTr);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const row of t.rows) {
    const tr = document.createElement('tr');
    tr.className = row.kind;
    tr.append(el('td', {}, String(row.r + 1)), kindBadge(row.kind), el('td', {}, row.label));
    for (const c of t.columns) {
      const raw = textAt(t.block.grid, row.r, c.index);
      tr.append(el('td', { className: 'num' }, raw === '' ? '—' : raw));
    }
    tbody.append(tr);
  }
  table.append(tbody);
  p.append(table);
  return p;
}

// ---------------------------------------------------------------- ③ 表头映射
export function pageMapping(store: TemplateStore): HTMLElement {
  if (state.files.length === 0) return emptyHint('请先导入文件');
  const wrap = el('div', {});
  const t = currentTable()!;
  const panel = el('div', { className: 'panel' });
  panel.append(el('h2', {}, `指标映射（${t.block.id}）`));
  panel.append(el('p', { className: 'muted' }, '把无法自动匹配的列/行标签手工对应到标准指标，保存后同版式文件自动套用。'));

  const targets: { label: string; code?: string }[] = [];
  if (t.layout === 'transposed') {
    for (const c of t.columns.filter((c) => c.role === 'data' || c.role === 'ignore')) {
      targets.push({ label: c.fullName, code: c.metricCode ?? undefined });
    }
  } else {
    for (const r of t.rows.filter((r) => r.kind === 'data')) {
      targets.push({ label: r.label, code: r.metricCode ?? undefined });
    }
  }

  const unmapped = targets.filter((x) => !x.code);
  if (unmapped.length === 0) panel.append(el('p', { className: 'ok-text' }, '✓ 全部标签已自动映射到标准指标'));

  for (const target of targets) {
    const row = el('div', { className: 'mapping-row' });
    row.append(el('label', {}, target.label));
    const sel = document.createElement('select');
    sel.append(new Option('（未映射）', ''));
    for (const m of METRICS) sel.append(new Option(`${m.code} ${m.name}`, m.code));
    sel.value = target.code ?? '';
    sel.onchange = () => {
      if (sel.value) {
        setOverride(t.block.id, target.label, sel.value);
        toast('已保存人工映射');
      }
    };
    row.append(sel);
    row.append(
      target.code
        ? el('span', { className: 'metric-pill' }, target.code)
        : el('span', { className: 'metric-pill unmapped' }, '未映射'),
    );
    panel.append(row);
  }

  const fp = tableFingerprint(t);
  const tplPanel = el('div', { className: 'panel' });
  tplPanel.append(el('h2', {}, '版式模板'));
  tplPanel.append(el('div', { className: 'mono' }, `指纹：${fp}`));
  const saved = store.get(fp);
  tplPanel.append(
    el('p', { className: saved ? 'ok-text' : 'muted' }, saved ? `已保存 ${Object.keys(saved).length} 条映射，同版式自动套用` : '尚未保存模板'),
  );
  const saveBtn = el('button', { className: 'btn' }, '保存当前映射为模板') as HTMLButtonElement;
  saveBtn.onclick = () => {
    const mapping: Record<string, string> = {};
    for (const r of t.rows) if (r.metricCode) mapping[r.label] = r.metricCode;
    for (const c of t.columns) if (c.metricCode) mapping[c.fullName] = c.metricCode;
    Object.assign(mapping, state.overrides[t.block.id] ?? {});
    store.save(fp, mapping);
    toast('模板已保存到本地，下次同版式自动套用');
  };
  tplPanel.append(saveBtn);

  wrap.append(panel, tplPanel);
  return wrap;
}

// ---------------------------------------------------------------- ④ 结果预览
export function pagePreview(): HTMLElement {
  if (state.files.length === 0) return emptyHint('请先导入文件');
  const records = allRecords();
  const panel = el('div', { className: 'panel' });
  panel.append(el('h2', {}, `标准化长表（县 / 指标 / 时期 / 数值）共 ${records.length} 条`));

  const exportBtn = el('button', { className: 'btn ghost' }, '导出 CSV') as HTMLButtonElement;
  exportBtn.onclick = () => exportCsv(records);
  panel.append(exportBtn);

  const table = document.createElement('table');
  table.className = 'grid';
  table.append(
    el('thead', {}, el('tr', {}, ...['县', '指标编码', '指标名称', '时期', '数值', '单位', '类型', '来源文件', '单元格'].map((h) => el('th', {}, h)))),
  );
  const tbody = document.createElement('tbody');
  for (const r of records.slice(0, 500)) {
    const tr = document.createElement('tr');
    tr.className = r.rowKind;
    tr.append(
      el('td', {}, r.county),
      el('td', { className: 'mono' }, r.metricCode),
      el('td', {}, r.metricName),
      el('td', {}, r.period),
      el('td', { className: 'num' }, r.value === null ? '—' : formatValue(r.value)),
      el('td', {}, r.unit ?? ''),
      kindBadge(r.rowKind),
      el('td', {}, r.sourceFile),
      el('td', { className: 'mono' }, `${r.sheetName}!${r.row + 1},${r.col + 1}`),
    );
    tbody.append(tr);
  }
  table.append(tbody);
  panel.append(table);
  if (records.length > 500) panel.append(el('p', { className: 'muted' }, `仅展示前 500 条，共 ${records.length} 条`));
  return panel;
}

function exportCsv(records: LongRecord[]): void {
  const header = ['县', '指标编码', '指标名称', '时期', '数值', '单位', '类型', '来源文件', 'sheet', '行', '列'];
  const lines = [header.join(',')];
  for (const r of records) {
    lines.push(
      [r.county, r.metricCode, r.metricName, r.period, r.value ?? '', r.unit ?? '', r.rowKind, r.sourceFile, r.sheetName, r.row + 1, r.col + 1].join(','),
    );
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '标准化长表.csv';
  a.click();
  toast('CSV 已导出');
}

// ---------------------------------------------------------------- ⑤ 汇总对账
export function pageSummary(): HTMLElement {
  if (state.files.length === 0) return emptyHint('请先导入文件');
  const wrap = el('div', {});
  const records = allRecords();
  const summary = summarize(records);

  const cards = el('div', { className: 'stat-cards' });
  const totalData = records.filter((r) => r.rowKind === 'data').length;
  const totalSub = records.filter((r) => r.rowKind === 'subtotal').length;
  const mismatchCount = summary.rows.filter((r) => r.mismatch).length;
  const countyCount = new Set(records.map((r) => r.county)).size;
  for (const [num, label] of [
    [String(countyCount), '涉及县数'],
    [String(totalData), '明细记录'],
    [String(totalSub), '自报小计'],
    [String(mismatchCount), '对账高亮'],
  ]) {
    cards.append(el('div', { className: 'stat-card' }, el('div', { className: 'num' }, num), el('div', { className: 'label' }, label)));
  }
  wrap.append(el('div', { className: 'panel' }, cards));

  const panel = el('div', { className: 'panel' });
  panel.append(el('h2', {}, '各县明细加总 vs 自报合计（差异高亮）'));
  const table = document.createElement('table');
  table.className = 'grid';
  table.append(
    el('thead', {}, el('tr', {}, ...['指标', '时期', '明细加总', '自报合计', '差额', '状态', '县数'].map((h) => el('th', {}, h)))),
  );
  const tbody = document.createElement('tbody');
  for (const r of summary.rows) {
    const tr = document.createElement('tr');
    if (r.mismatch) tr.className = 'subtotal';
    tr.append(
      el('td', {}, `${r.metricCode} ${r.metricName}`),
      el('td', {}, r.period),
      el('td', { className: 'num' }, formatValue(r.summedValue)),
      el('td', { className: 'num' }, r.selfReportedValue === null ? '—' : formatValue(r.selfReportedValue)),
      el('td', { className: 'num' }, r.diff === null ? '—' : formatValue(r.diff)),
      el('td', {}, r.selfReportedValue === null ? '—' : r.mismatch ? el('span', { className: 'badge mismatch' }, '不一致') : el('span', { className: 'badge ok' }, '一致')),
      el('td', { className: 'num' }, String(r.contributingCounties)),
    );
    tbody.append(tr);
  }
  table.append(tbody);
  panel.append(table);
  wrap.append(panel);
  return wrap;
}
