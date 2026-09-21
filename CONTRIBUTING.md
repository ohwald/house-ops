# Contributing | 贡献指南

Thanks for your interest in improving house-ops! This is an opinionated system — a few rules keep it coherent. / 感谢关注 house-ops！这是一套主张鲜明的系统，几条规则保持它的连贯性。

## Repository layout | 仓库结构

- **System layer** (versioned, upgradeable): `AGENTS.md`, `modes/`, `scrapers/`, `scripts/`, `templates/`, `docs/`
- **User layer** (gitignored, yours alone): `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `data/`, `reports/`

See `AGENTS.md` → **Data Contract** for the authoritative split. / 用户层与系统层的权威边界见 `AGENTS.md` 的 Data Contract。

## Ground rules | 基本规则

1. **Never commit user data.** Profiles, watchlists, scan records, reports, screenshots of real listings — all of it stays local. CI runs a privacy guard that fails the build if any of it lands in the tree. / **绝不提交用户数据。**画像、清单、扫描记录、报告、真实房源截图全部留在本地；CI 的 privacy guard 会拦截。
2. **Anti-hallucination discipline is code, not vibes.** If your change touches scanning, scoring, or provenance, add golden cases to `scripts/selftest.mjs` first. / 反幻觉纪律要落在代码与测试上：改动涉及扫描/评分/真实性时，先在 `scripts/selftest.mjs` 加 golden 用例。
3. **Respect the ADRs.** `docs/adr/` records decisions (e.g. no transaction-status tracking). Re-open them in an issue before contradicting them in code. / 尊重 ADR：推翻已有决策先开 issue 讨论再动代码。
4. **Manual pace only.** Scraper changes must keep the compliance stance: personal research, no bulk scraping, no captcha/login bypass. / 平台采集只限个人研究节奏，不批量、不绕认证。

## Development | 开发

```bash
npm install                 # only needed for the dashboard (ink/react); core scripts are zero-dependency
npm run selftest            # golden tests — must pass
npm run doctor              # repo & data health
npm run map                 # regenerate the decision map page
node scripts/map.mjs --out /tmp/demo.html   # smoke-check changes to the page generator
```

All scripts run on Node ≥ 18 built-ins only. Don't add runtime dependencies to the script layer; the dashboard's `ink`/`react` is the sole exception. / 脚本层只用 Node ≥18 内置模块，不要引入运行时依赖；`ink`/`react` 仅限 dashboard。

## Commit messages | 提交信息

**English [Conventional Commits](https://www.conventionalcommits.org/), always** — this keeps history readable for an international audience:

```
feat(map): add commute isochrone rings to the decision map
fix(scan): normalize unit price when listing omits it
docs(readme): expand the authenticity section
chore(repo): bump actions to node 22
```

- `feat | fix | refactor | docs | test | chore | art | perf`, optional scope in parentheses
- Subject line in English, imperative mood, ≤ 72 chars; the body may be in Chinese for nuance
- One logical change per commit; CI must pass before push

## Pull requests | PR

- Small and focused beats large and sweeping / 小而聚焦优先
- Describe *what a user of the system notices*, not just what changed / 描述「系统使用者能感知到什么」
- New modes belong in `modes/*.md` + a routing row in `AGENTS.md` + `SKILL.md` / 新模式三件套要齐全
- If it changes a schema (`house-ops.scan/1`, Machine Summary), sync `modes/scan.md` / `modes/evaluate.md` / `scripts/lib/data.mjs` and add golden tests / 改 schema 必须三处同步并补测试

## License

MIT — by contributing you agree your contributions are licensed under it. / 提交即表示同意以 MIT 许可发布。
