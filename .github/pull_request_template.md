<!--
main 是受保护分支：不能直接 push，也不能强推。所有改动走 PR，
CI 的 ci-gate 全绿之后才允许合并（squash merge）。
-->

## What changes for the user? | 使用者会感知到什么

<!-- Describe what someone running house-ops notices — not just the diff. /
描述运行 house-ops 的人能感知到的变化，而不只是代码差异。 -->

## Type | 类型

- [ ] `feat` new capability / 新能力
- [ ] `fix` wrong behaviour / 修复错误行为
- [ ] `refactor` no behaviour change / 重构（行为不变）
- [ ] `docs` / `test` / `chore`

## Checklist | 检查清单

- [ ] `npm run selftest` passes / 通过
- [ ] `npm run doctor` shows no blocking `⛔` / 无阻塞项
- [ ] Behaviour change → golden case added to `scripts/selftest.mjs` first / 行为变更先补 golden 用例
- [ ] Schema change (`house-ops.scan/1`, Machine Summary) → `modes/*.md` + `scripts/lib/data.mjs` synced / schema 变更三处同步
- [ ] New mode → `modes/*.md` + routing row in `AGENTS.md` and `SKILL.md` / 新模式三件套齐全
- [ ] No user-layer data committed (`config/profile.yml`, `data/`, `reports/`, `modes/_*.md`) / 未提交用户层数据

## Notes for reviewers | 给评审者的备注

<!-- Trade-offs, follow-ups, anything deliberately left out. / 取舍、后续项、刻意不做的事。 -->
