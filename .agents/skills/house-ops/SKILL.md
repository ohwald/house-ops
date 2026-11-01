---
name: house-ops
display_name: 买房决策助手
display_name_en: House Ops
description: >-
  驱动 agent 的一体化购房决策体系：需求画像、政策税费、城市规划、市场动态四路输入合成同一套判断；
  扫描挂牌、用成交价锚点交叉验证、六维评分，产出 Markdown 报告。每个数字标注来源档位，无法证实存在的
  房源整份作废而非降权。当用户粘贴房源链接或描述、想明确购房需求、速筛/扫描/对比房源、深挖某套房源、
  审合同、记录带看、要谈判沟通建议或管理关注清单时使用。
  English: Agent-driven home-buying decision system — needs profile, policy and taxes, urban planning
  and market movement folded into one judgment; scans listings, cross-checks asking price against
  deal-price anchors, scores six dimensions, writes Markdown reports. Every figure carries a source
  tier; a property that cannot be verified is voided, not downgraded.
description_zh: >-
  把需求画像、政策税费、城市规划、市场动态合成一套判断：扫描房源、用真实成交价交叉验证挂牌价、六维打分，
  产出可复核的 Markdown 报告。每个数字标注来源档位，证伪即作废。
description_en: >-
  Folds your needs, local policy, urban planning and market movement into one judgment: scans listings,
  cross-checks asking prices against real deal prices, scores six dimensions, and writes auditable
  reports. Every figure carries a source tier; unverifiable listings are voided, not downgraded.
examples_zh:
  - "帮我评估这套房：<粘贴房源链接>"
  - "这套值不值得深看？先快速筛一下"
  - "对比 003 和 005，哪个更适合我"
examples_en:
  - "Evaluate this listing: <paste a listing URL>"
  - "Is this worth a deep look? Triage it first"
  - "Compare 003 and 005 — which fits me better"
version: 0.3.1
author: ohwald
category: productivity
arguments: mode
user-invocable: true
argument-hint: "[intake | triage | evaluate | scan | deep-dive | compare | visit | negotiate | contract | watchlist | stats | doctor | map]"
---

# house-ops 技能路由器

## Project Root 解析

从本 SKILL.md 所在位置向上查找同时包含 `AGENTS.md` 和 `modes/` 的目录，记为 PROJECT_ROOT。

**找不到时**（本技能被装进 Agent 受管技能目录，如 `~/.claude/skills/house-ops/`、`~/.workbuddy/skills/house-ops/`，
那里没有 `AGENTS.md`）退而查找同时包含 `modes/` 和 `scripts/` 的目录作为 PROJECT_ROOT。

后续所有**只读资产**（`modes/`、`scripts/`、`scrapers/`、`templates/`、`docs/`）以 PROJECT_ROOT 为基准。

本技能目录自带指向仓库根的软链：`modes/`、`scripts/`、`scrapers/`、`templates/`、`config/`、
`docs/`、`data/`、`reports/`、`package.json`——安装时会被展开为实体副本，所以**任何安装形态下
PROJECT_ROOT 都是自包含的**。只镜像运行时真正读到的部分：`docs/` 下仅欧洲/亚太两份市场手册
被引用，截图、虚构样例、ADR 与仓库协作文档一概不带。
仓库内工作时解析到仓库根（那里有 `AGENTS.md`）；受管目录安装时解析到技能目录本身。

## 数据根（DATA_ROOT）

`config/profile.yml`、`data/`、`reports/` 是**用户层**，写错地方会在技能升级时丢掉。判定顺序：

1. 仓库形态（PROJECT_ROOT 下有 `.git/`）→ `DATA_ROOT = PROJECT_ROOT`，行为与以往完全一致。
2. 受管安装形态（PROJECT_ROOT 位于技能目录，无 `.git/`）→
   `DATA_ROOT = ${HOUSE_OPS_DATA:-$HOME/house-ops-data}`。

**受管安装第一次运行时**先跑一次幂等的外置脚本，把可写状态搬出技能目录：

```bash
node "$PROJECT_ROOT/scripts/wb-setup.mjs" "$PROJECT_ROOT"
```

它把 `data/`、`reports/`、`config/profile.yml` 搬到 DATA_ROOT，并在原位留软链（旧目录改名保留，不删除；
Windows 上建不了软链时如实告警并保持原状）。已外置过直接跳过，重复运行安全。技能升级后如果 `data/`
又变回实体目录（重装会覆盖软链），再跑一次即可——DATA_ROOT 里的数据一直都在。

**本文件以下所有 `data/…`、`reports/…`、`config/profile.yml` 一律相对 DATA_ROOT 解析**，其余路径仍相对 PROJECT_ROOT。
脚本的 `root` 参数按同一口径传：读写数据的命令（`stats` / `trend` / `dashboard` / `map` / `reserve-report-num`）
传 DATA_ROOT；需要系统资产的命令（`doctor` / `scan`）传 PROJECT_ROOT。

## 触发与模式选择

本技能在两类宿主里都可用，选模式的方式不同：

- **带位置参数的宿主**（Claude Code / ZCode：`/house-ops <mode>`）：按 `$mode` 直达下表对应文件。
- **只按语义触发的宿主**（WorkBuddy 等：用户在技能市场装好后用自然语言提问，没有 `$mode`）：
  **不要把 `$mode` 当空值去打印菜单**。先按用户这句话的内容与别名匹配下表，直接进入对应模式；
  只有用户明确在问"你能做什么"、或完全没有可判定信号时，才显示 Discovery 菜单。

判定优先级：明确点名模式 > 粘贴了房源链接或房源描述（→ `evaluate`）> 说"快速筛一下"（→ `triage`）> 其余按别名表。
拿不准就在两个候选里让用户选一句，不要猜。

## Mode Routing

| `$mode` 值 | 加载的 mode 文件 |
|---|---|
| `intake`（别名：需求、画像、onboarding） | `modes/intake.md`（含 Step 0.5 市场轮：市场/币种/金额与面积单位/买家分档/产权形态） |
| `evaluate`（别名：评估、评级、打分） | `modes/evaluate.md` |
| `triage`（别名：速筛、快筛、triage） | `modes/triage.md` |
| `scan`（别名：扫描、采集、查成交、价格核实） | `modes/scan.md` |
| `deep-dive`（别名：深挖、调研、deep） | `modes/deep-dive.md` |
| `negotiate`（别名：谈判、沟通、约看） | `modes/negotiate.md` |
| `compare`（别名：对比、比较、横评） | `modes/compare.md` |
| `visit`（别名：带看、看房记录、复盘） | `modes/visit.md` |
| `contract`（别名：合同、认购书、审合同） | `modes/contract.md` |
| `watchlist`（别名：清单、跟踪、tracker） | `modes/watchlist.md` |
| `stats`（别名：统计、数据、分析） | `modes/stats.md` |
| `doctor`（别名：自检、体检、诊断） | `modes/doctor.md` |
| `map`（别名：地图、在地图上看、房源分布） | `modes/map.md` |
| 空（且无可判定信号） | Discovery 菜单 |
| 非命令但内容像房源（含 URL、小区名+价格等） | `modes/evaluate.md` |

无法识别的 `$mode`：列出上表让用户选择，不要猜。

## 输出语言

读 `config/profile.yml` 的 `language.output`（缺省 `zh`）。将以下指令注入本模式执行：所有面向用户的输出使用该语言（`zh`=简体中文）。金额与面积单位按同一文件的 `market:` 段：中国市场用"万元"与"元/㎡"；欧洲市场用 `market.currency` 本币整额与 `market.area_unit`（sqm/sqft）。

## 结果呈现（按宿主环境）

报告文件本身是交付物，怎么让用户看见随宿主变：

- **主交付**：`DATA_ROOT/reports/{NNN}-{小区slug}-{YYYY-MM-DD}.md`。写完把路径告诉用户。
- **有结果区的宿主**（WorkBuddy 等）：把报告文件作为产物交给用户查看，不要只在对话里复述全文；
  对话里给结论摘要 + 关键数字即可。对比、评分这类结构化内容用 Markdown 表格，宿主会渲染。
- **纯终端宿主**：直接打印摘要与文件路径。
- **可选附加视图**：`node scripts/map.mjs` 生成单文件 HTML 决策地图（`DATA_ROOT/data/map.html`），
  在支持预览的宿主里打开；`npm run dashboard` 的 TUI 只在真终端里用，且需先 `npm install`。
  这两者都只是**浏览结果的便利方式**，不是交付物本身——没有它们，报告照样成立。

## Discovery 菜单

仅在无可判定信号时展示。带位置参数的宿主可照抄 `/house-ops <mode>`；WorkBuddy 等宿主请改成
"直接说你要做什么"的口吻，不要输出宿主不认的斜杠命令。

```
house-ops — 驱动 agent，帮你把房选好

  intake      多轮对话明确你的购房需求，生成需求画像（首次使用先跑这个）
  triage      60 秒速筛：粘贴链接快速判断值不值得完整评估
  scan        扫描房源链接：识别平台、采集挂牌/成交价，政务数据交叉验证
  evaluate    评估一套房源：粘贴链接或描述，输出六维评级报告
  deep-dive   对高分房源（≥4.0）深挖：历史价格/周边/政策/竞品/产权/生活圈
  compare     2-6 套已评估房源横向对比矩阵与场景化结论
  visit       带看前定制核查清单 / 带看后记录复盘
  negotiate   高分房源的核实清单、议价策略与沟通话术
  contract    审认购书/买卖合同/补充协议/中介协议条款
  watchlist   查看/更新候选清单与备注
  map         房源决策地图：已评估房源按坐标上图，通勤圈与详情卡
  stats       找房数据统计与失分/弃购模式分析
  doctor      仓库结构与数据健康自检

也可以直接粘贴一条房源链接，我会自动走评估流程。
```

## 按 Mode 加载上下文

所有模式都先读 `AGENTS.md`（不存在则跳过；会话已注入则跳过）。然后：

1. **评估类**（`evaluate`、`triage`、`deep-dive`、`negotiate`、`compare`、`visit`、`contract`）：
   - `evaluate`/`deep-dive`/`negotiate`：按顺序读 `modes/_shared.md` → `modes/_profile.md`（存在才读）→ `modes/_custom.md`（存在才读）→ 对应 mode 文件。
   - `triage`：只读 `modes/_brief.md`（存在才读）→ 对应 mode 文件（省 token 的关键）。
   - `compare`/`visit`/`contract`：读 `modes/_profile.md`（存在才读）→ `modes/_custom.md`（存在才读）→ 对应 mode 文件 + 相关房源报告。
2. **其他**（`intake`、`watchlist`、`stats`、`doctor`）：读 `modes/_profile.md`（存在才读）→ `modes/_custom.md`（存在才读）→ 对应 mode 文件。
3. 任何模式涉及**政策事实**时按房源所在市场取表：中国大陆读 `templates/policy-notes.cn.yml`，欧洲读 `templates/policy-notes.eu.yml`（英/爱/法/荷/德/西），亚太读 `templates/policy-notes.apac.yml`（中国香港/新加坡/日本），并遵守其"用前联网核实"与"conflict 口径显式提示"规则；`contract` 另读 `templates/contract-checklist.cn.yml`。
5. `stats` 优先跑 `node scripts/stats.mjs <DATA_ROOT>`，失败或需要更深解读时按 mode 文件人工汇总。
6. `scan`：只读 `modes/scan.md`；先跑 `node scripts/scan.mjs detect <url>...` 获取平台与字段清单（输出按平台分组，同平台负载只读一次；单次 ≤3 条链接，超预算落 `status: partial` 并把未查项交给用户）；涉及成交价/政务数据时跑 `node scripts/scan.mjs official [关键词] [--market cn|eu|apac|<国别码>]` 查可用的公开数据源登记表（用前联网核实；各表的 tier 字段说明该源能到可靠度四档哪一层，欧洲见 `docs/markets/eu.md`，亚太见 `docs/markets/apac.md`）；可靠度档位以 `modes/_shared.md`「数据可靠度四档」节为准。

加载顺序纪律：系统层（`_shared.md`）先读，用户层（`_profile.md`、`_custom.md`、`_brief.md`）后读并覆盖系统默认。
