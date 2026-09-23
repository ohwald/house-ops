<div align="center">

# house-ops

**A house-hunting decision workspace that runs inside your AI CLI.**
Scan real listings → verify every number → score against *your* needs → decide with clear eyes.
You look at the rooms, you talk to the agent, you make the call — house-ops does the homework.

[![CI](https://github.com/ohwald/house-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/ohwald/house-ops/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4)

**English** · [中文](#中文)

![house-ops decision map](docs/screenshots/map-overview.png)

</div>

## Why this exists

Listing prices are **strategy**, not facts. Agent scripts are **marketing**, not information. And an AI asked to "evaluate this apartment" will happily **hallucinate** — this project once lost 10 reports in a single session to made-up communities, 30%-off fantasy prices, and a silently rewritten user profile.

house-ops answers with four disciplines:

| Discipline | What it means in practice |
|---|---|
| **Anti-hallucination** | AI-generated or remembered numbers are not facts. Every key figure carries a source tag (`live-captured` / `official` / `user-provided` / `unverified`); a report whose community doesn't exist is **voided, not downgraded**. |
| **Cross-validation** | Community existence, listing existence, price vs. median, ownership history, resettlement-housing mixing — a 7-check verification table executed by script, not by hope. `provenance` (`verified / suspect / void`) is written into every record. |
| **Graded evidence** | Deal data > listing data > agent hearsay > unverified. When platforms redact deal prices, anchor ladders and liquidity signals (viewings, inventory, absorption) take over. |
| **Filter, don't read everything** | Hard one-vote vetoes (budget, elevator, mixed resettlement, occupied school quota) cap the score immediately; score tiers decide where viewing time goes. |

## How it works

```
intake (build your profile) → spot a listing anywhere → triage (60s) → scan (verify + price anchors)
→ evaluate (6-dimension report) → deep-dive → compare (matrix) → visit (checklist)
→ negotiate → contract review → watchlist / stats (retrospective)
```

house-ops is a set of **skills and modes** your AI CLI loads — Claude Code, ZCode, Cursor, anything that reads `AGENTS.md`. A zero-dependency Node script layer does the deterministic work (parsing, verification, fingerprinting, charting) so the AI spends tokens on judgment, not arithmetic.

| Command | What it does |
|---|---|
| `/house-ops intake` | Interview-driven profile: budget, family, school timeline → derived needs & one-vote vetoes |
| `/house-ops triage` | 60-second screening: three questions against your profile |
| `/house-ops scan` | **Platform scan**: detect link, extract listing fields, verify authenticity, collect deal-price anchors, cross-platform dedupe, price-history tracking |
| `/house-ops evaluate` | Six-dimension report with sourced numbers + a Global score |
| `/house-ops deep-dive` | Six-axis research on top listings: price history, nuisances, policy, competitors, deal safety, life circle |
| `/house-ops compare` | Multi-listing matrix with scenario trade-offs |
| `/house-ops visit` | Tailored viewing checklist + post-viewing debrief |
| `/house-ops negotiate` | Verification checklist, negotiation room from deal anchors, staged offers, message drafts |
| `/house-ops contract` | 13-point walkthrough of purchase agreements & contracts |
| `/house-ops watchlist` | Candidate list with scores, risk, notes (voided listings auto-hidden) |
| `/house-ops stats` | Score distributions, drop-out analysis, authenticity warnings |
| `/house-ops map` | Decision map: coordinates, commute rings, decision filters, detail panel, compare matrix |
| `/house-ops doctor` | Repo & data health self-check (`npm run doctor` — no AI needed) |

![detail panel](docs/screenshots/map-detail.png)

Score tiers: **≥4.5 strongly recommended** · **4.0–4.4 worth a viewing** · **3.5–3.9 only with a specific reason** · **<3.5 pass**. Any one-vote veto caps the score at 2.5.

## The authenticity system (the differentiator)

Housing data is a hallucination minefield. house-ops turns "can this number be trusted" into **a script's output, not the user's burden**:

- **Capture provenance** — every scan record stores channel, timestamp, and whether the URL was actually visited
- **Entity fingerprinting** — same physical home = community + area ±0.6㎡ + layout + floor + orientation + year; cross-platform relisting, shell listings, and multi-platform price gaps merge into one entity history automatically
- **Decision tables, not judgment calls** — `scan.mjs verify` runs seven checks (URL visited / community exists / listing exists / price vs. median / unit-price consistency / five-year tax cross-check / resettlement mixing) with precedent cases baked in from real incidents
- **Government gazette as arbiter** — resettlement mixing is decided by the land-parcel *builder* on planning bureau gazettes, not by platform tags (this once exposed a "15% below market" listing as structural mixed-community pricing)
- **Sunk filtering** — voided data is invisible at the shared data layer; every consumer (reports, watchlist, stats, dashboard, map) inherits the rule automatically
- **Append-only price history** — repeated scans aggregate into landlord-strategy signals: repeated cuts = motivated seller; high viewings + zero deals = overpriced

## Platform support

| Platform | Listing capture | Deal records |
|---|---|---|
| Beike / Lianjia (贝壳/链家) | ✅ | ✅ `/chengjiao/` (deal-data tier) |
| Anjuke / 5i5j / Fang.com (安居客/我爱我家/房天下) | ✅ | ❌ estimates only (auto-downgraded, never inflated) |
| Others | generic fallback template | per generic checklist |

> **Compliance stance**: personal research only, manual pace, respect platform terms — no bulk scraping, no captcha/login bypass, no redistribution of page data. This is an independent personal tool, **not affiliated with or endorsed by any platform**; listing data belongs to the platforms.

## Quick start

```bash
git clone https://github.com/ohwald/house-ops.git
cd house-ops
# Open this folder in your AI CLI (Claude Code / ZCode / Cursor), then:
/house-ops intake          # 3-minute interview to build your profile
# …then paste any listing link and ask for a triage or a full evaluation
```

- **Zero dependencies at the core** — there is no app; your AI CLI is the runtime. The script layer runs on Node ≥ 18 built-ins.
- **Works without any AI** for the deterministic parts: `npm run doctor`, `npm run selftest`, `npm run stats`
- **Optional extras** after `npm install`: `npm run dashboard` (terminal console — Enter jumps to the map) and `npm run map:serve` (decision map with profile editing). The map ships with fictional demo data when your repo is empty — press ✨ 演示数据 in the UI to toggle it.

## Architecture

```
├── AGENTS.md            # master spec: data contract, mode routing, anti-hallucination rules
├── CONTEXT.md           # domain glossary + named module seams
├── modes/*.md           # the brain: 13 workflows, one file per mode
├── scrapers/*.mjs       # platform adapters: one module per platform + filesystem registry
├── scripts/*.mjs        # deterministic layer: scan / stats / doctor / dashboard / map (zero-dep)
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

> 跑在 AI CLI（Claude Code / ZCode / Cursor…）里的**购房搜索·汇总·分析操作台**：
> 扫描主流平台的真实在售房源，交叉验证数据真实性，汇总为结构化档案与评级报告。
> AI 负责搜索、汇总、分析；看房、谈判、拍板，始终是你。

设计参考 [career-ops](https://github.com/career-ops-hq/career-ops)：ops = 操作中心——一套可执行、可复跑、越用越准的购房操作流程。

## 它解决什么问题

平台挂牌价是**策略**不是事实，中介话术是**营销**不是信息，AI 直接生成的"评估报告"更可能是**幻觉**（本项目吃过亏：某次会话生成的 10 份报告里，小区不存在、挂牌价打 7 折、连用户画像都被改了）。house-ops 用四条纪律应对：

- **反幻觉**——AI 生成或记忆中的数据不是事实。关键数字必须带来源标记（`[实采]`/`[政务]`/`[用户提供]`/`[未核实]`）；小区不存在、挂牌虚构的报告直接作废，而非降权。
- **交叉验证**——小区存在性、挂牌存在性、价格 vs 均价、满五与上次交易、回迁混居（政府公示判别），七项判定表由脚本机械执行，`provenance` 三态（`verified / suspect / void`）写入每条记录。
- **证据分档**——成交数据 > 挂牌数据 > 中介口述 > 未核实；平台脱敏成交价后，用价格锚点阶梯与流动性信号（带看/在售/去化）替代。
- **过滤而非看遍**——一票否决项（预算/电梯/混居/学位占用）直接封顶；评分分档决定哪里值得花看房时间。

## 工作流：一个购房周期

```
intake 建画像 → App 刷到候选 → triage 速筛 → scan 验真+采价
→ evaluate 评级 → deep-dive 深挖 → compare 对比 → visit 带看清单
→ negotiate 谈判 → contract 审合同 → watchlist/stats 复盘
```

各模式职责见上方英文表格（intake / triage / scan / evaluate / deep-dive / compare / visit / negotiate / contract / watchlist / stats / map / doctor）。评分分档：**≥4.5 强烈推荐**｜**4.0–4.4 值得看房**｜**3.5–3.9 有特定理由才看**｜**<3.5 建议放弃**；命中一票否决项直接封顶 2.5。

## 真实性体系（最大差异点）

房源数据是幻觉重灾区。本项目把"这条数据可不可信"变成**脚本的输出，而不是用户的负担**：

- **采集留痕**——每条扫描记录带 `capture`（通道/时间/URL 是否实访验证）
- **指纹查重**——同一套房 = 小区+面积±0.6㎡+户型+楼层+朝向+年代；跨平台重挂、换壳盘、多平台差价自动归并现形
- **判定表执行**——`scan.mjs verify` 对七项检查逐项判定，判例直接复刻自真实事故
- **政府公示判别**——回迁混居不看平台标签，看规资局土地出让与规划公示的**建设单位**（曾借此识别"低于均价 15%"实为混居社区结构性折价）
- **强约束过滤**——作废数据在共享数据层默认不可见，所有消费入口自动继承，无需人工核对
- **追加式价格历史**——同一房源多次扫描自动聚合：降价+调价频发=以价换量，高带看+零成交=有价无市，房东策略看得见

## 平台支持

| 平台 | 挂牌采集 | 成交明细 |
|---|---|---|
| 贝壳找房 / 链家 | ✅ | ✅ `/chengjiao/`（成交数据档） |
| 安居客 / 我爱我家 / 房天下 | ✅ | ❌ 仅估算行情（自动降档，宁降档不虚标） |
| 其他平台 | generic 兜底清单 | 按通用清单采集 |

> **合规底线**：仅限个人购房研究、手动节奏、遵守平台条款，不绕验证码/登录墙，不公开再分发数据。本项目为独立个人工具，**与任何平台无隶属或背书关系**，房源数据归各平台所有。

## 快速开始

```bash
git clone https://github.com/ohwald/house-ops.git
cd house-ops
# 用你的 AI CLI 打开本目录，然后：
/house-ops intake          # 3 分钟建立需求画像
# 之后直接粘贴房源链接即可
```

- **核心零依赖**：没有应用代码，AI CLI 就是运行时；脚本层纯 Node ≥18 内置模块
- **无 AI 也能跑确定性部分**：`npm run doctor` / `npm run selftest` / `npm run stats`
- **可选增强**：`npm install` 后可用 `npm run dashboard`（终端操作台，Enter 在地图中定位房源）与 `npm run map:serve`（房源决策地图）。仓库为空时地图自带虚构演示数据，UI 里 ✨ 演示数据 可随时切换。

## 架构与数据契约

结构见上方英文 Architecture 一节。**数据契约**：系统层（入库，可升级）与用户层（gitignore，只属于你）严格分离——需求变了重跑 `intake`；个性化规则写进 `modes/_custom.md`。CI 中的 privacy guard 会强制这条边界。

## 设计决策

- [ADR-0001](docs/adr/0001-no-transaction-status-tracking.md) 不做交易状态跟踪（无状态机、无进度漏斗）
- [ADR-0002](docs/adr/0002-data-provenance-verification.md) 数据真实性门槛（模型记忆不作为事实来源；provenance 过滤是强约束）

## 免责声明

house-ops 输出为 AI 生成的分析参考，不构成投资、法律或税务建议。重大交易请自行核实产权与政策（各数据表均标注 as_of），必要时咨询专业人士。

## 致谢

[career-ops](https://github.com/career-ops-hq/career-ops) —— "把 AI CLI 变成生活操作中枢"的原始范式。
