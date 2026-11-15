/**
 * 核心数据类型定义 —— 报表结构还原引擎各阶段的数据契约
 */

/** 单元格坐标与原始/填充值 */
export interface Cell {
  r: number;
  c: number;
  /** 原始值（未做合并填充前） */
  raw: string | number | null;
  /** 合并区域填充后的有效值 */
  value: string | number | null;
  /** 若该单元格是合并区域的从属格，记录锚点坐标 */
  mergeAnchor?: { r: number; c: number };
  /** 所属合并区域（锚点格上有值） */
  merged?: boolean;
}

/** 合并单元格区域（SheetJS merges 格式，含边界） */
export interface MergeRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

/** 还原后的二维网格（已完成合并填充） */
export interface Grid {
  rows: number;
  cols: number;
  /** cells[r][c]，稀疏行列也补齐为 null 格 */
  cells: Cell[][];
  merges: MergeRange[];
}

/** 表格块：一个 sheet 切分后得到的一张逻辑表 */
export interface TableBlock {
  id: string;
  sheetName: string;
  /** 块在原 sheet 中的行范围（含标题行） */
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
  /** 本块自己的网格视图（坐标仍沿用原 sheet 绝对坐标） */
  grid: Grid;
  /** 识别出的标题行文本（可能为空） */
  title: string;
  /** 是否为转置表（指标在列、时期在表头行） */
  transposed: boolean;
}

/** 扁平化后的列定义 */
export interface FlatColumn {
  /** 列号（绝对坐标） */
  index: number;
  /** 多层表头各层级文本，自顶向下 */
  levels: string[];
  /** 拼接后的完整列名，用于映射 */
  fullName: string;
  /** 列角色 */
  role: 'label' | 'period' | 'data' | 'unit' | 'ignore';
  /** 从该列表头中解析出的单位（如 万元） */
  unit?: string;
  /** 时期列/时期表头解析出的标准时期，如 2026Q3 */
  period?: string;
  /** 映射到的标准指标编码（未映射为 null） */
  metricCode?: string | null;
  /** 原始表头文本（最底层） */
  leafName: string;
}

/** 行分类结果 */
export type RowKind =
  | 'data'
  | 'subtotal'
  | 'grandtotal'
  | 'blank'
  | 'note'
  | 'header'
  | 'unknown';

export interface ClassifiedRow {
  r: number;
  kind: RowKind;
  /** 行首标签文本 */
  label: string;
  /** 小计/合计所覆盖的指标分组编码（subtotal 时有值） */
  groupCode?: string;
  /** 备注原文（note 行） */
  note?: string;
  /** 转置表中该行的时期 */
  period?: string;
  /** 常规版式中标签映射到的指标编码（parser 阶段写入） */
  metricCode?: string | null;
}

/** 识别完成的结构化表 */
export interface ParsedTable {
  block: TableBlock;
  title: string;
  county: string | null;
  period: string | null;
  tableUnit: string | null;
  headerRows: number[];
  columns: FlatColumn[];
  rows: ClassifiedRow[];
  /** 单位行所在行号（若存在独立单位行） */
  unitRow?: number;
  /** 识别告警（如表头缺失、映射失败等） */
  warnings: string[];
  /** 版式类别 */
  layout: 'label-rows' | 'multi-period' | 'single-period' | 'transposed';
  /** 版式指纹 */
  fingerprint: string;
  /** 标签列号 */
  labelColumn: number;
  /** 单位列号（可能不存在） */
  unitColumn?: number;
  /** 时期列号集合 */
  periodColumns: number[];
  /** 转置表的表头行 */
  transposedHeaderRow?: number;
}

/** 长表记录：县、指标、时期、数值 四列为核心 */
export interface LongRecord {
  county: string;
  metricCode: string;
  metricName: string;
  period: string;
  value: number | null;
  unit: string | null;
  /** 来源溯源 */
  sourceFile: string;
  sheetName: string;
  blockId: string;
  row: number;
  col: number;
  /** 明细/小计/合计 */
  rowKind: RowKind;
  /** 若为小计/合计行，关联的分组编码 */
  groupCode?: string;
}

/** 标准指标定义 */
export interface MetricDef {
  code: string;
  name: string;
  unit: string;
  group: string;
  /** 常见别名/各县不规范写法 */
  aliases: string[];
}

/** 指标分组（小计）定义 */
export interface MetricGroup {
  code: string;
  name: string;
  unit: string;
  /** 组内叶子指标编码 */
  members: string[];
  /** 小计行常见叫法 */
  subtotalLabels: string[];
}

/** 一个文件的完整处理结果 */
export interface FileResult {
  fileName: string;
  tables: ParsedTable[];
  records: LongRecord[];
  /** 未能映射标准指标的列 */
  unmapped: { tableId: string; col: number; fullName: string }[];
  warnings: string[];
}

/** 版式指纹：同一版式下回自动套用模板 */
export interface LayoutTemplate {
  id: string;
  fingerprint: string;
  createdAt: string;
  /** 列完整名 -> 标准指标编码 */
  columnMapping: Record<string, string>;
  /** 备注，便于人工管理 */
  note?: string;
}

/** 汇总对账结果中的单条指标 */
export interface SummaryRow {
  metricCode: string;
  metricName: string;
  unit: string | null;
  period: string;
  /** 各县明细加总 */
  summedValue: number | null;
  /** 各县自报合计加总 */
  selfReportedValue: number | null;
  /** 差额 */
  diff: number | null;
  /** 是否不一致（高亮） */
  mismatch: boolean;
  contributingCounties: number;
}

/** 汇总阶段输出 */
export interface SummaryResult {
  rows: SummaryRow[];
  /** 按县列出的自报合计记录 */
  countyTotals: LongRecord[];
}

/** 测试/构造用的最小原始 sheet 描述 */
export interface RawSheetLike {
  name: string;
  aoa: unknown[][];
  merges?: MergeRange[];
}
