// 项目工具插件 - 进度跟踪模块（悬浮球「进度跟踪」，三页签）
// ─────────────────────────────────────────────────────────────
// 页签：① 我管理的（myManagedProj）② 我参与的（bindWcydGrid）③ 职能组（接口整理中，占位）
// 一键透视各页签项目的流程卡点：卡在哪个环节、卡在谁那儿、等了多久，
// 并提供催办动作（复制催办话术 / Teams 深链找项目经理）。
//
// 数据链路（全部只读接口，凭 ita.abc 登录 Cookie）：
//   ① 我管理的  POST /ita/project/myManagedProj.action  表单 status=1(正常)+5(运维) 分页抓全
//      （响应自带 projManClurl 数字工号深链，项目经理按钮直接用，无需概况查询）
//   ② 我参与的  POST /ita/rptWkld/bindWcydGrid          year=今年+上一年各查一次
//      → 项目经理经 searchProj2022 概况查询（projMan/projManID 域账号拼深链）
//   ③ 职能组    POST /ita/project/searchProj4GrpLeader  page/pageSize 分页抓全
//      （响应自带 processList 实际数据 + projManClurl → 清单即详情，零额外查询）
//   ④ 流程实例  POST /ita/project/searchProj.action     processList 筛「正常运行」
//      （仅清单未自带 processList 的项目走此查询）
//   ⑤ 流程卡点  GET  /ita/subprocessimage.action        任务数据埋在内联 JS
//      （showtasktip('节点', '<tr>参与者/创建/执行者/动作/结束/状态</tr>…')），
//      「待处理」行即卡点 —— 多人并行评审、转办链都在行序列里。
//
// 性能：并发 6 路 + 渐进渲染（单项目分析完成即上屏）+ 会话级缓存
//   （项目详情/流程卡点 5 分钟、项目经理 10 分钟，键共享 → 跨页签同项目零重复请求；
//    ↻ 仅强制刷新当前页签，切页签命中缓存秒开）
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
  const URL_MANAGED = 'http://ita.abc/ita/project/myManagedProj.action';
  const URL_GRP = 'http://ita.abc/ita/project/searchProj4GrpLeader.action';
  const URL_PROJ = 'http://ita.abc/ita/project/searchProj.action';
  const URL_SEARCH = 'http://ita.abc/ita/project/searchProj2022.action';
  const URL_IMG = 'http://ita.abc/ita/subprocessimage.action?subprocessId=';

  // ── 小工具 ──
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const decodeEntities = (s) => {
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  };

  // 并发限流 map（并发 6：贴满浏览器同域 HTTP/1.1 并发上限，且不堆积请求）
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

  // ── mock 数据（复刻抓包真实场景；人名/项目名/编号均为虚构） ──
  const MOCK_HTML_REVIEW = '<html><script>' +
    "showtasktip('申请', ' <tr><td>赵丙</td><td>2026-09-10 08:48:05</td><td></td><td></td><td></td><td>待处理</td></tr>')" +
    "showtasktip('出具意见', ' <tr><td>周己</td><td>2026-09-09 15:12:00</td><td>周己</td><td>评审意见：通过。</td><td>2026-09-09 16:34:34</td><td>完成</td></tr>" +
    "<tr><td>郑辛</td><td>2026-09-09 15:12:00</td><td>郑辛</td><td>评审意见：通过。</td><td>2026-09-09 15:12:26</td><td>完成</td></tr>" +
    "<tr><td>吴庚</td><td>2026-09-09 15:12:00</td><td></td><td></td><td></td><td>待处理</td></tr>')" +
    '<\/script></html>';
  const MOCK_HTML_CHECK = '<html><script>' +
    "showtasktip('申请', ' <tr><td>赵丙</td><td>" + new Date(Date.now() - 5 * 3600e3).toLocaleString('sv-SE').replace('T', ' ') + "</td><td></td><td></td><td></td><td>待处理</td></tr>')" +
    '<\/script></html>';
  const MOCK_HTML_GRP = '<html><script>' +
    "showtasktip('代码评审', ' <tr><td>钱七</td><td>" + new Date(Date.now() - 2 * 3600e3).toLocaleString('sv-SE').replace('T', ' ') + "</td><td></td><td></td><td></td><td>待处理</td></tr>')" +
    '<\/script></html>';

  // 职能组清单（searchProj4GrpLeader）：响应自带 processList 实际数据 + projManClurl
  const MOCK_GRP = [
    { prjid: 'PRJZH0077001', projname: '渠道整合平台三期', projectno: '农银科项字【2026】第0747号',
      projManClurl: 'abcteams://?who=990029505&where=ITA&how=gotoSingleChat&targetUserName=' + encodeURIComponent('陈四') + '&targetUsapId=990029505',
      processList: [
        { idProc: 770000001, namProcDesc: '【渠道整合平台三期】代码检查(第8次准出)', indStsProc: '正常运行' },
        { idProc: 770000002, namProcDesc: '【渠道整合平台三期】测试准出(第8次)', indStsProc: '完成' },
        { idProc: 770000003, namProcDesc: '【渠道整合平台三期】源代码安全自查(第8次)', indStsProc: '取消' },
      ] },
  ];

  // mock 调用计数（测试基建：E2E 用它断言缓存命中）
  const mockCalls = MOCK ? (window.__trackerMockCalls = { grid: 0, managed: 0, grp: 0, proj: 0, img: 0, overview: 0 }) : null;

  // 我参与的（bindWcydGrid 双年份合并去重后的清单）
  const MOCK_GRID = [
    { prjid: 'PRJZH0090001', projname: '账务核心系统升级项目', projectno: '科维2026-0901' },
    { prjid: 'PRJZH0026003', projname: '智能风控平台二期', projectno: 'XRK2026003' },
  ];
  // 我管理的（myManagedProj）：status=1 在管项目与「我参与的」项目1 重叠（验证跨页签缓存共享）
  const MOCK_MANAGED_ACTIVE = [
    { prjid: 'PRJZH0090001', projname: '账务核心系统升级项目', projectno: '科维2026-0901',
      projManClurl: 'abcteams://?who=990000010&where=ITA&how=gotoSingleChat&targetUserName=' + encodeURIComponent('冯癸') + '&targetUsapId=990000010' },
  ];
  // status=5 运维结项项目：processList 为空 → 无运行中流程
  const MOCK_MANAGED_OPS = [
    { prjid: 'PRJZH0090099', projname: '核心账务平台运维保障', projectno: '科维2025-0999', projManClurl: '' },
  ];

  const MOCK_PROJ = {
    PRJZH0090001: {
      projname: '账务核心系统升级项目',
      processList: [
        { idProc: 6341400000000007, namProcDesc: '【账务核心系统升级项目】处室需求函审(第1次)', indStsProc: '正常运行' },
        { idProc: 6330400000000005, namProcDesc: '【账务核心系统升级项目】总行结项(2026年8月)', indStsProc: '完成' },
      ],
    },
    PRJZH0026003: {
      projname: '智能风控平台二期',
      processList: [
        { idProc: 6338439828800001, namProcDesc: '【智能风控平台二期】代码检查(第9次)', indStsProc: '正常运行' },
        { idProc: 6338400000000009, namProcDesc: '【智能风控平台二期】工作量评估', indStsProc: '正常运行' },
      ],
    },
    PRJZH0090099: {
      projname: '核心账务平台运维保障',
      processList: [],
    },
  };
  // searchProj2022 概况 mock：项目1 有项目经理（周己），项目2 无（按钮隐藏场景）
  const MOCK_OVERVIEW = {
    '账务核心系统升级项目': [
      { prjid: 'PRJZH0090001', projMan: '周己', projManID: 'zhouji' },
    ],
    '智能风控平台二期': [],
  };

  // ── 接口层：mock 与真实同签名 ──
  const xhrHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
  };

  // 我参与的清单：year 必填（今年+上一年各查一次），其余可空
  const apiGrid = async () => {
    if (MOCK) { mockCalls.grid += 1; return MOCK_GRID; }
    const loadYear = async (y) => {
      const resp = await fetch(URL_GRID, {
        method: 'POST', headers: xhrHeaders, credentials: 'include',
        body: 'year=' + y + '&projname=&projectno=&page=&pageSize=',
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      if (!Array.isArray(data)) throw new Error('响应格式异常');
      return data;
    };
    const year = new Date().getFullYear();
    const [cur, prev] = await Promise.all([
      loadYear(year), loadYear(year - 1).catch(() => []),
      // 上一年查询失败不阻塞：今年数据仍可用
    ]);
    // 两年份合并，同项目有 计划/填报 两行，按 prjid 去重
    const seen = {};
    const out = [];
    cur.concat(prev).forEach((r) => {
      if (r && r.prjid && !seen[r.prjid]) {
        seen[r.prjid] = 1;
        out.push({ prjid: r.prjid, projname: r.projname || '', projectno: r.projectno || '' });
      }
    });
    if (!out.length) throw new Error('今年与上一年均未查询到项目');
    return out;
  };

  // 我管理的清单：status 枚举 1 正常/2 暂停/3 终止/4 废弃/5 运维（抓包值 pageSize=10 分页抓全）
  const apiManaged = async (status) => {
    if (MOCK) {
      mockCalls.managed += 1;
      return status === 1 ? MOCK_MANAGED_ACTIVE : (status === 5 ? MOCK_MANAGED_OPS : []);
    }
    const year = new Date().getFullYear();
    const rows = [];
    let page = 1;
    while (true) {
      const resp = await fetch(URL_MANAGED, {
        method: 'POST', headers: xhrHeaders, credentials: 'include',
        body: 'year=' + year + '&projname=&projectno=&status=' + status + '&pageSize=10&page=' + page,
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const res = await resp.json();
      const data = (res && res.data) || [];
      rows.push.apply(rows, data);
      if (data.length < 10 || page > 30) break; // 空页/不满页即止（防御上限 300 项目）
      page += 1;
    }
    return rows;
  };

  // 职能组清单：page/pageSize 分页抓全（顶层 total 可靠，按它判停）
  const apiGrpLeader = async () => {
    if (MOCK) { mockCalls.grp += 1; return MOCK_GRP; }
    const rows = [];
    let page = 1;
    let total = Infinity;
    while (rows.length < total && page <= 30) {
      const resp = await fetch(URL_GRP, {
        method: 'POST', headers: xhrHeaders, credentials: 'include',
        body: 'page=' + page + '&pageSize=10',
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const res = await resp.json();
      const data = (res && res.data) || [];
      rows.push.apply(rows, data);
      total = typeof (res && res.total) === 'number' ? res.total : rows.length;
      if (data.length < 10) break; // 不满页即止
      page += 1;
    }
    return rows;
  };

  const apiProj = async (prjid) => {
    if (MOCK) {
      mockCalls.proj += 1;
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
      processList: Array.isArray(d.processList) ? d.processList : [],
    };
  };

  // 项目概况（searchProj2022 按项目名搜索）：取 projMan/projManID —— 补充抓包证实
  // 该接口响应的项目经理字段才有实际值（searchProj.action 的 Clurl 人选不对）
  const apiProjOverview = async (prjid, projname) => {
    if (MOCK) {
      mockCalls.overview += 1;
      const rows = MOCK_OVERVIEW[projname];
      if (!rows) return { projMan: null, projManID: null };
      const hit = rows.find((r) => r.prjid === prjid) || null;
      return { projMan: hit ? hit.projMan : null, projManID: hit ? hit.projManID : null };
    }
    const body = 'bizdomain=0&projname=' + encodeURIComponent(projname) +
      '&projectno=&status=&projtype=&currentstage=&zhuModLvl=&applytime=&page=1&pageSize=100';
    const resp = await fetch(URL_SEARCH, {
      method: 'POST', headers: xhrHeaders, credentials: 'include', body: body,
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const res = await resp.json();
    const list = (res && res.data) || [];
    const hit = list.find((r) => r.prjid === prjid) || null;
    return {
      projMan: (hit && hit.projMan) || null,
      projManID: (hit && hit.projManID) || null,
    };
  };

  const apiImage = async (idProc) => {
    if (MOCK) {
      mockCalls.img += 1;
      if (idProc === 6341400000000007) return MOCK_HTML_REVIEW;
      if (idProc === 6338439828800001) return MOCK_HTML_CHECK;
      if (idProc === 770000001) return MOCK_HTML_GRP;
      return '<html></html>'; // 其余流程：运行中但无卡点（验证折叠行）
    }
    const resp = await fetch(URL_IMG + encodeURIComponent(idProc), { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.text();
  };

  // Teams 单聊深链（格式取自 ITA 抓包 Clurl）
  const teamsUrl = (name, id) =>
    'abcteams://?who=' + encodeURIComponent(id) + '&where=ITA&how=gotoSingleChat' +
    '&targetUserName=' + encodeURIComponent(name) + '&targetUsapId=' + encodeURIComponent(id);

  // 从原生 Clurl 提取 { name, url }（我管理的响应自带数字工号深链，直接可用）
  const pmFromClurl = (clurl) => {
    if (!clurl) return null;
    const m = String(clurl).match(/targetUserName=([^&]+)/);
    return { name: m ? decodeURIComponent(m[1]) : '', url: String(clurl) };
  };

  // ── 会话级缓存（跨页签共享：详情/卡点 5 分钟，项目经理 10 分钟，清单 5 分钟） ──
  const TTL_SHORT = 5 * 60e3;
  const TTL_LONG = 10 * 60e3;
  const cacheDetail = new Map(); // prjid 或 'list:<tab>' → {at, data}
  const cacheStuck = new Map();  // idProc → {at, data}
  const cachePm = new Map();     // prjid → {at, data}
  const cached = (m, key, ttl) => {
    const e = m.get(key);
    return (e && Date.now() - e.at < ttl) ? e.data : null;
  };
  const store = (m, key, data) => m.set(key, { at: Date.now(), data });

  // ── 页签适配器：各自实现 fetchProjects，输出统一 {prjid, projname, projectno, pm} ──
  const ADAPTERS = {
    managed: {
      label: '我管理的',
      fetchProjects: async (onProgress) => {
        // status=1 正常 + 5 运维（暂停/终止/废弃无跟踪意义）；两状态并行
        onProgress && onProgress('正在获取我管理的项目…');
        const both = await Promise.all([
          apiManaged(1).catch(() => []), apiManaged(5).catch(() => []),
        ]);
        const seen = {};
        const out = [];
        both.forEach((rows) => rows.forEach((r) => {
          if (!r || !r.prjid || seen[r.prjid]) return;
          seen[r.prjid] = 1;
          out.push({
            prjid: r.prjid, projname: r.projname || '', projectno: r.projectno || '',
            pm: pmFromClurl(r.projManClurl), // 原生数字工号深链，按钮直接用
          });
        }));
        if (!out.length) throw new Error('未查询到我管理的项目（status=1/5）');
        return out;
      },
    },
    joined: {
      label: '我参与的',
      fetchProjects: async (onProgress) => {
        onProgress && onProgress('正在获取我参加的项目…');
        const rows = await apiGrid();
        return rows.map((r) => ({ prjid: r.prjid, projname: r.projname, projectno: r.projectno, pm: null }));
      },
    },
    funcgroup: {
      label: '职能组',
      fetchProjects: async (onProgress) => {
        onProgress && onProgress('正在获取职能组项目…');
        const rows = await apiGrpLeader();
        const seen = {};
        const out = [];
        rows.forEach((r) => {
          if (!r || !r.prjid || seen[r.prjid]) return;
          seen[r.prjid] = 1;
          out.push({
            prjid: r.prjid, projname: r.projname || '', projectno: r.projectno || '',
            pm: pmFromClurl(r.projManClurl),
            processList: Array.isArray(r.processList) ? r.processList : null, // 清单自带流程实例：免详情查询
          });
        });
        return out;
      },
    },
  };

  // ── 项目级分析：流程实例（清单自带或查详情）→ 卡点 → 项目经理（均走缓存） ──
  const analyzeProject = async (p, force) => {
    const out = { prjid: p.prjid, projname: p.projname, projectno: p.projectno, pm: p.pm || null, flows: [], err: null };
    try {
      let processList = p.processList || null; // 职能组清单自带 processList：免详情查询
      if (!processList) {
        let detail = force ? null : cached(cacheDetail, p.prjid, TTL_SHORT);
        if (!detail) {
          detail = await apiProj(p.prjid);
          store(cacheDetail, p.prjid, detail);
        }
        if (detail.projname) out.projname = detail.projname;
        processList = detail.processList || [];
      }

      const running = processList.filter((proc) =>
        String(proc.indStsProc || '').indexOf('正常') >= 0);

      await mapLimit(running, 6, async (proc) => {
        const f = {
          idProc: proc.idProc,
          flowName: proc.namProcDesc || proc.namProc || ('流程 ' + proc.idProc),
          nodes: [], failed: false,
        };
        let nodes = force ? null : cached(cacheStuck, proc.idProc, TTL_SHORT);
        if (nodes === null) {
          try {
            nodes = parseStuckNodes(await apiImage(proc.idProc));
            store(cacheStuck, proc.idProc, nodes);
          } catch (e) {
            f.failed = true;
            nodes = [];
          }
        }
        f.nodes = nodes;
        out.flows.push(f);
      });

      // 项目经理：managed 来源 fetchProjects 已带原生深链；joined 来源仅对有卡点项目查概况
      if (!out.pm && out.flows.some((f) => f.nodes.length)) {
        let pm = force ? null : cached(cachePm, p.prjid, TTL_LONG);
        if (!pm) {
          try { pm = await apiProjOverview(p.prjid, out.projname); } catch (e) { pm = {}; }
          store(cachePm, p.prjid, pm);
        }
        if (pm && pm.projMan) {
          out.pm = { name: pm.projMan, url: teamsUrl(pm.projMan, pm.projManID || pm.projMan) };
        }
      }
    } catch (e) {
      out.err = e;
    }
    return out;
  };

  // ── 页签分析流水线：清单 → 并发 6 渐进分析（onList 铺占位、onProject 单项目完成即回调） ──
  const analyzeTab = async (tabKey, opts) => {
    opts = opts || {};
    const force = !!opts.force;
    const adapter = ADAPTERS[tabKey];
    if (!adapter) return { projects: [], results: [] };

    const listKey = 'list:' + tabKey;
    let projects = force ? null : cached(cacheDetail, listKey, TTL_SHORT);
    if (!projects) {
      projects = await adapter.fetchProjects(opts.onProgress);
      store(cacheDetail, listKey, projects);
    }
    opts.onList && opts.onList(projects);

    const results = [];
    await mapLimit(projects, 6, async (p) => {
      const r = await analyzeProject(p, force);
      results.push(r);
      opts.onProject && opts.onProject(r);
    });
    return { projects, results };
  };

  // ── 浮层 UI（一次性构建：head + tabs + 三 pane，pane 内含 summary + list） ──
  let root = null;
  let refreshing = false;
  let activeTab = 'managed';
  const tabStates = {}; // tabKey → { done, error }（done 后切页签秒切）

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
      '    <span class="abc-tracker__refresh" title="刷新当前页签">↻</span>' +
      '    <span class="abc-tracker__close" title="关闭">✕</span>' +
      '  </div>' +
      '  <div class="abc-tracker__tabs">' +
      Object.keys(ADAPTERS).map((key) =>
        '<button class="abc-tracker__tab" data-tab="' + key + '">' + ADAPTERS[key].label + '</button>'
      ).join('') +
      '  </div>' +
      Object.keys(ADAPTERS).map((key) =>
        '<div class="abc-tracker__pane" data-pane="' + key + '">' +
        '  <div class="abc-tracker__summary"></div>' +
        '  <div class="abc-tracker__list"></div>' +
        '</div>'
      ).join('') +
      '</div>';
    document.documentElement.appendChild(root);
    root.querySelector('.abc-tracker__close').addEventListener('click', close);
    root.querySelector('.abc-tracker__mask').addEventListener('click', close);
    root.querySelector('.abc-tracker__refresh').addEventListener('click', () => loadTab(activeTab, true));
    root.querySelector('.abc-tracker__tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.abc-tracker__tab');
      if (btn) switchTab(btn.dataset.tab);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    // 卡点条目按钮（事件委托挂 panel 根：三页签通用）
    root.querySelector('.abc-tracker__panel').addEventListener('click', (e) => {
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
    setTabActiveUI(activeTab);
    loadTab(activeTab, false); // 打开即刷新当前页签（缓存 TTL 内零请求秒开）
  };

  const close = () => { if (root) root.classList.remove('show'); };

  const paneEl = (key) => root.querySelector('.abc-tracker__pane[data-pane="' + key + '"]');
  const summaryEl = (key) => paneEl(key).querySelector('.abc-tracker__summary');
  const listEl = (key) => paneEl(key).querySelector('.abc-tracker__list');

  const setBusy = (busy) => {
    refreshing = busy;
    root.querySelector('.abc-tracker__refresh').classList.toggle('is-busy', busy);
  };

  const setTabActiveUI = (key) => {
    Object.keys(ADAPTERS).forEach((k) => {
      root.querySelector('.abc-tracker__tab[data-tab="' + k + '"]').classList.toggle('is-active', k === key);
      paneEl(k).classList.toggle('is-active', k === key);
    });
  };

  const switchTab = (key) => {
    if (!ADAPTERS[key] || key === activeTab) return;
    activeTab = key;
    setTabActiveUI(key);
    const st = tabStates[key];
    if (st && st.done) return; // 已分析过：DOM 保留即秒切
    loadTab(key, false); // 惰性加载（缓存 TTL 内零请求）
  };

  // 单个项目条目 HTML（卡点 flow → 条目；无卡点项目不产生条目）
  const flowItemHtml = (r, f) => {
    if (f.failed) {
      return '<div class="abc-tracker__item abc-tracker__item--failed">' +
        '  <div class="abc-tracker__item-main">' +
        '    <div class="abc-tracker__proj">' + esc(r.projname) + (r.projectno ? ' · ' + esc(r.projectno) : '') + '</div>' +
        '    <div class="abc-tracker__flow">' + esc(f.flowName) + '</div>' +
        '    <div class="abc-tracker__failed-note">⚠ 流程图解析失败（ITA 可能已改版），请打开流程图自查</div>' +
        '  </div>' +
        '  <div class="abc-tracker__actions"><button class="abc-tracker__btn" data-act="open" data-proc="' + esc(f.idProc) + '">流程图 ↗</button></div>' +
        '</div>';
    }
    if (!f.nodes.length) return '';
    const maxWait = Math.max.apply(null, f.nodes.reduce((a, n) => a.concat(n.rows.map((x) => x.waitMs || 0)), [0]));
    const late = maxWait > 24 * 3600e3 ? ' is-late' : '';
    const stuckHtml = f.nodes.map((n) => {
      const names = n.rows.map((x) => esc(x.person)).join('、');
      const wait = Math.max.apply(null, n.rows.map((x) => x.waitMs || 0));
      return '<div class="abc-tracker__stuck-line">' +
        '<span class="abc-tracker__node">' + esc(n.node) + '</span>' +
        '<span class="abc-tracker__arrow">→</span>' +
        '<span class="abc-tracker__person">' + names + '</span>' +
        '<span class="abc-tracker__dur' + late + '">已等待 ' + esc(fmtWait(wait)) + '</span>' +
        '</div>';
    }).join('');
    // 催办话术取等待最久的卡点（最需要催的一处，与条目上的最长等待一致）
    let worst = null;
    f.nodes.forEach((n) => n.rows.forEach((x) => {
      if (!worst || (x.waitMs || 0) > (worst.row.waitMs || 0)) worst = { node: n.node, row: x };
    }));
    const copyText = '【催办】' + r.projname + '「' + f.flowName + '」当前环节「' + worst.node +
      '」待 ' + worst.row.person + ' 处理（已等待 ' + fmtWait(maxWait) + '），请及时处理。';
    return '<div class="abc-tracker__item">' +
      '  <div class="abc-tracker__item-main">' +
      '    <div class="abc-tracker__proj">' + esc(r.projname) + (r.projectno ? ' · ' + esc(r.projectno) : '') + '</div>' +
      '    <div class="abc-tracker__flow">' + esc(f.flowName) + '</div>' +
      stuckHtml +
      '  </div>' +
      '  <div class="abc-tracker__actions">' +
      (r.pm
        ? '<button class="abc-tracker__btn abc-tracker__btn--primary" data-act="teams" data-clurl="' + esc(r.pm.url) + '">💬 项目经理·' + esc(r.pm.name) + '</button>'
        : '') +
      '<button class="abc-tracker__btn" data-act="copy" data-copy="' + esc(copyText) + '">📋 催办话术</button>' +
      '<button class="abc-tracker__btn" data-act="open" data-proc="' + esc(f.idProc) + '">流程图 ↗</button>' +
      '  </div>' +
      '</div>';
  };

  // 渐进渲染：清单到位铺占位行；单项目完成即移除占位、条目插到列表顶部
  const onListArrive = (key, projects) => {
    listEl(key).innerHTML = projects.map((p) =>
      '<div class="abc-tracker__pending" data-prjid="' + esc(p.prjid) + '">⏳ ' +
      esc(p.projname || p.prjid) + ' · 分析中…</div>').join('');
  };

  const onProjectArrive = (key, r) => {
    const pending = listEl(key).querySelector('.abc-tracker__pending[data-prjid="' + r.prjid + '"]');
    if (pending && pending.parentNode) pending.parentNode.removeChild(pending);
    if (r.err) return; // 项目级失败静默跳过（概览条统一计数）
    let html = '';
    r.flows.forEach((f) => { html += flowItemHtml(r, f); });
    if (html) listEl(key).insertAdjacentHTML('afterbegin', html);
  };

  // 页签概览条
  const renderSummary = (key, projects, results, projErr) => {
    const runningCount = results.reduce((a, r) => a + r.flows.length, 0);
    const stuckCount = results.reduce((a, r) =>
      a + r.flows.reduce((x, f) => x + (f.failed ? 0 : f.nodes.length), 0), 0);
    summaryEl(key).innerHTML =
      '<span class="abc-tracker__cell">参加 <span class="abc-tracker__num">' + projects.length + '</span> 个项目</span>' +
      '<span class="abc-tracker__sep">·</span>' +
      '<span class="abc-tracker__cell">运行中流程 <span class="abc-tracker__num">' + runningCount + '</span> 个</span>' +
      '<span class="abc-tracker__sep">·</span>' +
      '<span class="abc-tracker__cell' + (stuckCount > 0 ? ' abc-tracker__stuck-count' : '') + '">卡点 <span class="abc-tracker__num">' + stuckCount + '</span> 处</span>' +
      (projErr > 0 ? '<span class="abc-tracker__sep">·</span><span class="abc-tracker__projerr">' + projErr + ' 个项目详情获取失败</span>' : '');
  };

  // 页签加载主流程（force=true 时绕过缓存全量重查）
  const loadTab = async (key, force) => {
    if (refreshing) return;
    setBusy(true);
    summaryEl(key).innerHTML = '<span class="abc-tracker__loading">正在获取项目清单…</span>';
    const list = listEl(key);
    list.innerHTML = '';
    try {
      const { projects, results } = await analyzeTab(key, {
        force,
        onProgress: (msg) => { summaryEl(key).innerHTML = '<span class="abc-tracker__loading">' + esc(msg) + '</span>'; },
        onList: (projects) => onListArrive(key, projects),
        onProject: (r) => onProjectArrive(key, r),
      });
      const projErr = results.filter((r) => r.err).length;
      renderSummary(key, projects, results, projErr);

      // 完成态收尾：折叠行 + 空态兜底（条目已渐进插入，不再重排）
      const stuckFlows = results.reduce((a, r) => a + r.flows.filter((f) => !f.failed && f.nodes.length).length, 0);
      const allFlows = results.reduce((a, r) => a + r.flows.length, 0);
      const clean = allFlows - results.reduce((a, r) => a + r.flows.filter((f) => f.failed || f.nodes.length).length, 0);
      if (clean > 0) {
        list.insertAdjacentHTML('beforeend', '<div class="abc-tracker__clean">另有 ' + clean + ' 个运行中流程暂无卡点</div>');
      }
      if (!stuckFlows && !results.some((r) => r.flows.some((f) => f.failed))) {
        list.insertAdjacentHTML('afterbegin', allFlows
          ? '<div class="abc-tracker__empty">所有运行中流程都没有卡点 🎉</div>'
          : '<div class="abc-tracker__empty">当前没有运行中的流程 🎉</div>');
      }
      tabStates[key] = { done: true };
    } catch (e) {
      summaryEl(key).innerHTML = '';
      list.innerHTML = '<div class="abc-tracker__error">无法获取项目清单：' + esc(e.message || e) +
        '。请确认已在 ita.abc 登录；若刚登录请点右上角 ↻ 重试。</div>';
      tabStates[key] = { done: false, error: String(e && e.message || e) };
    } finally {
      setBusy(false);
    }
  };

  // 悬浮球菜单入口（content.js 菜单项点击时调用）
  window.__abcTrackerOpen = open;
})();
