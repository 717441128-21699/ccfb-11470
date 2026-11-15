import type { LongRecord, SummaryResult, SummaryRow } from './types';
import { GROUP_BY_CODE, METRIC_BY_CODE } from './standards';
import { nearlyEqual } from './numbers';

interface GroupAcc {
  groupCode: string;
  period: string;
  unit: string | null;
  /** 组内各成员指标编码（代表指标取第一个） */
  members: string[];
  summed: number;
  selfReported: number;
  hasSelf: boolean;
  /** 按 县×文件×块×时期 分组记账，逐表对账 */
  sourceSum: Map<string, number>;
  sourceSelf: Map<string, number>;
  dataKeys: Set<string>;
  selfKeys: Set<string>;
  counties: Set<string>;
}

/**
 * 汇总对账（按 分组×时期 聚合，逐来源表判断自洽）：
 * - summed       组内所有成员指标的明细加总
 * - selfReported 各县自报的分组小计
 * mismatch 仅当任一来源表的本组明细与小计不符（篡改高亮即源于此）。
 */
export function summarize(records: LongRecord[]): SummaryResult {
  const groupMap = new Map<string, GroupAcc>();

  const metricToGroup = new Map<string, string>();
  for (const g of GROUP_BY_CODE.values()) for (const code of g.members) metricToGroup.set(code, g.code);

  const accOf = (groupCode: string, period: string, unit: string | null, members: string[]): GroupAcc => {
    const key = `${groupCode}|${period}`;
    let acc = groupMap.get(key);
    if (!acc) {
      acc = {
        groupCode,
        period,
        unit,
        members,
        summed: 0,
        selfReported: 0,
        hasSelf: false,
        sourceSum: new Map(),
        sourceSelf: new Map(),
        dataKeys: new Set(),
        selfKeys: new Set(),
        counties: new Set(),
      };
      groupMap.set(key, acc);
    }
    return acc;
  };

  const fingerprint = (rec: LongRecord): string =>
    `${rec.county}|${rec.sourceFile}|${rec.sheetName}|${rec.blockId}|${rec.row}|${rec.col}`;
  const sourceKey = (rec: LongRecord): string =>
    `${rec.county}|${rec.sourceFile}|${rec.blockId}|${rec.period}`;

  for (const rec of records) {
    if (rec.value === null) continue;
    const groupCode = rec.groupCode ?? metricToGroup.get(rec.metricCode);
    if (!groupCode) continue;
    const group = GROUP_BY_CODE.get(groupCode)!;
    const acc = accOf(groupCode, rec.period, rec.unit, group.members);
    acc.counties.add(rec.county);
    const sk = sourceKey(rec);

    if (rec.rowKind === 'data') {
      const fp = fingerprint(rec);
      if (!acc.dataKeys.has(fp)) {
        acc.dataKeys.add(fp);
        acc.summed += rec.value;
        acc.sourceSum.set(sk, (acc.sourceSum.get(sk) ?? 0) + rec.value);
      }
      continue;
    }

    if (rec.rowKind === 'subtotal') {
      const fp = fingerprint(rec);
      if (!acc.selfKeys.has(fp)) {
        acc.selfKeys.add(fp);
        acc.selfReported += rec.value;
        acc.hasSelf = true;
        acc.sourceSelf.set(sk, (acc.sourceSelf.get(sk) ?? 0) + rec.value);
      }
    }
  }

  const rows: SummaryRow[] = [];
  for (const acc of groupMap.values()) {
    let mismatch = false;
    for (const [sk, selfVal] of acc.sourceSelf) {
      const sumVal = acc.sourceSum.get(sk) ?? 0;
      if (!nearlyEqual(sumVal, selfVal, 0.02)) mismatch = true;
    }
    const repCode = acc.members[0];
    const groupName = GROUP_BY_CODE.get(acc.groupCode)?.name ?? repCode;
    rows.push({
      metricCode: repCode,
      metricName: groupName,
      unit: acc.unit,
      period: acc.period,
      summedValue: round4(acc.summed),
      selfReportedValue: acc.hasSelf ? round4(acc.selfReported) : null,
      diff: acc.hasSelf ? round4(acc.summed - acc.selfReported) : null,
      mismatch,
      contributingCounties: acc.counties.size,
    });
  }

  rows.sort((a, b) =>
    a.period === b.period
      ? a.metricCode.localeCompare(b.metricCode)
      : a.period.localeCompare(b.period),
  );
  return { rows, countyTotals: records.filter((r) => r.rowKind === 'subtotal') };
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

void METRIC_BY_CODE;
