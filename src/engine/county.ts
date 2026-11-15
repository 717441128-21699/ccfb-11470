/**
 * 县名与行政区划要素提取
 */

/** 语料覆盖的县（虚构县名，避免与真实区划撞名） */
export const COUNTY_NAMES = [
  '青山县', '白云县', '龙泉县', '金凤县', '玉水县', '苍山县', '白鹿县', '栖霞县',
  '临溪县', '望江县', '怀远县', '定远县', '清流县', '宁安县', '太平县', '兴隆县',
  '福海县', '吉安县', '永清县', '长丰县',
];

const COUNTY_SUFFIX_RE = /^[一-龥]{2,8}?(?:县|区|市|旗)$/;

const LABEL_RE = /(?:填报单位|报送单位|编制单位|单位名称|上报单位|地区|县[市别]?名称|填表单位)[：:\s]*([一-龥]{2,12}?(?:县|区|市|旗))/;

/**
 * 从标题/角落文本提取县名。
 * 优先级：显式标签（填报单位：xx县）> 文本中任意带行政区划后缀的专名
 */
export function parseCounty(text: string | null | undefined): string | null {
  if (!text) return null;
  const labeled = LABEL_RE.exec(text);
  if (labeled) return labeled[1];
  // 兜底：找第一个 2~8 个汉字 + 县/区/市/旗 的片段
  const m = /([一-龥]{2,8}?(?:县|区|市|旗))/.exec(text);
  if (m && COUNTY_SUFFIX_RE.test(m[1])) return m[1];
  return null;
}

/** 判断文本是否像县名 */
export function isCountyName(text: string): boolean {
  return COUNTY_SUFFIX_RE.test(text.trim());
}
