// 项目工具插件 - 进度跟踪模块（悬浮球「进度跟踪」）
// ─────────────────────────────────────────────────────────────
// 一键透视「我参加的项目」的流程卡点：卡在哪个环节、卡在谁那儿、等了多久，
// 并提供催办动作（复制催办话术 / Teams 深链找项目经理）。
//
// 数据链路（全部只读接口，凭 ita.abc 登录 Cookie）：
//   ① POST /ita/rptWkld/bindWcydGrid                 我参加的项目清单（工时台账同源）
//   ② POST /ita/project/searchProj.action?prjid=…    项目详情（含 processList 流程实例数组）
//   ③ GET  /ita/subprocessimage.action?subprocessId= 流程图页：任务数据埋在内联 JS
//      （showtasktip('节点', '<tr>参与者/创建/执行者/动作/结束/状态</tr>…')），
//      「待处理」行即卡点 —— 多人并行评审、转办链都在行序列里。
//
// 模块约束：独立 IIFE，不侵入 content.js 既有逻辑；入口仅 window.__abcTrackerOpen。
// 非 ita.abc 域（popup「测试悬浮球」注入的本地页）自动走内置 mock 数据，
// 与估算检查 ?itaMock=1 沙箱同理念：外网可演示全流程。
(() => {
  if (window.__abcTrackerInjected) return;
  window.__abcTrackerInjected = true;

  const IS_ITA = /^https?:\/\/([a-z0-9.-]+\.)?ita\.abc\//i.test(location.href);
  const MOCK = !IS_ITA;

  const URL_GRID = 'http://ita.abc/ita/rptWkld/bindWcydGrid';
  const URL_PROJ = 'http://ita.abc/ita/project/searchProj.action';
  const URL_IMG = 'http://ita.abc/ita/subprocessimage.action?subprocessId=';

  // ── 小工具 ──
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const decodeEntities = (s) => {
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  };

  // 并发限流 map（流水线限 3 路，避免全量刷新瞬间打出几十个请求）
  const mapLimit = async (items, limit, fn) => {
    const out = new Array(items.length);
    let i = 0;
    const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { __err: e }; }
      }
    });
    await Promise.all(workers);
    return out;
  };

  const fmtWait = (ms) => {
    if (!(ms > 0)) return '—';
    const m = Math.floor(ms / 60000);
    if (m < 60) return m + ' 分钟';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时 ' + (m % 60) + ' 分';
    return Math.floor(h / 24) + ' 天 ' + (h % 24) + ' 小时';
  };

  // ── 卡点解析：从流程图 HTML 抽取「待处理」任务行 ──
  // showtip / showtip2 / showtasktip 系列的 tip 参数同为六列 <tr> 行：
  // 参与者 | 创建时间 | 执行者 | 动作 | 结束时间 | 状态
  const TIP_CALL_RE = /show(?:task)?tip2?\(\s*'([^']*)'\s*,\s*'([\s\S]*?)'\s*\)/g;
  const TR_RE = /<tr>((?:<td>[\s\S]*?<\/td>){4,6})<\/tr>/g;
  const TD_RE = /<td>([\s\S]*?)<\/td>/g;

  // 返回 [{ node, rows: [{person, since, executor, action, end, state}] }]（仅保留未完成行）
  const parseStuckNodes = (html, now) => {
    now = now || Date.now();
    const nodes = [];
    let m;
    TIP_CALL_RE.lastIndex = 0;
    while ((m = TIP_CALL_RE.exec(html))) {
      const node = decodeEntities(m[1]).trim();
      const tip = m[2];
      const stuck = [];
      let r;
      TR_RE.lastIndex = 0;
      while ((r = TR_RE.exec(tip))) {
        const tds = [];
        let t;
        TD_RE.lastIndex = 0;
        while ((t = TD_RE.exec(r[1]))) tds.push(decodeEntities(t[1]).trim());
        if (tds.length < 6) continue;
        const [person, since, executor, action, end, state] = tds;
        const pending = state.indexOf('待处理') >= 0 ||
          (!end && state && !/完成|作废|跳过|终止/.test(state));
        if (!pending) continue;
        let waitMs = NaN;
        if (since) {
          const d = new Date(since.replace(/-/g, '/'));
          if (!isNaN(d.getTime())) waitMs = now - d.getTime();
        }
        stuck.push({ person: person || executor || '-', since, executor, action, end, state, waitMs });
      }
      if (stuck.length) nodes.push({ node, rows: stuck });
    }
    return nodes;
  };

  // ── 内置自检：mock 环境加载时用抓包原文验证解析器（ITA 改版时 console 可见） ──
  const SELF_TEST_SAMPLES = [
    { // 抓包：已完成流程（第 8 次代码检查）——应无卡点
      html: "showtasktip('申请', ' <tr><td>张甲</td><td>2026-09-09 16:22:49</td><td>张甲</td><td>分发代码检查填写：李乙。</td><td>2026-09-09 16:32:27</td><td>完成</td></tr>')",
      expectNodes: 0,
    },
    { // 抓包：运行中函审流程——申请节点赵丙待处理 + 出具意见节点吴庚待处理（4 人并行评审）
      html: "showtasktip('申请', ' <tr><td>赵丙</td><td>2026-09-10 08:48:05</td><td></td><td></td><td></td><td>待处理</td></tr>')" +
        "showtasktip('指定处理人', ' <tr><td>研发中心武汉研发部开放场景金融研发团队项目集成管理员</td><td>2026-09-04 10:45:38</td><td></td><td>转处理给：钱丁。</td><td>2026-09-04 17:39:22</td><td>完成</td></tr>')" +
        "showtasktip('出具意见', ' <tr><td>周己</td><td>2026-09-09 15:12:00</td><td>周己</td><td>评审意见：通过。</td><td>2026-09-09 16:34:34</td><td>完成</td></tr>" +
        "<tr><td>吴庚</td><td>2026-09-09 15:12:00</td><td></td><td></td><td></td><td>待处理</td></tr>')",
      expectNodes: 2,
      expectPersons: ['赵丙', '吴庚'],
    },
  ];
  const runSelfTest = () => {
    SELF_TEST_SAMPLES.forEach((s, i) => {
      const nodes = parseStuckNodes(s.html);
      const persons = nodes.reduce((a, n) => a.concat(n.rows.map((r) => r.person)), []);
      const ok = nodes.length === s.expectNodes &&
        (!s.expectPersons || s.expectPersons.every((p) => persons.indexOf(p) >= 0));
      if (!ok) console.warn('[进度跟踪] 卡点解析自检未通过（ITA 可能已改版）: 用例#' + i, persons);
    });
  };
  if (MOCK) runSelfTest();

  // ── mock 数据（复刻抓包真实场景：多人评审中吴庚未出具意见） ──
  const MOCK_HTML_REVIEW = '<html><script>' +
    "showtasktip('申请', ' <tr><td>赵丙</td><td>2026-09-10 08:48:05</td><td></td><td></td><td></td><td>待处理</td></tr>')" +
    "showtasktip('出具意见', ' <tr><td>周己</td><td>2026-09-09 15:12:00</td><td>周己</td><td>评审意见：通过。</td><td>2026-09-09 16:34:34</td><td>完成</td></tr>" +
    "<tr><td>郑辛</td><td>2026-09-09 15:12:00</td><td>郑辛</td><td>评审意见：通过。</td><td>2026-09-09 15:12:26</td><td>完成</td></tr>" +
    "<tr><td>吴庚</td><td>2026-09-09 15:12:00</td><td></td><td></td><td></td><td>待处理</td></tr>')" +
    '<\/script></html>';
  const MOCK_HTML_CHECK = '<html><script>' +
    "showtasktip('申请', ' <tr><td>赵丙</td><td>" + new Date(Date.now() - 5 * 3600e3).toLocaleString('sv-SE').replace('T', ' ') + "</td><td></td><td></td><td></td><td>待处理</td></tr>')" +
    '<\/script></html>';

  const MOCK_GRID = [
    { prjid: 'PRJZH0090001', projname: '账务核心系统升级项目', projectno: '科维2026-0901' },
    { prjid: 'PRJZH0026003', projname: '智能风控平台二期', projectno: 'XRK2026003' },
  ];
  const MOCK_PROJ = {
    PRJZH0090001: {
      projname: '账务核心系统升级项目',
      prjManagerClurl: 'abcteams://?who=990000010&where=ITA&how=gotoSingleChat&targetUserName=冯癸&targetUsapId=990000010',
      processList: [
        { idProc: 6341400000000007, namProcDesc: '【账务核心系统升级项目】处室需求函审(第1次)', indStsProc: '正常运行' },
        { idProc: 6330400000000005, namProcDesc: '【账务核心系统升级项目】总行结项(2026年8月)', indStsProc: '完成' },
      ],
    },
    PRJZH0026003: {
      projname: '智能风控平台二期',
      prjManagerClurl: null,
      processList: [
        { idProc: 6338439828800001, namProcDesc: '【智能风控平台二期】代码检查(第9次)', indStsProc: '正常运行' },
        { idProc: 6338400000000009, namProcDesc: '【智能风控平台二期】工作量评估', indStsProc: '正常运行' },
      ],
    },
  };

  // ── 接口层：mock 与真实同签名 ──
  const xhrHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
  };

  const apiGrid = async () => {
    if (MOCK) return MOCK_GRID;
    const resp = await fetch(URL_GRID, { method: 'POST', headers: xhrHeaders, body: '', credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!Array.isArray(data)) throw new Error('响应格式异常');
    // 同项目有 计划/填报 两行，按 prjid 去重
    const seen = {};
    const out = [];
    data.forEach((r) => {
      if (r && r.prjid && !seen[r.prjid]) {
        seen[r.prjid] = 1;
        out.push({ prjid: r.prjid, projname: r.projname || '', projectno: r.projectno || '' });
      }
    });
    return out;
  };

  const apiProj = async (prjid) => {
    if (MOCK) {
      const p = MOCK_PROJ[prjid];
      if (!p) throw new Error('mock 无此项目');
      return p;
    }
    const resp = await fetch(URL_PROJ, {
      method: 'POST', headers: xhrHeaders, credentials: 'include',
      body: 'bizdomain=0&prjid=' + encodeURIComponent(prjid),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const res = await resp.json();
    const d = res && res.data && res.data[0];
    if (!d) throw new Error('项目详情为空');
    return {
      projname: d.projname || '',
      prjManagerClurl: d.prjManagerClurl || null,
      processList: Array.isArray(d.processList) ? d.processList : [],
    };
  };

  const apiImage = async (idProc) => {
    if (MOCK) {
      if (idProc === 6341400000000007) return MOCK_HTML_REVIEW;
      if (idProc === 6338439828800001) return MOCK_HTML_CHECK;
      return '<html></html>'; // 工作量评估：运行中但无卡点（验证折叠行）
    }
    const resp = await fetch(URL_IMG + encodeURIComponent(idProc), { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.text();
  };

  // ── 全量流水线：项目 → 运行中流程 → 卡点 ──
  // 返回 { projects, runningCount, flows, projErr }
  // flows: [{ prjid, projname, projectno, idProc, flowName, clurl, nodes, failed }]
  const collectAll = async (onProgress) => {
    const projects = await apiGrid();
    if (!projects.length) return { projects, runningCount: 0, flows: [], projErr: 0 };

    let done = 0;
    onProgress && onProgress('正在获取项目详情… 0/' + projects.length);
    const details = await mapLimit(projects, 3, async (p) => {
      const d = await apiProj(p.prjid);
      done += 1;
      onProgress && onProgress('正在获取项目详情… ' + done + '/' + projects.length);
      return d;
    });

    const flows = [];
    let projErr = 0;
    details.forEach((d, i) => {
      const p = projects[i];
      if (!d || d.__err) { projErr += 1; return; }
      (d.processList || []).forEach((proc) => {
        const st = String(proc.indStsProc || '');
        if (st.indexOf('正常') < 0) return; // 只跟踪「正常运行」，已完成/挂起不进列表
        flows.push({
          prjid: p.prjid, projname: d.projname || p.projname, projectno: p.projectno,
          idProc: proc.idProc, flowName: proc.namProcDesc || proc.namProc || ('流程 ' + proc.idProc),
          clurl: d.prjManagerClurl || null, nodes: [], failed: false,
        });
      });
    });

    if (!flows.length) return { projects, runningCount: 0, flows: [], projErr };

    done = 0;
    onProgress && onProgress('正在分析流程卡点… 0/' + flows.length);
    await mapLimit(flows, 3, async (f) => {
      try {
        const html = await apiImage(f.idProc);
        f.nodes = parseStuckNodes(html);
      } catch (e) {
        f.failed = true;
      }
      done += 1;
      onProgress && onProgress('正在分析流程卡点… ' + done + '/' + flows.length);
    });

    const runningCount = flows.length;
    return { projects, runningCount, flows, projErr };
  };

  // ── 浮层 UI（一次性构建） ──
  let root = null;
  let refreshing = false;

  const build = () => {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'abc-tracker';
    root.innerHTML =
      '<div class="abc-tracker__mask"></div>' +
      '<div class="abc-tracker__panel" role="dialog" aria-label="进度跟踪">' +
      '  <div class="abc-tracker__head">' +
      '    <span class="abc-tracker__logo">⏱</span>' +
      '    <span class="abc-tracker__title">进度跟踪</span>' +
      (MOCK ? '<span class="abc-tracker__mockbadge">模拟数据</span>' : '') +
      '    <span class="abc-tracker__refresh" title="刷新">↻</span>' +
      '    <span class="abc-tracker__close" title="关闭">✕</span>' +
      '  </div>' +
      '  <div class="abc-tracker__summary"></div>' +
      '  <div class="abc-tracker__list"></div>' +
      '</div>';
    document.documentElement.appendChild(root);
    root.querySelector('.abc-tracker__close').addEventListener('click', close);
    root.querySelector('.abc-tracker__mask').addEventListener('click', close);
    root.querySelector('.abc-tracker__refresh').addEventListener('click', () => refresh());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    // 卡点条目按钮（事件委托：催办动作）
    root.querySelector('.abc-tracker__list').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'copy') {
        const text = btn.dataset.copy || '';
        const done = () => { btn.textContent = '✓ 已复制'; setTimeout(() => { btn.textContent = '📋 催办话术'; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
        } else fallbackCopy(text, done);
      } else if (act === 'teams') {
        const clurl = btn.dataset.clurl || '';
        if (clurl) window.open(clurl, '_blank');
      } else if (act === 'open') {
        window.open(URL_IMG + encodeURIComponent(btn.dataset.proc || ''), '_blank');
      }
    });
    return root;
  };

  const fallbackCopy = (text, done) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* 忽略 */ }
    document.body.removeChild(ta);
  };

  const open = () => {
    build();
    root.classList.add('show');
    refresh();
  };

  const close = () => { if (root) root.classList.remove('show'); };

  const setSummary = (html) => { root.querySelector('.abc-tracker__summary').innerHTML = html; };
  const setList = (html) => { root.querySelector('.abc-tracker__list').innerHTML = html; };
  const setBusy = (busy) => {
    refreshing = busy;
    const r = root.querySelector('.abc-tracker__refresh');
    r.classList.toggle('is-busy', busy);
  };

  const refresh = async () => {
    if (refreshing) return;
    setBusy(true);
    setSummary('<span class="abc-tracker__loading">正在获取我参加的项目…</span>');
    setList('');
    try {
      const { projects, runningCount, flows, projErr } = await collectAll(
        (msg) => setSummary('<span class="abc-tracker__loading">' + esc(msg) + '</span>')
      );

      // 概览条
      const stuckFlows = flows.filter((f) => f.nodes.length > 0);
      const stuckCount = stuckFlows.reduce((a, f) => a + f.nodes.reduce((x, n) => x + n.rows.length, 0), 0);
      setSummary(
        '<span>参加 <b>' + projects.length + '</b> 个项目</span>' +
        '<span class="abc-tracker__sep">·</span>' +
        '<span>运行中流程 <b>' + runningCount + '</b> 个</span>' +
        '<span class="abc-tracker__sep">·</span>' +
        '<span class="' + (stuckCount > 0 ? 'abc-tracker__stuck-count' : '') + '">卡点 <b>' + stuckCount + '</b> 处</span>' +
        (projErr > 0 ? '<span class="abc-tracker__sep">·</span><span class="abc-tracker__projerr">' + projErr + ' 个项目详情获取失败</span>' : '')
      );

      if (!flows.length) {
        setList('<div class="abc-tracker__empty">当前没有运行中的流程 🎉</div>');
        return;
      }

      // 只展示有卡点的流程在前，无卡点运行中流程折叠为安静一行
      const clean = flows.filter((f) => !f.failed && f.nodes.length === 0);
      let html = '';
      flows.forEach((f) => {
        if (f.failed) {
          html +=
            '<div class="abc-tracker__item abc-tracker__item--failed">' +
            '  <div class="abc-tracker__item-main">' +
            '    <div class="abc-tracker__flow">' + esc(f.flowName) + '</div>' +
            '    <div class="abc-tracker__failed-note">⚠ 流程图解析失败（ITA 可能已改版），请打开流程图自查</div>' +
            '  </div>' +
            '  <div class="abc-tracker__actions"><button class="abc-tracker__btn" data-act="open" data-proc="' + esc(f.idProc) + '">流程图 ↗</button></div>' +
            '</div>';
          return;
        }
        if (!f.nodes.length) return;
        const maxWait = Math.max.apply(null, f.nodes.reduce((a, n) => a.concat(n.rows.map((r) => r.waitMs || 0)), [0]));
        const late = maxWait > 24 * 3600e3 ? ' is-late' : '';
        const stuckHtml = f.nodes.map((n) => {
          const names = n.rows.map((r) => esc(r.person)).join('、');
          const wait = Math.max.apply(null, n.rows.map((r) => r.waitMs || 0));
          return '<div class="abc-tracker__stuck-line">' +
            '<span class="abc-tracker__node">' + esc(n.node) + '</span>' +
            '<span class="abc-tracker__arrow">→</span>' +
            '<span class="abc-tracker__person">' + names + '</span>' +
            '<span class="abc-tracker__dur' + late + '">已等待 ' + esc(fmtWait(wait)) + '</span>' +
            '</div>';
        }).join('');
        // 催办话术取等待最久的卡点（最需要催的一处，与条目上的最长等待一致）
        let worst = null;
        f.nodes.forEach((n) => n.rows.forEach((r) => {
          if (!worst || (r.waitMs || 0) > (worst.row.waitMs || 0)) worst = { node: n.node, row: r };
        }));
        const copyText = '【催办】' + f.projname + '「' + f.flowName + '」当前环节「' + worst.node +
          '」待 ' + worst.row.person + ' 处理（已等待 ' + fmtWait(maxWait) + '），请及时处理。';
        html +=
          '<div class="abc-tracker__item">' +
          '  <div class="abc-tracker__item-main">' +
          '    <div class="abc-tracker__proj">' + esc(f.projname) + (f.projectno ? ' · ' + esc(f.projectno) : '') + '</div>' +
          '    <div class="abc-tracker__flow">' + esc(f.flowName) + '</div>' +
          stuckHtml +
          '  </div>' +
          '  <div class="abc-tracker__actions">' +
          (f.clurl ? '<button class="abc-tracker__btn abc-tracker__btn--primary" data-act="teams" data-clurl="' + esc(f.clurl) + '">💬 找项目经理</button>' : '') +
          '<button class="abc-tracker__btn" data-act="copy" data-copy="' + esc(copyText) + '">📋 催办话术</button>' +
          '<button class="abc-tracker__btn" data-act="open" data-proc="' + esc(f.idProc) + '">流程图 ↗</button>' +
          '  </div>' +
          '</div>';
      });
      if (clean.length) {
        html += '<div class="abc-tracker__clean">另有 ' + clean.length + ' 个运行中流程暂无卡点</div>';
      }
      if (!stuckFlows.length && !flows.some((f) => f.failed)) {
        html = '<div class="abc-tracker__empty">所有运行中流程都没有卡点 🎉</div>' + html;
      }
      setList(html);
    } catch (e) {
      setSummary('');
      setList('<div class="abc-tracker__error">无法获取我参加的项目：' + esc(e.message || e) +
        '。请确认已在 ita.abc 登录；若刚登录请点右上角 ↻ 重试。</div>');
    } finally {
      setBusy(false);
    }
  };

  // 悬浮球菜单入口（content.js 菜单项点击时调用）
  window.__abcTrackerOpen = open;
})();
