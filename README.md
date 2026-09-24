<div align="center">

# house-ops

**A terminal-first house-hunting workspace that runs inside your coding agent.**
Claude Code, Codex, ZCode, Cursor — any agent that reads `AGENTS.md` can drive it.
The agent scans, verifies and scores; results come back as Markdown reports and a TUI console. You look at the rooms, you talk to the agent, you make the call.

[![CI](https://github.com/ohwald/house-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/ohwald/house-ops/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4)

**English** · [中文](#中文)

</div>

## What it is

house-ops is not an application — it is a **skills + modes + scripts** layer your coding agent executes:

- **No runtime of its own.** Your AI CLI is the runtime. There is no server to deploy, no account, no cloud sync; your data stays in `data/` and `reports/` inside your repo.
- **Deterministic work is scripted.** Platform detection, price normalization, cross-validation, verification tables, statistics: zero-dependency Node ≥18 scripts. Tokens go to judgment, not arithmetic.
- **Reports are plain files.** Every evaluation lands in `reports/{NNN}-{小区}-{日期}.md` with a machine-readable summary block, so the TUI, `stats`, and the map all read the same source of truth.

## Works with your agent

The skill entry point is `.agents/skills/house-ops/SKILL.md`. `.claude/skills/house-ops` and `.zcode/skills/house-ops` are symlinks to it — **point any other agent's skill directory at the same folder and it gets the same routing**, or just let the agent read the root `AGENTS.md`.

Inside an agent session:

```text
/house-ops intake        # slash command form
```

…or plain language — the semantic routing table in `AGENTS.md` maps intent to modes:

```text
> triage this listing for me: https://…
> compare 001 and 003
> check the plumbing clauses in this contract draft
```

| Command | What it does |
|---|---|
| `/house-ops intake` | Interview-driven profile: budget, family, school timeline → derived needs & one-vote vetoes |
| `/house-ops triage` | 60-second screening: three questions against your profile |
| `/house-ops scan` | Detect platform, extract listing fields, verify authenticity, collect deal-price anchors, cross-platform dedupe, price history |
| `/house-ops evaluate` | Six-dimension report with sourced numbers + a Global score |
| `/house-ops deep-dive` | Six-axis research on top listings (≥4.0): price history, nuisances, policy, competitors, deal safety, life circle |
| `/house-ops compare` | Multi-listing matrix with scenario trade-offs |
| `/house-ops visit` | Tailored viewing checklist + post-viewing debrief |
| `/house-ops negotiate` | Verification checklist, negotiation room from deal anchors, staged offers, message drafts |
| `/house-ops contract` | 13-point walkthrough of purchase agreements & contracts |
| `/house-ops watchlist` | Candidate list with scores, risk, notes (voided listings auto-hidden) |
| `/house-ops stats` | Score distributions, drop-out analysis, authenticity warnings |
| `/house-ops map` | *(optional, GUI)* decision map — see below |
| `/house-ops doctor` | Repo & data health self-check (`npm run doctor` — no AI needed) |

Pasting a listing link with no command runs `evaluate` by default. `/house-ops` with no argument prints the discovery menu.

## TUI report console

```bash
npm install          # only needed for the TUI (ink + react); the script layer itself is zero-dependency
npm run dashboard
# equivalent: node scripts/dashboard.mjs [PROJECT_ROOT]
```

An [Ink](https://github.com/vadimdemedes/ink) terminal interface reading `reports/` and `data/watchlist.md`: summary header (report count, candidate count, average score), sortable watchlist table (编号 / 小区 / 板块 / 总价 / 评分 / 风险 with a cursor row), score histogram, Top-3 ranked picks, and a full report reader.

| Key | Action |
|---|---|
| `↑` `↓` (or `k` `j`) | Move the cursor |
| `i` | Open the selected property's report in an embedded scroll reader (`↑` `↓` lines, `PgUp`/`PgDn` pages) |
| `p` | Cycle sort: score → number → price |
| `r` | Reload data from disk |
| `o` | Open the original listing URL (or the report file) in your default app |
| `Enter` / `m` | Locate the selected property in the optional map (starts it if needed) |
| `q` / `Esc` | Back to the list / quit |

Non-TTY (piped to a file or CI) prints one static plain-text frame — same data, no interactivity. Listings marked `void` are filtered at the shared data layer (ADR-0002), so the TUI, `stats`, and the map can never disagree.

## Terminal commands

These run without any agent involved:

| Command | What it does |
|---|---|
| `node scripts/doctor.mjs [PROJECT_ROOT]` | Repo & data health check — exit 0 healthy (⚠️ allowed), exit 1 on a blocking issue |
| `node scripts/selftest.mjs` | Golden tests for the scan & decision layer — exit 0 pass, exit 1 failure |
| `node scripts/stats.mjs [PROJECT_ROOT]` | Score distribution, dimension-level weak spots, authenticity warnings |
| `node scripts/reserve-report-num.mjs` | Atomically allocate the next report number (`001`, `002`, …) |
| `npm run dashboard` | TUI console above |

Wrappers exist for all of them: `npm run doctor`, `npm run selftest`, `npm run stats`, `npm run scan`, `npm run insight`, `npm run dashboard`.

### Scanning & verification (`scripts/scan.mjs`)

```bash
node scripts/scan.mjs detect <url> [url...]                    # identify platform/page type, print extraction checklist
node scripts/scan.mjs normalize <record.json | ->              # price normalization + consistency checks (stdout: record, stderr: warnings)
node scripts/scan.mjs crosscheck <record.json> [--write]       # listing price vs. deal price
node scripts/scan.mjs official [城市]                           # registered government open-data sources
node scripts/scan.mjs history [关键词] [--stale-days N]         # no arg = tracking freshness table; arg = single-property timeline & seller strategy signals
node scripts/scan.mjs verify <record.json> [--evidence ev.json] # authenticity decision table + provenance verdict
```

### Physical inference (`scripts/insight.mjs`)

Zero-dependency estimates for screening only — all output is tagged `[推算]` and must be confirmed on site.

```bash
node scripts/insight.mjs sun     --lat 31.23 --spacing 45 --south-floors 18 --floors 6-8 [--date 2027-01-20]
node scripts/insight.mjs noise   --lat 31.05 --lng 121.24 [--radius 300]
node scripts/insight.mjs spacing --lat 31.05 --lng 121.24 [--radius 400]
node scripts/insight.mjs commute --from 121.592,31.252 --to 121.2386,31.0542 [--peak 1.6]
```

Sunlight (GB 50180 ≥2h on 大寒日), road/rail noise (GB 3096 limits), OSM building spacing, and OSRM driving commute with a peak-hour factor.

## Quick start

```bash
git clone https://github.com/ohwald/house-ops.git
cd house-ops
node scripts/doctor.mjs          # verify the environment — works with no install at all

# Option A: drive it from an agent session (recommended)
#   open this folder in Claude Code / Codex / ZCode / Cursor, then:
#   /house-ops intake            # 3-minute interview → your profile
#   …then paste any listing link for a triage or a full evaluation

# Option B: keep it purely in the terminal
npm install                      # only for the TUI
npm run selftest                 # golden tests should pass
npm run dashboard                # open the TUI console to read reports
```

Requirements: **Node ≥ 18**. Core scripts use built-ins only; `ink` + `react` are pulled in solely for the TUI dashboard.

## Authenticity: why this isn't just "ask an AI about a listing"

Housing data is a hallucination minefield. Listing prices are **strategy**, agent scripts are **marketing**, and a model asked to "evaluate this apartment" will invent communities and discounts. This project once lost 10 reports in one session to exactly that.

| Discipline | In practice |
|---|---|
| Anti-hallucination | Model output or memory is never a fact. Every key figure carries a source tag (`live-captured` / `official` / `user-provided` / `unverified`); a report whose community doesn't exist is **voided, not downgraded**. |
| Cross-validation | Seven scripted checks (URL visited / community exists / listing exists / price vs. median / unit-price consistency / tax cross-check / resettlement mixing) write `provenance` (`verified / suspect / void`) into every record. |
| Graded evidence | Deal data > listing data > agent hearsay > unverified. Where platforms redact deal prices, anchor ladders and liquidity signals (viewings, inventory, absorption) take over. |
| Hard filtering | One-vote vetoes (budget, elevator, mixed resettlement, occupied school quota) cap the score; tiers decide where viewing time goes. |

Void data is invisible at the shared data layer, so every consumer inherits the rule automatically.

## Workflow

```
intake (profile) → spot a listing → triage (60s) → scan (verify + price anchors)
→ evaluate (6-dimension report) → deep-dive → compare → visit → negotiate → contract
→ watchlist / stats (retrospective)
```

Score tiers: **≥4.5 strongly recommended** · **4.0–4.4 worth a viewing** · **3.5–3.9 only with a specific reason** · **<3.5 pass**. Any one-vote veto caps the score at 2.5.

## Platform support

| Platform | Listing capture | Deal records |
|---|---|---|
| Beike / Lianjia (贝壳/链家) | ✅ | ✅ `/chengjiao/` (deal-data tier) |
| Anjuke / 5i5j / Fang.com (安居客/我爱我家/房天下) | ✅ | ❌ estimates only (auto-downgraded, never inflated) |
| Others | generic fallback template | per generic checklist |

> **Compliance stance**: personal research only, manual pace, respect platform terms — no bulk scraping, no captcha/login bypass, no redistribution of page data. This is an independent personal tool, **not affiliated with or endorsed by any platform**; listing data belongs to the platforms.

## Architecture

```
├── AGENTS.md            # master spec: data contract, mode routing, anti-hallucination rules
├── CONTEXT.md           # domain glossary + named module seams
├── modes/*.md           # the brain: 13 workflows, one file per mode
├── scrapers/*.mjs       # platform adapters: one module per platform + filesystem registry
├── scripts/*.mjs        # deterministic layer: scan / stats / doctor / dashboard / insight (zero-dep)
├── scripts/lib/         # shared modules: data, decision, profile, geo, page generator
├── scripts/selftest.mjs # golden tests for the scan & decision layers
├── templates/*.yml      # policy notes / contract checklist / official sources (all with as_of)
├── docs/adr/            # architecture decision records
├── data/  reports/      # YOUR runtime data (gitignored — never committed)
```

**The data contract**: the system layer is versioned and upgradeable; the user layer is yours alone and gitignored. Change your needs → rerun `intake`; personal rules live in `modes/_custom.md`. CI enforces the boundary with a privacy guard.

## Design decisions

- [ADR-0001](docs/adr/0001-no-transaction-status-tracking.md) — no transaction-status tracking (watchlist is a pure candidate list)
- [ADR-0002](docs/adr/0002-data-provenance-verification.md) — data provenance gates (model memory is never a fact source; provenance filtering is a hard constraint)

## Optional extras: the decision map (GUI)

A supplementary view for when you want to see everything spatially. Everything here is optional — the terminal flow above is complete without it.

```bash
node scripts/map.mjs                 # write a static map page to data/map.html
node scripts/map.mjs --serve [port]  # also start a local service (default 3000, auto-increments if busy) with profile editing
node scripts/map.mjs --out <file>    # custom output path
# npm run map / npm run map:serve
```

Coordinates, commute rings, decision filters, a detail panel and a compare matrix. Repo empty? It ships with fictional demo data — toggle ✨ 演示数据 in the UI. From the TUI, `Enter` on a property deep-links straight to it.

![house-ops decision map](docs/screenshots/map-overview.png)

## Contributing

PRs welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md). Commit messages follow English [Conventional Commits](https://www.conventionalcommits.org/); CI (syntax, doctor, golden tests, map smoke, privacy guard) must pass.

## Disclaimer

house-ops output is AI-generated analysis for reference only — not investment, legal, or tax advice. Verify titles and policies yourself before any transaction (all data tables carry `as_of` timestamps), and consult professionals where it matters.

## Acknowledgements

[career-ops](https://github.com/career-ops-hq/career-ops) — the original "turn your AI CLI into a life-ops center" blueprint.

---

<div align="center">

## 中文

**English** · [中文](#中文)

</div>

# house-ops

> 一套**终端优先、面向 Agent** 的购房决策操作台：跑在你的编码 Agent 里（Claude Code、Codex、ZCode、Cursor 均可）。
> Agent 负责搜索、交叉验证、打分分析；结果汇集成 Markdown 报告，并在 TUI 操作台里呈现。
> 看房、谈判、拍板，始终是你。

## 它不是应用，是 Agent 的执行层

- **没有独立运行时**——你的 AI CLI 就是运行时。无部署、无账号、无云端同步，数据只落在仓库的 `data/` 与 `reports/`。
- **确定性工作交给脚本**——平台识别、价格归一化、成交交叉验证、真实性判定表、统计，全部是 Node ≥18 零依赖脚本，让 token 花在判断上而不是算术上。
- **报告是纯文本**——每次评级落 `reports/{NNN}-{小区}-{日期}.md`（含 Machine Summary），TUI、`stats`、地图读的是同一份事实源。

## 接入各类 Agent

技能入口是 `.agents/skills/house-ops/SKILL.md`，`.claude/skills/house-ops` 与 `.zcode/skills/house-ops` 都是指向它的符号链接。**把任意其他 Agent 的技能目录也软链到同一目录**，或让它直接读取仓库根的 `AGENTS.md`，即可复用同一套路由。

在 Agent 会话里怎么调用：

```text
/house-ops intake          # 斜杠命令形式
```

也可以直接说人话，`AGENTS.md` 的语义路由表会把意图映射到对应模式：

```text
> 帮我速筛这套：https://…
> 对比一下 001 和 003
> 帮我审一下这份合同草稿里的违约条款
```

| 命令 | 作用 |
|---|---|
| `/house-ops intake` | 多轮对话建立需求画像：预算/家庭/入学时间 → 衍生需求与一票否决项 |
| `/house-ops triage` | 60 秒速筛：三问过一遍 |
| `/house-ops scan` | 识别平台、提取挂牌字段、验真、采集成交锚点、跨平台去重、价格历史 |
| `/house-ops evaluate` | 六维评级报告（带来源标记的数字 + 综合评分） |
| `/house-ops deep-dive` | 高分房源（≥4.0）六轴深挖：历史价格/嫌恶设施/政策/竞品/交易安全/生活圈 |
| `/house-ops compare` | 多房源对比矩阵与场景化权衡 |
| `/house-ops visit` | 带看前定制清单 + 带看后复盘 |
| `/house-ops negotiate` | 核实清单、议价空间、分档报价与沟通话术草稿 |
| `/house-ops contract` | 认购书/买卖合同/补充协议 13 点走查 |
| `/house-ops watchlist` | 候选清单与备注（作废房源自动隐藏） |
| `/house-ops stats` | 评分区间分布、失分维度、真实性告警 |
| `/house-ops map` | *（可选 GUI）*房源决策地图，见下文 |
| `/house-ops doctor` | 仓库与数据健康自检（等同 `npm run doctor`，不需要 AI） |

直接粘贴房源链接默认走 `evaluate`；`/house-ops` 不带参数则显示 Discovery 菜单。

## TUI 报告操作台

```bash
npm install          # 只有 TUI 需要（ink + react），脚本层本身零依赖
npm run dashboard
# 等价：node scripts/dashboard.mjs [PROJECT_ROOT]
```

基于 [Ink](https://github.com/vadimdemedes/ink) 的终端界面，读取 `reports/` 与 `data/watchlist.md`：顶部总览（报告数/候选数/均分）、可排序的关注清单表格（编号/小区/板块/总价/评分/风险，带光标行）、综合评分直方图、Top-3 高分榜，以及完整报告阅读器。

| 按键 | 动作 |
|---|---|
| `↑` `↓`（或 `k` `j`） | 上下移动光标 |
| `i` | 打开该房源报告的内嵌滚动阅读器（`↑` `↓` 逐行，`PgUp`/`PgDn` 翻页） |
| `p` | 切换排序：评分 → 编号 → 总价 |
| `r` | 重新从磁盘加载数据 |
| `o` | 用默认程序打开挂牌原网页（无 URL 时打开报告文件） |
| `Enter` / `m` | 在可选地图中定位该房源（未启动则自动拉起） |
| `q` / `Esc` | 返回列表 / 退出 |

非 TTY 环境（管道输出或 CI）自动降级为单帧纯文本，数据一致但不可交互。作废房源在共享数据层即被过滤（ADR-0002），因此 TUI、`stats`、地图三者口径永远一致。

## 终端命令

这些命令不需要 Agent 参与：

| 命令 | 作用 |
|---|---|
| `node scripts/doctor.mjs [PROJECT_ROOT]` | 环境与数据自检：健康 exit 0（允许 ⚠️），存在阻塞项 exit 1 |
| `node scripts/selftest.mjs` | scan / decision 层 golden 测试：通过 exit 0，失败 exit 1 |
| `node scripts/stats.mjs [PROJECT_ROOT]` | 评分区间、低分维度排行、真实性告警 |
| `node scripts/reserve-report-num.mjs` | 原子分配下一个报告编号（`001`、`002`…） |
| `npm run dashboard` | 上面的 TUI 操作台 |

以上均有 npm 包装：`npm run doctor` / `selftest` / `stats` / `scan` / `insight` / `dashboard`。

### 扫描与验真（`scripts/scan.mjs`）

```bash
node scripts/scan.mjs detect <url> [url...]                     # 识别平台/页面类型，输出提取清单
node scripts/scan.mjs normalize <record.json | ->               # 价格归一化 + 一致性检查（记录走 stdout，警告走 stderr）
node scripts/scan.mjs crosscheck <record.json> [--write]        # 挂牌价 vs 成交价交叉验证
node scripts/scan.mjs official [城市]                            # 查政务公开数据源登记表
node scripts/scan.mjs history [关键词] [--stale-days N]          # 无参=追踪时效表；带关键词=单房源时间线与房东策略信号
node scripts/scan.mjs verify <record.json> [--evidence ev.json]  # 真实性判定表 + provenance 建议
```

### 物理推算（`scripts/insight.mjs`）

零依赖估算，仅用于排除与排序，输出统一标注 `[推算]`，最终以带看实测为准。

```bash
node scripts/insight.mjs sun     --lat 31.23 --spacing 45 --south-floors 18 --floors 6-8 [--date 2027-01-20]
node scripts/insight.mjs noise   --lat 31.05 --lng 121.24 [--radius 300]
node scripts/insight.mjs spacing --lat 31.05 --lng 121.24 [--radius 400]
node scripts/insight.mjs commute --from 121.592,31.252 --to 121.2386,31.0542 [--peak 1.6]
```

日照（GB 50180 大寒日 ≥2h）、道路/铁路噪音（GB 3096 限值对照）、OSM 建筑间距、OSRM 车行通勤（× 高峰系数）。

## 快速开始

```bash
git clone https://github.com/ohwald/house-ops.git
cd house-ops
node scripts/doctor.mjs          # 环境自检，零安装即可跑

# 方式 A：在 Agent 会话中驱动（推荐）
#   用 Claude Code / Codex / ZCode / Cursor 打开本目录，然后：
#   /house-ops intake            # 3 分钟建立需求画像
#   之后直接粘贴房源链接即可速筛或完整评估

# 方式 B：纯终端使用
npm install                      # 仅 TUI 需要
npm run selftest                 # golden 测试应当全绿
npm run dashboard                # 打开 TUI 操作台阅读报告
```

环境要求：**Node ≥ 18**。核心脚本只用内置模块；`ink` + `react` 仅为 TUI 引入。

## 真实性纪律：为什么不是"让 AI 直接评价一套房"

房源数据是幻觉重灾区：挂牌价是**策略**，中介话术是**营销**，直接让模型"评估这套房"，它会编出不存在的小区和打折价——本项目一次会话里作废过 10 份这样的报告。

- **反幻觉**——模型生成或记忆的数据不是事实；关键数字必须带来源标记（`[实采]`/`[政务]`/`[用户输入]`/`[未核实]`）；小区不存在、挂牌虚构的报告直接作废而非降权。
- **交叉验证**——七项判定（URL 实访/小区存在/挂牌存在/价格 vs 均价/单价一致性/满五税费勾稽/回迁混居）由脚本机械执行，`provenance` 三态（`verified / suspect / void`）写入每条记录。
- **证据分档**——成交数据 > 挂牌数据 > 中介口述 > 未核实；成交价被平台脱敏时，改用价格锚点阶梯与流动性信号（带看/在售/去化）。
- **硬性过滤**——一票否决项（预算/电梯/混居/学位占用）直接封顶；分档决定看房时间投向哪里。

作废数据在共享数据层默认不可见，所有下游消费入口自动继承这条规则。

## 工作流

```
intake 建画像 → 看到候选 → triage 速筛 → scan 验真+采价
→ evaluate 评级 → deep-dive 深挖 → compare 对比 → visit 带看
→ negotiate 谈判 → contract 审合同 → watchlist / stats 复盘
```

评分分档：**≥4.5 强烈推荐**｜**4.0–4.4 值得看房**｜**3.5–3.9 有特定理由才看**｜**<3.5 建议放弃**；命中一票否决项直接封顶 2.5。

## 平台支持

| 平台 | 挂牌采集 | 成交明细 |
|---|---|---|
| 贝壳找房 / 链家 | ✅ | ✅ `/chengjiao/`（成交数据档） |
| 安居客 / 我爱我家 / 房天下 | ✅ | ❌ 仅估算行情（自动降档，宁降档不虚标） |
| 其他平台 | generic 兜底清单 | 按通用清单采集 |

> **合规底线**：仅限个人购房研究、手动节奏、遵守平台条款，不绕验证码/登录墙，不公开再分发页面数据。本项目为独立个人工具，**与任何平台无隶属或背书关系**，房源数据归各平台所有。

## 架构与数据契约

结构见上方英文 Architecture 一节。**数据契约**：系统层（入库、可升级）与用户层（gitignore、只属于你）严格分离——需求变了重跑 `intake`，家规写进 `modes/_custom.md`；CI 的 privacy guard 强制这条边界。

## 设计决策

- [ADR-0001](docs/adr/0001-no-transaction-status-tracking.md) 不做交易状态跟踪（watchlist 是纯候选清单）
- [ADR-0002](docs/adr/0002-data-provenance-verification.md) 数据真实性门槛（模型记忆不作为事实来源；provenance 过滤是强约束）

## 可选附加功能：房源决策地图（GUI）

纯粹的空间辅助视图，想看分布时再用；上面的终端流程不依赖它。

```bash
node scripts/map.mjs                 # 生成静态页面 data/map.html
node scripts/map.mjs --serve [port]  # 同时启动本地服务（默认 3000，端口占用则自动 +1）并支持保存画像
node scripts/map.mjs --out <file>    # 自定义输出路径
# npm run map / npm run map:serve
```

支持坐标上图、通勤圈、决策筛选、详情卡与对比矩阵。仓库为空时自带虚构演示数据，UI 里 ✨ 演示数据 可切换；在 TUI 里按 `Enter` 会深链定位到选中房源。

![房源决策地图](docs/screenshots/map-overview.png)

## 参与贡献

PR 欢迎，请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。提交信息用英文 [Conventional Commits](https://www.conventionalcommits.org/)；CI（语法、doctor、golden 测试、地图冒烟、privacy guard）必须全绿。

## 免责声明

house-ops 输出为 AI 生成的分析参考，不构成投资、法律或税务建议。重大交易请自行核实产权与政策（各数据表均标注 `as_of`），必要时咨询专业人士。

## 致谢

[career-ops](https://github.com/career-ops-hq/career-ops) —— "把 AI CLI 变成生活操作中枢"的原始范式。
