import { SheetBuilder } from './sheet-builder';
import type { BuildContext, DataCell, NumberStyle, RenderOutput, SubtotalCell, TableModel } from './model';
import type { AnswerRecord } from './answer-types';
import { Rng } from './rng';
import { conversionFactor } from '../src/engine/units';
import { METRICS, METRIC_GROUPS } from '../src/engine/standards';

/** 数字按指定风格书写 */
export function formatNumber(n: number | null, style: NumberStyle, missingToken: string): string | number | null {
  if (n === null) return missingToken;
  switch (style) {
    case 'plain':
      return Number.isInteger(n) ? n : Number(n.toFixed(2));
    case 'decimal2':
      return n.toFixed(2);
    case 'thousands':
      return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    case 'text':
      return String(Number.isInteger(n) ? n : Number(n.toFixed(2)));
  }
}

/** 把标准单位下的数值换算到渲染单位 */
function toRendered(value: number | null, standardUnit: string, renderedUnit: string): number | null {
  if (value === null) return null;
  if (standardUnit === renderedUnit) return value;
  const f = conversionFactor(standardUnit, renderedUnit);
  return f === null ? value : Number((value / f).toFixed(4));
}

/**
 * 某指标在本表中的显示单位：
 * - 全表统一渲染单位（同族专题表）-> renderedUnit
 * - 混合单位表 -> 指标自身标准单位（由单位列逐行标注）
 */
function displayUnitOf(metricUnit: string, model: TableModel): string {
  return model.renderedUnit === model.unit && model.unit !== metricUnit
    ? metricUnit
    : compatibleOrSelf(model.renderedUnit, metricUnit);
}

function compatibleOrSelf(renderedUnit: string, metricUnit: string): string {
  return conversionFactor(renderedUnit, metricUnit) === null ? metricUnit : renderedUnit;
}

/** 取得叶子在某时期的显示值（已换算到显示单位） */
function renderedValue(cell: DataCell, period: string, model: TableModel): number | null {
  const displayUnit = displayUnitOf(cell.metric.unit, model);
  return toRendered(cell.values.get(period) ?? null, cell.metric.unit, displayUnit);
}

function renderedSubtotal(cell: SubtotalCell, period: string, model: TableModel): number | null {
  // 混合单位表：小计保持分组自身单位，不做表级换算
  if (model.isMixedUnit) return cell.values.get(period) ?? null;
  // 小计只在同族组内出现，显示单位即表渲染单位
  return toRendered(cell.values.get(period) ?? null, model.unit, model.renderedUnit);
}

interface HeaderStyle {
  titleMerged: boolean;
  twoLayer: boolean;
  cornerUnit: 'unit-row' | 'title-paren' | 'header-paren' | 'none';
  labelHeader: string;
  periodHeaderStyle: 'cn' | 'q' | 'month';
}

const LABEL_HEADERS = ['指标名称', '项目', '指标', '经济指标', '科目名称'];
const MISSING_TOKENS = ['-', '—', '…', '/', ''];

export class LayoutRenderer {
  constructor(private rng: Rng) {}

  private headerStyle(): HeaderStyle {
    return {
      titleMerged: this.rng.chance(0.75),
      twoLayer: this.rng.chance(0.45),
      // 单位必有落点：独立单位行 / 标题括号 / 表头括号（不再出现"无单位"）
      cornerUnit: this.rng.pick(['unit-row', 'title-paren', 'header-paren', 'unit-row', 'title-paren'] as const),
      labelHeader: this.rng.pick(LABEL_HEADERS),
      periodHeaderStyle: this.rng.pick(['cn', 'q', 'month'] as const),
    };
  }

  private periodText(period: string, style: HeaderStyle['periodHeaderStyle']): string {
    const [y, q] = period.split('Q');
    if (style === 'q') return `${y}Q${q}`;
    if (style === 'month') {
      const endMonth = Number(q) * 3;
      const startMonth = endMonth - 2;
      return `${y}年${startMonth}-${endMonth}月`;
    }
    const cn = ['一', '二', '三', '四'][Number(q) - 1];
    return this.rng.chance(0.5) ? `${y}年第${cn}季度` : `${cn}季度`;
  }

  private writeTitle(builder: SheetBuilder, model: TableModel, r: number, c0: number, span: number, hs: HeaderStyle): number {
    let title = model.title;
    if (hs.cornerUnit === 'title-paren') title += `（单位：${model.renderedUnit}）`;
    if (hs.titleMerged && span > 1) {
      builder.merge(r, c0, r, c0 + span - 1, title);
    } else {
      builder.set(r, c0, title);
    }
    return r + 1;
  }

  private writeMetaRows(builder: SheetBuilder, model: TableModel, r: number, c0: number, span: number, hs: HeaderStyle): number {
    // 县名行：标签写法随机
    const countyLabels = ['填报单位', '报送单位', '编制单位', '单位名称', '地区'];
    const label = this.rng.pick(countyLabels);
    const countyLine = `${label}：${model.county}`;
    if (this.rng.chance(0.5) && span > 2) builder.merge(r, c0, r, c0 + 2, countyLine);
    else builder.set(r, c0, countyLine);
    r += 1;
    if (hs.cornerUnit === 'unit-row') {
      builder.set(r, c0 + span - 1, `单位：${model.renderedUnit}`);
      r += 1;
    }
    return r;
  }

  /**
   * 版式 A/B：垂直表（指标在行）。
   * 单期 -> single-period；多期 -> multi-period（可带两层表头）。
   */
  renderVertical(
    model: TableModel,
    ctx: BuildContext,
    sheetName: string,
    blockIndex: number,
    rowOffset = 0,
    colOffset = 0,
  ): RenderOutput {
    const builder = new SheetBuilder(sheetName);
    const hs = this.headerStyle();
    const records: AnswerRecord[] = [];
    const excludedRows: number[] = [];
    const multi = model.periods.length > 1;
    // 混合单位表必须有单位列逐行标注，且不在标题/单位行写单一表级单位
    const hasUnitCol = model.isMixedUnit || this.rng.chance(0.35);
    if (model.isMixedUnit) hs.cornerUnit = 'none';
    const nCols = 1 + (multi ? model.periods.length : 1) + (hasUnitCol ? 1 : 0);
    const c0 = colOffset;
    let r = rowOffset;
    const c0abs = c0;
    void hasUnitCol;

    r = this.writeTitle(builder, model, r, c0abs, nCols, hs);
    r = this.writeMetaRows(builder, model, r, c0abs, nCols, hs);

    // 表头
    const headerStart = r;
    const labelHead = hs.labelHeader;
    const valueCol0 = c0abs + 1;
    if (hasUnitCol) builder.set(headerStart, c0abs + (multi ? model.periods.length : 1) + 1, '计量单位');
    if (multi && hs.twoLayer) {
      // 第一层：指标名称（纵向合并）| 时期总横幅（横向合并）
      builder.merge(headerStart, c0abs, headerStart + 1, c0abs, labelHead);
      builder.merge(headerStart, valueCol0, headerStart, valueCol0 + model.periods.length - 1, '本期数值');
      let c = valueCol0;
      for (const p of model.periods) {
        let text = this.periodText(p, hs.periodHeaderStyle);
        if (hs.cornerUnit === 'header-paren') text += `(${model.renderedUnit})`;
        builder.set(headerStart + 1, c, text);
        c++;
      }
      r = headerStart + 2;
    } else {
      builder.set(headerStart, c0abs, labelHead);
      if (multi) {
        let c = valueCol0;
        for (const p of model.periods) {
          let text = this.periodText(p, hs.periodHeaderStyle);
          if (hs.cornerUnit === 'header-paren') text += `（${model.renderedUnit}）`;
          builder.set(r, c, text);
          c++;
        }
      } else {
        let head = this.rng.pick(['本期数值', '数值', '金额', '本月', '累计']);
        if (hs.cornerUnit === 'header-paren') head += `（${model.renderedUnit}）`;
        builder.set(r, valueCol0, head);
      }
      r += 1;
    }
    const headerRows = multi && hs.twoLayer ? [headerStart, headerStart + 1] : [headerStart];
    void headerRows;

    // 正文：按分组顺序输出叶子，组末插小计，可能插横幅、空行、备注
    const bodyStart = r;
    const groupOrder = METRIC_GROUPS.map((g) => g.code);
    const extraGroups = [...new Set(METRICS.map((m) => m.group))].filter((g) => !groupOrder.includes(g));
    const allGroups = [...groupOrder, ...extraGroups];
    let firstRenderedCode: string | null = null;

    const writeLeaf = (cell: DataCell): void => {
      if (firstRenderedCode === null) firstRenderedCode = cell.metric.code;
      let label = this.rng.chance(0.5) ? this.rng.pick(cell.metric.aliases) : cell.metric.name;
      if (ctx.subitemPrefix && this.rng.chance(0.4)) label = `其中：${label}`;
      builder.set(r, c0abs, label);
      const dispUnit = displayUnitOf(cell.metric.unit, model);
      if (hasUnitCol) builder.set(r, valueCol0 + (multi ? model.periods.length : 1), dispUnit);
      if (multi) {
        let c = valueCol0;
        for (const p of model.periods) {
          const rv = renderedValue(cell, p, model);
          builder.set(r, c, formatNumber(rv, ctx.numberStyle, ctx.missingToken));
          this.pushRecord(records, model, cell.metric.code, p, rv, 'data', sheetName, blockIndex, r, c, undefined, dispUnit);
          c++;
        }
      } else {
        const p = model.periods[0];
        const rv = renderedValue(cell, p, model);
        builder.set(r, valueCol0, formatNumber(rv, ctx.numberStyle, ctx.missingToken));
        this.pushRecord(records, model, cell.metric.code, p, rv, 'data', sheetName, blockIndex, r, valueCol0, undefined, dispUnit);
      }
      r += 1;
      r = this.maybeBlank(r, ctx, excludedRows);
    };

    for (const gc of allGroups) {
      const members = model.leaves.filter((d) => d.metric.group === gc);
      if (members.length === 0) continue;
      const hasSubtotal = model.subtotals.some((s) => s.group.code === gc);
      // 横幅只给有小计的分组；无小计分组（如居民收入、能耗）不插横幅
      if (ctx.groupBanners && hasSubtotal) {
        const idx = METRIC_GROUPS.findIndex((g) => g.code === gc) + 1;
        const cnNum = ['一', '二', '三', '四', '五', '六'][idx - 1] ?? String(idx);
        builder.set(r, c0abs, `${cnNum}、${this.groupDisplayName(gc)}`);
        excludedRows.push(r);
        r += 1;
      }
      for (const cell of members) writeLeaf(cell);

      const sub = model.subtotals.find((s) => s.group.code === gc);
      if (sub) {
        builder.set(r, c0abs, this.rng.pick(sub.group.subtotalLabels));
        excludedRows.push(r);
        // 小计按分组自身单位标注（混合表中表级单位不适用）
        const subUnit = model.isMixedUnit ? sub.group.unit : model.renderedUnit;
        if (multi) {
          let c = valueCol0;
          for (const p of model.periods) {
            const rv = renderedSubtotal(sub, p, model);
            builder.set(r, c, formatNumber(rv, ctx.numberStyle, ctx.missingToken));
            this.pushRecord(records, model, sub.group.members[0], p, rv, 'subtotal', sheetName, blockIndex, r, c, sub.group.code, subUnit);
            c++;
          }
        } else {
          const p = model.periods[0];
          const rv = renderedSubtotal(sub, p, model);
          builder.set(r, valueCol0, formatNumber(rv, ctx.numberStyle, ctx.missingToken));
          this.pushRecord(records, model, sub.group.members[0], p, rv, 'subtotal', sheetName, blockIndex, r, valueCol0, sub.group.code, subUnit);
        }
        r += 1;
        r = this.maybeBlank(r, ctx, excludedRows);
      }
    }

    if (model.grandTotal) {
      builder.set(r, c0abs, this.rng.pick(['总计', '合计', '全县合计']));
      excludedRows.push(r);
      // 总计代表指标：实际物理渲染的第一个叶子，与引擎口径一致
      const gtCode = firstRenderedCode ?? model.leaves[0].metric.code;
      if (multi) {
        let c = valueCol0;
        for (const p of model.periods) {
          const rv = toRendered(model.grandTotal.get(p) ?? null, model.unit, model.renderedUnit);
          builder.set(r, c, formatNumber(rv, ctx.numberStyle, ctx.missingToken));
          this.pushRecord(records, model, gtCode, p, rv, 'grandtotal', sheetName, blockIndex, r, c);
          c++;
        }
      } else {
        const p = model.periods[0];
        const rv = toRendered(model.grandTotal.get(p) ?? null, model.unit, model.renderedUnit);
        builder.set(r, valueCol0, formatNumber(rv, ctx.numberStyle, ctx.missingToken));
        this.pushRecord(records, model, gtCode, p, rv, 'grandtotal', sheetName, blockIndex, r, valueCol0);
      }
      r += 1;
    }

    for (const note of ctx.notes) {
      builder.set(r, c0abs, note);
      excludedRows.push(r);
      r += 1;
    }
    void bodyStart;

    return {
      builder,
      lastRow: r - 1,
      records,
      excludedRows,
      blockIndex,
      title: model.title,
      transposed: false,
      tableUnit: model.isMixedUnit ? null : model.renderedUnit,
    };
  }

  /**
   * 版式 C：转置表（时期在行，指标在列），首行多层/单层表头
   */
  renderTransposed(
    model: TableModel,
    ctx: BuildContext,
    sheetName: string,
    blockIndex: number,
    rowOffset = 0,
    colOffset = 0,
  ): RenderOutput {
    const builder = new SheetBuilder(sheetName);
    const records: AnswerRecord[] = [];
    const excludedRows: number[] = [];
    const hs = this.headerStyle();
    if (model.isMixedUnit) hs.cornerUnit = 'none';
    const c0 = colOffset;
    let r = rowOffset;
    const nCols = 1 + model.leaves.length;

    r = this.writeTitle(builder, model, r, c0, nCols, hs);
    r = this.writeMetaRows(builder, model, r, c0, nCols, hs);

    // 表头：时期 | 各指标（别名随机），两层时加总横幅
    const headerRow = r;
    if (hs.twoLayer) {
      builder.merge(r, c0, r + 1, c0, '时期');
      builder.merge(r, c0 + 1, r, c0 + model.leaves.length, model.title.includes('经济') ? '主要经济指标' : '指标');
      r += 1;
    } else {
      builder.set(r, c0, '时期');
    }
    let c = c0 + 1;
    for (const leaf of model.leaves) {
      const label = this.rng.chance(0.5) ? this.rng.pick(leaf.metric.aliases) : leaf.metric.name;
      let head = label;
      if (hs.cornerUnit === 'header-paren') head += `（${model.renderedUnit}）`;
      builder.set(r, c, head);
      c++;
    }
    r += 1;

    for (const p of model.periods) {
      builder.set(r, c0, this.periodText(p, hs.periodHeaderStyle));
      c = c0 + 1;
      for (const leaf of model.leaves) {
        const rv = renderedValue(leaf, p, model);
        builder.set(r, c, formatNumber(rv, ctx.numberStyle, ctx.missingToken));
        this.pushRecord(
          records, model, leaf.metric.code, p, rv, 'data', sheetName, blockIndex, r, c,
          undefined, displayUnitOf(leaf.metric.unit, model),
        );
        c++;
      }
      r += 1;
      r = this.maybeBlank(r, ctx, excludedRows);
    }
    for (const note of ctx.notes) {
      builder.set(r, c0, note);
      excludedRows.push(r);
      r += 1;
    }
    void headerRow;

    return { builder, lastRow: r - 1, records, excludedRows, blockIndex, title: model.title, transposed: true, tableUnit: model.isMixedUnit ? null : model.renderedUnit };
  }

  /** 概率性插入真实空行：返回新行号（空行也占一行） */
  private maybeBlank(r: number, ctx: BuildContext, excludedRows: number[]): number {
    if (this.rng.chance(ctx.blankRowChance)) {
      excludedRows.push(r);
      return r + 1;
    }
    return r;
  }

  private groupDisplayName(gc: string): string {
    const g = METRIC_GROUPS.find((gg) => gg.code === gc);
    if (g) return g.name;
    // 无小计分组：取组内第一个指标的上位名称
    const first = METRICS.find((m) => m.group === gc);
    return first ? first.name : gc;
  }

  private pushRecord(
    out: AnswerRecord[],
    model: TableModel,
    metricCode: string,
    period: string,
    rendered: number | null,
    rowKind: AnswerRecord['rowKind'],
    sheet: string,
    blockIndex: number,
    row: number,
    col: number,
    groupCode?: string,
    sourceUnit?: string,
  ): void {
    const metric = METRICS.find((m) => m.code === metricCode);
    const standardUnit = metric?.unit ?? model.unit;
    const effSourceUnit = sourceUnit ?? model.renderedUnit;
    const rawValue = rendered;
    const value =
      rendered === null
        ? null
        : effSourceUnit === standardUnit
          ? rendered
          : (() => {
              const f = conversionFactor(effSourceUnit, standardUnit);
              return f === null ? rendered : Number((rendered * f).toFixed(4));
            })();
    out.push({
      county: model.county,
      metricCode,
      period,
      value,
      rawValue,
      sourceUnit: rendered === null ? null : effSourceUnit,
      rowKind,
      groupCode,
      sheet,
      blockIndex,
      cell: { row, col },
    });
  }
}

export { MISSING_TOKENS };
