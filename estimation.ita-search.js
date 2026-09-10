/* estimation.ita-search.js — 「从 ITA 导入」项目选择浮层
 * ─────────────────────────────────────────────────────────
 * 交互（v3.2-⑤ on-the-fly 标准）：
 *   点击卡片上的「搜索并选择 ITA 项目」→ 页面中心靠上弹出搜索浮层 →
 *   输入 ≥2 字符自动搜索（400ms 防抖，AbortController 取消旧请求，名称/编号双匹配）→
 *   点击建议项 → 浮层内确认角色与批次（只列 估算书/需求书 两类；批次下拉 批次1…N）→
 *   「下载并加载到检查流程」→ 回写 Vue 根实例 itaPayload 并调用既有 itaLoad()。
 *
 * 悬浮球携带数据：initItaImport 调 window.__itaSearchOpenWithPayload(payload)
 * 直接进入确认步骤（不经搜索）。
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
  var ROLE_LABEL = { estimation: '估算书', requirement: '需求书' };

  var state = {
    open: false,
    timer: null,
    abort: null,
    picked: null,   // {prjid, projname, projectno, projtype, status}
    files: [],      // 仅 estimation/requirement 两类
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
      '      <th>文件名</th><th style="width:96px">类型</th><th style="width:110px">批次</th>' +
      '    </tr></thead><tbody></tbody></table>' +
      '    <div class="ita-osp__note">仅需估算书与需求说明书两类文件，其他文档已自动过滤；需求书多个批次时在下拉中指定。</div>' +
      '    <div class="ita-osp__warn" style="display:none"></div>' +
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

  // 触发器（事件委托：render 函数产出的按钮无需逐个绑定；模块初始化即注册）
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
    root.querySelector('.ita-osp__list').style.display = '';
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
    // ⚠ 该接口参数形状未经抓包验证（page/pageSize 写死无翻页）；pageSize 与
    //    content.js 项目查询统一为 100，服务端如有上限会自行钳制
    var body = 'bizdomain=0&projname=' + encodeURIComponent(kw) + '&projectno=&status=&projtype=&currentstage=&zhuModLvl=&applytime=&page=1&pageSize=100';
    fetch('http://ita.abc/ita/project/searchProj2022.action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest', // ITA ajax 请求标配（抓包佐证）
      },
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

  // ── 选择项目 → 浮层内确认（仅估算书/需求书两类） ──
  function adoptFiles(fileList) {
    state.files = fileList
      .map(function (f) {
        var name = f.namFile || f.nmlName || f.name || '';
        return {
          idFile: f.idFile || '',
          idPsn: f.idPsn || '',
          name: name,
          size: f.fileSize || f.size || 0,
          role: f.role || guessRole(name),
          batchName: f.batchName || '',
        };
      })
      .filter(function (f) { return f.role === 'estimation' || f.role === 'requirement'; });
    fillBatches();
  }

  /** 需求书按顺序预填 批次1…N */
  function fillBatches() {
    var reqs = state.files.filter(function (f) { return f.role === 'requirement'; });
    var n = reqs.length;
    var i = 0;
    state.files.forEach(function (f) {
      if (f.role === 'requirement') {
        i += 1;
        if (!f.batchName) f.batchName = '批次' + i;
      }
    });
    return n;
  }

  function pick(prjid) {
    setStatus('正在获取项目文档列表…');
    fetch('http://ita.abc/ita/project/searchProj.action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest', // ITA ajax 请求标配（抓包佐证）
      },
      body: 'bizdomain=0&prjid=' + encodeURIComponent(prjid),
      credentials: 'include',
    }).then(function (r) { return r.json(); }).then(function (res) {
      var detail = res && res.data && res.data[0] ? res.data[0] : null;
      var fileList = (detail && detail.fileList) || [];
      state.picked = {
        prjid: prjid,
        projname: (detail && detail.projname) || '',
        projectno: (detail && detail.projectno) || '',
        projtype: (detail && detail.projtype) || '',
        status: (detail && detail.status) || '',
      };
      adoptFiles(fileList);
      renderConfirm();
      setStatus('已获取 ' + state.files.length + ' 个相关文档（已过滤其他类型），请确认类型与批次');
    }).catch(function (e) {
      setStatus('获取项目文档失败：' + (e.message || e), true);
    });
  }

  /** 悬浮球携带数据直达确认步骤 */
  window.__itaSearchOpenWithPayload = function (payload) {
    open();
    state.picked = {
      prjid: payload.prjid || '',
      projname: payload.projname || '',
      projectno: payload.projectno || '',
      projtype: payload.projtype || '',
      status: '',
    };
    adoptFiles(payload.files || []);
    renderConfirm();
    setStatus('已带入 ' + state.files.length + ' 个相关文档，请确认类型与批次');
  };

  function renderConfirm() {
    var reqCount = fillBatches();
    var tb = root.querySelector('.ita-osp__table tbody');
    tb.innerHTML = state.files.map(function (f, i) {
      var batchCell;
      if (f.role === 'requirement') {
        var opts = [];
        for (var b = 1; b <= reqCount; b++) opts.push('批次' + b);
        batchCell = '<select class="ita-select ita-osp__batch" data-i="' + i + '">' +
          opts.map(function (o) {
            return '<option value="' + o + '"' + (f.batchName === o ? ' selected' : '') + '>' + o + '</option>';
          }).join('') +
          '</select>';
      } else {
        batchCell = '<span class="ita-none">—</span>';
      }
      return '<tr>' +
        '<td class="ita-osp__fname">' + esc(f.name) + '</td>' +
        '<td><select class="ita-select ita-osp__role" data-i="' + i + '">' +
        ['estimation', 'requirement'].map(function (v) {
          return '<option value="' + v + '"' + (f.role === v ? ' selected' : '') + '>' + ROLE_LABEL[v] + '</option>';
        }).join('') +
        '</select></td>' +
        '<td>' + batchCell + '</td>' +
        '</tr>';
    }).join('');
    Array.prototype.forEach.call(tb.querySelectorAll('.ita-osp__role'), function (sel) {
      sel.addEventListener('change', function () {
        state.files[Number(sel.dataset.i)].role = sel.value;
        renderConfirm();
      });
    });
    Array.prototype.forEach.call(tb.querySelectorAll('.ita-osp__batch'), function (sel) {
      sel.addEventListener('change', function () {
        state.files[Number(sel.dataset.i)].batchName = sel.value;
        updateWarn();
      });
    });
    root.querySelector('.ita-osp__picked').textContent =
      '已选：' + (state.picked && (state.picked.projname || state.picked.prjid) || '') +
      (state.picked && state.picked.projectno ? '（' + state.picked.projectno + '）' : '');

    updateWarn();
    root.querySelector('.ita-osp__list').style.display = 'none';
    root.querySelector('.ita-osp__confirm').style.display = '';
  }

  /** 合并批次警示：多份需求说明书指定同一批次时明确提示（后续上传与比对按此批次合并处理） */
  function updateWarn() {
    if (!root) return;
    var byBatch = {};
    state.files.forEach(function (f) {
      if (f.role === 'requirement' && f.batchName) {
        (byBatch[f.batchName] = byBatch[f.batchName] || []).push(f.name);
      }
    });
    var merged = Object.keys(byBatch).filter(function (b) { return byBatch[b].length > 1; });
    var warn = root.querySelector('.ita-osp__warn');
    if (!warn) return;
    if (merged.length) {
      warn.style.display = '';
      warn.innerHTML = merged.map(function (b) {
        var names = byBatch[b];
        return '<div>⚠ ' + esc(b) + ' 合并了 ' + names.length + ' 份需求说明书：' +
          esc(names.join('、')) + '（加载后将按 ' + esc(b) + ' 合并比对）</div>';
      }).join('');
    } else {
      warn.style.display = 'none';
      warn.innerHTML = '';
    }
  }

  // ── 确认：回写 Vue 状态并调用既有 itaLoad() ──
  function confirmLoad() {
    var vm = getVm();
    if (!vm) { setStatus('无法连接检查页面状态，请刷新页面重试', true); return; }
    var est = state.files.filter(function (f) { return f.role === 'estimation'; });
    if (est.length === 0) { setStatus('未识别到规模估算书（.xlsx/.et 且文件名含"估算"）', true); return; }
    if (est.length > 1) { setStatus('识别到多份估算书，请仅保留一份"估算书"类型', true); return; }
    vm.itaPayload = {
      prjid: state.picked.prjid || '',
      projectno: state.picked.projectno || '',
      projname: state.picked.projname || '',
      projtype: state.picked.projtype || '',
      files: state.files.map(function (f) {
        return { idFile: f.idFile, idPsn: f.idPsn, name: f.name, size: f.size, role: f.role, batchName: f.batchName };
      }),
    };
    // 不调用 itaPrepareBatches 覆盖——用户在浮层中指定的批次即最终批次
    close();
    vm.itaLoad();
  }
})();
