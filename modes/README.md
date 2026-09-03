# modes/ — 工作模式库

house-ops 的"大脑"：由 AI CLI 执行的 Markdown 提示词文件。**一个文件 = 一个工作流**；`_` 前缀为共享上下文/模板，不是可路由模式。

| 文件 | 层 | 用途 |
|---|---|---|
| `_shared.md` | 系统 | 评分体系、全局规则、SoT 表（可自动更新，勿放个人数据） |
| `_profile.template.md` | 种子 | 复制为 `_profile.md`（用户画像语义层，gitignore） |
| `_custom.template.md` | 种子 | 复制为 `_custom.md`（家规/评分口径覆盖，gitignore） |
| `intake.md` | 模式 | 多轮对话采集购房需求 → 生成画像 |
| `evaluate.md` | 模式 | 单房源六维评级 → 报告 + watchlist 登记 |
| `deep-dive.md` | 模式 | 高分房源（≥4.0）六轴深挖 |
| `negotiate.md` | 模式 | 高分房源核实清单、议价策略、沟通话术草稿 |
| `watchlist.md` | 模式 | 关注清单查看/更新/汇总 |

上下文加载顺序：`_shared.md` → `_profile.md` → `_custom.md` → `{mode}.md`。用户层后读、覆盖系统层。
