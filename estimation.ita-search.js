/* estimation.ita-search.js — 「从 ITA 导入」项目选择浮层
 * ─────────────────────────────────────────────────────────
 * 交互（v3.2-⑤ on-the-fly 标准）：
 *   点击卡片上的「搜索并选择 ITA 项目」（或模式切换到 ITA 导入）→ 页面中心靠上
 *   弹出搜索浮层 → 输入 ≥2 字符自动搜索（400ms 防抖，AbortController 取消旧请求，
 *   关键字同时匹配项目名称与编号）→ 点击建议项 → 浮层内确认角色与批次 →
 *   「下载并加载到检查流程」→ 回写 Vue 根实例的 itaPayload 并调用现成的 itaLoad()。
 *
 * 实现约束：不修改 estimation.js / estimation.render.js 的逻辑——浮层为独立
 * 模块，仅通过根实例（.app-root.__vue__）回写状态与调用既有方法。
 */
(function () {
  'use strict';

  if (window.__itaSearchModule) return;
  window.__itaSearchModule = true;

  var MOCK_ON = false;
  try {
    MOCK_ON = new URLSearchParams(window.location.search).get('itaMock') === '1';
  } catch (e) { /* 非页面环境 */ }

  // ── 工具 ──
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function getVm() {
    var el = document.querySelector('.app-root');
    return el && el.__vue__ ? el.__vue__ : null;
  }
  function guessRole(name) {
    var ext = (String(name).split('.').pop() || '').toLowerCase();
    if (['xlsx', 'et'].indexOf(ext) >= 0 && /估算/i.test(name)) return 'estimation';
    if (['wps', 'wpsx', 'doc', 'docx', 'txt', 'md'].indexOf(ext) >= 0 && /需求/i.test(name)) return 'requirement';
    return 'unknown';
  }
  var ROLE_LABEL = { estimation: '估算书', requirement: '需求书', unknown: '忽略' };

  var state = {
    open: false,
    timer: null,
    abort: null,
    picked: null,   // {prjid, projname, projectno, projtype, status}
    files: [],      // [{idFile,idPsn,name,size,role,batchName}]
  };

  // ── DOM 构建（一次性） ──
  var root = null;
  function build() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'ita-osp';
    root.innerHTML =
      '<div class="ita-osp__mask"></div>' +
      '<div class="ita-osp__panel" role="dialog" aria-label="选择 ITA 项目">' +
      '  <div class="ita-osp__head"><span class="ita-osp__title">选择 ITA 项目</span>' +
      '    <span class="ita-osp__badge' + (MOCK_ON ? '' : ' ita-osp__badge--hide') + '">模拟数据</span>' +
      '    <span class="ita-osp__close" title="关闭">✕</span></div>' +
      '  <div class="ita-osp__search-row">' +
      '    <input class="ita-osp__input" type="text" placeholder="输入项目名称或编号（≥2 字符自动搜索）">' +
      '  </div>' +
      '  <div class="ita-osp__status"></div>' +
      '  <div class="ita-osp__list"></div>' +
      '  <div class="ita-osp__confirm" style="display:none">' +
      '    <div class="ita-osp__picked"></div>' +
      '    <table class="ita-table ita-osp__table"><thead><tr>' +
      '      <th>文件名</th><th style="width:96px">角色</th><th style="width:104px">批次</th>' +
      '    </tr></thead><tbody></tbody></table>' +
      '    <div class="ita-osp__actions">' +
      '      <button class="el-button el-button--primary el-button--small ita-osp__load" type="button">' +
      '        <span>下载并加载到检查流程</span></button>' +
      '      <button class="el-button el-button--small ita-osp__back" type="button"><span>返回搜索</span></button>' +
      '    </div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(root);

    root.querySelector('.ita-osp__close').addEventListener('click', close);
    root.querySelector('.ita-osp__mask').addEventListener('click', close);
    root.querySelector('.ita-osp__back').addEventListener('click', backToSearch);
    root.querySelector('.ita-osp__load').addEventListener('click', confirmLoad);

    var input = root.querySelector('.ita-osp__input');
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    return root;
  }

  // 触发器（事件委托：render 函数产出的按钮无需逐个绑定；必须在模块初始化时注册）
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.ita-launch__trigger, .ita-launch__reopen')) open();
  });

  function open() {
    build();
    state.open = true;
    state.picked = null;
    state.files = [];
    root.classList.add('show');
    root.querySelector('.ita-osp__list').innerHTML = '';
    root.querySelector('.ita-osp__confirm').style.display = 'none';
    root.querySelector('.ita-osp__status').textContent = MOCK_ON
      ? '已启用 ITA 模拟数据（?itaMock=1），无需连接内网' : '';
    var input = root.querySelector('.ita-osp__input');
    input.value = '';
    setTimeout(function () { input.focus(); }, 50);
  }

  function close() {
    state.open = false;
    if (root) root.classList.remove('show');
    if (state.abort) { try { state.abort.abort(); } catch (e) {} state.abort = null; }
  }

  function backToSearch() {
    state.picked = null;
    root.querySelector('.ita-osp__confirm').style.display = 'none';
    root.querySelector('.ita-osp__list').style.display = '';
    var input = root.querySelector('.ita-osp__input');
    input.focus();
  }

  function setStatus(msg, isErr) {
    var st = root.querySelector('.ita-osp__status');
    st.textContent = msg || '';
    st.className = 'ita-osp__status' + (isErr ? ' ita-osp__status--err' : '');
  }

  // ── on-the-fly 搜索 ──
  function onInput() {
    if (!state.open) return;
    clearTimeout(state.timer);
    var kw = root.querySelector('.ita-osp__input').value.trim();
    if (kw.length < 2) {
      root.querySelector('.ita-osp__list').innerHTML = '';
      setStatus('');
      return;
    }
    state.timer = setTimeout(function () { search(kw); }, 400);
  }

  function search(kw) {
    if (state.abort) { try { state.abort.abort(); } catch (e) {} }
    state.abort = new AbortController();
    setStatus('搜索中…');
    var body = 'bizdomain=0&projname=' + encodeURIComponent(kw) + '&projectno=&status=&projtype=&currentstage=&zhuModLvl=&applytime=&page=1&pageSize=20';
    fetch('http://ita.abc/ita/project/searchProj2022.action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
      credentials: 'include',
      signal: state.abort.signal,
    }).then(function (r) { return r.json(); }).then(function (res) {
      var list = (res && res.data) || [];
      renderList(list, kw);
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      setStatus('ITA 项目查询失败：' + (e.message || e) + (MOCK_ON ? '' : '（外网调试请加 ?itaMock=1）'), true);
    });
  }

  function renderList(list, kw) {
    var box = root.querySelector('.ita-osp__list');
    if (!list.length) {
      box.innerHTML = '<div class="ita-osp__empty">未找到与「' + esc(kw) + '」匹配的项目</div>';
      setStatus('');
      return;
    }
    setStatus('找到 ' + list.length + ' 个项目，点击选择');
    box.innerHTML = list.map(function (p) {
      return '<div class="ita-osp__item" data-prjid="' + esc(p.prjid) + '">' +
        '<div class="ita-osp__item-name">' + esc(p.projname || p.prjid) + '</div>' +
        '<div class="ita-osp__item-meta">' + esc(p.projectno || '-') + ' · ' + esc(p.projtype || '-') +
        (p.status ? ' · ' + esc(p.status) : '') + '</div></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.ita-osp__item'), function (el) {
      el.addEventListener('click', function () { pick(el.dataset.prjid); });
    });
  }

  // ── 选择项目 → 浮层内确认角色/批次 ──
  function pick(prjid) {
    setStatus('正在获取项目文档列表…');
    fetch('http://ita.abc/ita/project/searchProj.action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'bizdomain=0&prjid=' + encodeURIComponent(prjid),
      credentials: 'include',
    }).then(function (r) { return r.json(); }).then(function (res) {
      var detail = res && res.data && res.data[0] ? res.data[0] : null;
      var fileList = (detail && detail.fileList) || [];
      var proj = null;
      // 优先用搜索结果里的元数据
      var items = root.querySelectorAll('.ita-osp__item');
      state.picked = { prjid: prjid, projname: '', projectno: '', projtype: '', status: '' };
      for (var i = 0; i < fileList.length; i++) { /* noop, 保持结构清晰 */ }
      // fileList 元数据补充
      var meta = detail || {};
      state.picked.projname = meta.projname || state.picked.projname;
      state.picked.projectno = meta.projectno || '';
      state.picked.projtype = meta.projtype || '';
      state.files = fileList.map(function (f) {
        var name = f.namFile || f.nmlName || '';
        return {
          idFile: f.idFile || '',
          idPsn: f.idPsn || '',
          name: name,
          size: f.fileSize || 0,
          role: guessRole(name),
          batchName: '',
        };
      });
      // 需求书按出现顺序预填批次
      var batchNo = 0;
      state.files.forEach(function (f) {
        if (f.role === 'requirement') { batchNo += 1; f.batchName = '批次' + batchNo; }
      });
      renderConfirm();
      setStatus('已获取 ' + state.files.length + ' 个文档，请确认角色与批次');
    }).catch(function (e) {
      setStatus('获取项目文档失败：' + (e.message || e), true);
    });
  }

  function renderConfirm() {
    var tb = root.querySelector('.ita-osp__table tbody');
    tb.innerHTML = state.files.map(function (f, i) {
      return '<tr>' +
        '<td class="ita-osp__fname">' + esc(f.name) + '</td>' +
        '<td><select class="ita-select ita-osp__role" data-i="' + i + '">' +
        ['estimation', 'requirement', 'unknown'].map(function (v) {
          return '<option value="' + v + '"' + (f.role === v ? ' selected' : '') + '>' + ROLE_LABEL[v] + '</option>';
        }).join('') +
        '</select></td>' +
        '<td>' + (f.role === 'requirement'
          ? '<input class="ita-select ita-osp__batch" data-i="' + i + '" value="' + esc(f.batchName) + '">'
          : '<span class="ita-none">—</span>') + '</td>' +
        '</tr>';
    }).join('');
    Array.prototype.forEach.call(tb.querySelectorAll('.ita-osp__role'), function (sel) {
      sel.addEventListener('change', function () {
        state.files[Number(sel.dataset.i)].role = sel.value;
        renderConfirm();
      });
    });
    Array.prototype.forEach.call(tb.querySelectorAll('.ita-osp__batch'), function (inp) {
      inp.addEventListener('input', function () {
        state.files[Number(inp.dataset.i)].batchName = inp.value;
      });
    });
    root.querySelector('.ita-osp__picked').textContent =
      '已选：' + (state.picked.projname || state.picked.prjid) +
      (state.picked.projectno ? '（' + state.picked.projectno + '）' : '');
    root.querySelector('.ita-osp__list').style.display = 'none';
    root.querySelector('.ita-osp__confirm').style.display = '';
  }

  // ── 确认：回写 Vue 状态并调用既有 itaLoad() ──
  function confirmLoad() {
    var vm = getVm();
    if (!vm) { setStatus('无法连接检查页面状态，请刷新页面重试', true); return; }
    var est = state.files.filter(function (f) { return f.role === 'estimation'; });
    if (est.length === 0) { setStatus('未识别到规模估算书（.xlsx/.et 且文件名含"估算"），请调整角色', true); return; }
    if (est.length > 1) { setStatus('识别到多份估算书，请仅保留一份角色为"估算书"', true); return; }
    vm.itaPayload = {
      prjid: state.picked.prjid || '',
      projectno: state.picked.projectno || '',
      projname: state.picked.projname || '',
      projtype: state.picked.projtype || '',
      files: state.files.map(function (f) {
        return { idFile: f.idFile, idPsn: f.idPsn, name: f.name, size: f.size, role: f.role, batchName: f.batchName };
      }),
    };
    if (typeof vm.itaPrepareBatches === 'function') vm.itaPrepareBatches();
    close();
    vm.itaLoad();
  }
})();
