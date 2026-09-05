#!/usr/bin/env node
// scan.mjs — 房源平台识别 / 扫描记录归一化 / 挂牌-成交交叉验证 / 政务数据源查询
// 零依赖（Node ≥18）。平台模板见 scrapers/（career-ops providers 模式：一平台一模块）。
// schema SoT：modes/scan.md「扫描记录 schema」节。
// 用法:
//   node scripts/scan.mjs detect <url> [url...]          # 识别平台/页面类型，输出提取清单
//   node scripts/scan.mjs normalize <record.json | ->    # 价格归一化 + 一致性检查（记录走 stdout，警告走 stderr）
//   node scripts/scan.mjs crosscheck <record.json> [--write]  # 挂牌价 vs 成交价交叉验证
//   node scripts/scan.mjs official [城市]                # 查政务公开数据源登记表

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScrapers, detectPlatform } from '../scrapers/_registry.mjs';
import { normalizeRecord, crosscheckRecord } from '../scrapers/_fields.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 未识别平台的兜底提取清单（scan 模式按此抓取，platform 记 generic）
const GENERIC_FIELDS = [
  '小区名（含所在区/板块）', '总价（万元）', '单价（元/㎡）', '建筑面积（㎡）',
  '户型（几室几厅）', '楼层/总楼层', '电梯（有无）', '建成年代', '挂牌时间与调价记录',
];

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonInput(arg) {
  let text;
  if (arg === '-' || arg === undefined) {
    if (process.stdin.isTTY) {
      console.error('用法: node scripts/scan.mjs normalize <record.json | ->（记录 JSON 走文件或 stdin 管道）');
      process.exit(1);
    }
    text = await readStdin();
  } else {
    text = await readFile(arg, 'utf8').catch((err) => {
      console.error(err.code === 'ENOENT' ? `⛔ 文件不存在: ${arg}` : `⛔ 读取失败: ${err.message}`);
      process.exit(1);
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    console.error('⛔ 输入不是合法的 JSON——扫描记录 schema 见 modes/scan.md');
    process.exit(1);
  }
}

async function cmdDetect(urls) {
  if (!urls.length) {
    console.error('用法: node scripts/scan.mjs detect <url> [url...]');
    process.exitCode = 1;
    return;
  }
  const scrapers = await loadScrapers(join(ROOT, 'scrapers'));
  const out = urls.map((url) => {
    const found = detectPlatform(url, scrapers);
    if (!found) {
      return {
        url,
        platform: 'generic',
        name: '未识别平台',
        page_type: 'unknown',
        fields: GENERIC_FIELDS,
        hint: '未命中已知平台模板——按通用清单提取，可靠度最高按「挂牌数据」并注明来源。新平台可按 scrapers/ADDING_A_PLATFORM.md 补模板。',
      };
    }
    const { scraper, hit } = found;
    return {
      url,
      platform: scraper.id,
      name: scraper.name,
      ...hit,
      fields: scraper.fields,
      transaction: scraper.transaction,
      notes: scraper.notes,
    };
  });
  console.log(JSON.stringify(out, null, 2));
}

async function cmdNormalize(arg) {
  const raw = await readJsonInput(arg);
  const { record, warnings } = normalizeRecord(raw);
  warnings.forEach((w) => console.error(`⚠️  ${w}`));
  console.log(JSON.stringify(record, null, 2));
}

async function cmdCrosscheck(arg, write) {
  const raw = await readJsonInput(arg);
  const { record, warnings } = normalizeRecord(raw); // 先归一化保证单位一致，再交叉验证
  crosscheckRecord(record);
  warnings.forEach((w) => console.error(`⚠️  ${w}`));
  const out = JSON.stringify(record, null, 2);
  if (write) {
    await writeFile(arg, `${out}\n`);
    console.error(`✅ 交叉验证结果已写回 ${arg}`);
  } else {
    console.log(out);
  }
}

// 行级解析 templates/official-sources.cn.yml（登记表是扁平两缩进结构，无需 YAML 库）
async function cmdOfficial(city) {
  const text = await readFile(join(ROOT, 'templates', 'official-sources.cn.yml'), 'utf8');
  const entries = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const start = /^\s*-\s+city:\s*(.+?)\s*$/.exec(line);
    if (start) {
      cur = { city: start[1].replace(/^["']|["']$/g, '') };
      entries.push(cur);
      continue;
    }
    if (!cur) continue;
    const kv = /^\s+([a-z_]+):\s*(.*?)\s*$/.exec(line);
    if (!kv || kv[1] === 'city') continue;
    const inline = /^\[(.*)\]\s*$/.exec(kv[2]);
    cur[kv[1]] = inline
      ? inline[1].split(',').map((s) => s.trim()).filter(Boolean)
      : kv[2].replace(/^["']|["']$/g, '');
  }
  const list = city ? entries.filter((e) => e.city.includes(city)) : entries;
  if (!list.length) {
    console.log(`未找到「${city ?? '全部'}」的登记条目。可自行检索「${city ?? '目标城市'} 住建委 / 房地产交易中心」官方平台，核实后按 templates/official-sources.cn.yml 现有格式补入（带 as_of 与 verify_before_use）。`);
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify(list, null, 2));
}

const [cmd, ...rest] = process.argv.slice(2);
const main = { detect: cmdDetect, normalize: cmdNormalize, crosscheck: cmdCrosscheck, official: cmdOfficial };
if (!cmd || !main[cmd]) {
  console.error('用法: node scripts/scan.mjs <detect|normalize|crosscheck|official> …（详见本文件头注释与 modes/scan.md）');
  process.exit(1);
}
if (cmd === 'crosscheck') await cmdCrosscheck(rest[0], rest.includes('--write'));
else if (cmd === 'detect') await cmdDetect(rest);
else await main[cmd](rest[0]);
