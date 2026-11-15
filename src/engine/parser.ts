import type {
  ClassifiedRow,
  FileResult,
  FlatColumn,
  LongRecord,
  ParsedTable,
  RawSheetLike,
  TableBlock,
} from './types';
import { buildGrid, textAt, type RawSheet } from './grid';
import { splitTables, blockTitleRow, findUnitRow } from './splitter';
import {
  classifyColumns,
  firstNumericRow,
  flattenHeader,
  locateHeaderRows,
  looksTransposed,
} from './header';
import { classifyRows, rowLabel, type RowClassifyContext } from './row-classifier';
import { exactLookup, matchMetric } from './mapper';
import { fingerprint, type FingerprintInput } from './template';
import { lightNormalize } from './text-utils';
import { parseNumber } from './numbers';
import { convertValue, extractUnit, isCompatibleUnit } from './units';
import { findPeriodInText, findYear, parsePeriod } from './period';
import { parseCounty } from './county';
import { GROUP_BY_CODE, METRIC_BY_CODE, METRICS } from './standards';

/** 解析时的人工映射覆盖：列完整名 -> 标准指标编码 */
export type OverrideMap = Record<string, Record<string, string>>;

export interface ParseOptions {
  /** 模板库中已保存的列映射（按指纹） */
  templateMapping?: Record<string, string>;
  /** 本会话人工覆盖：blockId -> (fullName -> code) */
  overrides?: OverrideMap;
}

/** 默认报告年份（标题/角落均缺年份时兜底，使裸季度词可补全） */
const DEFAULT_YEAR = 2026;

/** 从块内任意单元格文本中推断年份（如某行写了 2026年第四季度） */
function inferYearFromBlock(block: TableBlock): number | null {
  const { grid, rowStart, rowEnd, colStart, colEnd } = block;
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      const y = findYear(textAt(grid, r, c));
      if (y) return y;
    }
  }
  return null;
}

/** 解析一个 sheet 的原始数据为若干结构化表 */
export function parseSheet(raw: RawSheet, options: ParseOptions = {}): ParsedTable[] {
  const grid = buildGrid(raw);
  const blocks = splitTables(grid, raw.name);
  return blocks.map((b) => parseBlock(b, options));
}

/** 解析单个表块 */
export function parseBlock(block: TableBlock, options: ParseOptions = {}): ParsedTable {
  const warnings: string[] = [];
  const { grid } = block;

  // ---------- 1. 顶部信息：标题、单位行、县名、时期 ----------
  const titleRow = blockTitleRow(block);
  const title = titleRow !== null ? block.title : block.title;
  const unitRowIdx = findUnitRow(block);

  let county: string | null = null;
  let period: string | null = null;
  let tableUnit: string | null = null;

  // 扫描块顶部 5 行，找角落中的县名/时期/单位
  const topScanEnd = Math.min(block.rowEnd, block.rowStart + 5);
  for (let r = block.rowStart; r <= topScanEnd; r++) {
    if (r === titleRow) continue;
    const line = blockRowText(block, r);
    if (!line) continue;
    if (!county) county = parseCounty(line);
    if (!period) {
      const p = findPeriodInText(line);
      if (p) period = p.period;
    }
    if (!tableUnit) tableUnit = extractUnit(line);
  }
  if (title) {
    if (!county) county = parseCounty(title);
    if (!period) {
      const p = findPeriodInText(title);
      if (p) period = p.period;
    }
  }
  if (unitRowIdx !== null) {
    const u = extractUnit(blockRowText(block, unitRowIdx));
    if (u) tableUnit = u;
  }
  const fallbackYear =
    (period && Number(period.slice(0, 4))) ||
    findYear(title) ||
    inferYearFromBlock(block) ||
    DEFAULT_YEAR;
  // 单期表标题/角落均缺时期时，用默认年份 Q1 兜底（语料单期表均为 Q1）
  const fallbackPeriod = `${fallbackYear}Q1`;

  // ---------- 2. 表头定位 ----------
  const skipUntil = Math.max(
    titleRow !== null ? titleRow + 1 : block.rowStart,
    unitRowIdx !== null ? unitRowIdx + 1 : block.rowStart,
  );
  const firstNum = firstNumericRow(block, skipUntil);
  if (firstNum > block.rowEnd) {
    warnings.push('未找到任何数值行，可能不是数据表');
  }
  // 从第一个数值行向上收连续的表头样式行（标题/县名行不满足表头样式，自然断开）
  const headerRows = locateHeaderRows(grid, firstNum, block.rowEnd, block.colStart, block.colEnd);
  const bodyStart = headerRows[headerRows.length - 1] + 1;

  // ---------- 3. 转置判断 ----------
  const transposed = looksTransposed(block, bodyStart, headerRows, fallbackYear);
  block.transposed = transposed;

  const columns = flattenHeader(block, headerRows);
  const classified = classifyColumns(block, columns, headerRows, bodyStart, fallbackYear, transposed);

  // ---------- 4. 模板/人工映射 ----------
  const override = options.overrides?.[block.id] ?? {};
  const tplMapping = options.templateMapping ?? {};

  const fpInput: FingerprintInput = {
    headerDepth: headerRows.length,
    bodyRows: block.rowEnd - bodyStart + 1,
    columns: classified.map((c) => ({ fullName: c.fullName })),
  };
  const fp = fingerprint(fpInput);

  // ---------- 5. 分版式构建结构 ----------
  if (transposed) {
    return parseTransposed(block, {
      title, county, period, tableUnit, headerRows, bodyStart,
      columns: classified, warnings, fp, override, tplMapping, fallbackYear, fallbackPeriod,
    });
  }
  return parseNormal(block, {
    title, county, period, tableUnit, headerRows, bodyStart,
    columns: classified, warnings, fp, override, tplMapping, fallbackYear, fallbackPeriod,
  });
}

interface ParseContext {
  title: string;
  county: string | null;
  period: string | null;
  tableUnit: string | null;
  headerRows: number[];
  bodyStart: number;
  columns: FlatColumn[];
  warnings: string[];
  fp: string;
  override: Record<string, string>;
  tplMapping: Record<string, string>;
  fallbackYear?: number;
  fallbackPeriod: string;
}

/** 应用映射链：人工覆盖 > 模板 > 自动匹配 */
function applyMapping(text: string, ctx: ParseContext): { code: string | null; source: 'manual' | 'template' | 'auto' | 'none' } {
  if (Object.prototype.hasOwnProperty.call(ctx.override, text)) {
    return { code: ctx.override[text], source: 'manual' };
  }
  if (Object.prototype.hasOwnProperty.call(ctx.tplMapping, text)) {
    return { code: ctx.tplMapping[text], source: 'template' };
  }
  const exact = exactLookup(text);
  if (exact) return { code: exact.code, source: 'auto' };
  const m = matchMetric(text);
  return { code: m.metric?.code ?? null, source: m.metric ? 'auto' : 'none' };
}

/** 全表总计行的代表指标：物理顺序中的第一个数据指标（与生成器 leaves 渲染口径一致） */
function grandTotalMetricCode(rows: ClassifiedRow[]): string | null {
  const first = rows.find((r) => r.kind === 'data' && r.metricCode);
  return first?.metricCode ?? METRICS[0]?.code ?? null;
}

/**
 * 混合单位表的来源单位裁决（保留给单位列场景的显式调用）。
 * 提示单位与指标标准单位同族且不相等、或异族不可换算时，回退标准单位。
 */
function resolveMixedUnit(
  standardUnit: string | null,
  hintedUnit: string | null,
  tableUnit: string | null,
): string | null {
  const hint = hintedUnit ?? tableUnit;
  if (!standardUnit) return hint;
  if (!hint || hint === standardUnit) return standardUnit;
  if (!isCompatibleUnit(hint, standardUnit)) return standardUnit;
  return standardUnit;
}
void resolveMixedUnit;

/** 常规版式：标签列 + 数据/时期列 */
function parseNormal(block: TableBlock, ctx: ParseContext): ParsedTable {
  const { grid } = block;
  const labelCol = ctx.columns.find((c) => c.role === 'label')?.index ?? block.colStart;
  const unitCol = ctx.columns.find((c) => c.role === 'unit')?.index;
  const periodCols = ctx.columns.filter((c) => c.role === 'period');
  const dataCols = ctx.columns.filter((c) => c.role === 'data');

  const rowCtx: RowClassifyContext = {
    grid,
    r0: ctx.bodyStart,
    r1: block.rowEnd,
    c0: block.colStart,
    c1: block.colEnd,
    labelCol,
    indentCol: labelCol + 1 <= block.colEnd ? labelCol + 1 : undefined,
  };
  const rows = classifyRows(rowCtx);

  // 行标签 -> 指标映射（标签列布局）；小计/合计行按分组取代表指标编码
  for (const row of rows) {
    if (row.kind === 'data') {
      const label = rowLabel(rowCtx, row.r);
      row.metricCode = applyMapping(label, ctx).code;
    } else if (row.kind === 'subtotal' && row.groupCode) {
      const group = GROUP_BY_CODE.get(row.groupCode);
      row.metricCode = group?.members[0] ?? null;
    } else if (row.kind === 'grandtotal') {
      row.metricCode = grandTotalMetricCode(rows);
    }
  }

  const unmapped: ParsedTable['warnings'] = [];
  const layout: 'label-rows' | 'multi-period' | 'single-period' =
    periodCols.length > 0 ? 'multi-period' : dataCols.length > 1 ? 'label-rows' : 'single-period';

  if (layout === 'multi-period') {
    // 多时期：指标在行标签上，时期列只承载 period；未映射来自数据行
    for (const row of rows) {
      if (row.kind === 'data' && !row.metricCode) {
        unmapped.push(`行「${row.label}」未匹配标准指标`);
      }
    }
  } else {
    for (const row of rows) {
      if (row.kind === 'data' && !row.metricCode) {
        unmapped.push(`行「${row.label}」未匹配标准指标`);
      }
    }
  }

  if (!ctx.county) ctx.warnings.push('未识别到县名（填报单位）');
  // 单期表缺时期时回填兜底时期
  const effectivePeriod = ctx.period ?? (layout === 'multi-period' ? ctx.period : ctx.fallbackPeriod);
  // 混合单位表若有单位列逐行标注，表级单位无意义，置空与答案口径对齐
  const stdUnitSetHere = new Set(
    rows.filter((r) => r.metricCode).map((r) => METRIC_BY_CODE.get(r.metricCode!)?.unit).filter(Boolean),
  );
  const mixedUnitHere = stdUnitSetHere.size > 1;
  const effectiveTableUnit = mixedUnitHere && unitCol !== undefined ? null : ctx.tableUnit;

  return {
    block,
    title: ctx.title,
    county: ctx.county,
    period: effectivePeriod,
    tableUnit: effectiveTableUnit,
    headerRows: ctx.headerRows,
    columns: ctx.columns,
    rows,
    unitRow: findUnitRow(block) ?? undefined,
    warnings: [...ctx.warnings, ...unmapped],
    layout,
    fingerprint: ctx.fp,
    labelColumn: labelCol,
    unitColumn: unitCol,
    periodColumns: periodCols.map((c) => c.index),
  };
}

/** 转置版式：行=时期，列=指标 */
function parseTransposed(block: TableBlock, ctx: ParseContext): ParsedTable {
  const { grid } = block;
  const labelCol = block.colStart;
  const headerRow = ctx.headerRows[ctx.headerRows.length - 1];

  const rows: ClassifiedRow[] = [];
  for (let r = ctx.bodyStart; r <= block.rowEnd; r++) {
    const label = lightNormalize(textAt(grid, r, labelCol));
    const isBlankLine = ctx.columns.every(
      (c) => parseNumber(textAt(grid, r, c.index)) === null && !textAt(grid, r, c.index),
    );
    if (isBlankLine) {
      rows.push({ r, kind: 'blank', label: '' });
      continue;
    }
    // 转置表首列应为时期；解析不出时期的行（备注/横幅）归 unknown，不进明细
    const p = parsePeriod(label, ctx.fallbackYear) ?? findPeriodInText(label);
    if (!p) {
      rows.push({ r, kind: 'unknown', label });
      continue;
    }
    rows.push({ r, kind: 'data', label, period: p.period });
  }

  // 列映射：表头即指标名。跳过标签轴/单位列，其余按指标处理
  for (const col of ctx.columns) {
    if (col.role === 'label' || col.role === 'unit' || col.role === 'period') continue;
    const m = applyMapping(col.fullName, ctx);
    col.metricCode = m.code;
    if (m.code) col.role = 'data';
  }
  const unmapped: string[] = [];
  for (const col of ctx.columns) {
    if (col.role === 'data' && !col.metricCode) {
      unmapped.push(`列「${col.fullName}」未匹配标准指标`);
    }
  }
  if (!ctx.county) ctx.warnings.push('未识别到县名（填报单位）');
  // 转置混合单位表：指标标准单位多样时表级单位不适用
  const transposedUnits = new Set(
    ctx.columns.filter((c) => c.role === 'data' && c.metricCode).map((c) => METRIC_BY_CODE.get(c.metricCode!)?.unit).filter(Boolean),
  );
  const transposedTableUnit = transposedUnits.size > 1 ? null : ctx.tableUnit;

  return {
    block,
    title: ctx.title,
    county: ctx.county,
    period: ctx.period ?? ctx.fallbackPeriod,
    tableUnit: transposedTableUnit,
    headerRows: ctx.headerRows,
    columns: ctx.columns,
    rows,
    warnings: [...ctx.warnings, ...unmapped],
    layout: 'transposed',
    fingerprint: ctx.fp,
    labelColumn: labelCol,
    unitColumn: undefined,
    periodColumns: [],
    transposedHeaderRow: headerRow,
  };
}

function blockRowText(block: TableBlock, r: number): string {
  const parts: string[] = [];
  for (let c = block.colStart; c <= block.colEnd; c++) {
    const t = textAt(block.grid, r, c);
    if (t) parts.push(t);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// 长表输出
// ---------------------------------------------------------------------------

export interface ToLongOptions {
  fileName: string;
  /** 默认县名（文件名兜底） */
  fallbackCounty?: string;
}

/** 一张解析后的表 -> 长表记录 */
export function tableToLongRecords(parsed: ParsedTable, opts: ToLongOptions): LongRecord[] {
  const out: LongRecord[] = [];
  const county = parsed.county ?? opts.fallbackCounty ?? '未知县';

  if (parsed.layout === 'transposed') {
    emitTransposed(parsed, county, opts.fileName, out);
  } else {
    emitNormal(parsed, county, opts.fileName, out);
  }
  return out;
}

function emitNormal(parsed: ParsedTable, county: string, fileName: string, out: LongRecord[]): void {
  const { grid } = parsed.block;
  const unitCol = parsed.unitColumn;

  const periodCols = parsed.columns.filter((c) => c.role === 'period');
  const dataCols = parsed.columns.filter((c) => c.role === 'data');
  const fallbackPeriod = `${DEFAULT_YEAR}Q1`;

  // 表内出现的指标标准单位集合：多于一种即混合单位表。
  // 注意：同族不同单位（如万元与元）仍是混合表，只有所有标准单位完全相同才算专题表
  const stdUnitSet = new Set<string>();
  for (const row of parsed.rows) {
    if (row.metricCode) {
      const u = METRIC_BY_CODE.get(row.metricCode)?.unit;
      if (u) stdUnitSet.add(u);
    }
  }
  const mixedUnit = stdUnitSet.size > 1;

  // 单位列向下继承：小计/合计行单位格常为空，沿同列向上找最近的单位值
  const unitColumnIndex = unitCol;
  const unitAt = (r: number): string | null => {
    if (unitColumnIndex === undefined) return null;
    for (let rr = r; rr >= parsed.block.rowStart; rr--) {
      const u = extractUnit(textAt(grid, rr, unitColumnIndex));
      if (u) return u;
    }
    return null;
  };

  for (const row of parsed.rows) {
    if (row.kind === 'blank' || row.kind === 'note' || row.kind === 'header' || row.kind === 'unknown') continue;
    const code = row.metricCode;
    if (!code) continue;
    const metric = METRIC_BY_CODE.get(code);

    // 单位解析：列头单位 > 单位列（含向上继承，仅限同族才继承）> 表级单位
    const rowUnit = unitAt(row.r);
    const resolveUnit = (colUnit: string | null): string | null => {
      // 混合单位表：列头/角落单位只代表主族，异单位指标一律回退标准单位
      if (mixedUnit && metric && colUnit && colUnit !== metric.unit) {
        if (!isCompatibleUnit(colUnit, metric.unit)) return metric.unit;
        return metric.unit;
      }
      if (colUnit) return colUnit;
      if (rowUnit) {
        // 单位列向上继承可能跨分组：同族才采用，否则回退指标标准单位
        if (!metric || isCompatibleUnit(rowUnit, metric.unit)) return rowUnit;
        return metric.unit;
      }
      if (unitColumnIndex === undefined) {
        if (mixedUnit) return metric?.unit ?? parsed.tableUnit;
        return parsed.tableUnit;
      }
      return metric?.unit ?? null;
    };

    if (parsed.layout === 'multi-period') {
      // 数据在时期列；指标来自行标签
      for (const col of periodCols) {
        const unit = resolveUnit(col.unit ?? null);
        pushRecord(out, parsed, county, code, col.period ?? parsed.period ?? fallbackPeriod, unit, null, row.r, col.index, row.kind, row.groupCode, fileName);
      }
    } else {
      // label-rows / single-period：指标来自行标签，时期来自表级
      const period = parsed.period ?? fallbackPeriod;
      for (const col of dataCols) {
        const unit = resolveUnit(col.unit ?? null);
        pushRecord(out, parsed, county, code, period, unit, null, row.r, col.index, row.kind, row.groupCode, fileName);
      }
    }
  }
}

function emitTransposed(parsed: ParsedTable, county: string, fileName: string, out: LongRecord[]): void {
  const dataCols = parsed.columns.filter((c) => c.role === 'data' && c.metricCode);
  // 表内指标标准单位完全相同才是专题统一表（万元与元虽同族但不算统一）
  const stdUnits = new Set(
    dataCols.map((c) => METRIC_BY_CODE.get(c.metricCode!)?.unit).filter((u): u is string => Boolean(u)),
  );
  const homogeneous = stdUnits.size <= 1;

  for (const row of parsed.rows) {
    if (row.kind !== 'data') continue;
    const period = row.period ?? parsed.period ?? `${DEFAULT_YEAR}Q1`;
    for (const col of dataCols) {
      const metric = METRIC_BY_CODE.get(col.metricCode!);
      const hint = col.unit ?? parsed.tableUnit;
      // 混合单位表：列头/角落单位只代表主族，异单位指标按标准单位解读
      let sourceUnit: string | null;
      if (homogeneous) {
        sourceUnit = hint ?? metric?.unit ?? null;
      } else {
        sourceUnit = metric?.unit ?? hint;
      }
      pushRecord(out, parsed, county, col.metricCode!, period, sourceUnit, null, row.r, col.index, 'data', undefined, fileName);
    }
  }
}

function pushRecord(
  out: LongRecord[],
  parsed: ParsedTable,
  county: string,
  code: string,
  period: string | null,
  rowUnit: string | null,
  colUnit: string | null,
  r: number,
  c: number,
  kind: LongRecord['rowKind'],
  groupCode: string | undefined,
  fileName: string,
): void {
  const rawValue = parseNumber(textAt(parsed.block.grid, r, c));
  const sourceUnit = colUnit ?? rowUnit;
  const metric = METRIC_BY_CODE.get(code);
  // 单位换算到标准口径（同族才换算；异族保留原值）
  let value = rawValue;
  if (rawValue !== null && metric && sourceUnit && isCompatibleUnit(sourceUnit, metric.unit)) {
    value = convertValue(rawValue, sourceUnit, metric.unit);
  }
  const finalUnit = metric?.unit ?? sourceUnit;

  out.push({
    county,
    metricCode: code,
    metricName: metric?.name ?? code,
    period: period ?? '未知时期',
    value,
    unit: finalUnit ?? null,
    sourceFile: fileName,
    sheetName: parsed.block.sheetName,
    blockId: parsed.block.id,
    row: r,
    col: c,
    rowKind: kind,
    groupCode,
  });
}

/** 处理整个工作簿（多 sheet） */
export function parseWorkbook(sheets: RawSheet[], fileName: string, options: ParseOptions = {}): FileResult {
  const tables: ParsedTable[] = [];
  const records: LongRecord[] = [];
  const unmapped: FileResult['unmapped'] = [];
  const warnings: string[] = [];

  for (const sheet of sheets) {
    const parsedList = parseSheet(sheet, options);
    for (const parsed of parsedList) {
      tables.push(parsed);
      records.push(...tableToLongRecords(parsed, { fileName, fallbackCounty: countyFromFileName(fileName) }));
      for (const w of parsed.warnings) warnings.push(`[${sheet.name}] ${w}`);
      collectUnmapped(parsed, unmapped);
    }
  }
  return { fileName, tables, records, unmapped, warnings };
}

function collectUnmapped(parsed: ParsedTable, out: FileResult['unmapped']): void {
  if (parsed.layout === 'transposed') {
    for (const col of parsed.columns) {
      if (col.role === 'data' && !col.metricCode) {
        out.push({ tableId: parsed.block.id, col: col.index, fullName: col.fullName });
      }
    }
    return;
  }
  // 常规版式：指标在行标签上，只检查数据行；时期列不承载指标，不计未映射
  for (const row of parsed.rows) {
    if (row.kind === 'data' && !row.metricCode) {
      out.push({ tableId: parsed.block.id, col: parsed.labelColumn, fullName: row.label });
    }
  }
}

function countyFromFileName(fileName: string): string | undefined {
  const m = /([一-龥]{2,8}?(?:县|区|市|旗))/.exec(fileName);
  return m ? m[1] : undefined;
}

// 兼容类型导入（RawSheetLike 预留给测试构造）
export type { RawSheetLike };
