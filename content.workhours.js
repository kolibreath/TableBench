// 项目工具插件 - 工时填报检查模块（悬浮球「工时填报检查」，页面内面板）
// ─────────────────────────────────────────────────────────────
// 结项前成员工时误差检查：项目工时汇总 → 选项目 → 成员明细统计 →
// 误差着色 → 复制邮箱/邮件文本 → 检查历史留痕。
//
// 数据链路（全部只读接口，content script 在 ita.abc 同源 fetch 自动带登录
// Cookie——替代原「Cookie 交本地后端伪装 XHR」的通路，工时功能不再依赖后端）：
//   ① POST /ita/rptWkld/bindWgldGridByMonth        项目工时汇总（全年 12 列，裸数组）
//      表单：year=<Y>&month=1&projname=&projectno=&pageSize=&page=
//   ② POST /ita/rptWkld/bindWgldGridDtlByMonth     成员明细（全年 12 列，裸数组）
//      query：prjid=<prjid>&year=<Y>&month=1
//   两年各调一次：清单只合并「今年仍存在」的去年项目；成员明细两年全量合并。
//
// 统计口径（忠实移植自原后端 workhours_service.py，与原工具结果一致）：
//   - typWkld="计划" 的 amtWkld 直接累加 = 目标工时（人天）
//   - typWkld="填报" 的 amtWkld ÷ 8 累加 = 已填报（小时 → 人天）
//   - 成员级 planned=0 → 完成率按 100%（无计划视为达标）
//   - 成员表按完成率升序、再按 id 排序；计划截止月 = 计划行最后一个有值月份
//
// 模块约束：独立 IIFE，不侵入 content.js 既有逻辑；入口仅 window.__abcWorkhoursOpen。
// 非 ita.abc 域（popup「测试悬浮球」注入的本地页）自动走内置 mock 数据。
(() => {
  if (window.__abcWorkhoursInjected) return;
  window.__abcWorkhoursInjected = true;

  const IS_ITA = /^https?:\/\/([a-z0-9.-]+\.)?ita\.abc\//i.test(location.href);
  const MOCK = !IS_ITA;

  const URL_GRID = 'http://ita.abc/ita/rptWkld/bindWgldGridByMonth';
  const URL_DTL = 'http://ita.abc/ita/rptWkld/bindWgldGridDtlByMonth';
  const MAIL_DOMAIN = '@abchina.com.cn';

  // mock 调用计数（测试基建）
  const mockCalls = MOCK ? (window.__workhoursMockCalls = { grid: 0, dtl: 0 }) : null;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ── 统计层（workhours_service.py 逐函数移植，口径注释原样保留） ──

  // 各项目计划中最后一个有工时的月份 → {prjid: "year-maxMonth"}（计划截止月）
  const calculateProjectLastDate = (rows, year) => {
    const stats = {};
    rows.forEach((item) => {
      const prjid = item.prjid;
      let maxMonth = 1;
      if (item.typWkld === '计划') {
        Object.keys(item).forEach((key) => {
          if (key.indexOf('amtWkld') === 0 && typeof item[key] === 'number' && item[key] > 0) {
            const month = parseInt(key.replace('amtWkld', ''), 10);
            if (month > maxMonth) maxMonth = month;
          }
        });
        stats[prjid] = year + '-' + maxMonth;
      }
    });
    return stats;
  };

  // 项目级汇总：target=计划直加；completed=填报÷8；完成率=completed/target*100
  const calculateProjectStats = (rows) => {
    const stats = {};
    rows.forEach((item) => {
      const prjid = item.prjid;
      if (!stats[prjid]) {
        stats[prjid] = { projname: item.projname || '', projectno: item.projectno || '', target_amt: 0, completed_amt: 0 };
      }
      Object.keys(item).forEach((key) => {
        if (key.indexOf('amtWkld') === 0 && typeof item[key] === 'number') {
          if (item.typWkld === '计划') stats[prjid].target_amt += item[key];
          else if (item.typWkld === '填报') stats[prjid].completed_amt += item[key] / 8;
        }
      });
    });
    return Object.keys(stats).map((prjid) => {
      const info = stats[prjid];
      const rate = info.target_amt === 0 ? 0 : info.completed_amt / info.target_amt * 100;
      return {
        id: prjid,
        projname: info.projname,
        projectno: info.projectno,
        target_amt: Math.round(info.target_amt * 100) / 100,
        completed_amt: Math.round(info.completed_amt * 100) / 100,
        achievement_rate: Math.round(rate * 100) / 100,
      };
    });
  };

  // 成员级汇总：planned=计划直加；actual=填报÷8；planned=0 → 100%；按完成率升序、再按 id
  const calculateCompletionRate = (dtl) => {
    const userStats = {};
    dtl.forEach((item) => {
      const userId = item.idUser;
      const typ = item.typWkld;
      if (!userStats[userId]) {
        userStats[userId] = { target_amt: 0, completed_amt: 0, name: item.namUser || '' };
      }
      for (let i = 1; i <= 12; i++) {
        const key = 'amtWkld' + i;
        if (key in item && item[key] !== null && item[key] !== undefined) {
          if (typ === '计划') userStats[userId].target_amt += item[key];
          else if (typ === '填报') userStats[userId].completed_amt += item[key] / 8;
        }
      }
    });
    return Object.keys(userStats)
      .map((userId) => {
        const info = userStats[userId];
        const rate = info.target_amt === 0 ? 100.0 : info.completed_amt / info.target_amt * 100;
        info.achievement_rate = Math.round(rate * 100) / 100;
        return { id: userId, name: info.name, target_amt: Math.round(info.target_amt * 100) / 100, completed_amt: Math.round(info.completed_amt * 100) / 100, achievement_rate: info.achievement_rate };
      })
      .sort((a, b) => (a.achievement_rate - b.achievement_rate) || (a.id < b.id ? -1 : 1));
  };

  // ── mock 数据（结构复刻抓包：裸数组、typWkld 计划/填报、amtWkld1..12；人名虚构） ──
  const mkRow = (typ, prjid, projname, projectno, idUser, namUser, months) => {
    const row = {
      id: null, idUser: idUser || null, namUser: namUser || null, typWkld: typ,
      codYear: null, prjid, projname, projectno, txtRem: null, redCols: [],
    };
    for (let i = 1; i <= 12; i++) row['amtWkld' + i] = months[i] || 0;
    return row;
  };
  const NOW_YEAR = new Date().getFullYear();
  const P1 = ['PRJZH0090001', '账务核心系统升级项目', '科维2026-0901'];
  const P2 = ['PRJZH0026003', '智能风控平台二期', 'XRK2026003'];
  const o = (m) => Object.assign({ 9: 0 }, m); // 主填 9 月
  // 项目汇总（今年 2 项目 + 去年仅 P1 仍存在）
  const MOCK_GRID_CUR = [
    mkRow('计划', P1[0], P1[1], P1[2], null, null, o({ 9: 15.5 })),
    mkRow('填报', P1[0], P1[1], P1[2], null, null, o({ 9: 100 })),   // 100h → 12.5 人天
    mkRow('计划', P2[0], P2[1], P2[2], null, null, o({ 9: 8 })),
    mkRow('填报', P2[0], P2[1], P2[2], null, null, o({ 9: 24 })),    // 24h → 3 人天
  ];
  const MOCK_GRID_LAST = [
    mkRow('计划', P1[0], P1[1], P1[2], null, null, o({ 9: 4.5 })),
    mkRow('填报', P1[0], P1[1], P1[2], null, null, o({ 9: 36 })),    // 36h → 4.5 人天
  ];
  // P1 成员明细（今年 + 去年）：
  //   张三 target=72+8=80 actual=(80+16)/8=12 → 15%   未填满
  //   李四 target=80      actual=640/8=80          → 100% 达标
  //   王五 planned=0（无计划行）                     → 100% 达标（口径：无计划视为达标）
  //   赵六 target=40+40=80 actual=(720+240)/8=120   → 150% 超填
  const MOCK_DTL_CUR = {
    PRJZH0090001: [
      mkRow('计划', P1[0], P1[1], P1[2], 'zhangsan', '张三[研发部一组]', o({ 8: 40, 9: 32 })),
      mkRow('填报', P1[0], P1[1], P1[2], 'zhangsan', '张三[研发部一组]', o({ 9: 80 })),
      mkRow('计划', P1[0], P1[1], P1[2], 'lisi', '李四[研发部一组]', o({ 9: 80 })),
      mkRow('填报', P1[0], P1[1], P1[2], 'lisi', '李四[研发部一组]', o({ 9: 640 })),
      mkRow('填报', P1[0], P1[1], P1[2], 'wangwu', '王五[研发部二组]', o({ 9: 40 })), // 无计划行
      mkRow('计划', P1[0], P1[1], P1[2], 'zhaoliu', '赵六[研发部二组]', o({ 9: 40 })),
      mkRow('填报', P1[0], P1[1], P1[2], 'zhaoliu', '赵六[研发部二组]', o({ 8: 240, 9: 480 })),
    ],
    PRJZH0026003: [
      mkRow('计划', P2[0], P2[1], P2[2], 'zhangsan', '张三[研发部一组]', o({ 9: 8 })),
      mkRow('填报', P2[0], P2[1], P2[2], 'zhangsan', '张三[研发部一组]', o({ 9: 24 })),
    ],
  };
  const MOCK_DTL_LAST = {
    PRJZH0090001: [
      mkRow('计划', P1[0], P1[1], P1[2], 'zhangsan', '张三[研发部一组]', o({ 9: 8 })),
      mkRow('填报', P1[0], P1[1], P1[2], 'zhangsan', '张三[研发部一组]', o({ 9: 16 })),
      mkRow('计划', P1[0], P1[1], P1[2], 'zhaoliu', '赵六[研发部二组]', o({ 9: 40 })),
      mkRow('填报', P1[0], P1[1], P1[2], 'zhaoliu', '赵六[研发部二组]', o({ 9: 240 })),
    ],
  };

  // ── 接口层：mock 与真实同签名 ──
  const xhrHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
  };

  // 项目工时汇总（今年 + 去年各一次；响应为裸数组）
  const apiGridByMonth = async (year) => {
    if (MOCK) {
      mockCalls.grid += 1;
      return year === NOW_YEAR ? MOCK_GRID_CUR : MOCK_GRID_LAST;
    }
    const resp = await fetch(URL_GRID, {
      method: 'POST', headers: xhrHeaders, credentials: 'include',
      body: 'year=' + year + '&month=1&projname=&projectno=&pageSize=&page=',
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!Array.isArray(data)) throw new Error('响应格式异常');
    return data;
  };

  // 成员明细（prjid/year/month 走 query；表单为空分页参数——与抓包一致，
  // 勿把 year/month 塞进 body，服务端只从 query 取时间参数）
  const apiGridDtlByMonth = async (prjid, year) => {
    if (MOCK) {
      mockCalls.dtl += 1;
      return (year === NOW_YEAR ? MOCK_DTL_CUR : MOCK_DTL_LAST)[prjid] || [];
    }
    const resp = await fetch(URL_DTL + '?prjid=' + encodeURIComponent(prjid) +
      '&year=' + year + '&month=1', {
      method: 'POST', headers: xhrHeaders, credentials: 'include',
      body: 'pageSize=&page=',
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!Array.isArray(data)) throw new Error('响应格式异常');
    return data;
  };

  // 项目清单：今年 + 去年（只保留今年仍存在的项目），附计划截止月（口径同原后端）
  const loadProjects = async () => {
    const year = NOW_YEAR;
    const cur = await apiGridByMonth(year);
    const dateInfo = calculateProjectLastDate(cur, year);
    let last = [];
    try { last = await apiGridByMonth(year - 1); } catch (e) { /* 去年失败不阻塞 */ }
    const curIds = {};
    cur.forEach((item) => { curIds[item.prjid] = 1; });
    const merge = cur.concat(last.filter((item) => curIds[item.prjid]));
    const projects = calculateProjectStats(merge);
    projects.forEach((info) => { info.last_date = dateInfo[info.id] || ''; });
    projects.sort((a, b) => (a.achievement_rate || 0) - (b.achievement_rate || 0));
    return { year, projects };
  };

  // 成员明细：今年 + 去年全量合并后按成员聚合
  const loadMembers = async (prjid) => {
    const year = NOW_YEAR;
    const cur = await apiGridDtlByMonth(prjid, year);
    let last = [];
    try { last = await apiGridDtlByMonth(prjid, year - 1); } catch (e) { /* 去年失败不阻塞 */ }
    return { year, members: calculateCompletionRate(cur.concat(last)) };
  };

  // ── 检查历史留痕：写后端（CORS * 可直连）+ chrome.storage 降级摘要 ──
  // 数据结构与 common/store.js 的 HistoryStore 记录兼容（history 页可读）
  const fmtTime = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };
  const BACKEND = 'http://127.0.0.1:8765';
  const saveHistory = (record) => {
    const rec = Object.assign({}, record);
    rec.time = fmtTime(new Date());
    try { rec.extVersion = chrome.runtime.getManifest().version; } catch (e) { /* 忽略 */ }
    // 后端 SQLite（history 页优先后端读取）
    fetch(BACKEND + '/api/history/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec),
    }).catch(() => { /* 后端不可达静默 */ });
    // 本地降级摘要（与 fcHistoryFallback 兼容）
    try {
      const slim = Object.assign({}, rec);
      delete slim.detail;
      chrome.storage.local.get(['fcHistoryFallback'], (r) => {
        const list = r.fcHistoryFallback || [];
        slim._fb = true;
        list.unshift(slim);
        chrome.storage.local.set({ fcHistoryFallback: list.slice(0, 200) }, () => {});
      });
    } catch (e) { /* 忽略 */ }
  };
  const reportCollect = (payload) => {
    try {
      const body = Object.assign({
        reportId: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        extVersion: (chrome.runtime.getManifest() || {}).version || '',
      }, payload);
      fetch(BACKEND + '/api/collect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => { /* 静默 */ });
    } catch (e) { /* 忽略 */ }
  };

  // ── 浮层 UI ──
  let root = null;
  let busy = false;
  let projects = [];
  let members = [];
  let currentProj = null;
  let year = null;
  let curTolerance = 3;

  const TOLERANCES = [3, 5];

  const build = () => {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'abc-wh';
    root.innerHTML =
      '<div class="abc-wh__mask"></div>' +
      '<div class="abc-wh__panel" role="dialog" aria-label="工时填报检查">' +
      '  <div class="abc-wh__head">' +
      '    <span class="abc-wh__logo">时</span>' +
      '    <span class="abc-wh__title">工时填报检查</span>' +
      (MOCK ? '<span class="abc-wh__mockbadge">模拟数据</span>' : '') +
      '    <span class="abc-wh__refresh" title="刷新"><i class="el-icon-refresh"></i></span>' +
      '    <span class="abc-wh__close" title="关闭"><i class="el-icon-close"></i></span>' +
      '  </div>' +
      '  <div class="abc-wh__pickrow">' +
      '    <span class="abc-wh__label">项目</span>' +
      '    <select class="abc-wh__select" title="选择项目"></select>' +
      '    <span class="abc-wh__label">误差线</span>' +
      '    <span class="abc-wh__tols">' +
      TOLERANCES.map((t) =>
        '<label class="abc-wh__tol"><input type="radio" name="abc-wh-tol" value="' + t + '"' +
        (t === curTolerance ? ' checked' : '') + '>±' + t + '%</label>').join('') +
      '    </span>' +
      '    <button class="abc-wh__check" type="button">开始检查</button>' +
      '  </div>' +
      '  <div class="abc-wh__meta" style="display:none"></div>' +
      '  <div class="abc-wh__tablewrap">' +
      '    <div class="abc-wh__table"></div>' +
      '  </div>' +
      '  <div class="abc-wh__foot">' +
      '    <span class="abc-wh__pickinfo"></span>' +
      '    <span class="abc-wh__footbtns">' +
      '      <button class="abc-wh__btn" data-act="mail" disabled><i class="el-icon-document-copy"></i> 复制邮箱</button>' +
      '      <button class="abc-wh__btn" data-act="mailtext" disabled><i class="el-icon-document"></i> 复制邮件文本</button>' +
      '    </span>' +
      '  </div>' +
      '  <div class="abc-wh__status" style="display:none"></div>' +
      '</div>';
    document.documentElement.appendChild(root);

    root.querySelector('.abc-wh__close').addEventListener('click', close);
    root.querySelector('.abc-wh__mask').addEventListener('click', close);
    root.querySelector('.abc-wh__refresh').addEventListener('click', () => refresh());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    const select = root.querySelector('.abc-wh__select');
    select.addEventListener('change', () => {
      members = [];
      currentProj = null;
      renderMeta(null);
      renderTable();
      setStatus('', false);
    });
    root.querySelectorAll('.abc-wh__tol input').forEach((r) => {
      r.addEventListener('change', () => {
        curTolerance = Number(r.value);
        if (members.length) {
          members.forEach((m) => { m.checked = m.achievement_rate < 100 - curTolerance; });
          renderTable();
          setTableTip();
        }
      });
    });
    root.querySelector('.abc-wh__check').addEventListener('click', runCheck);

    // 底栏按钮 + 表格勾选（事件委托）
    root.querySelector('.abc-wh__foot').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || btn.disabled) return;
      if (btn.dataset.act === 'mail') copyPickedMail();
      else if (btn.dataset.act === 'mailtext') copyPickedMailText();
    });
    root.querySelector('.abc-wh__table').addEventListener('change', (e) => {
      const cb = e.target.closest('.abc-wh__cb');
      if (cb) {
        members[Number(cb.dataset.index)].checked = cb.checked;
        refreshPick();
      }
      if (e.target.id === 'abc-wh-checkall') {
        members.forEach((m) => { m.checked = e.target.checked; });
        renderTable();
      }
    });
    return root;
  };

  const open = () => {
    build();
    root.classList.add('show');
    refresh();
  };
  const close = () => { if (root) root.classList.remove('show'); };

  const setStatus = (msg, isError) => {
    const el = root.querySelector('.abc-wh__status');
    el.style.display = msg ? 'block' : 'none';
    el.textContent = msg;
    el.className = 'abc-wh__status' + (isError ? ' is-err' : '');
  };

  // 打开/刷新：重查项目清单（缓存省略——清单仅一次请求 ×2，结构简单优先）
  const refresh = async () => {
    if (busy) return;
    busy = true;
    const select = root.querySelector('.abc-wh__select');
    select.disabled = true;
    root.querySelector('.abc-wh__check').disabled = true;
    setStatus('正在获取工时项目列表（今年 + 去年）…', false);
    try {
      const data = await loadProjects();
      projects = data.projects || [];
      year = data.year;
      if (!projects.length) {
        select.innerHTML = '<option value="">（无）</option>';
        renderTable('未获取到有工时计划的项目，请确认已在 ITA 中分配工时。');
        setStatus('未获取到有工时计划的项目，请确认已在 ITA 中分配工时。', true);
        return;
      }
      select.innerHTML = projects.map((p) =>
        '<option value="' + esc(p.id) + '">' + esc(p.projname) + '（' + esc(p.projectno || '-') + '）· 完成率 ' + p.achievement_rate + '%</option>'
      ).join('');
      select.disabled = false;
      root.querySelector('.abc-wh__check').disabled = false;
      setStatus('获取到 ' + projects.length + ' 个有工时计划的项目（数据年份 ' + year + ' 及上年），按完成率升序排列。', false);
    } catch (e) {
      select.innerHTML = '<option value="">（加载失败）</option>';
      renderTable('无法获取工时数据：' + (e.message || e) + '。请确认已登录 ita.abc，点右上角「刷新」重试。');
      setStatus('无法获取工时数据：' + (e.message || e) + '。请确认已登录 ita.abc。', true);
    } finally {
      busy = false;
    }
  };

  const runCheck = async () => {
    const prjid = root.querySelector('.abc-wh__select').value;
    if (!prjid) { setStatus('请先选择项目。', true); return; }
    if (busy) return;
    busy = true;
    root.querySelector('.abc-wh__check').disabled = true;
    const t0 = Date.now();
    setStatus('正在统计项目成员工时填报（今年 + 去年合并）…', false);
    try {
      const data = await loadMembers(prjid);
      members = data.members || [];
      year = data.year || year;
      currentProj = projects.find((p) => p.id === prjid) || null;
      if (!members.length) {
        renderMeta(null);
        renderTable('该项目没有成员工时数据。');
        setStatus('该项目没有成员工时数据。', true);
        return;
      }
      // 默认勾选未填满成员（与原工具口径一致）
      members.forEach((m) => { m.checked = m.achievement_rate < 100 - curTolerance; });
      renderMeta(currentProj);
      renderTable();
      setTableTip();

      const fail = members.filter((m) => m.achievement_rate < 100 - curTolerance).length;
      const over = members.filter((m) => m.achievement_rate > 100 + curTolerance).length;
      const avg = members.length
        ? Math.round(members.reduce((s, m) => s + m.achievement_rate, 0) / members.length * 100) / 100
        : 0;
      setStatus('检查完成：成员 ' + members.length + ' 人，未填满 ' + fail + ' 人、超填 ' + over + ' 人（默认勾选未填满），平均完成率 ' + avg + '%。', fail > 0);

      // 检查历史 + 数据收集（后端 sync + 本地降级摘要，失败静默）
      saveHistory({
        type: 'workhours',
        source: 'ita',
        project: currentProj
          ? { prjid: currentProj.id, projname: currentProj.projname, projectno: currentProj.projectno, projtype: '' }
          : { prjid, projname: '', projectno: '', projtype: '' },
        files: [],
        summary: { users: members.length, fail, over, avgRate: avg },
        detail: {
          members: members.map((m) => ({ id: m.id, name: m.name, target_amt: m.target_amt, completed_amt: m.completed_amt, achievement_rate: m.achievement_rate })),
          tolerance: curTolerance,
          year,
        },
        durationSec: Math.round((Date.now() - t0) / 100) / 10,
      });
      reportCollect({
        time: new Date().toISOString(),
        meta: { ua: navigator.userAgent, trigger: 'ita', checkType: 'workhours' },
        project: currentProj
          ? { prjid: currentProj.id, projname: currentProj.projname, projectno: currentProj.projectno, projtype: '' }
          : { prjid, projname: '', projectno: '', projtype: '' },
        run: {},
        stats: { users: members.length, fail },
      });
    } catch (e) {
      setStatus('工时检查失败：' + (e.message || e) + '。请确认已登录 ita.abc。', true);
    } finally {
      busy = false;
      root.querySelector('.abc-wh__check').disabled = false;
      refreshPick();
    }
  };

  const renderMeta = (p) => {
    const el = root.querySelector('.abc-wh__meta');
    if (!p) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'flex';
    el.innerHTML =
      '<span>目标 <b>' + p.target_amt + '</b> 人天</span>' +
      '<span>已填 <b>' + p.completed_amt + '</b> 人天</span>' +
      '<span>完成率 <b>' + p.achievement_rate + '%</b></span>' +
      (p.last_date ? '<span>计划截止 <b>' + esc(p.last_date) + '</b></span>' : '') +
      '<span>数据年份 <b>' + year + ' / ' + (year - 1) + '</b></span>';
  };

  const rateCls = (rate, tol) => (rate < 100 - tol ? 'low' : (rate > 100 + tol ? 'over' : 'pass'));
  const rateText = (rate, tol) => {
    const cls = rateCls(rate, tol);
    return { cls, txt: cls === 'pass' ? '达标' : (cls === 'low' ? '未填满' : '超填') };
  };

  const setTableTip = () => {
    const tip = root.querySelector('.abc-wh__tabletip');
    if (tip) tip.textContent = '误差线 ±' + curTolerance + '%（可在上方切换）';
  };

  const renderTable = (emptyMsg) => {
    const el = root.querySelector('.abc-wh__table');
    if (emptyMsg) {
      el.innerHTML = '<div class="abc-wh__empty">' + esc(emptyMsg) + '</div>';
      refreshPick();
      return;
    }
    if (!members.length) {
      el.innerHTML = '<div class="abc-wh__empty">选择项目后点击「开始检查」</div>';
      refreshPick();
      return;
    }
    const tol = curTolerance;
    el.innerHTML =
      '<div class="abc-wh__tip" ><span class="abc-wh__tabletip"></span>' +
      '<label class="abc-wh__all"><input type="checkbox" id="abc-wh-checkall"' +
      (members.every((m) => m.checked) ? ' checked' : '') + '>全选</label></div>' +
      '<div class="abc-wh__thead">' +
      '<span></span><span>姓名</span><span>邮箱</span><span>已填</span><span>目标</span><span>完成率</span><span>状态</span>' +
      '</div>' +
      members.map((m, i) => {
        const rt = rateText(m.achievement_rate, tol);
        return '<div class="abc-wh__row">' +
          '<span><input type="checkbox" class="abc-wh__cb" data-index="' + i + '"' + (m.checked ? ' checked' : '') + '></span>' +
          '<span class="abc-wh__name" title="' + esc(m.name || '-') + '">' + esc(m.name || '-') + '</span>' +
          '<span class="abc-wh__mail">' + esc(m.id) + MAIL_DOMAIN + '</span>' +
          '<span class="abc-wh__num">' + m.completed_amt + '</span>' +
          '<span class="abc-wh__num">' + m.target_amt + '</span>' +
          '<span><span class="abc-wh__rate ' + rt.cls + '">' + m.achievement_rate + '%</span></span>' +
          '<span><span class="abc-wh__st ' + rt.cls + '">' + rt.txt + '</span></span>' +
          '</div>';
      }).join('');
    setTableTip();
    refreshPick();
  };

  const refreshPick = () => {
    const picked = members.filter((m) => m.checked);
    root.querySelector('[data-act="mail"]').disabled = busy || !picked.length;
    root.querySelector('[data-act="mailtext"]').disabled = busy || !picked.length;
    root.querySelector('.abc-wh__pickinfo').textContent = picked.length ? '已勾选 ' + picked.length + ' 人' : '';
    const all = root.querySelector('#abc-wh-checkall');
    if (all) all.checked = members.length > 0 && members.every((m) => m.checked);
  };

  const copyText = async (text, tip) => {
    const done = () => setStatus(tip, false);
    // ita.abc 为 http 非安全上下文，clipboard API 常被拒：先试再回退 execCommand
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        done();
        return;
      }
    } catch (e) { /* 回退 execCommand */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (e) {
      setStatus('复制失败：' + e.message, true);
    }
  };

  const copyPickedMail = () => {
    const picked = members.filter((m) => m.checked);
    if (!picked.length) return;
    copyText(picked.map((m) => m.id + MAIL_DOMAIN).join(';'), '已复制 ' + picked.length + ' 个邮箱，可粘贴到邮件收件人。');
  };

  const copyPickedMailText = () => {
    const picked = members.filter((m) => m.checked);
    if (!picked.length) return;
    const projname = currentProj ? currentProj.projname : '';
    const lines = [
      '各位同事，现《' + projname + '》临近结项，请各位按目标工时完成填报，不满足工时填报信息如下，请特别关注：',
      '（本数据为自动统计，如有偏差，请以实际填报为准！）',
      '项目名称: ' + projname,
    ];
    picked.forEach((m) => {
      lines.push(m.name + '   已填报:' + m.completed_amt + '   目标填报:' + m.target_amt + '   完成率:' + m.achievement_rate + '%');
    });
    copyText(lines.join('\r\n\r\n'), '已复制邮件文本，可粘贴到邮件正文。');
  };

  // 悬浮球菜单入口（content.js 菜单项点击时调用）
  window.__abcWorkhoursOpen = open;
})();
