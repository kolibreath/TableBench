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

  // ================= 下载地址配置 =================
  // 下载接口：http://ita.abc/ita/downloadFileById.action?idFile=xxx&idPsn=xxx
  const buildDownloadUrl = (file) => {
    return `http://ita.abc/ita/downloadFileById.action?idFile=${encodeURIComponent(file.idFile || '')}&idPsn=${encodeURIComponent(file.idPsn || '')}`;
  };
  // ==============================================

  // 触发单个文件下载
  const downloadFile = (file) => {
    const url = buildDownloadUrl(file);
    const filename = file.namFile || file.nmlName || 'document';
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
        window.open(chrome.runtime.getURL('workbench.html'), '_blank');
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
    window.open(chrome.runtime.getURL('workbench.html') + '?' + q.toString(), '_blank');
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
    { icon: 'el-icon-search', idx: '', name: '项目查询', desc: '搜索项目、查看/下载文档', action: 'search' },
    { icon: 'el-icon-folder-opened', idx: '01', name: '项目工作台', desc: '文档检查 + 按产生阶段归档下载', page: 'workbench.html' },
    { icon: 'el-icon-magic-stick', idx: '02', name: '规模估算书合规检查', desc: '14 条规则 + AI 双引擎（前置/后置）', page: 'estimation.html' },
    { icon: 'el-icon-data-analysis', idx: '03', name: '工时填报检查', desc: '结项前成员工时误差检查与提醒', page: 'workhours.html' },
    { icon: 'el-icon-time', idx: '04', name: '检查历史', desc: '检查记录留痕、回溯与导出', page: 'history.html' },
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
  panel.className = 'abc-project-panel';
  panel.innerHTML = `
    <div class="abc-project-panel-header">
      <span class="abc-project-panel-title">
        <span class="abc-project-panel-badge">📦</span>
        <span>项目查询</span>
      </span>
      <span class="abc-project-panel-close">✕</span>
    </div>
    <div class="abc-project-panel-body" id="abc-project-body">
      <div class="abc-project-search-row">
        <input type="text" id="abc-project-input" placeholder="请输入项目名称">
        <button class="abc-project-btn" id="abc-project-search">查询</button>
      </div>
      <div id="abc-project-result"></div>
      <button class="abc-project-totop" id="abc-project-totop" title="回到顶部">↑ 顶部</button>
    </div>
  `;

  document.documentElement.appendChild(icon);
  document.documentElement.appendChild(menu);
  document.documentElement.appendChild(panel);

  const input = panel.querySelector('#abc-project-input');
  const searchBtn = panel.querySelector('#abc-project-search');
  const resultDiv = panel.querySelector('#abc-project-result');
  const closeBtn = panel.querySelector('.abc-project-panel-close');
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
      panel.classList.add('show');
      input.focus();
      return;
    }
    if (conf.page) {
      window.open(chrome.runtime.getURL(conf.page), '_blank');
      menu.classList.remove('show');
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
        window.open(chrome.runtime.getURL('estimation.html?mode=ita'), '_blank');
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

  // 显示项目列表
  const showProjects = (data) => {
    if (!data || data.length === 0) {
      showStatus('未找到符合条件的项目');
      return;
    }

    // 缓存每个项目的完整元数据（后置合规检查需要 projectno/projname/projtype）
    window.__abcProjMap = window.__abcProjMap || {};
    window.__abcProjMeta = window.__abcProjMeta || {};
    data.forEach((item) => {
      if (!item.prjid) return;
      window.__abcProjMap[item.prjid] = item.projtype || '';
      window.__abcProjMeta[item.prjid] = item;
    });

    const html = `
      <div class="abc-project-total">共 ${data.length} 条记录</div>
      ${data.map((item, index) => `
        <div class="abc-project-card">
          <div class="abc-project-card-title">${index + 1}. ${item.projname || '未命名项目'}</div>
          <div class="abc-project-card-grid">
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
          <div class="abc-project-card-desc">
            <strong>项目描述：</strong>${item.txtDesp || '无'}
          </div>
          ${item.remark ? `
          <div class="abc-project-card-desc">
            <strong>备注：</strong>${item.remark}
          </div>
          ` : ''}
          <div class="abc-project-doc-section">
            <button class="abc-project-doc-btn" data-prjid="${item.prjid || ''}">📄 查看项目文档</button>
            <div class="abc-project-docs" id="docs-${item.prjid || 'none'}"></div>
          </div>
        </div>
      `).join('')}
    `;

    resultDiv.innerHTML = html;
  };

  // 展示文档信息（fileList）
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

    const rows = fileList.map((f, i) => `
      <div class="abc-project-doc-row">
        <div class="abc-project-doc-top">
          <span class="abc-project-doc-tag">${f.fileType || f.typSecValue || '文档'}</span>
        </div>
        <div class="abc-project-doc-name">
          <span class="abc-project-doc-icon">📄</span>
          <a class="abc-project-doc-link" data-prjid="${prjid}" data-file="${i}" href="javascript:void(0)" title="点击下载">${f.namFile || f.nmlName || '未命名文档'}</a>
        </div>
        <div class="abc-project-doc-meta">
          <span>👤 上传人：${f.userName || f.psnMng || '-'}</span>
          <span>🕒 时间：${(f.timeUpl || f.dateUpl || '-').split('.')[0]}</span>
          <span>📦 大小：${formatSize(f.fileSize)}</span>
        </div>
      </div>
    `).join('');

    docsDiv.innerHTML = `
      <div class="abc-project-docs-head">
        <div class="abc-project-docs-title">📂 项目文档（${fileList.length}）</div>
        <input type="text" class="abc-project-doc-search" placeholder="🔍 搜索文档（输入文件名关键词）">
        <button class="abc-project-workbench" data-prjid="${prjid}" title="打开项目工作台：文档检查与按产生阶段归档下载">⚙ 项目工作台</button>
        <button class="abc-project-estimation" data-prjid="${prjid}" title="自动下载该项目文档并运行规模估算书合规检查">⌁ 合规检查</button>
        <button class="abc-project-download-all" data-prjid="${prjid}" title="打开项目工作台，按产生阶段分类归档下载">⬇ 归档下载</button>
      </div>
      ${rows}
    `;

    // 文档搜索过滤
    const searchInput = docsDiv.querySelector('.abc-project-doc-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const kw = searchInput.value.trim();
        docsDiv.querySelectorAll('.abc-project-doc-row').forEach((row) => {
          const nameEl = row.querySelector('.abc-project-doc-link');
          const name = nameEl ? nameEl.textContent : '';
          const typeEl = row.querySelector('.abc-project-doc-tag');
          const type = typeEl ? typeEl.textContent : '';
          const match = !kw || name.includes(kw) || type.includes(kw);
          row.style.display = match ? '' : 'none';
        });
        // 更新显示数量
        const visible = [...docsDiv.querySelectorAll('.abc-project-doc-row')].filter(r => r.style.display !== 'none').length;
        const title = docsDiv.querySelector('.abc-project-docs-title');
        if (title) title.textContent = `📂 项目文档（${visible}/${fileList.length}）`;
      });
    }
  };

  // 加载项目文档
  const loadDocs = async (prjid, btn) => {
    const docsDiv = document.getElementById(`docs-${prjid}`);
    if (!prjid || !docsDiv) return;

    // 已加载则折叠/展开
    if (docsDiv.dataset.loaded === 'true') {
      docsDiv.style.display = docsDiv.style.display === 'none' ? 'block' : 'none';
      btn.textContent = docsDiv.style.display === 'none' ? '📄 查看项目文档' : '📄 收起项目文档';
      return;
    }

    docsDiv.innerHTML = `<div class="abc-project-docs-empty">加载中...</div>`;
    docsDiv.style.display = 'block';
    btn.disabled = true;

    try {
      const cookie = await getCookies();
      const response = await fetch(API_DETAIL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookie
        },
        body: `bizdomain=0&prjid=${encodeParam(prjid)}`,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      const detail = result && result.data && result.data[0] ? result.data[0] : null;
      const fileList = detail ? detail.fileList : [];

      docsDiv.dataset.loaded = 'true';
      showDocs(prjid, fileList);
      btn.textContent = '📄 收起项目文档';
    } catch (error) {
      console.error('加载文档失败:', error);
      docsDiv.innerHTML = `<div class="abc-project-docs-empty">加载文档失败：${error.message || '网络错误'}</div>`;
    } finally {
      btn.disabled = false;
    }
  };

  // 执行查询
  const search = async () => {
    const projname = input.value.trim();
    showStatus('查询中，请稍候...');
    searchBtn.disabled = true;

    try {
      const cookie = await getCookies();
      const formData = buildFormData(projname);
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookie
        },
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (result.data && result.data.length > 0) {
        showProjects(result.data);
      } else {
        showStatus('未找到符合条件的项目');
      }
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
      panel.classList.remove('show');
    }
  });

  closeBtn.addEventListener('click', () => {
    panel.classList.remove('show');
  });

  searchBtn.addEventListener('click', search);

  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      search();
    }
  });

  // 文档按钮事件委托
  resultDiv.addEventListener('click', (e) => {
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

  // 点击外部关闭菜单与面板
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && !icon.contains(e.target)) {
      menu.classList.remove('show');
    }
    if (!panel.contains(e.target) && !icon.contains(e.target) && !menu.contains(e.target)) {
      panel.classList.remove('show');
    }
  });
})();