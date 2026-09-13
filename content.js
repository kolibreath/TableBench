// 项目工具插件 - 内容脚本
// 在 ita.abc 页面右下角注入悬浮图标，点击展开项目查询面板

(() => {
  // 防止重复注入
  if (window.__abcProjectSearchInjected) {
    return;
  }
  window.__abcProjectSearchInjected = true;

  // API地址
  const API_URL = 'http://ita.abc/ita/project/searchProj2022.action';
  const API_DETAIL_URL = 'http://ita.abc/ita/project/searchProj.action';

  // ── 沙箱演示：非 ita.abc 页面（popup「测试悬浮球」注入）自动走模拟数据 ──
  // 数据优先取 mock-data/workbench-mock-data.js（popup 注入的完整数据集），
  // 未注入时退回下方内置最小集；ITA 页面内始终走真实接口，行为不变。
  const IS_ITA = /^https?:\/\/([a-z0-9.-]+\.)?ita\.abc\//i.test(location.href);
  const MOCK = !IS_ITA;
  const MOCK_FALLBACK = {
    projects: [
      { prjid: 'PRJZH0090001', projname: '账务核心系统升级项目', projectno: '科维2026-0901', projtype: '一般应用类（常规研发模式）', projMan: '张甲', status: '正常', currentstageName: '需求分析阶段', applytime: '2026-07-01 09:30:00' },
      { prjid: 'PRJZH0026003', projname: '智能风控平台二期', projectno: 'XRK2026003', projtype: '一般应用类（敏捷研发模式）', projMan: '赵丙', status: '暂停', currentstageName: '系统设计阶段', applytime: '2026-05-06 14:12:00' },
    ],
    files: {
      PRJZH0090001: [
        { idFile: 'M-101', idPsn: 'U01', namFile: '账务核心系统升级项目_业务需求说明书.docx', fileSize: 245760, timeUpl: '2026-07-01 09:00:00', userName: '张甲', fileType: '业务需求说明书(需求分析)', typSecValue: '业务需求说明书(需求分析)' },
        { idFile: 'M-102', idPsn: 'U01', namFile: '账务核心系统升级项目_项目规模估算书.xlsx', fileSize: 34816, timeUpl: '2026-07-02 10:00:00', userName: '李乙', fileType: '项目规模估算书', typSecValue: '项目规模估算书' },
      ],
      PRJZH0026003: [
        { idFile: 'M-201', idPsn: 'U01', namFile: '智能风控平台二期_业务需求文档.docx', fileSize: 180000, timeUpl: '2026-05-10 09:00:00', userName: '赵丙', fileType: '业务需求文档', typSecValue: '业务需求文档' },
      ],
    },
  };
  const mockData = () => (window.__abcWorkbenchMockData || MOCK_FALLBACK);

  // ── 本地文档索引（P1）：缓存已展开/已索引项目的文档列表，支撑跨项目文档名检索 ──
  // 存储 chrome.storage.local fcDocIndex；滚动保留最近 50 个项目，非扩展环境仅内存生效
  const DOC_INDEX_KEY = 'fcDocIndex';
  const DOC_INDEX_MAX = 50;
  let docIndex = null; // 会话内缓存（避免渲染期反复读 storage）
  const indexLoad = async () => {
    if (docIndex) return docIndex;
    try {
      docIndex = await new Promise((resolve) => {
        try {
          chrome.storage.local.get([DOC_INDEX_KEY], (res) => {
            void (chrome.runtime && chrome.runtime.lastError);
            resolve((res && res[DOC_INDEX_KEY]) || {});
          });
        } catch (e) { resolve({}); }
      });
    } catch (e) { docIndex = {}; }
    return docIndex;
  };
  const indexSaveEntry = async (prjid, meta, files) => {
    await indexLoad();
    docIndex[prjid] = {
      projname: meta.projname || '', projectno: meta.projectno || '',
      files, at: Date.now(),
    };
    const keys = Object.keys(docIndex);
    if (keys.length > DOC_INDEX_MAX) { // 淘汰最旧
      keys.sort((a, b) => (docIndex[a].at || 0) - (docIndex[b].at || 0));
      keys.slice(0, keys.length - DOC_INDEX_MAX).forEach((k) => delete docIndex[k]);
    }
    try { await chrome.storage.local.set({ [DOC_INDEX_KEY]: docIndex }); } catch (e) { /* 非扩展环境仅内存 */ }
  };

  // 项目详情 → 文档列表（真实/沙箱统一入口；loadDocs 与「建索引」共用）
  const fetchDetailFiles = async (prjid) => {
    if (MOCK) return mockData().files[prjid] || [];
    const response = await fetch(API_DETAIL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: `bizdomain=0&prjid=${encodeParam(prjid)}`,
      credentials: 'include'
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const result = await response.json();
    const detail = result && result.data && result.data[0] ? result.data[0] : null;
    return detail ? (detail.fileList || []) : [];
  };

  // 统一经后台打开扩展页：tabs.create 不受 web_accessible_resources origin 白名单限制。
  // 上下文失效（扩展重载后旧页面里的孤儿脚本）绝不能回退 window.open——非白名单页
  // 会弹「已被屏蔽」，此时唯一正确动作是提示用户刷新页面并重新注入。
  const openExtPage = (page, query) => {
    let contextAlive = true;
    try {
      if (!chrome.runtime || !chrome.runtime.id) contextAlive = false;
    } catch (e) { contextAlive = false; }
    if (!contextAlive) {
      alert('插件已更新，当前页面的悬浮球已失效。\n请刷新页面后重新注入（或到 ITA 页面重新打开）。');
      return;
    }
    let fullUrl = '';
    try {
      // 测试注入的悬浮球：跳转估算检查页自动带模拟数据参数（外网调试沙箱）
      let q = query || '';
      if (window.__abcTestInject && page === 'estimation.html') {
        q = q ? q + '&itaMock=1' : '?itaMock=1';
      }
      // 工作台同理：沙箱里打开即带 wbMock=1，文档搜索/下载走同一套模拟数据
      if (window.__abcTestInject && page === 'workbench.html') {
        q = q ? q + '&wbMock=1' : '?wbMock=1';
      }
      // 真实 ITA 域跳转估算检查页：带上 ITA 上下文标记，估算页据此放开「从 ITA 导入」
      // 通道（扩展页有 host_permissions 免 CORS，页内搜索/下载可直连）。非 ITA 域不带，
      // 保持菜单路径禁用（防呆设计）。
      if (!q.includes('itaFrom=') && !q.includes('itaMock=') && page === 'estimation.html'
          && /^https?:\/\/([a-z0-9.-]+\.)?ita\.abc\//i.test(location.href)) {
        q = q ? q + '&itaFrom=1' : '?itaFrom=1';
      }
      fullUrl = chrome.runtime.getURL(page) + q;
      chrome.runtime.sendMessage({ type: 'OPEN_PAGE', page, query: q }, function (resp) {
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          // 后台未就绪：仅真实 ITA 域（白名单内）回退 window.open，其余提示重新注入
          if (/^https?:\/\/([a-z0-9.-]+\.)?ita\.abc\//i.test(location.href)) {
            window.open(fullUrl, '_blank');
          } else {
            alert('插件刚刚更新，请刷新当前页面并重新注入悬浮球后再试。');
          }
        }
      });
    } catch (e) {
      alert('插件已更新，当前页面的悬浮球已失效。\n请刷新页面后重新注入（或到 ITA 页面重新打开）。');
    }
  };

  // ================= 下载地址配置 =================
  // 下载接口：http://ita.abc/ita/downloadFileById.action?idFile=xxx&idPsn=xxx
  const buildDownloadUrl = (file) => {
    return `http://ita.abc/ita/downloadFileById.action?idFile=${encodeURIComponent(file.idFile || '')}&idPsn=${encodeURIComponent(file.idPsn || '')}`;
  };
  // ==============================================

  // 触发单个文件下载
  const downloadFile = (file) => {
    const filename = file.namFile || file.nmlName || 'document';
    if (MOCK) {
      // 沙箱：给一个占位文本文件，保证「查询 → 看文档 → 下载」演示链路完整
      const blob = new Blob(['【模拟数据】' + filename + '\n\n这是测试注入沙箱生成的占位文件，非真实文档。'], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.replace(/\.[^.]*$/, '') + '.txt';
      // 挂到面板内：合成点击若落在 body 会被「点击外部关闭」误判，整个面板被关掉
      panel.appendChild(a);
      a.click();
      panel.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return;
    }
    const url = buildDownloadUrl(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    panel.appendChild(a);
    a.click();
    panel.removeChild(a);
  };

  // 批量下载：真实环境经 background 的 downloads 队列（并发/重试/不受多下载拦截）；
  // 沙箱顺序生成占位文件，保证演示链路完整
  const batchDownload = async (files) => {
    if (MOCK) {
      let done = 0;
      for (const f of files) {
        downloadFile(f);
        done += 1;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return { done, failed: 0, mock: true };
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'DOWNLOAD_FILES', items: files.map((f) => ({ url: buildDownloadUrl(f), filename: f.namFile || f.nmlName || 'document.txt' })) },
          (resp) => {
            void (chrome.runtime && chrome.runtime.lastError);
            resolve(resp || { done: 0, failed: files.length });
          }
        );
      } catch (e) {
        resolve({ done: 0, failed: files.length });
      }
    });
  };

  // 打包 zip（P2）：前端带登录态逐个下载 → POST 本地后端 /api/archive → 返回 zip 落盘。
  // 并发 3；失败抛错由调用方降级为逐个下载
  const archiveZip = async (files, onProgress) => {
    const fd = new FormData();
    const paths = [];
    let done = 0;
    const queue = files.map((f, i) => ({ f, i }));
    const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_');
    const worker = async () => {
      while (queue.length) {
        const { f, i } = queue.shift();
        const resp = await fetch(buildDownloadUrl(f), { credentials: 'include' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${f.namFile || ''}`);
        fd.append('f' + i, await resp.blob(), safe(f.namFile || f.nmlName || `file_${i}`));
        paths[i] = safe(f.fileType || f.typSecValue || '未分类文档') + '/' + safe(f.namFile || f.nmlName || `file_${i}`);
        done += 1;
        onProgress && onProgress(done);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    fd.append('count', String(files.length));
    fd.append('paths', JSON.stringify(paths));
    const resp = await fetch('http://127.0.0.1:8765/api/archive', { method: 'POST', body: fd });
    if (!resp.ok) throw new Error('打包接口 HTTP ' + resp.status);
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '归档_' + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '') + '.zip';
    panel.appendChild(a);
    a.click();
    panel.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    return files.length;
  };

  // 打开项目工作台（storage 移交文件列表，免去工作台重复拉取；失败降级为逐个原生下载）
  const openWorkbench = (prjid, fileList) => {
    if ((!fileList || fileList.length === 0) && !prjid) {
      return;
    }
    const proj = (window.__abcProjMeta || {})[prjid] || {};
    const payload = {
      prjid: prjid || '',
      projectno: proj.projectno || '',
      projname: proj.projname || '',
      projtype: proj.projtype || (window.__abcProjMap || {})[prjid] || '',
      files: fileList || [],
      time: Date.now(),
    };
    try {
      chrome.storage.local.set({ fcPendingWorkbench: payload }, () => {
        openExtPage('workbench.html');
      });
    } catch (e) {
      (fileList || []).forEach((f) => {
        setTimeout(() => downloadFile(f), 100);
      });
    }
  };

  // 打开项目工作台（URL 深链：打开即已选定项目，工作台自行拉取文档列表）
  const startWorkbench = (prjid) => {
    const proj = (window.__abcProjMeta || {})[prjid] || {};
    const q = new URLSearchParams({
      prjid: prjid || '',
      projname: proj.projname || '',
      projectno: proj.projectno || '',
      projtype: proj.projtype || '',
    });
    openExtPage('workbench.html', '?' + q.toString());
  };

  // 自动从浏览器获取 ita.abc 的 cookie
  const getCookies = () => {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_COOKIES' }, (response) => {
          if (chrome.runtime.lastError) {
            // 无 background 时退回页面自身 cookie
            resolve(document.cookie || '');
            return;
          }
          if (response && response.ok) {
            resolve(response.cookie);
          } else {
            resolve(document.cookie || '');
          }
        });
      } catch (e) {
        resolve(document.cookie || '');
      }
    });
  };

  // 构建DOM
  const icon = document.createElement('div');
  icon.className = 'abc-project-floating-icon';
  icon.innerHTML = '<span class="icon-text">项</span>';
  icon.title = '项目管理工具箱';

  // 工具菜单（绿色台账风；编号 01-04 对应工作流：项目工作台 → 估算书把关 → 工时把关 → 留痕）
  const MENU_ITEMS = [
    { icon: 'el-icon-search', idx: '01', name: '项目查询', desc: '搜索项目、查看/下载文档', action: 'search' },
    { icon: 'el-icon-finished', idx: '02', name: '进度跟踪', desc: '流程卡在谁那儿一目了然，一键催办', action: 'tracker' },
    { icon: 'el-icon-folder-opened', idx: '03', name: '项目文档自查 + 入库', desc: '对照《入库清单》自查齐套，一键按阶段归档落盘', page: 'workbench.html' },
    { icon: 'el-icon-magic-stick', idx: '04', name: '规模估算书合规检查', desc: '14 条规则 + AI 双引擎（前置/后置）', page: 'estimation.html' },
    { icon: 'el-icon-data-analysis', idx: '05', name: '工时填报检查', desc: '结项前成员工时误差检查与提醒', action: 'workhours' },
    { icon: 'el-icon-time', idx: '06', name: '检查历史', desc: '检查记录留痕、回溯与导出', page: 'history.html' },
  ];
  const menu = document.createElement('div');
  menu.className = 'abc-project-menu';
  menu.innerHTML = `
    <div class="abc-project-menu-header">
      <span class="abc-project-menu-logo">项</span>
      <span class="abc-project-menu-name">项目管理工具箱</span>
    </div>
    <div class="abc-project-menu-list">
      ${MENU_ITEMS.map((m, i) => `
        <div class="abc-project-menu-item" data-idx="${i}">
          <span class="abc-project-menu-icon"><i class="${m.icon}"></i></span>
          <span class="abc-project-menu-idx">${m.idx}</span>
          <span class="abc-project-menu-info">
            <span class="abc-project-menu-name">${m.name}</span>
            <span class="abc-project-menu-desc">${m.desc}</span>
          </span>
          <span class="abc-project-menu-arrow">›</span>
        </div>
      `).join('')}
    </div>
  `;

  const panel = document.createElement('div');
  panel.className = 'abc-panel abc-panel--query';
  const queryMask = document.createElement('div');
  queryMask.className = 'abc-query-mask';
  panel.innerHTML = `
    <div class="abc-panel-head">
      <span class="abc-panel-logo"><i class="el-icon-box"></i></span>
      <span class="abc-panel-title">项目查询</span>
      ${MOCK ? '<span class="abc-panel-mockbadge">模拟数据</span>' : ''}
      <span class="abc-panel-close"><i class="el-icon-close"></i></span>
    </div>
    <div class="abc-panel-body" id="abc-project-body">
      <div class="abc-project-search-row">
        <input type="text" id="abc-project-input" placeholder="请输入项目名称">
        <button class="abc-project-btn" id="abc-project-search">查询</button>
        <button class="abc-project-btn abc-project-indexbtn" id="abc-project-index" title="为当前结果的所有项目拉取文档列表并建立本地索引（供跨项目按文档名检索）">建索引</button>
      </div>
      <div id="abc-project-result"></div>
      <button class="abc-project-totop" id="abc-project-totop" title="回到顶部"><i class="el-icon-top"></i> 顶部</button>
    </div>
  `;

  document.documentElement.appendChild(icon);
  document.documentElement.appendChild(menu);
  document.documentElement.appendChild(queryMask);
  document.documentElement.appendChild(panel);

  // 面板开合统一入口：居中模态需要遮罩同步显隐
  const setQueryOpen = (open) => {
    panel.classList.toggle('show', open);
    queryMask.classList.toggle('show', open);
  };

  const input = panel.querySelector('#abc-project-input');
  const searchBtn = panel.querySelector('#abc-project-search');
  const resultDiv = panel.querySelector('#abc-project-result');
  const closeBtn = panel.querySelector('.abc-panel-close');
  const panelBody = panel.querySelector('#abc-project-body');
  const toTopBtn = panel.querySelector('#abc-project-totop');

  // 菜单点击：项目查询展开搜索面板，其余打开对应工具页
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.abc-project-menu-item');
    if (!item) return;
    const conf = MENU_ITEMS[Number(item.dataset.idx) || 0];
    if (!conf) return;
    if (conf.action === 'search') {
      menu.classList.remove('show');
      setQueryOpen(true);
      input.focus();
      return;
    }
    if (conf.action === 'tracker') {
      menu.classList.remove('show');
      setQueryOpen(false);
      if (window.__abcTrackerOpen) window.__abcTrackerOpen();
      return;
    }
    if (conf.action === 'workhours') {
      menu.classList.remove('show');
      setQueryOpen(false);
      if (window.__abcWorkhoursOpen) window.__abcWorkhoursOpen();
      return;
    }
    if (conf.page) {
      openExtPage(conf.page);
      menu.classList.remove('show');
      setQueryOpen(false);
    }
  });

  // ITA 文档角色识别（后置合规检查的候选筛选，详见开发文档 4.3.4）
  const ESTIMATION_NAME_RE = /估算/i;
  const REQUIREMENT_NAME_RE = /需求/i;
  const guessFileRole = (name) => {
    const ext = (String(name).split('.').pop() || '').toLowerCase();
    if (['xlsx', 'et'].indexOf(ext) >= 0 && ESTIMATION_NAME_RE.test(name)) return 'estimation';
    if (['wps', 'wpsx', 'doc', 'docx', 'txt', 'md'].indexOf(ext) >= 0 && REQUIREMENT_NAME_RE.test(name)) return 'requirement';
    return 'unknown';
  };

  // 发起后置合规检查：传递文件元数据，由估算检查页自动下载并检查
  const startEstimationCheck = (prjid) => {
    const list = (window.__abcFileLists || {})[prjid] || [];
    const proj = (window.__abcProjMeta || {})[prjid] || {};
    const files = list.map((f) => ({
      idFile: f.idFile || '',
      idPsn: f.idPsn || '',
      name: f.namFile || f.nmlName || '',
      size: f.fileSize || 0,
      uploadTime: f.timeUpl || f.dateUpl || '',
      userName: f.userName || '',
      role: guessFileRole(f.namFile || f.nmlName || ''),
    }));
    const payload = {
      prjid: prjid || '',
      projectno: proj.projectno || '',
      projname: proj.projname || '',
      projtype: proj.projtype || '',
      files,
      time: Date.now(),
    };
    try {
      chrome.storage.local.set({ fcPendingItaImport: payload }, () => {
        openExtPage('estimation.html?mode=ita');
      });
    } catch (e) {
      alert('发起合规检查失败：' + e.message);
    }
  };


  // 一键回到顶部（可收起项目文档）
  toTopBtn.addEventListener('click', () => {
    panelBody.scrollTop = 0;
  });

  // 编码URL参数
  const encodeParam = (value) => encodeURIComponent(value || '');

  // 构建请求数据
  // ⚠ searchProj2022 参数形状未经抓包验证（无翻页逻辑，page 写死 1）；
  //   pageSize=100 为全插件统一值，服务端如有上限会自行钳制
  const buildFormData = (projname, page = 1, pageSize = 100) => {
    return `bizdomain=0&projname=${encodeParam(projname)}&projectno=&status=&projtype=&currentstage=&zhuModLvl=&applytime=&page=${page}&pageSize=${pageSize}`;
  };

  // 格式化日期
  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleString('zh-CN');
    } catch {
      return dateStr;
    }
  };

  // 格式化文件大小（字节）
  const formatSize = (bytes) => {
    if (bytes === null || bytes === undefined || bytes === '') return '-';
    const n = Number(bytes);
    if (isNaN(n) || n < 0) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  // 显示状态
  const showStatus = (msg) => {
    resultDiv.innerHTML = `<div class="abc-project-status">${msg}</div>`;
  };

  // 状态徽章：按关键词着色（正常在研绿 / 暂停橙 / 终止废弃灰红 / 完成结项灰），未知中性
  const statusBadge = (status) => {
    const s = String(status || '').trim();
    if (!s) return '';
    let cls = '';
    if (/完成|结项/.test(s)) cls = 'is-done';
    else if (/暂停/.test(s)) cls = 'is-hold';
    else if (/终止|废弃|作废/.test(s)) cls = 'is-off';
    else if (/正常|在研|实施/.test(s)) cls = 'is-run';
    return `<span class="abc-project-status-badge ${cls}">${s}</span>`;
  };

  // 紧凑行用的短日期（台账列对齐：补零的 yyyy-MM-dd）
  const fmtDate10 = (v) => {
    if (!v) return '-';
    const d = new Date(String(v).replace(/-/g, '/'));
    if (isNaN(d.getTime())) return String(v).split(' ')[0];
    const p = (n) => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };

  // 类型列的短标签（列窄，全称放详情与 title）：常规/敏捷/快捷/基建/运维
  const shortProjType = (t) => {
    const s = String(t || '');
    if (!s) return '-';
    if (/敏捷/.test(s)) return '敏捷';
    if (/快捷/.test(s)) return '快捷';
    if (/基建/.test(s)) return '基建';
    if (/运维/.test(s)) return '运维';
    if (/常规/.test(s)) return '常规';
    return s.length > 6 ? s.slice(0, 4) + '…' : s;
  };

  // 展开/收起一条台账行（同步 aria-expanded 与箭头方向）
  const toggleCard = (card) => {
    card.classList.toggle('is-open');
    const open = card.classList.contains('is-open');
    const head = card.querySelector('.abc-project-card-head');
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
    return open;
  };

  // 显示项目列表
  // 台账式列表：单一容器 + 发丝线分行 + 与列头对齐的固定数据列；
  // 完整字段、描述、备注默认折叠（点行展开），避免单卡片近一屏高、列表无限拉长
  const showProjects = (data) => {
    if (!data || data.length === 0) {
      showStatus('没有找到相关项目。换个关键词试试，或清空输入后查询全部项目。');
      return;
    }

    // 缓存每个项目的完整元数据（后置合规检查需要 projectno/projname/projtype）
    window.__abcProjMap = window.__abcProjMap || {};
    window.__abcProjMeta = window.__abcProjMeta || {};
    window.__abcLastProjects = data; // 供「建索引」遍历当前结果
    data.forEach((item) => {
      if (!item.prjid) return;
      window.__abcProjMap[item.prjid] = item.projtype || '';
      window.__abcProjMeta[item.prjid] = item;
    });

    const html = `
      <div class="abc-project-total">共 ${data.length} 条记录，点击行可展开完整字段</div>
      <div class="abc-project-list">
        <div class="abc-project-list-head" aria-hidden="true">
          <span class="abc-col abc-col-idx">#</span>
          <span class="abc-col abc-col-name">项目名称</span>
          <span class="abc-col abc-col-no">项目编号</span>
          <span class="abc-col abc-col-type">类型</span>
          <span class="abc-col abc-col-stage">当前阶段</span>
          <span class="abc-col abc-col-pm">经理</span>
          <span class="abc-col abc-col-date">申请时间</span>
          <span class="abc-col abc-col-ops">操作</span>
        </div>
        ${data.map((item, index) => `
        <div class="abc-project-card">
          <div class="abc-project-card-head" role="button" tabindex="0" aria-expanded="false"
               title="点击展开/收起完整字段">
            <span class="abc-col abc-col-idx">${index + 1}</span>
            <span class="abc-col abc-col-name">
              <span class="abc-project-card-name">${item.projname || '未命名项目'}</span>
              ${statusBadge(item.status)}
            </span>
            <span class="abc-col abc-col-no">${item.projectno || '-'}</span>
            <span class="abc-col abc-col-type" title="${item.projtype || '-'}">${shortProjType(item.projtype)}</span>
            <span class="abc-col abc-col-stage">${item.currentstageName || '-'}</span>
            <span class="abc-col abc-col-pm">${item.projMan || '-'}</span>
            <span class="abc-col abc-col-date">${fmtDate10(item.applytime)}</span>
            <span class="abc-col abc-col-ops">
              <button class="abc-project-doc-btn" data-prjid="${item.prjid || ''}">
                <i class="el-icon-document"></i>项目文档
              </button>
              <span class="abc-project-card-chevron" aria-hidden="true">
                <svg viewBox="0 0 12 12" width="12" height="12"><path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </span>
          </div>
          <div class="abc-project-card-detail">
            <div class="abc-project-card-grid">
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">项目名称</span>
                <span class="abc-project-card-value">${item.projname || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">项目编号</span>
                <span class="abc-project-card-value">${item.projectno || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">项目ID</span>
                <span class="abc-project-card-value">${item.prjid || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">状态</span>
                <span class="abc-project-card-value">${item.status || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">当前阶段</span>
                <span class="abc-project-card-value">${item.currentstageName || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">业务领域</span>
                <span class="abc-project-card-value">${item.bizdomain || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">项目类型</span>
                <span class="abc-project-card-value">${item.projtype || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">项目等级</span>
                <span class="abc-project-card-value">${item.indJssc || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">保密等级</span>
                <span class="abc-project-card-value">${item.secLvl || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">实施类型</span>
                <span class="abc-project-card-value">${item.zfImpl || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">主办部门</span>
                <span class="abc-project-card-value">${item.majorBearDept || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">项目经理</span>
                <span class="abc-project-card-value">${item.projMan || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">产品经理</span>
                <span class="abc-project-card-value">${item.projViewer || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">需求来源</span>
                <span class="abc-project-card-value">${item.namDemdSrc || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">需求开始日期</span>
                <span class="abc-project-card-value">${item.reqstartdate || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">需求结束日期</span>
                <span class="abc-project-card-value">${item.reqenddate || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">计划投产时间</span>
                <span class="abc-project-card-value">${item.endProjtime || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">申请时间</span>
                <span class="abc-project-card-value">${formatDate(item.applytime)}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">部署地点</span>
                <span class="abc-project-card-value">${item.dplyPlce || '-'}</span>
              </div>
              <div class="abc-project-card-item">
                <span class="abc-project-card-label">优先级</span>
                <span class="abc-project-card-value">${item.priority || '-'}</span>
              </div>
            </div>
            <div class="abc-project-card-desc"><strong>项目描述：</strong>${item.txtDesp || '无'}</div>
            ${item.remark ? `<div class="abc-project-card-desc"><strong>备注：</strong>${item.remark}</div>` : ''}
          </div>
          <div class="abc-project-docs" id="docs-${item.prjid || 'none'}"></div>
        </div>
        `).join('')}
      </div>
    `;

    resultDiv.innerHTML = html;
  };

  // 展示文档信息（fileList）：检索（关键词/类型/上传人/时间范围/只看最新版）+ 排序 + 勾选批量下载。
  // 行的 data-file 始终指向 fileList 原始下标，过滤排序不影响下载映射
  const showDocs = (prjid, fileList) => {
    const docsDiv = document.getElementById(`docs-${prjid}`);
    if (!docsDiv) return;

    if (!fileList || fileList.length === 0) {
      docsDiv.innerHTML = `<div class="abc-project-docs-empty">该项目暂无文档</div>`;
      return;
    }

    // 保存文件列表，供事件委托下载使用
    window.__abcFileLists = window.__abcFileLists || {};
    window.__abcFileLists[prjid] = fileList;

    const state = { kw: '', type: '', person: '', days: 0, latest: false, sort: 'default', sel: new Set() };
    const docName = (f) => f.namFile || f.nmlName || '';
    const docType = (f) => f.fileType || f.typSecValue || '文档';
    const docPerson = (f) => f.userName || f.psnMng || '';
    const types = [...new Set(fileList.map(docType))].sort();
    const persons = [...new Set(fileList.map(docPerson).filter(Boolean))].sort();

    // 「只看最新版」：同名文档仅保留上传时间最新的一份
    const latestIdx = new Set();
    const byName = {};
    fileList.forEach((f, i) => {
      const key = docName(f).toLowerCase();
      if (!(key in byName) || String(f.timeUpl || '') > String(fileList[byName[key]].timeUpl || '')) byName[key] = i;
    });
    Object.values(byName).forEach((i) => latestIdx.add(i));

    const withinRange = (f) => {
      if (!state.days) return true;
      const t = Date.parse(String(f.timeUpl || f.dateUpl || '').replace(/-/g, '/'));
      return !isNaN(t) && Date.now() - t <= state.days * 86400e3;
    };

    const render = () => {
      let idx = fileList.map((_, i) => i).filter((i) => {
        const f = fileList[i];
        if (state.kw && !(docName(f).includes(state.kw) || docType(f).includes(state.kw))) return false;
        if (state.type && docType(f) !== state.type) return false;
        if (state.person && docPerson(f) !== state.person) return false;
        if (state.days && !withinRange(f)) return false;
        if (state.latest && !latestIdx.has(i)) return false;
        return true;
      });
      if (state.sort === 'time') idx.sort((a, b) => String(fileList[b].timeUpl || '').localeCompare(String(fileList[a].timeUpl || '')));
      else if (state.sort === 'size') idx.sort((a, b) => (fileList[b].fileSize || 0) - (fileList[a].fileSize || 0));
      else if (state.sort === 'name') idx.sort((a, b) => docName(fileList[a]).localeCompare(docName(fileList[b]), 'zh-Hans-CN'));

      docsDiv.querySelector('.abc-project-doc-list').innerHTML = idx.map((i) => {
        const f = fileList[i];
        return `
        <div class="abc-project-doc-row">
          <label class="abc-project-doc-check"><input type="checkbox" class="abc-doc-sel" data-i="${i}"${state.sel.has(i) ? ' checked' : ''} title="勾选后可批量下载"></label>
          <div class="abc-project-doc-main">
            <div class="abc-project-doc-top">
              <span class="abc-project-doc-tag">${docType(f)}</span>
            </div>
            <div class="abc-project-doc-name">
              <i class="el-icon-document abc-project-doc-icon"></i>
              <a class="abc-project-doc-link" data-prjid="${prjid}" data-file="${i}" href="javascript:void(0)" title="点击下载">${docName(f) || '未命名文档'}</a>
            </div>
            <div class="abc-project-doc-meta">
              <span>上传人：${docPerson(f) || '-'}</span>
              <span>时间：${(f.timeUpl || f.dateUpl || '-').split('.')[0]}</span>
              <span>大小：${formatSize(f.fileSize)}</span>
            </div>
          </div>
        </div>`;
      }).join('') || '<div class="abc-project-docs-empty">没有符合筛选条件的文档</div>';

      docsDiv.querySelector('.abc-project-docs-title').innerHTML =
        `<i class="el-icon-folder-opened"></i> 项目文档（${idx.length}/${fileList.length}）`;
      const allChecked = idx.length > 0 && idx.every((i) => state.sel.has(i));
      const selAll = docsDiv.querySelector('.abc-doc-selall');
      selAll.checked = allChecked;
      const batchBtn = docsDiv.querySelector('.abc-doc-batch');
      const zipBtn = docsDiv.querySelector('.abc-doc-zip');
      if (batchBtn.dataset.busy !== '1') {
        batchBtn.innerHTML = `<i class="el-icon-download"></i> 下载选中（${state.sel.size}）`;
        batchBtn.disabled = state.sel.size === 0;
      }
      if (zipBtn.dataset.busy !== '1') {
        zipBtn.innerHTML = `<i class="el-icon-folder-opened"></i> 打包 zip（${state.sel.size}）`;
        zipBtn.disabled = state.sel.size === 0;
      }
    };

    docsDiv.innerHTML = `
      <div class="abc-project-docs-head">
        <div class="abc-project-docs-title"></div>
        <input type="text" class="abc-project-doc-search" placeholder="搜索文档关键词">
        <button class="abc-project-workbench" data-prjid="${prjid}" title="打开文档自查与归档入库页：齐套检查 + 按阶段归档"><i class="el-icon-folder-opened"></i>自查·入库</button>
        <button class="abc-project-estimation" data-prjid="${prjid}" title="自动下载该项目文档并运行规模估算书合规检查"><i class="el-icon-magic-stick"></i>合规检查</button>
        <button class="abc-project-download-all" data-prjid="${prjid}" title="打开文档自查与归档入库页，按产生阶段分类归档落盘"><i class="el-icon-download"></i>按阶段归档</button>
      </div>
      <div class="abc-project-doc-filters">
        <label class="abc-project-doc-flag"><input type="checkbox" class="abc-doc-selall"> 全选</label>
        <select class="abc-doc-f-type"><option value="">全部类型</option>${types.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
        ${persons.length ? `<select class="abc-doc-f-person"><option value="">全部上传人</option>${persons.map((p) => `<option value="${p}">${p}</option>`).join('')}</select>` : ''}
        <select class="abc-doc-f-range">
          <option value="0">全部时间</option>
          <option value="7">近 7 天</option>
          <option value="30">近 30 天</option>
          <option value="90">近 90 天</option>
          <option value="365">近一年</option>
        </select>
        <label class="abc-project-doc-flag"><input type="checkbox" class="abc-doc-f-latest"> 只看最新版</label>
        <select class="abc-doc-f-sort">
          <option value="default">默认排序</option>
          <option value="time">时间新→旧</option>
          <option value="size">大小大→小</option>
          <option value="name">名称 A→Z</option>
        </select>
      </div>
      <div class="abc-project-doc-list"></div>
      <div class="abc-project-doc-batchbar">
        <button class="abc-project-doc-btn abc-doc-batch" disabled><i class="el-icon-download"></i> 下载选中（0）</button>
        <button class="abc-project-doc-btn abc-doc-zip" disabled title="把选中文档按类型分目录打进一个 zip（需本地后端）"><i class="el-icon-folder-opened"></i> 打包 zip（0）</button>
        <button class="abc-project-doc-btn abc-doc-clear">清空选择</button>
        <span class="abc-project-doc-batchnote">勾选文档后可批量下载或打包 zip（需本地后端）</span>
      </div>
    `;
    render();

    docsDiv.querySelector('.abc-project-doc-search').addEventListener('input', (e) => { state.kw = e.target.value.trim(); render(); });
    docsDiv.querySelector('.abc-doc-f-type').addEventListener('change', (e) => { state.type = e.target.value; render(); });
    docsDiv.querySelector('.abc-doc-f-range').addEventListener('change', (e) => { state.days = Number(e.target.value) || 0; render(); });
    docsDiv.querySelector('.abc-doc-f-sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
    docsDiv.querySelector('.abc-doc-f-latest').addEventListener('change', (e) => { state.latest = e.target.checked; render(); });

    docsDiv.addEventListener('change', (e) => {
      if (e.target.classList.contains('abc-doc-sel')) {
        const i = Number(e.target.dataset.i);
        e.target.checked ? state.sel.add(i) : state.sel.delete(i);
        render();
      } else if (e.target.classList.contains('abc-doc-selall')) {
        // 全选/取消仅作用于当前可见（已筛选）行
        docsDiv.querySelectorAll('.abc-doc-sel').forEach((c) => {
          const i = Number(c.dataset.i);
          c.checked = e.target.checked;
          e.target.checked ? state.sel.add(i) : state.sel.delete(i);
        });
        render();
      }
    });

    docsDiv.addEventListener('click', async (e) => {
      const batchBtn = e.target.closest('.abc-doc-batch');
      if (batchBtn && batchBtn.dataset.busy !== '1') {
        const files = [...state.sel].map((i) => fileList[i]).filter(Boolean);
        if (!files.length) return;
        batchBtn.dataset.busy = '1';
        batchBtn.textContent = `下载中 0/${files.length}…`;
        const res = await batchDownload(files);
        delete batchBtn.dataset.busy;
        state.sel.clear();
        render();
        batchBtn.textContent = res && res.mock
          ? `已模拟下载 ${res.done} 个文件`
          : `已完成 ${res && res.done || 0} 个${res && res.failed ? '，失败 ' + res.failed : ''}`;
        setTimeout(() => render(), 2500);
        return;
      }
      if (e.target.closest('.abc-doc-clear')) {
        state.sel.clear();
        render();
        return;
      }
      // 打包 zip（P2）：失败自动降级为逐个下载
      const zipBtn = e.target.closest('.abc-doc-zip');
      if (zipBtn && zipBtn.dataset.busy !== '1') {
        const files = [...state.sel].map((i) => fileList[i]).filter(Boolean);
        if (!files.length) return;
        if (MOCK) {
          zipBtn.textContent = '沙箱已模拟打包';
          setTimeout(() => render(), 1500);
          return;
        }
        zipBtn.dataset.busy = '1';
        zipBtn.textContent = `打包中 0/${files.length}…`;
        try {
          const n = await archiveZip(files, (done) => { zipBtn.textContent = `打包中 ${done}/${files.length}…`; });
          zipBtn.textContent = `已打包 ${n} 个文件（zip）`;
        } catch (err) {
          console.error('打包 zip 失败，降级为逐个下载:', err);
          zipBtn.textContent = '打包失败，已改用逐个下载…';
          const res = await batchDownload(files);
          zipBtn.textContent = `已逐个下载 ${res.done} 个${res.failed ? '，失败 ' + res.failed : ''}`;
        }
        delete zipBtn.dataset.busy;
        state.sel.clear();
        render();
        setTimeout(() => render(), 2500);
      }
    });
  };

  // 加载项目文档
  const loadDocs = async (prjid, btn) => {
    const docsDiv = document.getElementById(`docs-${prjid}`);
    if (!prjid || !docsDiv) return;

    // 已加载则折叠/展开
    if (docsDiv.dataset.loaded === 'true') {
      docsDiv.style.display = docsDiv.style.display === 'none' ? 'block' : 'none';
      btn.innerHTML = docsDiv.style.display === 'none' ? '<i class="el-icon-document"></i> 项目文档' : '<i class="el-icon-document"></i> 收起文档';
      return;
    }

    docsDiv.innerHTML = `<div class="abc-project-docs-empty">加载中...</div>`;
    docsDiv.style.display = 'block';
    btn.disabled = true;

    try {
      const fileList = await fetchDetailFiles(prjid);
      const meta = (window.__abcProjMeta || {})[prjid] || {};
      indexSaveEntry(prjid, meta, fileList); // 写入本地文档索引（跨项目检索用）
      docsDiv.dataset.loaded = 'true';
      showDocs(prjid, fileList);
      btn.innerHTML = '<i class="el-icon-document"></i> 收起文档';
    } catch (error) {
      console.error('加载文档失败:', error);
      docsDiv.innerHTML = `<div class="abc-project-docs-empty">加载文档失败：${error.message || '网络错误'}</div>`;
    } finally {
      btn.disabled = false;
    }
  };

  // 渲染项目结果，并追加本地索引的跨项目文档匹配（P1）
  const renderResults = async (rows, projname) => {
    if (rows.length > 0) {
      showProjects(rows);
    } else {
      showStatus('没有找到相关项目。换个关键词试试，或清空输入后查询全部项目。');
    }
    await renderDocMatches(projname.trim());
  };

  // 跨项目文档检索：在本地文档索引中按关键词匹配文档名/类型，追加到项目结果尾部
  const renderDocMatches = async (kw) => {
    const old = resultDiv.querySelector('.abc-docsearch');
    if (old) old.remove();
    if (!kw) return;
    const index = await indexLoad();
    const lower = kw.toLowerCase();
    const matches = [];
    Object.keys(index).forEach((prjid) => {
      const entry = index[prjid] || {};
      (entry.files || []).forEach((f) => {
        const name = f.namFile || f.nmlName || '';
        const type = f.fileType || f.typSecValue || '文档';
        if (name.toLowerCase().includes(lower) || type.toLowerCase().includes(lower)) {
          matches.push({ prjid: prjid, projname: entry.projname || prjid, f: f });
        }
      });
    });
    if (!matches.length) return;
    const limited = matches.slice(0, 50);
    window.__abcDocMatches = limited;
    const sec = document.createElement('div');
    sec.className = 'abc-docsearch';
    sec.innerHTML =
      '<div class="abc-docsearch-head"><i class="el-icon-search"></i> 文档检索（本地索引）· 匹配 ' + matches.length + ' 份' +
      (matches.length > limited.length ? '，显示前 ' + limited.length + ' 份' : '') +
      '<span class="abc-docsearch-note">基于已建索引的项目文档（展开文档或点「建索引」即入索引）；点项目名跳转</span></div>' +
      limited.map((m, i) =>
        '<div class="abc-docsearch-row">' +
        '<button class="abc-docsearch-proj" data-prjid="' + m.prjid + '" title="跳转到该项目">' + m.projname + '</button>' +
        '<span class="abc-docsearch-type">' + (m.f.fileType || m.f.typSecValue || '文档') + '</span>' +
        '<a class="abc-docsearch-link" data-mi="' + i + '" href="javascript:void(0)" title="点击下载">' + (m.f.namFile || '未命名文档') + '</a>' +
        '<span class="abc-docsearch-meta">' + (m.f.userName || '-') + ' · ' + String(m.f.timeUpl || '-').split('.')[0] + ' · ' + formatSize(m.f.fileSize) + '</span>' +
        '</div>'
      ).join('');
    resultDiv.appendChild(sec);
  };

  // 执行查询
  const search = async () => {
    const projname = input.value.trim();
    showStatus('查询中，请稍候...');
    searchBtn.disabled = true;

    try {
      if (MOCK) {
        // 沙箱：不发起网络请求，按关键字过滤模拟数据（200ms 延迟保留加载反馈）
        await new Promise((resolve) => setTimeout(resolve, 200));
        const kw = projname.toLowerCase();
        renderResults(mockData().projects.filter((p) =>
          !kw || String(p.projname || '').toLowerCase().includes(kw) || String(p.projectno || '').toLowerCase().includes(kw)), projname);
        return;
      }
      const cookie = await getCookies();
      const formData = buildFormData(projname);
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest' // ITA ajax 请求标配（抓包佐证）
        },
        body: formData,
        credentials: 'include' // 同源请求自动携带登录 Cookie，无需手动设置
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      renderResults((result.data && result.data.length > 0) ? result.data : [], projname);
    } catch (error) {
      console.error('查询失败:', error);
      resultDiv.innerHTML = `<div class="abc-project-error">错误: ${error.message || '网络请求失败'}</div>`;
    } finally {
      searchBtn.disabled = false;
    }
  };

  // 事件绑定
  // 图标可拖拽移动（拖拽时不触发点击）
  let iconDragging = false;
  let iconStartX = 0, iconStartY = 0, iconLeft = 0, iconTop = 0;

  icon.addEventListener('mousedown', (e) => {
    e.preventDefault();
    iconDragging = false;
    const rect = icon.getBoundingClientRect();
    iconStartX = e.clientX;
    iconStartY = e.clientY;
    iconLeft = rect.left;
    iconTop = rect.top;
    // 切换为 left/top 定位（原为 right/bottom）
    icon.style.left = rect.left + 'px';
    icon.style.top = rect.top + 'px';
    icon.style.right = 'auto';
    icon.style.bottom = 'auto';

    const onMove = (ev) => {
      const dx = ev.clientX - iconStartX;
      const dy = ev.clientY - iconStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        iconDragging = true;
      }
      if (iconDragging) {
        icon.style.left = Math.max(0, iconLeft + dx) + 'px';
        icon.style.top = Math.max(0, iconTop + dy) + 'px';
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  icon.addEventListener('click', () => {
    if (iconDragging) {
      return;
    }
    // 点击悬浮图标弹出工具菜单（不再直开搜索面板）
    const willShow = !menu.classList.contains('show');
    menu.classList.toggle('show', willShow);
    if (willShow) {
      setQueryOpen(false);
    }
  });

  closeBtn.addEventListener('click', () => setQueryOpen(false));
  queryMask.addEventListener('click', () => setQueryOpen(false));
  // 居中模态：Esc 直接关闭（与进度跟踪浮层一致）
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('show')) setQueryOpen(false);
  });
  // 检索快捷键：/ 聚焦项目搜索框（焦点在输入控件时不劫持）
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || !panel.classList.contains('show')) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    input.focus();
  });

  searchBtn.addEventListener('click', search);

  // 建索引：为当前结果的所有项目拉取文档列表写入本地索引（跨项目检索的数据来源）
  const indexBtn = panel.querySelector('#abc-project-index');
  indexBtn.addEventListener('click', async () => {
    const projects = window.__abcLastProjects || [];
    if (!projects.length) {
      indexBtn.textContent = '先查询项目';
      setTimeout(() => { indexBtn.textContent = '建索引'; }, 1500);
      return;
    }
    indexBtn.disabled = true;
    let done = 0;
    const queue = projects.slice();
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift();
        try {
          await indexSaveEntry(p.prjid, p, await fetchDetailFiles(p.prjid));
        } catch (err) { /* 单项目失败跳过，不阻塞其余 */ }
        done += 1;
        indexBtn.textContent = `建索引 ${done}/${projects.length}`;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    indexBtn.disabled = false;
    indexBtn.textContent = `索引完成（${projects.length}）`;
    setTimeout(() => { indexBtn.textContent = '建索引'; }, 2000);
    await renderDocMatches(input.value.trim()); // 已有关键字则刷新文档匹配区
  });

  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      search();
    }
  });

  // 文档按钮事件委托
  resultDiv.addEventListener('click', (e) => {
    // 跨项目文档检索：下载 / 跳转项目
    const dsLink = e.target.closest('.abc-docsearch-link');
    if (dsLink) {
      const m = (window.__abcDocMatches || [])[Number(dsLink.dataset.mi)];
      if (m) downloadFile(Object.assign({}, m.f));
      return;
    }
    const dsProj = e.target.closest('.abc-docsearch-proj');
    if (dsProj) {
      const btn = resultDiv.querySelector('.abc-project-doc-btn[data-prjid="' + dsProj.dataset.prjid + '"]');
      if (btn) {
        const card = btn.closest('.abc-project-card');
        if (card && !card.classList.contains('is-open')) card.querySelector('.abc-project-card-head').click();
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        showStatus('该项目不在当前结果里，请清空关键字重新查询。');
      }
      return;
    }

    // 展开/收起完整字段（台账行：行内任意位置，「项目文档」按钮除外）
    const head = e.target.closest('.abc-project-card-head');
    if (head && !e.target.closest('.abc-project-doc-btn')) {
      toggleCard(head.closest('.abc-project-card'));
      return;
    }

    // 查看/收起项目文档
    const btn = e.target.closest('.abc-project-doc-btn');
    if (btn) {
      const prjid = btn.dataset.prjid;
      loadDocs(prjid, btn);
      return;
    }

    // 单个文件下载
    const link = e.target.closest('.abc-project-doc-link');
    if (link) {
      const prjid = link.dataset.prjid;
      const index = link.dataset.file;
      const list = (window.__abcFileLists || {})[prjid];
      const file = list && list[index];
      if (file) {
        downloadFile(file);
      }
      return;
    }

    // 全量下载 → 项目工作台归档（按产生阶段分类落盘）
    const allBtn = e.target.closest('.abc-project-download-all');
    if (allBtn) {
      const prjid = allBtn.dataset.prjid;
      const list = (window.__abcFileLists || {})[prjid];
      if (list && list.length) {
        openWorkbench(prjid, list);
      }
      return;
    }

    // 项目工作台（深链：打开即已选定该项目）
    const wbBtn = e.target.closest('.abc-project-workbench');
    if (wbBtn) {
      startWorkbench(wbBtn.dataset.prjid);
      return;
    }

    // 后置合规检查（自动下载 → estimation 页检查）
    const estBtn = e.target.closest('.abc-project-estimation');
    if (estBtn) {
      startEstimationCheck(estBtn.dataset.prjid);
    }
  });

  // 行头键盘可达：Enter / 空格展开收起（仅在焦点位于行头自身时，不劫持按钮按键）
  resultDiv.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!(e.target.classList && e.target.classList.contains('abc-project-card-head'))) return;
    e.preventDefault();
    toggleCard(e.target.closest('.abc-project-card'));
  });

  // 点击外部关闭菜单与面板
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && !icon.contains(e.target)) {
      menu.classList.remove('show');
    }
    if (!panel.contains(e.target) && !icon.contains(e.target) && !menu.contains(e.target)) {
      setQueryOpen(false);
    }
  });
})();