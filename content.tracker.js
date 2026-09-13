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
  // 共享核心（tracker-watch.js，manifest 在本文件之前加载）：卡点解析/指纹/diff
  const CORE = globalThis.__abcWatchCore || {};
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const decodeEntities = CORE.decodeEntities; // 共享核心（tracker-watch.js）

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
  // 实现抽到 tracker-watch.js 共享核心（background SW 轮询关注流程时复用；
  // SW 无 DOM，实体解码为纯字符串实现）。此处仅补 waitMs 计算与 DOM 解码兼容。
  const parseStuckNodes = (html, now) => {
    now = now || Date.now();
    return (CORE.parseStuckNodes || function () { return []; })(html).map((n) => ({
      node: n.node,
      rows: n.rows.map((x) => {
        let waitMs = NaN;
        if (x.since) {
          const d = new Date(x.since.replace(/-/g, '/'));
          if (!isNaN(d.getTime())) waitMs = now - d.getTime();
        }
        return Object.assign({}, x, { waitMs });
      }),
    }));
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
  // 外部数据集覆盖：mock-data/tracker-mock-data.js 先于本文件加载时定义 globalThis.__abcTrackerMockData，
  // 下方各 MOCK_* 整体替换为外部同构数据；未加载时内置数据生效，行为与历史版本完全一致。
  const EXT = (typeof globalThis !== 'undefined' && globalThis.__abcTrackerMockData) || null;
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
  const MOCK_GRP = (EXT && EXT.grp) || [
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
  const MOCK_GRID = (EXT && EXT.grid) || [
    { prjid: 'PRJZH0090001', projname: '账务核心系统升级项目', projectno: '科维2026-0901' },
    { prjid: 'PRJZH0026003', projname: '智能风控平台二期', projectno: 'XRK2026003' },
  ];
  // 我管理的（myManagedProj）：status=1 在管项目与「我参与的」项目1 重叠（验证跨页签缓存共享）
  const MOCK_MANAGED_ACTIVE = (EXT && EXT.managedActive) || [
    { prjid: 'PRJZH0090001', projname: '账务核心系统升级项目', projectno: '科维2026-0901',
      projManClurl: 'abcteams://?who=990000010&where=ITA&how=gotoSingleChat&targetUserName=' + encodeURIComponent('冯癸') + '&targetUsapId=990000010' },
  ];
  // status=5 运维结项项目：processList 为空 → 无运行中流程
  const MOCK_MANAGED_OPS = (EXT && EXT.managedOps) || [
    { prjid: 'PRJZH0090099', projname: '核心账务平台运维保障', projectno: '科维2025-0999', projManClurl: '' },
  ];

  const MOCK_PROJ = (EXT && EXT.proj) || {
    PRJZH0090001: {
      projname: '账务核心系统升级项目',
      // 角色 Clurl 组（姓名→900 工号）：「我参与的」页签按概况返回的经理姓名反查工号
      projManClurl: 'abcteams://?who=990009001&where=ITA&how=gotoSingleChat&targetUserName=' + encodeURIComponent('周己') + '&targetUsapId=990009001',
      techManClurl: 'abcteams://?who=990009002&where=ITA&how=gotoSingleChat&targetUserName=' + encodeURIComponent('郑辛') + '&targetUsapId=990009002',
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
  const MOCK_OVERVIEW = (EXT && EXT.overview) || {
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
      return Object.assign({}, p, { clurlMap: extractClurlMap(p) });
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
      clurlMap: extractClurlMap(d), // 角色 Clurl 组（姓名→900 工号），「我参与的」反查工号用
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
      // 外部数据集优先（mock-data/tracker-mock-data.js 的 flowHtml 按 idProc 索引）
      if (EXT && EXT.flowHtml && Object.prototype.hasOwnProperty.call(EXT.flowHtml, idProc)) {
        return EXT.flowHtml[idProc];
      }
      if (idProc === 6341400000000007) return MOCK_HTML_REVIEW;
      if (idProc === 6338439828800001) return MOCK_HTML_CHECK;
      if (idProc === 770000001) return MOCK_HTML_GRP;
      return '<html></html>'; // 其余流程：运行中但无卡点（验证折叠行）
    }
    const resp = await fetch(URL_IMG + encodeURIComponent(idProc), { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.text();
  };

  // Teams 单聊深链（格式取自 ITA 抓包 Clurl；who/targetUsapId 必须 900 开头数字工号，
  // 域账号（yishuai 式）实测拉不起会话）
  const teamsUrl = (name, id) =>
    'abcteams://?who=' + encodeURIComponent(id) + '&where=ITA&how=gotoSingleChat' +
    '&targetUserName=' + encodeURIComponent(name) + '&targetUsapId=' + encodeURIComponent(id);

  // 从原生 Clurl 提取 { name, url }（我管理的响应自带数字工号深链，直接可用）
  const pmFromClurl = (clurl) => {
    if (!clurl) return null;
    const m = String(clurl).match(/targetUserName=([^&]+)/);
    return { name: m ? decodeURIComponent(m[1]) : '', url: String(clurl) };
  };

  // 项目详情响应的角色 Clurl 组 → { 姓名: 数字工号 } 映射。
  // searchProj2022 概况的项目经理只有域账号（projManID=yishuai 式），
  // 按姓名在此映射中反查 900 开头工号（详情响应本来就要查，零额外请求）
  const extractClurlMap = (d) => {
    const map = {};
    if (!d || typeof d !== 'object') return map;
    Object.keys(d).forEach((k) => {
      const v = d[k];
      if (typeof v !== 'string' || v.indexOf('abcteams://') !== 0) return;
      const who = (v.match(/[?&]who=([^&]+)/) || [])[1];
      const nm = (v.match(/targetUserName=([^&]+)/) || [])[1];
      if (who && nm) map[decodeURIComponent(nm)] = decodeURIComponent(who);
    });
    return map;
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
        if (!out.length) return []; // 不是所有人都有在管项目：空清单走友好空态，不报错
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
      let clurlMap = null; // 详情响应的角色 Clurl 组（姓名→工号），供「我参与的」反查工号
      if (!processList) {
        let detail = force ? null : cached(cacheDetail, p.prjid, TTL_SHORT);
        if (!detail) {
          detail = await apiProj(p.prjid);
          store(cacheDetail, p.prjid, detail);
        }
        if (detail.projname) out.projname = detail.projname;
        processList = detail.processList || [];
        clurlMap = detail.clurlMap || null;
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

      // 项目经理：managed/funcgroup 来源 fetchProjects 已带原生深链；joined 来源仅对
      // 有卡点项目查概况（searchProj2022 只有域账号），工号从详情 Clurl 组按姓名反查
      if (!out.pm && out.flows.some((f) => f.nodes.length)) {
        let pm = force ? null : cached(cachePm, p.prjid, TTL_LONG);
        if (!pm) {
          try { pm = await apiProjOverview(p.prjid, out.projname); } catch (e) { pm = {}; }
          store(cachePm, p.prjid, pm);
        }
        if (pm && pm.projMan) {
          const no = clurlMap ? clurlMap[pm.projMan] : null; // 900 开头数字工号
          // 工号匹配到才给深链按钮（域账号实测拉不起 Teams）；匹配不到仅保留催办话术中的姓名
          out.pm = no ? { name: pm.projMan, url: teamsUrl(pm.projMan, no) } : null;
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

  // ══════════════════════════════════════════════════════════
  //  催办话术模板：⚙ 设置中可自定义，占位符在复制时替换
  //  存储 chrome.storage.local fcUrgeTemplate（非扩展环境退回默认值）
  // ══════════════════════════════════════════════════════════
  const URGE_KEY = 'fcUrgeTemplate';
  const URGE_DEFAULT = '{处理人}您好，「{项目}」的「{流程}」流程目前在「{环节}」环节已等待 {等待}，麻烦您方便时跟进处理，如有疑问欢迎随时沟通，谢谢！';
  const URGE_VARS = [
    { key: '{项目}', desc: '项目名称' },
    { key: '{流程}', desc: '流程名称' },
    { key: '{环节}', desc: '卡点环节' },
    { key: '{处理人}', desc: '待处理人' },
    { key: '{等待}', desc: '已等待时长' },
  ];
  // 预览样例（与 mock 数据同一套脱敏人名）
  const URGE_SAMPLE = { proj: '账务核心系统升级项目', flow: '代码检查(第2次)', node: '代码检查', person: '钱丁', wait: '22 小时 22 分' };
  let urgeText = URGE_DEFAULT; // 渲染期取值，open() 时异步装载
  const renderUrge = (tpl, ctx) => String(tpl || URGE_DEFAULT)
    .replace(/\{项目\}/g, ctx.proj)
    .replace(/\{流程\}/g, ctx.flow)
    .replace(/\{环节\}/g, ctx.node)
    .replace(/\{处理人\}/g, ctx.person)
    .replace(/\{等待\}/g, ctx.wait);
  const Urge = {
    async get() {
      try {
        const r = await new Promise((resolve) => {
          try {
            chrome.storage.local.get([URGE_KEY], (res) => {
              void (chrome.runtime && chrome.runtime.lastError); // 规避未检查告警，读失败即用默认
              resolve((res && res[URGE_KEY]) || null);
            });
          } catch (e) { resolve(null); }
        });
        return (typeof r === 'string' && r.trim()) ? r : URGE_DEFAULT;
      } catch (e) { return URGE_DEFAULT; }
    },
    async save(tpl) {
      const val = (tpl && tpl.trim()) ? tpl : URGE_DEFAULT;
      urgeText = val;
      try { await chrome.storage.local.set({ [URGE_KEY]: val }); } catch (e) { /* 非扩展环境仅内存生效 */ }
      return val;
    },
  };

  // ══════════════════════════════════════════════════════════
  //  关注功能（流程级）：storage 结构 / 星标 / 「★ 关注」视图 / 设置 / 被动摘要
  //  轮询与系统通知在 background SW（alarms 周期由 intervalMin 驱动）
  // ══════════════════════════════════════════════════════════
  const WATCH_KEY = 'fcWatchList';
  const INTERVALS = [5, 10, 15, 30];
  let watchCache = null;       // 打开面板期间的关注数据缓存（避免渲染时反复读 storage）
  let watchSummaryShown = false;

  const Watch = {
    async get() {
      if (watchCache) return watchCache;
      try {
        watchCache = await new Promise((resolve) => {
          chrome.storage.local.get([WATCH_KEY], (r) =>
            resolve((r && r[WATCH_KEY]) || { intervalMin: 10, unread: 0, lastChanges: [], items: {} }));
        });
      } catch (e) { watchCache = { intervalMin: 10, unread: 0, lastChanges: [], items: {} }; }
      if (!watchCache.items) watchCache.items = {};
      return watchCache;
    },
    async save() {
      if (!watchCache) return;
      try { await chrome.storage.local.set({ [WATCH_KEY]: watchCache }); } catch (e) { /* 非扩展环境 */ }
    },
    invalidate() { watchCache = null; }, // onChanged 时丢弃缓存，下次 get 重读
    isWatched(prjid, flowName) {
      const w = watchCache;
      return !!(w && w.items[prjid] && w.items[prjid].flows[flowName]);
    },
    // 星标切换（关注 = 记录当前指纹；取消 = 移除流程；项目 flows 清空则移除项目）
    async toggle(prjid, projname, flowName, nodes) {
      const w = await this.get();
      if (!w.items[prjid]) w.items[prjid] = { projname: projname || '', flows: {} };
      w.items[prjid].projname = projname || w.items[prjid].projname || '';
      const flows = w.items[prjid].flows;
      if (flows[flowName]) delete flows[flowName];
      else flows[flowName] = { fp: CORE.flowFingerprint(nodes), addedAt: Date.now() };
      if (!Object.keys(flows).length) delete w.items[prjid];
      await this.save();
    },
    async cancel(prjid, flowName) {
      const w = await this.get();
      if (w.items[prjid] && w.items[prjid].flows) {
        delete w.items[prjid].flows[flowName];
        if (!Object.keys(w.items[prjid].flows).length) delete w.items[prjid];
      }
      await this.save();
    },
    async setInterval(min) {
      const w = await this.get();
      w.intervalMin = min;
      await this.save(); // background 监听 onChanged 重建 alarm
    },
    // 被动层：展示 lastChanges 后清零（badge 由 background onChanged 清）
    async consumeChanges() {
      const w = await this.get();
      const changes = w.lastChanges || [];
      if (w.unread || changes.length) {
        w.unread = 0;
        w.lastChanges = [];
        await this.save();
      }
      return changes;
    },
    watchedCount() {
      const w = watchCache;
      if (!w) return 0;
      return Object.keys(w.items || {}).reduce((a, p) => a + Object.keys(w.items[p].flows || {}).length, 0);
    },
  };

  // ── 「★ 关注」虚拟页签：跨页签聚合已关注流程（仅拉被关注项目的详情/卡点） ──
  const loadWatchTab = async (force) => {
    const w = await Watch.get();
    const prjids = Object.keys(w.items || {});
    const summary = summaryEl('watch');
    const list = listEl('watch');
    list.innerHTML = '';
    if (!prjids.length) {
      summary.innerHTML = '<span class="abc-tracker__loading">暂无关注——在流程条目右侧点 <i class="el-icon-star-off"></i> 关注后，流程有变动会在这里汇总并通知</span>';
      return;
    }
    summary.innerHTML = '<span class="abc-tracker__loading">正在获取 ' + prjids.length + ' 个关注项目…</span>';
    let done = 0;
    let changes = 0;
    await mapLimit(prjids, 6, async (prjid) => {
      const item = w.items[prjid];
      let r = null;
      try { r = await analyzeProject({ prjid: prjid, projname: item.projname }, force); } catch (e) { /* 单项目失败静默 */ }
      done++;
      if (summaryEl('watch')) {
        summary.innerHTML = '<span class="abc-tracker__loading">正在获取关注项目… ' + done + '/' + prjids.length + '</span>';
      }
      if (!r || r.err) return;
      // 只渲染被关注的流程；顺带把「已无卡点」的被关注流程提示出来（SW 会自动移除关注，这里兜底展示）
      r.flows.forEach((f) => {
        if (!Watch.isWatched(r.prjid, f.flowName)) return;
        if (!f.nodes.length) {
          changes++;
          list.insertAdjacentHTML('afterbegin',
            '<div class="abc-tracker__item"><div class="abc-tracker__item-main">' +
            '<div class="abc-tracker__proj">' + esc(r.projname) + '</div>' +
            '<div class="abc-tracker__flow">' + esc(f.flowName) + '</div>' +
            '<div class="abc-tracker__clean-inline"><i class="el-icon-circle-check"></i> 当前无卡点（流程可能已推进完成）</div></div>' +
            '<div class="abc-tracker__actions"><button class="abc-tracker__btn" data-act="watch-toggle" data-prjid="' + esc(r.prjid) +
            '" data-proj="' + esc(r.projname) + '" data-flow="' + esc(f.flowName) + '" data-proc="' + esc(f.idProc) + '"><i class="el-icon-close"></i> 取消关注</button></div></div>');
          return;
        }
        changes++;
        let html = flowItemHtml(r, f);
        // 关注视图条目追加 ✕ 取消关注按钮（插到 actions 组首）
          html = html.replace('<div class="abc-tracker__actions">',
          '<div class="abc-tracker__actions"><button class="abc-tracker__btn" data-act="watch-toggle" data-prjid="' + esc(r.prjid) +
            '" data-proj="' + esc(r.projname) + '" data-flow="' + esc(f.flowName) + '" data-proc="' + esc(f.idProc) +
            '" title="取消关注该流程"><i class="el-icon-star-on"></i> 已关注</button>');
        list.insertAdjacentHTML('afterbegin', html);
      });
    });
    summary.innerHTML =
      '<span class="abc-tracker__cell">关注 <span class="abc-tracker__num">' + prjids.length + '</span> 个项目</span>' +
      '<span class="abc-tracker__sep">·</span>' +
      '<span class="abc-tracker__cell">被关注流程 <span class="abc-tracker__num">' + Watch.watchedCount() + '</span> 条</span>';
    if (!changes) {
      list.innerHTML = '<div class="abc-tracker__empty"><i class="el-icon-circle-check"></i> 被关注的流程当前均无卡点</div>';
    }
  };

  // ── 被动摘要条：打开面板时展示轮询期间的变化并清零 ──
  const renderWatchSummaryBar = (changes) => {
    const old = root.querySelector('.abc-tracker__watchbar');
    if (old) old.remove();
    if (!changes || !changes.length) return;
    const lines = changes.slice(0, 3).map((c) =>
      '<div class="abc-tracker__watchbar-line">· <b>' + esc(c.projname) + '</b>「' + esc(c.flow) + '」' + esc(c.brief) + '</div>').join('');
    const more = changes.length > 3 ? '<div class="abc-tracker__watchbar-line">…等 ' + changes.length + ' 条更新</div>' : '';
    root.querySelector('.abc-tracker__tabs').insertAdjacentHTML('beforebegin',
      '<div class="abc-tracker__watchbar">' +
      '<div class="abc-tracker__watchbar-head"><i class="el-icon-bell"></i> 自上次查看，' + changes.length + ' 条关注流程有更新</div>' +
      lines + more + '</div>');
  };

  const consumeWatchSummary = async () => {
    try {
      const changes = await Watch.consumeChanges();
      renderWatchSummaryBar(changes);
      watchSummaryShown = true;
    } catch (e) { /* 非扩展环境 */ }
  };

  // ── 设置条（轮询间隔档位 + 手动检查 + 催办话术模板） ──
  const toggleSettings = async () => {
    let bar = root.querySelector('.abc-tracker__settings-bar');
    if (bar) { bar.remove(); return; }
    const w = await Watch.get();
    const tpl = await Urge.get();
    const cur = INTERVALS.includes(w.intervalMin) ? w.intervalMin : 10;
    bar = document.createElement('div');
    bar.className = 'abc-tracker__settings-bar';
    bar.innerHTML =
      '<div class="abc-tracker__settings-row">' +
      '<span class="abc-tracker__settings-label">关注轮询间隔</span>' +
      INTERVALS.map((m) =>
        '<button class="abc-tracker__settings-opt' + (m === cur ? ' is-on' : '') + '" data-min="' + m + '">' + m + ' 分钟</button>').join('') +
      '<button class="abc-tracker__settings-opt" data-act-poll="1">立即检查更新</button>' +
      '<span class="abc-tracker__settings-note">仅浏览器开启时生效</span>' +
      '</div>' +
      '<div class="abc-tracker__settings-row abc-tracker__settings-row--col">' +
      '<span class="abc-tracker__settings-label">催办话术模板</span>' +
      '<div class="abc-tracker__urge-editor">' +
      '<textarea class="abc-tracker__urge-text" rows="2" spellcheck="false">' + esc(tpl) + '</textarea>' +
      '<div class="abc-tracker__urge-vars">' +
      URGE_VARS.map((v) =>
        '<button type="button" class="abc-tracker__settings-opt abc-tracker__urge-var" data-urge-var="' + v.key +
        '" title="插入' + esc(v.desc) + '（复制催办话术时替换为实际值）">' + v.key + '</button>').join('') +
      '<span class="abc-tracker__settings-note">点变量插入到光标处</span>' +
      '</div>' +
      '<div class="abc-tracker__urge-preview">' +
      '<span class="abc-tracker__urge-preview-label">预览</span>' +
      '<span class="abc-tracker__urge-preview-text"></span>' +
      '</div>' +
      '<div class="abc-tracker__urge-ops">' +
      '<button type="button" class="abc-tracker__settings-opt" data-urge-act="reset">恢复默认文案</button>' +
      '<button type="button" class="abc-tracker__settings-opt is-primary" data-urge-act="save">保存模板</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    root.querySelector('.abc-tracker__head').insertAdjacentElement('afterend', bar);

    // 预览：随输入即时以样例数据渲染（所见即复制所得）
    const updateUrgePreview = () => {
      const ta = bar.querySelector('.abc-tracker__urge-text');
      const el = bar.querySelector('.abc-tracker__urge-preview-text');
      if (ta && el) el.textContent = renderUrge(ta.value, URGE_SAMPLE);
    };
    updateUrgePreview();
    const ta = bar.querySelector('.abc-tracker__urge-text');
    if (ta) ta.addEventListener('input', updateUrgePreview);

    bar.addEventListener('click', async (e) => {
      const opt = e.target.closest('[data-min],[data-act-poll],[data-urge-var],[data-urge-act]');
      if (!opt) return;
      if (opt.dataset.min) {
        await Watch.setInterval(Number(opt.dataset.min));
        bar.querySelectorAll('.abc-tracker__settings-opt[data-min]').forEach((b) =>
          b.classList.toggle('is-on', Number(b.dataset.min) === Number(opt.dataset.min)));
        setStatusMsg('关注轮询间隔已设为 ' + opt.dataset.min + ' 分钟。');
      } else if (opt.dataset.actPoll) {
        opt.textContent = '检查中…';
        try {
          await chrome.runtime.sendMessage({ type: 'WATCH_POLL_NOW' });
        } catch (err) { /* SW 未就绪时静默 */ }
        setTimeout(() => { opt.textContent = '立即检查更新'; }, 1500);
      } else if (opt.dataset.urgeVar) {
        // 变量 chip：插入到光标处（替换选中段），保持焦点
        if (!ta) return;
        const ins = opt.dataset.urgeVar;
        const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
        const t2 = ta.selectionEnd == null ? s : ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + ins + ta.value.slice(t2);
        const pos = s + ins.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
        updateUrgePreview();
      } else if (opt.dataset.urgeAct === 'save') {
        if (!ta) return;
        opt.textContent = '保存中…';
        await Urge.save(ta.value);
        opt.innerHTML = '<i class="el-icon-check"></i> 已保存';
        setTimeout(() => { opt.textContent = '保存模板'; }, 1500);
        loadTab(activeTab, false); // 重建条目，让新话术立刻生效
      } else if (opt.dataset.urgeAct === 'reset') {
        if (!ta) return;
        ta.value = URGE_DEFAULT;
        updateUrgePreview();
      }
    });
  };

  const setStatusMsg = (msg) => {
    if (!root) return;
    summaryEl(activeTab === 'watch' ? 'watch' : activeTab).innerHTML =
      '<span class="abc-tracker__loading">' + esc(msg) + '</span>';
  };

  // ── fcWatchFocus：通知点击 → 打开面板并定位关注视图 ──
  const consumeWatchFocus = async () => {
    try {
      chrome.storage.local.get(['fcWatchFocus'], async (r) => {
        const focus = r && r.fcWatchFocus;
        if (!focus) return;
        chrome.storage.local.remove(['fcWatchFocus']);
        open();
        switchTab('watch');
        setTimeout(() => {
          const item = Array.from(root.querySelectorAll('.abc-tracker__item')).find((el) =>
            el.querySelector('.abc-tracker__proj') &&
            el.querySelector('.abc-tracker__proj').textContent.indexOf(focus.projname || '') >= 0);
          if (item) {
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
            item.classList.add('is-focus');
            setTimeout(() => item.classList.remove('is-focus'), 3000);
          }
        }, 1200);
      });
    } catch (e) { /* 非扩展环境 */ }
  };


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
      '    <span class="abc-tracker__logo"><i class="el-icon-timer"></i></span>' +
      '    <span class="abc-tracker__title">进度跟踪</span>' +
      (MOCK ? '<span class="abc-tracker__mockbadge">模拟数据</span>' : '') +
      '    <span class="abc-tracker__refresh" title="刷新当前页签"><i class="el-icon-refresh"></i></span>' +
      '    <span class="abc-tracker__settings" title="关注设置"><i class="el-icon-setting"></i></span>' +
      '    <span class="abc-tracker__close" title="关闭"><i class="el-icon-close"></i></span>' +
      '  </div>' +
      '  <div class="abc-tracker__tabs">' +
      Object.keys(ADAPTERS).map((key) =>
        '<button class="abc-tracker__tab" data-tab="' + key + '">' + ADAPTERS[key].label + '</button>'
      ).join('') +
      '<button class="abc-tracker__tab abc-tracker__tab--watch" data-tab="watch"><i class="el-icon-star-on"></i> 关注</button>' +
      '  </div>' +
      Object.keys(ADAPTERS).map((key) =>
        '<div class="abc-tracker__pane" data-pane="' + key + '">' +
        '  <div class="abc-tracker__summary"></div>' +
        '  <div class="abc-tracker__list"></div>' +
        '</div>'
      ).join('') +
      '<div class="abc-tracker__pane" data-pane="watch">' +
      '  <div class="abc-tracker__summary"></div>' +
      '  <div class="abc-tracker__list"></div>' +
      '</div>' +
      '</div>';
    document.documentElement.appendChild(root);
    root.querySelector('.abc-tracker__close').addEventListener('click', close);
    root.querySelector('.abc-tracker__mask').addEventListener('click', close);
    root.querySelector('.abc-tracker__refresh').addEventListener('click', () => loadTab(activeTab, true));
    root.querySelector('.abc-tracker__settings').addEventListener('click', () => toggleSettings());
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
        const done = () => { btn.innerHTML = '<i class="el-icon-check"></i> 已复制'; setTimeout(() => { btn.innerHTML = '<i class="el-icon-document-copy"></i> 催办话术'; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
        } else fallbackCopy(text, done);
      } else if (act === 'teams') {
        const clurl = btn.dataset.clurl || '';
        if (clurl) window.open(clurl, '_blank');
      } else if (act === 'open') {
        window.open(URL_IMG + encodeURIComponent(btn.dataset.proc || ''), '_blank');
      } else if (act === 'watch-toggle') {
        // 星标切换：关注 = 记录当前卡点指纹；取消 = 移除（项目 flows 空则移除项目）
        const prjid = btn.dataset.prjid || '';
        const proj = btn.dataset.proj || '';
        const flow = btn.dataset.flow || '';
        const nodes = [];
        const item = btn.closest('.abc-tracker__item');
        if (item) {
          item.querySelectorAll('.abc-tracker__stuck-line').forEach((line) => {
            const node = (line.querySelector('.abc-tracker__node') || {}).textContent || '';
            const person = (line.querySelector('.abc-tracker__person') || {}).textContent || '';
            if (node) nodes.push({ node: node, rows: [{ person: person }] });
          });
        }
        Watch.toggle(prjid, proj, flow, nodes).then(() => {
          const wasOn = btn.classList.contains('is-on');
          btn.classList.toggle('is-on', !wasOn);
          btn.innerHTML = wasOn ? '<i class="el-icon-star-off"></i> 关注' : '<i class="el-icon-star-on"></i> 已关注';
          updateWatchTabLabel();
          if (activeTab === 'watch') loadTab('watch', false); // 取消关注后刷新关注视图
        });
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
    // 先加载关注数据（星标状态/页签徽标依赖）与话术模板，再刷新当前页签
    Promise.all([Watch.get(), Urge.get().then((t) => { urgeText = t; })]).then(() => {
      updateWatchTabLabel();
      consumeWatchSummary(); // 被动层：展示轮询期间的变化并清零角标
      consumeWatchFocus();   // 通知点击带入的定位（如有）
      loadTab(activeTab, false); // 打开即刷新当前页签（缓存 TTL 内零请求秒开）
    });
  };

  const close = () => { if (root) root.classList.remove('show'); };

  // 关注页签徽标：tab 文案上追加关注流程数
  const updateWatchTabLabel = () => {
    if (!root) return;
    const btn = root.querySelector('.abc-tracker__tab--watch');
    if (!btn) return;
    const n = Watch.watchedCount();
    btn.innerHTML = '<i class="el-icon-star-on"></i> 关注' + (n ? '(' + n + ')' : '');
  };

  const paneEl = (key) => root.querySelector('.abc-tracker__pane[data-pane="' + key + '"]');
  const summaryEl = (key) => paneEl(key).querySelector('.abc-tracker__summary');
  const listEl = (key) => paneEl(key).querySelector('.abc-tracker__list');

  const setBusy = (busy) => {
    refreshing = busy;
    root.querySelector('.abc-tracker__refresh').classList.toggle('is-busy', busy);
  };

  const setTabActiveUI = (key) => {
    const keys = Object.keys(ADAPTERS).concat(['watch']);
    keys.forEach((k) => {
      const tab = root.querySelector('.abc-tracker__tab[data-tab="' + k + '"]');
      if (tab) tab.classList.toggle('is-active', k === key);
      const pane = paneEl(k);
      if (pane) pane.classList.toggle('is-active', k === key);
    });
  };

  const switchTab = (key) => {
    if (key !== 'watch' && !ADAPTERS[key]) return;
    if (key === activeTab) return;
    activeTab = key;
    setTabActiveUI(key);
    if (key === 'watch') { loadTab('watch', false); return; }
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
        '    <div class="abc-tracker__failed-note"><i class="el-icon-warning"></i> 流程图解析失败（ITA 可能已改版），请打开流程图自查</div>' +
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
    // 催办话术取等待最久的卡点（最需要催的一处，与条目上的最长等待一致）；
    // 文案来自 ⚙ 设置的可配置模板（占位符 {项目}{流程}{环节}{处理人}{等待}）
    const copyText = renderUrge(urgeText, {
      proj: r.projname, flow: f.flowName, node: worst.node, person: worst.row.person, wait: fmtWait(maxWait),
    });
    const watched = Watch.isWatched(r.prjid, f.flowName);
    return '<div class="abc-tracker__item">' +
      '  <div class="abc-tracker__item-main">' +
      '    <div class="abc-tracker__proj">' + esc(r.projname) + (r.projectno ? ' · ' + esc(r.projectno) : '') + '</div>' +
      '    <div class="abc-tracker__flow">' + esc(f.flowName) + '</div>' +
      stuckHtml +
      '  </div>' +
      '  <div class="abc-tracker__actions">' +
      '<button class="abc-tracker__btn abc-tracker__btn--star' + (watched ? ' is-on' : '') +
      '" data-act="watch-toggle" data-prjid="' + esc(r.prjid) + '" data-proj="' + esc(r.projname) +
      '" data-flow="' + esc(f.flowName) + '" data-proc="' + esc(f.idProc) + '" title="关注该流程：有变动时通知">' +
      (watched ? '<i class="el-icon-star-on"></i> 已关注' : '<i class="el-icon-star-off"></i> 关注') + '</button>' +
      (r.pm
        ? '<button class="abc-tracker__btn abc-tracker__btn--primary" data-act="teams" data-clurl="' + esc(r.pm.url) + '"><i class="el-icon-chat-dot-round"></i> 项目经理·' + esc(r.pm.name) + '</button>'
        : '') +
      '<button class="abc-tracker__btn" data-act="copy" data-copy="' + esc(copyText) + '"><i class="el-icon-document-copy"></i> 催办话术</button>' +
      '<button class="abc-tracker__btn" data-act="open" data-proc="' + esc(f.idProc) + '">流程图 ↗</button>' +
      '  </div>' +
      '</div>';
  };

  // 渐进渲染：清单到位铺占位行；单项目完成即移除占位、条目插到列表顶部
  const onListArrive = (key, projects) => {
    listEl(key).innerHTML = projects.map((p) =>
      '<div class="abc-tracker__pending" data-prjid="' + esc(p.prjid) + '"><i class="el-icon-time"></i> ' +
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
    if (key === 'watch') {
      setBusy(true);
      try { await loadWatchTab(force); } finally { setBusy(false); }
      return;
    }
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
      if (!projects.length) {
        // 不是所有人都有在管/参与的项目（如「我管理的」对普通成员为空）：友好空态而非报错
        list.insertAdjacentHTML('afterbegin',
          '<div class="abc-tracker__empty">当前没有你管理的项目——仅项目经理、运维负责人会有</div>');
      } else if (!stuckFlows && !results.some((r) => r.flows.some((f) => f.failed))) {
        list.insertAdjacentHTML('afterbegin', allFlows
          ? '<div class="abc-tracker__empty"><i class="el-icon-circle-check"></i> 所有运行中流程都没有卡点</div>'
          : '<div class="abc-tracker__empty">当前没有运行中的流程</div>');
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

  // ── storage 变化联动：SW 轮询写入变化 → 刷新徽标与摘要条；通知点击 → 定位 ──
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[WATCH_KEY]) {
        Watch.invalidate();
        if (root && root.classList.contains('show')) {
          Watch.get().then(() => {
            updateWatchTabLabel();
            const w = watchCache;
            if (w && (w.lastChanges || []).length && !watchSummaryShown) consumeWatchSummary();
          });
        }
      }
      if (changes.fcWatchFocus && root && root.classList.contains('show')) consumeWatchFocus();
    });
  } catch (e) { /* 非扩展环境 */ }
})();
