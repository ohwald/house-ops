#!/usr/bin/env node
// map.mjs — 生成并在地图（高德地图）上可视化聚合决策房源
// 用法:
//   node scripts/map.mjs                # 生成静态页面 data/map.html
//   node scripts/map.mjs --serve [port] # 生成并启动本地轻量 HTTP 服务（支持保存画像）
//   npm run map                         # 快捷方式

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

import { collectReports, parseWatchlist, readStates } from './lib/data.mjs';
import { parseProfile, updateProfileFields } from './lib/profile.mjs';
import { loadGeoCache, saveGeoCache } from './lib/geo.mjs';
import { renderMapHtml } from './lib/map-html.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEO_CACHE_PATH = join(ROOT, 'data', '.geo-cache.json');
const PROFILE_PATH = join(ROOT, 'config', 'profile.yml');
const DEFAULT_OUT_PATH = join(ROOT, 'data', 'map.html');

// 命令行参数解析
const args = process.argv.slice(2);
const isServe = args.includes('--serve');
const isHelp = args.includes('--help') || args.includes('-h');

if (isHelp) {
  console.log(`
house-ops 地图决策中枢

用法:
  node scripts/map.mjs                # 生成静态 HTML (data/map.html)
  node scripts/map.mjs --serve [port] # 启动本地服务并自动在浏览器中打开 (默认端口 3000)
  node scripts/map.mjs --out <file>   # 指定输出文件路径

选项:
  --serve [port]   启动本地 API 服务器，支持将页面修改实时持久化到 config/profile.yml
  --out <file>     自定义生成的 HTML 输出路径 (默认: data/map.html)
  --help, -h       查看帮助说明
`);
  process.exit(0);
}

let outPath = DEFAULT_OUT_PATH;
const outIdx = args.indexOf('--out');
if (outIdx !== -1 && args[outIdx + 1]) {
  outPath = join(process.cwd(), args[outIdx + 1]);
}

let servePort = 3000;
const serveIdx = args.indexOf('--serve');
if (serveIdx !== -1 && args[serveIdx + 1] && !args[serveIdx + 1].startsWith('-')) {
  servePort = Number(args[serveIdx + 1]) || 3000;
}

// 聚合数据加载
async function loadFullData() {
  const [reports, watchlist, states, rawProfile, geoCache] = await Promise.all([
    collectReports(join(ROOT, 'reports')),
    parseWatchlist(join(ROOT, 'data', 'watchlist.md')),
    readStates(join(ROOT, 'templates', 'states.yml')),
    readFile(PROFILE_PATH, 'utf8').catch(() => ''),
    loadGeoCache(GEO_CACHE_PATH),
  ]);

  const parsedProfile = parseProfile(rawProfile);

  // 状态机补充到报告列表中（如果 reports 里有匹配 watchlist 编号）
  const watchMap = new Map((watchlist || []).map(w => [w.no, w]));
  const mergedReports = reports.map(r => {
    const w = watchMap.get(r.report_no);
    return {
      ...r,
      state: w ? w.state : (r.state || '已评估'),
      watchlist_note: w ? w.note : '',
    };
  });

  return {
    reports: mergedReports,
    watchlist: watchlist || [],
    states,
    profile: parsedProfile,
    rawYaml: rawProfile,
    geoCache,
    amapKey: process.env.AMAP_KEY || '',
    amapSecurity: process.env.AMAP_SECURITY || '',
  };
}

async function main() {
  const data = await loadFullData();
  const html = renderMapHtml({ initialData: data, config: { serverMode: isServe } });

  // 确保目录存在并写入静态 HTML
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');
  console.log(`✅ 地图决策页面已生成: ${outPath}`);

  if (!isServe) {
    console.log(`💡 提示: 可直接在浏览器中双击打开该文件，或运行 \`npm run map:serve\` 启动可实时保存画像的本地服务。`);
    return;
  }

  // 启动零依赖本地 HTTP 服务
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // CORS 标头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 页面路由
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const freshData = await loadFullData();
      const freshHtml = renderMapHtml({ initialData: freshData, config: { serverMode: true } });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(freshHtml);
      return;
    }

    // API: 获取最新数据
    if (url.pathname === '/api/data') {
      const freshData = await loadFullData();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(freshData));
      return;
    }

    // API: 更新用户画像 (POST /api/profile)
    if (url.pathname === '/api/profile' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          const currentYaml = await readFile(PROFILE_PATH, 'utf8').catch(() => '');
          let newYaml = '';

          if (payload.rawYaml && payload.rawYaml.trim()) {
            newYaml = payload.rawYaml;
          } else if (payload.patch) {
            newYaml = updateProfileFields(currentYaml, payload.patch);
          }

          if (newYaml) {
            await writeFile(PROFILE_PATH, newYaml, 'utf8');
            console.log(`📝 已同步更新需求画像: ${PROFILE_PATH}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, message: '画像已保存' }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: '内容为空或无法解析' }));
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // API: 更新坐标缓存 (POST /api/geo-cache)
    if (url.pathname === '/api/geo-cache' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const newEntries = JSON.parse(body);
          const currentCache = await loadGeoCache(GEO_CACHE_PATH);
          const merged = { ...currentCache, ...newEntries };
          await saveGeoCache(GEO_CACHE_PATH, merged);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false }));
        }
      });
      return;
    }

    // API: 查看原始报告内容 (GET /api/report)
    if (url.pathname === '/api/report') {
      const fileName = url.searchParams.get('file');
      if (!fileName || fileName.includes('..') || fileName.includes('/')) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid file name');
        return;
      }
      try {
        const content = await readFile(join(ROOT, 'reports', fileName), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
        res.end(content);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Report not found');
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️  端口 ${servePort} 已被占用，正在尝试端口 ${servePort + 1}...`);
      servePort++;
      server.listen(servePort);
    } else {
      console.error('服务启动失败:', err);
    }
  });

  server.listen(servePort, () => {
    const url = `http://localhost:${servePort}`;
    console.log(`🚀 购房决策地图本地服务已启动: ${url}`);
    console.log(`💡 在页面修改需求将自动持久化到 config/profile.yml`);
    console.log(`按 Ctrl+C 退出服务`);

    // 尝试自动在默认浏览器中打开
    const cmd = process.platform === 'darwin' ? `open "${url}"`
      : process.platform === 'win32' ? `start "" "${url}"`
      : `xdg-open "${url}"`;
    exec(cmd).unref();
  });
}

main().catch(err => {
  console.error('生成地图失败:', err);
  process.exit(1);
});
