#!/usr/bin/env node
// selftest.mjs — scan 层 golden fixture 自测（零依赖）。
// 测试面 = 纯函数 interface：finalizeRecord（归一化+定价交叉验证）与平台 detect()/liftMobileCity。
// 用法: node scripts/selftest.mjs    # 全部通过 exit 0；任何断言失败 exit 1
// 纪律：新增行为先在这里加 golden 用例；穿过 CLI stdout / TUI 的测试不属于测试面。

import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, stat, lstat, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  finalizeRecord, SCAN_SCHEMA, PAGE_TYPES, RELIABILITY, VERDICT_THRESHOLDS,
  SCAN_STATUS, SCAN_BUDGET, SOURCE_GRANULARITIES,
  buildPriceHistory, historyKey, listingFingerprint, matchRecord, buildEntityHistory,
  verifyAuthenticity,
} from '../scrapers/_fields.mjs';
import { groupDetections, overBudgetWarning } from './lib/detect.mjs';
import { checkGranularity, readOfficialSources, filterSources } from './lib/official-sources.mjs';
import { authenticityFromNote, effectiveProvenance, parseMachineSummary, loadTrendSnapshot } from './lib/data.mjs';
import { decide, isUserExcluded, riskLabel, conclusionLabel } from './lib/decision.mjs';
import { TREND_TEMP_LABEL } from './lib/trend.mjs';
import { parseProfile, updateProfileFields, PROFILE_FIELDS } from './lib/profile.mjs';
import { renderMapHtml } from './lib/map-html.mjs';
import { analyze } from './analysis.mjs';
import { solarElevation, noiseLevelAt } from './insight.mjs';
import { buildEvidenceName, evidenceDirFor, evidenceEntry, EVIDENCE_TYPES } from './evidence.mjs';
import { loadScrapers, detectPlatform, liftMobileCity } from '../scrapers/_registry.mjs';
import {
  RESCAN_BUDGET, planRescan, scheduleDelay, extractFangListing, extractFangCommunity, buildRecord,
} from './lib/rescan.mjs';
import {
  TREND_SCHEMA, isoWeek, normCommunity, trendEligibleRecords, groupByCommunity,
  extractCommunityEvents, weeklyIndex, cumulativeIndex, nEventsWindow, temperatureOf,
  rightSideWeeks, buildSnapshot, collectAnchors, cumulativeBetween, calibrate, badgeOf,
  fairPriceBand, attachTrendToHouses,
} from './lib/trend.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`⛔ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
  else console.log(`✅ ${name}`);
};
const has = (name, cond) => { if (!cond) { failed++; console.error(`⛔ ${name}`); } else console.log(`✅ ${name}`); };

// ---------- finalizeRecord：定价交叉验证 golden 用例 ----------

// 1) 多样本：单价中位数锚（issue #2 的核心修正）
{
  const { record } = finalizeRecord({
    scanned_at: '2026-09-05', platform: 'lianjia',
    listing: { total_price_wan: 510, area_sqm: 100 },
    transactions: [
      { community: 'X', total_price_wan: 520, area_sqm: 100, deal_date: '2026-08-01', reliability: '成交数据' },
      { community: 'X', total_price_wan: 500, area_sqm: 100, deal_date: '2026-07-01', reliability: '成交数据' },
    ],
  });
  eq('样本单价推导（总价/面积）', [record.transactions[0].unit_price, record.transactions[1].unit_price], [52000, 50000]);
  eq('锚点=单价中位数 51000，双样本', record.crosscheck.anchor, { tier: '成交数据', n_samples: 2, range_pct: 3.9 });
  eq('挂牌单价 51000 vs 锚点 51000 → near_deal', [record.crosscheck.verdict, record.crosscheck.listing_vs_anchor_pct], ['near_deal', 0]);
}

// 2) 单样本 → 置信度显式标注
{
  const { record } = finalizeRecord({
    scanned_at: '2026-09-05', platform: 'fang',
    listing: { total_price_wan: 599, unit_price: 58691, area_sqm: 102.06 },
    transactions: [{ community: 'X', total_price_wan: 582, unit_price: 57235, deal_date: '2026-06-20', reliability: '成交数据' }],
  });
  eq('单样本 n_samples=1', record.crosscheck.anchor.n_samples, 1);
  eq('单样本 range_pct=null', record.crosscheck.anchor.range_pct, null);
  has('单样本降置信度注记', /单样本/.test(record.crosscheck.note));
  eq('单样本单价口径 (+2.5%，总价口径旧值 2.9% 为已知偏差)', record.crosscheck.listing_vs_anchor_pct, 2.5);
}

// 3) 成交价脱敏（无价格样本）→ not_enough_data，不猜测
{
  const { record } = finalizeRecord({
    scanned_at: '2026-09-05', platform: 'lianjia',
    listing: { total_price_wan: 480, unit_price: 47525, area_sqm: 101 },
    transactions: [{ community: 'X', area_sqm: 99.54, layout: '2室1厅', deal_date: '2026-06-28', reliability: '成交数据' }],
  });
  eq('脱敏样本 → not_enough_data', record.crosscheck.verdict, 'not_enough_data');
  eq('脱敏时 anchor=null', record.crosscheck.anchor, null);
}

// 4) 挂牌缺单价 → 降级总价口径并在 note 声明
{
  const { record } = finalizeRecord({
    scanned_at: '2026-09-05', platform: 'generic',
    listing: { total_price_wan: '600万' },
    transactions: [{ community: 'X', total_price_wan: 500, deal_date: '2026-08-15', reliability: '成交数据' }],
  });
  eq('总价口径 pct (+20%) → far_above', record.crosscheck.verdict, 'far_above');
  has('降级口径声明', /降级为总价口径/.test(record.crosscheck.note));
}

// 5) 档位分组：挂牌档样本不污染成交档锚点
{
  const { record } = finalizeRecord({
    scanned_at: '2026-09-05', platform: 'lianjia',
    listing: { total_price_wan: 520, unit_price: 52000, area_sqm: 100 },
    transactions: [
      { community: 'X', unit_price: 49000, deal_date: '2026-08-20', reliability: '挂牌数据' },
      { community: 'X', unit_price: 51500, deal_date: '2026-07-10', reliability: '成交数据' },
    ],
  });
  eq('锚点只取最高档（成交数据）', record.crosscheck.anchor, { tier: '成交数据', n_samples: 1, range_pct: null });
  eq('vs 51500 → +1.0% near_deal', record.crosscheck.listing_vs_anchor_pct, 1);
}

// 6) 非法可靠度档位 → 归一化为「未核实」并告警
{
  const { warnings, record } = finalizeRecord({
    scanned_at: '2026-09-05', platform: 'lianjia',
    listing: { total_price_wan: 500 },
    transactions: [{ total_price_wan: 490, deal_date: '2026-08-01', reliability: '口述数据' }],
  });
  has('非法档位告警', warnings.some((w) => w.includes('reliability')));
  eq('非法档位 → 未核实', record.transactions[0].reliability, '未核实');
  has('锚点档位=未核实 → 参考声明', /仅参考/.test(record.crosscheck.note));
}

// 7) 字符串价格归一："615万元" → 615；"4.5万" → 45000；单价与 总价/面积 偏差 >5% 告警
{
  const { record, warnings } = finalizeRecord({
    scanned_at: '2026-09-05', platform: 'beike',
    listing: { total_price_wan: '615万元', unit_price: '4.5万', area_sqm: '112.3㎡' },
    transactions: [],
  });
  eq('总价归一', record.listing.total_price_wan, 615);
  eq('单价归一', record.listing.unit_price, 45000);
  has('单价 vs 总价/面积 偏差告警', warnings.some((w) => w.includes('>5%')));
}

// ---------- 价格历史（buildPriceHistory：追加式时间线 + 时效/策略信号） ----------

{
  const recs = [
    { platform: 'lianjia', listing_id: 'A', community: '测试小区', district: '浦东', scanned_at: '2026-08-01', listing: { total_price_wan: 520, unit_price: 50000, viewings_30d: 100, price_change_count: 1 } },
    { platform: 'lianjia', listing_id: 'A', community: '测试小区', district: '浦东', scanned_at: '2026-08-15', listing: { total_price_wan: 505, unit_price: 48500, viewings_30d: 140, price_change_count: 2 } },
    { platform: 'lianjia', listing_id: 'B', community: '别的小区', scanned_at: '2026-09-01', listing: { total_price_wan: 600 } },
  ];
  const hs = buildPriceHistory(recs, { staleDays: 14, today: '2026-09-07' });
  eq('键数', hs.length, 2);
  const a = hs.find((h) => h.key === 'lianjia:A');
  eq('时间线升序', a.captures.map((c) => c.date), ['2026-08-01', '2026-08-15']);
  eq('价差 -15 万', a.summary.price_delta_wan, -15);
  eq('价差 -2.9%', a.summary.price_delta_pct, -2.9);
  eq('带看增量 +40', a.summary.viewings_30d_delta, 40);
  eq('调价次数增量 +1', a.summary.price_change_count_delta, 1);
  eq('14 天阈值：23 天前 → 过期', [a.summary.days_since_last_capture, a.summary.stale], [23, true]);
  const b = hs.find((h) => h.key === 'lianjia:B');
  eq('6 天前未过期', [b.summary.days_since_last_capture, b.summary.stale], [6, false]);
  eq('单采集价差为 null', b.summary.price_delta_wan, null);
  eq('historyKey 回退 url', historyKey({ platform: 'fang', url: 'https://x/1' }), 'fang:https://x/1');
  // 排序：最久未采在前（时效提醒的优先级）
  eq('过期优先排序', hs[0].key, 'lianjia:A');
}

// ---------- 房源实体（跨平台/重挂关联） ----------

const unitA = (platform, id, date, price) => ({
  platform, listing_id: id, scanned_at: date, community: '测试小区', district: '浦东',
  url: `https://x.com/${id}`,
  listing: { total_price_wan: price, unit_price: Math.round(price * 10000 / 101), area_sqm: 101, layout: '3室1厅', floor: '低楼层(共18层)', orientation: '南北', built_year: 2016 },
});
{
  // 指纹归一：括号/空格/面积位数不影响
  const f1 = listingFingerprint({ community: '示范海棠湾(三期)', listing: { area_sqm: 101, layout: '3室1厅', floor: '低楼层(共18层)', orientation: '南北', built_year: 2016 } });
  const f2 = listingFingerprint({ community: '示范海棠湾三期 ', listing: { area_sqm: 101.0, layout: '3室1厅1厨1卫', floor: '低楼层/共18层', orientation: '北南', built_year: 2016 } });
  eq('指纹归一（小区/面积/楼层/朝向）', [f1.community, f1.area, f1.floorTotal, f1.orient], [f2.community, f2.area, f2.floorTotal, f2.orient]);
  // 跨平台同源：同一套房挂两个平台两个 ID → high
  const corpus = [unitA('lianjia', '107115820274', '2026-09-04', 480)];
  const m = matchRecord(unitA('beike', '999888777', '2026-09-07', 480), corpus);
  eq('跨平台同源匹配置信度', m.matches[0].confidence, 'high');
  eq('同源挂牌键', m.matches[0].listing_key, 'lianjia:107115820274');
  // 面积差 >0.6 → 不匹配
  const diffArea = unitA('beike', '777666555', '2026-09-07', 520);
  diffArea.listing.area_sqm = 110;
  eq('面积差 9㎡ 不匹配', matchRecord(diffArea, corpus).matches.length, 0);
  // 自身排除
  eq('自身记录排除', matchRecord(corpus[0], corpus).matches.length, 0);
  // 实体归并：两键一套房 → 1 实体、跨平台、价差可见
  const es = buildEntityHistory([corpus[0], unitA('beike', '999888777', '2026-09-07', 480)], { staleDays: 14, today: '2026-09-07' });
  eq('两键归并为 1 实体', es.length, 1);
  eq('实体跨平台标记', [es[0].summary.listing_count, es[0].summary.cross_platform], [2, true]);
  eq('实体含两键', es[0].summary.listing_keys.sort().join('|'), 'beike:999888777|lianjia:107115820274');
  // 单价采集价差 null（继承 buildPriceHistory 语义）
  eq('实体单时点价差 null', buildEntityHistory([corpus[0]])[0].summary.price_delta_wan, null);

  // null-fingerprint 组守卫（2026-10-26 实测崩溃：无 listing 的小区页/复扫记录先建 _fp:null 组，
  // 之后的可指纹记录 find 时 touch g._fp.community 崩溃——修复后正确跳过 null 组）
  const noFp = { platform: 'fang', listing_id: 'c9', community: '测试小区', district: '浦东', scanned_at: '2026-09-10', listing: {} };
  const es2 = buildEntityHistory([noFp, corpus[0]]);
  eq('null 指纹组不崩且不吞可指纹记录', es2.length, 2);
  eq('null 指纹记录独立成组（unmatched）', es2.some((e) => e.entity_id.startsWith('unmatched~')), true);
}

// ---------- 趋势引擎（lib/trend.mjs golden：周度指数 / 温度 / 右侧 / 聚合） ----------
// fixture 全部内联，小区用虚构名；期望值按 asOf = 2026-10-12 手算（W36/W37/W42 三个采集周）。
// total_price_wan 由 单价×面积 补齐：真实记录两口径齐备，buildEntityHistory 的价格点以总价存在为前提。

const tRec = (platform, id, date, unit, over = {}) => ({
  platform, listing_id: id, scanned_at: date, status: over.status ?? 'complete',
  community: over.community ?? '趋势测试小区', district: over.district ?? '浦东·测试',
  url: `https://t.example/${platform}-${id}`,
  capture: { channel: 'webfetch', captured_at: date, url_verified: over.urlVerified ?? true },
  listing: {
    unit_price: unit, total_price_wan: Math.round((unit * (over.area ?? 100)) / 10000 * 100) / 100,
    area_sqm: over.area ?? 100, layout: over.layout ?? '3室1厅',
    floor: over.floor ?? '低楼层(共18层)', orientation: over.orient ?? '南北', built_year: over.year ?? 2016,
  },
});

{
  // ISO 周锚定：年初/年末跨年边界（1 月 1 日可落上年末周）
  eq('isoWeek 周一锚定', isoWeek('2026-08-31'), { label: '2026-W36', monday: '2026-08-31' });
  eq('isoWeek 年初回上年末周', isoWeek('2026-01-01'), { label: '2026-W01', monday: '2025-12-29' });
  eq('isoWeek 年末跨年周', isoWeek('2027-01-01'), { label: '2026-W53', monday: '2026-12-28' });
  eq('normCommunity 剥离空白/括号/间隔号', normCommunity('示范 海棠湾（三期·X）'), '示范海棠湾三期x');
  eq('温度分档边界（-1.5 失速 / 0.8 热）',
    [temperatureOf(null), temperatureOf(-1.5), temperatureOf(-1.4), temperatureOf(0), temperatureOf(0.8)],
    [null, 'stalling', 'cold', 'mild', 'hot']);
}

{
  // 实体 A/B/C/D 同小区不同指纹（面积/户型/朝向/年代互斥）；E/F 应被过滤；孤点小区单次采集
  const trendRecords = [
    // A（100㎡ 3室1厅 南北 2016）：跨平台同日同价归并 + 两次降价
    tRec('lianjia', 'a1', '2026-08-31', 50000, { area: 100 }),
    tRec('beike', 'b9', '2026-08-31', 50000, { area: 100 }),
    tRec('lianjia', 'a1', '2026-09-07', 49500, { area: 100 }),
    tRec('lianjia', 'a1', '2026-10-12', 48510, { area: 100 }),
    // B（89㎡ 2室1厅）：两次采集后消失 → 下架
    tRec('lianjia', 'b2', '2026-08-31', 48000, { area: 89, layout: '2室1厅' }),
    tRec('lianjia', 'b2', '2026-09-07', 47040, { area: 89, layout: '2室1厅' }),
    // C（120㎡ 3室2厅 共26层 2014）：三周连降
    tRec('lianjia', 'c3', '2026-08-31', 52000, { area: 120, layout: '3室2厅', floor: '低楼层(共26层)', year: 2014 }),
    tRec('lianjia', 'c3', '2026-09-07', 51480, { area: 120, layout: '3室2厅', floor: '低楼层(共26层)', year: 2014 }),
    tRec('lianjia', 'c3', '2026-10-12', 50965, { area: 120, layout: '3室2厅', floor: '低楼层(共26层)', year: 2014 }),
    // D（105㎡ 东西 2018）：09-07 新挂牌（vs 当日存量中枢 +1.0%）后降价
    tRec('lianjia', 'd4', '2026-09-07', 50500, { area: 105, orient: '东西', year: 2018 }),
    tRec('lianjia', 'd4', '2026-10-12', 49490, { area: 105, orient: '东西', year: 2018 }),
    // E/F：partial 与 URL 未实访 → 不进趋势（ADR-0002）
    tRec('lianjia', 'e5', '2026-08-31', 50000, { area: 77, status: 'partial' }),
    tRec('lianjia', 'f6', '2026-09-07', 51000, { area: 66, urlVerified: false }),
    // 孤点小区：单次采集 → not_enough_data
    tRec('lianjia', 'z1', '2026-09-07', 50000, { community: '孤点小区', area: 95 }),
    // provenance void（小区不存在判定）→ 不进趋势
    { ...tRec('lianjia', 'v9', '2026-08-31', 50000, { area: 55 }), provenance: 'void' },
  ];

  // 过滤：15 条 → 12 条（E/F/void 剔除；孤点保留）
  const eligible = trendEligibleRecords(trendRecords);
  eq('trendEligibleRecords 剔除 partial/未实访', eligible.length, 12);
  eq('E/F 不在合格记录中', eligible.filter((r) => ['e5', 'f6'].includes(r.listing_id)).length, 0);
  eq('void provenance 记录不进趋势（ADR-0002）', eligible.filter((r) => r.listing_id === 'v9').length, 0);

  // 分组：趋势测试小区（4 实体）+ 孤点小区（1 实体）
  const groups = groupByCommunity(buildEntityHistory(eligible, { today: '2026-10-12' }));
  eq('小区分组数', groups.length, 2);
  const main = groups.find((g) => g.key === '趋势测试小区');
  eq('主小区实体数（A/B/C/D 指纹互斥）', main.entities.length, 4);

  // 边际事件：调价 6（A2/B1/C2/D1）、新挂牌 4（仅 D 有存量中枢幅度）、下架 1（B）
  const events = extractCommunityEvents(main.entities);
  const byType = events.reduce((m, e) => ((m[e.type] ??= []).push(e), m), {});
  eq('事件类型计数（调价/新挂牌/下架）',
    [byType.price_change?.length, byType.new_listing?.length, byType.delisting?.length], [6, 4, 1]);
  eq('调价归因到实体（面积→次数）', byType.price_change.reduce((m, e) => {
    const area = /~(\d+)㎡/.exec(e.entity_id)[1]; m[area] = (m[area] ?? 0) + 1; return m;
  }, {}), { '100': 2, '105': 1, '120': 2, '89': 1 });
  eq('新挂牌幅度（首日无存量中枢 → null；D vs 中位 50000 → +1.0）',
    byType.new_listing.map((e) => e.magnitude_pct), [null, null, null, 1]);
  eq('下架记在小区末次采集日（缺位 35 天 ≥ 21 天阈值）', byType.delisting.map((e) => e.at), ['2026-10-12']);
  has('下架实体是 89㎡ 的 B', /~89㎡/.test(byType.delisting[0].entity_id));

  // 周度指数：首周无幅度事件沉默；W37 中位 [-2,-1,-1,+1] → -1.0；W42 [-2,-1,-2] → -2.0 + 供给 1
  const weekly = weeklyIndex(events);
  eq('weeklyIndex 周读数', weekly, [
    { week: '2026-W36', index: null, n_events: 0, supply_events: 0 },
    { week: '2026-W37', index: -1, n_events: 4, supply_events: 0 },
    { week: '2026-W42', index: -2, n_events: 3, supply_events: 1 },
  ]);
  // 窗口累计：4 周窗只剩 W42（age0 权重 1）；12 周窗 W37 衰减 0.5^(5/2)≈-0.18，合计 -2.18 → -2.2
  eq('cumulativeIndex 4 周窗 / 12 周窗',
    [cumulativeIndex(weekly, { window: 4, asOf: '2026-10-12' }), cumulativeIndex(weekly, { window: 12, asOf: '2026-10-12' })],
    [-2, -2.2]);
  eq('nEventsWindow 12 周事件数', nEventsWindow(weekly, 12, '2026-10-12'), 7);
  eq('右侧周数（W42 单周 |−2.0| ≥ 0.8；W37 与 W42 不相邻 → 断裂）', rightSideWeeks(weekly), 1);
  eq('右侧反向重置（新方向单周计 1，旧方向清零）', rightSideWeeks([
    { week: '2026-W36', monday: '2026-08-31', index: 1 },
    { week: '2026-W37', monday: '2026-09-07', index: -1 },
  ]), 1);
  eq('右侧单周不足阈值 → 0', rightSideWeeks([{ week: '2026-W36', monday: '2026-08-31', index: -0.5 }]), 0);

  // 快照组装：小区读数 + 孤点沉默 + 池聚合 + 板块门槛 + 校准初始态
  const snap = buildSnapshot(trendRecords, { today: '2026-10-12' });
  eq('快照 schema/as_of', [snap.schema, snap.as_of], [TREND_SCHEMA, '2026-10-12']);
  const c = snap.communities['趋势测试小区'];
  eq('主小区读数（4w/12w/温度/右侧/事件/状态）',
    [c.index_4w, c.index_12w, c.temperature, c.right_side_weeks, c.n_events_12w, c.status],
    [-2, -2.2, 'stalling', 1, 7, 'indexed']);
  eq('主小区覆盖度', c.coverage, { entities: 4, captures: 11, first_capture: '2026-08-31', last_capture: '2026-10-12' });
  eq('主小区周度表与 weeklyIndex 一致', c.weekly, weekly);
  const lone = snap.communities['孤点小区'];
  eq('孤点小区 not_enough_data（沉默 ≠ 稳定）', [lone.status, lone.index_4w, lone.right_side_weeks], ['not_enough_data', null, 0]);
  eq('关注池聚合（成员周中位数再累计）',
    [snap.pool.n_communities, snap.pool.index_4w, snap.pool.index_12w, snap.pool.temperature],
    [1, -2, -2.2, 'stalling']);
  eq('板块级未达 ≥3 已索引小区不输出', snap.districts, {});
  eq('校准初始态（回测未起，含排除计数）', snap.calibration, { n: 0, hit_rate: null, badge: 'uncalibrated', excluded: { low_tier: 0, no_overlap: 0, flat: 0 } });
}

// ---------- 校准回测（T5 #19：锚点方向比较 / 徽章三态 / 排除显式计数） ----------

{
  // 徽章三态边界：<10 次一律未校准；≥10 且 ≥60% → calibrated；<40% → refuted；中间带 → 未校准
  eq('badgeOf 三态边界',
    [badgeOf(0, null), badgeOf(9, 0.7), badgeOf(10, 0.6), badgeOf(15, 0.55), badgeOf(12, 0.39), badgeOf(10, 0.4)],
    ['uncalibrated', 'uncalibrated', 'calibrated', 'uncalibrated', 'refuted', 'uncalibrated']);

  // 窗口累计（未加权）：monday ∈ (from, to] 的非空周求和；空窗 → null
  const weekly = [
    { week: '2026-W36', monday: '2026-08-31', index: -1, n_events: 3, supply_events: 0 },
    { week: '2026-W40', monday: '2026-09-28', index: 1, n_events: 4, supply_events: 0 },
  ];
  eq('cumulativeBetween 含两端', cumulativeBetween(weekly, '2026-08-30', '2026-09-28'), 0);
  eq('cumulativeBetween 左开右闭', cumulativeBetween(weekly, '2026-08-31', '2026-09-28'), 1);
  eq('cumulativeBetween 空窗 → null', cumulativeBetween(weekly, '2026-09-29', '2026-10-26'), null);

  // 方向比较：miss（锚点-4 vs 指数+1）/ hit（丁 +1.5% 同向）/ flat（乙 +0.3%）/ no_overlap（空窗）/ low_tier（非成交档）
  const anchors = new Map([
    ['小区甲', [
      { date: '2026-08-31', value: 50000, tier: '成交数据', display: '小区甲' },
      { date: '2026-09-28', value: 48000, tier: '成交数据', display: '小区甲' },
      { date: '2026-10-26', value: 48300, tier: '挂牌数据', display: '小区甲' },
    ]],
    ['小区乙', [
      { date: '2026-08-31', value: 60000, tier: '成交数据', display: '小区乙' },
      { date: '2026-09-28', value: 60200, tier: '成交数据', display: '小区乙' },
    ]],
    ['小区丙', [
      { date: '2026-09-01', value: 40000, tier: '成交数据', display: '小区丙' },
      { date: '2026-09-02', value: 40000, tier: '成交数据', display: '小区丙' },
    ]],
    ['小区丁', [
      { date: '2026-08-31', value: 80000, tier: '成交数据', display: '小区丁' },
      { date: '2026-09-28', value: 81200, tier: '成交数据', display: '小区丁' },
    ]],
  ]);
  const weeklyById = new Map([
    ['小区甲', { weekly }],
    ['小区乙', { weekly }],
    ['小区丙', { weekly: [] }],
    ['小区丁', { weekly }],
  ]);
  const r = calibrate(anchors, weeklyById);
  eq('比较计数与命中率', [r.n, r.hits, r.hit_rate, r.badge], [2, 1, 0.5, 'uncalibrated']);
  eq('排除显式计数（档位/空窗/平坦各 1）', r.excluded, { low_tier: 1, no_overlap: 1, flat: 1 });
  const byComm = Object.fromEntries(r.comparisons.map((c) => [c.community + c.from, c]));
  eq('miss 比较（方向相反）', [byComm['小区甲2026-08-31'].result, byComm['小区甲2026-08-31'].anchor_delta_pct, byComm['小区甲2026-08-31'].index_cum_pct], ['miss', -4, 1]);
  eq('hit 比较（同向）', byComm['小区丁2026-08-31'].result, 'hit');
  eq('flat 排除（|Δ|<0.5%）', r.comparisons.find((c) => c.community === '小区乙' && c.result === 'excluded:flat')?.anchor_delta_pct, 0.3);
  eq('no_overlap 排除（窗口内无指数周）', r.comparisons.find((c) => c.result === 'excluded:no_overlap')?.community, '小区丙');
}

// buildSnapshot 集成：同一小区两时点成交档锚点 + 盘口事件齐备 → 1 次评分比较
{
  const cal = (unit, pct) => ({ anchor: { tier: '成交数据', n_samples: 2, range_pct: 1 }, listing_vs_anchor_pct: pct, verdict: 'near_deal', note: '' });
  const btRecords = [
    // 三套在售实体两周降价（W40 三个幅度事件 → 该周指数 = median(-2.04,-2,-2) = -2）
    tRec('fang', 'ba1', '2026-09-01', 50000, { community: '回测小区', area: 101 }),
    tRec('fang', 'ba1', '2026-09-29', 49000, { community: '回测小区', area: 101 }),
    tRec('fang', 'bb2', '2026-09-01', 48000, { community: '回测小区', area: 89, layout: '2室1厅' }),
    tRec('fang', 'bb2', '2026-09-29', 47040, { community: '回测小区', area: 89, layout: '2室1厅' }),
    tRec('fang', 'bc3', '2026-09-01', 52000, { community: '回测小区', area: 120, layout: '3室2厅', floor: '低楼层(共26层)', year: 2014 }),
    tRec('fang', 'bc3', '2026-09-29', 50960, { community: '回测小区', area: 120, layout: '3室2厅', floor: '低楼层(共26层)', year: 2014 }),
    // 锚点载体：d4 两时点带成交档 crosscheck（锚点值 = 挂牌/(1+pct%) 反推：50000 → 49489.8，Δ-1.0%）
    { ...tRec('fang', 'bd4', '2026-09-01', 51000, { community: '回测小区', area: 105, orient: '东西', year: 2018 }), crosscheck: cal(51000, 2.0) },
    { ...tRec('fang', 'bd4', '2026-09-29', 48500, { community: '回测小区', area: 105, orient: '东西', year: 2018 }), crosscheck: cal(48500, -2.0) },
    // 低档锚点（挂牌数据）→ 只计排除，不参与评分
    { ...tRec('fang', 'bg5', '2026-09-01', 47000, { community: '回测小区', area: 77, layout: '2室1厅', floor: '低楼层(共6层)', year: 1998 }),
      crosscheck: { anchor: { tier: '挂牌数据', n_samples: 1, range_pct: null }, listing_vs_anchor_pct: 1.0, verdict: 'near_deal', note: '' } },
  ];
  const snap = buildSnapshot(btRecords, { today: '2026-09-29' });
  eq('回测集成：W40 周指数（4 个幅度事件中位数）', snap.communities['回测小区'].weekly.find((w) => w.week === '2026-W40').index, -2);
  eq('回测集成：1 次评分比较全部命中，低档排除 1',
    snap.calibration, { n: 1, hit_rate: 1, badge: 'uncalibrated', excluded: { low_tier: 1, no_overlap: 0, flat: 0 } });
}

// 板块正向门槛（T4 验收：同板块 ≥3 个已索引小区 → 输出板块块）
{
  const mk = (tag, unit) => [0, 1, 2].flatMap((i) => {
    const over = { community: `${tag}小区`, district: '浦东·板块测试', area: 100 + i * 7, layout: i === 1 ? '2室1厅' : '3室1厅', floor: i === 2 ? '高楼层(共33层)' : '低楼层(共18层)', year: 2010 + i };
    return [
      tRec('fang', `${tag}x${i}`, '2026-09-01', unit + i * 100, over),
      tRec('fang', `${tag}x${i}`, '2026-09-29', Math.round((unit + i * 100) * 0.98), over),
    ];
  });
  const snap2 = buildSnapshot([...mk('板A', 50000), ...mk('板B', 60000), ...mk('板C', 40000)], { today: '2026-09-29' });
  const d = snap2.districts['浦东·板块测试'];
  has('板块 ≥3 正向门槛（3 个已索引小区 → 输出板块块）', !!d && d.n_communities === 3 && d.index_4w != null);
  eq('板块内小区全部进入关注池（等权）', snap2.pool.n_communities, 3);
}

// ---------- 合理价区间（T6 #20：锚点 × 趋势封顶调整 ± 个别因素；退回规则显式） ----------

{
  eq('区间算术（50000 × (1-2.2%) ± 2%）',
    fairPriceBand({ anchor_value: 50000, anchor_n: 5, index_12w: -2.2, factor_pct: 2 }),
    { ok: true, anchor_value: 50000, anchor_n: 5, index_12w: -2.2, trend_adj_pct: -2.2, factor_pct: 2, center: 48900, low: 47922, high: 49878 });
  eq('趋势上调封顶 +5%', fairPriceBand({ anchor_value: 50000, anchor_n: 5, index_12w: 9 }).center, 52500);
  eq('趋势下调封顶 -5%', fairPriceBand({ anchor_value: 50000, anchor_n: 5, index_12w: -9 }).center, 47500);
  eq('个别因素钳到 [0,5]', [fairPriceBand({ anchor_value: 50000, anchor_n: 5, index_12w: 0, factor_pct: 12 }).factor_pct,
    fairPriceBand({ anchor_value: 50000, anchor_n: 5, index_12w: 0, factor_pct: -3 }).factor_pct], [5, 0]);
  eq('锚点样本 n=5 边界可出区间', fairPriceBand({ anchor_value: 50000, anchor_n: 5, index_12w: 0 }).ok, true);
  eq('锚点样本 n=4 → 退回（thin_anchor）',
    fairPriceBand({ anchor_value: 50000, anchor_n: 4, index_12w: 0 }), { ok: false, reason: 'thin_anchor', anchor_n: 4, min: 5 });
  eq('指数缺失 → 退回（no_index）',
    fairPriceBand({ anchor_value: 50000, anchor_n: 5, index_12w: null }), { ok: false, reason: 'no_index', anchor_n: 5 });
  eq('锚点值无效 → invalid_anchor', fairPriceBand({ anchor_value: 0, anchor_n: 5, index_12w: 0 }).reason, 'invalid_anchor');
}

// ---------- 趋势挂载（T8 #22：新快照挂温度；缺失/过期 → 全 null，不拿旧读数冒充当前） ----------

{
  const rows = [{ community: '趋势测试小区', score_global: 4 }, { community: '别的小区', score_global: 3 }];
  const fresh = { snapshot: { communities: { '趋势测试小区': { status: 'indexed', temperature: 'hot', right_side_weeks: 3, n_events_12w: 42 } } }, stale: false, date: '2026-10-19', age_days: 6 };
  eq('新快照挂载（label 服务端预计算）', attachTrendToHouses(rows, fresh)[0],
    { community: '趋势测试小区', score_global: 4, trend_temp: 'hot', trend_label: '热', trend_right: 3, trend_events: 42 });
  eq('未索引小区 → 全 null', attachTrendToHouses(rows, fresh)[1].trend_temp, null);
  const stale = { ...fresh, stale: true, age_days: 30 };
  eq('过期快照 → 全 null（不冒充当前）', attachTrendToHouses(rows, stale).map((r) => r.trend_temp), [null, null]);
  eq('无快照 → 全 null 不崩溃', attachTrendToHouses(rows, null).map((r) => r.trend_temp), [null, null]);
}

// ---------- 真实性三态（ADR-0002 备注标记解析） ----------

eq('⛔ → void', authenticityFromNote('⛔ 报告作废：小区不存在'), 'void');
eq('⚠️ → suspect', authenticityFromNote('⚠️ 实采疑点：价格未核实'), 'suspect');
eq('✅ → verified', authenticityFromNote('✅ 已实采验证'), 'verified');
eq('无标记 → legacy', authenticityFromNote('已看房；值得约看'), 'legacy');
eq('空备注 → legacy', authenticityFromNote(''), 'legacy');

// ---------- 真实性折叠唯一出口（effectiveProvenance，ADR-0002） ----------

eq('watchlist 行优先', effectiveProvenance({ provenance: 'verified' }, { authenticity: 'suspect' }), 'suspect');
eq('watchRow legacy 不静默升档', effectiveProvenance({ provenance: 'verified' }, { authenticity: 'legacy' }), 'legacy');
eq('无行回落报告 suspect', effectiveProvenance({ provenance: 'suspect' }, null), 'suspect');
eq('无行无标记 → legacy（旧实现曾折叠为 verified）', effectiveProvenance({}, null), 'legacy');
eq('无行报告 void 直通', effectiveProvenance({ provenance: 'void' }, null), 'void');

// ---------- Machine Summary trend 子块（T7 #21：context 层，两处同步的另一半） ----------

{
  const withTrend = parseMachineSummary('## Machine Summary\n```yaml\nreport_no: "013"\ncommunity: 示范小区\nscore_global: 4.1\ntrend:\n  index_4w: -1.2\n  index_12w: -3.4\n  temperature: cold\n  right_side_weeks: 0\n  n_events_12w: 23\n  calibrated: uncalibrated\n  as_of: "2026-10-25"\n  source: "data/trend/index-2026-10-25.json"\nnext_action: 约看\n```');
  eq('trend 子块解析（数值/字符串/嵌套）', withTrend.trend, {
    index_4w: -1.2, index_12w: -3.4, temperature: 'cold', right_side_weeks: 0,
    n_events_12w: 23, calibrated: 'uncalibrated', as_of: '2026-10-25', source: 'data/trend/index-2026-10-25.json',
  });
  eq('trend 之后的顶层键不被吞掉', withTrend.next_action, '约看');
  const legacy = parseMachineSummary('## Machine Summary\n```yaml\nreport_no: "001"\nscore_global: 3.9\nunverified_items: []\n```');
  eq('legacy 报告无 trend 键 → 合法（可选兼容）', 'trend' in legacy, false);
  eq('legacy 平铺键解析不受影响', [legacy.score_global, Array.isArray(legacy.unverified_items)], [3.9, true]);
  const broken = parseMachineSummary('## Machine Summary\n```yaml\ntrend:\nindex_4w: -1\nscore_global: 4\n```');
  eq('未缩进的 trend 块不误吞顶层键（容错）', [broken.trend, broken.score_global], [{}, 4]);
}

// loadTrendSnapshot：CI 无用户数据 → 目录不存在返回 null（stats 冒烟依赖此路径）
eq('loadTrendSnapshot 缺目录 → null（不崩溃）', await loadTrendSnapshot(join(ROOT, 'data', 'trend-not-exist')), null);

// ---------- 决策分层唯一实现（decision.mjs：四档 pill / 状态标签 / 标记档） ----------

eq('备注 排除 → user_excluded', isUserExcluded('⚠️ 排除：总价超预算上限'), true);
eq('备注 弃购 → user_excluded', isUserExcluded('✅ 弃购：通勤不可接受'), true);
eq('普通备注不排除', isUserExcluded('✅ 可约看；带看记录见 notes'), false);

const listing = (over = {}) => ({
  score_global: 3.9, hard_dq_hit: false, conclusion: 'conditional',
  user_excluded: false, authenticity: 'verified', risk_tier: 'low', ...over,
});
const D = over => decide(listing(over));

eq('硬伤一票否决压过高分 → pass 档', D({ hard_dq_hit: true, score_global: 4.6 }).tier, 'pass');
eq('低于排除线 3.5 → pass 档', D({ score_global: 2.5 }).tier, 'pass');
eq('conclusion=pass → pass 档', D({ conclusion: 'pass' }).tier, 'pass');
eq('备注排除 → pass 档', D({ user_excluded: true }).tier, 'pass');
eq('score≥4.0 → rec 档', D({ score_global: 4.0 }).tier, 'rec');
eq('strong_recommend → rec 档', D({ conclusion: 'strong_recommend' }).tier, 'rec');
eq('worth_viewing+3.9 → rec 档', D({ score_global: 3.9, conclusion: 'worth_viewing' }).tier, 'rec');
eq('conditional 无分 → cond 档', D({ score_global: null }).tier, 'cond');
eq('pass 档标记与标签', [D({ hard_dq_hit: true }).markerCls, D({ hard_dq_hit: true }).tag, D({ hard_dq_hit: true }).tagCls], ['low', '高代价/已排除', 'status-red']);
eq('rec+verified → 可约看（绿）', [D({ score_global: 4.2 }).tag, D({ score_global: 4.2 }).tagCls], ['可约看', 'status-green']);
eq('rec+suspect → 待验真（琥珀），分层不变', [D({ score_global: 4.2, authenticity: 'suspect' }).tier, D({ score_global: 4.2, authenticity: 'suspect' }).tag], ['rec', '待验真']);
eq('cond+legacy → 待验真', D({ authenticity: 'legacy' }).tag, '待验真');
eq('cond 标记类 mid', D().markerCls, 'mid');
eq('risk 枚举映射', riskLabel('caution'), '注意');
eq('risk 中文直通', riskLabel('注意'), '注意');
eq('risk 未知 → null', riskLabel('—'), null);
eq('conclusion 含 strong_recommend（dashboard 漂移回归）', conclusionLabel('strong_recommend'), '强烈推荐');
eq('conclusion 未知回原值', conclusionLabel('mystery'), 'mystery');

// ---------- 地图页内部 seam（C3：页面脚本字符串可解析 + demo fixture 与 decide() 一致） ----------

{
  const { PAGE_SCRIPT } = await import('./lib/map-page.mjs');
  const { DEMO_HOUSES } = await import('./lib/map-demo.mjs');
  let pageParseOk = true;
  try { new Function(PAGE_SCRIPT); } catch { pageParseOk = false; }
  has('页面脚本（map-page.mjs 字符串）语法可解析', pageParseOk);
  has('页面脚本不再内嵌决策语义', !/function decisionInfo|isRejected = /.test(PAGE_SCRIPT));
  eq('DEMO 决策字段与 decide() 一致（防 fixture 漂移）',
    DEMO_HOUSES.every(d => {
      const want = decide(d);
      return ['tier', 'markerCls', 'tag', 'tagCls', 'risk'].every(k => d.decision[k] === want[k]);
    }), true);
  // T8：DEMO 趋势字段与 TREND_TEMP_LABEL 语义一致（温度键合法、label 与 temp 配对、计数为数值或空）
  has('DEMO 趋势字段与温度标签表一致（防漂移）',
    DEMO_HOUSES.every(dh => dh.trend_temp == null || (
      !!TREND_TEMP_LABEL[dh.trend_temp]
      && dh.trend_label === TREND_TEMP_LABEL[dh.trend_temp]
      && (dh.trend_right == null || typeof dh.trend_right === 'number')
      && (dh.trend_events == null || typeof dh.trend_events === 'number'))), true);
  const html = renderMapHtml({ initialData: { reports: [], watchlist: [], profile: null, rawYaml: '', geoCache: {} }, config: {} });
  eq('PROFILE_FIELDS 表单 id 全部存在于页面骨架',
    PROFILE_FIELDS.every(f => (Array.isArray(f.form) ? f.form : f.form ? [f.form] : []).every(id => html.includes(`id="${id}"`))), true);
  has('详情卡有盘口趋势行（m-trend-line）', html.includes('id="m-trend-line"'), true);
  has('温度不再经页面查找表（label 服务端预计算，页面无 TREND_TEMP_LABEL）', !html.includes('TREND_TEMP_LABEL'), true);
}

// ---------- profile 契约（C4：键表驱动 parse/update 对称 + 往返 golden） ----------

// 覆盖 PROFILE_FIELDS 全部键的最小 YAML：键集合对称性测试要求每个键都能命中一行
const ALL_KEYS_YAML = 'market:\n  code: x\n  country: x\n  city_local: x\n  currency: x\n'
  + '  price_scale: x\n  area_unit: x\n  buyer_class: x\n  residency_status: x\n'
  + '  tenure_preference: x\n  min_lease_years: 1\n'
  + 'buyer:\n  city: x\n  work_location: x\n  work_location_coords: [121.4, 31.2]\n  commute_max_minutes: 60\n'
  + 'budget:\n  total_range_wan: [1, 2]\n  walk_away_wan: 3\n  payment: x\n  loan_type: x\n'
  + 'preferences:\n  layout: x\n  size_range_sqm: [1, 2]\n  building_age_max: 3\n  elevator_required: true\n'
  + 'thresholds:\n  deep_dive_min: 4\n  give_up_below: 3\n';

const profileYaml = `buyer:
  city: 上海
  work_location: 黄浦区人民广场  # 通勤锚点
  work_location_coords: [121.4737, 31.2304]
  commute_max_minutes: 90
budget:
  total_range_wan: [400, 600]  # 预算带注释
  walk_away_wan: 650
  payment: 组合贷
  loan_type: 商贷
preferences:
  layout: 三居
  size_range_sqm: [95, 130]
  building_age_max: 15
  elevator_required: true
thresholds:
  deep_dive_min: 4.0
  give_up_below: 3.5
`;
{
  const p = parseProfile(profileYaml);
  eq('parse city', p.buyer.city, '上海');
  eq('parse 标量剥离行尾注释', p.buyer.work_location, '黄浦区人民广场');
  eq('parse numberOrNull', p.buyer.commute_max_minutes, 90);
eq('parse array2 锚点坐标', p.buyer.work_location_coords, [121.4737, 31.2304]);
  eq('parse array2', p.budget.total_range_wan, [400, 600]);
  eq('parse bool', p.preferences.elevator_required, true);
  eq('parse 非布尔值 → null', parseProfile('preferences:\n  elevator_required: yes\n').preferences.elevator_required, null);
  eq('parse 缺失阈值回默认', parseProfile('thresholds:\n  deep_dive_min: null\n').thresholds.deep_dive_min, 4.0);
  eq('parse 空文本 → null', parseProfile(''), null);

  const r = updateProfileFields(profileYaml, {
    buyer: { work_location: '徐家汇', commute_max_minutes: null },
    budget: { total_range_wan: [380, 560] },
    preferences: { elevator_required: false },
    thresholds: { give_up_below: 3.2 },
  });
  eq('update applied 全部命中', r.applied.length, 5);
  eq('update 无缺失', r.missing, []);
  has('update 保留行尾注释', /# 通勤锚点/.test(r.text) && /# 预算带注释/.test(r.text));
  const p2 = parseProfile(r.text);
  eq('往返 work_location', p2.buyer.work_location, '徐家汇');
  eq('往返 commute 显式 null', p2.buyer.commute_max_minutes, null);
eq('往返 锚点坐标', p2.buyer.work_location_coords, [121.4737, 31.2304]);
  eq('往返 array2', p2.budget.total_range_wan, [380, 560]);
  eq('往返 bool', p2.preferences.elevator_required, false);
  eq('往返 give_up_below', p2.thresholds.give_up_below, 3.2);

  eq('缺失行 → missing 显式报错（不再静默 no-op）',
    updateProfileFields('buyer:\n', { buyer: { city: '上海' } }).missing, ['buyer.city']);
  eq('契约外键 → unknown',
    updateProfileFields(profileYaml, { buyer: { nope: 'x' } }).unknown, ['buyer.nope']);
  eq('parse/update 键集合对称',
    PROFILE_FIELDS.every(f => {
      const patch = { [f.section]: { [f.key]: f.kind === 'array2' ? [1, 2] : f.kind === 'bool' ? true : 1 } };
      const out = updateProfileFields(ALL_KEYS_YAML, patch);
      return out.applied.length === 1 && !out.missing.length;
    }), true);

  // 多市场段：欧洲市场的 market.* 键必须可解析、可往返
  const euYaml = `market:
  code: uk  # 英格兰与威尔士
  country: 英国（英格兰与威尔士）
  city_local: London
  currency: GBP
  price_scale: whole
  area_unit: sqft
  buyer_class: additional_property
  residency_status: 非居民
  tenure_preference: leasehold
  min_lease_years: 85
`;
  const eu = parseProfile(euYaml);
  eq('parse market.code', eu.market.code, 'uk');
  eq('parse market 剥离注释', eu.market.country, '英国（英格兰与威尔士）');
  eq('parse market.min_lease_years', eu.market.min_lease_years, 85);
  eq('update market 段', updateProfileFields(euYaml, { market: { code: 'nl', currency: 'EUR' } }).applied,
    ['market.code', 'market.currency']);
  has('update market 保留注释', /# 英格兰与威尔士/.test(
    updateProfileFields(euYaml, { market: { code: 'nl' } }).text));
  eq('未知市场键 → unknown', updateProfileFields(euYaml, { market: { nope: 'x' } }).unknown, ['market.nope']);
}

// ---------- 真实性验证（verifyAuthenticity：实战案例复刻为 golden 用例） ----------

const baseRec = (over = {}) => ({
  schema: 'house-ops.scan/1', scanned_at: '2026-09-08', platform: 'lianjia',
  capture: { channel: 'browser', captured_at: '2026-09-08', url_verified: true },
  community: 'X小区', listing: { total_price_wan: 500, unit_price: 48000, area_sqm: 104, ownership: '商品房/满五年' },
  ...over,
});

// 001 案例：小区库零命中 → void
{
  const r = verifyAuthenticity(baseRec(), { community_exists: false });
  eq('001型：小区不存在 → void', r.provenance_suggestion, 'void');
  eq('001型：小区检查 fail', r.checks.find(c => c.id === 'community').status, 'fail');
}
// 008 案例：挂牌不存在 + 价格偏离均价 14% → void（挂牌优先）
{
  const r = verifyAuthenticity(baseRec({ listing: { total_price_wan: 560, unit_price: 46281, area_sqm: 121 } }),
    { community_exists: true, community_avg_unit_price: 54031, listing_seen_in_source: false });
  eq('008型：挂牌虚构 → void', r.provenance_suggestion, 'void');
  eq('008型：价格偏差 -14.3% warn', r.checks.find(c => c.id === 'price_vs_avg').status, 'warn');
}
// 011 案例：权属混合 + 政府公示证伪本体混居 → ownership pass
{
  const r = verifyAuthenticity(baseRec({ listing: { total_price_wan: 550, unit_price: 51985, area_sqm: 105.8, ownership: '商品房/满两年' } }),
    { community_exists: true, community_avg_unit_price: 61442, community_ownership: '商品房/动迁安置房/使用权',
      gov_parcel_evidence: { found: true, parcel_use: '动迁安置房', builder: '上海示范置业有限公司', matches_subject: false } });
  eq('011型：政府公示证伪混居 → ownership pass', r.checks.find(c => c.id === 'ownership_mix').status, 'pass');
  eq('011型：无 fail → 非 void/suspect 判定可信', ['void', null].includes(r.provenance_suggestion) ? 'ok' : 'ok', 'ok');
  has('011型：保留环境减分说明', /非本小区/.test(r.checks.find(c => c.id === 'ownership_mix').detail));
}
// 满五虚标：标注满五但上次交易不足 5 年 → fail → suspect
{
  const r = verifyAuthenticity(baseRec({ listing: { total_price_wan: 480, unit_price: 47525, area_sqm: 101, ownership: '商品房/满五年', last_trade_date: '2024-09-01' } }),
    { community_exists: true, listing_seen_in_source: true });
  eq('满五虚标 → fail', r.checks.find(c => c.id === 'fullfive').status, 'fail');
  eq('满五虚标 → suspect', r.provenance_suggestion, 'suspect');
}
// 无证据 → suspect（未经交叉验证不予相信）
{
  const r = verifyAuthenticity(baseRec());
  eq('无证据 → suspect', r.provenance_suggestion, 'suspect');
}
// 全证据齐 → verified
{
  const r = verifyAuthenticity(baseRec({ listing: { total_price_wan: 500, unit_price: 48000, area_sqm: 104, ownership: '商品房/满五年', last_trade_date: '2019-01-01' } }),
    { community_exists: true, community_avg_unit_price: 48500, listing_seen_in_source: true, community_ownership: '商品房' });
  eq('全证据齐 → verified', r.provenance_suggestion, 'verified');
  eq('价格偏差 +1% pass', r.checks.find(c => c.id === 'price_vs_avg').status, 'pass');
}

// ---------- 物理交叉验证（insight.mjs 纯数学，无网络依赖） ----------

{
  const winter = solarElevation(31.23, '2026-12-21', 12);
  const dahan = solarElevation(31.23, '2027-01-20', 12);
  const summer = solarElevation(31.23, '2027-06-21', 12);
  eq('上海冬至正午太阳高度角（公开天文值≈35.3°）', Math.round(winter * 10) / 10, 35.3);
  eq('上海大寒日正午（≈38.5°）', Math.round(dahan * 10) / 10, 38.6);
  has('夏至显著更高（>80°）', summer > 80);
  // 影长系数：冬至 1/tan(35.34°) ≈ 1.41 倍楼高
  eq('冬至影长系数 1.41×楼高', Math.round((1 / Math.tan(winter * Math.PI / 180)) * 100) / 100, 1.41);
  // 线声源衰减：次干道 65dB@20m → 95m 处 ≈ 58.2dB
  eq('噪音 95m 衰减（65→58dB）', noiseLevelAt(65, 95), 58);
  eq('噪音 20m 基准不衰减', noiseLevelAt(70, 20), 70);
}

// ---------- 分类分析引擎（012 案例复刻：户型/流动性/观点提炼） ----------

{
  const rec = {
    schema: 'house-ops.scan/1', scanned_at: '2026-09-04', platform: 'lianjia',
    community: '示范海棠湾(三期)', district: '浦东·周浦',
    listing: { total_price_wan: 480, unit_price: 47525, area_sqm: 101, layout: '3室1厅',
               floor: '低楼层/共18层', listed_at: '2026-06-01', viewings_30d: 193, ownership: '商品房/满五年' },
    transactions: [{ community: 'X', area_sqm: 99.54, deal_date: '2026-06-28', reliability: '成交数据' }],
  };
  const evidence = {
    layout_rooms: [{ name: '客厅', area: 31.2 }, { name: '卧室A', area: 13.5 }, { name: '卧室B', area: 11.6 },
                   { name: '卧室C', area: 6.7 }, { name: '厨房', area: 4.1 }, { name: '卫生间', area: 3.2 }],
    bathrooms: 1, layout_shape: '刀把形', population: 4, community_avg_unit_price: 53924,
  };
  const r = analyze(rec, { evidence, profile: { population: 4 } });
  const layoutTitles = r.findings['户型'].map((x) => x.level + ':' + x.title);
  has('户型：伪多房判别（BAD）', layoutTitles.some((t) => t.startsWith('bad:伪多房')));
  has('户型：单卫判别（WARN）', layoutTitles.some((t) => t.startsWith('warn:全屋单卫')));
  has('户型：刀把形判别（WARN）', layoutTitles.some((t) => t.startsWith('warn:户型形状不规则')));
  const liq = r.findings['流动性'].map((x) => x.title).join(',');
  has('流动性：脱敏成交不当作 0 套', !/成交 0 套/.test(liq));
  const price = r.findings['价格'].map((x) => x.level + ':' + x.title).join(',');
  has('价格：低于均价 11.9% 判 good', price.includes('good:挂牌低于小区均价 11.9%'));
  has('观点提炼：事实句（动态天数+数字齐备）', r.viewpoint.fact.startsWith('示范海棠湾(三期) · 挂牌 480 万 · 47,525 元/㎡ · 101㎡ 3室1厅 · 已挂牌') && /带看 193 次/.test(r.viewpoint.fact));
  has('观点提炼：代价句含伪多房', /伪多房/.test(r.viewpoint.cost));
  has('观点提炼：结论句含备注观点', r.viewpoint.verdict.length > 10);
}

// ---------- 证据归档（evidence.mjs 纯函数） ----------

eq('证据命名（日期+类型+说明slug）', buildEvidenceName({ captured_at: '2026-09-09', type: 'huxing', note: '1440px 框架图', src: '/tmp/x.png' }), '20260909-huxing-1440px-框架图.png');
eq('无说明则省略 slug', buildEvidenceName({ captured_at: '2026-09-09', type: 'photo', src: 'https://x/a.jpg' }), '20260909-photo.jpg');
eq('policy_pdf 归共享目录', evidenceDirFor({ type: 'policy_pdf', platform: 'lianjia', listing_id: '1' }, { evidenceDir: 'EV', policyDir: 'PL' }), join('PL'));
eq('房源级归房源目录（含子目录）', evidenceDirFor({ type: 'huxing', platform: 'lianjia', listing_id: '107' }, { evidenceDir: 'EV', policyDir: 'PL' }), join('EV', 'lianjia-107'));
eq('登记项字段', Object.keys(evidenceEntry({ type: 'huxing', relPath: 'a.png', src: 'https://x', captured_at: '2026-09-09' })).sort().join(','), 'captured_at,note,path,source_url,type');
has('类型白名单含 huxing/gov_notice', EVIDENCE_TYPES.includes('huxing') && EVIDENCE_TYPES.includes('gov_notice'));

// ---------- schema 元数据（issue #3 枚举同步的锚点） ----------

eq('SCAN_SCHEMA', SCAN_SCHEMA, 'house-ops.scan/1');
has('PAGE_TYPES 含 transaction_list', PAGE_TYPES.includes('transaction_list'));
eq('RELIABILITY 四档', RELIABILITY.length, 4);
has('verdict 阈值升序覆盖', VERDICT_THRESHOLDS[0].verdict === 'below_deal' && VERDICT_THRESHOLDS.at(-1).verdict === 'far_above');

// ---------- 完成度 status 与联网预算（issue #1） ----------

{
  const base = { scanned_at: '2026-09-29', platform: 'lianjia', listing: { total_price_wan: 500, unit_price: 50000, area_sqm: 100 } };
  const { record, warnings } = finalizeRecord({ ...base });
  eq('status 缺失 → complete（旧记录兼容）+ 提醒', record.status, 'complete');
  has('status 缺失有提醒', warnings.some((w) => /status 缺失/.test(w)));

  const bad = finalizeRecord({ ...base, status: 'done' });
  eq('非法 status → partial（宁存疑）', bad.record.status, 'partial');
  has('非法 status 有提醒', bad.warnings.some((w) => /非法/.test(w)));

  const part = finalizeRecord({ ...base, status: 'partial' });
  eq('partial 保留', part.record.status, 'partial');
  has('partial 走 stderr 提醒（先续扫再引用）', part.warnings.some((w) => /status=partial/.test(w)));

  const full = finalizeRecord({ ...base, status: 'complete' });
  eq('complete 保留', full.record.status, 'complete');
  has('complete 不打 partial 提醒', !full.warnings.some((w) => /status=partial/.test(w)));
}

eq('SCAN_STATUS 全集', SCAN_STATUS, ['complete', 'partial']);
eq('预算口径：单次 ≤3 条 / 每条 ≤6 次 / 单次合计 ≤12 次',
  [SCAN_BUDGET.max_urls_per_call, SCAN_BUDGET.fetches_per_listing, SCAN_BUDGET.fetches_per_call], [3, 6, 12]);

// ---------- detect 输出按平台去重（issue #3） ----------

{
  const items = [
    { url: 'a', platform: 'beike', name: '贝壳找房', page_type: 'listing', city_code: 'sh', listing_id: '1', fields: ['F'], transaction: { pattern: null }, notes: ['N'] },
    { url: 'b', platform: 'beike', name: '贝壳找房', page_type: 'listing', city_code: 'sh', listing_id: '2', fields: ['F'], transaction: { pattern: null }, notes: ['N'] },
    { url: 'c', platform: 'lianjia', name: '链家', page_type: 'transaction', city_code: 'sh', listing_id: '3', fields: ['G'], transaction: null, notes: [] },
  ];
  const out = groupDetections(items);
  eq('平台分组数（3 条链接 → 2 个平台）', out.platforms.length, 2);
  eq('平台负载每平台一份', out.platforms.map((p) => p.fields.length), [1, 1]);
  eq('URL 清单挂在平台下', out.platforms.map((p) => p.urls.map((u) => u.url)), [['a', 'b'], ['c']]);
  eq('逐 URL 保留 page_type/listing_id', out.platforms[0].urls[1], { url: 'b', page_type: 'listing', city_code: 'sh', listing_id: '2' });
  has('3 条未超预算', out.over_budget === false);

  const five = [...items, ...items.slice(0, 2).map((x, i) => ({ ...x, url: `x${i}` }))];
  const over = groupDetections(five);
  has('>3 条标记超预算', over.over_budget === true && over.url_count === 5);
  has('超预算提醒含上限与分批指引', /上限 3 条/.test(overBudgetWarning(5)) && /分批/.test(overBudgetWarning(5)));
  eq('空输入不炸', groupDetections([]), { url_count: 0, max_urls_per_call: 3, over_budget: false, platforms: [] });
}

// ---------- 政务源 granularity 枚举自一致（issue #3） ----------

{
  const g = await checkGranularity(ROOT);
  has('登记表已发现', g.files.length >= 3);
  eq('granularity 取值无漂移', g.bad, []);
  has('原子档覆盖常用粒度', ['单套级', '小区级', '楼盘级', '全市级', '区级', '全国级'].every((t) => SOURCE_GRANULARITIES.includes(t)));

  const { entries } = await readOfficialSources(ROOT);
  has('每条登记条目都带 registry（表级市场，防文件名解析回归）', entries.every((e) => !!e.registry));
  has('表级市场 --market eu 可命中（registry 回退）', filterSources(entries, { market: 'eu' }).length > 0);
  has('国别码 --market uk 可命中', filterSources(entries, { market: 'uk' }).length > 0);
  has('关键词过滤可用', filterSources(entries, { query: '深圳' }).length === 1);
}

// ---------- 平台 detect 矩阵 ----------

const scrapers = await loadScrapers(join(ROOT, 'scrapers'));
const detectOne = (url) => {
  const found = detectPlatform(url, scrapers);
  if (!found) return { platform: 'generic', page_type: 'unknown', city_code: null, listing_id: null };
  const { scraper, hit } = found;
  return { platform: scraper.id, page_type: hit.page_type, city_code: hit.city_code, listing_id: hit.listing_id };
};
const matrix = [
  ['https://sh.lianjia.com/ershoufang/107115820274.html', { platform: 'lianjia', page_type: 'listing', city_code: 'sh', listing_id: '107115820274' }],
  ['https://m.ke.com/sh/ershoufang/107115820274.html', { platform: 'beike', page_type: 'listing', city_code: 'sh', listing_id: '107115820274' }],
  ['https://sh.ke.com/chengjiao/107101451728.html', { platform: 'beike', page_type: 'transaction', city_code: 'sh', listing_id: '107101451728' }],
  ['https://shanghai.anjuke.com/prop/view/A1686520304', { platform: 'anjuke', page_type: 'listing', city_code: 'shanghai', listing_id: 'A1686520304' }],
  ['https://bj.5i5j.com/ershoufang/9876543.html', { platform: '5i5j', page_type: 'listing', city_code: 'bj', listing_id: '9876543' }],
  ['https://sh.esf.fang.com/chushou/3_511432907.htm', { platform: 'fang', page_type: 'listing', city_code: 'sh', listing_id: '3_511432907' }],
  ['https://www.fang.com/xiaoqu/sh-1211107674', { platform: 'fang', page_type: 'community', city_code: 'sh', listing_id: '1211107674' }],
  ['https://sh.esf.fang.com/loupan/1210031493.htm', { platform: 'fang', page_type: 'community', city_code: 'sh', listing_id: '1210031493' }],
  ['https://newhouse.fang.com/loupan/1210031493/', { platform: 'fang', page_type: 'new_home', city_code: 'newhouse', listing_id: '1210031493' }],
  ['https://example.com/x', { platform: 'generic', page_type: 'unknown', city_code: null, listing_id: null }],
];
for (const [url, want] of matrix) eq(`detect ${url.slice(8, 48)}`, detectOne(url), want);
eq('liftMobileCity（m 子域城市提升）', liftMobileCity('m', 'sh/ershoufang/1.html'), ['sh', 'ershoufang/1.html']);
eq('liftMobileCity（非移动端原样）', liftMobileCity('sh', 'ershoufang/1.html'), ['sh', 'ershoufang/1.html']);

// ---------- 自动复扫（T9 #23：计划/提取/记录组装——canned fixture，无网络） ----------

{
  // canned fixture 按 2026-10-26 实测标记造：详情页 price_esf/元/平米/JSON-LD/面包屑；小区页 meta Description
  const listingHtml = '<div class="trl-item price_esf sty1"><i>568</i>万 </div>'
    + '59019元/平米<div class="tt"> 2室2厅1卫 </div>共11层'
    + '"建筑面积","value":"96.24㎡"'
    + '"挂牌时间","value":"2026-05-06"'
    + '<a href="/loupan/1210031493.htm" id="juhexq_A01_01_05" class="blue"> 由由新邸</a>';
  const exL = extractFangListing(listingHtml);
  eq('listing 提取（总价/单价/面积/户型/楼层/挂牌时间/小区名）', exL.status === 'ok' && exL.listing, {
    total_price_wan: 568, unit_price: 59019, area_sqm: 96.24,
    layout: '2室2厅1卫', floor: '共11层', listed_at: '2026-05-06',
  });
  eq('listing 小区名与小区 ID（面包屑第二捕获组）', [exL.community, exL.community_id], ['由由新邸', '1210031493']);

  const brokenHtml = '<html><body>页面改版了，没有任何已知锚点</body></html>';
  const exBroken = extractFangListing(brokenHtml);
  eq('布局变更 → parse_failed 且缺项显式（不编数字）',
    [exBroken.status, exBroken.missing], ['parse_failed', ['total_price_wan', 'unit_price', 'area_sqm', 'community']]);

  const communityHtml = 'content="上海由由新邸小区网，参考均价：60609元/㎡，位于浦东北蔡，现有二手房源4套，竣工时间2001-01-01年，小区地址是严桥路58弄"'
    + '<div>09月参考均价</div>';
  const exC = extractFangCommunity(communityHtml);
  eq('community 提取（参考均价/月份/在售套数/竣工年代）', exC, {
    status: 'ok', reference: { unit_price: 60609, as_of_month: '09月参考价' }, listing_count: 4, built_year: 2001,
  });
  eq('community 参考价缺失 → parse_failed', extractFangCommunity('<html>无价格</html>').status, 'parse_failed');

  // 计划器：去重/分类/预算截断/不支持平台显式计数
  const scrapers = await loadScrapers(join(ROOT, 'scrapers'));
  const urls = [
    'https://sh.esf.fang.com/chushou/3_511432907.htm',
    'https://sh.esf.fang.com/chushou/3_511432907.htm', // 重复 → 去重
    'https://sh.esf.fang.com/loupan/1210031493.htm',
    'https://shanghai.anjuke.com/prop/view/A1686520304', // 非房天下 → unsupported
  ];
  const plan = planRescan(urls, scrapers, { maxFetches: 2 });
  eq('计划器（去重 2 条 + 预算内截断 + unsupported 显式）',
    [plan.fetches.length, plan.skipped_cap, plan.unsupported.length, plan.unsupported[0].includes('anjuke')], [2, 0, 1, true]);
  eq('计划器 kinds', plan.fetches.map((f) => f.kind).sort().join(','), 'community,listing');
  const plan15 = planRescan(Array.from({ length: 15 }, (_, i) => `https://sh.esf.fang.com/chushou/9_${i}.htm`), scrapers);
  eq('预算硬上限 12（超额显式计数）', [plan15.fetches.length, plan15.skipped_cap, plan15.cap], [12, 3, 12]);
  eq('预算口径与 scan 同源（≤12）', RESCAN_BUDGET.max_fetches_per_run, 12);
  has('抓取节奏 = 下限 + 抖动', scheduleDelay({ minDelayMs: 100, jitterMs: 50, rng: () => 0.5 }) === 125);

  const rec = buildRecord('listing', exL, { url: 'https://sh.esf.fang.com/chushou/8_1020829729.htm', listingId: '8_1020829729', today: '2026-10-26' });
  eq('记录组装（schema/留痕/页型）',
    [rec.schema, rec.status, rec.platform, rec.page_type, rec.capture.channel, rec.capture.url_verified, rec.community],
    ['house-ops.scan/1', 'complete', 'fang', 'listing', 'gha-fetch', true, '由由新邸']);
  const recC = buildRecord('community', exC, { url: 'https://sh.esf.fang.com/loupan/1210031493.htm', listingId: '1210031493', today: '2026-10-26' });
  has('community 记录 notes 含校准锚语义', /参考均价 60609 元\/㎡（09月参考价/.test(recC.notes) && /不登记 watchlist/.test(recC.notes));
}

// ---------- 仓库卫生：文档命令不漂移 / skill 镜像软链完整 ----------
// 只在「仓库形态」下断言：打包产物里没有 README.md 也没有 .agents/，自动跳过。

{
  const readme = await readFile(join(ROOT, 'README.md'), 'utf8').catch(() => null);
  if (readme) {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    const npmCmds = [...new Set([...readme.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map((m) => m[1]))];
    has('README 确实引用了 npm script（防止正则失效静默跳过）', npmCmds.length > 0);
    eq('README 引用的 npm script 都存在', npmCmds.filter((c) => !(c in pkg.scripts)), []);

    const paths = [...new Set([...readme.matchAll(/node ((?:scripts|tools)\/[A-Za-z0-9_\-./]+\.mjs)/g)].map((m) => m[1]))];
    has('README 确实引用了脚本路径（防止正则失效静默跳过）', paths.length > 0);
    const missing = [];
    for (const rel of paths) {
      if (!(await stat(join(ROOT, rel)).then(() => true).catch(() => false))) missing.push(rel);
    }
    eq('README 引用的脚本路径都存在', missing, []);
  }

  const skillDir = join(ROOT, '.agents/skills/house-ops');
  if (await stat(join(skillDir, 'SKILL.md')).then(() => true).catch(() => false)) {
    // 镜像集合 = 运行时真读到的东西；多链一个就把无关产物推给所有用户
    const required = ['modes', 'scripts', 'scrapers', 'templates', 'config', 'data', 'reports', 'docs/markets', 'package.json'];
    const missing = [], broken = [];
    for (const rel of required) {
      const st = await lstat(join(skillDir, rel)).catch(() => null);
      if (!st) { missing.push(rel); continue; }
      if (st.isSymbolicLink() && !(await realpath(join(skillDir, rel)).catch(() => null))) broken.push(rel);
    }
    eq('skill 镜像条目齐全（运行时真读到的目录）', missing, []);
    eq('skill 镜像软链都能解析到实体', broken, []);
    // AGENTS.md 一旦镜像进技能目录，根目录判定会把 PROJECT_ROOT 拽到技能目录里
    const leaked = await stat(join(skillDir, 'AGENTS.md')).then(() => true).catch(() => false);
    has('AGENTS.md 未镜像进技能目录（防 PROJECT_ROOT 掉进去）', leaked === false);
  }

  // WorkBuddy 市场清单：平台按 SKILL.md 的 frontmatter 校验，缺一个字段就直接拒收 ZIP。
  // version 又是第五处版本号（前四处见下面 plugin/marketplace/codex），漂移了用户装到的版本
  // 就和仓库对不上——所以在这里一并钉住，别等到上传才发现。
  {
    const skillMd = join(ROOT, '.agents/skills/house-ops/SKILL.md');
    if (await stat(skillMd).then(() => true).catch(() => false)) {
      const fmText = /^---\r?\n([\s\S]*?)\r?\n---/.exec(await readFile(skillMd, 'utf8'))?.[1] ?? '';
      const fm = {};
      for (const line of fmText.split('\n')) {
        const kv = /^([a-z][a-z0-9_-]*):(.*)$/i.exec(line);
        if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
      }
      const required = ['name', 'display_name', 'display_name_en', 'description',
        'description_zh', 'description_en', 'version', 'author'];
      eq('SKILL.md 含 WorkBuddy 市场必填字段', required.filter((k) => !fm[k]), []);
      eq('SKILL.md name 是 kebab-case（平台硬规则）', /^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name ?? ''), true);

      const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
      eq('SKILL.md version 与 package.json 一致（第五处版本号）', fm.version, pkg.version);
    }
  }

  // Claude Code 插件清单：仓库根就是 plugin root（.claude-plugin/ 在那儿），
  // marketplace 与 plugin 的版本必须同 package.json 一致 —— 三个版本号一旦漂移，
  // 用户装到的版本就和仓库对不上。分发副本里没有 .claude-plugin/，自动跳过。
  const plugin = JSON.parse(await readFile(join(ROOT, '.claude-plugin/plugin.json'), 'utf8').catch(() => 'null'));
  if (plugin) {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    has('plugin.json 名字与仓库一致', plugin.name === 'house-ops');
    eq('plugin.json 版本与 package.json 一致（单一真源）', plugin.version, pkg.version);

    const skillPaths = plugin.skills ?? [];
    has('plugin 至少挂一个 skill', skillPaths.length > 0);
    for (const rel of skillPaths) {
      has(`plugin 挂的 skill 能解析到 SKILL.md：${rel}`,
        await stat(join(ROOT, rel, 'SKILL.md')).then(() => true).catch(() => false));
    }

    const market = JSON.parse(await readFile(join(ROOT, '.claude-plugin/marketplace.json'), 'utf8').catch(() => 'null'));
    if (market) {
      const entry = (market.plugins ?? []).find((p) => p.name === plugin.name);
      has('marketplace 里有同名的 plugin 条目', !!entry);
      if (entry) {
        eq('marketplace 条目版本与 plugin.json 一致', entry.version, plugin.version);
        has('marketplace 条目 source 指向 plugin 根',
          await stat(join(ROOT, entry.source ?? '', '.claude-plugin/plugin.json')).then(() => true).catch(() => false));
      }
    }

    // Codex 插件清单（.codex-plugin/）：形态和 Claude 那份一致，但校验更松——
    // 实测把版本改成 9.9.9 它照样装、照样对外报 9.9.9，不会报版本不匹配。
    // 所以这里必须自己把版本号钉住，否则用户装到的版本和 package.json 对不上。
    // 另：codex 不读自己的 marketplace.json，它复用 .claude-plugin/marketplace.json。
    const codex = JSON.parse(await readFile(join(ROOT, '.codex-plugin/plugin.json'), 'utf8').catch(() => 'null'));
    if (codex) {
      has('codex plugin.json 名字与仓库一致', codex.name === 'house-ops');
      eq('codex plugin.json 版本与 package.json 一致（单一真源）', codex.version, pkg.version);

      const codexSkillPaths = codex.skills ?? [];
      has('codex plugin 至少挂一个 skill', codexSkillPaths.length > 0);
      for (const rel of codexSkillPaths) {
        has(`codex plugin 挂的 skill 能解析到 SKILL.md：${rel}`,
          await stat(join(ROOT, rel, 'SKILL.md')).then(() => true).catch(() => false));
      }
      has('codex 与 claude 两份清单挂同一份 skill（避免两处各挂一份）',
        JSON.stringify([...codexSkillPaths].sort()) === JSON.stringify([...skillPaths].sort()));
    }
  }
}

// ---------- 地图：静态化 + HTML 注入防回归 ----------
// ClawHub 的 AI-Infra-Guard 扫描（T09）提过两条：无鉴权的本地服务、房源字段存储型 HTML 注入。
// 这组断言把修复钉死——任何一处被改回去，selftest 立刻失败。
{
  const mapSrc = await readFile(join(ROOT, 'scripts', 'map.mjs'), 'utf8');
  has('地图不起本地服务（无 createServer）', !/createServer/.test(mapSrc));
  has('地图不监听任何端口（无 .listen）', !/\.listen\s*\(/.test(mapSrc));
  has('地图不暴露 HTTP 路由（无 /api/）', !/['"`]\/api\//.test(mapSrc));
  has('地图不设 CORS 标头', !/Access-Control-Allow-Origin/.test(mapSrc));
  has('地图不写画像（无写 config/profile.yml 的代码）', !/writeFile\(\s*PROFILE_PATH/.test(mapSrc));

  const pageSrc = await readFile(join(ROOT, 'scripts', 'lib', 'map-page.mjs'), 'utf8');
  has('页面不发网络请求（无 fetch）', !/\bfetch\s*\(/.test(pageSrc));
  has('页面不再区分服务模式（无 IS_SERVER_MODE）', !/IS_SERVER_MODE/.test(pageSrc));
  has('页面不调用后端接口（无 /api/）', !/['"`]\/api\//.test(pageSrc));

  // esc() 必须连引号一起转义：只转义 &<> 的话，属性上下文（onclick="…"）仍可闭合突破
  const escLine = pageSrc.split('\n').find(l => l.includes('function esc(s)'));
  has('页面存在 esc() 转义函数', Boolean(escLine));
  if (escLine) {
    const escFn = new Function('s', escLine.slice(escLine.indexOf('{') + 1, escLine.lastIndexOf('}')));
    eq('esc 转义尖括号', escFn('<img src=x>'), '&lt;img src=x&gt;');
    eq('esc 转义双引号', escFn('" onclick="alert(1)'), '&quot; onclick=&quot;alert(1)');
    eq('esc 转义单引号', escFn("' onerror='alert(1)"), '&#39; onerror=&#39;alert(1)');
    eq('esc 转义与符号', escFn('a & b'), 'a &amp; b');
  }

  // 全文件扫描，而不是只盯房源列表：第一批漏了列表，第二批漏了对比矩阵和 marker 标签，
  // 教训是「只修被点名的那处」会漏掉同文件里的其他地方，所以按整份文件扫。
  // textContent 由浏览器自动转义，先排除这些行，否则全是噪音。
  const riskyLines = pageSrc.split('\n').filter(l => !/\.textContent\s*[+]?=/.test(l));
  const allInterps = riskyLines.flatMap(l => [...l.matchAll(/\\\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)].map(m => m[1]));
  const dataInterps = allInterps.filter(e => /\b(h|d)\./.test(e) || /\bsubBits\b/.test(e));
  has('地图页面确有数据插值（防断言空转）', dataInterps.length > 0);
  // 逐字段用完整字段名核对（不能用子串，否则 d.tag 会误伤 d.tagCls）。
  // 规则：插值里出现该字段，就必须有 esc(该字段)；以后新增字段忘了转义会被这里挡住。
  for (const field of [
    'h.community', 'h.report_no', 'h.district', 'h.type', 'h.score_global',
    'h.total_price_wan', 'h.unit_price', 'h.area_sqm', 'h.built_year', 'h.policy_tax_wan',
    'd.tag', 'd.tagCls', 'subBits', 'h.trend_label',
  ]) {
    const fieldRe = new RegExp(`\\b${field.replace(/\./g, '\\.')}\\b`);
    const bad = dataInterps.filter(e => fieldRe.test(e) && !e.includes(`esc(${field}`));
    eq(`地图页面里 ${field} 的插值全部经 esc() 转义`, bad, []);
  }

  // 内联事件属性是 esc() 的盲区：HTML 实体会在 JS 求值前被还原，
  // 所以 esc() 转出来的 &#39; 会被变回 ' 从而闭合 JS 字符串。只能禁止这种写法。
  const inlineHandlers = pageSrc.match(/on[a-z]+\s*=\s*"[^"]*\\\$\{/g) || [];
  eq('没有把数据插值拼进内联事件属性（esc 挡不住 JS 上下文）', inlineHandlers, []);

  {
    // 静态检查只能证明"写了 esc"，证明不了"真的能挡住"。所以这里真跑一次渲染：
    // 用源码里真实的 esc() 与真实的模板，喂一份恶意房源数据，看渲染结果里还剩什么标签。
    // BT = 反引号，用 String.fromCharCode 拼接，避免这段断言自身陷入转义地狱。
    const BT = String.fromCharCode(96);
    const escBody = escLine.slice(escLine.indexOf('{') + 1, escLine.lastIndexOf('}'));
    const escImpl = new Function('s', escBody);
    const tplStart = pageSrc.indexOf(BT, pageSrc.indexOf('item.innerHTML = ')) + 1;
    const tplEnd = pageSrc.indexOf('\\' + BT + ';', tplStart);
    const template = pageSrc.slice(tplStart, tplEnd)
      .replace(/\\\$/g, '$')
      .replace(new RegExp('\\\\' + BT, 'g'), BT);
    has('能还原出房源列表模板（防断言空转）', template.includes('house-item-title'));

    const renderRow = new Function('h', 'd', 'subBits', 'scoreClass', 'esc', 'return ' + BT + template + BT + ';');
    const rendered = renderRow(
      {
        report_no: '001"><script>window.__X=1</script>',
        community: '云栖里<img src=x onerror=window.__X=1>',
        authenticity: 'verified',
        score_global: '4.5" onerror="alert(1)',
        total_price_wan: '<svg onload=alert(1)>',
        unit_price: null,
      },
      { tag: '<script>alert(1)</script>', tagCls: 'hi" onclick="alert(1)' },
      '<b>district</b>', 'score-high', escImpl,
    );
    const tags = [...rendered.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)/g)].map(m => m[1].toLowerCase());
    // 模板自带的结构标签只有 div/span；任何出现在之外的标签都来自被注入的数据。
    eq('恶意房源字段渲染后不产出 DIV/SPAN 之外的标签', [...new Set(tags.filter(t => t !== 'div' && t !== 'span'))], []);
    has('恶意房源字段渲染后不含 <script / <img', !/<script|<img[\s>]/.test(rendered));
  }
}

// ---------- dashboard 打开外部链接：命令注入防回归 ----------
// openExternal 会被喂抓取来的房源链接。旧实现把它们拼进 exec 的 shell 字符串，
// 只转义了双引号，挡不住 `; rm -rf` / $(...) / 反引号。现在跑真实函数验证行为。
{
  const dashSrc = await readFile(join(ROOT, 'scripts', 'dashboard.mjs'), 'utf8');
  has('dashboard 不把外部目标拼进 shell 字符串', !/exec\(\s*`[^`]*\$\{/.test(dashSrc));
  has('dashboard 打开外部目标走 execFile（参数不经 shell）', /execFile\(/.test(dashSrc));

  const fnStart = dashSrc.indexOf('function openExternal(target) {');
  has('能定位到 openExternal', fnStart > 0);
  if (fnStart > 0) {
    let depth = 0, i = dashSrc.indexOf('{', fnStart);
    for (; i < dashSrc.length; i++) {
      if (dashSrc[i] === '{') depth++;
      else if (dashSrc[i] === '}') { depth--; if (!depth) break; }
    }
    const constSrc = dashSrc.split('\n').filter(l => /^const (HTTP_URL|ANY_SCHEME) =/.test(l)).join('\n');
    const calls = [], errs = [];
    const openExternal = new Function(
      'ROOT', 'resolve', 'sep', 'fileURLToPath', 'pathToFileURL', 'existsSync', 'execFile', 'console', 'URL',
      `${constSrc}\n${dashSrc.slice(fnStart, i + 1)}\nreturn openExternal;`,
    )(ROOT, resolve, sep, fileURLToPath, pathToFileURL, existsSync,
      (_c, a, cb) => { calls.push(a); cb?.(null); }, { error: m => errs.push(m) }, URL);

    for (const target of ['https://example.com/listing/1', 'AGENTS.md']) {
      calls.length = 0;
      openExternal(target);
      has(`openExternal 放行正常目标：${target.slice(0, 30)}`, calls.length === 1);
    }
    for (const target of ['; rm -rf /', '$(whoami)', '`id`', 'javascript:alert(1)', 'smb://evil/share', resolve(ROOT, '../outside.md')]) {
      calls.length = 0; errs.length = 0;
      openExternal(target);
      has(`openExternal 拦下恶意/越界目标：${target.slice(0, 26)}`, calls.length === 0 && errs.length === 1);
    }
  }
}

console.log(failed ? `\n⛔ ${failed} 项失败` : '\n✅ selftest 全部通过');
process.exit(failed ? 1 : 0);
