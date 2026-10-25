#!/usr/bin/env node
// stats.mjs — 从 reports/*.md 的 Machine Summary 提取统计
// 用法: node scripts/stats.mjs [PROJECT_ROOT]
// 契约: 解析逻辑在 scripts/lib/data.mjs（schema SoT = modes/evaluate.md）。
// 依赖: 零依赖（仅 node 内置）。

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectReports, loadTrendSnapshot } from './lib/data.mjs';

const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const all = await collectReports(join(root, 'reports'), { includeVoid: true });
// 真实性过滤（ADR-0002）：void（作废/虚构）不参与任何统计；suspect（存疑）保留但显式标记
const voidRows = all.filter(r => r.provenance === 'void');
const rows = all.filter(r => r.provenance !== 'void');
const suspectCount = rows.filter(r => r.provenance === 'suspect').length;

// 关注池趋势视图（context 层，ADR-0004；快照缺失/过期如实提示，不冒充大盘——ADR-0003）
const trend = await loadTrendSnapshot(join(root, 'data', 'trend'), { staleDays: 14 });

if (!rows.length && !voidRows.length && !trend) {
  console.log('reports/ 下没有可解析 Machine Summary 的报告，data/trend/ 下也没有趋势快照。');
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

console.log(`评估报告: ${rows.length} 份${voidRows.length ? `（另有 ${voidRows.length} 份已作废，不参与统计）` : ''}`);
if (suspectCount) console.log(`⚠️  真实性存疑: ${suspectCount} 套（数据未实采核验，结论仅供参考）`);

console.log('\n关注池趋势（context 层，不进评分；采样=关注小区，非城市大盘）:');
if (!trend) {
  console.log('  （无快照——node scripts/trend.mjs build 生成，周度复扫后刷新）');
} else {
  const p = trend.snapshot.pool;
  const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);
  const head = `${trend.stale ? '⚠️ ' : ''}快照 ${trend.date}（${trend.age_days} 天前${trend.stale ? '，>14 天建议复扫刷新' : ''}）`;
  if (!p) console.log(`  ${head} · 暂无已索引小区（全部 not_enough_data）`);
  else console.log(`  ${head} · ${p.n_communities} 个已索引小区 · 近4周 ${pct(p.index_4w)} · 近12周 ${pct(p.index_12w)} · 温度 ${p.temperature ?? '—'} · 右侧 ${p.right_side_weeks} 周`);
  const withTrend = rows.filter(r => r.trend);
  if (withTrend.length) console.log(`  Machine Summary 携带 trend 字段: ${withTrend.length} 份报告`);
}
console.log(`综合评分均分: ${avg}（最高 ${scores.length ? Math.max(...scores).toFixed(1) : '—'}，最低 ${scores.length ? Math.min(...scores).toFixed(1) : '—'}）`);
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
  .forEach(r => console.log(`  ${r.report_no ?? r.file} ${r.community ?? ''} — 综合评分 ${r.score_global}（${r.conclusion ?? ''}）`));
