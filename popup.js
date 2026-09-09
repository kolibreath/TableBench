// popup：台账式工具清单（编号 01-04 对应工作流：项目工作台 → 估算书把关 → 工时把关 → 留痕）
// 配色与功能点估算工具同源（绿色系）；图标为 Element UI 本地字体图标

// 统一后端地址（与 content.js/workbench.js/workhours.js 保持一致）
const BACKEND_URL = 'http://127.0.0.1:8765';

// 四大工具模块（项目自查 + 项目入库已整合为「项目工作台」；工时检查 V3.1 并入统一后端）
const TOOLS = [
  {
    idx: '01',
    icon: 'el-icon-folder-opened',
    name: '项目工作台',
    desc: '项目文档检查 + 按产生阶段归档下载，一次搞定',
    page: 'workbench.html',
  },
  {
    idx: '02',
    icon: 'el-icon-magic-stick',
    name: '规模估算书合规检查',
    desc: '14 条规则 + AI 双引擎，支持手动上传与 ITA 导入',
    page: 'estimation.html',
  },
  {
    idx: '03',
    icon: 'el-icon-data-analysis',
    name: '工时填报检查',
    desc: '结项前成员工时填报误差检查，一键导出提醒名单',
    page: 'workhours.html',
  },
  {
    idx: '04',
    icon: 'el-icon-time',
    name: '检查历史',
    desc: '检查记录本地留痕、回溯与导出',
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

// 数据收集开关（合规检查数据上报，见开发文档 4.5）
const collectSwitch = document.getElementById('collectSwitch');
const renderCollect = (on) => {
  collectSwitch.textContent = '收集：' + (on ? '开' : '关');
};
chrome.storage.local.get(['fcCollectEnabled'], (r) => {
  renderCollect(r.fcCollectEnabled !== false); // 默认开启
});
collectSwitch.addEventListener('click', () => {
  chrome.storage.local.get(['fcCollectEnabled'], (r) => {
    const next = r.fcCollectEnabled === false; // 关 → 开
    chrome.storage.local.set({ fcCollectEnabled: next }, () => renderCollect(next));
  });
});
