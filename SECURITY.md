# Security Policy | 安全政策

## Reporting a vulnerability | 报告漏洞

**Please do not report security or privacy issues through public GitHub issues.**
请**不要**通过公开 GitHub Issue 报告安全或隐私问题。

Use GitHub [private security advisories](https://github.com/ohwald/house-ops/security/advisories/new) instead. Reports are reviewed within a week; please include reproduction steps and impact.
请使用 GitHub [私密安全通告](https://github.com/ohwald/house-ops/security/advisories/new) 提交。一周内会给予答复；请附复现步骤与影响说明。

## Scope | 范围

- The script layer (`scripts/`, `scrapers/`): path traversal in file inputs, injection via listing data into generated HTML, unsafe dependency changes
- The generated map page: XSS through listing fields, credential leakage (`AMAP_KEY` is optional and read server-side only)
- 脚本层与生成页面的上述类别问题（路径穿越、房源数据注入生成 HTML、凭据泄露等）

## Out of scope | 不在范围

- The AI CLI itself (report upstream), prompt-injection *content* inside listing pages — the system already treats listing content as untrusted data, never as instructions; new bypasses of that discipline are in scope though
- AI CLI 自身的问题请报给上游；房源页面内的指令注入内容默认按不可信数据处理，若发现绕过该纪律的新途径则属于范围内
