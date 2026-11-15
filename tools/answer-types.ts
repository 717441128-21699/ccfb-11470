/**
 * 语料标准答案数据契约（corpus/<file>.answer.json）
 */

export interface AnswerCell {
  /** 原始 sheet 中的 0 基坐标 */
  row: number;
  col: number;
}

export interface AnswerRecord {
  county: string;
  metricCode: string;
  period: string;
  /** 标准答案：换算到标准单位后的数值 */
  value: number | null;
  /** 文件中书写的原始数值（未换算） */
  rawValue: number | null;
  /** 文件中书写的单位 */
  sourceUnit: string | null;
  /** 明细/小计/合计 */
  rowKind: 'data' | 'subtotal' | 'grandtotal';
  groupCode?: string;
  sheet: string;
  blockIndex: number;
  cell: AnswerCell;
}

export interface AnswerBlock {
  sheet: string;
  blockIndex: number;
  title: string;
  transposed: boolean;
  county: string | null;
  period: string | null;
  tableUnit: string | null;
  /** 应被识别为非明细的行号（空行/备注/小计/合计/横幅） */
  excludedRows: number[];
}

export interface AnswerFile {
  fileName: string;
  county: string;
  sheets: string[];
  blocks: AnswerBlock[];
  records: AnswerRecord[];
  /** 生成时使用的版式特征，便于排查 */
  layoutFeatures: string[];
}

export interface CorpusManifest {
  generatedAt: string;
  fileCount: number;
  periods: string[];
  counties: string[];
  files: { fileName: string; county: string; features: string[] }[];
}
