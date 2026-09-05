// _fields.mjs — 扫描记录的字段契约与数值归一化（scripts/scan.mjs 与各平台模块共享）。
// schema SoT：modes/scan.md 的「扫描记录 schema」节，键名变更需同步该文件。
// 依赖：零依赖（Node ≥18）。

export const SCAN_SCHEMA = 'house-ops.scan/1';

// 可靠度四档（SoT：modes/_shared.md「数据可靠度四档」节），index 越小越可信
export const RELIABILITY = ['成交数据', '挂牌数据', '中介口述', '未核实'];

// 各平台通用的挂牌页提取清单（AI 按 scan 模式逐项抓取）
export const COMMON_LISTING_FIELDS = [
  '挂牌标题（话术反查用）', '小区名（含所在区/板块）', '总价（万元）', '单价（元/㎡）', '建筑面积（㎡）',
  '户型（几室几厅）', '楼层/总楼层', '电梯（有无）', '建成年代', '朝向', '装修程度',
  '挂牌时间与调价记录（次数/方向/幅度）', '交易权属（商品房/经适/回迁等）',
];

function firstNumber(raw) {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(String(raw).replace(/，/g, ','));
  return m ? Number(m[0].replace(/,/g, '')) : NaN;
}

// "480万" → 480；"4800000" / "4,800,000元" → 480（页面给"元"时自动折万）
export function parsePriceWan(v, warnings = [], label = '') {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  let n = firstNumber(raw);
  if (!Number.isFinite(n)) {
    warnings.push(`${label}: 无法解析 "${raw}" → null`);
    return null;
  }
  if (!/万/.test(raw) && n >= 10000) n = n / 10000;
  return Math.round(n * 100) / 100;
}

// "95000元/㎡" → 95000；"9.5万" → 95000
export function parseUnitPrice(v, warnings = [], label = '') {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const n = firstNumber(raw);
  if (!Number.isFinite(n)) {
    warnings.push(`${label}: 无法解析 "${raw}" → null`);
    return null;
  }
  return Math.round(/万/.test(raw) ? n * 10000 : n);
}

// "89.5㎡" / "89.5平米" → 89.5
export function parseAreaSqm(v, warnings = [], label = '') {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const n = firstNumber(raw);
  if (!Number.isFinite(n)) {
    warnings.push(`${label}: 无法解析 "${raw}" → null`);
    return null;
  }
  return Math.round(n * 100) / 100;
}

function normField(obj, key, fn, warnings, label) {
  if (obj && obj[key] != null && obj[key] !== '') obj[key] = fn(obj[key], warnings, label);
}

// 归一化整条记录：价格单位、单价一致性（±5%）、可靠度档位合法性。
// 只修正可机械判定的部分，不虚构任何字段。返回 { record, warnings }。
export function normalizeRecord(raw) {
  const rec = structuredClone(raw ?? {});
  const warnings = [];
  rec.schema = SCAN_SCHEMA;
  if (!rec.scanned_at) warnings.push('scanned_at 缺失——应为扫描日期 YYYY-MM-DD');

  const L = (rec.listing ??= {});
  normField(L, 'total_price_wan', parsePriceWan, warnings, 'listing.total_price_wan');
  normField(L, 'unit_price', parseUnitPrice, warnings, 'listing.unit_price');
  normField(L, 'area_sqm', parseAreaSqm, warnings, 'listing.area_sqm');
  if (Number.isFinite(L.total_price_wan) && Number.isFinite(L.area_sqm) && L.area_sqm > 0) {
    const implied = Math.round((L.total_price_wan * 10000) / L.area_sqm);
    if (Number.isFinite(L.unit_price) && L.unit_price > 0) {
      if (Math.abs(implied - L.unit_price) / L.unit_price > 0.05) {
        warnings.push(`listing.unit_price（${L.unit_price}）与 总价/面积 推导值（${implied}）偏差 >5%——以页面为准，差异原因进 unverified_items`);
      }
    } else {
      L.unit_price = implied;
      warnings.push(`listing.unit_price 缺失，已按 总价/面积 推导为 ${implied} 元/㎡`);
    }
  }
  if (!RELIABILITY.includes(L.source_reliability)) L.source_reliability = '挂牌数据';

  (rec.transactions ??= []).forEach((t, i) => {
    normField(t, 'total_price_wan', parsePriceWan, warnings, `transactions[${i}].total_price_wan`);
    normField(t, 'unit_price', parseUnitPrice, warnings, `transactions[${i}].unit_price`);
    normField(t, 'area_sqm', parseAreaSqm, warnings, `transactions[${i}].area_sqm`);
    if (!RELIABILITY.includes(t.reliability)) {
      warnings.push(`transactions[${i}].reliability "${t.reliability}" 非法 → "未核实"`);
      t.reliability = '未核实';
    }
  });

  return { record: rec, warnings };
}

// 交叉验证：挂牌价 vs 可比成交。在可靠度最高的成交档位里取 deal_date 最新的一条作锚点。
// 直接把 crosscheck 字段写回记录并返回。
export function crosscheckRecord(rec) {
  const listingWan = rec?.listing?.total_price_wan;
  const txs = (rec?.transactions ?? []).filter((t) => Number.isFinite(t.total_price_wan));
  rec.crosscheck = { listing_vs_latest_deal_pct: null, vs_deal_date: '', verdict: 'not_enough_data', basis: '', note: '' };
  if (!Number.isFinite(listingWan) || txs.length === 0) {
    rec.crosscheck.note = '缺少挂牌价或任何可比成交——不猜测，成交价进待核实清单';
    return rec;
  }
  const tierOf = (t) => Math.max(0, RELIABILITY.indexOf(t.reliability ?? '未核实'));
  const best = Math.min(...txs.map(tierOf));
  const tier = RELIABILITY[best];
  const ref = txs.filter((t) => tierOf(t) === best)
    .sort((a, b) => String(b.deal_date ?? '').localeCompare(String(a.deal_date ?? '')))[0];
  const pct = Math.round(((listingWan - ref.total_price_wan) / ref.total_price_wan) * 1000) / 10;
  let verdict;
  let note;
  if (pct <= -10) {
    verdict = 'below_deal';
    note = '挂牌低于可比成交 ≥10%——先核实硬伤（采光遮挡/凶宅/税费转嫁/急售原因）再谈捡漏';
  } else if (pct <= 5) {
    verdict = 'near_deal';
    note = '挂牌价贴近可比成交——定价贴合市场';
  } else if (pct <= 15) {
    verdict = 'above_deal';
    note = '挂牌高于可比成交——议价空间参考此偏差与挂牌时长';
  } else {
    verdict = 'far_above';
    note = '挂牌明显高于可比成交（>15%）——虚高挂牌或成交样本过旧，需核实';
  }
  Object.assign(rec.crosscheck, {
    listing_vs_latest_deal_pct: pct,
    vs_deal_date: ref.deal_date ?? '',
    verdict,
    basis: tier,
    note: tier === '成交数据' ? note : `${note}（依据档位为「${tier}」，结论仅参考）`,
  });
  return rec;
}
