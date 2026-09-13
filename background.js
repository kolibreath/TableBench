// 后台 Service Worker
// 职责：① 自动从浏览器获取 ita.abc 的 cookie，供内容脚本使用
//       ② 关注流程轮询：chrome.alarms 周期唤起 → 拉取关注项目详情/卡点 →
//          状态指纹 diff → 变化合并为一条系统通知 + 角标（tracker-watch.js 共享解析）

importScripts('tracker-watch.js');

const COOKIE_DOMAIN = 'ita.abc';
const WATCH_KEY = 'fcWatchList';
const WATCH_ALARM = 'fcWatchPoll';
const URL_PROJ = 'http://ita.abc/ita/project/searchProj.action';
const URL_IMG = 'http://ita.abc/ita/subprocessimage.action?subprocessId=';

// 拼接 Cookie 字符串
const joinCookies = (cookies) => {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
};

// 监听内容脚本的 cookie 请求
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 扩展页打开请求：content 脚本不能直接 window.open 扩展页（受 web_accessible_resources
  // origin 白名单限制，白名单外页面会提示「已被屏蔽」），统一由后台 tabs.create 打开
  if (message && message.type === 'OPEN_PAGE' && message.page) {
    const url = chrome.runtime.getURL(message.page) + (message.query || '');
    chrome.tabs.create({ url }, () => void chrome.runtime.lastError);
    sendResponse({ ok: true });
    return false;
  }
  if (message && message.type === 'GET_COOKIES') {
    chrome.cookies.getAll({ domain: COOKIE_DOMAIN }, (cookies) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true, cookie: joinCookies(cookies) });
    });
    // 返回 true 表示异步响应
    return true;
  }
  // 关注流程：手动触发一次轮询（面板「立即检查更新」/E2E 钩子）
  if (message && message.type === 'WATCH_POLL_NOW') {
    pollWatch().finally(() => sendResponse({ ok: true }));
    return true;
  }
  // 批量下载：downloads API 队列（并发 3，单文件失败重试一次），不受页面多下载拦截；
  // 下载走浏览器共享 Cookie，ITA 会话有效即可。文件名由 ITA 响应头或 filename 建议值生成
  if (message && message.type === 'DOWNLOAD_FILES' && Array.isArray(message.items)) {
    const items = message.items.slice();
    const results = { ok: true, done: 0, failed: 0, total: items.length };
    const worker = async () => {
      while (items.length) {
        const it = items.shift();
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          try {
            await chrome.downloads.download({
              url: it.url,
              filename: it.filename || undefined,
              conflictAction: 'uniquify',
            });
            ok = true;
          } catch (e) {
            if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
          }
        }
        ok ? results.done++ : results.failed++;
      }
    };
    (async () => {
      await Promise.all([worker(), worker(), worker()]);
      sendResponse(results);
    })();
    return true;
  }
  return false;
});

// ── 关注流程轮询 ────────────────────────────────────────────
// 仅拉取被关注项目的详情与卡点（每项目 2 个请求），指纹变化时：
//   更新快照 → 写 lastChanges/unread → 合并为一条系统通知 + 角标
// 流程指纹为空（已无卡点）：通知一次并自动移除该流程关注；
// 项目下关注清空 → 移除项目；项目详情连续拉取失败 → 通知一次并整体移除。

const watchGet = () => new Promise((resolve) => {
  chrome.storage.local.get([WATCH_KEY], (r) => {
    const w = (r && r[WATCH_KEY]) || { intervalMin: 10, unread: 0, lastChanges: [], items: {} };
    if (!w.items) w.items = {};
    resolve(w);
  });
});

const watchSet = (w) => new Promise((resolve) => {
  chrome.storage.local.set({ [WATCH_KEY]: w }, () => resolve());
});

const setBadge = (unread) => {
  try {
    chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#2e7d32' });
  } catch (e) { /* 忽略 */ }
};

// 按 intervalMin 重建 alarm（settings 变化时调用；最小 5 分钟）
const rebuildAlarm = async () => {
  const w = await watchGet();
  const period = Math.max(5, Number(w.intervalMin) || 10);
  chrome.alarms.create(WATCH_ALARM, { periodInMinutes: period, delayInMinutes: period });
};

// 拉取项目详情（processList）；resp 失败/空数据返回 null（与网络异常区分）
const fetchProjectDetail = async (prjid) => {
  const resp = await fetch(URL_PROJ, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    body: 'bizdomain=0&prjid=' + encodeURIComponent(prjid),
    credentials: 'include',
  });
  if (!resp.ok) return null;
  const res = await resp.json();
  const d = res && res.data && res.data[0];
  if (!d) return null;
  return d;
};

const notifyChanges = async (changes) => {
  const w = await watchGet();
  w.unread = (w.unread || 0) + changes.length;
  w.lastChanges = changes.concat(w.lastChanges || []).slice(0, 50);
  await watchSet(w);
  setBadge(w.unread);
  try {
    const brief = changes.slice(0, 2).map((c) => c.projname + '「' + c.flow + '」' + c.brief).join('；');
    chrome.notifications.create('fcWatch-' + Date.now(), {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '【进度关注】' + changes.length + ' 条流程有更新',
      message: brief + (changes.length > 2 ? ' …等 ' + changes.length + ' 条' : ''),
      priority: 1,
    });
  } catch (e) { /* 通知失败不影响数据链路 */ }
};

const pollWatch = async () => {
  const w = await watchGet();
  const prjids = Object.keys(w.items || {});
  if (!prjids.length) { setBadge(0); return; }

  const changes = [];
  const removals = [];   // {prjid, flow} 待移除（已无卡点）
  const deadProjects = []; // 项目不可见待移除

  for (const prjid of prjids) {
    const item = w.items[prjid];
    let detail = null;
    try { detail = await fetchProjectDetail(prjid); } catch (e) { detail = undefined; } // undefined=网络异常，跳过不计数
    if (detail === null) {
      item.__fail = (item.__fail || 0) + 1;
      if (item.__fail >= 2) deadProjects.push(prjid); // 连续 2 次拉取失败视为项目不可见
      continue;
    }
    item.__fail = 0;
    if (detail.projname) item.projname = detail.projname;
    const processList = Array.isArray(detail.processList) ? detail.processList : [];
    const running = processList.filter((proc) => String(proc.indStsProc || '').indexOf('正常') >= 0);

    // 该项目下被关注流程的最新指纹
    const latest = {};
    for (const proc of running) {
      const flowName = proc.namProcDesc || proc.namProc || ('流程 ' + proc.idProc);
      if (!item.flows[flowName]) continue; // 未关注的流程不拉流程图（省请求）
      let fp = '';
      try {
        const resp = await fetch(URL_IMG + encodeURIComponent(proc.idProc), { credentials: 'include' });
        if (resp.ok) fp = globalThis.__abcWatchCore.flowFingerprint(globalThis.__abcWatchCore.parseStuckNodes(await resp.text()));
      } catch (e) { /* 单流程拉取失败：本次跳过，不改快照 */ continue; }
      latest[flowName] = fp;
    }
    // 被关注但已不在运行中流程列表 → 指纹为空（流程结束）
    Object.keys(item.flows).forEach((flowName) => {
      if (!(flowName in latest)) latest[flowName] = '';
    });

    for (const flowName of Object.keys(latest)) {
      const fp = latest[flowName];
      const old = item.flows[flowName] ? item.flows[flowName].fp : null;
      if (old === null) { // 新关注首次轮询：仅记录基线，不通知
        item.flows[flowName] = { fp: fp, addedAt: item.flows[flowName].addedAt || Date.now() };
        continue;
      }
      const diff = globalThis.__abcWatchCore.diffFingerprint(old, fp);
      if (!diff.changed) continue;
      const brief = fp === ''
        ? '已无卡点（流程推进完成），自动移除关注'
        : (diff.added.length ? '新卡点：' + diff.added.join('、') : '卡点变动：' + diff.removed.join('、') + ' → ' + diff.added.join('、'));
      changes.push({ prjid: prjid, projname: item.projname || prjid, flow: flowName, brief: brief, time: Date.now() });
      if (fp === '') {
        removals.push({ prjid: prjid, flow: flowName });
      } else {
        item.flows[flowName].fp = fp;
      }
    }
  }

  removals.forEach(({ prjid, flow }) => {
    if (w.items[prjid] && w.items[prjid].flows) {
      delete w.items[prjid].flows[flow];
      if (!Object.keys(w.items[prjid].flows).length) delete w.items[prjid];
    }
  });
  deadProjects.forEach((prjid) => {
    changes.push({ prjid: prjid, projname: (w.items[prjid] && w.items[prjid].projname) || prjid, flow: '（项目）', brief: '项目在 ITA 不可见或已结项，已移除全部关注', time: Date.now() });
    delete w.items[prjid];
  });

  // 快照/移除必须先落盘——notifyChanges 内部会重新读 storage 只更新 unread/lastChanges，
  // 若先通知后写快照，本轮的 fp 更新与流程移除会被旧值覆盖，导致每轮重复通知
  await watchSet(w);
  if (changes.length) await notifyChanges(changes);
};

// ── 生命周期：alarm 触发 / 设置变化重建 alarm / 通知点击直达关注视图 ──
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCH_ALARM) pollWatch();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[WATCH_KEY]) return;
  const before = changes[WATCH_KEY].oldValue || {};
  const after = changes[WATCH_KEY].newValue || {};
  if (Number(before.intervalMin) !== Number(after.intervalMin)) rebuildAlarm();
  // SW 自己写 unread/lastChanges 后清角标的一致性：unread=0 时清 badge
  if (after.unread === 0) setBadge(0);
});

try {
  chrome.notifications.onClicked.addListener(() => {
    // 点击通知：写定位标记 → 聚焦/打开 ITA 页（content script 注入后消费 fcWatchFocus）
    chrome.storage.local.set({ fcWatchFocus: { at: Date.now() } });
    chrome.tabs.query({ url: 'http://ita.abc/*' }, (tabs) => {
      if (tabs && tabs.length) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: 'http://ita.abc/ita/index.action' });
      }
    });
  });
} catch (e) { /* 忽略 */ }

// SW 启动即对齐一次 alarm（浏览器重启后 periodInMinutes 不持久，需重建）
rebuildAlarm();