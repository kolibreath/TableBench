// common/store.js — 检查历史存储 + 数据收集上报（供 estimation / check / history 页共用）
//
// 存储策略（开发文档 4.4.1）：
//   主存 IndexedDB（浏览器原生，Edge 79+/Chromium 均支持，内网零依赖）
//   备份 后端 SQLite（/api/history/sync 异步写入，后端可达时以后端为准）
//   降级 chrome.storage.local 摘要（仅 indexedDB 不可用时，防御性兜底）

(function (global) {
  'use strict';

  const DB_NAME = 'filechecker_history';
  const DB_VERSION = 1;
  const STORE = 'checks';
  const MAX_RECORDS = 200; // 滚动保留上限

  const BACKEND_URL = 'http://127.0.0.1:8765';

  // ── IndexedDB 基础 ──────────────────────────────────────────

  let _dbPromise = null;

  function openDB() {
    if (!global.indexedDB) {
      return Promise.reject(new Error('indexedDB 不可用'));
    }
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          os.createIndex('time', 'time');
          os.createIndex('type', 'type');
          os.createIndex('projectno', 'project.projectno');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('打开 IndexedDB 失败'));
    });
    return _dbPromise;
  }

  function tx(mode) {
    return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
  }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ── HistoryStore ────────────────────────────────────────────

  const HistoryStore = {
    /** 新增一条检查记录（自动附带时间/插件版本，超限滚动删除），并异步同步到后端 */
    async save(record) {
      const rec = Object.assign({}, record);
      rec.time = rec.time || fmtTime(new Date());
      try {
        rec.extVersion = chrome.runtime.getManifest().version;
      } catch (e) { /* 非 扩展环境 */ }

      let id = null;
      try {
        const store = await tx('readwrite');
        id = await wrap(store.add(rec));
        await trim(store);
      } catch (e) {
        console.warn('[HistoryStore] IndexedDB 写入失败，降级 chrome.storage:', e);
        await fallbackSave(rec);
      }
      // 异步备份到后端（不阻塞、失败静默）
      HistoryStore.syncToBackend(rec).catch(() => {});
      return id;
    },

    /** 异步备份到后端 SQLite */
    async syncToBackend(rec) {
      try {
        await fetch(BACKEND_URL + '/api/history/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rec),
        });
      } catch (e) { /* 后端不可达时静默 */ }
    },

    /** 列表：优先后端，失败回退本地 */
    async list(filter) {
      try {
        const resp = await fetch(BACKEND_URL + '/api/history/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(filter || {}),
        });
        const data = await resp.json();
        if (data && Array.isArray(data.records)) {
          return { records: data.records, source: 'backend' };
        }
      } catch (e) { /* 回退本地 */ }
      const records = await HistoryStore.listLocal(filter);
      return { records, source: 'local' };
    },

    /** 本地列表（按时间倒序） */
    async listLocal(filter) {
      try {
        const store = await tx('readonly');
        const all = await wrap(store.getAll());
        const f = filter || {};
        return all
          .filter((r) => {
            if (f.type && f.type !== '__ALL__' && r.type !== f.type) return false;
            if (f.source && f.source !== '__ALL__' && r.source !== f.source) return false;
            if (f.keyword) {
              const kw = f.keyword.toLowerCase();
              const hay = JSON.stringify({
                n: r.project && r.project.projname,
                p: r.project && r.project.projectno,
                f: (r.files || []).map((x) => x.name).join(','),
              }).toLowerCase();
              if (!hay.includes(kw)) return false;
            }
            return true;
          })
          .sort((a, b) => (b.time > a.time ? 1 : -1));
      } catch (e) {
        return await fallbackList();
      }
    },

    /** 按 id 取详情 */
    async get(id) {
      try {
        const store = await tx('readonly');
        return await wrap(store.get(id));
      } catch (e) {
        return null;
      }
    },

    /** 删除单条 / 清空（id 为空则清空） */
    async remove(id) {
      try {
        const store = await tx('readwrite');
        if (id == null) {
          await wrap(store.clear());
        } else {
          await wrap(store.delete(id));
        }
        await fetch(BACKEND_URL + '/api/history/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id == null ? '__ALL__' : id }),
        }).catch(() => {});
      } catch (e) {
        console.warn('[HistoryStore] 删除失败:', e);
      }
    },

    /** 导出全部为 JSONL（一行一条） */
    async exportJsonl() {
      const records = await HistoryStore.listLocal();
      return records.map((r) => JSON.stringify(r)).join('\n');
    },
  };

  async function trim(store) {
    const all = await wrap(store.getAll());
    if (all.length <= MAX_RECORDS) return;
    const expired = all
      .sort((a, b) => (b.time > a.time ? 1 : -1))
      .slice(MAX_RECORDS);
    for (const r of expired) {
      if (r.id != null) store.delete(r.id);
    }
  }

  // ── IndexedDB 不可用时的降级（chrome.storage.local 存摘要） ──

  const FB_KEY = 'fcHistoryFallback';

  async function fallbackSave(rec) {
    const slim = slimRecord(rec);
    return new Promise((resolve) => {
      global.chrome.storage.local.get([FB_KEY], (r) => {
        const list = r[FB_KEY] || [];
        slim._fb = true;
        list.unshift(slim);
        global.chrome.storage.local.set({ [FB_KEY]: list.slice(0, MAX_RECORDS) }, resolve);
      });
    });
  }

  async function fallbackList() {
    return new Promise((resolve) => {
      global.chrome.storage.local.get([FB_KEY], (r) => resolve(r[FB_KEY] || []));
    });
  }

  function slimRecord(rec) {
    // 摘要：剥离大体积 detail，仅保留统计
    const slim = Object.assign({}, rec);
    delete slim.detail;
    return slim;
  }

  // ── 数据收集上报（开发文档 4.5） ─────────────────────────────

  /**
   * 上报合规检查数据。
   * @param {object} payload 完整报告（meta/book/requires/project/run/stats/violations）
   */
  async function reportCollect(payload) {
    try {
      const enabled = await new Promise((resolve) => {
        global.chrome.storage.local.get(['fcCollectEnabled'], (r) =>
          resolve(r.fcCollectEnabled !== false)); // 默认开启
      });
      if (!enabled) return { skipped: true };
      const body = Object.assign({
        reportId: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        extVersion: (chrome.runtime.getManifest() || {}).version || '',
      }, payload);
      const resp = await fetch(BACKEND_URL + '/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await resp.json().catch(() => ({}));
    } catch (e) {
      console.warn('[collect] 上报失败（不影响检查流程）:', e);
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  // ── 工具 ────────────────────────────────────────────────────

  function fmtTime(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  // ── 导出 ────────────────────────────────────────────────────

  global.HistoryStore = HistoryStore;
  global.reportCollect = reportCollect;
  global.FC_BACKEND_URL = BACKEND_URL;
})(typeof window !== 'undefined' ? window : self);
