/* tracker-watch.js — 进度跟踪共享核心（content script 与 background SW 共用）
 * ─────────────────────────────────────────────────────────
 * SW 环境无 DOM：实体解码用纯字符串替换，不得引入 document。
 * 挂载 globalThis.__abcWatchCore，content script 按 manifest 顺序在其后加载。
 *
 * 职责：
 *   1. parseStuckNodes   流程图 HTML → 卡点（与 content.tracker.js 原实现同源抽出）
 *   2. flowFingerprint   流程卡点 → 状态指纹（「节点|处理人」排序拼接）
 *   3. diffFingerprint   新旧指纹对比 → 结构化变化（新增/移除）
 */
(function () {
  'use strict';

  // SW 无 DOM，实体解码用替换表（卡点数据实际出现的实体为基础集）
  var ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
  var decodeEntities = function (s) {
    return String(s == null ? '' : s)
      .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, function (m, n) { return ENTITIES['&' + n]; })
      .replace(/&#(\d+);/g, function (m, d) {
        var c = Number(d);
        return c > 0 && c < 0x10ffff ? String.fromCharCode(c) : m;
      })
      .replace(/&#x([0-9a-f]+);/gi, function (m, h) {
        var c = parseInt(h, 16);
        return c > 0 && c < 0x10ffff ? String.fromCharCode(c) : m;
      });
  };

  var TIP_CALL_RE = /show(?:task)?tip2?\(\s*'([^']*)'\s*,\s*'([\s\S]*?)'\s*\)/g;
  var TR_RE = /<tr>((?:<td>[\s\S]*?<\/td>){4,6})<\/tr>/g;
  var TD_RE = /<td>([\s\S]*?)<\/td>/g;

  // 返回 [{ node, rows: [{person, since, executor, action, end, state}] }]（仅保留未完成行）
  var parseStuckNodes = function (html) {
    var nodes = [];
    var m;
    TIP_CALL_RE.lastIndex = 0;
    while ((m = TIP_CALL_RE.exec(html))) {
      var node = decodeEntities(m[1]).trim();
      var tip = m[2];
      var stuck = [];
      var r;
      TR_RE.lastIndex = 0;
      while ((r = TR_RE.exec(tip))) {
        var tds = [];
        var t;
        TD_RE.lastIndex = 0;
        while ((t = TD_RE.exec(r[1]))) tds.push(decodeEntities(t[1]).trim());
        if (tds.length < 6) continue;
        var row = tds;
        var person = row[0], since = row[1], executor = row[2], action = row[3], end = row[4], state = row[5];
        var pending = state.indexOf('待处理') >= 0 ||
          (!end && state && !/完成|作废|跳过|终止/.test(state));
        if (!pending) continue;
        stuck.push({ person: person || executor || '-', since: since, executor: executor, action: action, end: end, state: state });
      }
      if (stuck.length) nodes.push({ node: node, rows: stuck });
    }
    return nodes;
  };

  // 流程状态指纹：节点+处理人集合的确定性序列化（空卡点 = ''）
  var flowFingerprint = function (nodes) {
    if (!nodes || !nodes.length) return '';
    return nodes.map(function (n) {
      var persons = n.rows.map(function (x) { return x.person || '-'; }).sort().join('/');
      return n.node + '|' + persons;
    }).sort().join(';;');
  };

  // 指纹对比 → { changed, added: [「节点|处理人」], removed: [...] }
  // 集合语义：先归一排序再比较（生成端已排序，这里兜底防御不同来源的顺序差异）
  // 指纹为空串视为「已无卡点」：old 非空 new 空 → removed = 整个旧集合
  var diffFingerprint = function (oldFp, newFp) {
    var norm = function (fp) { return (fp ? fp.split(';;') : []).sort().join(';;'); };
    oldFp = norm(oldFp);
    newFp = norm(newFp);
    if (oldFp === newFp) return { changed: false, added: [], removed: [] };
    var parse = function (fp) { return fp ? fp.split(';;') : []; };
    var a = parse(oldFp), b = parse(newFp);
    var setA = {}; a.forEach(function (x) { setA[x] = 1; });
    var setB = {}; b.forEach(function (x) { setB[x] = 1; });
    return {
      changed: true,
      added: b.filter(function (x) { return !setA[x]; }),
      removed: a.filter(function (x) { return !setB[x]; }),
    };
  };

  globalThis.__abcWatchCore = {
    decodeEntities: decodeEntities,
    parseStuckNodes: parseStuckNodes,
    flowFingerprint: flowFingerprint,
    diffFingerprint: diffFingerprint,
  };
})();
