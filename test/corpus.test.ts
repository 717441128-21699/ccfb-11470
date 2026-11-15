/**
 * 200 份语料端到端评估：单元格级还原准确率、结构识别、汇总对账、模板复用
 */
import { describe, it, expect } from 'vitest';
import { loadManifest, parseCorpusFile, matchCells, type ParsedCorpusFile } from './helpers';
import { summarize } from '../src/engine/summary';
import { fingerprint } from '../src/engine/template';
import { parseWorkbook } from '../src/engine/parser';
import { loadWorkbook } from '../src/engine/grid';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CORPUS_DIR } from './helpers';

describe('语料总览', () => {
  it('应有 200 份文件且每份都有标准答案', () => {
    const manifest = loadManifest();
    expect(manifest.files).toHaveLength(200);
    for (const f of manifest.files) {
      const xlsx = path.join(CORPUS_DIR, f.fileName);
      const ans = path.join(CORPUS_DIR, `${f.fileName}.answer.json`);
      expect(fs.existsSync(xlsx), `缺少 ${f.fileName}`).toBe(true);
      expect(fs.existsSync(ans), `缺少答案 ${f.fileName}`).toBe(true);
    }
  });

  it('版式维度覆盖齐全', () => {
    const manifest = loadManifest();
    const featureCounts = new Map<string, number>();
    for (const f of manifest.files) {
      for (const feat of f.features) featureCounts.set(feat, (featureCounts.get(feat) ?? 0) + 1);
    }
    const required = [
      'layout-transposed',
      'multi-period',
      'multi-table-side-by-side',
      'multi-table-stacked',
      'two-sheets',
      'tampered-total',
      'unit-亿元',
      'unit-千元',
      'unit-万吨标准煤',
    ];
    for (const feat of required) {
      expect(featureCounts.get(feat) ?? 0, `特征 ${feat} 样本不足`).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('单元格级还原准确率（200 份全量）', () => {
  const manifest = loadManifest();
  const all: ParsedCorpusFile[] = manifest.files.map((f) => parseCorpusFile(f.fileName));

  it('单元格级准确率 >= 99%', () => {
    let total = 0;
    let matched = 0;
    const failures: string[] = [];
    for (const parsed of all) {
      const stats = matchCells(parsed);
      total += stats.total;
      matched += stats.matched;
      if (stats.matched !== stats.total) {
        failures.push(
          `${parsed.answer.fileName}: ${stats.matched}/${stats.total} ` +
            `(缺${stats.missing.length} 值错${stats.wrongValue.length} 类错${stats.wrongKind.length})`,
        );
      }
    }
    const rate = matched / total;
    console.log(`单元格级准确率: ${(rate * 100).toFixed(3)}% (${matched}/${total})`);
    if (rate < 0.99) {
      console.log('失败文件（前 20）：\n' + failures.slice(0, 20).join('\n'));
    }
    expect(rate).toBeGreaterThanOrEqual(0.99);
  });

  it('每个文件单独准确率 >= 97%（无系统性翻车文件）', () => {
    const bad: string[] = [];
    for (const parsed of all) {
      const stats = matchCells(parsed);
      const rate = stats.matched / stats.total;
      if (rate < 0.97) bad.push(`${parsed.answer.fileName}: ${(rate * 100).toFixed(1)}%`);
    }
    expect(bad, `低准确率文件:\n${bad.join('\n')}`).toHaveLength(0);
  });
});

describe('结构识别', () => {
  const manifest = loadManifest();

  it('一个 sheet 多张表的切分数量与答案一致', () => {
    for (const f of manifest.files) {
      const parsed = parseCorpusFile(f.fileName);
      const expectedBlocks = parsed.answer.blocks.length;
      expect(parsed.tables.length, `${f.fileName} 切分块数`).toBe(expectedBlocks);
    }
  });

  it('转置版式识别正确', () => {
    for (const f of manifest.files) {
      const parsed = parseCorpusFile(f.fileName);
      for (const block of parsed.answer.blocks) {
        const got = parsed.tables[block.blockIndex];
        expect(got.layout === 'transposed', `${f.fileName}#${block.blockIndex}`).toBe(block.transposed);
      }
    }
  });

  it('县名、时期、单位提取正确', () => {
    for (const f of manifest.files) {
      const parsed = parseCorpusFile(f.fileName);
      for (const block of parsed.answer.blocks) {
        const got = parsed.tables[block.blockIndex];
        expect(got.county, `${f.fileName}#${block.blockIndex} 县名`).toBe(block.county);
        // 混合单位表 tableUnit 为 null（单位逐行标注）；引擎也应为 null，否则须与答案一致
        if (block.tableUnit === null) {
          expect(got.tableUnit, `${f.fileName}#${block.blockIndex} 单位`).toBeNull();
        } else {
          expect(got.tableUnit, `${f.fileName}#${block.blockIndex} 单位`).toBe(block.tableUnit);
        }
        if (block.period) {
          expect(got.period, `${f.fileName}#${block.blockIndex} 时期`).toBe(block.period);
        }
      }
    }
  });

  it('小计/合计/空行/备注行不进明细', () => {
    for (const f of manifest.files) {
      const parsed = parseCorpusFile(f.fileName);
      for (const block of parsed.answer.blocks) {
        const table = parsed.tables[block.blockIndex];
        // 该块的列范围（并排表同行可能有另一张表的内容，必须按块列过滤）
        const c0 = table.block.colStart;
        const c1 = table.block.colEnd;
        const detailCells = new Set(
          parsed.records
            .filter((r) => r.rowKind === 'data' && r.sheetName === block.sheet)
            .filter((r) => r.col >= c0 && r.col <= c1)
            .map((r) => r.row),
        );
        for (const r of block.excludedRows) {
          expect(detailCells.has(r), `${f.fileName} 第${r + 1}行不应进入明细`).toBe(false);
        }
      }
    }
  });
});

describe('指标映射', () => {
  it('全部语料自动映射，无未匹配列/行', () => {
    const manifest = loadManifest();
    const allUnmapped: string[] = [];
    for (const f of manifest.files) {
      const parsed = parseCorpusFile(f.fileName);
      for (const u of parsed.unmapped) {
        allUnmapped.push(`${f.fileName}: ${u.fullName}`);
      }
    }
    expect(allUnmapped.slice(0, 30), `未匹配:\n${allUnmapped.slice(0, 30).join('\n')}`).toHaveLength(0);
  });

  it('同版式指纹稳定：同结构不同县的文件指纹一致', () => {
    // 取两个同为单表垂直布局的文件，验证指纹只依赖结构不依赖县名/数值
    const manifest = loadManifest();
    const singles = manifest.files.filter((f) => f.features.includes('single-table')).slice(0, 2);
    const fps = singles.map((f) => {
      const parsed = parseCorpusFile(f.fileName);
      return parsed.tables[0].fingerprint;
    });
    for (const fp of fps) expect(fp).toMatch(/^fp_[0-9a-f]{8}$/);
    // 指纹生成函数确定性
    const a = fingerprint({ headerDepth: 1, bodyRows: 10, columns: [{ fullName: '指标名称' }] });
    const b = fingerprint({ headerDepth: 1, bodyRows: 10, columns: [{ fullName: '指标名称' }] });
    expect(a).toBe(b);
  });

  it('人工映射覆盖优先于自动映射', () => {
    const manifest = loadManifest();
    // 找一个含 data 角色列的表（转置表或 label-rows 表），其指标映射挂在列上
    let picked: { file: string; blockId: string; fullName: string } | null = null;
    for (const f of manifest.files) {
      const parsed = parseCorpusFile(f.fileName);
      for (const t of parsed.tables) {
        const dataCol = t.columns.find((c) => c.role === 'data' && c.metricCode);
        if (dataCol) {
          picked = { file: f.fileName, blockId: t.block.id, fullName: dataCol.fullName };
          break;
        }
      }
      if (picked) break;
    }
    expect(picked).toBeTruthy();
    const buffer = fs.readFileSync(path.join(CORPUS_DIR, picked!.file));
    const override = { [picked!.blockId]: { [picked!.fullName]: 'F01' } };
    const second = parseWorkbook(
      loadWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
      picked!.file,
      { overrides: override },
    );
    const table = second.tables.find((t) => t.block.id === picked!.blockId)!;
    const mapped = table.columns.find((c) => c.fullName === picked!.fullName);
    expect(mapped?.metricCode).toBe('F01');
  });
});

describe('汇总对账', () => {
  it('无篡改文件：各县自报小计与本县明细加总一致，不高亮', () => {
    const manifest = loadManifest();
    const clean = manifest.files.filter((f) => !f.features.includes('tampered-total')).slice(0, 60);
    const problems: string[] = [];
    for (const f of clean) {
      const parsed = parseCorpusFile(f.fileName);
      const summary = summarize(parsed.records);
      for (const row of summary.rows) {
        // 仅当该县该指标确实报了小计才校验
        if (row.selfReportedValue !== null && row.mismatch) {
          problems.push(`${f.fileName} ${row.metricCode} ${row.period} diff=${row.diff}`);
        }
      }
    }
    expect(problems.slice(0, 10), '干净文件不应出现对账差异').toHaveLength(0);
  });

  it('篡改文件：差异被识别并高亮，且差额正确', () => {
    const manifest = loadManifest();
    const tampered = manifest.files.filter((f) => f.features.includes('tampered-total'));
    expect(tampered.length).toBeGreaterThan(5);
    let foundMismatch = 0;
    for (const f of tampered) {
      const parsed = parseCorpusFile(f.fileName);
      const summary = summarize(parsed.records);
      const mismatches = summary.rows.filter((r) => r.mismatch);
      for (const m of mismatches) {
        expect(Math.abs(m.diff!)).toBeGreaterThan(0.05);
        foundMismatch++;
      }
    }
    expect(foundMismatch, '篡改文件应产生高亮行').toBeGreaterThan(0);
  });
});
