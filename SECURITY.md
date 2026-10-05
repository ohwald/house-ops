# Security Policy | 安全政策

## Reporting a vulnerability | 报告漏洞

**Please do not report security or privacy issues through public GitHub issues.**
请**不要**通过公开 GitHub Issue 报告安全或隐私问题。

Use GitHub [private security advisories](https://github.com/ohwald/house-ops/security/advisories/new) instead. Reports are reviewed within a week; please include reproduction steps and impact.
请使用 GitHub [私密安全通告](https://github.com/ohwald/house-ops/security/advisories/new) 提交。一周内会给予答复；请附复现步骤与影响说明。

## Scope | 范围

- The script layer (`scripts/`, `scrapers/`): path traversal in file inputs, injection via listing data into generated HTML, unsafe dependency changes
- The generated map page: XSS through listing fields, credential leakage (`AMAP_KEY` is optional and never leaves your machine)
- 脚本层与生成页面的上述类别问题（路径穿越、房源数据注入生成 HTML、凭据泄露等）

## Network posture | 网络姿态

`house-ops` opens no listening ports and starts no background servers. `npm run map` writes a single
self-contained HTML file; you open it directly and it issues no network calls on your behalf beyond the
map tiles it renders. Nothing in this repo accepts inbound connections, so there is no authentication
surface to get wrong.

`house-ops` 不开放任何端口，也不启动后台服务。`npm run map` 只生成一份自包含 HTML 文件，你直接双击打开，
它除渲染地图瓦片外不会替你发起任何网络请求。仓库内没有任何进程接受入站连接，因此也不存在需要正确处理的鉴权面。

Listing URLs are untrusted data, and the TUI does hand them to your system opener. It does so with
`execFile` and an argument array — never by building a shell string — and only for `http(s)` targets or
files that resolve inside the repo. Anything else is refused.

房源链接属于不可信数据，TUI 确实会把它交给系统默认程序打开——但用的是 `execFile` 传参数数组，
而不是拼 shell 字符串；且只放行 `http(s)` 目标与解析后仍落在仓库内的文件，其余一律拒绝。

## Out of scope | 不在范围

- The coding agent itself (report upstream), prompt-injection *content* inside listing pages — the system already treats listing content as untrusted data, never as instructions; new bypasses of that discipline are in scope though
- 编码 agent 自身的问题请报给上游；房源页面内的指令注入内容默认按不可信数据处理，若发现绕过该纪律的新途径则属于范围内
