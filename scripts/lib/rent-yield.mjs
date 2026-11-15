// lib/rent-yield.mjs — 租售比 / 静态回本年限的确定性计算（零依赖）
// 口径 SoT：modes/_shared.md「租金口径」节；Machine Summary 字段见 modes/evaluate.md。
// 纪律：租金最高只到「挂牌数据」档，绝不作为成交锚点或合理价区间的输入。
// 单位：total_price 与 monthly_rent 须为同一本币整额单位（调用方按 market.price_scale 换算）。

import { RELIABILITY } from '../../scrapers/_fields.mjs';

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

// 租金数据没有官方开放的逐笔成交口径，档位上限恒为「挂牌数据」。
// 可靠度枚举单一来源：scrapers/_fields.mjs 的 RELIABILITY（从高到低），避免枚举副本漂移。
export const RENT_TIER = RELIABILITY[1];
export const RENT_MIN_SAMPLES = 1;

export function rentYield({ total_price, monthly_rent, as_of = null, n_samples = 1, reliability = RENT_TIER } = {}) {
  const base = {
    tier: RENT_TIER,
    is_deal_anchor: false,
    caveat: '挂牌口径，非成交锚点；不得进入成交锚点或合理价区间计算',
    as_of,
  };
  const blank = { total_price: null, monthly_rent: null, price_to_rent: null, payback_years: null, gross_yield_pct: null };
  if (!Number.isFinite(n_samples) || n_samples < RENT_MIN_SAMPLES) {
    return { status: 'not_evaluated', ...blank, ...base, reason: '挂牌租金样本不足 → not evaluated，列入待核实清单' };
  }
  const inputRank = RELIABILITY.indexOf(reliability);
  if (inputRank === -1 || inputRank > RELIABILITY.indexOf(RENT_TIER)) {
    return { status: 'not_evaluated', ...blank, ...base, reason: `租金可靠度「${reliability}」低于挂牌数据档 → 不支撑租售比，列入待核实清单` };
  }
  if (!isPositiveNumber(total_price) || !isPositiveNumber(monthly_rent)) {
    return { status: 'not_evaluated', ...blank, ...base, reason: '挂牌月租或总价缺失/非正 → 不估算租金，列入待核实清单' };
  }
  const priceToRent = total_price / monthly_rent;
  const paybackYears = total_price / (monthly_rent * 12);
  const grossYieldPct = (monthly_rent * 12 / total_price) * 100;
  return {
    status: 'ok',
    total_price,
    monthly_rent,
    price_to_rent: round(priceToRent, 1),
    payback_years: round(paybackYears, 1),
    gross_yield_pct: round(grossYieldPct, 2),
    n_samples,
    ...base,
  };
}
