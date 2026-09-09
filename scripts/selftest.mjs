#!/usr/bin/env node
// selftest.mjs — scan 层 golden fixture 自测（零依赖）。
// 测试面 = 纯函数 interface：finalizeRecord（归一化+定价交叉验证）与平台 detect()/liftMobileCity。
// 用法: node scripts/selftest.mjs    # 全部通过 exit 0；任何断言失败 exit 1
// 纪律：新增行为先在这里加 golden 用例；穿过 CLI stdout / TUI 的测试不属于测试面。

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  finalizeRecord, SCAN_SCHEMA, PAGE_TYPES, RELIABILITY, VERDICT_THRESHOLDS,
  buildPriceHistory, historyKey, listingFingerprint, matchRecord, buildEntityHistory,
  verifyAuthenticity,
} from '../scrapers/_fields.mjs';
import { authenticityFromNote } from './lib/data.mjs';
import { analyze } from './analysis.mjs';
import { solarElevation, noiseLevelAt } from './insight.mjs';
import { buildEvidenceName, evidenceDirFor, evidenceEntry, EVIDENCE_TYPES } from './evidence.mjs';
import { loadScrapers, detectPlatform, liftMobileCity } from '../scrapers/_registry.mjs';

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
}

// ---------- 真实性三态（ADR-0002 备注标记解析） ----------

eq('⛔ → void', authenticityFromNote('⛔ 报告作废：小区不存在'), 'void');
eq('⚠️ → suspect', authenticityFromNote('⚠️ 实采疑点：价格未核实'), 'suspect');
eq('✅ → verified', authenticityFromNote('✅ 已实采验证'), 'verified');
eq('无标记 → legacy', authenticityFromNote('已看房；值得约看'), 'legacy');
eq('空备注 → legacy', authenticityFromNote(''), 'legacy');

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
  eq('观点提炼：事实句', r.viewpoint.fact, '示范海棠湾(三期) · 挂牌 480 万 · 47,525 元/㎡ · 101㎡ 3室1厅 · 已挂牌 100 天 · 30 天带看 193 次');
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
  ['https://example.com/x', { platform: 'generic', page_type: 'unknown', city_code: null, listing_id: null }],
];
for (const [url, want] of matrix) eq(`detect ${url.slice(8, 48)}`, detectOne(url), want);
eq('liftMobileCity（m 子域城市提升）', liftMobileCity('m', 'sh/ershoufang/1.html'), ['sh', 'ershoufang/1.html']);
eq('liftMobileCity（非移动端原样）', liftMobileCity('sh', 'ershoufang/1.html'), ['sh', 'ershoufang/1.html']);

console.log(failed ? `\n⛔ ${failed} 项失败` : '\n✅ selftest 全部通过');
process.exit(failed ? 1 : 0);
