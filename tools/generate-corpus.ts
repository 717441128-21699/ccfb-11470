/**
 * 语料生成主程序：200 份版式各异的县级报表 + 标准答案。
 * 运行：npm run gen
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { Rng, hashSeed } from './rng';
import { SheetBuilder, type BuiltSheet } from './sheet-builder';
import { LayoutRenderer, MISSING_TOKENS, formatNumber } from './layout-renderer';
import type { BuildContext, DataCell, NumberStyle, RenderOutput, SubtotalCell, TableModel } from './model';
import type { AnswerBlock, AnswerFile, AnswerRecord, CorpusManifest } from './answer-types';
import { COUNTY_NAMES } from '../src/engine/county';
import { METRICS, METRIC_GROUPS } from '../src/engine/standards';
import { conversionFactor } from '../src/engine/units';
import type { MergeRange } from '../src/engine/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_DIR = path.join(ROOT, 'corpus');
const FILE_COUNT = 200;
const ALL_PERIODS = ['2026Q1', '2026Q2', '2026Q3', '2026Q4'];

/** 与某单位同族的可替换怪单位（标准写法权重仍最高，但保证每个怪单位有充足样本） */
const UNIT_VARIANTS: Record<string, string[]> = {
  万元: ['万元', '万元', '亿元', '亿元', '千元'],
  元: ['元', '千元'],
  吨标准煤: ['吨标准煤', '吨标准煤', '万吨标准煤'],
};

const NUMBER_STYLES: NumberStyle[] = ['plain', 'plain', 'thousands', 'text', 'decimal2'];

/** 强制轮转的怪单位序列，配合 fileIdx 取模保证覆盖率 */
const FORCED_UNITS = ['亿元', '千元', '万吨标准煤', '万元', '千元', '吨标准煤'];
const NOTE_POOL = [
  '备注：本表数据为初步统计数，正式数据以年报为准。',
  '注：1.产值按现价计算；2.部分数据因四舍五入存在合计误差。',
  '说明：规模以上工业指年主营业务收入2000万元及以上企业。',
  '备注：能源消费量按等价值折算为标准煤。',
];

interface TableSpec {
  kind: 'vertical' | 'transposed';
  /** 只取部分指标（制造不同列组合） */
  metricCodes: string[];
  periods: string[];
  renderedUnit: string | null;
  tampered: boolean;
}

interface FileSpec {
  fileName: string;
  county: string;
  seed: number;
  sheets: {
    name: string;
    /** 多块：stacked 纵向堆叠 / sideBySide 左右并排 */
    arrangement: 'single' | 'stacked' | 'sideBySide';
    tables: TableSpec[];
  }[];
  features: string[];
}

function main(): void {
  fs.rmSync(CORPUS_DIR, { recursive: true, force: true });
  fs.mkdirSync(CORPUS_DIR, { recursive: true });

  const manifest: CorpusManifest = {
    generatedAt: new Date().toISOString(),
    fileCount: FILE_COUNT,
    periods: ALL_PERIODS,
    counties: COUNTY_NAMES,
    files: [],
  };

  const layoutCounter: Record<string, number> = {};

  for (let i = 0; i < FILE_COUNT; i++) {
    const county = COUNTY_NAMES[i % COUNTY_NAMES.length];
    const serial = String(i + 1).padStart(3, '0');
    const fileName = `${serial}_${county}_经济报表.xlsx`;
    const seed = hashSeed(`${fileName}-${i}`);
    const spec = planFile(i, fileName, county, seed);

    for (const f of spec.features) layoutCounter[f] = (layoutCounter[f] ?? 0) + 1;

    const answer = buildFile(spec);
    const wb = XLSX.utils.book_new();
    for (const sheet of answer.sheets_ as BuiltSheet[]) {
      const ws = XLSX.utils.aoa_to_sheet(sheet.aoa);
      ws['!merges'] = sheet.merges.map((m: MergeRange) => ({
        s: { r: m.s.r, c: m.s.c },
        e: { r: m.e.r, c: m.e.c },
      }));
      ws['!ref'] = XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(0, sheet.aoa.length - 1), c: Math.max(0, (sheet.aoa[0]?.length ?? 1) - 1) },
      });
      XLSX.utils.book_append_sheet(wb, ws, sheet.name);
    }
    XLSX.writeFile(wb, path.join(CORPUS_DIR, spec.fileName), { compression: true });

    const answerPayload: AnswerFile = {
      fileName: spec.fileName,
      county: spec.county,
      sheets: spec.sheets.map((s) => s.name),
      blocks: answer.blocks,
      records: answer.records,
      layoutFeatures: spec.features,
    };
    fs.writeFileSync(
      path.join(CORPUS_DIR, `${spec.fileName}.answer.json`),
      JSON.stringify(answerPayload, null, 1),
      'utf8',
    );

    manifest.files.push({ fileName: spec.fileName, county, features: spec.features });
  }

  fs.writeFileSync(path.join(CORPUS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`生成 ${FILE_COUNT} 份报表 -> ${CORPUS_DIR}`);
  console.log('版式特征分布：', layoutCounter);
}

// ---------------------------------------------------------------------------
// 文件规划：保证各版式维度在 200 份中都有充分覆盖
// ---------------------------------------------------------------------------

function planFile(i: number, fileName: string, county: string, seed: number): FileSpec {
  const rng = new Rng(seed);
  const features: string[] = [];

  // 多表组合
  const roll = rng.next();
  let arrangement: FileSpec['sheets'][number]['arrangement'] = 'single';
  let tableCount = 1;
  if (roll < 0.18) {
    arrangement = 'sideBySide';
    tableCount = 2;
    features.push('multi-table-side-by-side');
  } else if (roll < 0.42) {
    arrangement = 'stacked';
    tableCount = rng.int(2, 3);
    features.push('multi-table-stacked');
  } else {
    features.push('single-table');
  }

  // 部分文件拆两个 sheet
  const twoSheets = rng.chance(0.22);
  features.push(twoSheets ? 'two-sheets' : 'one-sheet');

  const tables: TableSpec[] = [];
  // 多表文件：按指标分组轮转切分，保证同一分组不跨表重复，且每表都有指标
  const allGroupCodes = [...new Set(METRICS.map((m) => m.group))];
  const shuffledGroups = rng.shuffle(allGroupCodes);
  const groupAssign: string[][] = Array.from({ length: tableCount }, () => []);
  shuffledGroups.forEach((g, idx) => groupAssign[idx % tableCount].push(g));
  for (let t = 0; t < tableCount; t++) {
    tables.push(planTable(rng, i, t, features, tableCount === 1 ? undefined : groupAssign[t]));
  }

  const sheets: FileSpec['sheets'] = [];
  if (twoSheets && tables.length > 1) {
    const mid = 1;
    sheets.push({ name: '经济指标', arrangement: 'single', tables: tables.slice(0, mid) });
    sheets.push({ name: '投资与能耗', arrangement: arrangement === 'sideBySide' ? 'sideBySide' : 'single', tables: tables.slice(mid) });
  } else {
    sheets.push({ name: rng.pick(['报表', 'Sheet1', '经济指标表', '数据']), arrangement, tables });
  }

  return { fileName, county, seed, sheets, features };
}

function planTable(
  rng: Rng,
  fileIdx: number,
  tableIdx: number,
  features: string[],
  allowedGroups?: string[],
): TableSpec {
  // 转置表约占 22%
  const kind: TableSpec['kind'] = rng.chance(0.22) ? 'transposed' : 'vertical';
  if (tableIdx === 0) features.push(kind === 'transposed' ? 'layout-transposed' : 'layout-vertical');

  // 先定单位族：约 35% 为"同单位族专题表"，可换怪单位，保证换算样本充足
  const forcedVariant = FORCED_UNITS[fileIdx % FORCED_UNITS.length];
  const familyTables: Record<string, string[]> = {
    万元: METRICS.filter((m) => m.unit === '万元').map((m) => m.code),
    元: METRICS.filter((m) => m.unit === '元').map((m) => m.code),
    吨标准煤: METRICS.filter((m) => m.unit === '吨标准煤').map((m) => m.code),
  };
  const forceFamily = fileIdx % 3 === 0 ? rng.pick(['万元', '元', '吨标准煤'] as const) : null;

  // 指标子集（多表时只在分配到的分组内挑选，避免跨表重复）
  const groupPool = allowedGroups ?? [...new Set(METRICS.map((m) => m.group))];
  let metricCodes: string[];
  let effectiveForceFamily = forceFamily;
  if (forceFamily) {
    let pool = familyTables[forceFamily].filter((code) => {
      const g = METRICS.find((m) => m.code === code)!.group;
      return groupPool.includes(g);
    });
    // 分配到的分组里没有该单位族指标：放弃专题表，回退普通表避免空表/混族
    if (pool.length === 0) effectiveForceFamily = null;
    if (effectiveForceFamily) {
      const take = Math.min(pool.length, rng.int(2, pool.length));
      metricCodes = rng.shuffle(pool).slice(0, take);
    }
  }
  if (!metricCodes!) {
    if (rng.chance(0.5) || allowedGroups) {
      const inPool = METRICS.filter((m) => groupPool.includes(m.group)).map((m) => m.code);
      metricCodes = allowedGroups ? inPool : rng.shuffle(inPool);
      if (!allowedGroups && metricCodes.length > 10) {
        metricCodes = rng.shuffle(metricCodes).slice(0, rng.int(8, metricCodes.length));
      }
    } else {
      const groups = rng.shuffle([...new Set(METRICS.map((m) => m.group))]);
      const keepGroups = new Set(groups.slice(0, rng.int(3, 5)));
      metricCodes = METRICS.filter((m) => keepGroups.has(m.group)).map((m) => m.code);
    }
  }

  // 时期：单期 55%，多期 45%
  const periodCount = rng.chance(0.55) ? 1 : rng.int(2, 4);
  const periods = ALL_PERIODS.slice(0, periodCount);
  if (periods.length > 1) features.push('multi-period');

  // 单位：全部同单位族才允许换怪单位
  const units = [...new Set(metricCodes.map((code) => METRICS.find((m) => m.code === code)!.unit))];
  let renderedUnit: string | null = null;
  if (units.length === 1) {
    const std = units[0];
    const candidates = UNIT_VARIANTS[std];
    if (effectiveForceFamily && candidates.includes(forcedVariant)) {
      renderedUnit = forcedVariant;
    } else {
      renderedUnit = rng.pick(candidates);
    }
    if (renderedUnit !== std) features.push(`unit-${renderedUnit}`);
  }

  // 约 12% 的表自报合计与明细不一致（汇总高亮测试）
  const tampered = rng.chance(0.12);
  if (tampered) features.push('tampered-total');

  void fileIdx;
  return { kind, metricCodes, periods, renderedUnit, tampered };
}

// ---------------------------------------------------------------------------
// 模型构造与渲染
// ---------------------------------------------------------------------------

interface BuiltAnswer {
  sheets_: BuiltSheet[];
  blocks: AnswerBlock[];
  records: AnswerRecord[];
}

function buildFile(spec: FileSpec): BuiltAnswer {
  const rng = new Rng(spec.seed ^ 0x9e3779b9);
  const renderer = new LayoutRenderer(rng);
  const builtSheets: BuiltSheet[] = [];
  const blocks: AnswerBlock[] = [];
  const records: AnswerRecord[] = [];
  let blockIndex = 0;

  for (const sheetSpec of spec.sheets) {
    const builder = new SheetBuilder(sheetSpec.name);
    const models: TableModel[] = sheetSpec.tables.map((t) =>
      buildModel(rng, spec.county, t, sheetSpec.name),
    );

    const ctx: BuildContext = {
      numberStyle: rng.pick(NUMBER_STYLES),
      missingToken: rng.pick(MISSING_TOKENS),
      blankRowChance: rng.pick([0, 0.1, 0.2, 0.3]),
      notes: rng.chance(0.7) ? [rng.pick(NOTE_POOL)] : [],
      groupBanners: rng.chance(0.4),
      subitemPrefix: rng.chance(0.5),
    };

    if (sheetSpec.arrangement === 'sideBySide') {
      let colOffset = 0;
      models.forEach((model, idx) => {
        const out =
          model && sheetSpec.tables[idx].kind === 'transposed'
            ? renderer.renderTransposed(model, ctx, sheetSpec.name, blockIndex, 0, colOffset)
            : renderer.renderVertical(model, ctx, sheetSpec.name, blockIndex, 0, colOffset);
        mergeInto(builder, out.builder);
        records.push(...out.records);
        blocks.push(toBlock(out, sheetSpec.name, model));
        colOffset = out.builder.maxCol + 3; // 两表之间空两列
        blockIndex++;
      });
    } else {
      let rowOffset = 0;
      models.forEach((model, idx) => {
        const out =
          sheetSpec.tables[idx].kind === 'transposed'
            ? renderer.renderTransposed(model, ctx, sheetSpec.name, blockIndex, rowOffset, 0)
            : renderer.renderVertical(model, ctx, sheetSpec.name, blockIndex, rowOffset, 0);
        mergeInto(builder, out.builder);
        records.push(...out.records);
        blocks.push(toBlock(out, sheetSpec.name, model));
        rowOffset = out.builder.maxRow + (idx < models.length - 1 ? rng.int(2, 3) : 1);
        blockIndex++;
      });
    }

    const assembled = builder.toAoa();
    builtSheets.push({ name: sheetSpec.name, aoa: assembled.aoa, merges: assembled.merges });
  }

  return { sheets_: builtSheets, blocks, records };
}

function toBlock(out: RenderOutput, sheet: string, model: TableModel): AnswerBlock {
  return {
    sheet,
    blockIndex: out.blockIndex,
    title: out.title,
    transposed: out.transposed,
    county: model.county,
    period: model.periods.length === 1 ? model.periods[0] : null,
    tableUnit: out.tableUnit,
    excludedRows: [...out.excludedRows].sort((a, b) => a - b),
  };
}

/** 把子 builder 的内容（含合并区）平移合并进主 builder */
function mergeInto(main: SheetBuilder, sub: SheetBuilder): void {
  for (let r = 0; r <= sub.maxRow; r++) {
    for (let c = 0; c <= sub.maxCol; c++) {
      const v = sub.get(r, c);
      if (v !== null) main.set(r, c, v);
    }
  }
  main.merges.push(...sub.merges);
  main.maxRow = Math.max(main.maxRow, sub.maxRow);
  main.maxCol = Math.max(main.maxCol, sub.maxCol);
}

function buildModel(rng: Rng, county: string, spec: TableSpec, sheetName: string): TableModel {
  const leaves: DataCell[] = [];
  const subtotals: SubtotalCell[] = [];

  for (const code of spec.metricCodes) {
    const metric = METRICS.find((m) => m.code === code)!;
    const values = new Map<string, number | null>();
    for (const p of spec.periods) {
      // 约 4% 缺失
      values.set(p, rng.chance(0.04) ? null : rng.int(500, 980000));
    }
    leaves.push({ metric, values });
  }

  // 小计 = 组内成员真实加总（渲染单位下计算）
  for (const group of METRIC_GROUPS) {
    const members = leaves.filter((d) => group.members.includes(d.metric.code));
    if (members.length === 0) continue;
    const values = new Map<string, number | null>();
    for (const p of spec.periods) {
      const vs = members.map((m) => m.values.get(p)).filter((v): v is number => v !== null && v !== undefined);
      if (vs.length === 0) values.set(p, null);
      else values.set(p, vs.reduce((a, b) => a + b, 0));
    }
    subtotals.push({ group, values });
  }

  // 全表总计：仅当所有叶子同单位族时生成
  const leafUnits = new Set(leaves.map((l) => l.metric.unit));
  let grandTotal: Map<string, number | null> | null = null;
  if (leafUnits.size === 1 && rng.chance(0.6)) {
    grandTotal = new Map();
    for (const p of spec.periods) {
      const vs = leaves.map((l) => l.values.get(p)).filter((v): v is number => v !== null && v !== undefined);
      grandTotal.set(p, vs.reduce((a, b) => a + b, 0));
    }
  }

  // 单位换算到渲染单位：逐指标按其自身标准单位换算；
  // 混合单位表中异族指标（如元、吨标准煤）无法换表级单位，保持原值（渲染器用单位列标注）
  const standardUnit = leaves[0]?.metric.unit ?? '万元';
  const renderedUnit = spec.renderedUnit ?? standardUnit;
  if (renderedUnit !== standardUnit) {
    for (const leaf of leaves) {
      const f = conversionFactor(leaf.metric.unit, renderedUnit);
      if (f === null) continue; // 异族：不换算
      const scale = (v: number | null): number | null => (v === null ? v : Number((v / f).toFixed(4)));
      for (const [p, v] of leaf.values) leaf.values.set(p, scale(v));
    }
    for (const sub of subtotals) {
      const f = conversionFactor(sub.group.unit, renderedUnit);
      if (f === null) continue;
      const scale = (v: number | null): number | null => (v === null ? v : Number((v / f).toFixed(4)));
      for (const [p, v] of sub.values) sub.values.set(p, scale(v));
    }
    if (grandTotal) {
      const f = conversionFactor(standardUnit, renderedUnit);
      if (f !== null) {
        const scale = (v: number | null): number | null => (v === null ? v : Number((v / f).toFixed(4)));
        for (const [p, v] of grandTotal) grandTotal.set(p, scale(v));
      }
    }
  }

  // 制造合计与明细不一致：篡改小计/总计（明细不动）
  if (spec.tampered) {
    const target = rng.chance(0.5) && subtotals.length ? subtotals[rng.int(0, subtotals.length - 1)] : null;
    const p = spec.periods[rng.int(0, spec.periods.length - 1)];
    const delta = rng.int(50, 5000);
    if (target) {
      const cur = target.values.get(p);
      if (cur !== null && cur !== undefined) target.values.set(p, cur + delta);
    } else if (grandTotal) {
      const cur = grandTotal.get(p);
      if (cur !== null && cur !== undefined) grandTotal.set(p, cur + delta);
    }
  }

  const periodText =
    spec.periods.length === 1
      ? spec.periods[0].replace(/Q(\d)/, (_, q) => `年第${['一', '二', '三', '四'][Number(q) - 1]}季度`)
      : null;
  const title = rng.pick([
    `${county}主要经济指标统计表`,
    `${county}2026年季度经济运行报表`,
    `${county}统计季报`,
    `${county}经济社会发展指标表`,
    periodText ? `${county}${periodText}经济指标表` : `${county}主要经济指标统计表`,
  ]);

  void sheetName;
  void formatNumber;
  const isMixedUnit = new Set(leaves.map((l) => l.metric.unit)).size > 1;
  return {
    county,
    periods: spec.periods,
    leaves,
    subtotals,
    grandTotal,
    unit: standardUnit,
    renderedUnit,
    title,
    tamperedTotals: spec.tampered,
    isMixedUnit,
  };
}

main();
