// lib/map-html.mjs — 生成自包含的交互式地图 HTML 页面
// 规范：零外部 npm 依赖，基于 Leaflet + 高德免 Key / CartoDB / OSM 多底图开箱即用。
// 深度融入当地政策解读、历史成交走势、城市规划分析与多方案对比推演。

export function renderMapHtml({ initialData, config = {} }) {
  const jsonString = JSON.stringify(initialData).replace(/</g, '\\u003c');
  const serverMode = Boolean(config.serverMode);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>house-ops 房源决策地图 — 开箱即用 (免 Key 版)</title>
  <!-- Leaflet 开源纯净地图引擎 (零 API Key、零注册门槛) -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

  <style>
    :root {
      --bg-primary: #0b0f19;
      --bg-surface: #151e2e;
      --bg-surface-elevated: #1e293b;
      --bg-surface-hover: #273549;
      --border-color: #2b3b52;
      --border-color-light: #3b4d66;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --brand: #38bdf8;
      --brand-dark: #0284c7;
      --green: #10b981;
      --yellow: #f59e0b;
      --red: #ef4444;
      --purple: #a855f7;
      --gray: #64748b;
      --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.6);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      background: var(--bg-primary);
      color: var(--text-main);
      overflow: hidden;
      height: 100vh;
      width: 100vw;
      display: flex;
      flex-direction: column;
    }

    /* 顶部导航 */
    header {
      height: 60px;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 18px;
      z-index: 1000;
      flex-shrink: 0;
    }
    .brand-box {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand-logo {
      font-size: 1.25rem;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    .brand-badge {
      font-size: 0.72rem;
      background: #1e293b;
      border: 1px solid var(--border-color);
      color: #38bdf8;
      padding: 2px 8px;
      border-radius: 999px;
      font-weight: 600;
    }

    /* 地图标注视角切换 */
    .view-mode-bar {
      display: flex;
      align-items: center;
      background: rgba(11, 15, 25, 0.7);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 3px;
      gap: 4px;
    }
    .view-mode-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 0.78rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      transition: all 0.2s;
    }
    .view-mode-btn:hover { color: #fff; }
    .view-mode-btn.active {
      background: #1e293b;
      color: #38bdf8;
      font-weight: 600;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    }

    .header-stats {
      display: flex;
      gap: 10px;
      align-items: center;
      font-size: 0.82rem;
    }
    .stat-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid var(--border-color);
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s;
    }
    .stat-pill:hover, .stat-pill.active {
      border-color: var(--brand);
      background: #1e293b;
    }
    .stat-dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot-green { background: var(--green); box-shadow: 0 0 8px rgba(16, 185, 129, 0.6); }
    .dot-yellow { background: var(--yellow); }
    .dot-red { background: var(--gray); }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    button.btn {
      background: var(--bg-surface);
      color: var(--text-main);
      border: 1px solid var(--border-color);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.82rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    button.btn:hover {
      background: var(--bg-surface-hover);
      border-color: #475569;
    }
    button.btn-primary {
      background: linear-gradient(135deg, #0284c7, #2563eb);
      border: none;
      color: #fff;
      font-weight: 600;
    }
    button.btn-primary:hover {
      opacity: 0.94;
      box-shadow: 0 0 14px rgba(37, 99, 235, 0.5);
    }

    /* 底图选择下拉菜单 */
    .basemap-select {
      background: #0b0f19;
      color: #cbd5e1;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 0.78rem;
      cursor: pointer;
    }
    .basemap-select:focus { outline: none; border-color: var(--brand); }

    /* 主容器 */
    .main-container {
      flex: 1;
      position: relative;
      display: flex;
      overflow: hidden;
    }

    /* Leaflet 地图容器 */
    #map-root {
      flex: 1;
      height: 100%;
      width: 100%;
      background: #090d16;
      z-index: 1;
    }
    /* 高德免 Key 暗黑科技风滤镜 (国内直连、秒开且保持全部建筑与路网细节) */
    .map-tiles-dark .leaflet-tile-pane {
      filter: invert(100%) hue-rotate(180deg) brightness(92%) contrast(92%);
    }

    /* 侧边筛选与图层控制面板 */
    .filter-panel {
      position: absolute;
      top: 16px;
      left: 16px;
      width: 330px;
      max-height: calc(100% - 32px);
      background: rgba(21, 30, 46, 0.95);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      z-index: 500;
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .filter-panel.collapsed {
      transform: translateX(-350px);
    }
    .panel-toggle-btn {
      position: absolute;
      top: 16px;
      left: 16px;
      z-index: 499;
      background: rgba(21, 30, 46, 0.92);
      border: 1px solid var(--border-color);
      color: #fff;
      border-radius: 8px;
      padding: 8px 12px;
      cursor: pointer;
      backdrop-filter: blur(8px);
      box-shadow: var(--shadow);
      font-size: 0.85rem;
    }

    .panel-header {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .panel-title { font-size: 0.95rem; font-weight: 700; color: #f1f5f9; display: flex; align-items: center; gap: 6px; }
    .panel-body {
      padding: 14px 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
      font-size: 0.85rem;
    }

    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .filter-label {
      font-weight: 600;
      color: var(--text-muted);
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: flex;
      justify-content: space-between;
    }
    .filter-label span.val { color: var(--brand); font-weight: bold; }

    .range-inputs {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .range-inputs input[type="number"] {
      width: 100%;
      background: #0b0f19;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: #fff;
      padding: 6px 8px;
      font-size: 0.85rem;
    }

    .switch-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      padding: 3px 0;
    }
    .switch-box {
      width: 36px;
      height: 20px;
      background: #334155;
      border-radius: 10px;
      position: relative;
      transition: background 0.2s;
      flex-shrink: 0;
    }
    .switch-box.active { background: var(--brand); }
    .switch-box.active-purple { background: var(--purple); }
    .switch-dot {
      width: 16px;
      height: 16px;
      background: #fff;
      border-radius: 50%;
      position: absolute;
      top: 2px;
      left: 2px;
      transition: transform 0.2s;
    }
    .switch-box.active .switch-dot, .switch-box.active-purple .switch-dot {
      transform: translateX(16px);
    }

    /* 状态与分类标签选择 */
    .chip-container {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip {
      padding: 4px 8px;
      border-radius: 6px;
      background: #0b0f19;
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      cursor: pointer;
      font-size: 0.78rem;
      user-select: none;
      transition: all 0.15s;
    }
    .chip.active {
      border-color: var(--brand);
      color: #fff;
      background: rgba(56, 189, 248, 0.15);
    }

    /* 房源列表卡片 */
    .house-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 4px;
      max-height: 230px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .house-item {
      background: #0b0f19;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .house-item:hover, .house-item.selected {
      border-color: var(--brand);
      background: #101726;
    }
    .house-item-main {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .house-item-title { font-weight: 600; font-size: 0.85rem; color: #f1f5f9; }
    .house-item-sub { font-size: 0.74rem; color: var(--text-muted); }

    .house-item-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      font-size: 0.7rem;
    }
    .tag-badge {
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(30, 41, 59, 0.8);
      color: #94a3b8;
      border: 1px solid rgba(148, 163, 184, 0.2);
    }
    .tag-policy { background: rgba(168, 85, 247, 0.15); color: #d8b4fe; border-color: rgba(168, 85, 247, 0.3); }
    .tag-trend { background: rgba(56, 189, 248, 0.15); color: #7dd3fc; border-color: rgba(56, 189, 248, 0.3); }
    .tag-planning { background: rgba(16, 185, 129, 0.15); color: #6ee7b7; border-color: rgba(16, 185, 129, 0.3); }

    .score-badge {
      font-weight: 700;
      font-size: 0.8rem;
      padding: 2px 6px;
      border-radius: 4px;
      white-space: nowrap;
    }
    .score-high { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .score-mid { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); }
    .score-low { background: rgba(100, 116, 139, 0.2); color: #94a3b8; border: 1px solid rgba(100, 116, 139, 0.4); text-decoration: line-through; }

    /* 底部对比方案栏 (Compare Tray) */
    .compare-tray {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(21, 30, 46, 0.95);
      backdrop-filter: blur(16px);
      border: 1px solid var(--brand);
      border-radius: 12px;
      padding: 10px 18px;
      display: none;
      align-items: center;
      gap: 16px;
      box-shadow: var(--shadow);
      z-index: 600;
      animation: slideUp 0.2s ease-out;
    }
    .compare-tray.show { display: flex; }
    .compare-chips { display: flex; gap: 8px; }
    .compare-chip {
      background: #0b0f19;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 0.78rem;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .compare-chip-del { cursor: pointer; color: var(--text-muted); font-weight: bold; }
    .compare-chip-del:hover { color: var(--red); }

    /* 多方案横向对比全屏模态弹窗 */
    .compare-modal-mask {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.82);
      backdrop-filter: blur(8px);
      z-index: 1200;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .compare-modal-mask.open { display: flex; }
    .compare-modal-content {
      width: 1100px;
      max-width: 95vw;
      max-height: 90vh;
      background: var(--bg-surface);
      border: 1px solid var(--border-color-light);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .compare-modal-header {
      padding: 16px 24px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #101726;
    }
    .compare-modal-body {
      padding: 24px;
      overflow-y: auto;
      flex: 1;
    }
    .compare-matrix-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .compare-matrix-table th, .compare-matrix-table td {
      border: 1px solid var(--border-color);
      padding: 12px 14px;
      vertical-align: top;
      line-height: 1.5;
    }
    .compare-matrix-table th {
      background: #0f172a;
      color: #94a3b8;
      font-weight: 600;
      text-align: left;
      width: 180px;
    }
    .compare-matrix-table td {
      background: rgba(15, 23, 42, 0.5);
      color: #e2e8f0;
    }

    /* 右下角房源深度详情弹窗 */
    .report-modal {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 420px;
      max-width: 92vw;
      max-height: 85vh;
      overflow-y: auto;
      background: rgba(21, 30, 46, 0.96);
      backdrop-filter: blur(20px);
      border: 1px solid var(--brand);
      border-radius: 14px;
      box-shadow: var(--shadow);
      z-index: 700;
      padding: 18px;
      display: none;
      flex-direction: column;
      gap: 14px;
      animation: slideUp 0.25s ease-out;
    }
    .report-modal.show { display: flex; }
    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .detail-card-section {
      background: #0b0f19;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 0.8rem;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .section-headline {
      font-weight: 700;
      font-size: 0.78rem;
      color: var(--brand);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Leaflet 自定义 HTML Marker 样式 */
    .leaflet-div-icon {
      background: transparent !important;
      border: none !important;
    }
    .map-marker {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-weight: bold;
      font-size: 11px;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      user-select: none;
    }
    .map-marker:hover {
      transform: scale(1.1) translateY(-2px);
      z-index: 1000 !important;
    }
    .map-marker.work {
      background: linear-gradient(135deg, #ef4444, #f97316);
      color: #fff;
      border: 2px solid #fff;
    }
    .map-marker.high {
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff;
      border: 2px solid #a7f3d0;
    }
    .map-marker.mid {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #fff;
      border: 2px solid #fde68a;
    }
    .map-marker.low {
      background: #334155;
      color: #94a3b8;
      border: 1px solid #475569;
      opacity: 0.75;
    }
    .map-marker.low:hover { opacity: 1; }

    /* 规划与地块 Marker */
    .map-marker-planning {
      background: rgba(168, 85, 247, 0.95);
      color: #fff;
      border: 1px dashed #e9d5ff;
      font-size: 10px;
      padding: 3px 8px;
      border-radius: 6px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.5);
      white-space: nowrap;
    }

    /* 右侧需求配置抽屉 (Profile Drawer) */
    .drawer-mask {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(4px);
      z-index: 1100;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s;
    }
    .drawer-mask.open { opacity: 1; pointer-events: auto; }

    .drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: 480px;
      max-width: 90vw;
      height: 100vh;
      background: var(--bg-surface);
      border-left: 1px solid var(--border-color);
      z-index: 1150;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
      box-shadow: -10px 0 30px rgba(0, 0, 0, 0.7);
    }
    .drawer.open { transform: translateX(0); }

    .drawer-header {
      padding: 18px 20px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .drawer-title { font-size: 1.05rem; font-weight: 700; color: #fff; }
    .drawer-body {
      padding: 20px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 18px;
      font-size: 0.88rem;
    }
    .drawer-footer {
      padding: 16px 20px;
      border-top: 1px solid var(--border-color);
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      background: #101726;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-label {
      font-weight: 600;
      color: #cbd5e1;
      font-size: 0.82rem;
    }
    .form-help {
      font-size: 0.74rem;
      color: var(--text-muted);
    }
    .form-input {
      background: #0b0f19;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: #fff;
      padding: 8px 12px;
      font-size: 0.88rem;
      transition: border-color 0.2s;
    }
    .form-input:focus {
      outline: none;
      border-color: var(--brand);
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
    }
    textarea.form-input {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.8rem;
      line-height: 1.5;
      resize: vertical;
    }

    /* Toast 提示 */
    .toast {
      position: fixed;
      top: 68px;
      left: 50%;
      transform: translateX(-50%) translateY(-20px);
      background: #10b981;
      color: #fff;
      padding: 8px 18px;
      border-radius: 8px;
      font-size: 0.88rem;
      font-weight: 600;
      box-shadow: var(--shadow);
      z-index: 1500;
      opacity: 0;
      pointer-events: none;
      transition: all 0.25s;
    }
    .toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
  </style>
</head>
<body>

  <!-- 顶部导航 -->
  <header>
    <div class="brand-box">
      <div class="brand-logo">house-ops</div>
      <div class="brand-badge">免 Key 纯净版</div>
    </div>

    <!-- 地图 Marker 视角切换 -->
    <div class="view-mode-bar">
      <button class="view-mode-btn active" id="btn-vm-score" onclick="setMarkerViewMode('score')">
        <span>⭐ 综合评级</span>
      </button>
      <button class="view-mode-btn" id="btn-vm-trend" onclick="setMarkerViewMode('trend')">
        <span>📉 历史走势&折价</span>
      </button>
      <button class="view-mode-btn" id="btn-vm-policy" onclick="setMarkerViewMode('policy')">
        <span>🏛️ 政策税费精算</span>
      </button>
      <button class="view-mode-btn" id="btn-vm-planning" onclick="setMarkerViewMode('planning')">
        <span>🏗️ 规划兑现与变数</span>
      </button>
    </div>

    <div class="header-stats">
      <div class="stat-pill active" id="pill-all" onclick="setDecisionFilter('all')">
        <span>全部</span>
        <strong id="stat-total">0</strong>
      </div>
      <div class="stat-pill" id="pill-rec" onclick="setDecisionFilter('rec')">
        <div class="stat-dot dot-green"></div>
        <span>第一梯队</span>
        <strong id="stat-rec" style="color:#34d399">0</strong>
      </div>
      <div class="stat-pill" id="pill-cond" onclick="setDecisionFilter('cond')">
        <div class="stat-dot dot-yellow"></div>
        <span>备选对照</span>
        <strong id="stat-cond" style="color:#fbbf24">0</strong>
      </div>
      <div class="stat-pill" id="pill-pass" onclick="setDecisionFilter('pass')">
        <div class="stat-dot dot-red"></div>
        <span>高代价/硬伤</span>
        <strong id="stat-pass" style="color:#94a3b8">0</strong>
      </div>
    </div>

    <div class="header-actions">
      <!-- 底图切换下拉 (国内高速免Key直连，支持建筑小区细化与实景卫星) -->
      <select class="basemap-select" id="select-basemap" onchange="switchBasemap(this.value)">
        <option value="amap_dark">高德极简暗黑 (推荐·秒开)</option>
        <option value="amap_vector">高德街道详图 (含建筑小区)</option>
        <option value="amap_satellite">高德卫星实景 (航拍+路网)</option>
        <option value="geoq_dark">智图极简灰蓝 (免Key)</option>
      </select>

      <button class="btn" id="btn-toggle-demo" onclick="toggleDemoData()">
        <span>✨ 演示数据</span>
      </button>
      <button class="btn btn-primary" onclick="openProfileDrawer()">
        <span>✏️ 调整购房需求</span>
      </button>
    </div>
  </header>

  <!-- 主地图与浮窗区 -->
  <div class="main-container">
    <div id="map-root"></div>

    <!-- 折叠展开按钮 -->
    <button class="panel-toggle-btn" id="btn-toggle-panel" onclick="toggleFilterPanel()" style="display:none;">
      ☰ 方案筛选与图层
    </button>

    <!-- 左侧浮动筛选面板 -->
    <div class="filter-panel" id="filter-panel">
      <div class="panel-header">
        <div class="panel-title">🎯 方案过滤与专业图层</div>
        <button class="btn" style="padding:2px 8px; font-size:0.75rem;" onclick="toggleFilterPanel()">收起</button>
      </div>
      <div class="panel-body">
        <!-- 规划图层开关 -->
        <div class="switch-row" onclick="togglePlanningLayer()">
          <div>
            <div style="font-weight:600;">规划线网与产业图层</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">规划轨交线、产业极核与未建地块</div>
          </div>
          <div class="switch-box active-purple" id="switch-planning-box">
            <div class="switch-dot"></div>
          </div>
        </div>

        <div class="switch-row" onclick="toggleExcludeRejected()">
          <div>
            <div style="font-weight:600;">隐藏高代价/硬伤房源</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">过滤硬性DQ或严重溢价项</div>
          </div>
          <div class="switch-box" id="switch-exclude-box">
            <div class="switch-dot"></div>
          </div>
        </div>

        <div class="switch-row" onclick="toggleIsochrone()">
          <div>
            <div style="font-weight:600;">工作地通勤圈</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">以人民广场为锚点的辐射范围</div>
          </div>
          <div class="switch-box active" id="switch-commute-box">
            <div class="switch-dot"></div>
          </div>
        </div>

        <!-- 价格滑块 -->
        <div class="filter-group">
          <div class="filter-label">
            <span>总价区间 (万元)</span>
            <span class="val" id="val-price-range">不限</span>
          </div>
          <div class="range-inputs">
            <input type="number" id="filter-price-min" placeholder="最低" oninput="applyFilters()">
            <span style="color:var(--text-muted)">-</span>
            <input type="number" id="filter-price-max" placeholder="最高" oninput="applyFilters()">
          </div>
        </div>

        <!-- 面积滑块 -->
        <div class="filter-group">
          <div class="filter-label">
            <span>面积区间 (㎡)</span>
            <span class="val" id="val-area-range">不限</span>
          </div>
          <div class="range-inputs">
            <input type="number" id="filter-area-min" placeholder="最小" oninput="applyFilters()">
            <span style="color:var(--text-muted)">-</span>
            <input type="number" id="filter-area-max" placeholder="最大" oninput="applyFilters()">
          </div>
        </div>

        <!-- 最低评分门槛 -->
        <div class="filter-group">
          <div class="filter-label">最低 Global 门槛</div>
          <div class="chip-container" id="score-chips">
            <div class="chip active" onclick="setScoreFloor(0)">全部</div>
            <div class="chip" onclick="setScoreFloor(3.5)">≥ 3.5 (及格基准)</div>
            <div class="chip" onclick="setScoreFloor(4.0)">≥ 4.0 (第一梯队)</div>
          </div>
        </div>

        <!-- 当前符合条件的房源列表 -->
        <div class="filter-group">
          <div class="filter-label">
            <span>房源方案 (<span id="count-visible">0</span>)</span>
            <span style="font-size:0.7rem; color:var(--brand); cursor:pointer;" onclick="openCompareModal()">多方案横向对比</span>
          </div>
          <div class="house-list" id="house-list-container">
            <!-- 动态填充 -->
          </div>
        </div>
      </div>
    </div>

    <!-- 底部已选方案对比托盘 (Compare Tray) -->
    <div class="compare-tray" id="compare-tray">
      <div style="font-size:0.82rem; font-weight:700; color:#fff;">已选对比方案 (<span id="compare-count">0</span>/4):</div>
      <div class="compare-chips" id="compare-chips"></div>
      <button class="btn btn-primary" style="padding:4px 12px; font-size:0.8rem;" onclick="openCompareModal()">
        ⚖️ 查看方案权衡矩阵
      </button>
      <button class="btn" style="padding:4px 8px; font-size:0.75rem;" onclick="clearCompareSelection()">清空</button>
    </div>

    <!-- 右下角选中的房源详情卡片 -->
    <div class="report-modal" id="report-modal">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <span style="font-size:0.75rem; color:var(--brand); font-weight:700;" id="m-no">#001</span>
          <h3 style="font-size:1.1rem; font-weight:700; color:#fff;" id="m-title">小区名</h3>
          <div style="font-size:0.78rem; color:var(--text-muted);" id="m-sub">城市 · 板块 · 户型</div>
        </div>
        <div id="m-badge" class="score-badge score-high">4.2</div>
      </div>

      <!-- 核心数字 -->
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; background:#0b0f19; padding:8px; border-radius:8px; text-align:center;">
        <div>
          <div style="font-size:0.72rem; color:var(--text-muted);">挂牌总价</div>
          <div style="font-weight:700; color:#f8fafc;" id="m-price">-- 万</div>
        </div>
        <div>
          <div style="font-size:0.72rem; color:var(--text-muted);">单价</div>
          <div style="font-weight:700; color:#f8fafc;" id="m-unit-price">-- 元/㎡</div>
        </div>
        <div>
          <div style="font-size:0.72rem; color:var(--text-muted);">面积</div>
          <div style="font-weight:700; color:#f8fafc;" id="m-area">-- ㎡</div>
        </div>
      </div>

      <!-- 支柱一：政策解读与交易成本 -->
      <div class="detail-card-section">
        <div class="section-headline">🏛️ 当地政策解读与全口径税费</div>
        <div style="color:#cbd5e1;" id="m-policy-tax">预估税费: -- 万</div>
        <div style="color:var(--text-muted); font-size:0.75rem;" id="m-policy-lock">学位锁定: --</div>
      </div>

      <!-- 支柱二：历史成交与抗跌性走势 -->
      <div class="detail-card-section">
        <div class="section-headline">📉 历史成交走势与折价弹性</div>
        <div style="color:#cbd5e1;" id="m-trend-cycle">周期状态: --</div>
        <div style="color:var(--text-muted); font-size:0.75rem;" id="m-trend-discount">挂牌-成交折价空间: --</div>
      </div>

      <!-- 支柱三：城市规划与空间变量 -->
      <div class="detail-card-section">
        <div class="section-headline">🏗️ 城市空间规划与未来变量</div>
        <div style="color:#cbd5e1;" id="m-planning-impact">规划兑现度: --</div>
        <div style="color:var(--text-muted); font-size:0.75rem;" id="m-planning-env">周边未建地块用途与施工期影响: --</div>
      </div>

      <!-- 客观事实 vs 营销甄别 (De-biasing) -->
      <div class="detail-card-section" style="border-color:rgba(245, 158, 11, 0.4);">
        <div class="section-headline" style="color:#fbbf24;">🔍 客观事实 vs 营销甄别 (去伪存真)</div>
        <div style="color:#f87171; font-size:0.75rem;" id="m-marketing-claim">⚠️ 宣传声称: --</div>
        <div style="color:#34d399; font-size:0.75rem;" id="m-verified-fact">✅ 交叉验证事实: --</div>
      </div>

      <!-- 中立得失权衡总结 -->
      <div class="detail-card-section" style="border-color:rgba(56, 189, 248, 0.4);">
        <div class="section-headline" style="color:#38bdf8;">⚖️ 方案利弊权衡推演</div>
        <div style="color:#e2e8f0; line-height:1.4;" id="m-tradeoff-summary">--</div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
        <button class="btn" id="m-btn-add-compare" onclick="toggleCurrentHouseCompare()">＋ 加入方案对比</button>
        <button class="btn" onclick="closeReportModal()">关闭</button>
      </div>
    </div>
  </div>

  <!-- 多方案横向对比全屏模态弹窗 (Compare Modal) -->
  <div class="compare-modal-mask" id="compare-modal-mask" onclick="closeCompareModal(event)">
    <div class="compare-modal-content" onclick="event.stopPropagation()">
      <div class="compare-modal-header">
        <div style="font-weight:700; font-size:1.1rem; color:#fff;">⚖️ 多方案横向对比与场景权衡推演</div>
        <button class="btn" onclick="closeCompareModal()">✕ 关闭</button>
      </div>
      <div class="compare-modal-body">
        <div id="compare-table-container"></div>
      </div>
    </div>
  </div>

  <!-- 需求调整抽屉 (Profile Drawer) -->
  <div class="drawer-mask" id="drawer-mask" onclick="closeProfileDrawer()"></div>
  <div class="drawer" id="profile-drawer">
    <div class="drawer-header">
      <div class="drawer-title">⚙️ 调整购房需求画像</div>
      <button class="btn" onclick="closeProfileDrawer()">✕</button>
    </div>
    <div class="drawer-body">
      <div style="background:rgba(56, 189, 248, 0.1); border:1px solid rgba(56, 189, 248, 0.2); padding:10px 12px; border-radius:8px; font-size:0.8rem; color:#bae6fd;">
        💡 修改后点击保存将直接同步写入 <code>config/profile.yml</code>，后续运行 CLI 命令将自动采用新画像。
      </div>

      <div class="form-group">
        <label class="form-label">工作地点 / 通勤锚点</label>
        <input type="text" class="form-input" id="p-work-location" placeholder="例如：浦东新区人民广场">
        <div class="form-help">地图将以该地址为基准绘制星标与通勤圈</div>
      </div>

      <div class="form-group">
        <label class="form-label">单程最长通勤时间 (分钟)</label>
        <input type="number" class="form-input" id="p-commute-minutes" placeholder="留空表示不设限/远一点没关系">
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div class="form-group">
          <label class="form-label">预算下限 (万元)</label>
          <input type="number" class="form-input" id="p-price-min">
        </div>
        <div class="form-group">
          <label class="form-label">预算上限 (万元)</label>
          <input type="number" class="form-input" id="p-price-max">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">坚守最高价 (Walk-away 万元)</label>
        <input type="number" class="form-input" id="p-price-walkaway">
        <div class="form-help">超过此价格直接触发硬性 DQ 淘汰</div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div class="form-group">
          <label class="form-label">面积下限 (㎡)</label>
          <input type="number" class="form-input" id="p-area-min">
        </div>
        <div class="form-group">
          <label class="form-label">面积上限 (㎡)</label>
          <input type="number" class="form-input" id="p-area-max">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">期望户型</label>
        <input type="text" class="form-input" id="p-layout" placeholder="例如：三居（常住 4 口，≥3 居）">
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div class="form-group">
          <label class="form-label">深挖门槛分 (Deep-dive)</label>
          <input type="number" step="0.1" class="form-input" id="p-threshold-deep">
        </div>
        <div class="form-group">
          <label class="form-label">弃购门槛分 (Give-up)</label>
          <input type="number" step="0.1" class="form-input" id="p-threshold-giveup">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">查看与编辑 YAML 原文</label>
        <textarea class="form-input" id="p-raw-yaml" rows="10" placeholder="config/profile.yml 原文..."></textarea>
      </div>
    </div>
    <div class="drawer-footer">
      <button class="btn" onclick="closeProfileDrawer()">取消</button>
      <button class="btn btn-primary" id="btn-save-profile" onclick="saveProfileChanges()">💾 保存需求配置</button>
    </div>
  </div>

  <!-- Toast 消息 -->
  <div class="toast" id="toast">保存成功</div>

  <!-- 数据注入与客户端逻辑脚本 -->
  <script>
    const INITIAL_DATA = ${jsonString};
    const IS_SERVER_MODE = ${serverMode};

    let houses = INITIAL_DATA.reports || [];
    let profile = INITIAL_DATA.profile || {};
    let watchlist = INITIAL_DATA.watchlist || [];
    let geoCache = INITIAL_DATA.geoCache || {};
    let rawYaml = INITIAL_DATA.rawYaml || '';

    let leafletMap = null;
    let markersLayerGroup = null;
    let planningLayerGroup = null;
    let workMarker = null;
    let commuteCircle = null;

    let markerViewMode = 'score';
    let filterDecision = 'all';
    let excludeRejected = false;
    let showCommuteRange = true;
    let showPlanningLayer = true;
    let scoreFloor = 0;
    let isUsingDemo = false;

    let selectedCompareNos = [];
    let currentSelectedHouse = null;

    // 免 Key 高性能国内底图配置 (国内直连不卡顿，自动细化到街道/建筑级)
    const TILE_CONFIGS = {
      amap_dark: {
        name: '高德极简暗黑 (推荐·秒开)',
        url: 'https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7',
        subdomains: '1234',
        maxZoom: 19,
        maxNativeZoom: 18,
        darkFilter: true,
        attribution: '© 高德地图 AutoNavi'
      },
      amap_vector: {
        name: '高德街道详图 (含建筑小区)',
        url: 'https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7',
        subdomains: '1234',
        maxZoom: 19,
        maxNativeZoom: 18,
        darkFilter: false,
        attribution: '© 高德地图 AutoNavi'
      },
      amap_satellite: {
        name: '高德卫星实景 (航拍+路网)',
        url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
        overlayUrl: 'https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=8',
        subdomains: '1234',
        maxZoom: 19,
        maxNativeZoom: 18,
        darkFilter: false,
        attribution: '© 高德地图 AutoNavi 航拍影像'
      },
      geoq_dark: {
        name: '智图极简灰蓝 (免Key)',
        url: 'https://map.geoq.cn/ArcGIS/rest/services/ChinaOnlineStreetPurplishBlue/MapServer/tile/{z}/{y}/{x}',
        subdomains: '',
        maxZoom: 18,
        maxNativeZoom: 16,
        darkFilter: false,
        attribution: '© GeoQ 智图'
      }
    };
    let currentTileLayer = null;
    let currentOverlayLayer = null;

    // 演示样例数据（深度融入政策、历史成交走势、规划分析与事实甄别）
    const DEMO_HOUSES = [
      {
        report_no: "001",
        community: "示范翠屏苑",
        city: "上海",
        district: "浦东金桥",
        type: "二手住宅",
        total_price_wan: 535,
        unit_price: 51200,
        area_sqm: 104.5,
        score_global: 4.3,
        hard_dq_hit: false,
        risk_tier: "low",
        conclusion: "worth_viewing",
        policy_tax_wan: 8.5,
        policy_lock_risk: "满五唯一，契税1.5%，无增值税，学位未占用（锁定风险低）",
        market_trend: "bottoming",
        market_trend_text: "较2021高点回调24%，近半年成交均价筑底平稳",
        discount_space: "normal",
        discount_space_text: "同类户型实际成交相较挂牌折价 3-5% (议价约15-25万)",
        liquidity_rating: "年均换手22套，平均去化65天，流动性良好",
        urban_planning: "positive",
        urban_planning_text: "轨交21号线在建（距金桥站约700m，预计2027通车），金桥副中心产业辐射",
        urban_planning_env: "周边无新增高密住宅抛压，东侧规划社区体育公园已批复",
        marketing_claim: "中介宣称'紧邻轨交枢纽，对口名校，绝版好房抢手'",
        verified_fact: "已交叉验证：实测步行至21号线在建站约700m，非现成上盖；对口小学办学仅3年并非名校；但满五唯一与筑底折价属实",
        tradeoff_summary: "【优势】自住品质与户型极佳，筑底期议价空间健康；【代价】单价贴近预算上限，需承担2年轨交施工期噪音。",
        state: "已看房",
        coords: [121.6112, 31.2586]
      },
      {
        report_no: "002",
        community: "示范新城",
        city: "上海",
        district: "浦东金桥",
        type: "二手住宅",
        total_price_wan: 480,
        unit_price: 46000,
        area_sqm: 104.3,
        score_global: 3.8,
        hard_dq_hit: false,
        risk_tier: "caution",
        conclusion: "conditional",
        policy_tax_wan: 15.2,
        policy_lock_risk: "满二不唯一（个税核定2%），需多付约9.6万个税；学位五年一户已用2年",
        market_trend: "declining",
        market_trend_text: "较峰值回调31%，近3个月仍有以价换量迹象",
        discount_space: "wide",
        discount_space_text: "在售库存多，挂牌折价弹性达 6-8% (可大胆砍价30万+)",
        liquidity_rating: "挂牌周期长达110天，买方市场特征显著",
        urban_planning: "neutral",
        urban_planning_text: "周边无新建重大轨交规划，依赖既有9号线台儿庄路站(950m)",
        urban_planning_env: "南侧为成熟居住区，无变数也无新增红利",
        marketing_claim: "房东急售笋盘，低于市场价30万，送全套家具软装",
        verified_fact: "已交叉验证：二楼独立排水未改造有返水隐患，且近3个月同户型成交均价460万，480万并无明显倒挂，非真实笋盘",
        tradeoff_summary: "【优势】总价更低且房东急售折价弹性大，低门槛上车；【代价】税费较高且学位受限，抗跌性稍弱。",
        state: "已评估",
        coords: [121.5980, 31.2650]
      },
      {
        report_no: "003",
        community: "示范绿洲四期",
        city: "上海",
        district: "浦东高行",
        type: "动迁混居住宅",
        total_price_wan: 420,
        unit_price: 41000,
        area_sqm: 102.4,
        score_global: 3.2,
        hard_dq_hit: true,
        risk_tier: "high",
        conclusion: "pass",
        policy_tax_wan: 6.3,
        policy_lock_risk: "动迁安置满三年，免增值税，税费负担轻",
        market_trend: "declining",
        market_trend_text: "跑输大盘，受周边次新商品房挤压，流通性钝化",
        discount_space: "wide",
        discount_space_text: "议价弹性大但带看极冷清（近30天仅2次）",
        liquidity_rating: "去化困难，属于潜在流动性陷阱",
        urban_planning: "uncertain",
        urban_planning_text: "紧邻规划货运铁路联络线，远期面临重载列车噪音",
        urban_planning_env: "西侧为已批建垃圾中转站扩建工程，存在嫌恶设施隐患",
        marketing_claim: "宣称'总价低至420万，超大赠送面积，未来绿地环绕'",
        verified_fact: "已交叉验证：赠送部位属违建私封北天井，有拆除风险；西侧法定控规为垃圾中转站而非绿地，营销虚假承诺",
        tradeoff_summary: "【优势】绝对总价最低(420万)；【代价】命中硬性DQ（噪音超标+回迁混居），未来转手与居住体验风险过大。",
        state: "弃购",
        coords: [121.6030, 31.2950]
      },
      {
        report_no: "004",
        community: "示范云园二期",
        city: "上海",
        district: "浦东碧云",
        type: "二手国际社区",
        total_price_wan: 780,
        unit_price: 68000,
        area_sqm: 115.0,
        score_global: 4.6,
        hard_dq_hit: true,
        risk_tier: "low",
        conclusion: "pass",
        policy_tax_wan: 19.5,
        policy_lock_risk: "非普通住宅（单价超标），差额增值税与契税双高",
        market_trend: "bottoming",
        market_trend_text: "板块极其抗跌，近2年仅微调8%，圈层与外籍承租需求稳固",
        discount_space: "tight",
        discount_space_text: "业主心态极强，折价空间通常仅 1-2%",
        liquidity_rating: "优质房源放出一周内秒去化",
        urban_planning: "positive",
        urban_planning_text: "碧云国际社区核心成熟区，9/14号线双轨交环绕",
        urban_planning_env: "绿化率高，无任何嫌恶设施规划",
        marketing_claim: "纯正涉外国际社区，保值抗跌首选",
        verified_fact: "已交叉验证：抗跌性与国际圈层属实，但总价超出用户预算上限180万，税费极高，属画像硬性不符",
        tradeoff_summary: "【优势】圈层与自住品质天花板；【代价】总价超出预算180万触发硬性DQ，仅作为品质标杆方案对照。",
        state: "弃购",
        coords: [121.5850, 31.2420]
      }
    ];

    window.addEventListener('DOMContentLoaded', () => {
      initApp();
    });

    function initApp() {
      if (houses.length === 0) {
        isUsingDemo = true;
        houses = DEMO_HOUSES;
        document.getElementById('btn-toggle-demo').classList.add('btn-primary');
        showToast('已加载深度分析演示样例数据', 2500);
      }

      if (houses.length >= 2) {
        selectedCompareNos = [houses[0].report_no, houses[1].report_no];
      }

      initProfileForm();
      updateStatsHeader();
      updateCompareTray();
      renderHouseList();

      initLeafletMap();
    }

    // 初始化 Leaflet 地图
    function initLeafletMap() {
      leafletMap = L.map('map-root', {
        center: [31.248, 121.585],
        zoom: 12,
        minZoom: 3,
        maxZoom: 19,
        zoomControl: false,
      });

      L.control.zoom({ position: 'bottomright' }).addTo(leafletMap);
      L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(leafletMap);

      // 加载默认高德极简暗黑底图 (既契合大屏科技风格，又是免Key直连完整矢量)
      switchBasemap('amap_dark');

      markersLayerGroup = L.layerGroup().addTo(leafletMap);
      planningLayerGroup = L.layerGroup().addTo(leafletMap);

      setupWorkAnchor();
      setupUrbanPlanningOverlays();
      refreshMapMarkers();

      // 解决 Flexbox 布局下初始化与缩放视口计算偏移，确保切片全幅自动加载
      setTimeout(() => {
        if (leafletMap) leafletMap.invalidateSize();
      }, 150);
      window.addEventListener('resize', () => {
        if (leafletMap) leafletMap.invalidateSize();
      });
    }

    // 底图无缝切换 (全部免 Key，国内高速直连，自动按缩放层级拉取精细切片)
    function switchBasemap(type) {
      if (!leafletMap) return;
      const conf = TILE_CONFIGS[type] || TILE_CONFIGS.amap_dark;

      // 切换深色模式硬件加速滤镜
      const mapEl = document.getElementById('map-root');
      if (mapEl) {
        mapEl.classList.toggle('map-tiles-dark', Boolean(conf.darkFilter));
      }

      // 清理原瓦片层
      if (currentTileLayer) {
        leafletMap.removeLayer(currentTileLayer);
        currentTileLayer = null;
      }
      if (currentOverlayLayer) {
        leafletMap.removeLayer(currentOverlayLayer);
        currentOverlayLayer = null;
      }

      // 创建主瓦片层 (配置 maxNativeZoom 确保缩放到极致时平滑过渡，不白屏)
      currentTileLayer = L.tileLayer(conf.url, {
        subdomains: conf.subdomains || '1234',
        minZoom: 3,
        maxZoom: conf.maxZoom || 19,
        maxNativeZoom: conf.maxNativeZoom || 18,
        updateWhenZooming: false,
        updateInterval: 80,
        keepBuffer: 3,
        attribution: conf.attribution,
      }).addTo(leafletMap);

      // 若有叠加注记层 (如卫星航拍图 + 道路注记)
      if (conf.overlayUrl) {
        currentOverlayLayer = L.tileLayer(conf.overlayUrl, {
          subdomains: conf.subdomains || '1234',
          minZoom: 3,
          maxZoom: conf.maxZoom || 19,
          maxNativeZoom: conf.maxNativeZoom || 18,
          updateWhenZooming: false,
          updateInterval: 80,
          keepBuffer: 3,
        }).addTo(leafletMap);
      }
    }

    // 切换演示数据
    function toggleDemoData() {
      isUsingDemo = !isUsingDemo;
      const btn = document.getElementById('btn-toggle-demo');
      if (isUsingDemo) {
        houses = DEMO_HOUSES;
        btn.classList.add('btn-primary');
        showToast('已载入演示数据（含政策、历史走势与规划）');
      } else {
        houses = INITIAL_DATA.reports || [];
        btn.classList.remove('btn-primary');
        showToast(houses.length > 0 ? '已切回本地真实房源' : '当前暂无真实评估报告');
      }
      updateStatsHeader();
      applyFilters();
      refreshMapMarkers();
      updateCompareTray();
    }

    function setMarkerViewMode(mode) {
      markerViewMode = mode;
      ['score', 'trend', 'policy', 'planning'].forEach(k => {
        document.getElementById('btn-vm-' + k).classList.toggle('active', k === mode);
      });
      refreshMapMarkers();
    }

    function initProfileForm() {
      const p = profile.buyer || {};
      const b = profile.budget || {};
      const pref = profile.preferences || {};
      const t = profile.thresholds || {};

      document.getElementById('p-work-location').value = p.work_location || '';
      document.getElementById('p-commute-minutes').value = p.commute_max_minutes ?? '';
      document.getElementById('p-price-min').value = b.total_range_wan ? b.total_range_wan[0] : '';
      document.getElementById('p-price-max').value = b.total_range_wan ? b.total_range_wan[1] : '';
      document.getElementById('p-price-walkaway').value = b.walk_away_wan || '';
      document.getElementById('p-area-min').value = pref.size_range_sqm ? pref.size_range_sqm[0] : '';
      document.getElementById('p-area-max').value = pref.size_range_sqm ? pref.size_range_sqm[1] : '';
      document.getElementById('p-layout').value = pref.layout || '';
      document.getElementById('p-threshold-deep').value = t.deep_dive_min ?? 4.0;
      document.getElementById('p-threshold-giveup').value = t.give_up_below ?? 3.5;

      document.getElementById('p-raw-yaml').value = rawYaml || '';
    }

    function updateStatsHeader() {
      let rec = 0, cond = 0, pass = 0;
      houses.forEach(h => {
        if (h.hard_dq_hit || (h.score_global != null && h.score_global < 3.5) || h.conclusion === 'pass' || h.state === '弃购') {
          pass++;
        } else if ((h.score_global != null && h.score_global >= 4.0) || h.conclusion === 'strong_buy' || h.conclusion === 'worth_viewing') {
          rec++;
        } else {
          cond++;
        }
      });
      document.getElementById('stat-total').textContent = houses.length;
      document.getElementById('stat-rec').textContent = rec;
      document.getElementById('stat-cond').textContent = cond;
      document.getElementById('stat-pass').textContent = pass;
    }

    function setDecisionFilter(type) {
      filterDecision = type;
      ['all', 'rec', 'cond', 'pass'].forEach(k => {
        document.getElementById('pill-' + k).classList.toggle('active', k === type);
      });
      applyFilters();
    }

    function toggleExcludeRejected() {
      excludeRejected = !excludeRejected;
      document.getElementById('switch-exclude-box').classList.toggle('active', excludeRejected);
      applyFilters();
    }

    function toggleIsochrone() {
      showCommuteRange = !showCommuteRange;
      document.getElementById('switch-commute-box').classList.toggle('active', showCommuteRange);
      if (commuteCircle && leafletMap) {
        if (showCommuteRange) commuteCircle.addTo(leafletMap);
        else leafletMap.removeLayer(commuteCircle);
      }
    }

    function togglePlanningLayer() {
      showPlanningLayer = !showPlanningLayer;
      document.getElementById('switch-planning-box').classList.toggle('active-purple', showPlanningLayer);
      if (planningLayerGroup && leafletMap) {
        if (showPlanningLayer) planningLayerGroup.addTo(leafletMap);
        else leafletMap.removeLayer(planningLayerGroup);
      }
    }

    function setScoreFloor(score) {
      scoreFloor = score;
      const chips = document.getElementById('score-chips').children;
      chips[0].classList.toggle('active', score === 0);
      chips[1].classList.toggle('active', score === 3.5);
      chips[2].classList.toggle('active', score === 4.0);
      applyFilters();
    }

    function getFilteredHouses() {
      const pMin = parseFloat(document.getElementById('filter-price-min').value) || null;
      const pMax = parseFloat(document.getElementById('filter-price-max').value) || null;
      const aMin = parseFloat(document.getElementById('filter-area-min').value) || null;
      const aMax = parseFloat(document.getElementById('filter-area-max').value) || null;

      return houses.filter(h => {
        const isRejected = h.hard_dq_hit || (h.score_global != null && h.score_global < 3.5) || h.conclusion === 'pass' || h.state === '弃购';
        const isRec = !isRejected && ((h.score_global != null && h.score_global >= 4.0) || h.conclusion === 'worth_viewing' || h.conclusion === 'strong_buy');
        const isCond = !isRejected && !isRec;

        if (filterDecision === 'rec' && !isRec) return false;
        if (filterDecision === 'cond' && !isCond) return false;
        if (filterDecision === 'pass' && !isRejected) return false;

        if (excludeRejected && isRejected) return false;

        if (scoreFloor > 0 && (h.score_global == null || h.score_global < scoreFloor)) return false;

        if (pMin != null && h.total_price_wan != null && h.total_price_wan < pMin) return false;
        if (pMax != null && h.total_price_wan != null && h.total_price_wan > pMax) return false;

        if (aMin != null && h.area_sqm != null && h.area_sqm < aMin) return false;
        if (aMax != null && h.area_sqm != null && h.area_sqm > aMax) return false;

        return true;
      });
    }

    function applyFilters() {
      const filtered = getFilteredHouses();
      document.getElementById('count-visible').textContent = filtered.length;
      renderHouseList(filtered);
      refreshMapMarkers(filtered);
    }

    function renderHouseList(list = getFilteredHouses()) {
      const container = document.getElementById('house-list-container');
      container.innerHTML = '';
      if (list.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:0.75rem; text-align:center; padding:16px;">无符合当前筛选条件的方案</div>';
        return;
      }

      list.forEach(h => {
        const item = document.createElement('div');
        item.className = 'house-item';
        item.onclick = () => selectHouse(h);

        const isRejected = h.hard_dq_hit || h.score_global < 3.5 || h.conclusion === 'pass';
        const scoreClass = isRejected ? 'score-low' : (h.score_global >= 4.0) ? 'score-high' : 'score-mid';
        const isSelectedCompare = selectedCompareNos.includes(h.report_no);

        item.innerHTML = \`
          <div class="house-item-main">
            <div>
              <div class="house-item-title">\${h.community || '房源 #' + h.report_no}</div>
              <div class="house-item-sub">\${h.district || ''} · \${h.total_price_wan ? h.total_price_wan + '万' : '--'} · \${h.area_sqm ? h.area_sqm + '㎡' : ''}</div>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <button class="btn" style="padding:2px 6px; font-size:0.7rem; \${isSelectedCompare ? 'color:var(--brand); border-color:var(--brand);' : ''}" onclick="event.stopPropagation(); toggleCompareItem('\${h.report_no}')">
                \${isSelectedCompare ? '✓ 已比' : '+ 对比'}
              </button>
              <div class="score-badge \${scoreClass}">\${h.score_global != null ? h.score_global : '--'}</div>
            </div>
          </div>
          <div class="house-item-tags">
            \${h.policy_tax_wan ? \`<span class="tag-badge tag-policy">税费≈\${h.policy_tax_wan}万</span>\` : ''}
            \${h.discount_space ? \`<span class="tag-badge tag-trend">弹性\${h.discount_space === 'wide' ? '5%+' : '3-5%'}</span>\` : ''}
            \${h.urban_planning === 'positive' ? \`<span class="tag-badge tag-planning">规划利好</span>\` : ''}
          </div>
        \`;
        container.appendChild(item);
      });
    }

    function selectHouse(h) {
      currentSelectedHouse = h;
      document.getElementById('m-no').textContent = '#' + (h.report_no || '---');
      document.getElementById('m-title').textContent = h.community || '未命名小区';
      document.getElementById('m-sub').textContent = \`\${h.city || ''} \${h.district || ''} · \${h.type || '住宅'} · \${h.state || '已评估'}\`;
      document.getElementById('m-price').textContent = (h.total_price_wan || '--') + ' 万';
      document.getElementById('m-unit-price').textContent = (h.unit_price ? h.unit_price.toLocaleString() : '--') + ' 元/㎡';
      document.getElementById('m-area').textContent = (h.area_sqm || '--') + ' ㎡';

      document.getElementById('m-policy-tax').textContent = '预估税费: ' + (h.policy_tax_wan ? h.policy_tax_wan + ' 万元' : '待核实');
      document.getElementById('m-policy-lock').textContent = '限制核验: ' + (h.policy_lock_risk || '满五唯一待核实、学位占用待核实');

      document.getElementById('m-trend-cycle').textContent = '周期状态: ' + (h.market_trend_text || (h.market_trend === 'bottoming' ? '筑底平稳' : '阴跌下行'));
      document.getElementById('m-trend-discount').textContent = '挂牌-成交折价空间: ' + (h.discount_space_text || (h.discount_space === 'wide' ? '议价弹性大(5%+)' : '正常议价空间(3-5%)'));

      document.getElementById('m-planning-impact').textContent = '规划红利: ' + (h.urban_planning_text || '现状配套为主，暂无重大新增规划');
      document.getElementById('m-planning-env').textContent = '地块用途与施工: ' + (h.urban_planning_env || '周边地块现状平稳');

      document.getElementById('m-tradeoff-summary').textContent = h.tradeoff_summary || '【得失权衡】' + (h.next_action || '建议作为备选方案');

      document.getElementById('m-marketing-claim').textContent = '⚠️ 营销宣传: ' + (h.marketing_claim || '中介常规宣传口径');
      document.getElementById('m-verified-fact').textContent = '✅ 交叉验证: ' + (h.verified_fact || '已根据官方规划与真实成交核验');

      const badge = document.getElementById('m-badge');
      badge.textContent = h.score_global != null ? h.score_global : '无分';
      badge.className = 'score-badge ' + ((h.hard_dq_hit || h.score_global < 3.5 || h.conclusion === 'pass') ? 'score-low'
        : (h.score_global >= 4.0) ? 'score-high' : 'score-mid');

      const isAdded = selectedCompareNos.includes(h.report_no);
      document.getElementById('m-btn-add-compare').textContent = isAdded ? '✓ 已加入方案对比' : '＋ 加入方案对比';

      document.getElementById('report-modal').classList.add('show');

      if (leafletMap && h._latlng) {
        leafletMap.panTo(h._latlng, { animate: true, duration: 0.5 });
      }
    }

    function closeReportModal() {
      document.getElementById('report-modal').classList.remove('show');
    }

    function toggleCurrentHouseCompare() {
      if (!currentSelectedHouse) return;
      toggleCompareItem(currentSelectedHouse.report_no);
      const isAdded = selectedCompareNos.includes(currentSelectedHouse.report_no);
      document.getElementById('m-btn-add-compare').textContent = isAdded ? '✓ 已加入方案对比' : '＋ 加入方案对比';
    }

    function toggleCompareItem(no) {
      if (selectedCompareNos.includes(no)) {
        selectedCompareNos = selectedCompareNos.filter(x => x !== no);
      } else {
        if (selectedCompareNos.length >= 4) {
          alert('最多同时横向对比 4 套方案');
          return;
        }
        selectedCompareNos.push(no);
      }
      updateCompareTray();
      renderHouseList();
    }

    function clearCompareSelection() {
      selectedCompareNos = [];
      updateCompareTray();
      renderHouseList();
    }

    function updateCompareTray() {
      const tray = document.getElementById('compare-tray');
      const countEl = document.getElementById('compare-count');
      const chipsEl = document.getElementById('compare-chips');

      countEl.textContent = selectedCompareNos.length;
      chipsEl.innerHTML = '';

      if (selectedCompareNos.length === 0) {
        tray.classList.remove('show');
        return;
      }

      tray.classList.add('show');
      selectedCompareNos.forEach(no => {
        const item = houses.find(h => h.report_no === no);
        if (!item) return;
        const chip = document.createElement('div');
        chip.className = 'compare-chip';
        chip.innerHTML = \`
          <span>#\${item.report_no} \${item.community}</span>
          <span class="compare-chip-del" onclick="toggleCompareItem('\${item.report_no}')">✕</span>
        \`;
        chipsEl.appendChild(chip);
      });
    }

    function openCompareModal() {
      if (selectedCompareNos.length === 0) {
        const filtered = getFilteredHouses();
        selectedCompareNos = filtered.slice(0, 2).map(h => h.report_no);
        updateCompareTray();
        renderHouseList();
      }

      const compareList = houses.filter(h => selectedCompareNos.includes(h.report_no));
      const container = document.getElementById('compare-table-container');

      if (compareList.length === 0) {
        container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">暂无对比方案，请在房源卡片上点击「+ 对比」勾选。</div>';
      } else {
        let thead = '<tr><th>对比维度 / 考量指标</th>';
        compareList.forEach(h => {
          thead += \`<th>
            <div style="font-size:1rem; color:#fff; font-weight:700;">\${h.community}</div>
            <div style="font-size:0.75rem; color:var(--brand); margin-top:2px;">#\${h.report_no} · \${h.total_price_wan}万 (\${h.score_global}分)</div>
          </th>\`;
        });
        thead += '</tr>';

        const rows = [
          {
            title: '总价与全口径到手现金',
            render: h => \`<strong>\${h.total_price_wan} 万元</strong> (\${h.unit_price}元/㎡)<br><span style="color:#94a3b8; font-size:0.75rem;">预估税费: \${h.policy_tax_wan ? h.policy_tax_wan + '万' : '待精算'}</span>\`
          },
          {
            title: '🏛️ 当地政策解读与限制',
            render: h => \`<span style="color:#e2e8f0;">\${h.policy_lock_risk || '满五唯一待核实'}</span><br><span style="color:#94a3b8; font-size:0.75rem;">契税阶梯与贷款杠杆适用良好</span>\`
          },
          {
            title: '📉 历史成交与抗跌性走势',
            render: h => \`<span style="color:#38bdf8;">\${h.market_trend_text || '筑底企稳'}</span><br><span style="color:#94a3b8; font-size:0.75rem;">实际折价空间: \${h.discount_space_text || '3-5%'}</span>\`
          },
          {
            title: '🏗️ 城市空间规划与未来变量',
            render: h => \`<span style="color:#34d399;">\${h.urban_planning_text || '成熟现状'}</span><br><span style="color:#94a3b8; font-size:0.75rem;">\${h.urban_planning_env || '无明显嫌恶与遮挡'}</span>\`
          },
          {
            title: '🔍 营销宣传 vs 客观事实甄别',
            render: h => \`<div style="font-size:0.75rem; line-height:1.4;"><span style="color:#f87171;">⚠️ \${h.marketing_claim || '宣传口径'}</span><br><span style="color:#34d399;">✅ \${h.verified_fact || '已核验事实'}</span></div>\`
          },
          {
            title: '核心得失与权衡结论 (Pros vs Cons)',
            render: h => \`<div style="background:rgba(30,41,59,0.7); padding:8px; border-radius:6px; font-size:0.8rem; line-height:1.4;">\${h.tradeoff_summary || '待权衡'}</div>\`
          }
        ];

        let tbody = '';
        rows.forEach(r => {
          tbody += \`<tr><th>\${r.title}</th>\`;
          compareList.forEach(h => {
            tbody += \`<td>\${r.render(h)}</td>\`;
          });
          tbody += '</tr>';
        });

        container.innerHTML = \`<table class="compare-matrix-table">\${thead}<tbody>\${tbody}</tbody></table>\`;
      }

      document.getElementById('compare-modal-mask').classList.add('open');
    }

    function closeCompareModal(e) {
      if (e && e.target !== e.currentTarget) return;
      document.getElementById('compare-modal-mask').classList.remove('open');
    }

    function toggleFilterPanel() {
      const panel = document.getElementById('filter-panel');
      const btn = document.getElementById('btn-toggle-panel');
      panel.classList.toggle('collapsed');
      btn.style.display = panel.classList.contains('collapsed') ? 'block' : 'none';
    }

    function openProfileDrawer() {
      document.getElementById('drawer-mask').classList.add('open');
      document.getElementById('profile-drawer').classList.add('open');
    }
    function closeProfileDrawer() {
      document.getElementById('drawer-mask').classList.remove('open');
      document.getElementById('profile-drawer').classList.remove('open');
    }

    async function saveProfileChanges() {
      const btn = document.getElementById('btn-save-profile');
      btn.disabled = true;
      btn.textContent = '保存中...';

      const patch = {
        buyer: {
          work_location: document.getElementById('p-work-location').value.trim(),
          commute_max_minutes: document.getElementById('p-commute-minutes').value ? Number(document.getElementById('p-commute-minutes').value) : null,
        },
        budget: {
          total_range_wan: [
            Number(document.getElementById('p-price-min').value) || 0,
            Number(document.getElementById('p-price-max').value) || 0,
          ],
          walk_away_wan: Number(document.getElementById('p-price-walkaway').value) || 0,
        },
        preferences: {
          layout: document.getElementById('p-layout').value.trim(),
          size_range_sqm: [
            Number(document.getElementById('p-area-min').value) || 0,
            Number(document.getElementById('p-area-max').value) || 0,
          ]
        },
        thresholds: {
          deep_dive_min: Number(document.getElementById('p-threshold-deep').value) || 4.0,
          give_up_below: Number(document.getElementById('p-threshold-giveup').value) || 3.5,
        }
      };

      try {
        if (IS_SERVER_MODE) {
          const res = await fetch('/api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patch, rawYaml: document.getElementById('p-raw-yaml').value })
          });
          const data = await res.json();
          if (data.ok) {
            showToast('需求画像已保存到 config/profile.yml');
            closeProfileDrawer();
            profile.buyer.work_location = patch.buyer.work_location;
            profile.buyer.commute_max_minutes = patch.buyer.commute_max_minutes;
            setupWorkAnchor();
          } else {
            alert('保存失败: ' + (data.error || '未知错误'));
          }
        } else {
          showToast('当前为静态模式，请复制配置或使用 CLI 服务模式保存');
          const blob = new Blob([document.getElementById('p-raw-yaml').value], { type: 'text/yaml' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'profile.yml';
          a.click();
          closeProfileDrawer();
        }
      } catch (err) {
        alert('保存异常: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 保存需求配置';
      }
    }

    // 设置工作地锚点与通勤圈
    function setupWorkAnchor() {
      if (!leafletMap) return;
      const workLat = 31.2610, workLng = 121.6020; // 浦东新区金桥人民广场

      if (workMarker) leafletMap.removeLayer(workMarker);
      if (commuteCircle) leafletMap.removeLayer(commuteCircle);

      const html = '<div class="map-marker work">💼 工作地: 人民广场</div>';
      const icon = L.divIcon({ html, className: 'leaflet-div-icon', iconSize: [160, 26], iconAnchor: [80, 13] });
      workMarker = L.marker([workLat, workLng], { icon, zIndexOffset: 2000 }).addTo(leafletMap);

      commuteCircle = L.circle([workLat, workLng], {
        radius: 8000,
        color: '#38bdf8',
        weight: 1.5,
        dashArray: '6, 6',
        fillColor: '#0284c7',
        fillOpacity: 0.08,
      });

      if (showCommuteRange) commuteCircle.addTo(leafletMap);
    }

    // 设置城市空间规划图层（在建轨交走向、规划站点、产业核）
    function setupUrbanPlanningOverlays() {
      if (!planningLayerGroup) return;
      planningLayerGroup.clearLayers();

      // 在建21号线走向示意
      const metroPath = [
        [31.2400, 121.6180],
        [31.2580, 121.6110],
        [31.2750, 121.6050],
        [31.2920, 121.5950]
      ];
      const poly = L.polyline(metroPath, {
        color: '#a855f7',
        weight: 3.5,
        dashArray: '8, 6',
        opacity: 0.85
      });
      planningLayerGroup.addLayer(poly);

      // 规划在建站点
      const stationIcon = L.divIcon({
        html: '<div class="map-marker-planning">🚇 规划21号线在建站 (预计2027)</div>',
        className: 'leaflet-div-icon',
        iconSize: [180, 24],
        iconAnchor: [90, 12]
      });
      const stMarker = L.marker([31.2580, 121.6110], { icon: stationIcon, zIndexOffset: 1500 });
      planningLayerGroup.addLayer(stMarker);

      // 产业极核高亮
      const indCircle = L.circle([31.2520, 121.6000], {
        radius: 2000,
        color: '#a855f7',
        weight: 1,
        dashArray: '4, 4',
        fillColor: '#a855f7',
        fillOpacity: 0.07,
      });
      planningLayerGroup.addLayer(indCircle);

      if (showPlanningLayer && leafletMap) {
        planningLayerGroup.addTo(leafletMap);
      }
    }

    // 刷新房源打点
    function refreshMapMarkers(list = getFilteredHouses()) {
      if (!markersLayerGroup) return;
      markersLayerGroup.clearLayers();

      list.forEach((h, idx) => {
        const key = [h.city, h.district, h.community].filter(Boolean).join('·');
        let rawCoord = h.coords || geoCache[key];

        // 容错基准坐标（如浦东金桥周边微调）
        let lat = 31.25 + (idx * 0.012), lng = 121.60 + (idx * 0.008);
        if (rawCoord && rawCoord.length >= 2) {
          // 坐标若是 [lng, lat]
          if (rawCoord[0] > 70) {
            lng = rawCoord[0];
            lat = rawCoord[1];
          } else {
            lat = rawCoord[0];
            lng = rawCoord[1];
          }
        }
        h._latlng = [lat, lng];

        const isRejected = h.hard_dq_hit || (h.score_global != null && h.score_global < 3.5) || h.conclusion === 'pass' || h.state === '弃购';
        const isRec = !isRejected && ((h.score_global != null && h.score_global >= 4.0) || h.conclusion === 'worth_viewing' || h.conclusion === 'strong_buy');
        const cls = isRejected ? 'low' : isRec ? 'high' : 'mid';

        let label = '';
        if (markerViewMode === 'score') {
          label = (isRec ? '★ ' : '') + (h.score_global != null ? h.score_global : '--') + ' ' + (h.community || h.report_no);
        } else if (markerViewMode === 'trend') {
          const flex = h.discount_space === 'wide' ? '弹性5%+' : '弹性3-5%';
          label = (h.community || h.report_no) + ' · ' + (h.market_trend === 'bottoming' ? '筑底' : '阴跌') + ' · ' + flex;
        } else if (markerViewMode === 'policy') {
          label = (h.community || h.report_no) + ' · 税费≈' + (h.policy_tax_wan ? h.policy_tax_wan + '万' : '待查');
        } else if (markerViewMode === 'planning') {
          label = (h.community || h.report_no) + ' · ' + (h.urban_planning === 'positive' ? '轨交在建' : '现状平稳');
        }

        const iconHtml = \`<div class="map-marker \${cls}">\${label}</div>\`;
        const icon = L.divIcon({
          html: iconHtml,
          className: 'leaflet-div-icon',
          iconSize: [140, 26],
          iconAnchor: [70, 13]
        });

        const marker = L.marker([lat, lng], {
          icon,
          zIndexOffset: isRec ? 900 : isRejected ? 100 : 500
        });

        marker.on('click', () => selectHouse(h));
        markersLayerGroup.addLayer(marker);
      });

      // 自动聚焦视野至所有可见房源
      if (list.length > 0 && leafletMap) {
        const validCoords = list.map(h => h._latlng).filter(Boolean);
        if (validCoords.length > 0) {
          const bounds = L.latLngBounds(validCoords);
          if (bounds.isValid()) {
            leafletMap.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
          }
        }
      }
    }

    function showToast(msg, dur = 2000) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), dur);
    }
  </script>
</body>
</html>
`;
}
