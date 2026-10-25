// lib/data.mjs — stats.mjs 与 dashboard.mjs 共享的数据解析层
// 契约：Machine Summary 的 YAML fence 紧跟 `## Machine Summary` 标题行，
//       schema SoT 是 modes/evaluate.md（键名变更需同步本文件与该文件）。
// 依赖：零依赖。YAML 只做行级解析（`key: value` 标量）。

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ---------- 共享标量工具 ----------

// 宽松数字解析：可解析（有限）返回数值，否则 null。统计/筛选/CLI 参数共用。
export function num(s) {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

// ---------- Machine Summary（评估报告） ----------

// 标量行级解析（`key: value`）：null/空、布尔、数字、数组、去引号
function parseScalar(v) {
  if (v === 'null' || v === '') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
  }
  return v.replace(/^["']|["']$/g, '');
}

export function parseMachineSummary(text) {
  const start = text.indexOf('## Machine Summary');
  if (start === -1) return null;
  const fence = /```ya?ml\n([\s\S]*?)```/.exec(text.slice(start));
  if (!fence) return null;
  const obj = {};
  let trend = null; // trend 子块（context 层，ADR-0004）：`trend:` 后缩进两格的键；去缩进即结束
  for (const line of fence[1].split('\n')) {
    if (/^trend:\s*$/.test(line)) {
      trend = {};
      obj.trend = trend;
      continue;
    }
    if (trend != null) {
      const t = /^\s{2,}(\w+):\s*(.*?)\s*$/.exec(line);
      if (t) { trend[t[1]] = parseScalar(t[2]); continue; }
      if (line.trim() === '') continue;
      trend = null; // 顶层行 → 子块结束
    }
    const m = /^(\w+):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    obj[m[1]] = parseScalar(m[2]);
  }
  return obj;
}

// 只取主报告（001-xxx-日期.md），排除 -deep / -negotiate 附录报告，避免同一编号重复计数。
// 强约束（ADR-0002）：provenance === 'void' 的作废报告默认对所有消费方不可见——
// 新增数据消费入口时不要自行 opt-in；确需审计作废数据时才显式传 includeVoid: true。
export async function collectReports(reportsDir, { includeVoid = false } = {}) {
  const files = (await readdir(reportsDir).catch(() => []))
    .filter(f => /^\d{3}-.+\.md$/.test(f))
    .filter(f => !/-(deep|negotiate)\.md$/.test(f));
  const rows = [];
  for (const f of files) {
    const text = await readFile(join(reportsDir, f), 'utf8');
    const ms = parseMachineSummary(text);
    if (ms) rows.push({ file: f, provenance: 'legacy', ...ms });
  }
  return includeVoid ? rows : rows.filter(r => r.provenance !== 'void');
}

// ---------- 趋势快照（data/trend/，house-ops.trend/1；第三数据源，ADR-0003/0004） ----------

// 读最新快照（≤ today 的最大日期）；目录不存在/无快照/坏 JSON → null（消费方按"无趋势"降级，不崩溃）。
// stale 按 14 天实采时效口径（与 scan.mjs history 一致）。
export async function loadTrendSnapshot(trendDir, { staleDays = 14, today = null } = {}) {
  const files = (await readdir(trendDir).catch(() => [])).filter(f => /^index-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const dates = files.map(f => f.slice(6, 16)).filter(d => !today || d <= today).sort();
  if (!dates.length) return null;
  const date = dates[dates.length - 1];
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(join(trendDir, `index-${date}.json`), 'utf8'));
  } catch {
    return null;
  }
  const now = today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.max(0, Math.round((new Date(now) - new Date(date)) / 86400000));
  return { snapshot, date, age_days: ageDays, stale: ageDays > staleDays };
}

// ---------- Watchlist（markdown 表格） ----------
// 列结构 SoT：modes/watchlist.md。无状态列——交易状态跟踪已移除（ADR-0001）。
// 真实性三态（ADR-0002）：备注首标记 ⛔=作废/虚构、⚠️=存疑未核实、✅=已实采验证；无标记=legacy（幻觉批次前的旧数据，按存疑对待）

export function authenticityFromNote(note = '') {
  const t = String(note ?? '').trim();
  if (t.startsWith('⛔')) return 'void';
  if (t.startsWith('⚠️')) return 'suspect';
  if (t.startsWith('✅')) return 'verified';
  return 'legacy';
}

// 真实性折叠唯一出口（ADR-0002）：watchlist 备注首标记是 SoT；无 watchlist 行时回落报告
// Machine Summary 的 provenance；两者皆无 → legacy（按存疑对待，绝不静默升为 verified）。
// 消费方（map/dashboard/页面）一律经此函数取真实性，不得自行折叠。
export function effectiveProvenance(report, watchRow) {
  if (watchRow) return watchRow.authenticity ?? 'legacy';
  const p = report?.provenance;
  return p === 'verified' || p === 'suspect' || p === 'void' ? p : 'legacy';
}

export async function parseWatchlist(watchlistPath, { includeVoid = false } = {}) {
  if (!(await readFile(watchlistPath, 'utf8').catch(() => null))) return null;
  const lines = (await readFile(watchlistPath, 'utf8')).split('\n');
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('---') || line.includes('编号')) continue;
    // [| 空, 编号, 小区, 城市板块, 类型, 总价, Global, 风险, 首次, 最近, 备注, 空](尾空)
    const c = line.split('|').map(x => x.trim());
    if (!/^\d{3}$/.test(c[1] ?? '')) continue;
    const note = c[10] ?? '';
    rows.push({
      no: c[1], community: c[2] ?? '', district: c[3] ?? '', type: c[4] ?? '',
      price: c[5] ?? '', score: c[6] ?? '', risk: c[7] ?? '',
      note,
      authenticity: authenticityFromNote(note),
    });
  }
  // 强约束（ADR-0002）：⛔作废行默认对所有消费方不可见（历史记录保留在文件里）
  return includeVoid ? rows : rows.filter(r => r.authenticity !== 'void');
}

// 读取单套房源报告详情
export async function readReportDetail(reportsDir, reportNo) {
  const files = (await readdir(reportsDir).catch(() => []))
    .filter(f => f.startsWith(`${reportNo}-`) && f.endsWith('.md') && !f.includes('-deep') && !f.includes('-negotiate'));
  if (!files.length) return null;
  const filePath = join(reportsDir, files[0]);
  const text = await readFile(filePath, 'utf8');
  const urlMatch = /https?:\/\/[^\s)\"'>]+/i.exec(text);
  const url = urlMatch ? urlMatch[0] : null;
  return { file: files[0], filePath, text, url };
}


