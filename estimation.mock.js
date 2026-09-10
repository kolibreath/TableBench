/* estimation.mock.js — ITA 接口模拟数据（外网/本机调试用）
 * ─────────────────────────────────────────────────────────
 * 仅当 URL 带 ?itaMock=1 时生效（文件常驻加载，自检参数，默认零行为）。
 * 零侵入：不修改 estimation.js / estimation.render.js，通过包装 window.fetch
 * 拦截 ita.abc 域请求返回模拟报文；去掉 URL 参数即为原始行为。
 *
 * 覆盖接口：
 *   searchProj2022.action  项目搜索（名称/编号关键字过滤，支持 on-the-fly 高频调用）
 *   searchProj.action      项目详情 + 文档列表（fileList）
 *   downloadFileById.action 文件下载（返回占位小文件——检查流程解析会失败，仅用于查看 UI）
 */
(function () {
  'use strict';

  function enabled() {
    try {
      return new URLSearchParams(window.location.search).get('itaMock') === '1';
    } catch (e) { return false; }
  }
  if (!enabled()) return;

  var PROJECTS = [
    { prjid: 'P20260001', projname: '新一代核心账务系统升级', projectno: 'XRK2026001', projtype: '开发类', status: '运行中' },
    { prjid: 'P20260002', projname: '手机银行客户体验优化', projectno: 'XRK2026002', projtype: '优化类', status: '运行中' },
    { prjid: 'P20260003', projname: '智能风控平台二期', projectno: 'XRK2026003', projtype: '开发类', status: '已结项' },
    { prjid: 'P20260004', projname: '数据中台治理专项', projectno: 'XRK2026004', projtype: '治理类', status: '已结项' },
    { prjid: 'P20260005', projname: '渠道整合平台三期', projectno: 'XRK2026005', projtype: '开发类', status: '运行中' },
    { prjid: 'P20260006', projname: '反洗钱监测能力建设', projectno: 'XRK2026006', projtype: '开发类', status: '运行中' },
  ];

  function est(name) {
    return { idFile: 'F' + name, idPsn: 'U01', namFile: name + '_规模估算书_v2.3.xlsx', fileSize: 48213, timeUpl: '2026-08-30 10:21:44' };
  }
  function req(name, batch) {
    return { idFile: 'F' + name, idPsn: 'U02', namFile: name + '需求说明书' + (batch ? '_批次' + batch : '') + '.docx', fileSize: 156280, timeUpl: '2026-09-02 14:05:12' };
  }
  var FILES = {
    P20260001: [
      est('新一代核心账务系统升级'),
      req('核心账务升级', 1), req('核心账务升级', 2),
      { idFile: 'F004', idPsn: 'U03', namFile: '概要设计说明书_v1.1.docx', fileSize: 220450, timeUpl: '2026-09-03 09:12:00' },
      { idFile: 'F005', idPsn: 'U03', namFile: '测试报告_季度汇总.xlsx', fileSize: 88210, timeUpl: '2026-09-05 16:40:31' },
    ],
    P20260002: [
      est('手机银行客户体验优化'),
      req('手机银行优化', 1),
      { idFile: 'F104', idPsn: 'U04', namFile: '体验优化会议纪要.docx', fileSize: 30411, timeUpl: '2026-09-06 11:02:18' },
    ],
    P20260003: [
      est('智能风控平台二期'),
      req('风控平台二期', 1), req('风控平台二期', 2), req('风控平台二期', 3),
    ],
    P20260004: [
      { idFile: 'F400', idPsn: 'U05', namFile: '数据治理工作方案.docx', fileSize: 91200, timeUpl: '2026-07-21 09:00:00' },
    ],
    P20260005: [
      est('渠道整合平台三期'),
      req('渠道整合三期', 1),
    ],
    P20260006: [
      est('反洗钱监测能力建设'),
      req('反洗钱建设', 1),
      { idFile: 'F603', idPsn: 'U06', namFile: '外部监管文件汇编.pdf', fileSize: 503288, timeUpl: '2026-09-01 08:55:00' },
    ],
  };

  function jsonResp(obj) {
    return Promise.resolve(new Response(JSON.stringify(obj), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!origFetch) return;

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
    if (url.indexOf('ita.abc') < 0) return origFetch(input, init);

    // 项目搜索（searchProj2022）：POST body 含 projname=/projectno=
    if (url.indexOf('searchProj2022.action') >= 0) {
      var body = (init && init.body) || '';
      var kw = '';
      try {
        kw = decodeURIComponent((body.match(/projname=([^&]*)/) || ['', ''])[1]) || '';
      } catch (e) { kw = ''; }
      var list = PROJECTS.filter(function (p) {
        return !kw || p.projname.indexOf(kw) >= 0 || p.projectno.indexOf(kw) >= 0;
      });
      return jsonResp({ data: list });
    }

    // 项目详情 + 文档列表（searchProj）：body 含 prjid=
    if (url.indexOf('searchProj.action') >= 0) {
      var b2 = (init && init.body) || '';
      var prjid = (b2.match(/prjid=([^&]*)/) || ['', ''])[1];
      var proj = PROJECTS.filter(function (p) { return p.prjid === prjid; })[0] || {};
      return jsonResp({ data: [{ prjid: prjid, projname: proj.projname, projectno: proj.projectno, projtype: proj.projtype, status: proj.status, fileList: FILES[prjid] || [] }] });
    }

    // 文件下载：占位文件（非真实 xlsx/docx，检查流程会提示解析失败——预期行为）
    if (url.indexOf('downloadFileById.action') >= 0) {
      return Promise.resolve(new Response('mock-file-bytes', {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      }));
    }

    return origFetch(input, init);
  };

  console.log('[estimation.mock] ITA 模拟数据已启用（?itaMock=1），共 ' + PROJECTS.length + ' 个模拟项目');
})();
