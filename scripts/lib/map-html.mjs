// lib/map-html.mjs — 生成自包含的交互式地图 HTML 页面
// 规范：零外部 npm 依赖，包含现代 CSS、AMap 2.0 地图逻辑与响应式交互面板。

export function renderMapHtml({ initialData, config = {} }) {
  const jsonString = JSON.stringify(initialData).replace(/</g, '\\u003c');
  const serverMode = Boolean(config.serverMode);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>house-ops 房源决策地图</title>
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-surface: #1e293b;
      --bg-surface-hover: #334155;
      --border-color: #334155;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --brand: #38bdf8;
      --brand-dark: #0284c7;
      --green: #10b981;
      --yellow: #f59e0b;
      --red: #ef4444;
      --gray: #64748b;
      --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
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
      height: 56px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      z-index: 100;
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
      font-size: 0.75rem;
      background: #334155;
      color: #94a3b8;
      padding: 2px 8px;
      border-radius: 999px;
      font-weight: 500;
    }

    .header-stats {
      display: flex;
      gap: 12px;
      align-items: center;
      font-size: 0.85rem;
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
      font-size: 0.85rem;
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
      opacity: 0.92;
      box-shadow: 0 0 12px rgba(37, 99, 235, 0.4);
    }

    /* 主容器 */
    .main-container {
      flex: 1;
      position: relative;
      display: flex;
      overflow: hidden;
    }

    /* 地图容器 */
    #map-root {
      flex: 1;
      height: 100%;
      width: 100%;
      background: #090d16;
    }

    /* 侧边筛选浮窗面板 */
    .filter-panel {
      position: absolute;
      top: 16px;
      left: 16px;
      width: 320px;
      max-height: calc(100% - 32px);
      background: rgba(30, 41, 59, 0.92);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      z-index: 20;
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .filter-panel.collapsed {
      transform: translateX(-340px);
    }
    .panel-toggle-btn {
      position: absolute;
      top: 16px;
      left: 16px;
      z-index: 19;
      background: rgba(30, 41, 59, 0.9);
      border: 1px solid var(--border-color);
      color: #fff;
      border-radius: 8px;
      padding: 8px 12px;
      cursor: pointer;
      backdrop-filter: blur(8px);
      box-shadow: var(--shadow);
    }

    .panel-header {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .panel-title { font-size: 0.95rem; font-weight: 700; color: #f1f5f9; }
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
      font-size: 0.78rem;
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
      background: #0f172a;
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
    }
    .switch-box {
      width: 36px;
      height: 20px;
      background: #475569;
      border-radius: 10px;
      position: relative;
      transition: background 0.2s;
    }
    .switch-box.active { background: var(--brand); }
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
    .switch-box.active .switch-dot {
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
      background: #0f172a;
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

    /* 房源列表卡片（底部/侧边小清单） */
    .house-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 4px;
      max-height: 220px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .house-item {
      background: #0f172a;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 8px 10px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: border-color 0.2s;
    }
    .house-item:hover, .house-item.selected {
      border-color: var(--brand);
      background: #131d31;
    }
    .house-item-title { font-weight: 600; font-size: 0.85rem; color: #f1f5f9; }
    .house-item-sub { font-size: 0.75rem; color: var(--text-muted); }
    .score-badge {
      font-weight: 700;
      font-size: 0.8rem;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .score-high { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .score-mid { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); }
    .score-low { background: rgba(100, 116, 139, 0.2); color: #94a3b8; border: 1px solid rgba(100, 116, 139, 0.4); text-decoration: line-through; }

    /* 右侧需求配置抽屉 (Profile Drawer) */
    .drawer-mask {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      z-index: 150;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s;
    }
    .drawer-mask.open { opacity: 1; pointer-events: auto; }

    .drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: 460px;
      max-width: 90vw;
      height: 100vh;
      background: var(--bg-surface);
      border-left: 1px solid var(--border-color);
      z-index: 160;
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
    .drawer-title { font-size: 1.1rem; font-weight: 700; color: #fff; }
    .drawer-body {
      padding: 20px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 20px;
      font-size: 0.88rem;
    }
    .drawer-footer {
      padding: 16px 20px;
      border-top: 1px solid var(--border-color);
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      background: #172033;
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
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .form-input {
      background: #0f172a;
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

    /* 浮动报告详情弹窗 (Modal / Bottom Sheet) */
    .report-modal {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 380px;
      background: rgba(30, 41, 59, 0.95);
      backdrop-filter: blur(16px);
      border: 1px solid var(--brand);
      border-radius: 14px;
      box-shadow: var(--shadow);
      z-index: 90;
      padding: 16px;
      display: none;
      flex-direction: column;
      gap: 12px;
      animation: slideUp 0.25s ease-out;
    }
    .report-modal.show { display: flex; }
    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    /* 地图自定义 Marker 样式 */
    .map-marker {
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-weight: bold;
      font-size: 12px;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .map-marker:hover {
      transform: scale(1.1) translateY(-2px);
      z-index: 100 !important;
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
      background: #475569;
      color: #cbd5e1;
      border: 1px solid #64748b;
      opacity: 0.7;
    }
    .map-marker.low:hover { opacity: 1; }

    /* 高德地图配置引导弹窗 */
    .key-dialog {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .dialog-card {
      width: 480px;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      gap: 16px;
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
      z-index: 300;
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
      <div class="brand-badge">决策地图</div>
    </div>

    <div class="header-stats">
      <div class="stat-pill active" id="pill-all" onclick="setDecisionFilter('all')">
        <span>全部</span>
        <strong id="stat-total">0</strong>
      </div>
      <div class="stat-pill" id="pill-rec" onclick="setDecisionFilter('rec')">
        <div class="stat-dot dot-green"></div>
        <span>建议看</span>
        <strong id="stat-rec" style="color:#34d399">0</strong>
      </div>
      <div class="stat-pill" id="pill-cond" onclick="setDecisionFilter('cond')">
        <div class="stat-dot dot-yellow"></div>
        <span>待定</span>
        <strong id="stat-cond" style="color:#fbbf24">0</strong>
      </div>
      <div class="stat-pill" id="pill-pass" onclick="setDecisionFilter('pass')">
        <div class="stat-dot dot-red"></div>
        <span>不建议</span>
        <strong id="stat-pass" style="color:#94a3b8">0</strong>
      </div>
    </div>

    <div class="header-actions">
      <button class="btn" id="btn-toggle-demo" onclick="toggleDemoData()">
        <span>✨ 演示数据</span>
      </button>
      <button class="btn" onclick="openKeyConfig()">
        <span>⚙️ 地图 Key</span>
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
      ☰ 筛选房源
    </button>

    <!-- 左侧浮动筛选面板 -->
    <div class="filter-panel" id="filter-panel">
      <div class="panel-header">
        <div class="panel-title">🎯 房源筛选与图层</div>
        <button class="btn" style="padding:2px 8px; font-size:0.75rem;" onclick="toggleFilterPanel()">收起</button>
      </div>
      <div class="panel-body">
        <!-- 快速开关 -->
        <div class="switch-row" onclick="toggleExcludeRejected()">
          <div>
            <div style="font-weight:600;">只看建议房源</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">自动隐藏不建议/淘汰/已弃购</div>
          </div>
          <div class="switch-box" id="switch-exclude-box">
            <div class="switch-dot"></div>
          </div>
        </div>

        <div class="switch-row" onclick="toggleIsochrone()">
          <div>
            <div style="font-weight:600;">工作地通勤范围</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">绘制通勤辐射圈</div>
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
          <div class="filter-label">最低 Global 分数</div>
          <div class="chip-container" id="score-chips">
            <div class="chip active" onclick="setScoreFloor(0)">全部</div>
            <div class="chip" onclick="setScoreFloor(3.5)">≥ 3.5 (及格)</div>
            <div class="chip" onclick="setScoreFloor(4.0)">≥ 4.0 (深挖优选)</div>
          </div>
        </div>

        <!-- 当前符合条件的房源列表 -->
        <div class="filter-group">
          <div class="filter-label">
            <span>列表 (<span id="count-visible">0</span>)</span>
          </div>
          <div class="house-list" id="house-list-container">
            <!-- 动态填充 -->
          </div>
        </div>
      </div>
    </div>

    <!-- 右下角选中的房源详情卡片 -->
    <div class="report-modal" id="report-modal">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <span style="font-size:0.75rem; color:var(--brand); font-weight:700;" id="m-no">#001</span>
          <h3 style="font-size:1.05rem; font-weight:700; color:#fff;" id="m-title">小区名</h3>
          <div style="font-size:0.78rem; color:var(--text-muted);" id="m-sub">城市 · 板块 · 户型</div>
        </div>
        <div id="m-badge" class="score-badge score-high">4.2</div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; background:#0f172a; padding:8px; border-radius:8px; text-align:center;">
        <div>
          <div style="font-size:0.72rem; color:var(--text-muted);">总价</div>
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

      <div style="font-size:0.8rem; line-height:1.4;">
        <div style="color:#cbd5e1;"><strong style="color:var(--brand)">建议:</strong> <span id="m-action">--</span></div>
        <div style="color:var(--text-muted); margin-top:4px;" id="m-unverified-box"></div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:4px;">
        <button class="btn" style="padding:4px 10px; font-size:0.78rem;" onclick="closeReportModal()">关闭</button>
        <button class="btn btn-primary" style="padding:4px 10px; font-size:0.78rem;" id="m-btn-view">查看完整报告</button>
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

  <!-- 高德地图 Key 配置引导弹窗 -->
  <div class="key-dialog" id="key-dialog" style="display:none;">
    <div class="dialog-card">
      <h3 style="color:#fff; font-size:1.1rem;">⚙️ 配置高德地图 JS API Key</h3>
      <p style="font-size:0.85rem; color:var(--text-muted); line-height:1.5;">
        为了在地图上展示小区位置、行政区配套以及绘制通勤圈，请提供高德地图 <strong>Web端 (JS API)</strong> 的 Key 与安全密钥。<br>
        密钥仅保存在本地浏览器或项目中，不外传。
      </p>

      <div class="form-group">
        <label class="form-label">高德 Web API Key</label>
        <input type="text" class="form-input" id="input-amap-key" placeholder="例如：8f3a9b...">
      </div>

      <div class="form-group">
        <label class="form-label">高德安全密钥 (Security JS Code)</label>
        <input type="text" class="form-input" id="input-amap-security" placeholder="例如：6c4d2e...">
      </div>

      <div style="font-size:0.75rem; color:#38bdf8;">
        💡 没有 Key？可至 <a href="https://console.amap.com" target="_blank" style="color:#38bdf8; text-decoration:underline;">高德开放平台</a> 免费创建应用并添加「Web 端 (JS API)」Key（耗时约 2 分钟）。
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px;">
        <button class="btn" onclick="closeKeyDialog()">暂不配置（仅看列表）</button>
        <button class="btn btn-primary" onclick="saveAmapKeys()">保存并加载地图</button>
      </div>
    </div>
  </div>

  <!-- Toast 消息 -->
  <div class="toast" id="toast">保存成功</div>

  <!-- 数据注入与客户端逻辑脚本 -->
  <script>
    // 注入初始数据
    const INITIAL_DATA = ${jsonString};
    const IS_SERVER_MODE = ${serverMode};

    // 状态管理
    let houses = INITIAL_DATA.reports || [];
    let profile = INITIAL_DATA.profile || {};
    let watchlist = INITIAL_DATA.watchlist || [];
    let geoCache = INITIAL_DATA.geoCache || {};
    let rawYaml = INITIAL_DATA.rawYaml || '';

    let aMapInstance = null;
    let markers = [];
    let workMarker = null;
    let commuteCircle = null;

    let filterDecision = 'all'; // all | rec | cond | pass
    let excludeRejected = false;
    let showCommuteRange = true;
    let scoreFloor = 0;
    let isUsingDemo = false;

    // 演示样例数据（当初始无报告时供用户体验）
    const DEMO_HOUSES = [
      {
        report_no: "001",
        community: "示范翠屏苑",
        city: "上海",
        district: "浦东金桥",
        type: "二手",
        total_price_wan: 535,
        unit_price: 51200,
        area_sqm: 104.5,
        score_global: 4.3,
        hard_dq_hit: false,
        risk_tier: "low",
        conclusion: "worth_viewing",
        next_action: "安排周末带看，重点核实对口小学划片与外立面维护",
        unverified_items: ["学区划片当年是否有变动", "地下车位配比"],
        state: "已看房",
        coords: [121.6112, 31.2586]
      },
      {
        report_no: "002",
        community: "示范新城",
        city: "上海",
        district: "浦东金桥",
        type: "二手",
        total_price_wan: 480,
        unit_price: 46000,
        area_sqm: 104.3,
        score_global: 3.8,
        hard_dq_hit: false,
        risk_tier: "caution",
        conclusion: "conditional",
        next_action: "次选待定，若价格能谈到 460 万以内可考虑",
        unverified_items: ["顶楼渗水隐患", "户型暗卫通风"],
        state: "已评估",
        coords: [121.5980, 31.2650]
      },
      {
        report_no: "003",
        community: "示范绿洲四期",
        city: "上海",
        district: "浦东高行",
        type: "二手",
        total_price_wan: 420,
        unit_price: 41000,
        area_sqm: 102.4,
        score_global: 3.2,
        hard_dq_hit: true,
        risk_tier: "high",
        conclusion: "pass",
        next_action: "明确放弃：靠近主干道噪音超标且属于回迁混居，命中硬性 DQ",
        unverified_items: [],
        state: "弃购",
        coords: [121.6030, 31.2950]
      },
      {
        report_no: "004",
        community: "示范云园二期",
        city: "上海",
        district: "浦东碧云",
        type: "二手",
        total_price_wan: 780,
        unit_price: 68000,
        area_sqm: 115.0,
        score_global: 4.6,
        hard_dq_hit: true,
        risk_tier: "low",
        conclusion: "pass",
        next_action: "超出 600 万预算上限，品质极高但总价不匹配，仅作标杆参考",
        unverified_items: [],
        state: "弃购",
        coords: [121.5850, 31.2420]
      }
    ];

    // 初始化运行
    window.addEventListener('DOMContentLoaded', () => {
      initApp();
    });

    function initApp() {
      // 检查是否有数据，若没有则引导或提示
      if (houses.length === 0) {
        // 默认载入演示数据以展示效果
        isUsingDemo = true;
        houses = DEMO_HOUSES;
        document.getElementById('btn-toggle-demo').classList.add('btn-primary');
        showToast('已加载演示样例数据（可在终端生成真实报告）', 3000);
      }

      initProfileForm();
      updateStatsHeader();
      renderHouseList();

      // 启动高德地图
      setupAmap();
    }

    // 切换演示数据
    function toggleDemoData() {
      isUsingDemo = !isUsingDemo;
      const btn = document.getElementById('btn-toggle-demo');
      if (isUsingDemo) {
        houses = DEMO_HOUSES;
        btn.classList.add('btn-primary');
        showToast('已切换为演示数据');
      } else {
        houses = INITIAL_DATA.reports || [];
        btn.classList.remove('btn-primary');
        showToast(houses.length > 0 ? '已切回真实房源' : '当前暂无真实评估报告');
      }
      updateStatsHeader();
      applyFilters();
      refreshMapMarkers();
    }

    // 初始化画像表单
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

      // 预填筛选输入框
      if (b.total_range_wan) {
        document.getElementById('filter-price-min').value = b.total_range_wan[0];
        document.getElementById('filter-price-max').value = b.total_range_wan[1];
      }
      if (pref.size_range_sqm) {
        document.getElementById('filter-area-min').value = pref.size_range_sqm[0];
        document.getElementById('filter-area-max').value = pref.size_range_sqm[1];
      }
    }

    // 统计数字更新
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

    // 切换建议等级筛选
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
      if (commuteCircle) {
        commuteCircle[showCommuteRange ? 'show' : 'hide']();
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

    // 筛选逻辑
    function getFilteredHouses() {
      const pMin = parseFloat(document.getElementById('filter-price-min').value) || null;
      const pMax = parseFloat(document.getElementById('filter-price-max').value) || null;
      const aMin = parseFloat(document.getElementById('filter-area-min').value) || null;
      const aMax = parseFloat(document.getElementById('filter-area-max').value) || null;

      return houses.filter(h => {
        const isRejected = h.hard_dq_hit || (h.score_global != null && h.score_global < 3.5) || h.conclusion === 'pass' || h.state === '弃购';
        const isRec = !isRejected && ((h.score_global != null && h.score_global >= 4.0) || h.conclusion === 'worth_viewing' || h.conclusion === 'strong_buy');
        const isCond = !isRejected && !isRec;

        // 决策分类筛选
        if (filterDecision === 'rec' && !isRec) return false;
        if (filterDecision === 'cond' && !isCond) return false;
        if (filterDecision === 'pass' && !isRejected) return false;

        // 一键隐藏不建议
        if (excludeRejected && isRejected) return false;

        // 分数下限
        if (scoreFloor > 0 && (h.score_global == null || h.score_global < scoreFloor)) return false;

        // 价格区间
        if (pMin != null && h.total_price_wan != null && h.total_price_wan < pMin) return false;
        if (pMax != null && h.total_price_wan != null && h.total_price_wan > pMax) return false;

        // 面积区间
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

    // 渲染侧边房源列表
    function renderHouseList(list = getFilteredHouses()) {
      const container = document.getElementById('house-list-container');
      container.innerHTML = '';
      if (list.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:0.75rem; text-align:center; padding:16px;">无符合当前筛选条件的房源</div>';
        return;
      }

      list.forEach(h => {
        const item = document.createElement('div');
        item.className = 'house-item';
        item.onclick = () => selectHouse(h);

        const scoreClass = (h.hard_dq_hit || h.score_global < 3.5 || h.conclusion === 'pass') ? 'score-low'
          : (h.score_global >= 4.0) ? 'score-high' : 'score-mid';

        item.innerHTML = \`
          <div>
            <div class="house-item-title">\${h.community || '房源 #' + h.report_no}</div>
            <div class="house-item-sub">\${h.district || ''} · \${h.total_price_wan ? h.total_price_wan + '万' : '--'} · \${h.area_sqm ? h.area_sqm + '㎡' : ''}</div>
          </div>
          <div class="score-badge \${scoreClass}">\${h.score_global != null ? h.score_global : '--'}</div>
        \`;
        container.appendChild(item);
      });
    }

    // 选中房源并展示详情浮窗
    function selectHouse(h) {
      document.getElementById('m-no').textContent = '#' + (h.report_no || '---');
      document.getElementById('m-title').textContent = h.community || '未命名小区';
      document.getElementById('m-sub').textContent = \`\${h.city || ''} \${h.district || ''} · \${h.type || '住宅'} · \${h.state || '已评估'}\`;
      document.getElementById('m-price').textContent = (h.total_price_wan || '--') + ' 万';
      document.getElementById('m-unit-price').textContent = (h.unit_price ? h.unit_price.toLocaleString() : '--') + ' 元/㎡';
      document.getElementById('m-area').textContent = (h.area_sqm || '--') + ' ㎡';
      document.getElementById('m-action').textContent = h.next_action || (h.conclusion === 'pass' ? '建议放弃' : '待下一步行动');

      const badge = document.getElementById('m-badge');
      badge.textContent = h.score_global != null ? h.score_global : '无分';
      badge.className = 'score-badge ' + ((h.hard_dq_hit || h.score_global < 3.5 || h.conclusion === 'pass') ? 'score-low'
        : (h.score_global >= 4.0) ? 'score-high' : 'score-mid');

      const unverBox = document.getElementById('m-unverified-box');
      if (Array.isArray(h.unverified_items) && h.unverified_items.length > 0) {
        unverBox.innerHTML = '<strong>待核实:</strong> ' + h.unverified_items.join('、');
      } else {
        unverBox.innerHTML = '';
      }

      document.getElementById('report-modal').classList.add('show');

      // 地图定位居中
      if (aMapInstance && h._lnglat) {
        aMapInstance.panTo(h._lnglat);
      }
    }

    function closeReportModal() {
      document.getElementById('report-modal').classList.remove('show');
    }

    function toggleFilterPanel() {
      const panel = document.getElementById('filter-panel');
      const btn = document.getElementById('btn-toggle-panel');
      panel.classList.toggle('collapsed');
      btn.style.display = panel.classList.contains('collapsed') ? 'block' : 'none';
    }

    // 抽屉控制
    function openProfileDrawer() {
      document.getElementById('drawer-mask').classList.add('open');
      document.getElementById('profile-drawer').classList.add('open');
    }
    function closeProfileDrawer() {
      document.getElementById('drawer-mask').classList.remove('open');
      document.getElementById('profile-drawer').classList.remove('open');
    }

    // 保存需求配置
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
            // 更新本地 profile 状态并重绘通勤圈
            profile.buyer.work_location = patch.buyer.work_location;
            profile.buyer.commute_max_minutes = patch.buyer.commute_max_minutes;
            setupWorkAnchor();
          } else {
            alert('保存失败: ' + (data.error || '未知错误'));
          }
        } else {
          // 静态模式下提示下载或复制代码
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

    // 高德地图 Key 管理
    function openKeyConfig() {
      document.getElementById('input-amap-key').value = localStorage.getItem('amap_key') || '';
      document.getElementById('input-amap-security').value = localStorage.getItem('amap_security') || '';
      document.getElementById('key-dialog').style.display = 'flex';
    }
    function closeKeyDialog() {
      document.getElementById('key-dialog').style.display = 'none';
    }
    function saveAmapKeys() {
      const k = document.getElementById('input-amap-key').value.trim();
      const s = document.getElementById('input-amap-security').value.trim();
      if (!k) { alert('请输入高德 Web API Key'); return; }
      localStorage.setItem('amap_key', k);
      localStorage.setItem('amap_security', s);
      closeKeyDialog();
      location.reload();
    }

    // 初始化高德地图
    function setupAmap() {
      const amapKey = localStorage.getItem('amap_key') || INITIAL_DATA.amapKey;
      const amapSecurity = localStorage.getItem('amap_security') || INITIAL_DATA.amapSecurity;

      if (!amapKey) {
        // 如果没有 key，引导输入
        openKeyConfig();
        return;
      }

      window._AMapSecurityConfig = { securityJsCode: amapSecurity || '' };

      const script = document.createElement('script');
      script.src = \`https://webapi.amap.com/maps?v=2.0&key=\${encodeURIComponent(amapKey)}&plugin=AMap.Geocoder,AMap.Circle,AMap.Scale,AMap.ToolBar\`;
      script.onload = () => {
        aMapInstance = new AMap.Map('map-root', {
          zoom: 12,
          center: [121.50, 31.23], // 默认上海
          mapStyle: 'amap://styles/dark',
        });
        aMapInstance.addControl(new AMap.Scale());
        aMapInstance.addControl(new AMap.ToolBar({ position: 'RB' }));

        // 标记公司与通勤圈
        setupWorkAnchor();

        // 标记房源
        refreshMapMarkers();
      };
      script.onerror = () => {
        alert('高德地图加载失败，请检查网络或输入的 Key 是否正确。');
      };
      document.head.appendChild(script);
    }

    // 设置工作地锚点与通勤圈
    function setupWorkAnchor() {
      if (!aMapInstance) return;
      const loc = (profile.buyer && profile.buyer.work_location) ? profile.buyer.work_location : '浦东新区人民广场';
      const city = (profile.buyer && profile.buyer.city) ? profile.buyer.city : '上海';

      const geocoder = new AMap.Geocoder({ city });
      geocoder.getLocation(loc, (status, result) => {
        if (status === 'complete' && result.geocodes.length) {
          const lnglat = [result.geocodes[0].location.lng, result.geocodes[0].location.lat];

          if (workMarker) aMapInstance.remove(workMarker);
          if (commuteCircle) aMapInstance.remove(commuteCircle);

          // 工作地标记
          const content = \`<div class="map-marker work">💼 工作地: \${loc}</div>\`;
          workMarker = new AMap.Marker({
            position: lnglat,
            content,
            offset: new AMap.Pixel(-50, -20),
            zIndex: 110,
          });
          aMapInstance.add(workMarker);
          aMapInstance.setCenter(lnglat);

          // 绘制等时/通勤参考半径圈（如 8-10km 缓冲圈，相当于 30-45 分钟车程/地铁）
          commuteCircle = new AMap.Circle({
            center: lnglat,
            radius: 8000, // 8000 米
            strokeColor: '#38bdf8',
            strokeWeight: 1,
            strokeDasharray: [6, 6],
            fillColor: '#0284c7',
            fillOpacity: 0.1,
            zIndex: 10,
          });
          aMapInstance.add(commuteCircle);
          if (!showCommuteRange) commuteCircle.hide();
        }
      });
    }

    // 刷新房源打点
    async function refreshMapMarkers(list = getFilteredHouses()) {
      if (!aMapInstance) return;

      // 清除原有 Marker
      markers.forEach(m => aMapInstance.remove(m));
      markers = [];

      const geocoder = new AMap.Geocoder({ city: profile.buyer?.city || '上海' });
      const newGeoCache = {};

      for (const h of list) {
        const key = [h.city, h.district, h.community].filter(Boolean).join('·');
        let lnglat = h.coords || geoCache[key];

        if (!lnglat && h.community) {
          // 异步 geocode
          await new Promise(resolve => {
            geocoder.getLocation((h.city || '') + (h.district || '') + h.community, (status, res) => {
              if (status === 'complete' && res.geocodes.length) {
                lnglat = [res.geocodes[0].location.lng, res.geocodes[0].location.lat];
                geoCache[key] = lnglat;
                newGeoCache[key] = lnglat;
              }
              resolve();
            });
          });
        }

        if (lnglat) {
          h._lnglat = lnglat;
          const isRejected = h.hard_dq_hit || (h.score_global != null && h.score_global < 3.5) || h.conclusion === 'pass' || h.state === '弃购';
          const isRec = !isRejected && ((h.score_global != null && h.score_global >= 4.0) || h.conclusion === 'worth_viewing' || h.conclusion === 'strong_buy');

          const cls = isRejected ? 'low' : isRec ? 'high' : 'mid';
          const label = (h.score_global != null ? h.score_global : '--') + ' ' + (h.community || h.report_no);

          const el = document.createElement('div');
          el.className = 'map-marker ' + cls;
          el.innerHTML = (isRec ? '★ ' : '') + label;
          el.onclick = () => selectHouse(h);

          const marker = new AMap.Marker({
            position: lnglat,
            content: el,
            offset: new AMap.Pixel(-30, -15),
            zIndex: isRec ? 90 : isRejected ? 50 : 70,
          });

          aMapInstance.add(marker);
          markers.push(marker);
        }
      }

      // 如果有新的地理编码结果且在服务模式下，批量异步回传
      if (IS_SERVER_MODE && Object.keys(newGeoCache).length > 0) {
        fetch('/api/geo-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newGeoCache)
        }).catch(() => {});
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
