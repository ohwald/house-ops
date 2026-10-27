#!/usr/bin/env node
// 打出 WorkBuddy 技能市场可直接上传的 ZIP。
//
// 与 ClawHub 形态（tools/package-skill.mjs）的唯一区别是外壳：市场要求 ZIP 的第一层就是
// 技能目录（`house-ops/SKILL.md`），再套一层 `skills/` 会解析失败；同时要过平台的字段校验与
// 3MB 上限。内容同源，两个脚本共用一个 buildPackage。
//
// 平台规则（open.workbuddy.cn/docs/skill）：
//   - 必填 frontmatter：name / display_name / display_name_en / description /
//     description_zh / description_en / version / author；
//   - ZIP ≤ 3MB；
//   - 包里不能有写死的密钥、个人 API Key、Cookie。
//
// 用法：node tools/package-skill-wb.mjs
// 产物：dist/house-ops-<version>.zip

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, stat, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackage } from './package-skill.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, '.workbuddy/tmp/workbuddy/house-ops');
const DIST = join(ROOT, 'dist');
const MAX_ZIP_BYTES = 3 * 1024 * 1024;
const REQUIRED = ['name', 'display_name', 'display_name_en', 'description', 'description_zh', 'description_en', 'version', 'author'];

// frontmatter 只需要顶层标量；块标量（>-）只判键存在，不解析值
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z][a-z0-9_-]*):(.*)$/i.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.ts', '.yml', '.yaml', '.json', '.txt', '.html', '.sh', '.py']);

async function main() {
  await buildPackage(STAGE);

  // ---- 1. 平台必填字段：缺一个就直接拒收，别等传上去才发现 ----
  // 顺带剥掉 Claude Code 专有的两个键（位置参数/参数提示）——WorkBuddy 的技能不接位置参数，
  // 留着既无用又可能触发未知字段校验。源文件不动，只改上传副本。
  const skillMdPath = join(STAGE, 'SKILL.md');
  const raw = await readFile(skillMdPath, 'utf8');
  const cleaned = raw.replace(/^(arguments|argument-hint):.*\n/gm, '');
  if (cleaned !== raw) await writeFile(skillMdPath, cleaned);

  const fm = parseFrontmatter(cleaned);
  if (!fm) throw new Error('SKILL.md 缺 frontmatter');
  const missing = REQUIRED.filter((k) => !fm[k]);
  if (missing.length) throw new Error(`frontmatter 缺必填字段：${missing.join(', ')}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name)) throw new Error(`name 必须 kebab-case：${fm.name}`);

  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  if (fm.version !== pkg.version) {
    throw new Error(`SKILL.md version (${fm.version}) 与 package.json (${pkg.version}) 不一致——版本号必须单一真源`);
  }

  // ---- 2. 包内不该出现的东西 ----
  const files = (await readdir(STAGE, { recursive: true })).filter((f) => TEXT_EXT.has(extname(f)));
  const absPath = [], secret = [];
  for (const rel of files) {
    const text = await readFile(join(STAGE, rel), 'utf8').catch(() => '');
    if (/\/(Users|home)\/[A-Za-z0-9._-]+\//.test(text)) absPath.push(rel);
    if (/(api[_-]?key|secret|password|cookie)\s*[:=]\s*["']?[A-Za-z0-9_\-]{12,}/i.test(text)) secret.push(rel);
  }
  if (absPath.length) throw new Error(`包内有写死的家目录路径（平台会当成本机残留）：\n  ${absPath.join('\n  ')}`);
  if (secret.length) throw new Error(`包内有疑似密钥/口令赋值：\n  ${secret.join('\n  ')}`);

  // ---- 3. 打 ZIP：第一层必须就是 house-ops/ ----
  await mkdir(DIST, { recursive: true });
  const zipPath = join(DIST, `house-ops-${fm.version}.zip`);
  await rm(zipPath, { force: true });
  await run('zip', ['-qrX', zipPath, 'house-ops'], { cwd: dirname(STAGE) });

  const { size } = await stat(zipPath);
  if (size > MAX_ZIP_BYTES) {
    throw new Error(`ZIP ${(size / 1024 / 1024).toFixed(2)}MB 超过平台 3MB 上限`);
  }

  console.log(`\n✅ ${zipPath}`);
  console.log(`   ${(size / 1024).toFixed(0)}KB · 首层 house-ops/ · frontmatter ${REQUIRED.length} 个必填字段齐全`);
  console.log(`
上传（open.workbuddy.cn → 发布管理 → 技能 → 创建）：
  1. 拖入上面的 ZIP，平台自动解析出技能 ID；
  2. 补展示信息：市场展示分类（多选）、服务类目（1-5 个）、头像 512×512 JPG/PNG ≤500KB；
  3. 提交审核 → 通过后状态是「待发布」，必须再点一次「公开发布」才进市场。`);
}

main().catch((e) => { console.error('⛔', e.message); process.exitCode = 1; });
