#!/usr/bin/env node
// doctor.mjs — 无 AI 环境自检（quick 版；完整检查见 modes/doctor.md）
// 用法: node scripts/doctor.mjs [PROJECT_ROOT]
// 退出码: 0 = 健康（可有 ⚠️），1 = 存在 ⛔ 阻塞项

import { access, readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCAN_SCHEMA, PAGE_TYPES, RELIABILITY } from '../scrapers/_fields.mjs';

const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (level, name, msg) => results.push({ level, name, msg });

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

// 1. 系统层完整性
const sysFiles = [
  'AGENTS.md', 'CLAUDE.md', 'README.md',
  'modes/_shared.md', 'modes/intake.md', 'modes/evaluate.md',
  'modes/deep-dive.md', 'modes/negotiate.md', 'modes/watchlist.md',
  'modes/triage.md', 'modes/compare.md', 'modes/visit.md',
  'modes/contract.md', 'modes/doctor.md', 'modes/stats.md', 'modes/scan.md',
  'templates/policy-notes.cn.yml', 'templates/policy-notes.eu.yml',
  'templates/contract-checklist.cn.yml',
  'templates/official-sources.cn.yml', 'templates/official-sources.eu.yml',
  'config/profile.example.yml',
  'package.json',
  'scripts/reserve-report-num.mjs', 'scripts/doctor.mjs', 'scripts/stats.mjs',
  'scripts/scan.mjs', 'scripts/lib/data.mjs', 'scripts/dashboard.mjs',
  'scripts/map.mjs',
  'scrapers/_registry.mjs', 'scrapers/_fields.mjs', 'scrapers/ADDING_A_PLATFORM.md',
];
for (const f of sysFiles) {
  check((await exists(join(root, f))) ? 'pass' : 'fail', `系统文件 ${f}`, exists ? '' : '缺失');
}

// 2. 技能符号链接
for (const link of ['.claude/skills/house-ops', '.zcode/skills/house-ops']) {
  const p = join(root, link);
  let ok = false;
  try { ok = (await stat(p)).isDirectory() && (await exists(join(p, 'SKILL.md'))); } catch {}
  check(ok ? 'pass' : 'fail', `技能链接 ${link}`, ok ? '' : '不可解析或缺 SKILL.md');
}

// 3. 用户层状态
const profileOk = await exists(join(root, 'config/profile.yml'));
check(profileOk ? 'pass' : 'warn', '需求画像 config/profile.yml',
  profileOk ? '' : '缺失 — 先运行 /house-ops intake');

// 4. 数据一致性：watchlist 编号 vs reports/
const reportsDir = join(root, 'reports');
const reportNums = new Set();
for (const f of await readdir(reportsDir).catch(() => [])) {
  const m = /^(\d{3})-/.exec(f);
  if (m && f.endsWith('.md')) reportNums.add(m[1]);
}
const watchlistPath = join(root, 'data/watchlist.md');
let orphanRows = [];
if (await exists(watchlistPath)) {
  const lines = (await readFile(watchlistPath, 'utf8')).split('\n');
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('---') || line.includes('编号')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    const no = cells[0];
    if (no && !/^\d{3}$/.test(no)) continue;
    if (no && !reportNums.has(no)) orphanRows.push(`${no}（无对应报告）`);
  }
  check(orphanRows.length ? 'warn' : 'pass', 'watchlist 一致性',
    orphanRows.length ? `异常行: ${orphanRows.join('; ')}` : 'watchlist 与报告编号/状态一致');
} else {
  check('warn', 'watchlist', '尚未创建（首次评估时自动生成）');
}

// 5. 政策表时效（中欧两张表都要看）
for (const f of ['templates/policy-notes.cn.yml', 'templates/policy-notes.eu.yml']) {
  try {
    const yml = await readFile(join(root, f), 'utf8');
    const m = /as_of_overview:\s*(\d{4})-(\d{2})-(\d{2})/.exec(yml);
    if (!m) continue;
    const ageDays = Math.floor((Date.now() - new Date(`${m[1]}-${m[2]}-${m[3]}`)) / 86400000);
    check(ageDays > 90 ? 'warn' : 'pass', `政策数据表时效 ${f.replace('templates/', '')}`,
      ageDays > 90 ? `as_of 已 ${ageDays} 天，建议核实更新` : `as_of ${ageDays} 天内`);
  } catch {}
}

// 6. scan schema 一致性：modes/scan.md（SoT 文本）与 _fields.mjs 导出的枚举断言
try {
  const scanDoc = await readFile(join(root, 'modes/scan.md'), 'utf8');
  const missing = [
    SCAN_SCHEMA,
    ...PAGE_TYPES,
    ...RELIABILITY,
  ].filter((token) => !scanDoc.includes(token));
  check(missing.length ? 'fail' : 'pass', 'scan schema 一致性（scan.md ↔ _fields.mjs）',
    missing.length ? `scan.md 缺少 schema token: ${missing.join(', ')}` : '');
} catch (err) {
  check('fail', 'scan schema 一致性', `读取失败: ${err.message}`);
}

// 汇总输出
let fails = 0, warns = 0;
for (const r of results) {
  const icon = r.level === 'pass' ? '✅' : r.level === 'warn' ? '⚠️ ' : '⛔';
  if (r.level === 'fail') fails++;
  if (r.level === 'warn') warns++;
  console.log(`${icon} ${r.name}${r.msg ? ' — ' + r.msg : ''}`);
}
console.log(`\n${fails ? `${fails} 项阻塞，` : ''}${warns ? `${warns} 项建议` : ''}${!fails && !warns ? '环境健康' : ''}`);
process.exit(fails ? 1 : 0);
