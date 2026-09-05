# house-ops

**AI 购房决策指挥中心**：把你的 AI 编程 CLI（ZCode / Claude Code 等）变成购房顾问——评估世界各地公开在售房源（优先中国大陆市场），按**你的真实需求**个性化打分，对高分房源深挖调研，并给出沟通谈判建议。

设计参考 [career-ops](https://github.com/career-ops-hq/career-ops)（求职指挥中心），把"过滤职位而非海投"的理念搬到购房：**聚焦而非看遍所有房**。

## 理念

- **过滤而非看遍**：不给 Global < 3.5 的房源花时间；≥ 4.5 才值得全力推进。看房时间是你最稀缺的资源。
- **人在回路**：AI 只评估、推荐、起草话术，**绝不代替你联系中介、承诺价格、签任何东西、碰任何钱**。所有决策与行动永远由你完成。
- **证据优先**：成交价、税费、学区、政策一律标注来源与可靠度档位（成交数据 > 挂牌数据 > 中介口述 > 未核实）；宣传语不采信。
- **本地运行**：数据是你自己的 Markdown/YAML 文件；个人数据不入 git。

## 十二个模式

| 模式 | 用途 |
|---|---|
| `/house-ops intake` | 多轮对话明确购房需求：预算/城市/资格 + **家庭结构**（孩子年龄与入学时间线、老人照护、特殊需求）→ 自动翻译成评估衍生需求与硬性 DQ 规则 |
| `/house-ops triage` | 60 秒速筛：只对照简版画像三问（预算/位置/红线），省 token |
| `/house-ops scan` | 平台扫描：识别贝壳/链家/安居客/我爱我家/房天下等链接，采集挂牌价与成交价，政务公开数据交叉验证（记录落 `data/scans/`，供评估引用） |
| `/house-ops evaluate` | 粘贴房源链接或描述 → 六维评级报告（需求匹配/价格/地段/本体/风险 + Global） |
| `/house-ops deep-dive` | 高分房源（≥4.0）六轴深挖：价格历史/周边环境/本地政策/竞品/交易安全/生活圈 |
| `/house-ops compare` | 2-6 套已评估房源横向对比矩阵 + 场景化结论（预算优先选谁、学区优先选谁） |
| `/house-ops visit` | 带看前生成定制核查清单；带看后记录复盘并触发增量重评 |
| `/house-ops negotiate` | 高分房源：向房东/中介的核实清单、议价空间分析、分轮报价策略、沟通话术草稿 |
| `/house-ops contract` | 审认购书/买卖合同/补充协议/中介协议：13 条走查清单 + 红旗识别 + 修改建议 |
| `/house-ops watchlist` | 关注清单与看房进度跟踪（关注→已评估→已看房→谈判中→已认购→网签→已过户/弃购） |
| `/house-ops stats` | 找房数据统计：分数分布、板块分布、失分模式、弃购原因排行 |
| `/house-ops doctor` | 仓库结构与数据健康自检（也有无 AI 快速版 `npm run doctor`） |

评分分档：**≥4.5 强烈推荐**（立即深挖+谈判准备）｜**4.0–4.4 值得看房**｜**3.5–3.9 有特定理由才看**｜**<3.5 建议放弃**。预算超限、城市不符、无电梯+行动不便老人等硬性 DQ 命中直接封顶 2.5。

## 快速开始

```bash
# 1. 克隆到本地
git clone https://github.com/ohwald/house-ops.git
cd house-ops

# 2. 用你的 AI CLI 打开本目录（ZCode / Claude Code 均可）

# 3. 首次使用：多轮对话建立需求画像
/house-ops intake

# 4. 之后：直接粘贴一条房源链接（链家/贝壳/安居客/中原等），自动走评估流程
```

无需安装任何依赖即可使用全部功能——本仓库没有应用代码，只有 Markdown 指令体系、YAML 配置与数据表，AI CLI 本身就是运行时。唯一可选的安装是终端仪表盘：`npm install` 后运行 `npm run dashboard`（Ink TUI：清单表格/进度漏斗/分数分布/Top 房源，`r` 刷新 `q` 退出；管道环境下自动降级为单帧纯文本）。

## 目录结构

```
house-ops/
├── AGENTS.md            # 总规范：数据契约、评分路由、全局规则（所有 CLI 共读）
├── modes/               # "大脑"：一个 .md 一个工作流
│   ├── _shared.md       #   评分体系、配套分级参考、小区软素质信号（系统层）
│   ├── _profile.md      #   你的画像语义层（gitignore，含家庭结构衍生需求）
│   ├── _brief.md        #   速筛用简版画像（gitignore）
│   └── intake / triage / evaluate / scan / deep-dive / compare /
│       visit / negotiate / contract / watchlist / stats / doctor
├── .agents/skills/house-ops/SKILL.md   # 技能路由器（.claude/ .zcode/ 为符号链接）
├── config/profile.example.yml          # 需求画像模板 → 复制为 profile.yml（gitignore）
├── templates/states.yml                # 购房状态机
├── templates/policy-notes.cn.yml       # 中国政策数据表（限购/税费/贷款/学区/商办/法拍，带 as_of）
├── templates/contract-checklist.cn.yml # 交易合同 13 条走查清单
├── templates/official-sources.cn.yml   # 政务房地产公开数据源登记（scan 交叉验证用，带 as_of）
├── scrapers/*.mjs                      # 平台扫描模板：贝壳/链家/安居客/我爱我家/房天下（一平台一模块，career-ops provider 模式）
├── scripts/*.mjs        # 确定性脚本：编号原子分配 / doctor / stats / scan / Ink TUI dashboard
├── scripts/lib/data.mjs # stats 与 dashboard 共享的数据解析层
├── data/                  # watchlist.md、notes/ 带看记录、scans/ 扫描记录（gitignore）
└── reports/               # 评估报告（gitignore）
```

## 数据契约

- **系统层**（入库）：`AGENTS.md`、`modes/_shared.md`、各模式文件、`templates/`、`config/profile.example.yml`。
- **用户层**（gitignore，只属于你）：`config/profile.yml`、`modes/_profile.md`、`modes/_custom.md`、`data/`、`reports/`。

需求变了 → 再跑 `/house-ops intake`；想覆盖默认评分口径/流程 → 写进 `modes/_custom.md`（直接让 AI 帮你改）。

## 免责声明

house-ops 输出为 AI 生成的分析参考，不构成投资、法律或税务建议。重大交易请自行核实产权与政策（各数据表均标注 as_of），必要时咨询专业人士。
