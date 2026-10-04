#!/usr/bin/env node
// 把仓库打包成一个自包含的 ClawHub skill 目录。
//
// 为什么需要这一步：ClawHub 按文件夹粒度分发 skill——装过去只拿到文件夹内的东西。
// `.agents/skills/house-ops/` 现在自带指向仓库根的软链（modes/ scripts/ scrapers/
// templates/ config/ docs/ data/ reports/ package.json），所以复制它并展开软链
// （cp 的 dereference）就已经是完整的实现层，与 `npx skills add` 装出来的形态一致。
//
// 与直接复制的区别只有两点，都是 ClawHub 形态的增益：
//   - 补一份 AGENTS.md（自然语言路由表）；skills CLI 形态没有它，SKILL.md 已声明降级；
//   - config/profile.yml 由 example 生成，data/ reports/ 清空为占位——本地这几处
//     含真实画像与看房记录，绝不能进分发包。
//
// 用法：node scripts/package-skill.mjs [输出目录]

import { rm, mkdir, cp, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(ROOT, '.workbuddy/tmp/clawhub/house-ops');

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function main() {
  console.log(`打包 house-ops → ${OUT}`);
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // 1. 技能目录本体：软链展开为实体目录，得到与仓库同构的自包含副本
  const skillDir = join(ROOT, '.agents/skills/house-ops');
  if (!(await exists(join(skillDir, 'SKILL.md')))) throw new Error('缺少 .agents/skills/house-ops/SKILL.md');
  await cp(skillDir, OUT, { recursive: true, dereference: true });
  console.log('  + SKILL.md 与实现层（软链已展开为实体）');

  // 2. 项目根标识：分发副本缺它就没有自然语言路由（skills CLI 形态同样没有）
  await cp(join(ROOT, 'AGENTS.md'), join(OUT, 'AGENTS.md'));
  console.log('  + AGENTS.md');

  // 3. 清掉任何本地残留的用户数据，再放干净的占位/模板
  for (const d of ['data', 'reports']) {
    await rm(join(OUT, d), { recursive: true, force: true });
    await mkdir(join(OUT, d), { recursive: true });
  }
  console.log('  + data/ reports/（清空为占位，不含本地记录）');

  await rm(join(OUT, 'config/profile.yml'), { force: true });
  await mkdir(join(OUT, 'config'), { recursive: true });
  await cp(join(ROOT, 'config/profile.example.yml'), join(OUT, 'config/profile.yml'));
  console.log('  + config/profile.yml（由 example 生成）');

  for (const f of ['_profile.md', '_custom.md', '_brief.md']) {
    await rm(join(OUT, 'modes', f), { force: true });
  }
  console.log('  + modes/（已剔除用户层 _profile/_custom/_brief）');

  const total = (await readdir(OUT, { recursive: true })).length;
  console.log(`\n完成：${total} 个条目，输出在 ${OUT}`);
  console.log('发布：clawhub skill publish <目录> --slug house-ops --version <x.y.z>');
}

main().catch((e) => { console.error('⛔', e.message); process.exitCode = 1; });
