/**
 * 单位识别与换算。
 * 标准单位以指标字典为准（万元 / 元 / 吨标准煤），县级怪写法先归一、再换算。
 */

/** 单位族：同族之间才可换算 */
type UnitFamily = 'money' | 'energy';

interface UnitSpec {
  /** 规范名 */
  canon: string;
  family: UnitFamily;
  /** 相对族内基准单位的倍数：money 基准=元，energy 基准=吨标准煤 */
  factorToBase: number;
  /** 匹配别名（含简写、不规范写法） */
  patterns: RegExp;
}

const UNIT_SPECS: UnitSpec[] = [
  // 注意顺序：长串先匹配（万吨标准煤 优先于 吨标准煤）
  { canon: '万吨标准煤', family: 'energy', factorToBase: 10000, patterns: /万吨标准煤|万吨标煤/ },
  { canon: '吨标准煤', family: 'energy', factorToBase: 1, patterns: /吨标准煤|吨标煤/ },
  { canon: '千克标准煤', family: 'energy', factorToBase: 0.001, patterns: /千克标准煤|千克标煤|公斤标准煤|公斤标煤/ },

  { canon: '亿元', family: 'money', factorToBase: 1e8, patterns: /亿元/ },
  { canon: '万元', family: 'money', factorToBase: 1e4, patterns: /万元/ },
  { canon: '千元', family: 'money', factorToBase: 1e3, patterns: /千元/ },
  { canon: '元', family: 'money', factorToBase: 1, patterns: /(?:人民币)?元(?![素气])/ },
];

/** 从任意文本里抽取第一个出现的单位（如 "单位：万元"、"产值（万元）"） */
export function extractUnit(text: string | null | undefined): string | null {
  if (!text) return null;
  // 先按 "单位：xxx" 形式取
  const labeled = /单位[：: ]*\s*([^\s，,。；;（）()]+)/.exec(text);
  const source = labeled ? labeled[1] : text;
  for (const spec of UNIT_SPECS) {
    if (spec.patterns.test(source)) return spec.canon;
  }
  return null;
}

function specOf(canon: string): UnitSpec | undefined {
  return UNIT_SPECS.find((u) => u.canon === canon);
}

/**
 * 数值从 fromUnit 换算到 toUnit 的乘数；不同族或未知单位返回 null（调用方保留原值并告警）
 */
export function conversionFactor(fromUnit: string, toUnit: string): number | null {
  const a = specOf(fromUnit);
  const b = specOf(toUnit);
  if (!a || !b) return null;
  if (a.family !== b.family) return null;
  return a.factorToBase / b.factorToBase;
}

/** 执行换算；无法换算时返回原值 */
export function convertValue(value: number, fromUnit: string | null, toUnit: string | null): number {
  if (!fromUnit || !toUnit || fromUnit === toUnit) return value;
  const f = conversionFactor(fromUnit, toUnit);
  return f === null ? value : value * f;
}

/** 两单位是否同族可换算 */
export function isCompatibleUnit(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  if (a === b) return true;
  return conversionFactor(a, b) !== null;
}
