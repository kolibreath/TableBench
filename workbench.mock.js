/* workbench.mock.js — 项目工作台 ITA 接口模拟（外网/本机调试用）
 * ─────────────────────────────────────────────────────────
 * 仅当 URL 带 ?wbMock=1 时生效（文件常驻加载，自检参数，默认零行为）。
 * 零侵入：不修改 workbench.js，通过包装 window.fetch 拦截 ita.abc 域请求返回
 * 模拟报文；去掉 URL 参数即为原始行为。
 *
 * 覆盖接口：
 *   searchProj2022.action   项目搜索（3 个虚构项目：常规/敏捷/快捷各一，人名脱敏）
 *   searchProj.action       项目详情 + 文档列表（fileList，覆盖分类/推荐入库各场景）
 *   downloadFileById.action 文件下载（docx 返回合法最小 docx 字节，xlsx 返回占位）
 *
 * 演示场景（P2026 开头均为虚构项目）：
 *   P20260011 常规类「新一代账务核心系统升级」——3 份检查对象齐全 + 要求入库 7 件全 + 大量按需文档
 *   P20260012 敏捷类「手机银行体验优化」——无系统设计说明书（敏捷差异）、fileType 怪异（分类进「其他」演示手动调整）
 *   P20260013 快捷类「渠道消息推送快捷改造」——「如有」档位文档部分存在，演示推荐入库缺项提示
 *
 * 外部数据集：workbench.html 先加载 mock-data/workbench-mock-data.js 时，
 * 其 projects/files 追加到上述内置场景之后（见下方 EXT 合并逻辑）。
 */
(function () {
  'use strict';

  function enabled() {
    try {
      return new URLSearchParams(window.location.search).get('wbMock') === '1';
    } catch (e) { return false; }
  }
  if (!enabled()) return;

  var BUILTIN_PROJECTS = [
    { prjid: 'P20260011', projname: '新一代账务核心系统升级', projectno: 'XRK2026-011', projtype: '一般应用类（常规研发模式）', projMan: '张甲' },
    { prjid: 'P20260012', projname: '手机银行客户体验优化', projectno: 'XRK2026-012', projtype: '一般应用类（敏捷研发模式）', projMan: '李乙' },
    { prjid: 'P20260013', projname: '渠道消息推送快捷改造', projectno: 'XRK2026-013', projtype: '快捷类', projMan: '赵丙' },
  ];

  function f(idFile, name, fileType, timeUpl, userName) {
    return {
      idFile: idFile, idPsn: 'U01', namFile: name, fileSize: 120000,
      timeUpl: timeUpl || '2026-08-30 10:21:44', userName: userName || '张甲',
      fileType: fileType || '-', typSecValue: fileType || '-',
    };
  }

  var BUILTIN_FILES = {
    // 场景1：常规类——3 份检查对象齐全 + 要求入库文档全 + 按需文档若干
    P20260011: [
      f('W-101', '新一代账务核心系统升级_业务需求说明书part1.docx', '业务需求说明书(需求分析)', '2026-07-01 09:00:00'),
      f('W-102', '新一代账务核心系统升级_业务需求说明书part2.docx', '业务需求说明书(需求分析)', '2026-07-01 09:05:00'),
      f('W-103', '新一代账务核心系统升级_工作产品清单.xlsx', '工作产品清单', '2026-07-02 14:00:00', '李乙'),
      f('W-104', '新一代账务核心系统升级_系统设计说明书.docx', '系统设计说明书(系统设计)', '2026-08-15 16:00:00', '李乙'),
      f('W-105', '新一代账务核心系统升级_项目规模估算书_v2.3.xlsx', '项目规模估算书', '2026-06-20 10:00:00'),
      f('W-106', '新一代账务核心系统升级_项目总体方案.docx', '项目总体方案', '2026-06-25 10:00:00'),
      f('W-107', '新一代账务核心系统升级_总体方案评审报告.docx', '总体方案评审报告', '2026-06-28 10:00:00'),
      f('W-108', '新一代账务核心系统升级_非功能性需求说明书.docx', '非功能性需求说明书', '2026-07-05 10:00:00'),
      f('W-109', '新一代账务核心系统升级_项目目标定义书.docx', '项目目标定义书', '2026-06-18 10:00:00'),
      f('W-110', '新一代账务核心系统升级_系统测试方案.docx', '系统测试方案', '2026-09-01 10:00:00', '钱丁'),
      f('W-111', '新一代账务核心系统升级_单元集成测试报告.docx', '单元集成测试报告', '2026-08-28 10:00:00', '钱丁'),
      f('W-112', '新一代账务核心系统升级_会议纪要汇编.docx', '其他', '2026-09-02 10:00:00', '孙戊'),
    ],
    // 场景2：敏捷类——无系统设计说明书（敏捷不要求）；部分文件 fileType 非标，演示「其他」+手动调整
    P20260012: [
      f('W-201', '手机银行客户体验优化_业务需求文档.docx', '业务需求文档', '2026-08-01 09:00:00', '李乙'),
      f('W-202', '手机银行客户体验优化_工作产品清单.xlsx', '工作产品清单', '2026-08-02 14:00:00', '李乙'),
      f('W-203', '手机银行客户体验优化_技术方案评审材料.docx', '评审材料（自定义类型）', '2026-08-10 11:00:00', '周己'),
      f('W-204', '体验优化汇报PPT导出版.docx', '', '2026-08-12 11:00:00', '周己'),
      f('W-205', '手机银行客户体验优化_项目规模估算书.xlsx', '项目规模估算书', '2026-07-20 10:00:00'),
    ],
    // 场景3：快捷类——「如有」档位只有总体方案，评审报告/设计书缺失，演示推荐入库缺项提示
    P20260013: [
      f('W-301', '渠道消息推送快捷改造_业务需求说明书.docx', '业务需求说明书', '2026-09-01 09:00:00', '赵丙'),
      f('W-302', '渠道消息推送快捷改造_工作产品清单.xlsx', '工作产品清单', '2026-09-01 15:00:00', '赵丙'),
      f('W-303', '渠道消息推送快捷改造_项目工作计划.xlsx', '项目工作计划', '2026-09-02 09:30:00', '吴庚'),
      f('W-304', '渠道消息推送快捷改造_项目总体方案.docx', '项目总体方案', '2026-09-03 10:00:00', '吴庚'),
    ],
  };

  // 外部数据集追加：workbench.html 在本文件之前加载 mock-data/workbench-mock-data.js 时，
  // window.__abcWorkbenchMockData 的 projects/files 追加到内置场景之后（内置 3 个项目场景保留）
  var EXT = window.__abcWorkbenchMockData || null;
  var PROJECTS = BUILTIN_PROJECTS.concat((EXT && EXT.projects) || []);
  var FILES = BUILTIN_FILES;
  if (EXT && EXT.files) {
    FILES = {};
    Object.keys(BUILTIN_FILES).forEach(function (k) { FILES[k] = BUILTIN_FILES[k]; });
    Object.keys(EXT.files).forEach(function (k) { FILES[k] = EXT.files[k]; });
  }

  // idFile → 文件索引（下载接口只带 idFile，需反查）
  var IDMAP = {};
  Object.keys(FILES).forEach(function (prjid) {
    FILES[prjid].forEach(function (x) { IDMAP[x.idFile] = x; });
  });

  // 最小合法 docx（与 estimation.mock.js 同一份基线内容，可直接被解析）
  var DOCX_B64 = 'UEsDBBQAAAAIANxQKl15bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMEFAAAAAgA3FAqXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIANxQKl1sogwZ4QEAAF0DAAARAAAAd29yZC9kb2N1bWVudC54bWyVU81u2kAQvvcpVr4HA5WqCgG5Req9eQAXuwkS/pHthubmQChJwCgqSYjyU0oSDFIjIBWl2DjiYdg/TrxC13GrVlGlkMusduabb+ab2U2ufpRzYEvSjayqpLhYJMoBScmoYlbZSHHrb9dWXnPAMAVFFHKqIqW4bcngVtMvkvmEqGY+yJJiAsagGIl8its0TS3B80ZmU5IFI6JqksJi71VdFkx21Tf4vKqLmq5mJMNgBeQcH49GX/GykFW4NKN8p4rbwakFRg+MmY6B+YWF7wrYKdDpIMkHvsDqD1Z7DMcXt/ikDCcjOPZmVhV/HaNpkQ4ddNBCdpl4nZllz1suOe+Rs92QmfaH+LQGXWfh7+F9F9+2Ygt/f+FXyVEXejXa2cXdFvQHpNdgIHS4F3iuLdxsMwoWwpUmPh5guzezCk/2FwfooEmL92Hpp+GRGPjdU5hHq0V0PlxqDA9pqFpCh9/CXFJwaaWN3O9MGyr9hPd1OGk/ksfGhsqfllISiYP55ZdnycFWJ9Dg7DDwwj9jI6T9K3I3gd4NPq2juo28I9wYzRtDOLbpqESnZRAHpPN5mYZeAuI5+LIZ7vNZL+XfLbLhwEkp3D1YfwPguIZ/7JBuhQ6KtH/8/074P4+X//sx0r8AUEsBAhQDFAAAAAgA3FAqXXluM9foAAAArQEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACADcUCpdm/036q0AAAApAQAACwAAAAAAAAAAAAAAgAEZAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACADcUCpdbKIMGeEBAABdAwAAEQAAAAAAAAAAAAAAgAHvAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAA/wMAAAAA';

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

    // 项目搜索
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

    // 项目详情 + 文档列表
    if (url.indexOf('searchProj.action') >= 0) {
      var b2 = (init && init.body) || '';
      var prjid = (b2.match(/prjid=([^&]*)/) || ['', ''])[1];
      var proj = PROJECTS.filter(function (p) { return p.prjid === prjid; })[0] || {};
      return jsonResp({ data: [{ prjid: prjid, projname: proj.projname, projectno: proj.projectno, projtype: proj.projtype, status: proj.status, fileList: FILES[prjid] || [] }] });
    }

    // 文件下载（docx → 合法最小 docx；其他 → 占位字节。本机无 WPS COM 时后端检查会报引擎错误，属预期）
    if (url.indexOf('downloadFileById.action') >= 0) {
      var id = decodeURIComponent((url.match(/idFile=([^&]*)/) || ['', ''])[1]);
      var meta = IDMAP[id];
      if (meta && /\.docx?$/i.test(meta.namFile)) {
        var raw = atob(DOCX_B64);
        var bytes = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return Promise.resolve(new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }));
      }
      return Promise.resolve(new Response('mock-file-bytes', { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }));
    }

    return origFetch(input, init);
  };

  console.log('[workbench.mock] 工作台 ITA 模拟数据已启用（?wbMock=1），共 ' + PROJECTS.length + ' 个虚构项目');
})();
