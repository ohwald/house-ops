#!/usr/bin/env node
// trend.mjs — 盘口边际趋势 CLI（零依赖）。纯函数引擎见 scripts/lib/trend.mjs；测试面在 selftest，不在本壳。
// 用法:
//   node scripts/trend.mjs build [--corpus <dir>] [--out <dir>] [--today YYYY-MM-DD]
//     重算周度小区指数并落追加式快照（默认 data/scans → data/trend/index-{date}.json；同日重跑覆盖当日文件，不改历史文件）
//   node scripts/trend.mjs show <小区关键词> [--dir <dir>] [--today YYYY-MM-DD]
//     读最新快照输出读数卡（周事件 <3 的小区如实标 not_enough_data）
//   node scripts/trend.mjs backtest [--corpus <dir>] [--today YYYY-MM-DD]
//     校准回测：成交锚点方向 vs 指数方向的比较表（评分/排除显式计数），纯只读不落盘
//   node scripts/trend.mjs band --anchor <锚点值> --samples <n> --index <index_12w> [--factor 0-5] [--badge <徽章>]
//     合理价区间：锚点 × (1 + clamp(指数, ±5%)) ± 个别因素；锚点稀薄/指数缺失时明示退回 crosscheck

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, collectAnchors, calibrate, fairPriceBand, normCommunity, TREND_SCHEMA, TREND_CONSTANTS, TREND_TEMP_LABEL } from './lib/trend.mjs';
import { loadTrendSnapshot } from './lib/data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --const key=value（可重复）：覆盖 TREND_CONSTANTS（modes/_custom.md 声明的覆盖值由此传入）
function constOverrides() {
  const argv = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] !== '--const') continue;
    const [k, v] = String(argv[i + 1] ?? '').split('=');
    if (!(k in TREND_CONSTANTS) || !Number.isFinite(Number(v))) {
      console.error(`⛔ --const ${argv[i + 1]}：键必须 ∈ TREND_CONSTANTS 且值为数字（可选：${Object.keys(TREND_CONSTANTS).join(', ')}）`);
      process.exit(1);
    }
    out[k] = Number(v);
  }
  return out;
}

function flag(name, fallback = null) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i > 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

async function loadCorpus(dir) {
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'));
  const records = [];
  for (const f of files) {
    try { records.push(JSON.parse(await readFile(join(dir, f), 'utf8'))); }
    catch { console.error(`⚠️  跳过无法解析的扫描记录: ${f}`); }
  }
  return records;
}

const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);

function renderCard(c, snap) {
  const lines = [`📈 趋势读数 · ${c.display}${c.district ? `（${c.district}）` : ''}`];
  lines.push(`   as_of ${snap.as_of} · 校准徽章 ${snap.calibration?.badge ?? 'uncalibrated'}`);
  if (c.status !== 'indexed' || (c.index_4w == null && c.index_12w == null)) {
    lines.push(`   状态: not_enough_data——周幅度事件 <3 不产指数（沉默 ≠ 稳定）`);
    lines.push(`   覆盖: 实体 ×${c.coverage.entities} · 采集 ×${c.coverage.captures} 次${c.coverage.first_capture ? ` · ${c.coverage.first_capture} → ${c.coverage.last_capture}` : ''}`);
    lines.push(`   继续按周复扫积累事件；两次采集不构成趋势，三次以上才谈方向。`);
    return lines.join('\n');
  }
  lines.push(`   状态: indexed · 近4周 ${pct(c.index_4w)} · 近12周 ${pct(c.index_12w)} · 温度 ${TREND_TEMP_LABEL[c.temperature] ?? '—'} · 右侧 ${c.right_side_weeks} 周 · 事件(12w) ${c.n_events_12w}`);
  lines.push(`   覆盖: 实体 ×${c.coverage.entities} · 采集 ×${c.coverage.captures} 次 · ${c.coverage.first_capture} → ${c.coverage.last_capture}`);
  lines.push(`   周度指数（周 | 指数% | 幅度事件 | 供给事件）:`);
  for (const w of c.weekly) {
    lines.push(`     ${w.week} | ${w.index == null ? '—' : `${w.index > 0 ? '+' : ''}${w.index}`} | ${w.n_events} | ${w.supply_events}`);
  }
  return lines.join('\n');
}

const [cmd, ...rest] = process.argv.slice(2);
const positional = rest.filter((a) => !a.startsWith('--'));

function renderPoolCard(snap) {
  const p = snap.pool;
  const lines = [`🧺 关注池读数 · ${p.n_communities} 个已索引小区（ADR-0003 聚合封顶：无城市级）`];
  lines.push(`   as_of ${snap.as_of} · 校准徽章 ${snap.calibration?.badge ?? 'uncalibrated'}`);
  lines.push(`   近4周 ${pct(p.index_4w)} · 近12周 ${pct(p.index_12w)} · 温度 ${TREND_TEMP_LABEL[p.temperature] ?? '—'} · 右侧 ${p.right_side_weeks} 周`);
  lines.push(`   周度指数（周 | 指数% | 幅度事件 | 供给事件）:`);
  for (const w of p.weekly) {
    lines.push(`     ${w.week} | ${w.index == null ? '—' : `${w.index > 0 ? '+' : ''}${w.index}`} | ${w.n_events} | ${w.supply_events}`);
  }
  return lines.join('\n');
}

if (cmd === 'build') {
  const corpusDir = flag('corpus', join(ROOT, 'data', 'scans'));
  const outDir = flag('out', join(ROOT, 'data', 'trend'));
  const today = flag('today');
  const records = await loadCorpus(corpusDir);
  if (!records.length) {
    console.log(`📭 ${corpusDir} 下没有扫描记录——趋势指数来自同一小区的多次快照（周度复扫），先跑 scan 采集。`);
    process.exit(0);
  }
  const snap = buildSnapshot(records, { today: today ?? undefined, constants: { ...TREND_CONSTANTS, ...constOverrides() } });
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `index-${snap.as_of}.json`);
  await writeFile(file, `${JSON.stringify(snap, null, 2)}\n`);
  const rows = Object.values(snap.communities);
  console.log(`✅ 快照已写入 ${file}（schema ${TREND_SCHEMA}）`);
  for (const [key, c] of Object.entries(snap.communities)) {
    const head = c.status === 'indexed'
      ? `近4周 ${pct(c.index_4w)} · 近12周 ${pct(c.index_12w)} · ${TREND_TEMP_LABEL[c.temperature] ?? '—'} · 事件(12w) ${c.n_events_12w}`
      : `not_enough_data（实体 ×${c.coverage.entities} · 采集 ×${c.coverage.captures}）`;
    console.log(`  · ${c.display}${c.district ? `（${c.district}）` : ''} — ${head}`);
  }
  if (snap.pool) console.log(`🧺 关注池（${snap.pool.n_communities} 个已索引小区）— 近4周 ${pct(snap.pool.index_4w)} · 近12周 ${pct(snap.pool.index_12w)} · ${TREND_TEMP_LABEL[snap.pool.temperature] ?? '—'}`);
  else console.log('🧺 关注池——暂无已索引小区（全部 not_enough_data）');
  const dists = Object.keys(snap.districts);
  console.log(dists.length ? `🏘 板块级（≥${snap.constants.min_district_communities} 小区才输出）：${dists.join('，')}` : `🏘 板块级——已索引小区未达同板块 ≥${snap.constants.min_district_communities} 个门槛，不输出`);
} else if (cmd === 'backtest') {
  const corpusDir = flag('corpus', join(ROOT, 'data', 'scans'));
  const today = flag('today');
  const records = await loadCorpus(corpusDir);
  if (!records.length) {
    console.log(`📭 ${corpusDir} 下没有扫描记录——校准回测需要含成交锚点（crosscheck）的扫描记录，先跑 scan 采集。`);
    process.exit(0);
  }
  const snap = buildSnapshot(records, { today: today ?? undefined, constants: { ...TREND_CONSTANTS, ...constOverrides() } });
  const r = calibrate(collectAnchors(records), snap.communities, { constants: snap.constants });
  console.log(`🔬 校准回测 · as_of ${snap.as_of} · 徽章 ${r.badge}`);
  console.log(`   评分比较 ${r.n} 次 · 命中 ${r.hits} · 命中率 ${r.hit_rate == null ? '—' : `${(r.hit_rate * 100).toFixed(1)}%`} · 排除：档位不足 ${r.excluded.low_tier} / 无指数重叠 ${r.excluded.no_overlap} / 幅度平坦 ${r.excluded.flat}`);
  for (const c of r.comparisons) {
    console.log(`   ${c.display} | ${c.from} → ${c.to} | 锚点 ${pct(c.anchor_delta_pct)} [${c.tier}] | 指数 ${pct(c.index_cum_pct)} | ${c.result}`);
  }
  if (!r.comparisons.length) console.log('   （暂无比较——评分需要同一小区两个时点的「成交数据」档锚点；锚点稀缺是常态，uncalibrated 是系统在工作）');
} else if (cmd === 'band') {
  const reqNum = (name) => {
    const raw = flag(name);
    const x = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(x)) { console.error(`⛔ --${name} 需要数字（用法见文件头注释）`); process.exit(1); }
    return x;
  };
  const idxRaw = flag('index');
  const badge = flag('badge') ?? 'uncalibrated';
  const b = fairPriceBand({
    anchor_value: reqNum('anchor'),
    anchor_n: reqNum('samples'),
    index_12w: idxRaw == null ? NaN : Number(idxRaw),
    factor_pct: flag('factor') == null ? 0 : Number(flag('factor')),
  });
  if (!b.ok) {
    const why = b.reason === 'thin_anchor' ? `锚点样本 ${b.anchor_n} < ${b.min}——区间不可信`
      : b.reason === 'no_index' ? '趋势指数 not_enough_data（周事件 <3）' : '锚点值无效';
    console.log(`⛔ 不出区间（${why}）——退回 crosscheck 结论并在报告/话术中明示，不硬造区间。`);
    process.exit(0);
  }
  console.log(`🎯 合理价区间 · 锚点 ${b.anchor_value}（n=${b.anchor_n}）· 趋势调整 ${pct(b.trend_adj_pct)}（近12周 ${pct(b.index_12w)}，封顶 ±5%）· 个别因素 ±${b.factor_pct}%`);
  console.log(`   中枢 ${b.center} · 区间 [${b.low}, ${b.high}]（与锚点同单位，建议单价口径 元/㎡）`);
  console.log(`   校准徽章 ${badge}——negotiate 引用区间时必须携带；本区间叠加在 crosscheck 结论之上，不替换。`);
} else if (cmd === 'show') {
  const keyword = positional[0];
  const dir = flag('dir', join(ROOT, 'data', 'trend'));
  const today = flag('today');
  if (!keyword && !rest.includes('--pool')) {
    console.error('用法: node scripts/trend.mjs show <小区关键词 | --pool>（先跑 build 生成快照）');
    process.exit(1);
  }
  const found = await loadTrendSnapshot(dir, { today });
  if (!found) {
    console.log(`📭 ${dir} 下还没有趋势快照——先跑 node scripts/trend.mjs build。`);
    process.exit(0);
  }
  const { snapshot: snap } = found;
  if (rest.includes('--pool')) {
    console.log(snap.pool ? renderPoolCard(snap) : '🧺 关注池——暂无已索引小区（全部 not_enough_data），先按周复扫积累事件。');
    process.exit(0);
  }
  const nk = normCommunity(keyword);
  const hit = Object.entries(snap.communities)
    .filter(([key, c]) => key.includes(nk) || normCommunity(c.display).includes(nk));
  if (!hit.length) {
    console.log(`未找到匹配「${keyword}」的小区（快照 as_of ${snap.as_of}，现有：${Object.values(snap.communities).map((c) => c.display).join('，') || '无'}）。`);
    process.exitCode = 2;
  } else {
    for (const [, c] of hit) console.log(renderCard(c, snap));
  }
} else {
  console.error('用法: node scripts/trend.mjs <build|show|backtest|band> …（详见本文件头注释与 modes/scan.md）');
  process.exit(1);
}
