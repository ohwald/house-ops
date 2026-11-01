# Automated rescan (opt-in)

> 中文说明在下方。

house-ops ships an **opt-in** kit that lets fork owners refresh their own watch pool on a schedule with GitHub Actions. Nothing runs in the upstream repository: the workflow template is inert until you copy it into **your own repo**, and all captured data lands in **your** repository only.

**English first, 中文在后。**

## What you get

- `scripts/rescan.mjs` — a deterministic, zero-dependency fetcher: reads your watch URLs, classifies them via the platform registry, fetches with delay + jitter, appends `house-ops.scan/1` records (`capture.channel: "gha-fetch"`), and refreshes the trend index in one run.
- `templates/actions/rescan.example.yml` — a weekly-cron workflow template with manual dispatch and a concurrency guard.
- The trend engine (`scripts/trend.mjs`) then reads the refreshed corpus like any other scan data.

Scope v1: **fang.com only** (server-rendered, stable markup anchors). Other platforms fail loudly as `unsupported_platform` — no guessing parsers. Layout changes produce `parse_failed` messages and **no records** (a garbage record would pollute the corpus; fix the extractor or fall back to manual `/house-ops scan`).

## Setup (5 steps)

1. **Fork — and make it private.** Rescan results are committed to your fork's `user-data` branch. On a public fork that means your watchlist is public. Private fork = your data stays yours.
2. Copy the template into your fork:
   ```bash
   cp templates/actions/rescan.example.yml .github/workflows/rescan.yml
   ```
3. Add a repository **Variable** (Settings → Secrets and variables → Actions → Variables): name `WATCH_URLS`, value = the fang.com URLs you track, one per line. `#` comments allowed:
   ```
   https://sh.esf.fang.com/chushou/3_511432907.htm   # an active listing (order-book diff)
   https://sh.esf.fang.com/loupan/1210031493.htm     # community page (monthly reference price, calibration anchor)
   ```
   Keep it small and weekly: the engine needs **≥3 price events per community per week**, so 3-5 tracked listings per community is the sweet spot. The run cap is **12 fetches** (hard-coded, same budget as the scan mode) — split across two weekly runs if you track more.
4. Run once manually (Actions → rescan → Run workflow) and check the log: each URL should end `✅ [listing]` / `✅ [community]` or an explicit reason.
5. Data lands on the **`user-data` branch** (commits are `[skip ci]`, so upstream CI never runs on them). `main` stays clean. To read the trend: run `node scripts/trend.mjs show <community>` against a checkout of that branch, or leave the branch as your archive and let your agent merge insights into reports.

## Runner reality check

GitHub-hosted runners come from well-known IP ranges that Chinese platforms frequently block. If fetches consistently return 403/shells, switch the job to a **self-hosted runner** on your own machine (`runs-on: [self-hosted]`) — home broadband + real browser headers is the reliable path. The fetcher already sends browser-like headers with a `Referer` (fang detail pages return a 404 shell without one; verified 2026-10-26).

## Compliance

This automation exists for **personal research at a low frequency**. The cap (≤12 fetches/run), delay+jitter, and single-platform scope are deliberate. You own compliance with the platform's terms in your deployment: no bulk scraping, no captcha/login bypass, no redistribution of page data. The upstream project's default remains manual scanning; this kit is your choice, your repo, your responsibility.

## Disable / remove

Delete `.github/workflows/rescan.yml` in your fork (the schedule dies with the file; the `user-data` branch remains as history). To also purge data, delete the branch.

---

# 自动复扫（opt-in）

house-ops 提供一套**可选启用**的套件：fork 用户可以在自己的仓库里用 GitHub Actions 按节奏刷新自己的关注池。上游仓库什么都不跑——工作流模板只有拷进**你自己的仓库**才生效，采集数据也只落在**你的**仓库里。

## 组成

- `scripts/rescan.mjs`：确定性零依赖抓取器——读 URL 清单、经平台注册表分类、带间隔+抖动地抓取、按 `house-ops.scan/1` 追加记录（`capture.channel: "gha-fetch"`），并就地刷新趋势指数。
- `templates/actions/rescan.example.yml`：周度 cron + 手动触发 + 并发守卫的工作流模板。
- v1 范围：**仅房天下**（服务端渲染、标记稳定）。其他平台响亮报 `unsupported_platform`。布局变更 → `parse_failed` 且**不落盘**（垃圾记录会污染语料；修提取器或改走手动 scan）。

## 五步启用

1. **Fork 并设为私有**——采集结果提交到你 fork 的 `user-data` 分支，公开 fork 等于公开你的关注清单。
2. 拷模板：`cp templates/actions/rescan.example.yml .github/workflows/rescan.yml`。
3. 建仓库 **Variable** `WATCH_URLS`（每行一条 URL，支持 `#` 注释）。规模建议：引擎需要每小区每周 ≥3 个幅度事件，**每小区追 3-5 套在售**即可；单次运行硬上限 12 次抓取，多了分两批跑。
4. 手动跑一次（Actions → rescan → Run workflow），看日志每条 URL 是否 `✅` 或给了明确原因。
5. 数据落在 **`user-data` 分支**（提交带 `[skip ci]`，上游 CI 不会在其上运行），`main` 永远干净。读趋势：检出该分支跑 `node scripts/trend.mjs show <小区>`，或把分支当档案让 agent 汇总进报告。

## Runner 现实

GitHub 托管 runner 的 IP 段被国内平台封锁是常态。抓取连续 403/壳页时，把 job 换成**自托管 runner**（你自己机器，`runs-on: [self-hosted]`）——家庭宽带 + 真实浏览器头是可靠路径。抓取器已带浏览器 UA 与 `Referer`（实测详情页缺 Referer 会返回 404 壳页）。

## 合规

本套件只面向**个人低频研究**：限额（单次 ≤12 次）、间隔抖动、单平台都是刻意设计。部署方自行承担遵守平台条款的责任：不批量、不绕验证码/登录墙、不再分发页面数据。上游默认仍是手动扫描——这套东西是你的选择、你的仓库、你的责任。

## 停用

删掉 fork 里的 `.github/workflows/rescan.yml` 即可（定时随文件消失，`user-data` 分支留作历史）；要彻底清数据就删分支。
