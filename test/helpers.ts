/**
 * 测试公共工具：读取 corpus 中的 xlsx 与标准答案，跑引擎全流程
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkbook } from '../src/engine/grid';
import { parseWorkbook } from '../src/engine/parser';
import type { AnswerFile, AnswerRecord, CorpusManifest } from '../tools/answer-types';
import type { LongRecord } from '../src/engine/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CORPUS_DIR = path.join(ROOT, 'corpus');

export function loadManifest(): CorpusManifest {
  return JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'manifest.json'), 'utf8'));
}

export function loadAnswer(fileName: string): AnswerFile {
  return JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, `${fileName}.answer.json`), 'utf8'));
}

export interface ParsedCorpusFile {
  answer: AnswerFile;
  records: LongRecord[];
  warnings: string[];
  tables: ReturnType<typeof parseWorkbook>['tables'];
  unmapped: ReturnType<typeof parseWorkbook>['unmapped'];
}

/** 解析语料中的一个 xlsx（直接读字节，模拟浏览器 File.arrayBuffer） */
export function parseCorpusFile(fileName: string): ParsedCorpusFile {
  const buffer = fs.readFileSync(path.join(CORPUS_DIR, fileName));
  const sheets = loadWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const result = parseWorkbook(sheets, fileName);
  const answer = loadAnswer(fileName);
  return {
    answer,
    records: result.records,
    warnings: result.warnings,
    tables: result.tables,
    unmapped: result.unmapped,
  };
}

export function nearlyEqual(a: number, b: number, tol = 0.05): boolean {
  return Math.abs(a - b) <= tol;
}

/**
 * 单元格级匹配：以答案 cell 坐标为基准，在引擎长表记录里找同一 (sheet,row,col)
 * 且指标/时期/县名/行类型一致的记录，再比对数值。
 * 一个单元格可能对应多条记录（多表同坐标），全部要匹配上。
 */
export interface CellMatchStats {
  total: number;
  matched: number;
  missing: AnswerRecord[];
  wrongValue: { expected: AnswerRecord; got: LongRecord }[];
  wrongKind: { expected: AnswerRecord; got: LongRecord }[];
}

interface RecordKey {
  sheet: string;
  row: number;
  col: number;
  metricCode: string;
  period: string;
  county: string;
  rowKind: string;
}

const keyOf = (sheet: string, r: number, c: number, metric: string, period: string, county: string, kind: string): RecordKey => ({
  sheet, row: r, col: c, metricCode: metric, period, county, rowKind: kind,
});

export function matchCells(parsed: ParsedCorpusFile): CellMatchStats {
  const stats: CellMatchStats = { total: 0, matched: 0, missing: [], wrongValue: [], wrongKind: [] };
  const gotMap = new Map<string, LongRecord[]>();
  for (const rec of parsed.records) {
    const k = JSON.stringify(
      keyOf(rec.sheetName, rec.row, rec.col, rec.metricCode, rec.period, rec.county, rec.rowKind),
    );
    const arr = gotMap.get(k) ?? [];
    arr.push(rec);
    gotMap.set(k, arr);
  }

  for (const expected of parsed.answer.records) {
    stats.total++;
    const k = JSON.stringify(
      keyOf(
        expected.sheet,
        expected.cell.row,
        expected.cell.col,
        expected.metricCode,
        expected.period,
        expected.county,
        expected.rowKind,
      ),
    );
    const candidates = gotMap.get(k);
    if (!candidates || candidates.length === 0) {
      stats.missing.push(expected);
      continue;
    }
    const got = candidates.shift()!;
    let ok = true;
    if (got.rowKind !== expected.rowKind) {
      stats.wrongKind.push({ expected, got });
      ok = false;
    }
    if (expected.value === null) {
      if (got.value !== null) ok = false;
    } else if (got.value === null || !nearlyEqual(got.value, expected.value, 0.05)) {
      stats.wrongValue.push({ expected, got });
      ok = false;
    }
    if (ok) stats.matched++;
  }
  return stats;
}
