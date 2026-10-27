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
//   - 包里不能有写死的密钥、个人 API Key、Cookie；
//   - 目录层级只允许「根/一级目录/文件」，`scripts/lib/x.mjs` 这种第三层会直接解析失败。
//
// 最后一条与仓库形态冲突（仓库里确实有三层），所以上传副本要压平：`scripts/lib/` 提到
// 包根 `lib/`、`docs/markets/` 与 `templates/actions/` 上提一层，并把引用一起改写。
// 只在副本里做，仓库结构与 ClawHub 形态不受影响——两个渠道的内容仍然同源。
//
// 用法：node tools/package-skill-wb.mjs
// 产物：dist/house-ops-<version>.zip

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, stat, mkdir, rm, writeFile, rename } from 'node:fs/promises';
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

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

// 目录层级压平：平台只接受「根/一级目录/文件」，第三层会让整个 ZIP 解析失败。
// scripts/lib 提到包根而不是并进 scripts/——scripts/ 下已经有 rescan.mjs、trend.mjs，
// 同名文件会互相覆盖。提到 lib/ 后只需要把 scripts/ 的引用改深一层。
const UPLIFT = [
  { from: 'scripts/lib', to: 'lib' },
  { from: 'templates/actions', to: 'templates' },
];

async function flattenLayout(stage) {
  for (const { from, to } of UPLIFT) {
    const src = join(stage, from);
    const entries = await readdir(src, { withFileTypes: true }).catch(() => null);
    if (!entries) continue;
    await mkdir(join(stage, to), { recursive: true });
    for (const e of entries) {
      if (!e.isFile()) throw new Error(`压平失败：${from}/${e.name} 不是文件（只支持单层目录）`);
      const dest = join(stage, to, e.name);
      if (await exists(dest)) throw new Error(`压平失败：${to}/${e.name} 已存在，不能覆盖`);
      await rename(join(src, e.name), dest);
    }
    await rm(src, { recursive: true, force: true });
    console.log(`  ~ ${from}/ → ${to}/`);
  }

  // docs/markets 上提会丢掉「markets」语义，所以文件名带上前缀：docs/markets-eu.md
  const markets = join(stage, 'docs/markets');
  const marketsEntries = await readdir(markets, { withFileTypes: true }).catch(() => null);
  if (marketsEntries) {
    for (const e of marketsEntries) {
      if (!e.isFile()) throw new Error(`压平失败：docs/markets/${e.name} 不是文件`);
      await rename(join(markets, e.name), join(stage, 'docs', `markets-${e.name}`));
    }
    await rm(markets, { recursive: true, force: true });
    console.log('  ~ docs/markets/ → docs/markets-*.md');
  }
}

// 压平之后引用必须跟着改，否则装上去 import 直接断。
// 顺序有讲究：先改带文件名的 markets 引用，再改裸目录；代码 import 先于文档路径。
async function rewriteRefs(stage) {
  const files = (await readdir(stage, { recursive: true })).filter((f) => TEXT_EXT.has(extname(f)));
  let touched = 0;
  for (const rel of files) {
    const p = join(stage, rel);
    const before = await readFile(p, 'utf8');
    let t = before;
    if (rel.startsWith('scripts/')) t = t.replace(/(['"`])\.\/lib\//g, '$1../lib/');
    if (rel.startsWith('lib/')) t = t.replace(/(['"`])\.\.\/\.\.\/scrapers\//g, '$1../scrapers/');
    t = t
      // join(ROOT, 'scripts', 'lib', 'x.mjs') 这种分段拼接不吃路径字符串替换
      .replace(/(['"])scripts\1\s*,\s*(['"])lib\2\s*,\s*/g, '$1lib$1, ')
      .replace(/docs\/markets\/([A-Za-z0-9_-]+\.md)/g, 'docs/markets-$1')
      // 数组/常量里不带尾斜杠的写法：['docs/markets'] → ['docs']
      .replace(/(['"])docs\/markets\1/g, '$1docs$1')
      .replace(/scripts\/lib\//g, 'lib/')
      .replace(/docs\/markets\//g, 'docs/')
      .replace(/templates\/actions\//g, 'templates/');
    if (t !== before) { await writeFile(p, t); touched += 1; }
  }
  console.log(`  ~ 改写引用：${touched} 个文件`);
  return touched;
}

// 改写是否漏了，不靠肉眼看：把所有相对 import 解析一遍，缺文件就报错。
async function assertImportsResolve(stage) {
  const files = (await readdir(stage, { recursive: true })).filter((f) => f.endsWith('.mjs') || f.endsWith('.js'));
  const broken = [];
  for (const rel of files) {
    const text = await readFile(join(stage, rel), 'utf8');
    const specs = [
      ...text.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g),
      ...text.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]);
    for (const spec of specs) {
      const target = join(dirname(join(stage, rel)), spec);
      if (!(await exists(target))) broken.push(`${rel} → ${spec}`);
    }
  }
  if (broken.length) throw new Error(`压平后相对 import 断链：\n  ${broken.join('\n  ')}`);
}

async function main() {
  await buildPackage(STAGE);

  // ---- 0. 层级压平（平台硬性限制，三层目录直接拒收）----
  await flattenLayout(STAGE);
  await rewriteRefs(STAGE);
  await assertImportsResolve(STAGE);

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

  // ---- 4. 层级断言：以 ZIP 内真实条目为准（平台就是这么判的），漏一处整包被拒 ----
  // 合法条目最多 3 段：house-ops/<一级目录>/<文件>。目录条目也查，`house-ops/scripts/lib/`
  // 去掉尾斜杠后会伪装成 3 段，所以这里用不去空段的 split 计数。
  const { stdout: listing } = await run('unzip', ['-Z1', zipPath]);
  const tooDeep = listing.split('\n').filter(Boolean).filter((e) => e.split('/').length > 3);
  if (tooDeep.length) {
    throw new Error(`仍有超过两级的路径（平台只接受 根/一级目录/文件）：\n  ${tooDeep.join('\n  ')}`);
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
