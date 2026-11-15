import { describe, it, expect } from 'vitest';
import { normalizeText, matchScore, levenshtein, toHalfWidth, extractParenthetical } from '../src/engine/text-utils';
import { parseNumber } from '../src/engine/numbers';
import { parsePeriod, findPeriodInText } from '../src/engine/period';
import { extractUnit, conversionFactor, convertValue } from '../src/engine/units';
import { parseCounty } from '../src/engine/county';
import { matchMetric, exactLookup } from '../src/engine/mapper';
import { isGrandTotalLabel, matchSubtotal } from '../src/engine/row-classifier';

describe('文本规范化', () => {
  it('全角转半角、去空白、去括号', () => {
    expect(toHalfWidth('Ｑ３　１２３')).toBe('Q3 123');
    expect(normalizeText(' 农业 产值（现价） ')).toBe('农业产值');
    expect(normalizeText('规上工业，总产值')).toBe('规上工业总产值');
  });

  it('括号内容提取', () => {
    expect(extractParenthetical('产值（万元）')).toEqual(['万元']);
    expect(extractParenthetical('a【注1】b(2)')).toEqual(['注1', '2']);
  });

  it('编辑距离与相似度', () => {
    expect(levenshtein('农业产值', '农业产值')).toBe(0);
    expect(levenshtein('农业产值', '林业产值')).toBe(1);
    expect(matchScore('农业产值', '农业总产值')).toBeGreaterThan(0.78);
    expect(matchScore('完全不同的东西', '固定资产投资完成额')).toBeLessThan(0.5);
  });
});

describe('数值解析', () => {
  it('数字、千分位文本、缺失记号', () => {
    expect(parseNumber(1234)).toBe(1234);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('１２３')).toBe(123);
    expect(parseNumber('-')).toBeNull();
    expect(parseNumber('…')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });
});

describe('时期解析', () => {
  it('各种季度写法归一', () => {
    expect(parsePeriod('2026年第三季度')?.period).toBe('2026Q3');
    expect(parsePeriod('2026Q1')?.period).toBe('2026Q1');
    expect(parsePeriod('2026年1-3月')?.period).toBe('2026Q1');
    expect(parsePeriod('2026年10-12月')?.period).toBe('2026Q4');
    expect(parsePeriod('三季度', 2026)?.period).toBe('2026Q3');
  });

  it('从角落/标题文本中找时期', () => {
    expect(findPeriodInText('青山县2026年三季度主要经济指标表')?.period).toBe('2026Q3');
    expect(findPeriodInText('无时期文本')).toBeNull();
  });
});

describe('单位识别与换算', () => {
  it('单位提取', () => {
    expect(extractUnit('单位：万元')).toBe('万元');
    expect(extractUnit('2026年三季度（亿元）')).toBe('亿元');
    expect(extractUnit('无单位文本')).toBeNull();
  });

  it('同族换算', () => {
    expect(conversionFactor('亿元', '万元')).toBe(10000);
    expect(convertValue(3.5, '亿元', '万元')).toBe(35000);
    expect(convertValue(12000, '万元', '亿元')).toBe(1.2);
    expect(convertValue(2, '万吨标准煤', '吨标准煤')).toBe(20000);
    // 异族不可换算：返回原值
    expect(convertValue(100, '万元', '元')).toBe(1000000);
  });
});

describe('县名提取', () => {
  it('标签形式与裸县名', () => {
    expect(parseCounty('填报单位：青山县')).toBe('青山县');
    expect(parseCounty('白云县2026年统计报表')).toBe('白云县');
    expect(parseCounty('无县名文本')).toBeNull();
  });
});

describe('指标映射', () => {
  it('标准名与别名精确命中', () => {
    expect(exactLookup('农业产值')?.code).toBe('A01');
    expect(exactLookup('社零总额')?.code).toBe('D01');
    expect(exactLookup('规上工业')?.code).toBe('B01');
  });

  it('模糊命中带括号/空格的怪写法', () => {
    const r = matchMetric('农林牧渔专业及辅助性活动产值');
    expect(r.metric?.code).toBe('A05');
    const r2 = matchMetric('社会消费品零售总额（万元）');
    expect(r2.metric?.code).toBe('D01');
  });
});

describe('行分类标签', () => {
  it('总计/小计识别', () => {
    expect(isGrandTotalLabel('总计')).toBe(true);
    expect(isGrandTotalLabel('全县合计')).toBe(true);
    expect(isGrandTotalLabel('普通指标行')).toBe(false);
    expect(matchSubtotal('工业总产值')).toBe('G2');
    expect(matchSubtotal('投资小计')).toBe('G3');
    expect(matchSubtotal('农业产值')).toBeNull();
  });
});
