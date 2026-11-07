# Mode: _custom — 家规（用户流程覆盖）

> **用户层文件**：从 `_custom.template.md` 复制而来。这里覆盖系统默认流程与评分口径；无内容时系统按 `modes/_shared.md` 默认执行。gitignore，不入库。

## 评分口径覆盖（可选）

<!-- 例如：
- Risk 维度中"房龄>25 年"按高风险而非注意处理
- 学区权重在画像 high 的基础上，只认"已落地招生"的学区，在建/规划中一律不算
-->

## 流程覆盖（可选）

<!-- 例如：
- 评估一律跳过 PDF/导出（本版本无此功能）
- deep-dive 门槛从 4.0 降到 3.8
- 每份报告末尾追加"给老人的宜居性简评"
-->

## 方向偏离信号阈值（可选）

<!-- 例如：
- 方向偏离信号的连续套数阈值从 3 调到 5：运行 `node scripts/drift.mjs --min-streak 5`
- 贴近上限比例从 0.95 调到 0.9：运行 `node scripts/drift.mjs --near-ratio 0.9`
  两个缺省值见 scripts/lib/drift.mjs 的 DRIFT_THRESHOLDS（min_streak=3 / budget_near_ratio=0.95）；
  家规只声明口径，调用 CLI 时以参数传入；非法值自动回落缺省。
-->

## 其他约定

<!-- 例如：报告文件名 slug 用拼音；每周日汇总一次 watchlist 进度… -->
