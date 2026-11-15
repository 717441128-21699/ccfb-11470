/**
 * 一份报表的逻辑数据模型（与版式无关），渲染器把它画成各种"怪样子"
 */
import type { MetricDef, MetricGroup } from '../src/engine/types';

export interface DataCell {
  metric: MetricDef;
  /** period -> 原始书写数值（可能为缺失记号） */
  values: Map<string, number | null>;
}

export interface SubtotalCell {
  group: MetricGroup;
  /** period -> 小计原始值 */
  values: Map<string, number | null>;
}

export interface TableModel {
  county: string;
  periods: string[];
  /** 叶子指标，按展示顺序（渲染器可能再打乱） */
  leaves: DataCell[];
  subtotals: SubtotalCell[];
  grandTotal: Map<string, number | null> | null;
  /** 全表单位（标准单位，渲染时可能改成怪单位并换算数值） */
  unit: string;
  /** 怪单位覆盖：只允许同族，渲染时换算 */
  renderedUnit: string;
  title: string;
  /** 是否制造与明细不一致的自报合计（汇总高亮测试用） */
  tamperedTotals: boolean;
  /** 是否混合单位表（含多种标准单位，单位必须逐行标注） */
  isMixedUnit: boolean;
}

export interface BuildContext {
  /** 数字格式化方式 */
  numberStyle: NumberStyle;
  /** 缺失值记号（本文件统一） */
  missingToken: string;
  /** 空行插入概率 */
  blankRowChance: number;
  /** 备注行（0 或 1~2 条） */
  notes: string[];
  /** 分组横幅行（如"一、农林牧渔业"） */
  groupBanners: boolean;
  /** "其中：" 前缀 */
  subitemPrefix: boolean;
}

export type NumberStyle = 'plain' | 'thousands' | 'text' | 'decimal2';

/** 渲染产出：sheet 片段 + 该片段的标准答案 */
export interface RenderOutput {
  builder: import('./sheet-builder').SheetBuilder;
  /** 片段占用的行范围（含可能的底部空行） */
  lastRow: number;
  records: import('./answer-types').AnswerRecord[];
  excludedRows: number[];
  blockIndex: number;
  title: string;
  transposed: boolean;
  tableUnit: string | null;
}
