# Examples — 示例数据

本目录放的是**对外展示用的虚构样例**，不是真实房源数据。

为什么需要它：`reports/` 与 `data/` 在 `.gitignore` 里（含个人信息，不入库），所以仓库里没有
可供围观者查看的报告实例。这里补上一套合成数据，让 README 的截图/输出与真实产物保持同一结构。

> 小区名、地址、价格、链接、数字**全部为合成数据**，与任何真实房源无关。
> 挂牌链接统一用 `https://example.com/listing/NNN`，不指向任何真实平台页面。

## 目录结构

```text
docs/examples/
├── fixture/
│   ├── reports/          # 5 份评估报告（001 完整示例，002-005 精简）
│   │                     # 结论枚举遵循 modes/evaluate.md：strong_buy | worth_viewing | conditional | pass
│   └── data/watchlist.md # 候选清单：✅ 已核 / ⚠️ 存疑 / ⛔ 作废（006 行，默认不可见）
└── tui-frame.txt         # 下面那条命令的输出快照
```

## 复现 README 里的 TUI 帧

```bash
npm install                  # 仅 TUI 需要（ink + react）
COLUMNS=90 NO_COLOR=1 node scripts/dashboard.mjs docs/examples/fixture
```

`dashboard.mjs` 的第一个参数是 PROJECT_ROOT，指向 fixture 目录即可读这套样例数据。
非 TTY 时 TUI 会输出单帧纯文本，README 里贴的就是这个输出。

## 样例里刻意保留的三件事

1. **⛔ 作废行不可见**：watchlist 第 006 行标 ⛔（小区实体不存在），表格里看不到它——
   作废数据在共享数据层（`scripts/lib/data.mjs`）就被过滤，TUI / `stats` / 地图口径一致（ADR-0002）。
2. **⚠️ 存疑标记进表格**：003、004 编号前带 ⚠️，表示成交锚点或小区实体未核实，
   评分可以给，但引用前必须先续扫。
3. **一票否决封顶**：005 触发画像红线（回迁混居），`hard_dq_hit: true`，评分封顶 2.5 并判 `pass`。
