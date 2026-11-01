#!/usr/bin/env node
// wb-setup.mjs — 把可写状态（data/、reports/、config/profile.yml）外置到 DATA_ROOT。
//
// 存在理由：技能市场装出来的技能目录（~/.workbuddy/skills/house-ops）会被版本更新整体覆盖。
// 报告、画像、带看记录写在里面，升级一次就没了。外置到 DATA_ROOT 后原地只留软链，脚本与 mode
// 文件的相对路径全部照旧，零改动。
//
// 只在「受管安装形态」下动作：PROJECT_ROOT 有 .git/ 说明是仓库形态，data/ reports/ 本来就是
// 用户层、升级不会覆盖，直接跳过（也避免把开发者的仓库改出软链）。
//
// 安全边界：不删除任何东西。原目录一律改名成 *.bak-<时间戳> 保留；建不了软链（Windows 无权限）
// 就回滚并如实告警，绝不留下半套结构。
//
// 用法: node scripts/wb-setup.mjs [PROJECT_ROOT]
// 退出码: 0 = 已外置 / 本来就不需要 / 已是最新；1 = 建链失败已回滚

import { access, cp, mkdir, rename, stat, lstat, symlink, readlink, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const DATA_ROOT = resolve(process.env.HOUSE_OPS_DATA ?? join(homedir(), 'house-ops-data'));
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function isSymlink(p) {
  // 用 lstat：断链的软链 stat 会抛，那样会被误判成"不存在"然后重复建链
  const st = await lstat(p).catch(() => null);
  return st ? st.isSymbolicLink() : false;
}

// 已正确指向 DATA_ROOT 的软链：什么都不做
async function alreadyLinked(link, target) {
  if (!(await isSymlink(link))) return false;
  const current = await readlink(link).catch(() => null);
  return current ? resolve(dirname(link), current) === target : false;
}

// 把一个真实存在的条目搬到目标位置，原位留软链。失败则回滚，不留半套。
async function relocate(rel) {
  const link = join(ROOT, rel);
  const target = join(DATA_ROOT, rel);

  if (await alreadyLinked(link, target)) {
    console.log(`  = ${rel}（已外置）`);
    return true;
  }

  const st = await stat(link).catch(() => null);
  const targetExists = await exists(target);

  // 1) 把内容搬到 DATA_ROOT（不覆盖已有文件，迁过的数据优先）
  if (st) {
    await mkdir(dirname(target), { recursive: true });
    if (st.isDirectory()) {
      await cp(link, target, { recursive: true, force: false, errorOnExist: false });
    } else if (!targetExists) {
      await cp(link, target, { force: false });
    }
  }

  // 2) 原位改名保留（不删），再建软链
  let backup = null;
  if (st) {
    backup = `${link}.bak-${STAMP}`;
    await rename(link, backup);
  } else if (await isSymlink(link)) {
    // 指向别处的旧软链：本身不含数据，直接换掉
    await unlink(link);
  }

  try {
    await symlink(target, link, st?.isDirectory() ? 'dir' : 'file');
  } catch (e) {
    // 回滚：把原目录还回去，绝不留下看起来正常实则指向空处的路径
    if (backup) await rename(backup, link).catch(() => {});
    console.error(`  ⛔ ${rel} 建软链失败（${e.code ?? e.message}）——已回滚，数据仍在原位`);
    return false;
  }

  console.log(`  + ${rel} → ${target}${backup ? `（旧内容保留在 ${backup}）` : ''}`);
  return true;
}

async function main() {
  if (await exists(join(ROOT, '.git'))) {
    console.log(`仓库形态（${ROOT} 有 .git/）：data/ 与 reports/ 不会被技能升级覆盖，无需外置。`);
    console.log('如需强制外置，设 HOUSE_OPS_DATA 并在受管安装目录里运行。');
    return 0;
  }

  if (!(await exists(join(ROOT, 'SKILL.md')))) {
    console.error(`⛔ ${ROOT} 不像 house-ops 技能目录（缺 SKILL.md）`);
    return 1;
  }

  console.log(`DATA_ROOT = ${DATA_ROOT}`);
  await mkdir(join(DATA_ROOT, 'data'), { recursive: true });
  await mkdir(join(DATA_ROOT, 'reports'), { recursive: true });
  await mkdir(join(DATA_ROOT, 'config'), { recursive: true });

  // 首次安装没有画像：从模板生成一份，避免后续每一步都提示"先跑 intake"
  if (!(await exists(join(DATA_ROOT, 'config/profile.yml')))) {
    const example = join(ROOT, 'config/profile.example.yml');
    if (await exists(example)) {
      await cp(example, join(DATA_ROOT, 'config/profile.yml'));
      console.log('  + config/profile.yml（由 profile.example.yml 生成）');
    }
  }

  const results = [];
  for (const rel of ['data', 'reports', 'config/profile.yml']) {
    results.push(await relocate(rel));
  }

  if (results.every(Boolean)) {
    console.log(`\n完成。用户数据现在在 ${DATA_ROOT}，技能目录里只剩软链——升级技能不会丢。`);
    console.log(`核验：node "${join(ROOT, 'scripts/doctor.mjs')}" "${ROOT}"`);
    return 0;
  }
  return 1;
}

process.exitCode = await main().catch((e) => {
  console.error('⛔', e.message);
  return 1;
});
