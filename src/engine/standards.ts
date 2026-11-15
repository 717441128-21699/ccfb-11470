import type { MetricDef, MetricGroup } from './types';

/**
 * 标准指标字典 —— 市级统计局统一下发的口径。
 * 15 个叶子指标，分 6 组，其中 4 组有小计（组内单位一致，可相加）。
 */
export const METRICS: MetricDef[] = [
  // 农林牧渔业（万元）
  { code: 'A01', name: '农业产值', unit: '万元', group: 'G1', aliases: ['农业', '种植业产值', '农业总产值'] },
  { code: 'A02', name: '林业产值', unit: '万元', group: 'G1', aliases: ['林业', '林业总产值'] },
  { code: 'A03', name: '牧业产值', unit: '万元', group: 'G1', aliases: ['牧业', '畜牧业产值', '牧业总产值'] },
  { code: 'A04', name: '渔业产值', unit: '万元', group: 'G1', aliases: ['渔业', '渔业总产值'] },
  { code: 'A05', name: '农林牧渔专业及辅助性活动产值', unit: '万元', group: 'G1', aliases: ['农林牧渔专业及辅助性活动', '辅助性活动产值', '农林牧渔服务业产值'] },

  // 工业（万元）
  { code: 'B01', name: '规模以上工业总产值', unit: '万元', group: 'G2', aliases: ['规上工业总产值', '规模以上工业', '规上工业'] },
  { code: 'B02', name: '规模以下工业总产值', unit: '万元', group: 'G2', aliases: ['规下工业总产值', '规模以下工业', '规下工业'] },

  // 投资（万元）
  { code: 'C01', name: '固定资产投资完成额', unit: '万元', group: 'G3', aliases: ['固定资产投资', '固投完成额', '投资完成额'] },
  { code: 'C02', name: '工业投资', unit: '万元', group: 'G3', aliases: ['工业领域投资', '工业固定资产投资'] },
  { code: 'C03', name: '房地产开发投资', unit: '万元', group: 'G3', aliases: ['房地产投资', '房开投资', '房地产开发投资额', '房地产开发'] },

  // 商贸（万元）
  { code: 'D01', name: '社会消费品零售总额', unit: '万元', group: 'G4', aliases: ['社零总额', '消费品零售总额', '社会消费品零售额'] },
  { code: 'D02', name: '限上消费品零售额', unit: '万元', group: 'G4', aliases: ['限上零售额', '限额以上消费品零售额'] },

  // 居民收入（元）—— 单位不同，无小计
  { code: 'E01', name: '城镇居民人均可支配收入', unit: '元', group: 'G5', aliases: ['城镇人均可支配收入', '城镇居民可支配收入', '城镇可支配收入'] },
  { code: 'E02', name: '农村居民人均可支配收入', unit: '元', group: 'G5', aliases: ['农村人均可支配收入', '农村居民可支配收入', '农村可支配收入'] },

  // 能耗（吨标准煤）—— 无小计
  { code: 'F01', name: '规模以上工业综合能源消费量', unit: '吨标准煤', group: 'G6', aliases: ['规上工业综合能源消费量', '工业综合能源消费量', '规上工业能耗'] },
];

export const METRIC_GROUPS: MetricGroup[] = [
  {
    code: 'G1',
    name: '农林牧渔业总产值',
    unit: '万元',
    members: ['A01', 'A02', 'A03', 'A04', 'A05'],
    subtotalLabels: ['农林牧渔业总产值', '农林牧渔业合计', '农业总产值合计', '农林牧渔业小计'],
  },
  {
    code: 'G2',
    name: '工业总产值',
    unit: '万元',
    members: ['B01', 'B02'],
    subtotalLabels: ['工业总产值', '工业合计', '工业小计'],
  },
  {
    code: 'G3',
    name: '投资合计',
    unit: '万元',
    members: ['C01', 'C02', 'C03'],
    subtotalLabels: ['投资合计', '固定资产投资合计', '投资小计'],
  },
  {
    code: 'G4',
    name: '商贸合计',
    unit: '万元',
    members: ['D01', 'D02'],
    subtotalLabels: ['商贸合计', '消费合计', '商贸业小计', '消费品合计'],
  },
];

/** 指标编码 -> 定义，便于 O(1) 查找 */
export const METRIC_BY_CODE: Map<string, MetricDef> = new Map(METRICS.map((m) => [m.code, m]));

/** 分组编码 -> 定义 */
export const GROUP_BY_CODE: Map<string, MetricGroup> = new Map(METRIC_GROUPS.map((g) => [g.code, g]));

/** 叶子指标编码 -> 所属分组定义（无小计分组也保留归属信息） */
export const GROUP_OF_METRIC: Map<string, MetricGroup> = new Map(
  METRICS.flatMap((m) => {
    const g = METRIC_GROUPS.find((gg) => gg.code === m.group);
    return g ? ([[m.code, g] as const]) : [];
  }),
);

/** 全表总计行的常见叫法（仅同单位表出现） */
export const GRAND_TOTAL_LABELS = ['总计', '合计', '全县合计', '总　计', '合　计'];

/** 备注行起始特征 */
export const NOTE_PREFIXES = ['备注', '注：', '注:', '说明：', '说明:', '附注', '（注', '(注'];

/** 指标行中"其中"引出的子项特征 */
export const SUBITEM_PREFIX = '其中';
