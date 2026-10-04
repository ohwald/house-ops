#!/usr/bin/env node
// 把仓库打包成一个自包含的 ClawHub skill 目录。
//
// 为什么需要这一步：`.agents/skills/house-ops/` 下只有一个 SKILL.md，文件里
// 全部指向仓库根的 modes/ scripts/ scrapers/ templates/。ClawHub 的 skill 是
// 文件夹粒度分发（装过去只拿到文件夹内的东西），所以只发 SKILL.md 等于发一个
// 所有路径都失效的空壳。
//
// 打包后的目录结构与仓库根一致（SKILL.md + AGENTS.md + modes/ + scripts/ + …），
// SKILL.md 的 PROJECT_ROOT 解析规则是「向上找同时含 AGENTS.md 和 modes/ 的目录」，
// 脚本层的 ROOT 是 `scripts/` 的上一级——两者都落在 skill 目录本身，无需改路径。
//
// 用法：node scripts/package-skill.mjs [输出目录]

import { rm, mkdir, cp, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(ROOT, '.workbuddy/tmp/clawhub/house-ops');

// 用户层文件（.gitignore 里不入库，含个人信息）绝不进分发包
const USER_LAYER = new Set(['_profile.md', '_custom.md', '_brief.md']);

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function copyDir(rel) {
  const src = join(ROOT, rel);
  if (!(await exists(src))) { console.warn(`  skip ${rel}（不存在）`); return; }
  await cp(src, join(OUT, rel), { recursive: true });
  console.log(`  + ${rel}/`);
}

async function main() {
  console.log(`打包 house-ops → ${OUT}`);
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // 1. 技能入口 + 项目根标识（SKILL.md 的 PROJECT_ROOT 依赖 AGENTS.md）
  await cp(join(ROOT, '.agents/skills/house-ops/SKILL.md'), join(OUT, 'SKILL.md'));
  console.log('  + SKILL.md');
  await cp(join(ROOT, 'AGENTS.md'), join(OUT, 'AGENTS.md'));
  console.log('  + AGENTS.md');

  // 2. modes/：剔除用户层
  await mkdir(join(OUT, 'modes'), { recursive: true });
  let n = 0;
  for (const f of await readdir(join(ROOT, 'modes'))) {
    if (USER_LAYER.has(f)) continue;
    await cp(join(ROOT, 'modes', f), join(OUT, 'modes', f));
    n += 1;
  }
  console.log(`  + modes/ (${n} 个文件，已排除用户层)`);

  // 3. 脚本层与平台模板（scripts/scan.mjs 等 import ../scrapers/_fields.mjs，必须一起带上）
  for (const d of ['scripts', 'scrapers', 'templates', 'docs/markets']) await copyDir(d);

  // 4. 画像模板：仓库入库的是 profile.example.yml，分发包要能被 SKILL.md 直接读到
  await mkdir(join(OUT, 'config'), { recursive: true });
  await cp(join(ROOT, 'config/profile.example.yml'), join(OUT, 'config/profile.yml'));
  console.log('  + config/profile.yml（由 example 复制）');

  // 5. 运行时目录占位：脚本会往里写报告与扫描记录
  for (const d of ['data', 'reports']) {
    await mkdir(join(OUT, d), { recursive: true });
    await cp(join(ROOT, d, '.gitkeep'), join(OUT, d, '.gitkeep')).catch(() => {});
  }
  console.log('  + data/ reports/（空占位）');

  // 6. package.json：只有它才能让 `npm run dashboard`（ink TUI）装依赖后跑起来
  await cp(join(ROOT, 'package.json'), join(OUT, 'package.json'));
  console.log('  + package.json（dashboard 依赖声明）');

  const total = Number((await readdir(OUT, { recursive: true })).filter((f) => !f.includes('/') || true).length);
  console.log(`\n完成：${total} 个条目，输出在 ${OUT}`);
  console.log('发布：clawhub skill publish <目录> --slug house-ops --version <x.y.z>');
}

main().catch((e) => { console.error('⛔', e.message); process.exitCode = 1; });
