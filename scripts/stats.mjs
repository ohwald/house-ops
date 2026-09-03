#!/usr/bin/env node
// stats.mjs — 从 reports/*.md 的 Machine Summary 提取统计
// 用法: node scripts/stats.mjs [PROJECT_ROOT]
// 契约: 解析逻辑在 scripts/lib/data.mjs（schema SoT = modes/evaluate.md）。
// 依赖: 零依赖（仅 node 内置）。

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectReports } from './lib/data.mjs';

const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const rows = await collectReports(join(root, 'reports'));

if (!rows.length) {
  console.log('reports/ 下没有可解析 Machine Summary 的报告。');
  process.exit(0);
}

// 总览
const byConclusion = {};
for (const r of rows) byConclusion[r.conclusion ?? 'unknown'] = (byConclusion[r.conclusion ?? 'unknown'] ?? 0) + 1;

const scores = rows.map(r => r.score_global).filter(v => typeof v === 'number');
const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : '—';

// 低分维度排行（<3 计一次）
const weakDims = {};
for (const r of rows) {
  for (const d of ['score_fit', 'score_price', 'score_location', 'score_property', 'score_risk']) {
    if (typeof r[d] === 'number' && r[d] < 3) weakDims[d] = (weakDims[d] ?? 0) + 1;
  }
}

console.log(`已评估: ${rows.length} 套`);
console.log(`Global 均分: ${avg}（最高 ${scores.length ? Math.max(...scores).toFixed(1) : '—'}，最低 ${scores.length ? Math.min(...scores).toFixed(1) : '—'}）`);
console.log('结论分布:', JSON.stringify(byConclusion, null, 2));

const district = {};
for (const r of rows) {
  const k = r.district || '未知板块';
  district[k] ??= [];
  district[k].push(r.score_global);
}
console.log('\n板块分布:');
for (const [k, v] of Object.entries(district)) {
  const a = (v.reduce((x, y) => x + y, 0) / v.length).toFixed(1);
  console.log(`  ${k}: ${v.length} 套, 均分 ${a}`);
}

console.log('\n低分维度排行（<3 分计数）:');
const sorted = Object.entries(weakDims).sort((a, b) => b[1] - a[1]);
if (!sorted.length) console.log('  （无）');
for (const [k, n] of sorted) console.log(`  ${k}: ${n} 套`);

console.log('\nTop 3 房源:');
[...rows].sort((a, b) => (b.score_global ?? 0) - (a.score_global ?? 0)).slice(0, 3)
  .forEach(r => console.log(`  ${r.report_no ?? r.file} ${r.community ?? ''} — Global ${r.score_global}（${r.conclusion ?? ''}）`));
