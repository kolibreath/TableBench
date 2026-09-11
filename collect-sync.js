/* collect-sync.js — 检查结果上报统计后端（落库）
 * ─────────────────────────────────────────────────────────
 * 职责：估算检查完成后，把结果异步 POST 到统计服务（同事侧 GaussDB 落库）。
 *  - 本地留痕（HistoryStore）为主，本上报为辅：发送失败静默（console.warn），
 *    不重试、不阻塞检查流程 —— 本地记录永不丢失，统计侧允许偶发缺失。
 *  - Endpoint 配置：localStorage['statsEndpoint']（与 aiApiUrl 同模式；
 *    例：http://<统计服务>:<port>/api/check_records）。未配置 = 上报关闭。
 *  - 口径（与后端设计 v2.0 对齐，明细按规则聚合，不逐条上报）：
 *      record    → check_record（汇总，含项目/来源/规则版本/AI 开关/耗时/检查人）
 *      violations → check_violation（同 rule_id 压缩为一条，sheet 拼接去重，
 *                   附 hit_count 供后端选存；明细以本地留痕为准）
 *      files     → check_file（book / require + 批次）
 *  - checker_id：ITA cookie 的 userId（域账号），经 background 获取。
 */
(function () {
  'use strict';

  if (window.CollectSync) return;

  var ENDPOINT_LS_KEY = 'statsEndpoint';

  function getEndpoint() {
    try { return (localStorage.getItem(ENDPOINT_LS_KEY) || '').trim(); }
    catch (e) { return ''; }
  }

  function getCheckerId() {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: 'GET_COOKIES' }, function (resp) {
          if (chrome.runtime.lastError || !resp || !resp.ok) { resolve(''); return; }
          var m = String(resp.cookie || '').match(/userId=([^;\s]+)/);
          resolve(m ? decodeURIComponent(m[1]) : '');
        });
      } catch (e) { resolve(''); }
    });
  }

  // 同 rule_id 压缩为一条：sheet 去重拼接（截 64），hit_count = 违例条数
  function aggregateViolations(violations) {
    var byRule = {};
    var order = [];
    (violations || []).forEach(function (x) {
      var ruleId = x.ruleId || '?';
      if (!byRule[ruleId]) {
        byRule[ruleId] = {
          rule_id: ruleId,
          rule_name: (x.ruleName || x.text || '').slice(0, 64),
          type: x.type === '建议' ? '建议' : '强制',
          sheets: {},
          hit_count: 0,
        };
        order.push(ruleId);
      }
      var agg = byRule[ruleId];
      var sheet = (x.sheet || '-').slice(0, 60);
      agg.sheets[sheet] = 1;
      agg.hit_count += 1;
    });
    return order.map(function (k) {
      var agg = byRule[k];
      var sheets = Object.keys(agg.sheets);
      return {
        rule_id: agg.rule_id,
        rule_name: agg.rule_name,
        type: agg.type,
        sheet: sheets.join('、').slice(0, 64) || (sheets[0] || ''),
        hit_count: agg.hit_count,
      };
    });
  }

  function buildPayload(record, checkerId) {
    var s = record.summary || {};
    var proj = record.project || {};
    var files = (record.files || []).map(function (f, i) {
      var ext = '';
      var dot = String(f.name || '').lastIndexOf('.');
      if (dot >= 0) ext = String(f.name).slice(dot + 1).slice(0, 8);
      return {
        file_type: f.role === 'requirement' ? 'require' : 'book',
        file_name: f.name || '',
        file_ext: ext,
        batch_order: i + 1,
      };
    });
    return {
      record: {
        fp_total: Number(s.total) || 0, // 口径注：暂以违例总数占位，功能点总数待检查流程补充
        must_count: Number(s.must) || 0,
        suggest_count: Number(s.suggest) || 0,
        over_estimate: 0,
        under_estimate: 0,
        ai_review_count: Number(s.ai) || 0,
        match_count: 0,
        unmatch_count: 0,
        project_no: proj.projectno || '',
        project_name: proj.projname || '',
        source: record.source === 'ita' ? 'ita' : 'manual',
        rule_version: record.ruleVersion || '',
        ai_enabled: record.aiUrl ? 1 : 0,
        duration_sec: record.durationSec != null ? record.durationSec : null,
        checker_id: checkerId,
        client_time: record.time || new Date().toISOString(),
      },
      violations: aggregateViolations((record.detail || {}).violations),
      files: files,
    };
  }

  // 入口：fire-and-forget。endpoint 未配置时静默跳过。
  function enqueue(record) {
    var endpoint = getEndpoint();
    if (!endpoint || !record) return Promise.resolve(false);
    return getCheckerId().then(function (checkerId) {
      var payload = buildPayload(record, checkerId);
      return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return true;
      }).catch(function (e) {
        console.warn('[统计上报] 落库失败（本地留痕不受影响）:', e && e.message || e);
        return false;
      });
    });
  }

  window.CollectSync = {
    enqueue: enqueue,
    buildPayload: buildPayload,
    aggregateViolations: aggregateViolations,
    getEndpoint: getEndpoint,
  };
})();
