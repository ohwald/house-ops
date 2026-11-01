// trend.mjs（lib）— 盘口边际趋势引擎：纯函数层（零依赖，Node ≥18）。
// 方法论：同一小区的相邻快照对比 → 边际事件（调价/新挂牌/下架=供给减少）→ 周度加权中位数指数
//         → 温度/失速/右侧信号 → 关注池聚合（ADR-0003：封顶关注池，城市级无代码路径）。
// 纪律：周事件 <3 → index=null（not_enough_data，沉默≠稳定）；未覆盖周不前向填充；
//       成交锚点不进指数（只作回测校准）；下架只计供给、不猜是否成交；趋势不进评分（ADR-0004）。
// 快照 schema（house-ops.trend/1，SoT 本文件）：
//   { schema, as_of, constants, communities: { <小区key>: { display, district, index_4w, index_12w,
//     temperature, right_side_weeks, n_events_12w, status, weekly[], coverage } },
//     pool: { index_4w, index_12w, temperature, right_side_weeks, n_communities, weekly[] } | null,
//     districts: { <板块>: 同 pool 形状 }（仅同板块 ≥min_district_communities 个已索引小区）,
//     calibration: { n, hit_rate, badge } }
// 测试面：scripts/selftest.mjs 的 golden 用例（本文件只导出纯函数，无 IO）。

import { buildEntityHistory } from '../../scrapers/_fields.mjs';

export const TREND_SCHEMA = 'house-ops.trend/1';

// 全部可调参数集中于此（modes/scan.md「趋势读数」节的常量表与之同步，doctor 断言不漂移；
// 用户可在 modes/_custom.md 声明覆盖值，由调用方读入后传入 buildSnapshot 的 constants 覆盖项）
export const TREND_CONSTANTS = Object.freeze({
  half_life_weeks: 2,          // 时近性衰减半衰期（周）：权重 = 0.5^(周龄/半衰期)
  min_events_per_week: 3,      // 周幅度事件 <3 → 该周 index=null（三次以上才谈方向）
  window_4w: 4,                // 近 4 周窗口
  window_12w: 12,              // 近 12 周窗口
  delist_after_days: 21,       // 实体消失 ≥21 天且小区仍有更新采集 → 记下架（供给事件）
  min_district_communities: 3, // 板块级聚合门槛：同板块已索引小区 ≥3（ADR-0003）
  stalling_monthly_pct: -1.5,  // 失速档：近 4 周累计 ≤ -1.5%（播客口径：单月跌 1.5%+ = 加速下跌）
  hot_threshold_pct: 0.8,      // 热档：近 4 周累计 ≥ +0.8%
  right_side_trigger_pct: 0.8, // 右侧确认：连续同向周累计 |幅度| ≥ 0.8%（初值，待回测校准）
  calibration_min_comparisons: 10, // 校准徽章升 calibrated 的最少方向比较次数
  calibration_hit_rate: 0.6,   // calibrated 门槛：命中率 ≥ 60%
  calibration_refute_rate: 0.4, // refuted 门槛：命中率 < 40%（信号停止可引用）
  calibration_flat_pct: 0.5,   // 锚点变动 |Δ| < 0.5% 视为平坦，不参与方向评分
  calibration_index_flat_pct: 0.05, // 指数窗口累计 |累计| < 0.05% 视为平坦，不参与方向评分
  band_trend_clamp_pct: 5,     // 合理价区间的趋势调整封顶 ±5%（防热指数喧宾夺主）
  band_max_factor_pct: 5,      // 个别因素调整上限（评估的硬伤/楼层/朝向，0-5%）
  band_min_anchor_samples: 5,  // 锚点样本 <5 → 不出区间，退回 crosscheck 并明示
});

// 温度中文标签（唯一实现；CLI 读数卡与地图页共用，避免两处手抄漂移）
export const TREND_TEMP_LABEL = Object.freeze({ cold: '冷', mild: '温', hot: '热', stalling: '失速' });

// 把快照的小区趋势字段挂到房源行（map 消费；row 需带 community 字段）。
// 快照缺失或**过期（stale）→ 全部 null**：AC 语义是"过期不渲染温度"，绝不拿旧快照冒充当前。
export function attachTrendToHouses(rows, trendInfo) {
  const usable = trendInfo && !trendInfo.stale;
  const byComm = new Map(Object.entries(usable ? trendInfo.snapshot?.communities ?? {} : {})
    .filter(([, c]) => c.status === 'indexed')
    .map(([k, c]) => [k, {
      temp: c.temperature ?? null,
      label: TREND_TEMP_LABEL[c.temperature] ?? null,
      right: c.right_side_weeks ?? null,
      events: c.n_events_12w ?? null,
    }]));
  return (rows ?? []).map((r) => {
    const t = byComm.get(normCommunity(r.community)) ?? null;
    return {
      ...r,
      trend_temp: t?.temp ?? null,
      trend_label: t?.label ?? null,
      trend_right: t?.right ?? null,
      trend_events: t?.events ?? null,
    };
  });
}

// 基础工具 ----------

const round1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ISO 周：label 'YYYY-Www' + 该周周一日期（周的排序/求龄基准）
export function isoWeek(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  const dow = d.getUTCDay() || 7; // 1..7（周一..周日）
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - (dow - 1));
  const thursday = new Date(monday); thursday.setUTCDate(monday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / 604800000) + 1;
  return { label: `${year}-W${String(week).padStart(2, '0')}`, monday: monday.toISOString().slice(0, 10) };
}

const weeksBetween = (mondayA, mondayB) => Math.round((new Date(mondayB) - new Date(mondayA)) / 604800000);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
export const normCommunity = (s) => String(s ?? '').replace(/[\s（）()·、]/g, '').toLowerCase();

// ---------- 记录过滤（ADR-0002：partial / URL 未实访 / provenance void 的不进指数） ----------

export function trendEligibleRecords(records) {
  return (records ?? []).filter((r) =>
    r?.status !== 'partial'
    && r?.capture?.url_verified !== false
    && r?.provenance !== 'void'
    && String(r?.community ?? '').trim() !== '');
}

// 实体按小区分组（display 保留原始小区名做展示，key 用归一化名）
export function groupByCommunity(entities) {
  const out = [];
  const byKey = new Map();
  for (const e of entities ?? []) {
    const key = e.fingerprint?.community ?? normCommunity(e.community) ?? '未知小区';
    if (!byKey.has(key)) {
      const g = { key, display: e.community || key, district: e.district ?? '', entities: [] };
      byKey.set(key, g); out.push(g);
    }
    byKey.get(key).entities.push(e);
  }
  return out;
}

// 实体价格点：从 listings[].captures 汇总（单价优先，总价兜底）——
// 不用 buildEntityHistory 的 price_points（后者仅在有 total_price_wan 时填充，unit-only 记录会漏）
function entityPoints(e) {
  return (e.listings ?? []).flatMap((l) => l.captures ?? [])
    .map((c) => ({ date: String(c.date ?? ''), unit_price: c.unit_price ?? null, total_price_wan: c.total_price_wan ?? null }))
    .filter((p) => p.date);
}

// 小区全部采集日期（含无价格的复扫/小区页记录）——下架判定与覆盖度都以此为准
const communityCaptureDates = (entities) => [...new Set((entities ?? []).flatMap((e) =>
  (e.listings ?? []).flatMap((l) => (l.captures ?? []).map((c) => String(c.date ?? '')).filter(Boolean))))].sort();

// ---------- 边际事件提取（相邻快照对比；实体已跨平台/重挂归并） ----------

// 事件类型：price_change（带幅度）/ new_listing（幅度=vs 当日存量中枢的偏离，无存量则无幅度）/
//          delisting（仅供给事件，无幅度，不进指数中位数）。幅度口径优先单价。
export function extractCommunityEvents(entities, { constants = TREND_CONSTANTS } = {}) {
  const events = [];
  const communityLast = communityCaptureDates(entities).at(-1) ?? null;

  for (const e of entities ?? []) {
    // 实体价格点：同日多键 → 取中位数并为一日；只留可比（单价或总价）点
    const byDate = new Map();
    for (const p of entityPoints(e)) {
      const v = p.unit_price ?? (Number.isFinite(p.total_price_wan) ? p.total_price_wan : null);
      if (v == null) continue;
      if (!byDate.has(p.date)) byDate.set(p.date, []);
      byDate.get(p.date).push(v);
    }
    const pts = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, vs]) => ({ date, v: median(vs) }));

    // 调价：相邻两次可比采集且价格实际变化（价格不动 = 无边际事件）
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (a.v > 0 && b.v !== a.v) {
        events.push({ type: 'price_change', at: b.date, entity_id: e.entity_id, magnitude_pct: round1(((b.v - a.v) / a.v) * 100) });
      }
    }
    // 新挂牌：实体首次出现，幅度 = vs 当日已存在实体最近单价的中位数偏离
    if (pts.length) {
      const firstDate = pts[0].date;
      const refPrices = (entities ?? [])
        .filter((o) => o !== e)
        .map((o) => {
          const prior = entityPoints(o).filter((p) => p.date < firstDate && p.unit_price != null);
          return prior.length ? prior[prior.length - 1].unit_price : null;
        })
        .filter((v) => v != null);
      const own = pts[0].v;
      events.push({
        type: 'new_listing', at: firstDate, entity_id: e.entity_id,
        magnitude_pct: refPrices.length && own != null ? round1(((own - median(refPrices)) / median(refPrices)) * 100) : null,
      });
    }
    // 下架候选：实体最后采集后小区仍持续采集 ≥delist_after_days 天而它再未出现 → 供给减少（不猜原因）
    if (communityLast && e.summary?.last_date && e.summary.last_date < communityLast
      && daysBetween(e.summary.last_date, communityLast) >= constants.delist_after_days) {
      events.push({ type: 'delisting', at: communityLast, entity_id: e.entity_id, magnitude_pct: null });
    }
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

// ---------- 周度指数与信号 ----------

// 幅度事件（price_change / 带中枢的 new_listing）进中位数；delisting 只计 supply_events。
// 周 index = 该周幅度事件的中位数；n_events < min_events_per_week → index=null。
export function weeklyIndex(events, { constants = TREND_CONSTANTS } = {}) {
  const byWeek = new Map();
  for (const ev of events ?? []) {
    const w = isoWeek(ev.at);
    if (!byWeek.has(w.label)) byWeek.set(w.label, { week: w.label, monday: w.monday, mags: [], supply: 0 });
    const b = byWeek.get(w.label);
    if (ev.type === 'delisting') b.supply += 1;
    else if (ev.magnitude_pct != null) b.mags.push(ev.magnitude_pct);
  }
  return [...byWeek.values()].sort((a, b) => a.monday.localeCompare(b.monday)).map((w) => ({
    week: w.week,
    index: w.mags.length >= constants.min_events_per_week ? round1(median(w.mags)) : null,
    n_events: w.mags.length,
    supply_events: w.supply,
  }));
}

// 窗口累计：窗口内非空周的加权和（权重=0.5^(周龄/半衰期)）；窗口无非空周 → null
export function cumulativeIndex(weekly, { window, asOf, constants = TREND_CONSTANTS } = {}) {
  const rows = (weekly ?? []).filter((w) => w.index != null);
  if (!rows.length) return null;
  const all = weekly ?? [];
  const asOfMonday = isoWeek(asOf ?? all[all.length - 1].monday ?? mondayOfLabel(all[all.length - 1].week)).monday;
  let sum = 0, used = 0;
  for (const w of rows) {
    const age = weeksBetween(w.monday ?? mondayOfLabel(w.week), asOfMonday);
    if (age >= 0 && age < window) { sum += w.index * 0.5 ** (age / constants.half_life_weeks); used++; }
  }
  return used ? round1(sum) : null;
}

function mondayOfLabel(label) {
  // 兜底：从周标签反推周一（正常路径 weeklyIndex 已带 monday，不会走到这里）
  const m = /^(\d{4})-W(\d{2})$/.exec(String(label));
  if (!m) return String(label);
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4); week1Mon.setUTCDate(jan4.getUTCDate() - (dow - 1));
  week1Mon.setUTCDate(week1Mon.getUTCDate() + (Number(m[2]) - 1) * 7);
  return week1Mon.toISOString().slice(0, 10);
}

export function nEventsWindow(weekly, window, asOf) {
  const asOfMonday = isoWeek(asOf).monday;
  return (weekly ?? []).reduce((n, w) => {
    const mon = w.monday ?? mondayOfLabel(w.week);
    return n + (weeksBetween(mon, asOfMonday) < window ? (w.n_events ?? 0) : 0);
  }, 0);
}

// 温度（基于近4周累计）：≤stalling 失速档 / <0 冷 / <hot 温 / ≥hot 热；无读数 → null
export function temperatureOf(index4w, { constants = TREND_CONSTANTS } = {}) {
  if (index4w == null) return null;
  if (index4w <= constants.stalling_monthly_pct) return 'stalling';
  if (index4w < 0) return 'cold';
  if (index4w < constants.hot_threshold_pct) return 'mild';
  return 'hot';
}

// 右侧 N 周：从最近一周往前，连续同向非空周（相邻周标签）累计 |幅度| ≥ 阈值 → 该连续段长度，否则 0
export function rightSideWeeks(weekly, { constants = TREND_CONSTANTS } = {}) {
  const rows = (weekly ?? []).filter((w) => w.index != null);
  if (!rows.length) return 0;
  const last = rows[rows.length - 1];
  const sign = Math.sign(last.index);
  let run = 0, cum = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (Math.sign(rows[i].index) !== sign) break;
    // 相邻性：与上一计入周必须相差 1 周（跳周 = 断裂）
    if (run > 0 && weeksBetween(rows[i].monday ?? mondayOfLabel(rows[i].week), rows[i + 1].monday ?? mondayOfLabel(rows[i + 1].week)) !== 1) break;
    run += 1; cum += rows[i].index;
  }
  return Math.abs(cum) >= constants.right_side_trigger_pct ? run : 0;
}

// ---------- 聚合（池/板块：成员周指数的中位数再累计；ADR-0003 封顶） ----------

function aggregateWeekly(items) {
  const map = new Map();
  for (const it of items ?? []) {
    for (const w of it.weekly ?? []) {
      if (!map.has(w.week)) map.set(w.week, { week: w.week, monday: w.monday ?? mondayOfLabel(w.week), idxs: [], n: 0, supply: 0 });
      const b = map.get(w.week);
      b.n += w.n_events ?? 0; b.supply += w.supply_events ?? 0;
      if (w.index != null) b.idxs.push(w.index);
    }
  }
  return [...map.values()].sort((a, b) => a.monday.localeCompare(b.monday)).map((w) => ({
    week: w.week,
    index: w.idxs.length ? round1(median(w.idxs)) : null,
    n_events: w.n,
    supply_events: w.supply,
  }));
}

// ---------- 校准回测（锚点只验方向，不进指数；ADR-0004） ----------

// 从合格扫描记录提取各小区锚点序列。锚点值 = 挂牌价 / (1 + listing_vs_anchor_pct/100)
// ——crosscheck 未存锚点原值，可精确反推；date 取 scanned_at（锚点是扫描时点可见成交的中位数，as_of 语义）。
export function collectAnchors(records) {
  const byCommunity = new Map();
  for (const rec of trendEligibleRecords(records)) {
    const c = rec?.crosscheck;
    if (!c?.anchor || c.verdict === 'not_enough_data') continue;
    const pct = c.listing_vs_anchor_pct;
    if (!Number.isFinite(pct) || pct <= -100) continue;
    const L = rec.listing ?? {};
    const listingVal = Number.isFinite(L.unit_price) && L.unit_price > 0 ? L.unit_price
      : Number.isFinite(L.total_price_wan) && L.total_price_wan > 0 ? L.total_price_wan : null;
    if (listingVal == null) continue;
    const key = normCommunity(rec.community);
    if (!key) continue;
    if (!byCommunity.has(key)) byCommunity.set(key, []);
    byCommunity.get(key).push({
      date: String(rec.scanned_at ?? ''),
      value: Math.round((listingVal / (1 + pct / 100)) * 100) / 100,
      tier: c.anchor.tier ?? '未核实',
      n_samples: c.anchor.n_samples ?? null,
      listing_key: `${rec.platform ?? ''}:${rec.listing_id ?? rec.url ?? ''}`,
      display: rec.community,
    });
  }
  for (const list of byCommunity.values()) list.sort((a, b) => a.date.localeCompare(b.date) || a.listing_key.localeCompare(b.listing_key));
  return byCommunity;
}

// 校准窗口累计（未加权）：monday ∈ (from, to] 的非空周指数之和；窗口无非空周 → null
export function cumulativeBetween(weekly, fromDate, toDate) {
  let sum = 0, used = 0;
  for (const w of weekly ?? []) {
    if (w.index == null) continue;
    const mon = w.monday ?? mondayOfLabel(w.week);
    if (mon > fromDate && mon <= toDate) { sum += w.index; used++; }
  }
  return used ? round1(sum) : null;
}

// 徽章三态：<min 次一律 uncalibrated（数据不足 ≠ 通过）；≥min 且命中率 ≥60% → calibrated；
// 命中率 <40% → refuted（信号停止可引用）；中间带 → uncalibrated（还没资格说自己准）
export function badgeOf(n, hitRate, { constants = TREND_CONSTANTS } = {}) {
  if (n < constants.calibration_min_comparisons || hitRate == null) return 'uncalibrated';
  if (hitRate >= constants.calibration_hit_rate) return 'calibrated';
  if (hitRate < constants.calibration_refute_rate) return 'refuted';
  return 'uncalibrated';
}

// 方向比较：同小区相邻锚点对，只有「成交数据」档参与评分（其余显式计入排除，不静默丢弃）。
// 锚点变动方向 vs 窗口 (a0.date, a1.date] 内指数方向；平坦（|Δ锚点| 或 |指数| 过小）不评分。
export function calibrate(anchorsByCommunity, communitiesWeekly, { constants = TREND_CONSTANTS } = {}) {
  const comparisons = [];
  const excluded = { low_tier: 0, no_overlap: 0, flat: 0 };
  let hits = 0, n = 0;
  const weeklyOf = (key) => (communitiesWeekly instanceof Map
    ? communitiesWeekly.get(key)?.weekly : communitiesWeekly?.[key]?.weekly) ?? [];
  for (const [key, anchors] of anchorsByCommunity ?? []) {
    const weekly = weeklyOf(key);
    const scored = anchors.filter((a) => a.tier === '成交数据');
    excluded.low_tier += anchors.length - scored.length;
    for (let i = 1; i < scored.length; i++) {
      const a0 = scored[i - 1], a1 = scored[i];
      if (!(a0.value > 0)) continue;
      const anchorDelta = round1(((a1.value - a0.value) / a0.value) * 100);
      const cum = cumulativeBetween(weekly, a0.date, a1.date);
      const base = {
        community: key, display: a0.display, from: a0.date, to: a1.date,
        tier: a1.tier, anchor_delta_pct: anchorDelta, index_cum_pct: cum,
      };
      if (cum == null) { excluded.no_overlap++; comparisons.push({ ...base, result: 'excluded:no_overlap' }); continue; }
      if (Math.abs(anchorDelta) < constants.calibration_flat_pct || Math.abs(cum) < constants.calibration_index_flat_pct) {
        excluded.flat++; comparisons.push({ ...base, result: 'excluded:flat' }); continue;
      }
      const hit = anchorDelta > 0 === cum > 0;
      if (hit) hits++;
      n++;
      comparisons.push({ ...base, result: hit ? 'hit' : 'miss' });
    }
  }
  const hitRate = n ? Math.round((hits / n) * 1000) / 1000 : null;
  return { n, hits, hit_rate: hitRate, badge: badgeOf(n, hitRate, { constants }), excluded, comparisons };
}

// ---------- 合理价区间（T6：成交锚点 × 趋势有限调整 ± 个别因素；叠加不替换 crosscheck） ----------

// 输入全部显式传入（无隐藏默认）。锚点值与返回值同单位（建议单价口径 元/㎡）。
// 退回规则：锚点样本 <5 或指数 not_enough_data → ok:false + reason，调用方必须明示退回 crosscheck 口径。
export function fairPriceBand({ anchor_value, anchor_n, index_12w, factor_pct = 0, constants = TREND_CONSTANTS } = {}) {
  const a = Number(anchor_value), n = Number(anchor_n);
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(n)) return { ok: false, reason: 'invalid_anchor' };
  if (n < constants.band_min_anchor_samples) return { ok: false, reason: 'thin_anchor', anchor_n: n, min: constants.band_min_anchor_samples };
  // 注意 Number(null)===0：指数缺失必须显式判 null/undefined，否则会被当成 0% 硬造区间
  if (index_12w == null || !Number.isFinite(Number(index_12w))) return { ok: false, reason: 'no_index', anchor_n: n };
  const idx = Number(index_12w);
  const f = Math.min(Math.max(Number(factor_pct) || 0, 0), constants.band_max_factor_pct);
  const adj = Math.min(Math.max(idx, -constants.band_trend_clamp_pct), constants.band_trend_clamp_pct);
  const center = a * (1 + adj / 100);
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    ok: true,
    anchor_value: a, anchor_n: n, index_12w: idx,
    trend_adj_pct: round1(adj), factor_pct: round1(f),
    center: r2(center), low: r2(center * (1 - f / 100)), high: r2(center * (1 + f / 100)),
  };
}

// ---------- 快照组装（build 的唯一纯函数入口） ----------

export function buildSnapshot(records, { today = null, constants = TREND_CONSTANTS } = {}) {
  const asOf = today ?? new Date().toISOString().slice(0, 10);
  const entities = buildEntityHistory(trendEligibleRecords(records), { today: asOf });
  const groups = groupByCommunity(entities);

  const communities = {};
  const indexed = [];   // [{ community, weekly }] —— 池聚合的输入
  const byDistrict = new Map();

  for (const g of groups) {
    const events = extractCommunityEvents(g.entities, { constants });
    const weekly = weeklyIndex(events, { constants });
    const index4 = cumulativeIndex(weekly, { window: constants.window_4w, asOf, constants });
    const index12 = cumulativeIndex(weekly, { window: constants.window_12w, asOf, constants });
    const hasIndex = weekly.some((w) => w.index != null);
    const allDates = communityCaptureDates(g.entities);
    communities[g.key] = {
      display: g.display,
      district: g.district,
      index_4w: index4,
      index_12w: index12,
      temperature: temperatureOf(index4, { constants }),
      right_side_weeks: rightSideWeeks(weekly, { constants }),
      n_events_12w: nEventsWindow(weekly, constants.window_12w, asOf),
      status: hasIndex ? 'indexed' : 'not_enough_data',
      weekly,
      coverage: {
        entities: g.entities.length,
        captures: g.entities.reduce((n, e) => n + (e.summary?.capture_count ?? 0), 0),
        first_capture: allDates[0] ?? null,
        last_capture: allDates[allDates.length - 1] ?? null,
      },
    };
    if (hasIndex) {
      indexed.push({ community: g.key, weekly, district: g.district });
      if (g.district) {
        if (!byDistrict.has(g.district)) byDistrict.set(g.district, []);
        byDistrict.get(g.district).push({ community: g.key, weekly });
      }
    }
  }

  function block(items) {
    const weekly = aggregateWeekly(items.map((i) => ({ weekly: i.weekly })));
    const index4 = cumulativeIndex(weekly, { window: constants.window_4w, asOf, constants });
    return {
      index_4w: index4,
      index_12w: cumulativeIndex(weekly, { window: constants.window_12w, asOf, constants }),
      temperature: temperatureOf(index4, { constants }),
      right_side_weeks: rightSideWeeks(weekly, { constants }),
      n_communities: items.length,
      weekly,
    };
  }

  const pool = indexed.length ? block(indexed) : null;
  const districts = {};
  for (const [name, arr] of byDistrict) {
    if (arr.length >= constants.min_district_communities) districts[name] = block(arr);
  }

  const calib = calibrate(collectAnchors(records), communities, { constants });
  return {
    schema: TREND_SCHEMA,
    as_of: asOf,
    constants,
    communities,
    pool,
    districts,
    calibration: { n: calib.n, hit_rate: calib.hit_rate, badge: calib.badge, excluded: calib.excluded },
  };
}
