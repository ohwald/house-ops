#!/usr/bin/env node
// rescan.mjs — opt-in 自动复扫 CLI（fork 用户配合 GitHub Actions 模板使用；上游仓库不含任何活工作流）。
// 零依赖（Node ≥18 的全局 fetch）。确定性提取与计划在 scripts/lib/rescan.mjs（测试面在 selftest，无网络）。
// 用法:
//   node scripts/rescan.mjs [--urls <file>] [--corpus <dir>] [--out <dir>] [--dry-run] [--max-fetches N] [--today YYYY-MM-DD]
//     URL 来源（优先级）：--urls 文件（每行一条，# 注释）> 环境变量 WATCH_URLS（换行分隔）> stdin
// 纪律：单次 ≤12 次抓取、间隔+抖动；仅房天下（其他平台响亮 unsupported_platform，不硬解析）；
//       布局变更 → parse_failed 不落盘（操作信号，不是数据）；记录追加式，同日重跑覆盖当日 -auto 文件。

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScrapers } from '../scrapers/_registry.mjs';
import { buildSnapshot, TREND_SCHEMA } from './lib/trend.mjs';
import { RESCAN_BUDGET, planRescan, scheduleDelay, extractFangListing, extractFangCommunity, buildRecord } from './lib/rescan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function flag(name, fallback = null) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

async function readUrlList(explicit) {
  const raw = explicit
    ? await readFile(explicit, 'utf8').catch(() => { console.error(`⛔ URL 清单文件不可读: ${explicit}`); process.exit(1); })
    : (process.env.WATCH_URLS ?? (process.stdin.isTTY ? '' : await new Promise((res) => {
      let buf = '';
      process.stdin.on('data', (c) => { buf += c; });
      process.stdin.on('end', () => res(buf));
    })));
  return String(raw ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
}

async function fetchPage(url, { timeoutMs = RESCAN_BUDGET.fetch_timeout_ms } = {}) {
  // 详情页直接访问会 404 壳页（2026-10 实测），带 Referer + 浏览器 UA 后返回完整 SSR 页
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'text/html',
      'Referer': 'https://sh.esf.fang.com/',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return { ok: false, http_status: res.status, html: '' };
  return { ok: true, http_status: res.status, html: await res.text() };
}

const [cmd] = process.argv.slice(2);
const hasFlags = process.argv.slice(2).some((a) => a.startsWith('--'));

if (cmd !== 'run' && !hasFlags) {
  console.error('用法: node scripts/rescan.mjs run [--urls <file>] [--corpus <dir>] [--out <dir>] [--dry-run] [--max-fetches N]');
  console.error('  opt-in 自动复扫：仅在你自己的 fork 里跑（模板见 templates/actions/rescan.example.yml，文档见 docs/automated-rescan.md）');
  process.exit(1);
}

const urlsFile = flag('urls');
const corpusDir = flag('corpus', join(ROOT, 'data', 'scans'));
const outDir = flag('out', join(ROOT, 'data', 'trend'));
const today = flag('today') ?? new Date().toISOString().slice(0, 10);
const dryRun = process.argv.includes('--dry-run');
const maxFetches = Number(flag('max-fetches')) || RESCAN_BUDGET.max_fetches_per_run;

const urls = await readUrlList(urlsFile);
if (!urls.length) {
  console.log('📭 没有 URL 清单（--urls 文件 / WATCH_URLS 仓库变量 / stdin）——无事可做。');
  process.exit(0);
}

const scrapers = await loadScrapers(join(ROOT, 'scrapers'));
const plan = planRescan(urls, scrapers, { maxFetches });
for (const u of plan.unsupported) console.error(`⛔ unsupported_platform: ${u}（v1 仅支持房天下详情/小区页，不硬解析其他平台）`);
console.log(`📋 计划抓取 ${plan.fetches.length} 条（预算 ${plan.cap}）${plan.skipped_cap ? `，超出预算跳过 ${plan.skipped_cap} 条（分批再跑）` : ''}${dryRun ? '（dry-run）' : ''}`);
if (dryRun) {
  for (const f of plan.fetches) console.log(`  · [${f.kind}] ${f.url}`);
  process.exit(0);
}

await mkdir(corpusDir, { recursive: true });
const written = [];
let failed = 0;

for (let i = 0; i < plan.fetches.length; i++) {
  const item = plan.fetches[i];
  if (i > 0) await sleep(scheduleDelay());
  let page;
  try {
    page = await fetchPage(item.url);
  } catch (err) {
    console.error(`⚠️  抓取失败（${err.name ?? 'error'}）: ${item.url}`);
    failed++;
    continue;
  }
  if (!page.ok) {
    console.error(`⚠️  HTTP ${page.http_status}: ${item.url}（已下架/反爬——按追加纪律不猜原因）`);
    failed++;
    continue;
  }
  const extracted = item.kind === 'listing' ? extractFangListing(page.html) : extractFangCommunity(page.html);
  if (extracted.status !== 'ok') {
    // parse_failed 不落盘：垃圾记录污染语料，布局变更需要人修提取器或改走手动 scan
    console.error(`⛔ parse_failed ${item.url}（缺: ${extracted.missing.join(', ')}）——房天下布局可能变了，请更新提取器或改手动 scan`);
    failed++;
    continue;
  }
  const record = buildRecord(item.kind, extracted, { url: item.url, listingId: item.listing_id, today });
  // 同日重跑不覆盖：-auto 后缀 + 序号递增（追加式纪律；跨天天然唯一）
  let file = join(corpusDir, `fang-${item.listing_id ?? item.url.slice(-16)}-${today}-auto.json`);
  for (let n = 2; existsSync(file); n++) file = join(corpusDir, `fang-${item.listing_id ?? item.url.slice(-16)}-${today}-auto-${n}.json`);
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  written.push(file);
  console.log(`✅ [${item.kind}] ${record.community || item.url} → ${file}${item.kind === 'community' ? ` · 参考均价 ${extracted.reference.unit_price} 元/㎡（${extracted.reference.as_of_month ?? '?'}）` : ''}`);
}

// 就地刷新趋势快照（与 trend build 同一纯函数入口；追加式，历史文件保留）
let snapshotMsg = '跳过（无已写记录）';
if (written.length) {
  const files = (await readdir(corpusDir).catch(() => [])).filter((f) => f.endsWith('.json'));
  const records = [];
  for (const f of files) {
    try { records.push(JSON.parse(await readFile(join(corpusDir, f), 'utf8'))); } catch { /* 坏文件跳过 */ }
  }
  const snap = buildSnapshot(records, { today });
  await mkdir(outDir, { recursive: true });
  const snapFile = join(outDir, `index-${snap.as_of}.json`);
  await writeFile(snapFile, `${JSON.stringify(snap, null, 2)}\n`);
  snapshotMsg = `已刷新 ${snapFile}（schema ${TREND_SCHEMA}，${Object.keys(snap.communities).length} 个小区）`;
}

console.log(`\n📊 完成：落盘 ${written.length} 条 · 抓取失败 ${failed} 条 · 趋势快照 ${snapshotMsg}`);
process.exit(written.length ? 0 : failed ? 2 : 0);
