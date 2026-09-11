// 项目工作台页面脚本（V3.0：合并项目自查 + 项目入库）
// 流程：搜索 ITA 项目 → 选定项目 → 文件台账（一次搜索，两类动作）
//      ① 检查勾选文档：带 Cookie 下载 → /api/check_upload → 行内状态与明细 → 检查历史 + 数据收集
//      ② 归档下载勾选文件：按《武研项目文档入库清单》匹配产生阶段 → showDirectoryPicker 建文件夹落盘

const itaApi = {
  search: 'http://ita.abc/ita/project/searchProj2022.action',
  detail: 'http://ita.abc/ita/project/searchProj.action',
  download: (f) => `http://ita.abc/ita/downloadFileById.action?idFile=${encodeURIComponent(f.idFile || '')}&idPsn=${encodeURIComponent(f.idPsn || '')}`,
};

// 文档类型识别（与原项目自查一致）
const DOC_TARGETS = ['业务需求说明书', '工作产品清单', '系统设计说明书'];
const DOC_EXT = /\.(wps|wpsx|doc|docx|et|xls|xlsx)$/i;

function guessDocRole(name) {
  const n = (name || '').replace(/\s+/g, '');
  for (const t of DOC_TARGETS) {
    if (n.includes(t.replace(/\s+/g, ''))) return t;
  }
  if (n.includes('业务需求')) return '业务需求说明书';
  if (n.includes('工作产品')) return '工作产品清单';
  if (n.includes('系统设计')) return '系统设计说明书';
  return '未知';
}

// ── 分类匹配逻辑（沿用项目入库） ────────────────────────

function longestCommonSubstring(a, b) {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > max) max = k;
    }
  }
  return max;
}

function matchInfo(a, b) {
  a = (a || '').replace(/\s+/g, '');
  b = (b || '').replace(/\s+/g, '');
  if (!a || !b) return { dice: 0, sub: 0 };
  if (a === b) return { dice: 1, sub: a.length };
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  setA.forEach((c) => { if (setB.has(c)) inter++; });
  const dice = (a.length + b.length) ? 2 * inter / (a.length + b.length) : 0;
  const sub = longestCommonSubstring(a, b);
  return { dice, sub };
}

// 根据 projtype 匹配《武研项目文档入库清单》对应 sheet
function findSheetByProjtype(sheets, projtype) {
  if (!projtype) return null;
  const pt = projtype.toLowerCase();
  const priority = [
    ['RPA项目', ['rpa']],
    ['一般应用类（敏捷研发模式）', ['敏捷']],
    ['快捷类', ['快捷']],
    ['推广支持类', ['推广']],
    ['工程实施类', ['工程实施', '实施']],
    ['科技研究类', ['科技研究', '研究']],
    ['一般应用类（常规研发模式）', ['一般应用', '应用研发']],
  ];
  for (const [name, kws] of priority) {
    for (const kw of kws) {
      if (pt.includes(kw)) {
        const s = sheets.find((x) => x.name === name);
        if (s) return s;
      }
    }
  }
  return null;
}

// 工作产品文字匹配产生阶段（Dice 相似度 ≥ 60% 归类；否则进「其他」并给出推荐）
function classifyFile(fileType, stages) {
  if (!fileType || !stages) return { stage: '其他', product: '-', score: '-', recommend: false };
  const ft = fileType.replace(/\s+/g, '');
  let bestStage = '其他';
  let bestProduct = '-';
  let bestScore = 0;
  let topStage = null;
  let topProduct = '-';
  let topScore = 0;
  for (const [stage, products] of Object.entries(stages)) {
    for (const p of products) {
      const { dice } = matchInfo(ft, p);
      if (dice > topScore) {
        topScore = dice;
        topProduct = p;
        topStage = stage;
      }
      if (dice >= 0.60 && dice > bestScore) {
        bestScore = dice;
        bestStage = stage;
        bestProduct = p;
      }
    }
  }
  if (bestStage !== '其他') {
    return { stage: bestStage, product: bestProduct, score: Math.round(bestScore * 100) + '%', recommend: false };
  }
  if (topScore > 0) {
    return {
      stage: '其他',
      product: topProduct,
      score: Math.round(topScore * 100) + '%',
      recommend: true,
      recommendStage: topStage || null,
    };
  }
  return { stage: '其他', product: '-', score: '-', recommend: false };
}

// 重名保存：同一文件夹内加上传时间区分，避免覆盖
function buildSaveName(name, uploadTime, usedNames) {
  const safeBase = String(name || 'document').replace(/[\\/:*?"<>|]/g, '_');
  if (!usedNames.has(safeBase)) {
    usedNames.add(safeBase);
    return safeBase;
  }
  const dot = safeBase.lastIndexOf('.');
  const ext = dot >= 0 ? safeBase.slice(dot) : '';
  const stem = dot >= 0 ? safeBase.slice(0, dot) : safeBase;
  const time = String(uploadTime || '').replace(/[: ]/g, '-');
  let candidate = time ? `${stem}_${time}${ext}` : `${stem}_${Date.now()}${ext}`;
  let n = 2;
  while (usedNames.has(candidate)) {
    candidate = `${stem}_${time || n}_${n}${ext}`;
    n++;
  }
  usedNames.add(candidate);
  return candidate;
}

// 自动获取 ita.abc 的 cookie（经 background）
const getCookies = () => {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_COOKIES' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve('');
          return;
        }
        resolve(response && response.ok ? response.cookie : '');
      });
    } catch (e) {
      resolve('');
    }
  });
};

// ==============================================

document.addEventListener('DOMContentLoaded', () => {
  const svcPill = document.getElementById('svcPill');
  const svcDot = document.getElementById('svcDot');
  const svcText = document.getElementById('svcText');
  const projInput = document.getElementById('projInput');
  const searchBtn = document.getElementById('searchBtn');
  const checkBtn = document.getElementById('checkBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const previewBtn = document.getElementById('previewBtn');
  const previewBox = document.getElementById('previewBox');
  const projInfo = document.getElementById('projInfo');
  const projList = document.getElementById('projList');
  const projRows = document.getElementById('projRows');
  const tabsLeft = document.getElementById('tabsLeft');
  const fileSearchInput = document.getElementById('fileSearchInput');
  const fileSearchBtn = document.getElementById('fileSearchBtn');
  const checkAllBox = document.getElementById('checkAll');
  const fileTable = document.getElementById('fileTable');
  const statusLine = document.getElementById('statusLine');
  const resultArea = document.getElementById('resultArea');
  const typeBar = document.getElementById('typeBar');
  const typeSelect = document.getElementById('typeSelect');
  const typeBasis = document.getElementById('typeBasis');
  const reqArchiveBtn = document.getElementById('reqArchiveBtn');
  const methodBtn = document.getElementById('methodBtn');
  const drawerMask = document.getElementById('drawerMask');
  const methodDrawer = document.getElementById('methodDrawer');
  const drawerBody = document.getElementById('drawerBody');
  const drawerFoot = document.getElementById('drawerFoot');

  // 后端地址（默认 127.0.0.1:8765，可配置）
  let SERVICE = 'http://127.0.0.1:8765';
  try {
    chrome.storage.local.get(['fcBackendUrl'], (r) => {
      if (r.fcBackendUrl) SERVICE = r.fcBackendUrl;
      checkHealth();
    });
  } catch (e) { checkHealth(); }

  // ── 状态 ──
  let currentProject = null;   // { prjid, projectno, projname, projtype }
  let files = [];              // [{ idFile, idPsn, name, size, uploadTime, role, checked }]
  let planMap = [];            // 与 files 平行：{ fileType, product, score, stage, recommend, recommendStage }
  let checkState = [];         // 与 files 平行：null | { status, failCount, results?, error? }
  let currentSheet = null;     // 当前项目类型对应的入库清单 sheet（类型确认栏可切换）
  let sheets = [];
  let allFolders = ['其他'];
  let currentFilter = 'all';
  let searchKeyword = '';
  let busy = false;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const setStatus = (msg, isError) => {
    statusLine.style.display = 'block';
    statusLine.textContent = msg;
    statusLine.className = 'status-line' + (isError ? ' error' : '');
  };

  // ── 后端探活与唤起 ──
  const triggerProtocol = () => {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = 'projecttool://start';
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 1000);
      return true;
    } catch (e) { return false; }
  };

  const tryStartBackend = () => new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage('com.projecttool.startbackend', { action: 'start' }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(triggerProtocol());
          return;
        }
        resolve(!!(resp && resp.ok) || triggerProtocol());
      });
    } catch (e) {
      resolve(triggerProtocol());
    }
  });

  let askedStart = false;
  // 函数声明（非 const 箭头函数）：storage.get 回调可能在声明行之前同步触发
  async function checkHealth() {
    for (let i = 0; i < 5; i++) {
      try {
        const resp = await fetch(SERVICE + '/health');
        const data = await resp.json();
        if (data && data.ok) {
          const engine = data.docEngine || '';
          svcText.textContent = '服务已连接' + (engine ? `（引擎：${engine === 'wps_com' ? 'WPS COM' : '纯Python'}）` : '');
          svcDot.className = 'dot online';
          svcPill.className = 'pg-pill';
          return true;
        }
      } catch (e) {
        if (i === 0 && !askedStart) {
          askedStart = true;
          const ok = window.confirm('本地后端未启动，是否启动后端程序？\n（首次使用请先运行「安装后端.bat」完成注册）');
          if (ok) {
            const started = await tryStartBackend();
            if (!started) setStatus('无法自动唤起后端，请运行「安装后端.bat」注册，或双击「项目管理工具后端.exe」启动。', true);
          }
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    svcText.textContent = '服务未启动';
    svcDot.className = 'dot offline';
    svcPill.className = 'pg-pill';
    return false;
  };
  checkHealth();

  const loadClassification = () => {
    return new Promise((resolve) => {
      fetch(chrome.runtime.getURL('classification.json'))
        .then((r) => r.json())
        .then((d) => resolve(d.sheets || []))
        .catch(() => resolve([]));
    });
  };

  // ── 自查方法抽屉（数据：selfcheck-method.json，版本 202609） ──
  const openMethodDrawer = async () => {
    methodDrawer.classList.add('show');
    drawerMask.classList.add('show');
    if (drawerBody.dataset.loaded) return;
    try {
      const d = await (await fetch(chrome.runtime.getURL('selfcheck-method.json'))).json();
      document.getElementById('drawerVer').textContent = d.version || '202609';
      const secHtml = (d.sections || []).map((s) => `
        <div class="drawer-section">
          <h4><span class="sec-no">${s.no}</span>检查项 ${s.no}：${esc(s.target)}</h4>
          <table class="method-table">
            <thead><tr><th style="width:64px">操作</th><th>检查要点（含判定依据）</th></tr></thead>
            <tbody>${s.ops.map((o) => `<tr><td class="op">${esc(o.op)}</td><td class="pt">${esc(o.point)}</td></tr>`).join('')}</tbody>
          </table>
          <details class="drawer-examples">
            <summary>常见问题举例（${(s.examples || []).length}）</summary>
            <ul>${(s.examples || []).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
          </details>
        </div>`).join('');
      const ck = d.checklist || {};
      const ckHtml = `
        <div class="drawer-checklist">
          <h4>${esc(ck.title || '自查要点速查清单')}</h4>
          ${(ck.groups || []).map((g) => `
            <div class="ck-group"><b>${esc(g.name)}</b>
              <ul>${(g.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
            </div>`).join('')}
        </div>`;
      drawerBody.innerHTML =
        `<div class="drawer-intro">${esc(d.intro || '')}</div>` + secHtml + ckHtml;
      drawerFoot.textContent = '来源：' + (d.source || '');
      drawerBody.dataset.loaded = '1';
    } catch (e) {
      drawerBody.innerHTML = '<div class="drawer-intro">自查方法数据加载失败：' + esc(e.message || e) + '</div>';
    }
  };
  const closeMethodDrawer = () => {
    methodDrawer.classList.remove('show');
    drawerMask.classList.remove('show');
  };
  methodBtn.addEventListener('click', openMethodDrawer);
  document.getElementById('drawerClose').addEventListener('click', closeMethodDrawer);
  drawerMask.addEventListener('click', closeMethodDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMethodDrawer(); });

  // ── ITA 项目搜索 ──
  searchBtn.addEventListener('click', async () => {
    const projname = (projInput.value || '').trim();
    if (!projname) { setStatus('请输入项目名称。', true); return; }
    setStatus('正在查询 ITA 项目…', false);
    searchBtn.disabled = true;
    try {
      // ⚠ 该接口参数形状未经抓包验证；pageSize 与 content.js 项目查询统一为 100
      const body = `bizdomain=0&projname=${encodeURIComponent(projname)}&projectno=&status=&projtype=&currentstage=&zhuModLvl=&applytime=&page=1&pageSize=100`;
      const resp = await fetch(itaApi.search, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest' // ITA ajax 请求标配（抓包佐证）
        },
        body,
        credentials: 'include',
      });
      const result = await resp.json();
      const data = (result && result.data) || [];
      if (!data.length) {
        setStatus('未找到符合条件的 ITA 项目。', true);
        projList.style.display = 'none';
        return;
      }
      projRows.innerHTML = data.map((p) => `
        <div class="proj-item" data-prjid="${esc(p.prjid)}">
          <span><b>${esc(p.projname || '未命名项目')}</b>
            <span class="sub">（编号 ${esc(p.projectno || '-')} ｜ ${esc(p.projtype || '-')} ｜ 经理 ${esc(p.projMan || '-')}）</span>
          </span>
        </div>`).join('');
      projList.style.display = 'block';
      projRows.querySelectorAll('.proj-item').forEach((el) => {
        el.addEventListener('click', () => pickProject(el.dataset.prjid, data));
      });
      setStatus(`查询到 ${data.length} 个项目，请点击选择。`, false);
    } catch (e) {
      setStatus('ITA 项目查询失败：' + (e.message || '网络错误'), true);
    } finally {
      searchBtn.disabled = false;
    }
  });
  projInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') searchBtn.click(); });

  // ── 选定项目 → 拉取文档并建立台账 ──
  const applyProject = (proj, rawFiles) => {
    currentProject = {
      prjid: proj.prjid || '',
      projectno: proj.projectno || '',
      projname: proj.projname || '',
      projtype: proj.projtype || '',
    };
    files = (rawFiles || [])
      .filter((f) => DOC_EXT.test(f.namFile || f.nmlName || ''))
      .map((f) => {
        const name = f.namFile || f.nmlName || '';
        const role = guessDocRole(name);
        return {
          idFile: f.idFile || '',
          idPsn: f.idPsn || '',
          name,
          size: f.fileSize || 0,
          uploadTime: String(f.timeUpl || f.dateUpl || '-').split('.')[0],
          fileType: f.fileType || f.typSecValue || '-',
          role,
          checked: role !== '未知',
        };
      });

    // 分类：按项目类型选 sheet，预计算每个文件的归档阶段
    const sheet = findSheetByProjtype(sheets, currentProject.projtype);
    applyClassification(sheet);

    checkState = files.map(() => null);
    currentFilter = 'all';
    searchKeyword = '';

    projList.style.display = 'none';
    projInfo.innerHTML = `已选：<b>${esc(currentProject.projname)}</b>（${esc(currentProject.projectno || '-')}）`;

    renderTypeBar(sheet);
    renderTabs();
    renderTable();
    const identifiable = files.filter((f) => f.checked && isCheckTarget(f)).length;
    setStatus(`获取到 ${files.length} 个文档；可检查对象（业务需求说明书 / 工作产品清单 / 系统设计说明书）${identifiable} 份，已默认勾选。`, false);
    refreshButtons();
  };

  // 检查对象限定：仅规范约定的 3 份文档有检查依据（附件2《项目文档自查方法》）
  const isCheckTarget = (f) => DOC_TARGETS.includes(f.role);

  // 按项目类型 sheet 重建分类（阶段 tab / 归档阶段 / 推荐标记）
  const applyClassification = (sheet) => {
    currentSheet = sheet || null;
    allFolders = sheet ? [...Object.keys(sheet.stages), '其他'] : ['其他'];
    planMap = files.map((f) => {
      const fileType = f.fileType || '-';
      const cls = sheet ? classifyFile(fileType, sheet.stages) : { stage: '其他', product: '-', score: '-', recommend: false };
      return { fileType, ...cls };
    });
    currentFilter = 'all';
  };

  // ── 项目类型确认栏（自动识别预选，准确性由用户核对） ──
  const renderTypeBar = (sheet) => {
    typeBar.classList.add('show');
    typeSelect.innerHTML = '<option value="">— 请选择项目类型 —</option>' +
      sheets.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
    typeSelect.value = sheet ? sheet.name : '';
    typeBasis.textContent = currentProject && currentProject.projtype
      ? `ITA 类型「${currentProject.projtype}」自动匹配${sheet ? '成功' : '失败，请手动选择'}`
      : 'ITA 未返回项目类型，请手动选择';
  };

  typeSelect.addEventListener('change', () => {
    if (!currentProject) return;
    const sheet = sheets.find((s) => s.name === typeSelect.value) || null;
    applyClassification(sheet);
    renderTabs();
    renderTable();
    refreshButtons();
    setStatus(sheet
      ? `已按「${sheet.name}」重新分类，请核对各文件的归档阶段。`
      : '未选择项目类型，全部文件归入「其他」。', false);
  });

  // ── 一键勾选推荐入库（《武研项目文档入库清单 v1.4》要求入库档位） ──
  const matchProduct = (f, product) => {
    const n = (f.name || '').replace(/\s+/g, '');
    const p = product.replace(/\s+/g, '');
    if (n.includes(p) || p.includes(n)) return true;
    // 「推广方案或业务需求说明书」类组合名：任一子项命中即算
    if (p.includes('或')) {
      return p.split('或').some((alt) => alt && n.includes(alt));
    }
    return matchInfo(n, p).dice >= 0.55;
  };

  reqArchiveBtn.addEventListener('click', () => {
    if (!currentProject || !currentSheet || !currentSheet.requiredArchive) {
      setStatus('请先选择项目类型（推荐入库清单按项目类型区分）。', true);
      return;
    }
    const { always = [], ifAny = [] } = currentSheet.requiredArchive;
    const picked = [];
    const hit = (product) => {
      const matched = files.filter((f) => matchProduct(f, product));
      // 「如有」档位：存在即勾；多份（如 part1/part2 系列）全勾
      matched.forEach((f) => { f.checked = true; });
      if (matched.length) picked.push(product);
      return matched.length;
    };
    always.forEach(hit);
    ifAny.forEach(hit);
    const missing = [...always, ...ifAny].filter((p) => !picked.includes(p));
    renderTable();
    refreshButtons();
    const reqNote = missing.length
      ? `；未在 ITA 找到的要求入库文档：${missing.join('、')}`
      : '；要求入库文档均已找到并勾选';
    setStatus(`推荐入库：已勾选 ${picked.length} 类要求入库文档（${picked.join('、') || '无'}）${reqNote}。可在归档预览中复核。`, !!missing.length);
  });

  const pickProject = async (prjid, projects) => {
    const proj = projects.find((x) => String(x.prjid) === String(prjid));
    if (!proj) return;
    setStatus('正在获取项目文档列表…', false);
    try {
      const resp = await fetch(itaApi.detail, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `bizdomain=0&prjid=${encodeURIComponent(prjid)}`,
        credentials: 'include',
      });
      const result = await resp.json();
      const detail = result && result.data && result.data[0] ? result.data[0] : null;
      applyProject(proj, (detail && detail.fileList) || []);
    } catch (e) {
      setStatus('获取项目文档失败：' + (e.message || '网络错误'), true);
    }
  };

  // 深链 / storage 移交：跳过搜索直接落台账
  const tryRestoreContext = async () => {
    sheets = await loadClassification();
    const q = new URLSearchParams(location.search);
    if (q.get('prjid')) {
      applyProject({
        prjid: q.get('prjid') || '',
        projname: q.get('projname') || '',
        projectno: q.get('projectno') || '',
        projtype: q.get('projtype') || '',
      }, []);
      setStatus('正在获取项目文档列表…', false);
      try {
        const resp = await fetch(itaApi.detail, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `bizdomain=0&prjid=${encodeURIComponent(q.get('prjid'))}`,
          credentials: 'include',
        });
        const result = await resp.json();
        const detail = result && result.data && result.data[0] ? result.data[0] : null;
        applyProject(currentProject, (detail && detail.fileList) || []);
      } catch (e) {
        setStatus('获取项目文档失败：' + (e.message || '网络错误'), true);
      }
      return;
    }
    try {
      chrome.storage.local.get(['fcPendingWorkbench'], async (r) => {
        const p = r.fcPendingWorkbench;
        if (p && p.prjid && Array.isArray(p.files)) {
          chrome.storage.local.remove(['fcPendingWorkbench']);
          applyProject(p, p.files);
        }
      });
    } catch (e) { /* 忽略 */ }
  };

  // ── 台账渲染 ──
  const renderTabs = () => {
    tabsLeft.innerHTML = '';
    const addTab = (label, filter) => {
      const b = document.createElement('button');
      b.className = 'tab' + (filter === currentFilter ? ' active' : '');
      b.dataset.filter = filter;
      b.textContent = label;
      b.addEventListener('click', () => {
        currentFilter = filter;
        tabsLeft.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        b.classList.add('active');
        renderTable();
      });
      tabsLeft.appendChild(b);
    };
    addTab('全部', 'all');
    allFolders.forEach((f) => addTab(f, f));
  };

  const checkBadge = (st) => {
    if (!st || st.status === 'idle') return '<span class="check-badge idle">—</span>';
    if (st.status === 'running') return '<span class="check-badge running">检查中…</span>';
    if (st.status === 'pass') return '<span class="check-badge pass">✓ 通过</span>';
    if (st.status === 'skip') return '<span class="check-badge idle">跳过</span>';
    if (st.status === 'error') return `<span class="check-badge error" title="${esc(st.error || '')}">失败</span>`;
    return `<span class="check-badge fail">✗ 不通过 ${st.failCount} 项</span>`;
  };

  const renderTable = () => {
    if (!currentProject) {
      fileTable.innerHTML = '<div class="list-empty">① 请先查询并选择 ITA 项目，文件台账将在此呈现</div>';
      return;
    }
    const rows = [];
    let count = 0;
    files.forEach((f, i) => {
      const plan = planMap[i] || {};
      if (currentFilter !== 'all' && plan.stage !== currentFilter) return;
      if (searchKeyword) {
        if (!f.name.includes(searchKeyword) && !(plan.fileType || '').includes(searchKeyword)) return;
      }
      count++;
      const rec = plan.recommend && plan.recommendStage
        ? `<span class="rec-badge" data-rec="${i}" title="一键归入推荐文件夹">推荐:${esc(plan.recommendStage)}</span>`
        : '';
      const roleCls = f.role === '未知' ? 'role-tag unknown' : 'role-tag';
      // 检查能力分级：仅规范约定的 3 份检查对象可发起检查，其余文档只参与归档
      const checkable = isCheckTarget(f);
      const checkCell = checkable
        ? `<button class="btn-mini btn-one-check" data-index="${i}" ${busy ? 'disabled' : ''} title="下载并检查该文档">检查</button>`
        : '<span class="no-check" title="自查方法（附件2）仅覆盖业务需求说明书 / 工作产品清单 / 系统设计说明书">— 无检查依据</span>';
      rows.push(`
        <div class="file-row" data-index="${i}">
          <span><input type="checkbox" class="row-cb" data-index="${i}" ${f.checked ? 'checked' : ''}></span>
          <span class="col-name">${esc(f.name)}<span class="up-time">${esc(f.uploadTime || '-')}</span></span>
          <span class="col-role"><span class="${roleCls}">${esc(f.role)}</span></span>
          <span class="col-product">${esc(plan.product || '-')}${rec}</span>
          <span class="col-stage" data-stage="${i}" title="点击调整归档文件夹">${esc(plan.stage || '其他')}</span>
          <span class="col-check">${checkable ? checkBadge(checkState[i]) : '<span class="check-badge idle">—</span>'}</span>
          <span>${checkCell}</span>
        </div>
        <div class="detail-row" data-detail="${i}">${renderCheckDetail(checkState[i])}</div>`);
    });
    fileTable.innerHTML = count
      ? rows.join('')
      : '<div class="list-empty">没有符合条件的文件</div>';

    // 行内事件
    fileTable.querySelectorAll('.row-cb').forEach((cb) => {
      cb.addEventListener('change', () => {
        files[Number(cb.dataset.index)].checked = cb.checked;
        refreshButtons();
      });
    });
    fileTable.querySelectorAll('.rec-badge').forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.rec);
        if (planMap[i] && planMap[i].recommendStage) {
          planMap[i].stage = planMap[i].recommendStage;
          planMap[i].recommend = false;
          renderTable();
        }
      });
    });
    fileTable.querySelectorAll('.col-stage').forEach((cell) => {
      cell.addEventListener('click', () => openStageSelect(Number(cell.dataset.stage), cell));
    });
    fileTable.querySelectorAll('.btn-one-check').forEach((b) => {
      b.addEventListener('click', () => runCheck([files[Number(b.dataset.index)]]));
    });
    fileTable.querySelectorAll('.check-badge.fail').forEach((b) => {
      b.addEventListener('click', () => {
        const row = b.closest('.file-row');
        const detail = fileTable.querySelector(`.detail-row[data-detail="${row.dataset.index}"]`);
        if (detail) detail.classList.toggle('open');
      });
    });
  };

  const renderCheckDetail = (st) => {
    if (!st || !st.results || !st.results.length) return '';
    return st.results.map((r) => {
      const cls = r.status === '通过' ? 'pass' : (r.status === '不通过' ? 'fail' : 'skip');
      return `<div class="result-item">
          <span class="rb ${cls}">${esc(r.status)}</span>
          <span class="ri-body"><b>${esc(r.op)}</b> ${esc(r.detail || '')}
            ${r.example ? `<span class="example">依据：${esc(r.example)}</span>` : ''}
          </span>
        </div>`;
    }).join('');
  };

  const openStageSelect = (i, cell) => {
    if (cell.querySelector('select')) return;
    const select = document.createElement('select');
    select.className = 'move-select';
    allFolders.forEach((f) => {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      select.appendChild(o);
    });
    select.value = (planMap[i] && planMap[i].stage) || '其他';
    select.onchange = () => {
      planMap[i].stage = select.value;
      renderTable();
    };
    select.onblur = () => renderTable();
    cell.innerHTML = '';
    cell.appendChild(select);
    select.focus();
  };

  const refreshButtons = () => {
    const anyChecked = files.some((f) => f.checked);
    const checkTargetChecked = files.some((f) => f.checked && isCheckTarget(f));
    checkBtn.disabled = busy || !checkTargetChecked;
    checkBtn.title = checkTargetChecked ? '' : '请勾选业务需求说明书 / 工作产品清单 / 系统设计说明书';
    downloadBtn.disabled = busy || !anyChecked;
    previewBtn.disabled = !files.length;
    reqArchiveBtn.disabled = busy || !currentProject;
    checkAllBox.checked = files.length > 0 && files.every((f) => f.checked);
  };

  // 全选/全不选（仅当前过滤视图中可见的行？——按全量处理，保持直觉）
  checkAllBox.addEventListener('change', () => {
    files.forEach((f) => { f.checked = checkAllBox.checked; });
    renderTable();
    refreshButtons();
  });

  // 文件搜索
  const doFileSearch = () => {
    searchKeyword = (fileSearchInput.value || '').trim();
    renderTable();
  };
  fileSearchBtn.addEventListener('click', doFileSearch);
  fileSearchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') doFileSearch(); });

  // 归档预览（勾选优先，未勾选则全部）
  previewBtn.addEventListener('click', () => {
    if (!previewBox.classList.contains('show')) {
      const target = files.filter((f) => f.checked);
      const list = target.length ? target : files;
      const groups = {};
      list.forEach((f) => {
        const stage = (planMap[files.indexOf(f)] && planMap[files.indexOf(f)].stage) || '其他';
        (groups[stage] = groups[stage] || []).push(f.name);
      });
      previewBox.innerHTML = Object.keys(groups).map((stage) => `
        <h5>📁 ${esc(stage)}（${groups[stage].length}）</h5>
        ${groups[stage].map((n) => `<div class="pf">${esc(n)}</div>`).join('')}
      `).join('');
    }
    previewBox.classList.toggle('show');
  });
  document.addEventListener('click', (e) => {
    if (!previewBox.contains(e.target) && e.target !== previewBtn && !previewBtn.contains(e.target)) {
      previewBox.classList.remove('show');
    }
  });

  // ── 动作 ①：检查勾选文档 ──
  const downloadAsBase64 = async (f) => {
    const resp = await fetch(itaApi.download(f), { credentials: 'include' });
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('ITA 登录已失效，请刷新 ita.abc 页面重新登录后重试');
    }
    if (!resp.ok) throw new Error('下载失败 HTTP ' + resp.status + '：' + f.name);
    const blob = await resp.blob();
    const buf = await blob.arrayBuffer();
    let binary = '';
    const u8 = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return { name: f.name, data: btoa(binary), size: u8.length };
  };

  const runCheck = async (targets) => {
    if (busy) return;
    // 检查范围收敛：仅 3 份检查对象有检查依据（附件2），其余文档只参与归档
    targets = targets.filter((f) => isCheckTarget(f));
    if (!targets.length) {
      setStatus('请先勾选可检查的文档：业务需求说明书 / 工作产品清单 / 系统设计说明书。', true);
      return;
    }
    if (!currentProject) return;
    busy = true;
    refreshButtons();
    renderTable();
    const t0 = Date.now();
    const idxSet = new Set(targets.map((t) => files.indexOf(t)));
    idxSet.forEach((i) => { checkState[i] = { status: 'running' }; });
    renderTable();
    setStatus(`正在下载并检查 ${targets.length} 份文档…`, false);
    try {
      const payload = [];
      for (let i = 0; i < targets.length; i++) {
        setStatus(`正在下载 (${i + 1}/${targets.length})：${targets[i].name}`, false);
        payload.push(await downloadAsBase64(targets[i]));
      }
      setStatus('文档下载完成，正在调用本地后端检查…', false);
      const resp = await fetch(SERVICE + '/api/check_upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: payload.map((p) => ({ name: p.name, data: p.data })) }),
      });
      const r = await resp.json();
      if (r.error) { setStatus('检查失败：' + r.error, true); idxSet.forEach((i) => { checkState[i] = { status: 'error', error: r.error }; }); renderTable(); return; }

      // 按文件名回填行内状态
      const docs = r.documents || [];
      let failTotal = 0;
      let checkTotal = 0;
      idxSet.forEach((i) => {
        const doc = docs.find((d) => d.name === files[i].name);
        if (!doc) { checkState[i] = { status: 'skip' }; return; }
        if (doc.error) { checkState[i] = { status: 'error', error: doc.error }; return; }
        const results = doc.results || [];
        const fail = results.filter((x) => x.status === '不通过').length;
        checkState[i] = { status: fail ? 'fail' : 'pass', failCount: fail, results };
        failTotal += fail;
        checkTotal += results.length;
      });
      renderTable();
      setStatus(`检查完成：${docs.length} 份文档、${checkTotal} 个检查项，不通过 ${failTotal} 项（点击红色状态可展开明细）。`, !!failTotal);

      // ── 写入检查历史 + 数据收集 ──
      const record = {
        type: 'doc_check',
        source: 'ita',
        project: currentProject,
        files: payload.map((p) => ({ name: p.name, role: guessDocRole(p.name), size: p.size })),
        summary: { docs: docs.length, checks: checkTotal, fail: failTotal },
        detail: { documents: docs },
        durationSec: Math.round((Date.now() - t0) / 100) / 10,
      };
      if (typeof HistoryStore !== 'undefined') {
        HistoryStore.save(record).catch(() => {});
      }
      if (typeof reportCollect !== 'undefined') {
        reportCollect({
          time: new Date().toISOString(),
          meta: { ua: navigator.userAgent, trigger: 'ita', checkType: 'doc_check' },
          project: currentProject,
          run: {},
          stats: { docs: docs.length, checks: checkTotal, fail: failTotal },
        });
      }
    } catch (e) {
      idxSet.forEach((i) => { checkState[i] = { status: 'error', error: e.message || String(e) }; });
      renderTable();
      setStatus('检查失败：' + (e.message || '无法连接后端服务。请运行「安装后端.bat」或双击「项目管理工具后端.exe」启动。'), true);
      checkHealth();
    } finally {
      busy = false;
      refreshButtons();
    }
  };

  checkBtn.addEventListener('click', () => runCheck(files.filter((f) => f.checked && isCheckTarget(f))));

  // ── 动作 ②：归档下载勾选文件 ──
  downloadBtn.addEventListener('click', async () => {
    if (busy) return;
    const targets = files.filter((f) => f.checked);
    if (!targets.length) { setStatus('请先勾选要归档的文件。', true); return; }

    let dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
      setStatus('未选择文件夹，归档已取消。');
      return;
    }

    busy = true;
    refreshButtons();
    const cookie = await getCookies();
    let successCount = 0;
    let failCount = 0;
    const usedByFolder = {};

    for (let i = 0; i < targets.length; i++) {
      const f = targets[i];
      const idx = files.indexOf(f);
      const stage = (planMap[idx] && planMap[idx].stage) || '其他';
      setStatus(`正在归档 (${i + 1}/${targets.length})：${f.name} → ${stage}`, false);
      try {
        const resp = await fetch(itaApi.download(f), {
          method: 'GET',
          headers: { 'Cookie': cookie },
          credentials: 'include',
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const blob = await resp.blob();
        const folderHandle = await dirHandle.getDirectoryHandle(stage, { create: true });
        if (!usedByFolder[stage]) usedByFolder[stage] = new Set();
        const saveName = buildSaveName(f.name, f.uploadTime, usedByFolder[stage]);
        const fileHandle = await folderHandle.getFileHandle(saveName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        successCount++;
      } catch (e) {
        console.error('归档下载失败:', e);
        failCount++;
      }
    }

    busy = false;
    refreshButtons();
    setStatus(`归档完成：成功 ${successCount} 个，失败 ${failCount} 个。文件已按产生阶段分类存放。`, failCount > 0);
  });

  // ── 启动：恢复深链/移交上下文 ──
  tryRestoreContext();
});
