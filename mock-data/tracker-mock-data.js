/* tracker-mock-data.js — 进度跟踪（流程追踪）外部模拟数据集
 * ─────────────────────────────────────────────────────────
 * 挂载 globalThis.__abcTrackerMockData，content.tracker.js 检测到该全局即整体替换内置 mock。
 * 数据结构与 content.tracker.js 内置抓包 mock 完全同构，六个接口全覆盖：
 *
 *   grid          ← POST /ita/rptWkld/bindWcydGrid            我参与的（顶层数组，两年份合并去重后）
 *   managedActive ← POST /ita/project/myManagedProj.action    我管理的 status=1（{data:[…]} 抓全后行数组）
 *   managedOps    ← 同上 status=5 运维结项
 *   grp           ← POST /ita/project/searchProj4GrpLeader    职能组（清单自带 processList 免详情查询）
 *   proj          ← POST /ita/project/searchProj.action       项目详情（processList + 角色 Clurl）
 *   overview      ← POST /ita/project/searchProj2022.action   项目概况（projMan/projManID，按项目名索引）
 *   flowHtml      ← GET  /ita/subprocessimage.action          流程图 HTML（showtasktip 内联任务表，按 idProc 索引）
 *
 * 演示场景（5 个虚构项目，人名沿用内置 mock 的脱敏命名，日期相对加载时刻动态生成）：
 *   PRJZH0031002 信贷中台升级工程    我管理 + 我参与重叠（演示跨页签缓存共享）
 *                 ├ 处室需求函审(第2次) 4 人并行评审 2 完成 2 待处理（等待 50h → 红色 is-late）
 *                 ├ 代码检查(第2次)     转办链：集成管理员→钱丁，22h 未处理（黄色）
 *                 └ 测试准出(第2次)     已完成（不出现在卡点）
 *   PRJZH0052008 数据集市云化迁移    仅我参与（概况反查项目经理：吴庚）
 *                 ├ 工作量评估           单人久卡 3 天+（红色 is-late）
 *                 └ 总行结项(2026年9月)  已完成
 *   PRJZH0066006 手机银行适老化改造  我管理 + 我参与
 *                 ├ 源代码安全自查(第3次) 双节点连环卡点（审批 6h + 复核 3h）
 *                 └ 渠道投产申请          运行中无卡点（折叠行场景）
 *   PRJZH0044005 反洗钱系统运维保障  我管理 status=5 运维结项（processList 空 → 无运行流程）
 *   PRJZH0077001 渠道整合平台三期    职能组（清单自带 processList；新卡点 30 分钟级）
 *   PRJZH0081002 统一支付平台灾备建设 职能组（运行中无卡点 + 取消流程各一）
 */
(function () {
  'use strict';
  if (globalThis.__abcTrackerMockData) return; // 重复注入幂等

  // ── 相对时间工具（加载时刻为基准，等待时长随时间自然增长，贴近真实观感） ──
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var fmt = function (d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  };
  var ago = function (hours) { return fmt(new Date(Date.now() - hours * 3600e3)); };

  // 流程任务行（subprocessimage.action 内联表结构与抓包一致：参与者/创建/执行者/动作/结束/状态）
  var tr = function (person, since, executor, action, end, state) {
    return '<tr><td>' + person + '</td><td>' + (since || '') + '</td><td>' + (executor || '') +
      '</td><td>' + (action || '') + '</td><td>' + (end || '') + '</td><td>' + (state || '') + '</td></tr>';
  };
  var doneEnd = function (sinceHours, durMinutes) {
    return fmt(new Date(Date.now() - sinceHours * 3600e3 + durMinutes * 60e3));
  };
  var PENDING = function (person, sinceHours) { return tr(person, ago(sinceHours), '', '', '', '待处理'); };
  var DONE = function (person, sinceHours, durMinutes, action) {
    return tr(person, ago(sinceHours), person, action, doneEnd(sinceHours, durMinutes), '完成');
  };
  var tip = function (node, rows) {
    return "showtasktip('" + node + "', ' " + rows.join('') + "')";
  };
  var page = function () {
    var tips = Array.prototype.slice.call(arguments);
    return '<html><script>' + tips.join('') + '<\/script></html>';
  };

  // Teams 单聊深链（who/targetUsapId 必须 900 开头数字工号，域账号拉不起会话）
  var clurl = function (name, id) {
    return 'abcteams://?who=' + id + '&where=ITA&how=gotoSingleChat' +
      '&targetUserName=' + encodeURIComponent(name) + '&targetUsapId=' + id;
  };

  // ── 流程图 HTML（按 idProc 索引；缺省流程 = 运行中无卡点，与内置 mock 行为一致） ──
  var flowHtml = {};
  // 处室需求函审：4 人并行评审，2 完成 2 待处理（等待 50h → 超 24h 阈值，红色提醒）
  flowHtml[6411000000000001] = page(
    tip('申请', [DONE('李乙', 52, 30, '分发函审：吴庚、钱丁、孙戊、郑辛。')]),
    tip('出具意见', [
      DONE('孙戊', 50, 80, '评审意见：通过。'),
      DONE('郑辛', 50, 95, '评审意见：通过。'),
      PENDING('吴庚', 50),
      PENDING('钱丁', 50),
    ])
  );
  // 代码检查：转办链（申请→分发→集成管理员转处理给钱丁→两人 22h 未处理，黄色）
  flowHtml[6411000000000002] = page(
    tip('申请', [DONE('张甲', 31, 60, '分发代码检查填写：钱丁。')]),
    tip('指定处理人', [tr('研发中心武汉研发部项目集成管理员', ago(30), '', '转处理给：钱丁。', doneEnd(30, 420), '完成')]),
    tip('代码检查', [PENDING('钱丁', 22), PENDING('吴庚', 22)])
  );
  // 工作量评估：单人久卡 3 天+（红色 is-late，催办话术演示）
  flowHtml[6411000000000004] = page(
    tip('工作量确认', [PENDING('赵丙', 77)])
  );
  // 源代码安全自查：双节点连环卡点（审批 6h + 复核 3h，验证多节点条目渲染）
  flowHtml[6411000000000006] = page(
    tip('部门经理审批', [PENDING('周己', 6)]),
    tip('需求复核', [PENDING('孙戊', 3)])
  );
  // 渠道整合平台三期代码检查：分钟级新卡点（等待展示「30 分钟」档位）
  flowHtml[6411000000000008] = page(
    tip('代码评审', [PENDING('郑辛', 0.5)])
  );
  // 统一支付平台灾备建设架构评审：运行中无卡点（全完成行 → 折叠行场景）
  flowHtml[6411000000000009] = page(
    tip('架构评审', [
      DONE('张甲', 100, 50, '提交评审材料。'),
      DONE('冯癸', 96, 30, '评审意见：通过。'),
    ])
  );

  // ── 各接口数据 ──
  globalThis.__abcTrackerMockData = {
    // 我参与的（bindWcydGrid 两年份合并去重后的行）
    grid: [
      { prjid: 'PRJZH0031002', projname: '信贷中台升级工程', projectno: '科维2026-0311' },
      { prjid: 'PRJZH0052008', projname: '数据集市云化迁移', projectno: 'XRK2026-0521' },
      { prjid: 'PRJZH0066006', projname: '手机银行适老化改造', projectno: 'XRK2026-0661' },
    ],

    // 我管理的 status=1（projManClurl 原生数字工号深链，项目经理按钮直接用）
    managedActive: [
      { prjid: 'PRJZH0031002', projname: '信贷中台升级工程', projectno: '科维2026-0311', projManClurl: clurl('张甲', '990001001') },
      { prjid: 'PRJZH0066006', projname: '手机银行适老化改造', projectno: 'XRK2026-0661', projManClurl: clurl('李乙', '990001002') },
    ],
    // 我管理的 status=5 运维结项（processList 空 → 无运行中流程）
    managedOps: [
      { prjid: 'PRJZH0044005', projname: '反洗钱系统运维保障', projectno: '科维2025-0441', projManClurl: '' },
    ],

    // 职能组（响应自带 processList + projManClurl → 清单即详情，零额外查询）
    grp: [
      {
        prjid: 'PRJZH0077001', projname: '渠道整合平台三期', projectno: '农银科项字【2026】第0747号',
        projManClurl: clurl('陈四', '990029505'),
        processList: [
          { idProc: 6411000000000008, namProcDesc: '【渠道整合平台三期】代码检查(第8次准出)', indStsProc: '正常运行' },
          { idProc: 6411000000000011, namProcDesc: '【渠道整合平台三期】测试准出(第8次)', indStsProc: '完成' },
          { idProc: 6411000000000012, namProcDesc: '【渠道整合平台三期】源代码安全自查(第8次)', indStsProc: '取消' },
        ],
      },
      {
        prjid: 'PRJZH0081002', projname: '统一支付平台灾备建设', projectno: '农银科项字【2026】第0812号',
        projManClurl: clurl('孙戊', '990001005'),
        processList: [
          { idProc: 6411000000000009, namProcDesc: '【统一支付平台灾备建设】架构评审', indStsProc: '正常运行' },
          { idProc: 6411000000000010, namProcDesc: '【统一支付平台灾备建设】技术方案函审', indStsProc: '取消' },
        ],
      },
    ],

    // 项目详情（searchProj.action data[0]；角色 Clurl 组供「我参与的」按姓名反查 900 工号）
    proj: {
      PRJZH0031002: {
        projname: '信贷中台升级工程',
        projManClurl: clurl('张甲', '990001001'),
        techManClurl: clurl('郑辛', '990009002'),
        processList: [
          { idProc: 6411000000000001, namProcDesc: '【信贷中台升级工程】处室需求函审(第2次)', indStsProc: '正常运行' },
          { idProc: 6411000000000002, namProcDesc: '【信贷中台升级工程】代码检查(第2次)', indStsProc: '正常运行' },
          { idProc: 6411000000000003, namProcDesc: '【信贷中台升级工程】测试准出(第2次)', indStsProc: '完成' },
        ],
      },
      PRJZH0052008: {
        projname: '数据集市云化迁移',
        projManClurl: clurl('吴庚', '990001006'),
        processList: [
          { idProc: 6411000000000004, namProcDesc: '【数据集市云化迁移】工作量评估', indStsProc: '正常运行' },
          { idProc: 6411000000000005, namProcDesc: '【数据集市云化迁移】总行结项(2026年9月)', indStsProc: '完成' },
        ],
      },
      PRJZH0066006: {
        projname: '手机银行适老化改造',
        projManClurl: clurl('李乙', '990001002'),
        techManClurl: clurl('周己', '990009001'),
        processList: [
          { idProc: 6411000000000006, namProcDesc: '【手机银行适老化改造】源代码安全自查(第3次)', indStsProc: '正常运行' },
          { idProc: 6411000000000007, namProcDesc: '【手机银行适老化改造】渠道投产申请', indStsProc: '正常运行' },
        ],
      },
      PRJZH0044005: {
        projname: '反洗钱系统运维保障',
        processList: [],
      },
    },

    // 项目概况（searchProj2022 按项目名索引；projManID 为域账号，900 工号从详情 Clurl 组反查；
    // 手机银行适老化改造置空 → 演示「我参与的」页签无项目经理按钮场景）
    overview: {
      '信贷中台升级工程': [{ prjid: 'PRJZH0031002', projMan: '张甲', projManID: 'zhangjia' }],
      '数据集市云化迁移': [{ prjid: 'PRJZH0052008', projMan: '吴庚', projManID: 'wugeng' }],
      '手机银行适老化改造': [],
    },

    flowHtml: flowHtml,
  };
})();
