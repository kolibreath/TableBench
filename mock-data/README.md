# mock-data — 流程追踪 / 项目查询模拟数据集

本目录提供**可直接供插件消费**的模拟数据集，覆盖「进度跟踪（流程追踪）」与「项目工作台（项目查询）」两个功能的全部 ITA 接口。数据结构与真实抓包同构，人名/项目名/编号均为虚构（沿用内置 mock 的脱敏命名：张甲、李乙、赵丙、钱丁、孙戊、周己、吴庚、郑辛、冯癸、陈四）。

## 文件清单

| 文件 | 挂载的全局 | 消费方 | 功能 |
|---|---|---|---|
| `tracker-mock-data.js` | `globalThis.__abcTrackerMockData` | `content.tracker.js`（EXT 钩子） | 进度跟踪 / 流程追踪 |
| `workbench-mock-data.js` | `window.__abcWorkbenchMockData` | `workbench.mock.js`（EXT 合并） | 项目工作台 / 项目查询 |

## 接口 ↔ 数据字段映射（tracker-mock-data.js）

| 字段 | ITA 接口 | 请求 | 响应形状 |
|---|---|---|---|
| `grid` | `POST /ita/rptWkld/bindWcydGrid` | `year=…&projname=&projectno=&page=&pageSize=`（今年+去年各一次） | 顶层数组 `[{prjid, projname, projectno}]` |
| `managedActive` | `POST /ita/project/myManagedProj.action` | `year=…&status=1&pageSize=10&page=…` | 抓全后的行数组 `[{prjid, projname, projectno, projManClurl}]` |
| `managedOps` | 同上 | `status=5`（运维结项） | 同上，`processList` 视为空 |
| `grp` | `POST /ita/project/searchProj4GrpLeader.action` | `page=…&pageSize=10` | 行数组，**自带 `processList`**（免详情查询） |
| `proj` | `POST /ita/project/searchProj.action` | `bizdomain=0&prjid=…` | `{projname, processList:[{idProc, namProcDesc, indStsProc}], projManClurl, techManClurl}`（Clurl 字段自动提取为姓名→900 工号映射） |
| `overview` | `POST /ita/project/searchProj2022.action` | `projname=…&page=1&pageSize=100` | 按项目名索引 `{[projname]: [{prjid, projMan, projManID}]}`；`projManID` 是域账号，900 工号由详情 Clurl 组按姓名反查 |
| `flowHtml` | `GET /ita/subprocessimage.action?subprocessId=…` | — | 按 `idProc` 索引的流程图 HTML；`showtasktip('节点', '<tr>参与者/创建/执行者/动作/结束/状态</tr>…')`，「待处理」行即卡点 |

项目查询（workbench-mock-data.js）：

| 字段 | ITA 接口 | 说明 |
|---|---|---|
| `projects` | `POST /ita/project/searchProj2022.action` | `{data:[{prjid, projname, projectno, projtype, projMan}]}` 的 data |
| `files` | `POST /ita/project/searchProj.action` | 按 prjid 索引的 `fileList`（`idFile/namFile/fileSize/timeUpl/userName/fileType/typSecValue`） |

## 如何生效

**项目查询悬浮面板**：popup →「测试悬浮球」注入任意普通网页后，项目查询面板自动进入沙箱模式（非 ita.abc 页面自动启用，面板头部带「模拟数据」徽章）——搜索/文档列表直接读 `workbench-mock-data.js` 数据集，未注入该文件时退回 content.js 内置最小集；文档下载给占位文本文件；从面板打开「项目工作台」深链自动带 `?wbMock=1`。ITA 页面内始终走真实接口。

**流程追踪**（两种方式任选）：

1. 插件 popup →「测试悬浮球」注入任意普通网页（如 localhost 页面）——`popup.js` 已把本数据文件与 `tracker-watch.js` 一起注入，注入后打开「进度跟踪」面板即为本数据集（面板带「模拟数据」角标）；
2. 或把 `mock-data/tracker-mock-data.js` 加进任意先于 `content.tracker.js` 执行的环境（manifest `content_scripts` 的 `js` 数组头部）。

未加载数据文件时，`content.tracker.js` 自动回退到内置抓包 mock，行为与历史版本完全一致（E2E 不受影响）。想在控制台临时切回内置数据：`delete globalThis.__abcTrackerMockData` 后刷新面板。

**项目查询**：打开项目工作台（workbench.html）并在 URL 带 `?wbMock=1`。数据文件已在 `workbench.html` 中先于 `workbench.mock.js` 加载，6 个新项目**追加**在内置 3 个项目之后（内置场景原样保留），项目搜索/详情/文件下载全部可用。

## 演示场景覆盖

**流程追踪**（5 个项目 / 7 个运行中流程 / 6 段流程图 HTML）：

| 场景 | 项目 / 流程 | 预期表现 |
|---|---|---|
| 多人并行评审，部分完成 | 信贷中台·处室需求函审 | 吴庚、钱丁待处理，等待 50h → 红色超时（is-late） |
| 转办链 | 信贷中台·代码检查 | 集成管理员转钱丁后 22h 未处理，两人同卡 |
| 单人久卡 | 数据集市·工作量评估 | 赵丙 3 天+ 未处理 → 红色超时，催办话术演示 |
| 双节点连环卡点 | 手机银行·源代码安全自查 | 审批 6h + 复核 3h，一条流程多节点渲染 |
| 分钟级新卡点 | 渠道整合三期·代码检查 | 等待「30 分钟」档位 |
| 运行中无卡点 | 手机银行·渠道投产申请、统一支付·架构评审 | 折叠行「另有 N 个运行中流程暂无卡点」 |
| 跨页签项目重叠 | 信贷中台、手机银行同时出现在「我管理的」「我参与的」 | 会话级缓存命中、零重复请求 |
| 运维结项无流程 | 反洗钱系统运维保障（status=5） | 空清单友好态 |
| 职能组清单自带流程 | 渠道整合三期、统一支付灾备 | 免详情查询直达卡点 |
| 我参与的经理反查 | 数据集市（概况 吴庚 → 详情 Clurl 反查 900 工号） | Teams 深链按钮出现 |
| 概况无经理 | 手机银行（overview 置空数组） | 「我参与的」页签无经理按钮（「我管理的」仍有原生深链） |
| 已完成/取消流程 | 各项目 processList 中 `完成`/`取消` 条目 | 不参与卡点查询 |

日期为**相对数据文件加载时刻**动态生成（等待时长随时间自然增长），超出 24h 阈值的卡点自动变红色。

**项目查询**（6 个新项目 P20260021~26）：常规类文档齐全 / 敏捷类无设计说明书 / 快捷类「如有」档位缺项 / 科技基建类类型匹配失败（手动选择）/ fileType 空怪异值进「其他」/ 多上传人大时间跨度。

## 校验

数据集已用真实解析器（`tracker-watch.js` 的 `parseStuckNodes / flowFingerprint / diffFingerprint`）做回归：25 项断言全部通过（节点数、待处理人、waitMs>0、指纹稳定性、diff 语义、清单↔详情↔概况一致性、prjid/idProc 唯一性与内置数据无冲突）。改动本目录数据后建议跑一遍同类校验再发布。
