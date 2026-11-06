#!/usr/bin/env node
// rent.mjs — 租售比 / 静态回本年限的确定性计算 CLI（零依赖，Node ≥18）
// 口径 SoT：modes/_shared.md「租金口径」节；唯一实现在 scripts/lib/rent-yield.mjs。
// Machine Summary 字段见 modes/evaluate.md。
//
// 用法:
//   node scripts/rent.mjs --price 4800000 --rent 8000 [--as-of 2026-11-06] [--samples 2] [--reliability 挂牌数据]
//
// 单位: --price 与 --rent 须为同一本币整额（按 market.price_scale 换算；中国 480 万 = 4800000 元）。
// 租金最高只到「挂牌数据」档，输出恒标注「挂牌口径、非成交锚点」。

import { rentYield, RENT_TIER } from './lib/rent-yield.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};

const priceRaw = flag('price');
const rentRaw = flag('rent');
const asOf = flag('as-of') ?? null;
const samplesRaw = flag('samples');
const reliability = flag('reliability') ?? RENT_TIER;

const r = rentYield({
  total_price: priceRaw === undefined ? null : Number(priceRaw),
  monthly_rent: rentRaw === undefined ? null : Number(rentRaw),
  as_of: asOf,
  n_samples: samplesRaw === undefined ? 1 : Number(samplesRaw),
  reliability,
});

if (r.status === 'not_evaluated') {
  console.log(`⛔ 租售比 not evaluated — ${r.reason}`);
  console.log('   （列入待核实清单，不估算租金；这是预期内结果，不是脚本报错）');
} else {
  console.log(`租售比（挂牌口径，非成交锚点）${r.as_of ? ` · as_of ${r.as_of}` : ' · ⚠️ as_of 未提供，报告引用时须补标来源日期'}`);
  console.log(`  房屋总价 ${r.total_price} · 挂牌月租 ${r.monthly_rent}（样本 ${r.n_samples}，档位 ${r.tier}）`);
  console.log(`  租售比 1:${r.price_to_rent} · 静态回本年限 ${r.payback_years} 年 · 毛租金收益率 ${r.gross_yield_pct}%`);
  console.log(`  ⚠️ ${r.caveat}`);
}
