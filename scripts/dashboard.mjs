#!/usr/bin/env node
// dashboard.mjs — Ink TUI 购房决策中枢仪表盘 (支持高交互光标/详情翻页/打开原网页/状态流转)
// 用法: node scripts/dashboard.mjs [PROJECT_ROOT]   （或 npm run dashboard）
// 交互快捷键:
//   ↑ / ↓ (或 k / j): 上下选择房源
//   Enter: 查看选定房源的深度评估报告
//   o: 在浏览器中打开挂牌原网页 (若无则打开报告文件)
//   s: 变更选定房源的跟踪状态 (直接更新 data/watchlist.md)
//   m: 在浏览器中打开房源决策地图 (http://localhost:3000)
//   r: 刷新数据
//   q / Esc: 退出程序或返回主列表

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import React, { useState, useEffect } from 'react';
import { render, Text, Box, Static, useInput, useApp } from 'ink';
import { collectReports, parseWatchlist, readStates, readReportDetail, updateWatchlistState } from './lib/data.mjs';

const h = React.createElement;
const ROOT = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 跨平台打开 URL 或文件 ----------
function openExternal(target) {
  if (!target) return;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${String(target).replace(/"/g, '\\"')}"`);
}

// ---------- CJK 视觉宽度工具 ----------
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
  const reportMap = new Map();
  for (const r of reports) {
    if (r.report_no) reportMap.set(String(r.report_no).padStart(3, '0'), r);
  }
  return { reports, watchlist: watchlist ?? [], states, reportMap, loadedAt: new Date() };
}

// ---------- 样式与辅助 ----------
const num = s => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };
const scoreColor = s => (s == null ? 'gray' : s >= 4 ? 'green' : s >= 3.5 ? 'yellow' : 'red');
const riskColor = r => ({ low: 'green', caution: 'yellow', 注意: 'yellow', high: 'red', 高风险: 'red' }[r] ?? 'gray');
const CONCLUSION_LABEL = { strong_buy: '强推', worth_viewing: '值得看', conditional: '看情况', pass: '放弃' };
const TERMINAL_STATES = new Set(['已过户', '弃购']);

const dim = (s, key) => h(Text, { key, color: 'gray' }, s);
function sectionTitle(title) {
  return h(Text, { bold: true }, ` ${title} `, h(Text, { color: 'gray' }, '─'.repeat(Math.max(0, 56 - vwidth(title)))));
}

// ---------- 关注清单表格 (带光标指示与高亮) ----------
const COLS = [
  ['编号', 6], ['小区/项目', 16], ['板块', 12], ['总价万', 8], ['Global', 9], ['风险', 9], ['状态', 8],
];
const ROW = [r => r.no, r => r.community, r => r.district, r => r.price, r => r.score, r => r.risk, r => r.state];

function WatchTable({ rows, selectedIndex }) {
  const header = h(Box, { key: 'h' }, [
    h(Box, { key: 'ptr', width: 3 }, h(Text, { bold: true }, '  ')),
    ...COLS.map(([name, w]) =>
      h(Box, { key: name, width: w }, h(Text, { bold: true }, pad(trunc(name, w - 2), w))))
  ]);

  const body = rows.map((r, idx) => {
    const isSelected = idx === selectedIndex;
    const ptr = isSelected ? '▶ ' : '  ';
    const ptrColor = isSelected ? 'cyan' : undefined;

    return h(Box, { key: r.no }, [
      h(Box, { key: 'ptr', width: 3 }, h(Text, { bold: isSelected, color: ptrColor }, ptr)),
      ...COLS.map(([name, w], i) => {
        const raw = ROW[i](r);
        let color = i === 4 ? scoreColor(num(r.score))
          : i === 5 ? riskColor(String(r.risk ?? '').trim())
          : TERMINAL_STATES.has(r.state) ? 'gray' : undefined;

        if (isSelected && i <= 3) {
          color = 'cyan';
        }
        return h(Box, { key: name, width: w },
          h(Text, { bold: isSelected, color, underline: isSelected && i === 1 }, pad(trunc(raw, w - 2), w)));
      })
    ]);
  });

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

// ---------- 进度漏斗 ----------
function Funnel({ watchlist, states }) {
  const parts = [];
  states.forEach((s, i) => {
    const n = watchlist.filter(r => r.state === s).length;
    if (i > 0) parts.push(dim(' → ', `sep${i}`));
    parts.push(h(Text, { key: s, color: n ? undefined : 'gray' }, `${s} ${n}`));
  });
  return h(Box, { flexWrap: 'wrap' }, parts);
}

// ---------- 报告详情视图 (Report Viewer) ----------
function ReportViewer({ reportDetail, reportMeta, scrollOffset, totalLines }) {
  if (!reportDetail) {
    return h(Box, { flexDirection: 'column', padding: 1 }, [
      h(Text, { color: 'yellow', bold: true }, '⚠️ 未找到该房源对应的评估报告'),
      dim('按 Esc 或 q 返回关注清单')
    ]);
  }

  const lines = reportDetail.text.split('\n');
  const visibleCount = 20;
  const maxScroll = Math.max(0, lines.length - visibleCount);
  const currentScroll = Math.min(scrollOffset, maxScroll);
  const displayedLines = lines.slice(currentScroll, currentScroll + visibleCount);

  return h(Box, { flexDirection: 'column' }, [
    // 报告标题栏
    h(Box, { key: 'head', marginBottom: 1, borderStyle: 'round', borderColor: 'cyan', paddingX: 1, flexDirection: 'column' }, [
      h(Box, { key: 'info' }, [
        h(Text, { key: 't', bold: true, color: 'cyan' }, `📄 深度评估报告 · ${reportMeta?.no ?? '???'} ${reportMeta?.community ?? ''}  `),
        h(Text, { key: 's', color: scoreColor(num(reportMeta?.score)) }, `Global: ${reportMeta?.score ?? '—'}  `),
        h(Text, { key: 'r', color: riskColor(reportMeta?.risk) }, `风险: ${reportMeta?.risk ?? '—'}  `),
        dim(`状态: ${reportMeta?.state ?? '—'}`, 'st')
      ]),
      reportDetail.url ? h(Text, { key: 'url', color: 'gray' }, `🔗 挂牌链接: ${reportDetail.url}`) : null
    ]),

    // 报告正文视口
    h(Box, { key: 'body', flexDirection: 'column', minHeight: 20, paddingX: 1 },
      displayedLines.map((line, idx) => {
        let color = undefined;
        let bold = false;
        if (line.startsWith('# ')) { color = 'magenta'; bold = true; }
        else if (line.startsWith('## ')) { color = 'cyan'; bold = true; }
        else if (line.startsWith('### ')) { color = 'yellow'; bold = true; }
        else if (line.includes('```')) { color = 'gray'; }
        else if (line.startsWith('- **') || line.startsWith('|')) { color = 'white'; }
        return h(Text, { key: String(currentScroll + idx), color, bold }, line || ' ');
      })
    ),

    // 滚动与操作指示
    h(Box, { key: 'nav', marginTop: 1, borderStyle: 'single', borderColor: 'gray', paddingX: 1 }, [
      h(Text, { key: 'pg', color: 'green' }, `[第 ${currentScroll + 1}-${Math.min(lines.length, currentScroll + visibleCount)} 行 / 共 ${lines.length} 行] `),
      h(Text, { key: 'hlp', bold: true }, '↑/↓: 滚动 · o: 打开原网页 · Esc / q / Backspace: 返回列表')
    ])
  ]);
}

// ---------- 状态选择弹窗 (Status Picker) ----------
function StatusPicker({ states, currentStatus, selectedStatusIndex, houseName }) {
  return h(Box, {
    flexDirection: 'column',
    borderStyle: 'double',
    borderColor: 'yellow',
    padding: 1,
    marginTop: 1,
    marginBottom: 1,
    width: 60
  }, [
    h(Text, { bold: true, color: 'yellow' }, `🔄 变更房源状态: ${houseName}`),
    dim(`当前状态: [${currentStatus}]  (按 ↑/↓ 选择新状态，Enter 确认，Esc 取消)`),
    h(Box, { flexDirection: 'column', marginTop: 1 },
      states.map((s, idx) => {
        const isSelected = idx === selectedStatusIndex;
        const isCurrent = s === currentStatus;
        return h(Box, { key: s }, [
          h(Text, { bold: isSelected, color: isSelected ? 'cyan' : undefined }, isSelected ? ' ▶ ' : '   '),
          h(Text, { bold: isSelected, color: isSelected ? 'cyan' : isCurrent ? 'green' : undefined },
            `${s}${isCurrent ? ' (当前)' : ''}`)
        ]);
      })
    )
  ]);
}

// ---------- 主控制台视图 (List View) ----------
function MainView({ data, selectedIndex, flashMessage }) {
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
      sectionTitle('关注清单 (上下光标移动)'),
      watchlist.length
        ? h(WatchTable, { rows: watchlist, selectedIndex })
        : dim('  （空 — 首次评估后自动登记）')),

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

    // 即时反馈 Toast
    flashMessage
      ? h(Box, { key: 'flash', marginTop: 1 }, h(Text, { color: 'cyan', bold: true }, `💡 ${flashMessage}`))
      : null,

    // 快捷键底栏
    h(Box, { key: 'foot', marginTop: 1, borderStyle: 'single', borderColor: 'gray', paddingX: 1 },
      h(Text, { bold: true }, '↑/↓: 移动 · Enter: 详细报告 · o: 打开原网页 · s: 变更状态 · m: 地图 · r: 刷新 · q: 退出')
    ),
  ]);
}

// ---------- 交互壳容器 ----------
function Interactive({ onReady }) {
  const [data, setData] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'report' | 'status_picker'
  const [reportDetail, setReportDetail] = useState(null);
  const [reportScroll, setReportScroll] = useState(0);
  const [selectedStatusIndex, setSelectedStatusIndex] = useState(0);
  const [flashMessage, setFlashMessage] = useState('');
  const { exit } = useApp();

  const showToast = (msg, duration = 3000) => {
    setFlashMessage(msg);
    setTimeout(() => setFlashMessage(''), duration);
  };

  const refreshAll = () => {
    loadData().then(d => {
      setData(d);
      setSelectedIndex(idx => Math.min(idx, Math.max(0, (d.watchlist?.length ?? 1) - 1)));
    });
  };

  useEffect(() => {
    let on = true;
    loadData().then(d => {
      if (on) {
        setData(d);
        onReady();
      }
    });
    return () => { on = false; };
  }, []);

  useInput((input, key) => {
    if (!data) return;
    const currentHouse = data.watchlist[selectedIndex];

    // ===== 模式 1: 详情报告视图 =====
    if (viewMode === 'report') {
      if (input === 'q' || key.escape || key.backspace || key.delete) {
        setViewMode('list');
        setReportDetail(null);
        return;
      }
      if (key.upArrow || input === 'k') {
        setReportScroll(s => Math.max(0, s - 2));
        return;
      }
      if (key.downArrow || input === 'j') {
        setReportScroll(s => s + 2);
        return;
      }
      if (key.pageUp) {
        setReportScroll(s => Math.max(0, s - 10));
        return;
      }
      if (key.pageDown) {
        setReportScroll(s => s + 10);
        return;
      }
      if (input === 'o') {
        if (reportDetail?.url) {
          openExternal(reportDetail.url);
          showToast(`已在浏览器打开: ${reportDetail.url}`);
        } else if (reportDetail?.filePath) {
          openExternal(reportDetail.filePath);
          showToast(`已在默认应用打开报告: ${reportDetail.file}`);
        }
        return;
      }
      return;
    }

    // ===== 模式 2: 状态选择器弹窗 =====
    if (viewMode === 'status_picker') {
      if (key.escape || input === 'q') {
        setViewMode('list');
        return;
      }
      if (key.upArrow || input === 'k') {
        setSelectedStatusIndex(i => (i > 0 ? i - 1 : data.states.length - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setSelectedStatusIndex(i => (i < data.states.length - 1 ? i + 1 : 0));
        return;
      }
      if (key.return) {
        const newStatus = data.states[selectedStatusIndex];
        if (currentHouse && newStatus) {
          updateWatchlistState(join(ROOT, 'data', 'watchlist.md'), currentHouse.no, newStatus).then(ok => {
            if (ok) {
              showToast(`✅ 已将 ${currentHouse.no} ${currentHouse.community} 状态变更为 [${newStatus}]`);
              refreshAll();
            } else {
              showToast(`❌ 状态更新失败`);
            }
            setViewMode('list');
          });
        }
        return;
      }
      return;
    }

    // ===== 模式 3: 主列表视图 =====
    if (input === 'q') {
      exit();
      return;
    }
    if (input === 'r') {
      refreshAll();
      showToast('🔄 已重新加载最新数据');
      return;
    }
    if (key.upArrow || input === 'k') {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelectedIndex(i => Math.min(Math.max(0, data.watchlist.length - 1), i + 1));
      return;
    }
    // Enter 查看详情报告
    if (key.return) {
      if (!currentHouse) return;
      readReportDetail(join(ROOT, 'reports'), currentHouse.no).then(detail => {
        if (detail) {
          setReportDetail(detail);
          setReportScroll(0);
          setViewMode('report');
        } else {
          showToast(`⚠️ 未找到编号 ${currentHouse.no} 的详细评估报告`);
        }
      });
      return;
    }
    // o 键打开原始挂牌网页或报告
    if (input === 'o') {
      if (!currentHouse) return;
      readReportDetail(join(ROOT, 'reports'), currentHouse.no).then(detail => {
        if (detail?.url) {
          openExternal(detail.url);
          showToast(`🌐 正在浏览器打开 ${currentHouse.community} 挂牌页面...`);
        } else if (detail?.filePath) {
          openExternal(detail.filePath);
          showToast(`📄 打开本地评估报告: ${detail.file}`);
        } else {
          showToast(`⚠️ 该房源暂无挂牌 URL 记录`);
        }
      });
      return;
    }
    // s 键弹出状态选择器
    if (input === 's') {
      if (!currentHouse) return;
      const curIdx = data.states.indexOf(currentHouse.state);
      setSelectedStatusIndex(curIdx >= 0 ? curIdx : 0);
      setViewMode('status_picker');
      return;
    }
    // m 键打开决策地图
    if (input === 'm') {
      openExternal('http://localhost:3000');
      showToast('🗺️ 已在浏览器打开房源决策地图: http://localhost:3000');
      return;
    }
  });

  if (viewMode === 'report') {
    const currentHouse = data?.watchlist?.[selectedIndex];
    return h(ReportViewer, {
      reportDetail,
      reportMeta: currentHouse,
      scrollOffset: reportScroll,
      totalLines: reportDetail?.text?.split('\n')?.length ?? 0
    });
  }

  const currentHouse = data?.watchlist?.[selectedIndex];

  return h(Box, { flexDirection: 'column' }, [
    h(MainView, { key: 'main', data, selectedIndex, flashMessage }),
    viewMode === 'status_picker'
      ? h(StatusPicker, {
          key: 'picker',
          states: data.states,
          currentStatus: currentHouse?.state,
          selectedStatusIndex,
          houseName: `${currentHouse?.no} ${currentHouse?.community}`
        })
      : null
  ]);
}

// ---------- 运行启动 ----------
const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
if (isTTY) {
  let markReady;
  const ready = new Promise(resolve => { markReady = resolve; });
  const instance = render(h(Interactive, { onReady: markReady }), { exitOnCtrlC: true });
  await instance.waitUntilExit();
} else {
  // 管道/CI: 单帧静态纯文本输出
  const data = await loadData();
  const instance = render(
    h(Static, { items: ['dash'] }, item => h(Box, { key: item, flexDirection: 'column' }, h(MainView, { data, selectedIndex: 0 })))
  );
  setTimeout(() => instance.unmount(), 50);
  await instance.waitUntilExit();
}
