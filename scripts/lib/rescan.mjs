// rescan.mjs（lib）— opt-in 自动复扫的纯函数层（零依赖，Node ≥18）。
// CLI 见 scripts/rescan.mjs；GitHub Actions 模板见 templates/actions/rescan.example.yml（opt-in，不进上游仓库的工作流）。
// 提取锚点（2026-10-26 实测 sh.esf.fang.com 服务端渲染标记）：
//   详情页 总价 <div class="trl-item price_esf sty1"><i>568</i>万、单价 59019元/平米、
//          面积 "建筑面积","value":"96.24㎡"、挂牌时间 "挂牌时间","value":"2026-05-06"、
//          小区名 面包屑 <a href="/loupan/{id}.htm" ... class="blue"> 由由新邸</a>
//   小区页 meta Description "参考均价：60609元/㎡…现有二手房源4套…竣工时间2001-01-01年" + "09月参考均价"
// 纪律：布局变更 → parse_failed（不写垃圾记录、不编数字）；非房天下 → unsupported_platform 响亮报错；
//       单次运行抓取 ≤12 次（与 scan 模式联网预算同口径）。测试面：selftest golden（无网络）。

import { detectPlatform } from '../../scrapers/_registry.mjs';

export const RESCAN_BUDGET = Object.freeze({
  max_fetches_per_run: 12,   // 与 SCAN_BUDGET.fetches_per_call 同口径：宁分批不批量
  min_delay_ms: 2000,        // 抓取间隔下限（加抖动，见 planRescan 的 schedule）
  jitter_ms: 3000,           // 间隔随机抖动上限
  fetch_timeout_ms: 20000,
});

const r2 = (x) => Math.round(x * 100) / 100;
// null/空串必须返回 null 而不是 0（Number('')===0 会把"提取失败"折叠成"解析成功 0"）
const num0 = (s) => {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const n = Number(t.replace(/[,，\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// ---------- URL 分类（复用平台注册表；非房天下 → unsupported） ----------

export function classifyUrl(url, scrapers) {
  const found = detectPlatform(String(url ?? ''), scrapers);
  if (!found || found.scraper.id !== 'fang') return { kind: 'unsupported_platform', url };
  const pageType = found.hit.page_type;
  if (pageType !== 'listing' && pageType !== 'community') return { kind: 'unsupported_platform', url };
  return { kind: pageType === 'listing' ? 'listing' : 'community', url, listing_id: found.hit.listing_id, page_type: pageType };
}

// 计划一次运行的抓取清单：去重 → 分类 → 截断到预算；超额与不支持的平台显式计数
export function planRescan(urls, scrapers, { maxFetches = RESCAN_BUDGET.max_fetches_per_run } = {}) {
  const seen = new Set();
  const classified = [];
  for (const raw of urls ?? []) {
    const url = String(raw ?? '').trim();
    if (!url || url.startsWith('#') || seen.has(url)) continue;
    seen.add(url);
    classified.push(classifyUrl(url, scrapers));
  }
  const supported = classified.filter((c) => c.kind !== 'unsupported_platform');
  return {
    fetches: supported.slice(0, maxFetches),
    unsupported: classified.filter((c) => c.kind === 'unsupported_platform').map((c) => c.url),
    skipped_cap: Math.max(0, supported.length - maxFetches),
    cap: maxFetches,
  };
}

// 抓取节奏：固定下限 + 均匀抖动（对目标站点友好；确定性测试注入 rng）
export function scheduleDelay({ minDelayMs = RESCAN_BUDGET.min_delay_ms, jitterMs = RESCAN_BUDGET.jitter_ms, rng = Math.random } = {}) {
  return minDelayMs + Math.floor(rng() * Math.max(0, jitterMs));
}

// ---------- 提取器（多兜底正则；主锚点失效 → parse_failed，绝不编数字） ----------

const first = (html, ...patterns) => {
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return m[1];
  }
  return null;
};

// 详情页：总价/单价/面积/户型/楼层/挂牌时间/小区名（面包屑）
export function extractFangListing(html) {
  const htmlStr = String(html ?? '');
  const total = num0(first(htmlStr,
    /price_esf[^>]*>\s*<i>([\d.,]+)<\/i>\s*万/i,
    /class="[^"]*price[^"]*"[^>]*>\s*([\d.,]+)\s*万/i,
    /([\d]{2,4}(?:\.\d+)?)\s*万\b/));
  const unit = num0(first(htmlStr,
    /([\d.,]+)\s*元\s*\/\s*平米/,
    /([\d.,]+)\s*元\s*\/\s*(?:㎡|m²)/i));
  const area = num0(first(htmlStr,
    /"建筑面积","value":"([\d.]+)㎡"/,
    /建筑面积[^>]*>[\s\S]{0,40}?([\d.]+)\s*㎡/));
  const layout = first(htmlStr, /<div class="tt">\s*(\d室\d厅(?:\d卫)?)\s*<\/div>/, /(\d室\d厅(?:\d卫)?)/);
  const floorTotal = first(htmlStr, /共\s*(\d+)\s*层/);
  const listedAt = first(htmlStr, /"挂牌时间","value":"(\d{4}-\d{2}-\d{2})"/);
  const commMatch = /<a[^>]*href="\/loupan\/(\d+)\.htm"[^>]*class="blue"[^>]*>\s*([^<]+?)\s*<\/a>/.exec(htmlStr);
  const community = commMatch?.[2] ?? null;
  const communityId = commMatch?.[1] ?? null;
  const missing = [];
  if (total == null) missing.push('total_price_wan');
  if (unit == null) missing.push('unit_price');
  if (area == null) missing.push('area_sqm');
  if (!community) missing.push('community');
  if (missing.length) return { status: 'parse_failed', missing };
  return {
    status: 'ok',
    listing: {
      total_price_wan: r2(total),
      unit_price: Math.round(unit),
      area_sqm: r2(area),
      layout: layout ?? null,
      floor: floorTotal ? `共${floorTotal}层` : null,
      listed_at: listedAt ?? null,
    },
    community,
    community_id: communityId,
  };
}

// 小区页：月度参考均价（含月份标签）+ 在售套数 + 竣工年代（meta Description 稳定锚点）
export function extractFangCommunity(html) {
  const htmlStr = String(html ?? '');
  const unit = num0(first(htmlStr,
    /参考均价[：:]\s*([\d.,]+)\s*元\s*\/\s*(?:㎡|平米)/,
    /([\d.,]+)\s*元\s*\/\s*(?:㎡|平米)[^<]{0,10}(\d{1,2})月参考/,
    /([\d.,]+)\s*元\/㎡/));
  const month = first(htmlStr, /(\d{1,2})月参考/);
  const listingCount = num0(first(htmlStr, /现有二手房源\s*(\d+)\s*套/, /在售\s*(\d+)\s*套/));
  const builtYear = num0(first(htmlStr, /竣工时间(\d{4})/, /(\d{4})[-\d]*年建成/));
  if (unit == null) return { status: 'parse_failed', missing: ['reference_unit_price'] };
  return {
    status: 'ok',
    reference: { unit_price: Math.round(unit), as_of_month: month ? `${month}月参考价` : null },
    listing_count: listingCount,
    built_year: builtYear ? Math.round(builtYear) : null,
  };
}

// ---------- 记录组装（house-ops.scan/1；capture.channel=gha-fetch 全留痕） ----------

export function buildRecord(kind, extracted, { url, listingId, today, district = '' } = {}) {
  const base = {
    schema: 'house-ops.scan/1',
    status: 'complete',
    scanned_at: today,
    platform: 'fang',
    page_type: kind === 'listing' ? 'listing' : 'community',
    url,
    capture: { channel: 'gha-fetch', captured_at: today, url_verified: true },
    listing_id: listingId ?? null,
    city: '',
    city_code: '',
    community: extracted.community ?? '',
    district,
    listing: { source_reliability: '挂牌数据' },
    transactions: [],
    official: [],
    crosscheck: { anchor: null, listing_vs_anchor_pct: null, verdict: 'not_enough_data', note: '' },
    notes: '自动复扫（GitHub Actions / rescan.mjs，opt-in）：',
    unverified_items: [],
  };
  if (kind === 'listing') {
    base.listing = { ...base.listing, ...extracted.listing };
    base.community = extracted.community ?? '';
    base.notes += '字段由确定性提取器解析，布局变更时整条 parse_failed 不落盘。';
  } else {
    base.community = extracted.community ?? '';
    base.notes += `小区参考均价 ${extracted.reference.unit_price} 元/㎡（${extracted.reference.as_of_month ?? '月份未知'}，实采 ${today}）${extracted.listing_count != null ? `；在售 ${extracted.listing_count} 套` : ''}${extracted.built_year ? `；竣工 ${extracted.built_year} 年` : ''}。趋势体系月度校准锚，不登记 watchlist。`;
    base.unverified_items = extracted.reference.as_of_month ? [] : ['参考价月份未知'];
  }
  return base;
}
