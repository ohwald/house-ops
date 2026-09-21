# CONTEXT.md — house-ops 领域词汇表

> 本文件是领域语言的 SoT（消费约定见 `docs/agents/domain.md`）。评估类输出、报告与代码命名必须使用这里的词，不发明同义词。ADR 记录在 `docs/adr/`（按需惰性创建）。

## 核心名词

- **房源（Listing）**：一套在售或已成交的房产实例；输入形态为 URL 或文字描述。
- **挂牌数据 / 成交数据**：可靠度四档中的前两档（SoT：`modes/_shared.md`）。**成交价脱敏**：平台只展示成交记录的户型/面积/日期而隐藏价格（2026 起主流平台口径）——脱敏记录不参与价格锚点。
- **扫描记录（Scan Record）**：scan 模式对一条房源的结构化采集产物，schema `house-ops.scan/1`。形状 SoT 在 `modes/scan.md`；枚举与阈值的实现源在 `scrapers/_fields.mjs`（doctor 做两侧一致性断言）。
- **价格锚点（Anchor）**：与挂牌价对比的参照价。**锚点阶梯**：官方备案/房源页内嵌成交价（成交数据档）→ 小区均价（按挂牌档使用）→ 板块估算 → 全无则 not evaluated，绝不估算成交价。
- **流动性信号**：近 30 天带看、关注人数、在售套数、近 90 天成交套数、挂牌时长——锚点缺失时的议价证据（挂牌数据档）。
- **房源实体（Listing Entity）**：物理房屋身份，由**实体指纹**（小区+面积±0.6㎡+户型+总楼层+朝向+年代）判定；跨平台同源挂牌与下架重挂（换 ID/换平台）都归并同一实体历史（`scan.mjs match`/`history`）。重挂+价格跳变 = 重定价信号；多平台同源价差大 = 引流盘嫌疑。
- **价格历史（Price History）**：同一房源跨时点的扫描记录序列（追加式，按 `platform:listing_id` 聚合，`node scripts/scan.mjs history` 计算）。**房东策略分析**：从调价方向/幅度/频率、带看与成交的时间序列解读定价策略（以价换量/坚定试探/市场冷落/重定价）——数值是脚本输出，解读由 AI 给出并区分事实与推断；两个时点不构成趋势。
- **话术反查**：对挂牌标题/描述中的营销信号词（急售/笋盘/稀奇户型/送面积等）逐词转成带看核实项，不信话术只验实体。
- **真实性三态（Provenance）**：`✅ verified`（本会话实采验证）/ `⚠️ suspect`（存疑未核实，不阻断展示但必须显式标记）/ `⛔ void`（作废：实体不存在或挂牌虚构）。承载于报告 Machine Summary 的 `provenance` 字段与 watchlist 备注首标记；⛔ 不参与统计与默认展示。
- **证据归档（Evidence）**：户型图/政府公示 PDF/规划快照等证据文件落盘于 `data/evidence/{platform}-{listing_id}/`（房源级）与 `data/policy/`（共享级），并登记进扫描记录 `evidence` 数组——读过就丢等于没验证。
- **实采（Live Capture）**：本会话中真实抓取且 URL 可复核的数据（WebFetch/浏览器通道）。**来源信任阶梯**：政府背书 > 本会话实采 > 用户提供 > 模型记忆（一律视为未核实，ADR-0002）。关键事实须 ≥2 独立来源或 1 个政府背书来源；房源实体无法证实 → 报告作废而非降权。

## 模块接缝（deepening 决策的命名沉淀）

- **finalizeRecord**（`scrapers/_fields.mjs`）：扫描记录定稿唯一入口 = 归一化 + 定价交叉验证。旧"先 normalize 才能 crosscheck"的顺序约定已被此 interface 吸收；crosscheck 锚点方法论：单价口径优先、最高可靠度档内最近 ≤5 条中位数、单样本显式降置信度、`anchor.n_samples/range_pct` 随结论输出。
- **决策分层（Decision Tier）**（`scripts/lib/decision.mjs`）：四档 pill（第一梯队/备选对照/高代价硬伤）、状态标签、地图标记档的唯一实现 = `decide()`；`conclusionLabel()` 是 conclusion 枚举的中文 SoT；`isUserExcluded()` 承载"备注 排除/弃购 = 用户一票否决"语义。真实性不改变分层，只在展示标签上合成（suspect/legacy → 待验真）。服务端（map.mjs merge）预计算 `decision` 字段下发，页面 JS 只渲染不判定。
- **effectiveProvenance**（`scripts/lib/data.mjs`）：真实性折叠唯一出口——优先级 watchlist 备注首标记 > 报告 Machine Summary `provenance` > legacy（按存疑对待，绝不静默升 verified）。⛔void 在 data 层（`collectReports`/`parseWatchlist`）下沉过滤，消费方不得重复实现或自行折叠。
- **PROFILE_FIELDS**（`scripts/lib/profile.mjs`）：画像字段契约唯一声明——parse、update 与地图页表单收集/回填（经 map.html 注入表驱动）三方同源；update 返回 `{text, applied, missing, unknown}`，缺行与契约外键显式报错而非静默 no-op。
- **平台 adapter**（`scrapers/*.mjs`）：一平台一模块，`detect()` 只回答 URL 语法与清单，不写 DOM 选择器；`_` 前缀为共享实现。

## 明确不做（见 docs/adr/）

- **不做交易状态跟踪**（ADR-0001）：无状态机、无进度漏斗；watchlist 是纯候选清单，看过与否/弃购原因写备注。架构评审不要重新提议此概念。
