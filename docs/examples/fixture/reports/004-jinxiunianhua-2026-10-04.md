# 004 · 锦绣年华 3室2厅 112.7㎡

> **虚构样例**（合成数据），仅用于展示报告结构。

- **编号**: 004
- **日期**: 2026-10-04
- **房源地址**: 上海市嘉定区新城 示例路 55 弄
- **挂牌链接**: https://example.com/listing/004
- **类型**: 二手住宅
- **总价**: 510 万元
- **单价**: 45,300 元/㎡
- **Global 评分**: 3.6 / 5.0
- **结论**: 看情况 (conditional)

## Machine Summary

```yaml
report_no: "004"
provenance: "suspect"
community: "锦绣年华"
city: "上海"
district: "嘉定新城"
type: "二手住宅"
total_price_wan: 510
unit_price: 45300
area_sqm: 112.7
score_global: 3.6
score_fit: 3.5
score_price: 3.9
score_location: 3.3
score_property: 3.8
score_risk: 3.4
hard_dq_hit: false
risk_tier: "medium"
conclusion: "conditional"
market_trend: "soft"
discount_space: "wide"
policy_tax_wan: 7.6
policy_lock_risk: "none"
urban_planning: "negative"
tradeoff_summary: "总价可控、房龄较新；但小区名称与平台记录不完全一致，先验真再推进"
unverified_items:
  - "小区名称与平台记录的一致性（一期/三期命名差异）"
  - "西侧地块规划用途"
next_action: "先验真小区实体，再约看"
```

## Block A — 基本盘

| 项目 | 事实数据 |
|---|---|
| 建筑面积 / 套内 | 112.7 ㎡ / 约 92 ㎡ |
| 户型 / 朝向 | 3室2厅2卫 / 南北 |
| 楼层 / 总楼层 | 8F / 18F |
| 建筑年代 | 2017 年 |

- ⚠️ 小区名称与平台记录存在一期/三期差异，实体待核对（**provenance: suspect**）。
- 挂牌价低于同板块在售中位数约 6%，折价原因待查。

## Block F — 风险

- 风险等级：中风险 (medium)。命名差异未澄清前不进入议价。
