// lib/data.mjs — stats.mjs 与 dashboard.mjs 共享的数据解析层
// 契约：Machine Summary 的 YAML fence 紧跟 `## Machine Summary` 标题行，
//       schema SoT 是 modes/evaluate.md（键名变更需同步本文件与该文件）。
// 依赖：零依赖。YAML 只做行级解析（`key: value` 标量）；states.yml 只提取 canonical 行。

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ---------- Machine Summary（评估报告） ----------

export function parseMachineSummary(text) {
  const start = text.indexOf('## Machine Summary');
  if (start === -1) return null;
  const fence = /```ya?ml\n([\s\S]*?)```/.exec(text.slice(start));
  if (!fence) return null;
  const obj = {};
  for (const line of fence[1].split('\n')) {
    const m = /^(\w+):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (v === 'null' || v === '') v = null;
    else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    else v = v.replace(/^["']|["']$/g, '');
    obj[m[1]] = v;
  }
  return obj;
}

// 只取主报告（001-xxx-日期.md），排除 -deep / -negotiate 附录报告，避免同一编号重复计数
export async function collectReports(reportsDir) {
  const files = (await readdir(reportsDir).catch(() => []))
    .filter(f => /^\d{3}-.+\.md$/.test(f))
    .filter(f => !/-(deep|negotiate)\.md$/.test(f));
  const rows = [];
  for (const f of files) {
    const text = await readFile(join(reportsDir, f), 'utf8');
    const ms = parseMachineSummary(text);
    if (ms) rows.push({ file: f, ...ms });
  }
  return rows;
}

// ---------- Watchlist（markdown 表格） ----------

export async function parseWatchlist(watchlistPath) {
  if (!(await readFile(watchlistPath, 'utf8').catch(() => null))) return null;
  const lines = (await readFile(watchlistPath, 'utf8')).split('\n');
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('---') || line.includes('编号')) continue;
    // [| 空, 编号, 小区, 城市板块, 类型, 总价, Global, 风险, 状态, 首次, 最近, 备注, 空](尾空)
    const c = line.split('|').map(x => x.trim());
    if (!/^\d{3}$/.test(c[1] ?? '')) continue;
    rows.push({
      no: c[1], community: c[2] ?? '', district: c[3] ?? '', type: c[4] ?? '',
      price: c[5] ?? '', score: c[6] ?? '', risk: c[7] ?? '', state: c[8] ?? '',
      note: c[11] ?? '',
    });
  }
  return rows;
}

// ---------- 状态机（templates/states.yml，提取 canonical 名与文件顺序） ----------

export async function readStates(statesPath) {
  const yml = await readFile(statesPath, 'utf8').catch(() => '');
  const states = [];
  const re = /^-\s*canonical:\s*(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(yml))) states.push(m[1]);
  return states;
}
