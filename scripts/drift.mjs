#!/usr/bin/env node
// drift.mjs — 方向偏离信号判定（只读 CLI，零写入，Node ≥18）
// 口径与实现：scripts/lib/drift.mjs；术语见 GLOSSARY.md；阈值覆盖见 modes/_custom.template.md。
// 用法:
//   node scripts/drift.mjs [--goal <primary_goal>] [--walk-away <万>] [--min-streak N] [--root <dir>]
//
// 不传 --goal / --walk-away 时从 config/profile.yml 读。只读 reports/ 与 data/watchlist.md，
// 不修改任何画像、关注清单或状态文件（ADR-0001）；信号只用于决定是否提问，不进评分。

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectReports, parseWatchlist } from './lib/data.mjs';
import { parseProfile } from './lib/profile.mjs';
import { buildObservations, detectDrift } from './lib/drift.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};

const root = flag('root') ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const profileText = await readFile(join(root, 'config', 'profile.yml'), 'utf8').catch(() => '');
const profile = parseProfile(profileText);

const goal = flag('goal') ?? profile?.intent?.primary_goal ?? '';
const walkAwayRaw = flag('walk-away') ?? profile?.budget?.walk_away_wan ?? null;
const minStreakRaw = flag('min-streak');
const nearRatioRaw = flag('near-ratio');
const thresholds = {
  ...(minStreakRaw === undefined ? {} : { min_streak: Number(minStreakRaw) }),
  ...(nearRatioRaw === undefined ? {} : { budget_near_ratio: Number(nearRatioRaw) }),
};

const reports = await collectReports(join(root, 'reports'));
const watchRows = (await parseWatchlist(join(root, 'data', 'watchlist.md'))) ?? [];
const noteFiles = await readdir(join(root, 'data', 'notes')).catch(() => []);
const observations = buildObservations(reports, watchRows);
const r = detectDrift({
  primary_goal: goal,
  walk_away_wan: walkAwayRaw === null ? null : Number(walkAwayRaw),
  total_range_wan: profile?.budget?.total_range_wan ?? null,
  observations,
  thresholds,
});

console.log(`方向偏离信号（只读，不进评分）· 主诉求 ${r.primary_goal ?? '未定义'} · 样本 ${r.sample_size} 套 · 连续阈值 ${r.min_streak} · 带看记录 ${noteFiles.length} 份（只读上下文，不纳入结构化信号）`);
if (r.status === 'undetermined') {
  console.log(`⛔ 无法判定 — ${r.reason}`);
} else if (r.status === 'aligned') {
  console.log(`✅ 未发现偏离信号 — ${r.reason}`);
} else {
  console.log(`⚠️ 有偏离信号（需人工确认，不等于意图已变）— ${r.reason}`);
  r.signals.forEach((s, i) => {
    console.log(`  信号 ${i + 1} · ${s.kind}`);
    console.log(`    报告 ${s.report_nos.join('/')}：${s.detail}`);
  });
}
console.log(`  ⚠️ ${r.caveat}`);
