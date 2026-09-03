#!/usr/bin/env node
// dashboard.mjs — Ink TUI 购房决策仪表盘
// 用法: node scripts/dashboard.mjs [PROJECT_ROOT]   （或 npm run dashboard）
// TTY: 实时 TUI，r 刷新 / q 退出；管道/CI: 用 ink Static 输出一帧干净纯文本后退出。
// 说明: 本仓库唯一带依赖的脚本（ink + react）；解析契约复用 scripts/lib/data.mjs。
//       无构建步骤——React.createElement 而非 JSX，保证 node 直接可执行。

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { useState, useEffect } from 'react';
import { render, Text, Box, Static, useInput, useApp } from 'ink';
import { collectReports, parseWatchlist, readStates } from './lib/data.mjs';

const h = React.createElement;
const ROOT = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- CJK 视觉宽度工具（终端里中文占 2 列，直接 padEnd 会错位） ----------
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u3000-\u303E]/;
const vwidth = s => [...String(s)].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0);
const pad = (s, w) => { s = String(s); const d = w - vwidth(s); return d > 0 ? s + ' '.repeat(d) : s; };
const trunc = (s, w) => {
  s = String(s ?? '');
  if (vwidth(s) <= w) return s;
  let out = '';
  for (const ch of s) { if (vwidth(out + ch) > w - 1) break; out += ch; }
  return out + '…';
};

// ---------- 数据加载 ----------
async function loadData() {
  const [reports, watchlist, states] = await Promise.all([
    collectReports(join(ROOT, 'reports')),
    parseWatchlist(join(ROOT, 'data', 'watchlist.md')),
    readStates(join(ROOT, 'templates', 'states.yml')),
  ]);
  return { reports, watchlist: watchlist ?? [], states, loadedAt: new Date() };
}

// ---------- 展示规则 ----------
const num = s => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };
const scoreColor = s => (s == null ? 'gray' : s >= 4 ? 'green' : s >= 3.5 ? 'yellow' : 'red');
const riskColor = r => ({ low: 'green', caution: 'yellow', 注意: 'yellow', high: 'red', 高风险: 'red' }[r] ?? 'gray');
const CONCLUSION_LABEL = { strong_buy: '强推', worth_viewing: '值得看', conditional: '看情况', pass: '放弃' };
const TERMINAL_STATES = new Set(['已过户', '弃购']);

const dim = (s, key) => h(Text, { key, color: 'gray' }, s);
function sectionTitle(title) {
  return h(Text, { bold: true }, ` ${title} `, h(Text, { color: 'gray' }, '─'.repeat(Math.max(0, 56 - vwidth(title)))));
}

// ---------- 关注清单表 ----------
const COLS = [
  ['编号', 6], ['小区/项目', 16], ['板块', 12], ['总价万', 8], ['Global', 9], ['风险', 9], ['状态', 8],
];
const ROW = [r => r.no, r => r.community, r => r.district, r => r.price, r => r.score, r => r.risk, r => r.state];

function WatchTable({ rows }) {
  // 截断到 w-2、补齐到 w：保证省略号和列间各留 1 列
  const header = h(Box, { key: 'h' }, COLS.map(([name, w]) =>
    h(Box, { key: name, width: w }, h(Text, { bold: true }, pad(trunc(name, w - 2), w)))));
  const body = rows.map(r => h(Box, { key: r.no }, COLS.map(([name, w], i) => {
    const raw = ROW[i](r);
    const color = i === 4 ? scoreColor(num(r.score))
      : i === 5 ? riskColor(String(r.risk ?? '').trim())
      : TERMINAL_STATES.has(r.state) ? 'gray' : undefined;
    return h(Box, { key: name, width: w }, h(Text, { color }, pad(trunc(raw, w - 2), w)));
  })));
  return h(Box, { flexDirection: 'column' }, [header, ...body]);
}

// ---------- Global 分数直方图 ----------
function Histogram({ scores }) {
  const bins = [
    ['<3.0', s => s < 3],
    ['3.0-3.5', s => s >= 3 && s < 3.5],
    ['3.5-4.0', s => s >= 3.5 && s < 4],
    ['4.0-4.5', s => s >= 4 && s < 4.5],
    ['4.5+', s => s >= 4.5],
  ];
  return h(Box, { flexDirection: 'column' }, bins.map(([label, pred]) => {
    const n = scores.filter(pred).length;
    return h(Box, { key: label }, [
      h(Text, { key: 'l' }, pad(label, 8)),
      h(Text, { key: 'b', color: n ? 'green' : 'gray' }, ' ' + (n ? '█'.repeat(n) : '·')),
      n ? h(Text, { key: 'c', dimColor: true }, ` ${n}`) : null,
    ]);
  }));
}

// ---------- 状态漏斗（顺序 = templates/states.yml 文件顺序；flexWrap 保证只在段间换行） ----------
function Funnel({ watchlist, states }) {
  const parts = [];
  states.forEach((s, i) => {
    const n = watchlist.filter(r => r.state === s).length;
    if (i > 0) parts.push(dim(' → ', `sep${i}`));
    parts.push(h(Text, { key: s, color: n ? undefined : 'gray' }, `${s} ${n}`));
  });
  return h(Box, { flexWrap: 'wrap' }, parts);
}

// ---------- 纯视图（数据 → 界面） ----------
function View({ data }) {
  if (!data) return dim(' 载入中…');
  const { reports, watchlist, states, loadedAt } = data;
  const date = `${loadedAt.getFullYear()}-${String(loadedAt.getMonth() + 1).padStart(2, '0')}-${String(loadedAt.getDate()).padStart(2, '0')}`;
  const scores = reports.map(r => num(r.score_global)).filter(v => v != null);
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : '—';
  const top = [...reports].sort((a, b) => (num(b.score_global) ?? 0) - (num(a.score_global) ?? 0)).slice(0, 3);

  return h(Box, { flexDirection: 'column' }, [
    h(Box, { key: 'head', marginBottom: 1 },
      h(Text, { bold: true, color: 'magenta' }, 'house-ops 购房决策仪表盘'),
      dim(`  ${date}  ·  已评估 ${reports.length} 套 · watchlist ${watchlist.length} 条 · 均分 ${avg}`, 'sub')),

    h(Box, { key: 'wl', flexDirection: 'column', marginBottom: 1 },
      sectionTitle('关注清单'),
      watchlist.length ? h(WatchTable, { rows: watchlist }) : dim('  （空 — 首次评估后自动登记）')),

    h(Box, { key: 'funnel', flexDirection: 'column', marginBottom: 1 },
      sectionTitle('进度漏斗'), h(Funnel, { watchlist, states })),

    h(Box, { key: 'hist', flexDirection: 'column', marginBottom: 1 },
      sectionTitle('Global 分布'),
      scores.length ? h(Histogram, { scores }) : dim('  （还没有评分）')),

    h(Box, { key: 'top', flexDirection: 'column', marginBottom: 1 },
      sectionTitle('Top 房源'),
      top.length
        ? h(Box, { flexDirection: 'column' }, top.map((r, i) =>
            h(Box, { key: String(r.report_no ?? r.file) },
              h(Text, { color: i === 0 ? 'yellow' : 'gray' }, `${i + 1}. `),
              h(Text, null, `${r.report_no ?? '???'} ${trunc(r.community, 18)}  `),
              h(Text, { color: scoreColor(num(r.score_global)) }, `Global ${r.score_global ?? '—'}`),
              dim(`  ${CONCLUSION_LABEL[r.conclusion] ?? r.conclusion ?? ''}`))))
        : dim('  （还没有评估报告 — 粘贴一条房源链接开始）')),

    dim(' r 刷新 · q 退出', 'foot'),
  ]);
}

// ---------- 交互壳（仅 TTY 挂载：useInput 需要 raw mode） ----------
function Interactive({ onReady }) {
  const [data, setData] = useState(null);
  const { exit } = useApp();
  useInput((input) => {
    if (input === 'q') exit();
    if (input === 'r') { setData(null); loadData().then(setData); }
  });
  useEffect(() => { let on = true; loadData().then(d => { if (on) { setData(d); onReady(); } }); return () => { on = false; }; }, []);
  return h(View, { data });
}

const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
if (isTTY) {
  let markReady;
  const ready = new Promise(resolve => { markReady = resolve; });
  const instance = render(h(Interactive, { onReady: markReady }), { exitOnCtrlC: true });
  await instance.waitUntilExit();
} else {
  // 管道/CI：数据就绪后再挂载，单帧 Static 输出（无中间帧、无清屏转义残留）
  const data = await loadData();
  const instance = render(
    h(Static, { items: ['dash'] }, item => h(Box, { key: item, flexDirection: 'column' }, h(View, { data }))),
  );
  setTimeout(() => instance.unmount(), 50);
  await instance.waitUntilExit();
}
