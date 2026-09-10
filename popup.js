// popup：台账式工具清单（形态定位见 docs/项目管理工具箱_迭代规划.md 第 0 章）
// popup 仅承载「不依赖 ITA 上下文」的完整页面入口；项目查询 / 工时填报 / 项目工作台
// 需要ITA 信息，属于悬浮球面板形态或 ITA 页面内入口，不在 popup 清单中。

// 统一后端地址（与 content.js/workbench.js 保持一致）
const BACKEND_URL = 'http://127.0.0.1:8765';

const TOOLS = [
  {
    idx: '01',
    icon: 'el-icon-magic-stick',
    name: '规模估算书合规检查',
    desc: '14 条规则 + AI 双引擎，支持手动上传与 ITA 导入',
    page: 'estimation.html',
  },
  {
    idx: '02',
    icon: 'el-icon-time',
    name: '检查历史',
    desc: '检查记录本地留痕、回溯与查看',
    page: 'history.html',
  },
];

// 渲染工具卡片（台账行：编号 + 账脊 + 图标 + 名称描述）
const listEl = document.getElementById('toolList');
TOOLS.forEach((t) => {
  const card = document.createElement('div');
  card.className = 'tool';
  card.setAttribute('tabindex', '0');
  card.innerHTML = `
    <span class="idx">${t.idx}</span>
    <span class="icon"><i class="${t.icon}"></i></span>
    <div class="info">
      <div class="name">${t.name}</div>
      <div class="desc" title="${t.desc}">${t.desc}</div>
    </div>
    <span class="arrow">›</span>
  `;
  const open = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL(t.page) });
    window.close();
  };
  card.addEventListener('click', open);
  card.addEventListener('keypress', (e) => { if (e.key === 'Enter') open(); });
  listEl.appendChild(card);
});

// 版本号
document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;

// ── 悬浮球测试入口：把 content 脚本注入当前页（本地页面即可预览 UI 形态） ──
// 依赖 activeTab 权限：点击扩展图标即授予当前标签页的临时注入权。
const testBtn = document.getElementById('testBallBtn');
testBtn.addEventListener('click', async () => {
  testBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('未找到当前标签页');
    if (/^(chrome|edge|chrome-extension|about):/.test(tab.url || '')) {
      throw new Error('浏览器内部页面无法注入，请先打开一个普通网页（如 localhost 页面）');
    }
    // 图标字体已内嵌为 data-URI（icons.css 自包含），与面板样式一并注入即可；
    // 测试注入打上标记：跳转估算检查页时自动带 ?itaMock=1（外网调试沙箱）
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['vendor/icons.css', 'content.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.__abcTestInject = true; } });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js', 'content.tracker.js'] });
    testBtn.textContent = '✓ 已注入，看页面右下角悬浮球';
    setTimeout(() => window.close(), 900);
  } catch (e) {
    testBtn.textContent = '✕ ' + (e.message || e);
    testBtn.disabled = false;
  }
});

// 本地后端健康状态（统一 8765 服务）
const svcDot = document.getElementById('svcDot');
const svcText = document.getElementById('svcText');
const refreshSvc = () => {
  svcDot.className = 'dot';
  svcText.textContent = '本地服务：检测中…';
  fetch(BACKEND_URL + '/health', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
      if (d && d.ok) {
        svcDot.className = 'dot online';
        svcText.textContent = '本地服务：在线（' + (d.version || 'v' + chrome.runtime.getManifest().version) + '）';
      } else {
        throw new Error('bad response');
      }
    })
    .catch(() => {
      svcDot.className = 'dot offline';
      svcText.textContent = '本地服务：未启动';
    });
};
refreshSvc();

// 数据收集：恒开启（产品决定移除开关），底栏仅作状态说明
const collectNote = document.getElementById('collectNote');
collectNote.textContent = '数据收集：开';
