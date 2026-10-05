#!/usr/bin/env node
// map.mjs — 生成并在地图（高德地图）上可视化聚合决策房源
// 用法:
//   node scripts/map.mjs                # 生成静态页面 data/map.html
//   node scripts/map.mjs --serve [port] # 生成并启动本地轻量 HTTP 服务（支持保存画像）
//   npm run map                         # 快捷方式

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { collectReports, parseWatchlist, effectiveProvenance, num } from './lib/data.mjs';
import { parseProfile, updateProfileFields } from './lib/profile.mjs';
import { loadGeoCache, saveGeoCache } from './lib/geo.mjs';
import { decide, isUserExcluded } from './lib/decision.mjs';
import { renderMapHtml } from './lib/map-html.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEO_CACHE_PATH = join(ROOT, 'data', 'geo-cache.json');
const PROFILE_PATH = join(ROOT, 'config', 'profile.yml');
const DEFAULT_OUT_PATH = join(ROOT, 'data', 'map.html');
// 只认这几个名字为本机回环；其它一律视为对外暴露，启动时必须显式警告
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

// 命令行参数解析
const args = process.argv.slice(2);
const isServe = args.includes('--serve');
const isHelp = args.includes('--help') || args.includes('-h');

if (isHelp) {
  console.log(`
house-ops 地图决策中枢

用法:
  node scripts/map.mjs                # 生成静态页面 data/map.html
  node scripts/map.mjs --serve [port] # 生成并启动本地轻量 HTTP 服务（支持保存画像）
  npm run map                         # 快捷方式

选项:
  --serve [port]   启动本地 API 服务器，支持将页面修改实时持久化到 config/profile.yml
  --host <address> 监听地址（默认 127.0.0.1，仅本机可达）
  --out <file>     自定义生成的 HTML 输出路径 (默认: data/map.html)
  --help, -h       查看帮助说明

安全说明:
  服务只监听 127.0.0.1，且写接口（POST）需要本次启动生成的一次性 token。
  改用 --host 0.0.0.0 会让同一网络内的任何人读到你的报告并改写画像，请自行权衡。
  The server binds 127.0.0.1 only, and POST endpoints need a per-run token.
  Binding a non-loopback address exposes your reports and profile to the whole network.
`);
  process.exit(0);
}

let outPath = DEFAULT_OUT_PATH;
const outIdx = args.indexOf('--out');
if (outIdx !== -1 && args[outIdx + 1]) {
  outPath = resolve(process.cwd(), args[outIdx + 1]);  // resolve：绝对路径按绝对语义处理
}

let servePort = 3000;
const serveIdx = args.indexOf('--serve');
if (serveIdx !== -1 && args[serveIdx + 1] && !args[serveIdx + 1].startsWith('-')) {
  servePort = Number(args[serveIdx + 1]) || 3000;
}

// 监听地址：默认回环。house-ops 的口径是「数据不出仓库」，服务默认不该出本机。
let serveHost = '127.0.0.1';
const hostIdx = args.indexOf('--host');
if (hostIdx !== -1 && args[hostIdx + 1] && !args[hostIdx + 1].startsWith('-')) {
  serveHost = args[hostIdx + 1];
}
const isLoopbackHost = LOOPBACK_HOSTS.has(serveHost);
// 写接口的一次性 token：每次启动随机生成，注入页面，浏览器之外的调用方拿不到
const writeToken = randomBytes(16).toString('hex');

// 聚合数据加载
async function loadFullData() {
  let geoCache = await loadGeoCache(GEO_CACHE_PATH);
  if (Object.keys(geoCache).length === 0) {
    geoCache = await loadGeoCache(join(ROOT, 'data', '.geo-cache.json'));
  }

  const [reports, watchlist, rawProfile] = await Promise.all([
    collectReports(join(ROOT, 'reports')),
    parseWatchlist(join(ROOT, 'data', 'watchlist.md')),
    readFile(PROFILE_PATH, 'utf8').catch(() => ''),
  ]);

  const parsedProfile = parseProfile(rawProfile);

  // 备注与地理坐标补充到报告列表中
  // 真实性（ADR-0002）：⛔作废报告已在 data 层过滤不上图；真实性折叠唯一出口 effectiveProvenance
  const watchMap = new Map((watchlist || []).map(w => [w.no, w]));
  const mergedReports = reports
    .map(r => {
      const w = watchMap.get(r.report_no);
      const key = [r.city, r.district, r.community].filter(Boolean).join('·');
      const coords = r.coords || geoCache[key] || geoCache[r.community] || null;
      const wScore = w ? num(w.score) : null;
      const note = w ? w.note : '';
      return {
        ...r,
        coords,
        score_global: (w && wScore != null) ? wScore : (r.score_global ?? null),
        risk_tier: r.risk_tier ?? (w?.risk ?? ''),
        watchlist_note: note,
        user_excluded: isUserExcluded(note),
        authenticity: effectiveProvenance(r, w),
      };
    })
    // 决策分层服务端预计算（scripts/lib/decision.mjs 唯一实现），页面 JS 只渲染
    .map(h => ({ ...h, decision: decide(h) }));

  return {
    reports: mergedReports,
    watchlist: watchlist || [],
    // 工作锚点由画像驱动（buyer.work_location_coords = [经度, 纬度]，intake 采集或地图页写入）；
    // 未设置时地图不绘制锚点与通勤圈，不内置任何默认位置
    workAnchor: {
      coords: (parsedProfile && parsedProfile.buyer && parsedProfile.buyer.work_location_coords) || null,
      label: (parsedProfile && parsedProfile.buyer && parsedProfile.buyer.work_location) || '',
    },
    profile: parsedProfile,
    rawYaml: rawProfile,
    geoCache,
    amapKey: process.env.AMAP_KEY || '',
    amapSecurity: process.env.AMAP_SECURITY || '',
  };
}

async function main() {
  const data = await loadFullData();
  const html = renderMapHtml({ initialData: data, config: { serverMode: isServe, writeToken } });

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

    // 同源才给 CORS：页面由本服务提供，本来就同源，不需要 `*`。
    // 曾经的 `Access-Control-Allow-Origin: *` 意味着任意网站的脚本都能跨域读报告、改画像。
    const origin = req.headers.origin ?? '';
    const isSameOrigin = (() => {
      if (!origin) return false;
      try {
        return LOOPBACK_HOSTS.has(new URL(origin).hostname);
      } catch {
        return false;
      }
    })();
    if (isSameOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-House-Ops-Token');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(isSameOrigin ? 204 : 403);
      res.end();
      return;
    }

    // 写接口鉴权：本次启动生成的一次性 token，页面自带，外部调用方拿不到
    const isWrite = req.method === 'POST'
      && (url.pathname === '/api/profile' || url.pathname === '/api/geo-cache');
    if (isWrite && req.headers['x-house-ops-token'] !== writeToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '缺少或错误的写 token（X-House-Ops-Token）' }));
      return;
    }

    // 页面路由
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const freshData = await loadFullData();
      const freshHtml = renderMapHtml({ initialData: freshData, config: { serverMode: true, writeToken } });
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
            // profile 契约表驱动（lib/profile.mjs）：无匹配行/未知键显式报错，不再静默 no-op
            const result = updateProfileFields(currentYaml, payload.patch);
            if (result.missing.length || result.unknown.length) {
              const bad = [...result.missing, ...result.unknown].join(', ');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: `以下字段无法更新（配置缺行或不在契约中）: ${bad}` }));
              return;
            }
            if (!result.applied.length) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: '补丁为空：没有任何可更新字段' }));
              return;
            }
            newYaml = result.text;
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
      server.listen(servePort, serveHost);
    } else {
      console.error('服务启动失败:', err);
    }
  });

  server.listen(servePort, serveHost, () => {
    const displayHost = isLoopbackHost ? 'localhost' : serveHost;
    const url = `http://${displayHost}:${servePort}`;
    console.log(`🚀 房源地图本地服务已启动: ${url}`);
    console.log(`💡 在页面修改需求将自动持久化到 config/profile.yml`);
    console.log(`按 Ctrl+C 退出服务`);

    if (!isLoopbackHost) {
      console.log('');
      console.log(`⚠️  当前监听 ${serveHost}（非回环地址）：同一网络内的任何人都能读你的报告、改写 config/profile.yml。`);
      console.log('   Listening on a non-loopback address: anyone on this network can read your reports and rewrite config/profile.yml.');
      console.log('   仅为本人使用时请不要加 --host，默认 127.0.0.1 即可。');
    }

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
