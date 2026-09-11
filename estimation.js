/* global XLSX, Vue, mammoth, Segmentit */

/**
 * Pure static page implementation:
 * - No Vue build / no bundler
 * - Dependencies are loaded via <script> tags (vendor/xlsx.full.min.js)
 */

// ── 全局控制台输出开关 ──
// 设为 true 开启所有日志输出，false 静默（console.error 始终输出）
var DEBUG_LOG = false

;(function () {
  var _log = console.log.bind(console)
  var _warn = console.warn.bind(console)
  var _error = console.error.bind(console)

  console.log = function () {
    if (DEBUG_LOG) _log.apply(console, arguments)
  }
  console.warn = function () {
    if (DEBUG_LOG) _warn.apply(console, arguments)
  }
  // console.error 始终输出，不拦截
})();

// 同一项目需求批次最大功能名称限制
const MAX_FUNCTION_NAME_COUNT = 10

var allWpsList = []

/** v2.0.16 规则（当前最新版） */
const DEFAULT_RULES = [
  {
    id: '1',
    name: '功能点估算书版本校验',
    type: '强制',
    scheme: '当前是否为最新版（v2.0.16）',
    supported: true,
  },
  {
    id: '2',
    name: '功能点估算说明书依据校验',
    type: '强制',
    scheme: '功能点估算说明书中的内容是否有业务需求作为依据 \\n' +
      "规则来源：《功能点及工作量估算重点注意事项》 P33\\n" +
      '【用户开启AI辅助检查之后，通过查看"需求&功能点对比结果 - AI对比结果"查看功能名称是否在需求书中。】',
    supported: true,
  },
  {
    id: '3',
    name: '功能点拆分原则校验',
    type: '强制',
    scheme: '拆分的功能（EO、EI、EQ）是否符合功能点拆分原则',
    supported: false,
  },
  {
    id: '4',
    name: '必填项校验',
    type: '强制',
    scheme:
      '其中带"*"号的列为必填项',
    supported: true,
  },
  {
    id: '5',
    name: '功能名称命名校验',
    type: '强制',
    scheme:
      '1. 功能名称内容应该为"名词+动词"或者为"动词+名词"的形式。\\n' +
      '2. 功能名称不能包含"功能"、"优化 xx 功能"、"修改 xx 功能"等近似表述或词语。\\n' +
      '3. 功能名称不能仅通过数字区分，如 xx 功能1、xx 功能2 等。 \\n' +
      '4. 对于ILF内部逻辑文件，命名应该为"xxx表"，命名不应该包含数字或者字母，如文件1、文件2、文件IQ等 \\n' +
      "规则来源：《功能点及工作量估算重点注意事项》 P29、P31",
    supported: true,
  },
  {
    id: '6',
    name: '功能描述校验',
    type: '建议',
    scheme:
      '功能描述列如果为"增加"，则功能描述可以为空；功能描述列如果为"修改"，则不建议为空 \\n' +
      "规则来源：《功能点及工作量估算重点注意事项》 P29",
    supported: true,
  },
  {
    id: '7',
    name: '数据元素数量校验',
    type: '建议',
    scheme:
      '第L列为数据元素数量，第H列为功能分类。\\n' +
      '1. 非内部逻辑文件ILF：除纯前端类型外，若第G列为"修改"，则数据元素数量不应超过10。\\n' +
      '2. 内部逻辑文件ILF的数据元素数量也不应超过50。\\n' +
      "规则来源：《功能点及工作量估算重点注意事项》 P40",
    supported: true,
  },
  {
    id: '8',
    name: '重复功能名称校验',
    type: '强制',
    scheme:
      '1. 同一个功能名称在业务功能点、技术功能点（TFP）页签中不能重复 \\n' +
      '2. 写法相近的两个功能点可能也视作一个功能，如XX信息修改和修改XX信息  \\n' +
      "规则来源：《功能点及工作量估算重点注意事项》 P32 \\n" +
      '【用户开启AI辅助检查后，引擎判定为"写法相近"的功能名称对将交由AI大模型进行二次语义验证，确认是否确实构成重复/相近】',
    supported: true,
  },
  {
    id: '9',
    name: '业务章节功能点多估提示',
    type: '建议',
    scheme:
      `除纯前端类型外，在估算批次、需求文件名相同的情况下，同一个业务需求对应的功能名称不能超过${MAX_FUNCTION_NAME_COUNT}个 \\n` +
      `规则来源：《功能点及工作量估算重点注意事项》 P33 \\n ` +
      `【"一个章节中估算出很多功能也需要重点进行关注"】 （${MAX_FUNCTION_NAME_COUNT}为处室要求）`,
    supported: true,
  },
  {
    id: '10',
    name: '内部逻辑文件ILF基础表新增提示',
    type: '建议',
    scheme:
      '基础性质的表，如用户、权限、菜单等表，在升级改造项目中估算为新建ILF需要着重检查 \\n' +
      '规则来源：《功能点及工作量估算重点注意事项》 P38',
    supported: true,
  },
  {
    id: '11',
    name: '内部逻辑文件ILF基础表字段增删改提示',
    type: '建议',
    scheme:
      '1. 与需求说明书核对，需明确需求中对字段进行了增删改，而不是将字段的数据类型进行变化；\\n' +
      '2. 修改字段一般指的是长度、大类型的变化；大类型的变化比如从数字型变成了字符型，需要在业务需求中明确说明 \\n' +
      '规则来源：《功能点及工作量估算重点注意事项》 P39',
    supported: false,
  },
  {
    id: '12',
    name: '通用纯前端校验',
    type: '强制',
    scheme:
      '通用纯前端定义为对业务功能不变的前端页面的改造工作，必须是对已有功能的修改。\\n' +
      '如果H列为"通用纯前端"，则G列必须为"修改"。\\n ' +
      '规则来源：《功能点及工作量估算重点注意事项》 P11',
    supported: true,
  },
  {
    id: '13',
    name: 'EI、EQ、EO生成ILF引用个数校验',
    type: '强制',
    scheme:
      '对于功能分类（H列）为EI、EQ、EO时：\\n' +
      '1.ILF表名（F列）不能重复；\\n' +
      '2. 当N列填写了内容，且M列为数字时，按",，;；、"分割N列得到表名列表，其长度应不超过M列数字。\\n' +
      '规则来源：《功能点及工作量估算重点注意事项》 P27',
    supported: true,
  },
  {
    id: '14',
    name: '单名词差异功能名称提示',
    type: '建议',
    scheme:
      '功能名称若仅有一个名词不同（如"新增用户"和"新增角色"），建议重点复核是否为重复估算或描述过于相近。\\n' +
      '【用户开启AI辅助检查后，AI大模型将对单名词差异对进行语义验证，辅助判断是否确实存在重复估算风险。】',
    supported: true,
  },

]

/** v2.0.15 规则（与 v2.0.16 差异见《项目检查规则_v2.0.15.xlsx》；可上传该表以使用表中完整内容） */
const DEFAULT_RULES_V2015 = [
  {
    id: '1',
    name: '功能点估算书版本校验',
    type: '强制',
    scheme: '当前是否为最新版（v2.0.15）', supported: true
  },
  {
    id: '2',
    name: '功能点估算说明书依据校验',
    type: '强制',
    scheme: '功能点估算说明书中的内容是否有业务需求作为依据 \\n' +
      "规则来源：《功能点及工作量估算重点注意事项》 P33",
    supported: true
  },
  {
    id: '3',
    name: '功能点拆分原则校验',
    type: '强制',
    scheme: '拆分的功能（EO、EI、EQ）是否符合功能点拆分原则',
    supported: false
  },
  {
    id: '4',
    name: '必填项校验',
    type: '强制',
    scheme: '其中带"*"号的列为必填项',
    supported: true
  },
  {
    id: '5',
    name: '功能名称命名校验',
    type: '强制',
    scheme:
      '1. 功能名称内容应该为"名词+动词"或者为"动词+名词"的形式。\\n' +
      '2. 功能名称不能包含"功能"、"优化 xx 功能"、"修改 xx 功能"等近似表述或词语。\\n' +
      '3. 功能名称不能仅通过数字区分，如 xx 功能1、xx 功能2 等。 \\n' +
      '4. 对于ILF内部逻辑文件，命名应该为"xxx表"，命名不应该包含数字或者字母，如文件1、文件2、文件IQ等 \\n' +
      "规则来源：《功能点及工作量估算重点注意事项》 P29、P31",
    supported: true
  },
  {
    id: '6',
    name: '功能描述校验',
    type: '建议',
    scheme:
      '功能描述列如果为"增加"，则功能描述可以为空；功能描述列如果为"修改"，则不建议为空 \\n' +
      "规则来源：《功能点及工作量估算重点注意事项》 P29",
    supported: true
  },
  {
    id: '7',
    name: '数据元素数量校验',
    type: '建议',
    scheme:
      '第L列为数据元素数量，第H列为功能分类。\\n' +
      '1. 非内部逻辑文件ILF：除纯前端类型外，若第G列为"修改"，则数据元素数量不应超过10。\\n' +
      '2. 内部逻辑文件ILF的数据元素数量也不应超过50。\\n' +
      "规则来源：《功能点及工作量估算重点注意事项》 P40",
    supported: true
  },
  {
    id: '8',
    name: '重复功能名称校验',
    type: '强制',
    scheme:
      '1. 同一个功能名称在业务功能点、技术功能点（TFP）页签中不能重复 \\n' +
      '2. 写法相近的两个功能点可能也视作一个功能，如XX信息修改和修改XX信息  \\n' +
      "规则来源：《功能点及工作量估算重点注意事项》 P32",
    supported: true,
  },
  {
    id: '9',
    name: '业务章节功能点多估提示',
    type: '建议',
    scheme:
      `除纯前端类型外，在估算批次、需求文件名相同的情况下，同一个业务需求对应的功能名称不能超过${MAX_FUNCTION_NAME_COUNT}个 \\n` +
      `规则来源：《功能点及工作量估算重点注意事项》 P33 \\n ` +
      `【"一个章节中估算出很多功能也需要重点进行关注"】 （${MAX_FUNCTION_NAME_COUNT}为处室要求）`,
    supported: true
  },
  {
    id: '10',
    name: '内部逻辑文件ILF基础表新增提示',
    type: '建议',
    scheme:
      '基础性质的表，如用户、权限、菜单等表，在升级改造项目中估算为新建ILF需要着重检查 \\n' +
      '规则来源：《功能点及工作量估算重点注意事项》 P38',
    supported: true
  },
  {
    id: '11',
    name: '内部逻辑文件ILF基础表字段增删改提示',
    type: '建议',
    scheme:
      '1. 与需求说明书核对，需明确需求中对字段进行了增删改，而不是将字段的数据类型进行变化；\\n' +
      '2. 修改字段一般指的是长度、大类型的变化；大类型的变化比如从数字型变成了字符型，需要在业务需求中明确说明 \\n' +
      '规则来源：《功能点及工作量估算重点注意事项》 P39',
    supported: false
  },
  {
    id: '12',
    name: 'EI、EQ、EO生成ILF引用个数校验',
    type: '强制',
    scheme:
      '对于功能分类（H列）为EI、EQ、EO时：\\n' +
      '1.ILF表名（F列）不能重复；\\n' +
      '2. 当N列填写了内容，且M列为数字时，按",，;；、"分割N列得到表名列表，其长度应不超过M列数字。\\n' +
      '规则来源：《功能点及工作量估算重点注意事项》 P27',
    supported: true,
  },
  {
    id: '13',
    name: '单名词差异功能名称提示',
    type: '建议',
    scheme:
      '功能名称若仅有一个名词不同（如"新增用户"和"新增角色"），建议重点复核是否为重复估算或描述过于相近。',
    supported: true,
  },

]

const verbLike = new Set(
  [
    '获取', '增加', '修改', '删除', '查询', '导出', '展示', '显示', '支持', '维护',
    '配置', '管理', '执行', '生成', '优化', '复核', '更改', '创建', '校验', '审核',
    '发布', '改造', '反馈', '驳回', '审核', '审批', '通过', '提取', '新增', '更新',
    '定时', '刷新', '批量', '日终', "移除", "完成"
  ],)

const adjLike = new Set(
  [
    '新', '旧', '新旧', '普通', '异常', '常见', "常用", "公共", "经常"
  ]
);

/**
 * @typedef {'强制'|'建议'} Severity
 *
 * @typedef {Object} Rule
 * @property {string} id
 * @property {string} name
 * @property {Severity} type
 * @property {string} scheme
 * @property {boolean} [supported]
 *
 * @typedef {Object} Violation
 * @property {Severity} type
 * @property {string} ruleId
 * @property {string} ruleName
 * @property {string} sheet
 * @property {number} row
 * @property {number} col
 * @property {string} address
 * @property {string} message
 */

/** @type {{rules: Rule[], bookWb: any|null, businessSheets: string[], violations: Violation[], selectedSheet: string|null, violationMap: Map<string, Violation[]>, selectedRuleVersion: string, customRules: Rule[]|null, violationSheetFilter: string, bookFileName?: string, requireDocs?: { fileName: string, text: string, ext: string, batchName?: string }[], customNounPhrases?: string[], rule2SkipWords?: string[], rule10FuncNameKeywords?: string[], rule10RequireKeywords?: string[], aiApiUrl?: string, aiUrlStatus?: string}} */
const state = {
  rules: DEFAULT_RULES.slice(),
  bookWb: null,
  businessSheets: [],
  violations: [],
  selectedSheet: null,
  violationMap: new Map(),
  selectedRuleVersion: 'v2.0.16',
  customRules: null,
  violationSheetFilter: '__ALL__',
  bookFileName: '',
  /** 用户上传的多个业务需求说明书，按文件名去重；v2.0.16 按批次组织 */
  requireDocs: [],
  customNounPhrases: ['掌银', '网银'],
  rule2SkipWords: ['信息', '列表', '条目', '详情', '数据', '任务'],
  /** 规则10：功能名称包含以下词时，若需求书含升级/改造则提示 */
  rule10FuncNameKeywords: ['用户', '权限', '菜单', '网点信息', '规则', '记录'],
  rule10RequireKeywords: ['升级', '改造'],
  /** AI API URL（从 localStorage 初始化） */
  aiApiUrl: getAiApiUrl(),
  /** AI 连接状态：'' / 'testing' / 'ok' / 'err' */
  aiUrlStatus: '',
  /** 需求文档TOC标题映射：batch|index -> title */
  requireTocMap: {},
  /** 目录与正文一致性检查结果：batchName -> consistencyResult */
  tocConsistencyMap: {},
}

// UI is rendered by Vue (see bottom of file). No direct DOM refs here.

function must(cond, msg) {
  if (!cond) throw new Error(msg)
}

function isBlank(v) {
  return v == null || (typeof v === 'string' && v.trim() === '')
}

function toText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') {
    // 避免 3.10 被展示为 3.099999999 等浮点误差
    if (Number.isInteger(v)) return String(v)
    const s = v.toFixed(8) // 保留 8 位小数
    return s.replace(/0+$/, '').replace(/\.$/, '')
  }
  return String(v)
}

function normalizeText(v) {
  return toText(v).trim()
}

function colToLetter(col) {
  let n = col
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function addr(row, col) {
  return `${colToLetter(col)}${row}`
}

function getSheet(wb, name) {
  return wb && wb.Sheets ? wb.Sheets[name] : null
}

function getCell(sheet, row, col) {
  if (!sheet) return undefined
  const a = addr(row, col)
  const cell = sheet[a]
  return cell ? cell.v : undefined
}

function getRange(sheet) {
  const ref = sheet && sheet['!ref']
  if (!ref) return null
  return XLSX.utils.decode_range(ref)
}

function detectBusinessSheets(wb) {
  const re = /^[A-Z]{3}\d{6}_\d{4}$/
  return wb.SheetNames.filter((n) => re.test(n))
}

/** 技术功能点 sheet 名称：模块名(TFP)，如 SDC202501_0102(TFP) */
function detectTfpSheets(wb) {
  return wb.SheetNames.filter((n) => /^[A-Z]{3}\d{6}_\d{4}\s*\(TFP\)$/i.test(n))
}

function extractFunctionPoints(wb) {
  var businessSheets = detectBusinessSheets(wb)
  var result = []
  for (var si = 0; si < businessSheets.length; si++) {
    var sheetName = businessSheets[si]
    var sheet = getSheet(wb, sheetName)
    if (!sheet) continue
    var range = getRange(sheet)
    if (!range) continue
    var start = 39
    var end = range.e.r + 1
    var sheetCount = 0
    for (var r = start; r <= end; r++) {
      var batchVal = getCell(sheet, r, 1)
      var indexVal = getCell(sheet, r, 3)
      var batchNorm = normalizeText(batchVal)
      var indexRaw = normalizeText(indexVal)
      var indexNorm = extractChapterKeyFromCell(indexRaw) || indexRaw
      var nameVal = getCell(sheet, r, 6)
      var funcModule = normalizeText(getCell(sheet, r, 4))   // D列 功能模块
      if (isBlank(batchVal) && isBlank(indexVal) && isBlank(nameVal)) continue
      result.push({
        sheet: sheetName,
        batch: batchNorm,
        index: indexNorm,
        pointName: normalizeText(nameVal),
        funcModule: funcModule
      })
      sheetCount++
    }
    console.log('[extractFunctionPoints] sheet=' + sheetName + ' 提取 ' + sheetCount + ' 条功能点')
  }
  console.log('[extractFunctionPoints] 总计: ' + result.length + ' 条 (来自 ' + businessSheets.length + ' 个业务sheet)')
  return result
}

/** Jaccard 相似度：|A∩B|/|A∪B|，用于判断功能名称是否相近 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1
  const inter = [...setA].filter((x) => setB.has(x)).length
  const unionSize = new Set([...setA, ...setB]).size
  return unionSize ? inter / unionSize : 0
}

const JACCARD_SIMILARITY_THRESHOLD = 0.8

/** 将功能名称按字符拆成无序集合（用于重复/相近判断） */
function nameToCharSet(str) {
  const s = normalizeText(str)
  if (!s) return new Set()
  return new Set([...s].filter((c) => c.trim() || true))
}

/** 两集合是否完全相同（元素一致） */
function setEqual(a, b) {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

/** 判断两个功能名称是否相同或写法相近：先比较字符集是否完全相同，再算字符集 Jaccard 相似度 */
function isSimilarFuncName(a, b) {
  const x = normalizeText(a)
  const y = normalizeText(b)
  if (!x || !y) return false
  if (x === y) return true
  // 长度不同则不视作重复/相近
  if (x.length !== y.length) return false
  // 含"埋点"时只校验完全一致，不做相似度
  if (x.includes('埋点') || y.includes('埋点')) return false
  const setX = nameToCharSet(x)
  const setY = nameToCharSet(y)
  if (setEqual(setX, setY)) return true
  return jaccardSimilarity(setX, setY) >= JACCARD_SIMILARITY_THRESHOLD
}

/**
 * 比较两个字符串在分词意义上的差异数量是否为 1。
 * 使用 jieba 风格分词得到两个 token 列表，对称差集大小为 1 时返回 true。
 */
function isDiffEqualToOne(str1, str2) {
  const s1 = normalizeText(str1)
  const s2 = normalizeText(str2)
  if (!s1 || !s2) return false
  if (s1 === s2) return false
  const list1 = segmentZh(s1)
  const list2 = segmentZh(s2)
  const set1 = new Set(list1)
  const set2 = new Set(list2)
  if (set1.size !== set2.size) return false
  let diffCount = 0
  for (const t of set1) {
    if (!set2.has(t)) diffCount++
  }
  return diffCount === 1
}

/** 判断两个功能名称的差异是否仅由 verbLike 列表中的词构成 */
function onlyVerbDiff(a, b) {
  const x = normalizeText(a)
  const y = normalizeText(b)
  if (!x || !y) return false
  if (x === y) return false
  const tokensX = stripTokens(segmentZh(x))
  const tokensY = stripTokens(segmentZh(y))
  const setX = new Set(tokensX)
  const setY = new Set(tokensY)
  const diff = []
  for (const t of setX) {
    if (!setY.has(t)) diff.push(t)
  }
  for (const t of setY) {
    if (!setX.has(t)) diff.push(t)
  }
  if (!diff.length) return false
  return diff.every((t) => verbLike.has(t))
}

/** Rule 8: 字符过滤（仅保留中/英/数） */
function normalizeFuncNameForRule8(name) {
  const s = normalizeText(name)
  if (!s) return ''
  return s.replace(/[^\u4E00-\u9FFF0-9A-Za-z]/g, '')
}

/**
 * Rule 8（v2.0.15 / v2.0.16）相似判断：
 * - dup: 过滤后内容完全相同
 * - near: 基于词性重排序后相同
 *
 * @returns {null | 'dup' | 'near'}
 */
function compareFuncNamesForRule8(nameI, nameJ) {
  const a = normalizeFuncNameForRule8(nameI)
  const b = normalizeFuncNameForRule8(nameJ)
  if (!a || !b) return null
  if (a === b) return 'dup'

  const wtI = toWordTypesForRule8(a)
  const wtJ = toWordTypesForRule8(b)
  if (!wtI.length || !wtJ.length) return null

  // (3) 长度不同直接跳过
  if (wtI.length !== wtJ.length) return null

  // (4) 基于词性重排序后对比
  const order = { 名词: 1, 动词: 2, 其他: 3 }
  const reorder = (arr) =>
    arr
      .map((x, idx) => ({ ...x, idx }))
      .sort((x, y) => (order[x.type] - order[y.type]) || (x.idx - y.idx))
      .map((x) => x.w)
      .join('')
  if (reorder(wtI) === reorder(wtJ)) return 'near'
  return null
}

/** @param {string} s */
function toWordTypesForRule8(s) {
  const jieba = getJiebaSegmenter()
  const POSTAG = (jieba && jieba.POSTAG) || (typeof Segmentit !== 'undefined' && Segmentit.POSTAG) || null
  if (!jieba || !POSTAG || !jieba.doSegment) return []
  const result = jieba.doSegment(s)
  if (!Array.isArray(result)) return []
  const D_N = POSTAG.D_N != null ? POSTAG.D_N : 1048576
  const A_NR = POSTAG.A_NR != null ? POSTAG.A_NR : 128
  const A_NS = POSTAG.A_NS != null ? POSTAG.A_NS : 64
  const A_NX = POSTAG.A_NT != null ? POSTAG.A_NX : 16
  const A_NT = POSTAG.A_NT != null ? POSTAG.A_NT : 32
  const A_NZ = POSTAG.A_NZ != null ? POSTAG.A_NZ : 8
  const D_V = POSTAG.D_V != null ? POSTAG.D_V : 4096
  const nounFlags = D_N | A_NR | A_NS | A_NT | A_NZ | A_NX
  return result
    .filter((t) => t && t.w != null)
    .map((t) => {
      const w = normalizeText(t.w)
      const p = t.p || 0
      const type = p & nounFlags ? '名词' : p & D_V ? '动词' : '其他'
      return { w, type }
    })
    .filter((x) => x.w)
}

/** 词性序列一致，且仅 1 个名词 token 不同（用于规则14/13建议项） */
function isNearOneNounDiffForRule8(nameI, nameJ) {
  const a = normalizeFuncNameForRule8(nameI)
  const b = normalizeFuncNameForRule8(nameJ)
  if (!a || !b || a === b) return false
  const wtI = toWordTypesForRule8(a)
  const wtJ = toWordTypesForRule8(b)
  if (!wtI.length || !wtJ.length) return false
  if (wtI.length !== wtJ.length) return false
  const typesI = wtI.map((x) => x.type)
  const typesJ = wtJ.map((x) => x.type)
  for (let k = 0; k < typesI.length; k++) {
    if (typesI[k] !== typesJ[k]) return false
  }
  let nounDiff = 0
  for (let k = 0; k < wtI.length; k++) {
    const ti = wtI[k]
    const tj = wtJ[k]
    if (ti.type === '名词') {
      if (ti.w !== tj.w) nounDiff++
      // if (nounDiff > 1) return false
    } else if (ti.w !== tj.w) {
      return false
    }
  }
  return nounDiff === 1
}

/** 懒加载的 jieba 风格分词器（segmentit），用于 segmentZh / 名词提取 */
function getJiebaSegmenter() {
  if (typeof getJiebaSegmenter._instance !== 'undefined') return getJiebaSegmenter._instance
  getJiebaSegmenter._instance = null
  if (typeof Segmentit !== 'undefined' && Segmentit.Segment && Segmentit.useDefault) {
    try {
      getJiebaSegmenter._instance = Segmentit.useDefault(new Segmentit.Segment())
    } catch (_) { }
  }
  return getJiebaSegmenter._instance
}

function segmentZh(text) {
  const s = normalizeText(text)
  if (!s) return []
  const jieba = getJiebaSegmenter()
  if (jieba) {
    const result = jieba.doSegment(s, { simple: true })
    return Array.isArray(result) ? result.filter(Boolean).map((t) => String(t).trim()) : []
  }
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter('zh-Hans', { granularity: 'word' })
    const out = []
    for (const item of seg.segment(s)) {
      const t = item.segment.trim()
      if (!t) continue
      out.push(t)
    }
    return out
  }
  return s.split(/\s+/g).filter(Boolean)
}

function stripTokens(tokens) {
  const stop = new Set(['的', '了', '和', '及', '与', '或', '对', '于', '将', '把', '进行', '相关'])
  return tokens
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !stop.has(t))
    .filter((t) => !/^[\p{P}\p{S}]+$/u.test(t))
}

/**
 * 使用 jieba（segmentit）词性标注提取名词；无 jieba 时返回空数组（由调用方回退到 pickNounLikeTokens）。
 */
function getNounTokensFromJieba(text) {
  const s = normalizeText(text)
  if (!s) return []
  const jieba = getJiebaSegmenter()
  if (!jieba || !jieba.doSegment) return []
  const POSTAG = jieba.POSTAG || (typeof Segmentit !== 'undefined' && Segmentit.POSTAG) || null
  if (!POSTAG) return []
  try {
    const result = jieba.doSegment(s)
    if (!Array.isArray(result)) return []
    const D_N = POSTAG.D_N != null ? POSTAG.D_N : 1048576
    const A_NR = POSTAG.A_NR != null ? POSTAG.A_NR : 128
    const A_NS = POSTAG.A_NS != null ? POSTAG.A_NS : 64
    const A_NT = POSTAG.A_NT != null ? POSTAG.A_NT : 32
    const A_NZ = POSTAG.A_NZ != null ? POSTAG.A_NZ : 8
    const nounFlags = D_N | A_NR | A_NS | A_NT | A_NZ
    return result
      .filter((t) => t && (t.p & nounFlags))
      .map((t) => normalizeText(t.w))
      .filter(Boolean)
  } catch (_) {
    return []
  }
}

/**
 * 使用 jieba（segmentit）词性标注提取动词；无 jieba 时返回空数组（由调用方回退）。
 */
function getVerbTokensFromJieba(text) {
  const s = normalizeText(text)
  if (!s) return []
  const jieba = getJiebaSegmenter()
  if (!jieba || !jieba.doSegment) return []
  const POSTAG = jieba.POSTAG || (typeof Segmentit !== 'undefined' && Segmentit.POSTAG) || null
  if (!POSTAG) return []
  try {
    const result = jieba.doSegment(s)
    if (!Array.isArray(result)) return []
    const D_V = POSTAG.D_V != null ? POSTAG.D_V : 4096
    return result
      .filter((t) => t && (t.p & D_V))
      .map((t) => normalizeText(t.w))
      .filter(Boolean)
  } catch (_) {
    return []
  }
}

/**
 * 从分词结果中粗略挑选"名词性"关键词（无 jieba 词性时的回退）：
 * - 排除常见动词/虚词/形容词
 * - 保留长度>=2的中文词、全大写缩写
 */
function pickNounLikeTokens(tokens) {
  const result = []
  for (const raw of tokens) {
    const t = normalizeText(raw)
    if (!t) continue
    if (verbLike.has(t) || adjLike.has(t)) continue
    if (/^[A-Z]{2,}$/.test(t)) {
      result.push(t)
      continue
    }
    if (/^[\u4E00-\u9FFF]{2,}$/.test(t)) {
      result.push(t)
    }
  }
  return result
}

/**
 * 从规模估算书"业务需求对应章节或页数"单元格中提取章节 key（归并到前两级，如 3.4 / 3.4.1 -> 3.4）。
 * 支持：如"掌银部分 3.4"、"3.4"、"3.4.1"等混合文本。
 *
 * @param {any} cellText
 * @returns {string|null}
 */
function extractChapterKeyFromCell(cellText) {
  const s = normalizeText(cellText)
  if (!s) return null
  const m = s.match(/(\d+\.\d+)(?:\.\d+)?/)
  return m ? m[1] : null
}

const BACKEND_API_URL = (typeof FC_BACKEND_URL !== 'undefined' && FC_BACKEND_URL) || 'http://127.0.0.1:8765'

function getAiApiUrl() {
  return localStorage.getItem('aiApiUrl') || ''
}

async function apiCheckAiAvailable(url) {
  try {
    const payload = { url: url || getAiApiUrl() }
    const resp = await fetch(`${BACKEND_API_URL}/api/ai/check-available`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) return false
    const data = await resp.json()
    return data.available === true
  } catch (e) {
    console.warn('AI 可用性检查失败:', e.message)
    return false
  }
}

async function apiTestAiUrl(url) {
  try {
    const resp = await fetch(`${BACKEND_API_URL}/api/ai/check-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      return { ok: false, error: err.error || '请求失败' }
    }
    return await resp.json()
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

async function apiBatchAiMatch(items, aiUrl, ruleType) {
  try {
    const targetUrl = aiUrl || getAiApiUrl()
    const payload = { ruleType: ruleType || '2', items }
    if (targetUrl) payload.aiUrl = targetUrl
    const resp = await fetch(`${BACKEND_API_URL}/api/ai/batch-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) return null
    const data = await resp.json()
    return data.results || null
  } catch (e) {
    console.warn('AI 批量匹配调用失败:', e.message)
    return null
  }
}

async function apiCheckKeywords(batchName, chapter, keywords) {
  try {
    const resp = await fetch(`${BACKEND_API_URL}/api/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchName, chapter, keywords }),
    })
    if (!resp.ok) return null
    return await resp.json()
  } catch (e) {
    console.warn('后端 API 调用失败:', e.message)
    return null
  }
}

/**
 * 解析 A 列内容，归一化为 "批次N" 格式
 * "1" → "批次1"   "第一批" → "批次1"   "第一批次" → "批次1"
 * "02" → "批次2"  "第二批次" → "批次2"
 */
function normalizeBatchColumn(val) {
  const s = String(val || '').trim()
  if (!s) return ''
  if (/^\d+$/.test(s)) return '批次' + parseInt(s, 10)
  const cnMap = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 }
  const match = s.match(/[第]?([零一二三四五六七八九十\d]+)[批个期]/)
  if (match) {
    const numStr = match[1]
    if (/^\d+$/.test(numStr)) return '批次' + parseInt(numStr, 10)
    let num = 0
    for (const ch of numStr) {
      if (cnMap[ch] !== undefined) num = num * 10 + cnMap[ch]
    }
    if (num > 0) return '批次' + num
  }
  return ''
}

/**
 * 从需求说明书纯文本中提取"业务章节（前两级） -> 文本"的映射。
 * 章节标题格式尽可能模糊匹配，支持：
 * - 3.4 监护人填写预填单
 * - 3.4监护人填写预填单
 * - 3.4.监护人填写预填单
 * - 3.4.1 功能定义（会归并到 3.4）
 *
 * @param {string} text
 * @returns {Map<string, {title: string, text: string}>}
 */
function buildChapterMapFromText(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  // 标题行：允许无空格/有点号/有空格；最多 3 级
  const re = /^\s*(\d+)\.(\d+)(?:\.(\d+))?\s*\.?\s*(\S.*)?\s*$/

  /**
   * 找出所有"二级章节边界"起点（key 为 X.Y）
   * - X.Y 标题行与 X.Y.Z 子节行都会被视作属于 X.Y
   * - 边界按 X.Y 变化切片（即遇到不同 X.Y 才截断）
   */
  /** @type {{idx: number, key: string, title: string}[]} */
  const starts = []
  let builder = "";
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || '').trimEnd()
    const m = line.match(re)
    if (!m) continue
    const baseKey = `${m[1]}.${m[2]}`
    const titleText = (m[4] || '').trim()
    // 章节边界更倾向二级标题行；但若先出现 3.4.1，也先开 3.4 段
    if (titleText) {
      // 只有当该 baseKey 与上一段不同才作为新段起点
      const last = starts[starts.length - 1]
      if (!last || last.key !== baseKey) {
        starts.push({ idx: i, key: baseKey, title: line.trim() })
      }
    } else {
      // 无标题：降低误判，不作为边界
      continue
    }
  }

  /** @type {Map<string, {title: string, text: string}>} */
  const out = new Map()
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s]
    const endIdx = s + 1 < starts.length ? starts[s + 1].idx : lines.length
    const chunk = lines.slice(start.idx, endIdx).map((x) => String(x || '').trimEnd())
    out.set(start.key, { title: start.title || start.key, text: chunk.join('\n') })
  }
  return out
}

/**
 * 合并多个需求说明书的章节映射：同 key 的 text 追加拼接，任意一本命中即可算通过。
 *
 * @param {{fileName: string, text: string}[]} docs
 * @returns {Map<string, {title: string, text: string}>}
 */
function mergeChapterMaps(docs) {
  /** @type {Map<string, {title: string, text: string}>} */
  const out = new Map()
  for (const d of docs || []) {
    const m = buildChapterMapFromText(d.text || '')
    for (const [k, v] of m.entries()) {
      const cur = out.get(k)
      if (!cur) {
        out.set(k, { title: v.title || k, text: v.text || '' })
      } else {
        cur.text = [cur.text, v.text].filter(Boolean).join('\n\n')
        // title 保留已有的（更稳定），缺失时再补
        if (!cur.title) cur.title = v.title || k
      }
    }
  }
  return out
}

/**
 * 从批次名称中提取数字编号，支持多种格式（独立函数版本，供 buildComparisonData 使用）
 *   "第一批" → 1, "第1批" → 1, "1" → 1
 * 返回 null 表示无法提取
 */
function extractBatchNumberFromStr(batchStr) {
  if (!batchStr) return null
  var cnNums = {
    '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,
    '十一':11,'十二':12,'十三':13,'十四':14,'十五':15,'十六':16,'十七':17,'十八':18,'十九':19,'二十':20
  }
  var m = batchStr.match(/第(.+?)批/)
  if (m) {
    var numStr = m[1]
    if (cnNums[numStr] !== undefined) return cnNums[numStr]
    var n = parseInt(numStr, 10)
    if (!isNaN(n)) return n
  }
  // 处理 "批次1" / "批次12" 格式（normalizeBatchColumn 产出格式）
  var m2 = batchStr.match(/^批次(\d+)$/)
  if (m2) return parseInt(m2[1], 10)
  var n = parseInt(batchStr, 10)
  if (!isNaN(n)) return n
  return null
}

/**
 * 为估算书中的批次值找到对应的需求文档批次名（独立函数版本）
 */
function resolvePointBatchStr(pointBatch, wpsBatchNames, wpsNumToName) {
  if (!pointBatch) {
    if (wpsBatchNames.length === 1) return wpsBatchNames[0]
    return ''
  }
  if (wpsBatchNames.indexOf(pointBatch) !== -1) return pointBatch
  var num = extractBatchNumberFromStr(pointBatch)
  if (num !== null && wpsNumToName[num] !== undefined) return wpsNumToName[num]
  if (wpsBatchNames.length === 1) return wpsBatchNames[0]
  return pointBatch
}

/**
 * 构建比对数据：将估算书功能点列表与需求文档列表进行匹配。
 * 返回 { inBoth, inPoint, inWps }，其中 inBoth 项含 wpsDesc 字段。
 *
 * @param {{sheet:string, batch:string, index:string, pointName:string}[]} pointList
 * @param {{batch:string, index:string, wpsDesc:string}[]} allWpsList
 * @returns {{inBoth: Array, inPoint: Array, inWps: Array}}
 */
function buildComparisonData(pointList, allWpsList) {
  // 收集需求文档的批次信息
  var wpsBatchNames = []
  var wpsNumToName = {}
  for (var i = 0; i < allWpsList.length; i++) {
    var wb = (allWpsList[i].batch || '')
    if (wb && wpsBatchNames.indexOf(wb) === -1) {
      wpsBatchNames.push(wb)
      var wpsNum = extractBatchNumberFromStr(wb)
      if (wpsNum !== null) wpsNumToName[wpsNum] = wb
    }
  }

  // 构建 wpsMap：以 批次|章节号 为键
  var wpsMap = {}
  for (var i = 0; i < allWpsList.length; i++) {
    var w = allWpsList[i]
    var wpsIndexNorm = extractChapterKeyFromCell(w.index) || w.index
    var key = (w.batch || '') + '|' + wpsIndexNorm
    wpsMap[key] = w
  }

  // 匹配估算项到需求文档章节
  var inBoth = []
  var inPoint = []
  var matchedWpsKeys = {}
  for (var j = 0; j < pointList.length; j++) {
    var p = pointList[j]
    var pIndexNorm = extractChapterKeyFromCell(p.index) || p.index
    var effectiveBatch = resolvePointBatchStr(p.batch, wpsBatchNames, wpsNumToName)
    var pKey = effectiveBatch + '|' + pIndexNorm
    if (wpsMap[pKey]) {
      var matched = wpsMap[pKey]
      inBoth.push({
        batch: effectiveBatch,
        index: p.index,
        pointName: p.pointName,
        wpsDesc: matched.wpsDesc
      })
      matchedWpsKeys[pKey] = true
    } else {
      inPoint.push(p)
    }
  }

  // 找出需求文档中有但估算书中没有的章节（漏估）
  var inWps = []
  var seenInWpsKeys = {}
  for (var i = 0; i < allWpsList.length; i++) {
    var w = allWpsList[i]
    var wpsIndexNorm = extractChapterKeyFromCell(w.index) || w.index
    var key = (w.batch || '') + '|' + wpsIndexNorm
    if (!matchedWpsKeys[key] && !seenInWpsKeys[key]) {
      inWps.push(w)
      seenInWpsKeys[key] = true
    }
  }

  return { inBoth: inBoth, inPoint: inPoint, inWps: inWps }
}

/**
 * 合并 aiItems（来自 runChecks 规则2收集）和 cmpInBoth（来自 buildComparisonData）。
 * 去重逻辑：以 batch|index|pointName 为键，cmpInBoth 优先（含 wpsDesc）。
 */
function mergeInBothItems(aiItems, cmpInBoth) {
  var merged = []
  var seen = {}
  // cmpInBoth 优先（含 wpsDesc 更完整）
  for (var i = 0; i < cmpInBoth.length; i++) {
    var item = cmpInBoth[i]
    var key = (item.batch || '') + '|' + (item.index || '') + '|' + (item.pointName || '')
    seen[key] = true
    merged.push(item)
  }
  // aiItems 补充（仅添加 cmpInBoth 中不存在的）
  for (var i = 0; i < aiItems.length; i++) {
    var item = aiItems[i]
    var key = (item.batch || '') + '|' + (item.pointIndex || '') + '|' + (item.pointName || '')
    if (!seen[key]) {
      seen[key] = true
      // 统一字段名为 index
      merged.push({
        batch: item.batch,
        index: item.pointIndex,
        pointName: item.pointName
      })
    }
  }
  return merged
}

// ── Agent 统一校验结果缓存（供 onCompare 复用，避免重复 initSession）──
var _cachedCompareData = null     // { inPoint, inWps }
var _cachedCheckListRes = null    // Agent 返回的 checkListRes 数组
var _cachedCombinedInBoth = null  // 合并后的 inBoth（索引与 checkListRes 对应）
var _aiTimedOut = false           // AI 调用是否超时
var _aiTimeoutMessage = ''        // AI 超时提示信息
var _aiCompleted = false          // AI 调用是否已完成（无论成功与否）
var _aiAnalysisLog = ''           // AI 处理过程日志（供 onCompare 展示）
var _aiAnalysisLogLines = []      // SSE 累积日志行（数组 push + 最终 join，避免 O(n²) 字符串拷贝）
var _aiNodeErrors = []            // AI 节点异常收集 [{ node_id, node_title, exception }]

// AI 调用超时时间（毫秒）
var AI_CALL_TIMEOUT = 10 * 60 * 1000  // 10分钟（内网环境响应较慢）

/**
 * 带超时控制的 fetch 封装
 * @param {string} url
 * @param {object} options - fetch 选项
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, options, timeout) {
  var controller = new AbortController()
  var timeoutId = setTimeout(function () { controller.abort() }, timeout)
  options.signal = controller.signal
  return fetch(url, options).finally(function () { clearTimeout(timeoutId) })
}

function countCjkChars(s) {
  const m = String(s || '').match(/[\u4E00-\u9FFF]/g)
  return m ? m.length : 0
}

/**
 * 尝试从二进制内容中"捞出"可读文字（用于 wps 等无法按 docx 解析的文件）
 * 说明：这不是严格的格式解析，只是尽力提取连续的可见字符片段。
 */
function extractReadableTextFromBinary(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer)
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(u8)
  // UTF-16LE 也是常见的文本编码候选
  const utf16le = new TextDecoder('utf-16le', { fatal: false }).decode(u8)
  const candidate = countCjkChars(utf16le) > countCjkChars(utf8) ? utf16le : utf8
  // 清洗：将不可见字符归一为空格，并收敛多空白
  return candidate
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 功能名称允许的英文：技术缩写、V1/V2 版本号、全大写系统缩写、key-value 风格（如 key-value、key_value）
function isAllowedEnglishSegment(segment) {
  if (!segment ||
    !/^[A-Za-z0-9_-]+$/.test(segment) ||
    /^[A-Z]+$/.test(segment) ||
    /^[a-z]+$/.test(segment)
  ) return true
  const u = segment.toUpperCase()
  if (ALLOWED_TECH_ABBREVIATIONS.has(u)) return true
  if (/^V\d+$/i.test(segment)) return true
  if (/^v\d+$/i.test(segment)) return true
  if (segment.length >= 2 && segment === segment.toUpperCase()) return true
  if (/^[A-Za-z0-9]+[-_][A-Za-z0-9]+$/.test(segment)) return true
  return false
}
const ALLOWED_TECH_ABBREVIATIONS = new Set([
  'XML',
  'HTTP',
  'HTTPS',
  'AI',
  'UI',
  'API',
  'URL',
  'SQL',
  'JSON',
  'PDF',
  'ID',
  'KEY',
  'VALUE',
  'KEY-VALUE',
  'ITSC',
  'DT',
  'DOTA',
  'IFAR',
  "WPS",
  "EXCEL",
  "WORD",
  "EMAIL",
  "PDF",
  "F5",
  'WAR',
  'ISmart',
  'AIR',
  'IP',
  'CMDB',
  'PROFILE',
  "VCONSOLE",
  "TONGWEB",
  "ANDROID",
  "IOS",
  "BOEING",
  "UCLIENT",
  'TOPS',
  'UCAP',
  'SOCKET',
  "REDIS",
  "BMP"
])

function buildViolationMap(violations) {
  const map = new Map()
  for (const v of violations) {
    const key = `${v.sheet}|${v.row}|${v.col}`
    const arr = map.get(key) || []
    arr.push(v)
    map.set(key, arr)
  }
  return map
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

async function readWorkbookFromFile(file) {
  must(file, '未选择文件')
  const buf = await file.arrayBuffer()
  return XLSX.read(buf, { type: 'array' })
}

/** 从规则表工作簿解析规则（表头：序号、检查规则、是否支持、检查类型、检查方案） */
function parseRulesFromWorkbook(wb) {
  const sheetName = wb.SheetNames.find((n) => n.includes('检查') || n.includes('规则')) || wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  if (!ws) return []
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false })
  if (!rows.length) return []
  const header = (rows[0] || []).map((x) => normalizeText(String(x || '')))
  const idxId = header.findIndex((h) => h === '序号' || h === '编号')
  const idxName = header.findIndex((h) => h === '检查规则' || h === '规则')
  const idxSupport = header.findIndex((h) => h === '是否支持')
  const idxType = header.findIndex((h) => h === '检查类型' || h === '类型')
  const idxScheme = header.findIndex((h) => h === '检查方案' || h === '方案')
  if (idxId < 0 || idxName < 0) return []
  /** @type {Rule[]} */
  const out = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || !r.length) continue
    const id = normalizeText(String(r[idxId] ?? ''))
    if (!id) continue
    const supported = idxSupport >= 0 ? normalizeText(String(r[idxSupport] ?? '')) === '是' : true
    out.push({
      id,
      name: normalizeText(String(r[idxName] ?? '')),
      type: (idxType >= 0 ? normalizeText(String(r[idxType] ?? '')) : '强制') || '强制',
      scheme: idxScheme >= 0 ? normalizeText(String(r[idxScheme] ?? '')) : '',
      supported,
    })
  }
  return out
}

function applyRulesByVersion() {
  if (state.selectedRuleVersion === 'v2.0.16' && state.customRules && state.customRules.length > 0) {
    state.rules = state.customRules
  } else if (state.selectedRuleVersion === 'v2.0.15') {
    state.rules = DEFAULT_RULES_V2015.map((r) => ({ ...r }))
  } else {
    state.rules = DEFAULT_RULES.map((r) => ({ ...r }))
  }
}

function ruleName(ruleId) {
  const r = state.rules.find((x) => x.id === ruleId)
  return r ? r.name : `规则${ruleId}`
}

/** @returns {Violation[]} */
var _runChecksRunning = false
var _workflowGen = 0
async function runChecks(onEngineDone) {
  if (_runChecksRunning) {
    console.warn('[runChecks] 已在执行中，跳过重复调用')
    return []
  }
  _runChecksRunning = true
  try {
  const wb = state.bookWb
  must(wb, '未加载规模估算书')

  /** @type {Violation[]} */
  const out = []
  const ilfRows = []
  /** @type {{sheet: string, row: number, name: string}[]} */
  const nonIlfNamesCollect = []

  const requireDocs = Array.isArray(state.requireDocs) ? state.requireDocs : []

  // Rule 1: cover D18
  {
    const coverSheetName = wb.SheetNames[0]
    const cover = getSheet(wb, coverSheetName)
    const v = normalizeText(getCell(cover, 18, 4)) // D18
    const expected = state.selectedRuleVersion
    if (v !== expected) {
      out.push({
        type: '强制',
        ruleId: '1',
        ruleName: ruleName('1'),
        sheet: coverSheetName,
        row: 18,
        col: 4,
        address: 'D18',
        message: `模板版本应为 ${expected}，当前为 ${v || '空'}`,
      })
    }
  }

  // Business sheets checks: 4/5/6/7
  for (const sheetName of state.businessSheets) {
    const sheet = getSheet(wb, sheetName)
    if (!sheet) continue
    const range = getRange(sheet)
    if (!range) continue

    // header row 38, columns A-N
    const headerRow = 38
    /** @type {{col: number, headerText: string}[]} */
    const headers = []
    for (let c = 1; c <= 14; c++) {
      headers.push({ col: c, headerText: normalizeText(getCell(sheet, headerRow, c)) })
    }
    const requiredCols =
      state.selectedRuleVersion === 'v2.0.15'
        ? [2, 3, 4, 5, 6, 8, 9, 10, 11] // B,C,D,E,F,H,I,J,K
        : [1, 2, 3, 4, 6, 7, 8, 9, 10, 11] // A,B,C,D,F,G,H,I,J,K

    // iterate rows from 39
    const start = 39
    const end = range.e.r + 1
    let emptyStreak = 0
    for (let r = start; r <= end; r++) {
      // read row A-N
      let any = false
      const rowVals = new Array(14)
      for (let c = 1; c <= 14; c++) {
        const v = getCell(sheet, r, c)
        rowVals[c - 1] = v
        if (!isBlank(v)) any = true
      }

      if (!any) {
        emptyStreak++
        if (emptyStreak >= 30) break
        continue
      }
      emptyStreak = 0

      // Rule 4: required fields
      for (const c of requiredCols) {
        const v = rowVals[c - 1]
        if (isBlank(v)) {
          out.push({
            type: '强制',
            ruleId: '4',
            ruleName: ruleName('4'),
            sheet: sheetName,
            row: r,
            col: c,
            address: addr(r, c),
            message: `必填项未填写（列：${colToLetter(c)} ${(headers[c - 1] && headers[c - 1].headerText) || ''}）`,
          })
        }
      }
      // 当H列功能分类为 EI/EQ/EO 时，L列数据元素必填
      {
        const funcCategoryH = normalizeText(rowVals[8 - 1]) // H列
        if (['EI', 'EQ', 'EO'].includes(funcCategoryH)) {
          const vL = rowVals[12 - 1] // L列
          if (isBlank(vL)) {
            out.push({
              type: '强制',
              ruleId: '4',
              ruleName: ruleName('4'),
              sheet: sheetName,
              row: r,
              col: 12,
              address: addr(r, 12),
              message: `当H列为${funcCategoryH}时，L列数据元素为必填`,
            })
          }
        }
      }

      // collect rows for v2.0.16 规则13 / v2.0.15 规则12（H 为 EQ/EI/EO 时）
      {
        const funcCategoryH = normalizeText(rowVals[8 - 1]) // H列
        if (['EQ外部查询', 'EI外部输入', 'EO外部输出'].includes(funcCategoryH)) {
          ilfRows.push({
            sheet: sheetName,
            row: r,
            name: normalizeText(rowVals[6 - 1]),
            m: normalizeText(rowVals[13 - 1]),
            n: normalizeText(rowVals[14 - 1]),
          })
        }
      }

      // Rule 5: function name (F), 功能分类 (H)
      {
        const c = 6
        const name = normalizeText(rowVals[c - 1])
        if (!name) continue

        const funcCategoryH = normalizeText(rowVals[8 - 1]) // H列 功能分类
        if (name.includes('埋点') && funcCategoryH === '通用纯前端') continue

        // 功能名称长度 ≤2 时不进行规则5功能名称校验
        if (name.length <= 2) continue

        const funcCategory = funcCategoryH // H列 功能分类
        const isILF = funcCategory.includes('ILF内部逻辑文件')

        if (isILF) {
          if (/[\dA-Za-z]/.test(name)) {
            const matches = name.match(/[A-Za-z]+/g) || []
            const bad = matches.filter((m) => !isAllowedEnglishSegment(m))
            if (bad.length) {
              out.push({
                type: '强制',
                ruleId: '5',
                ruleName: ruleName('5'),
                sheet: sheetName,
                row: r,
                col: c,
                address: addr(r, c),
                message: 'ILF内部逻辑文件命名不应包含数字或字母（如文件1、文件IQ等）',
              })
            }

          }
        } else {
          const forbidden =
            name.includes('功能') || /优化.*功能/.test(name) || /修改.*功能/.test(name)
          if (forbidden) {
            var rowBatch = normalizeText(rowVals[0])
            var rowIdx = normalizeText(rowVals[2])
            var tk = rowBatch + '|' + rowIdx
            var tt = state.requireTocMap[tk]
            var skipForToc = tt && (tt.includes('功能') || tt.includes('优化') || tt.includes('修改'))
            if (!skipForToc) {
              out.push({
                type: '强制',
                ruleId: '5',
                ruleName: ruleName('5'),
                sheet: sheetName,
                row: r,
                col: c,
                address: addr(r, c),
                message: '功能名称不应包含"功能/优化xx功能/修改xx功能"等表述',
              })
            }
          }
          // 英文字母仅允许常见技术缩写
          {
            const matches = name.match(/[A-Za-z]+/g) || []
            const bad = matches.filter((m) => !isAllowedEnglishSegment(m))
            if (bad.length) {
              out.push({
                type: '强制',
                ruleId: '5',
                ruleName: ruleName('5'),
                sheet: sheetName,
                row: r,
                col: c,
                address: addr(r, c),
                message: `功能名称不应包含没有明确含义的英文字母（仅允许常见技术缩写，如 XML/HTTP/AI/UI 等）。当前包含：${bad.join(', ')}`,
              })
            }
          }
          const tokens = stripTokens(segmentZh(name))
          let nounTokens = getNounTokensFromJieba(name)
          let verbTokens = getVerbTokensFromJieba(name)
          // jieba/词性标注如果失败（同时提取不到名词/动词），回退到旧的核心词数量判断
          if (verbTokens.length === 0) {
            if (tokens.length < 2) {
              out.push({
                type: '强制',
                ruleId: '5',
                ruleName: ruleName('5'),
                sheet: sheetName,
                row: r,
                col: c,
                address: addr(r, c),
                message: '功能名称至少应包含一个名词和一个动词（名词+动词/动词+名词）',
              })
            }
          } else {
            if (verbTokens.length === 0) {
              out.push({
                type: '强制',
                ruleId: '5',
                ruleName: ruleName('5'),
                sheet: sheetName,
                row: r,
                col: c,
                address: addr(r, c),
                message: '功能名称至少应包含一个名词和一个动词（名词+动词/动词+名词）',
              })
            }
          }
          nonIlfNamesCollect.push({ sheet: sheetName, row: r, name })
        }
      }

      // Rule 10: ILF+增加+功能名含基础表关键词+需求书含升级/改造 -> 建议提示
      {
        const changeTypeG = normalizeText(rowVals[8 - 1])
        const funcCategoryH = normalizeText(rowVals[7 - 1])
        const nameF = normalizeText(rowVals[6 - 1])
        if (
          funcCategoryH.includes('ILF内部逻辑文件') &&
          changeTypeG === '增加' &&
          nameF
        ) {
          const kwList = Array.isArray(state.rule10FuncNameKeywords)
            ? state.rule10FuncNameKeywords
            : ['用户', '权限', '菜单', '网点信息', '规则', '记录']
          const reqKwList = Array.isArray(state.rule10RequireKeywords)
            ? state.rule10RequireKeywords
            : ['升级', '改造']
          const nameHasKw = kwList.some((kw) => kw && nameF.includes(kw))
          if (nameHasKw) {
            const requireDocs = Array.isArray(state.requireDocs) ? state.requireDocs : []
            const haystack = requireDocs.map((d) => d.text || '').join('\n')
            const reqHasKw = reqKwList.some((kw) => kw && haystack.includes(kw))
            if (reqHasKw) {
              out.push({
                type: '建议',
                ruleId: '10',
                ruleName: ruleName('10'),
                sheet: sheetName,
                row: r,
                col: 6,
                address: addr(r, 6),
                message: `功能名称"${nameF}"为ILF新增且含基础表相关词，需求书中含升级/改造表述，请着重检查是否应为新建`,
              })
            }
          }
        }
      }

      // Rule 6: description E depends on H
      {
        const desc = normalizeText(rowVals[5 - 1]) // E col=5
        const changeType = normalizeText(rowVals[7 - 1]) // G col=7
        const funcCategoryH = normalizeText(rowVals[8 - 1]) // H col=8
        const isIlf = funcCategoryH.includes('ILF内部逻辑文件')
        if (changeType === '修改' && !isIlf && !desc) {
          out.push({
            type: '建议',
            ruleId: '6',
            ruleName: ruleName('6'),
            sheet: sheetName,
            row: r,
            col: 5,
            address: addr(r, 5),
            message: '变更类型为"修改"时，功能描述不建议为空',
          })
        }
      }

      // Rule 12 (v2.0.16 only): 通用纯前端 -> G 必须为 修改
      if (state.selectedRuleVersion === 'v2.0.16') {
        const funcCategoryH = normalizeText(rowVals[8 - 1]) // H
        const changeTypeG = normalizeText(rowVals[7 - 1]) // G
        if (funcCategoryH === '通用纯前端' && changeTypeG !== '修改') {
          out.push({
            type: '强制',
            ruleId: '12',
            ruleName: ruleName('12'),
            sheet: sheetName,
            row: r,
            col: 7,
            address: addr(r, 7),
            message: 'H列为"通用纯前端"时，G列必须为"修改"',
          })
        }
      }

      // Rule 7: 数据元素数量 L，功能分类 H
      {
        const funcCategory = normalizeText(rowVals[8 - 1]) // H列 功能分类
        const changeType = normalizeText(rowVals[7 - 1])   // G列 变更类型
        const raw = rowVals[12 - 1]                       // L列 数据元素数量
        if (isBlank(raw)) continue
        const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
        if (!Number.isFinite(n)) continue

        const isILF = funcCategory.includes('ILF内部逻辑文件')
        if (isILF) {
          const limit = changeType === '修改' ? 5 : 50 // ILF：修改≤5；增加/其他≤50
          if (n > limit) {
            out.push({
              type: '建议',
              ruleId: '7',
              ruleName: ruleName('7'),
              sheet: sheetName,
              row: r,
              col: 12,
              address: addr(r, 12),
              message: `内部逻辑文件ILF在变更类型为"${changeType || '（空）'}"时，数据元素数量不建议超过${limit}（当前：${n}）`,
            })
          }
        } else {
          if (changeType === '修改' && n > 10 && funcCategory !== '通用纯前端') {
            out.push({
              type: '建议',
              ruleId: '7',
              ruleName: ruleName('7'),
              sheet: sheetName,
              row: r,
              col: 12,
              address: addr(r, 12),
              message: `变更类型为"修改"时，数据元素数量不建议超过10（当前：${n}）`,
            })
          }
        }
      }
    }
  }

  // Rule 5 补充：不能仅用数字区分功能名称（如 功能1、功能2）
  {
    /** @type {Map<string, {sheet: string, row: number, name: string}[]>} */
    const byBase = new Map()
    for (const it of nonIlfNamesCollect) {
      const base = (it.name || '').replace(/\d/g, '')
      if (!base) continue
      const arr = byBase.get(base) || []
      arr.push(it)
      byBase.set(base, arr)
    }
    for (const [, items] of byBase.entries()) {
      if (items.length < 2) continue
      const allHaveDigits = items.every((it) => /\d/.test(it.name))
      if (!allHaveDigits) continue
      for (const it of items) {
        const otherItem = items.find((x) => x.name !== it.name)
        const refDupName = (otherItem && otherItem.name) || it.name
        out.push({
          type: '强制',
          ruleId: '5',
          ruleName: ruleName('5'),
          sheet: it.sheet,
          row: it.row,
          col: 6,
          address: addr(it.row, 6),
          message: `功能名称不能仅用数字区分（与"${refDupName}"等仅数字不同）`,
        })
      }
    }
  }

  // Rule 8: 重复/相近功能名称 — ①业务内 ②TFP内 ③业务与TFP之间（①②先按 A-E 分组再判 F 重复/相近）
  // AI 校验对收集（去重）
  const rule8AiPairs = []
  const rule8PairSeen = new Set()
  const rule8AiMap = new Map() // pairKey -> { sheet, rowI, rowJ }
  const rule8RowViolationMap = new Map() // "sheet|row" -> violation index in out[]
  const addRule8Pair = (nameI, nameJ, kind, sheetName, rowI, rowJ, aeGroup) => {
    // 仅"写法相近"(near)需要AI辅助二次验证，"完全重复"(dup)引擎判断已足够可靠
    if (kind !== 'near') return
    const pairKey = [nameI, nameJ].sort().join('|||')
    if (rule8PairSeen.has(pairKey)) return
    rule8PairSeen.add(pairKey)
    rule8AiPairs.push({
      nameI: nameI,
      nameJ: nameJ,
      rule8Kind: kind,
      context: { sheet: sheetName, rowI: rowI, rowJ: rowJ, aeGroup: aeGroup },
    })
    rule8AiMap.set(pairKey, { sheet: sheetName, rowI: rowI, rowJ: rowJ })
  }
  const key = (s, r) => `${s}|${r}`
  /** @type {Map<string, Set<string>>} key(sheet,row) -> 其他与之重复/相近的功能名称 */
  const businessOtherNames = new Map()
  const tfpOtherNames = new Map()
  /** @type {Map<string, 'dup' | 'near'>} */
  const businessKindByKey = new Map()
  /** @type {Map<string, 'dup' | 'near'>} */
  const tfpKindByKey = new Map()

  const kindPriority = (k) => (k === 'dup' ? 2 : 1)
  const setKindMax = (map, k, kind) => {
    const cur = map.get(k)
    if (!cur || kindPriority(kind) > kindPriority(cur)) map.set(k, kind)
  }

  const pushRule8 = (sheet, row, message, otherNames) => {
    const suffix = otherNames && otherNames.size
      ? '，与以下重复或相近：' + [...otherNames].map((n) => `"${n}"`).join('、')
      : ''
    var violation = {
      type: '强制',
      ruleId: '8',
      ruleName: ruleName('8'),
      sheet,
      row,
      col: 6,
      address: addr(row, 6),
      message: message + suffix,
      aiPending: false,
      aiStatus: '',
      aiReason: '',
    }
    out.push(violation)
    // 返回刚添加的 violation 的索引，供调用方决定是否标记 AI 待验证
    return out.length - 1
  }

  // Rule 8 跳过条件：功能名称含"埋点"且 H 列为"通用纯前端"
  const shouldSkipRule8Row = (sheet, r, name) => {
    if (!name || !String(name).includes('埋点')) return false
    const funcCategoryH = normalizeText(getCell(sheet, r, 8))
    return funcCategoryH === '通用纯前端'
  }

  // ① 业务功能点内：先按同一 sheet 下 A-E 相同分组，再判 F 列重复或相近
  const businessViolated = new Set()
  for (const sheetName of state.businessSheets) {
    const sheet = getSheet(wb, sheetName)
    if (!sheet) continue
    const range = getRange(sheet)
    if (!range) continue
    /** @type {Map<string, {row: number, name: string}[]>} */
    const byAE = new Map()
    for (let r = 39; r <= range.e.r + 1; r++) {
      const a = normalizeText(getCell(sheet, r, 1))
      const b = normalizeText(getCell(sheet, r, 2))
      const c = normalizeText(getCell(sheet, r, 3))
      const d = normalizeText(getCell(sheet, r, 4))
      const e = normalizeText(getCell(sheet, r, 5))
      const f = normalizeText(getCell(sheet, r, 6))
      if (!a && !b && !c && !d && !e && !f) continue
      if (shouldSkipRule8Row(sheet, r, f)) continue
      const keyAE = `${a}\t${b}\t${c}\t${d}\t${e}`
      const arr = byAE.get(keyAE) || []
      arr.push({ row: r, name: f })
      byAE.set(keyAE, arr)
    }
    for (const [keyAE, rows] of byAE) {
      if (rows.length < 2) continue
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const kind = compareFuncNamesForRule8(rows[i].name, rows[j].name)
          if (!kind) continue
          addRule8Pair(rows[i].name, rows[j].name, kind, sheetName, rows[i].row, rows[j].row, keyAE)
          const ki = key(sheetName, rows[i].row)
          const kj = key(sheetName, rows[j].row)
          businessViolated.add(ki)
          businessViolated.add(kj)
          setKindMax(businessKindByKey, ki, kind)
          setKindMax(businessKindByKey, kj, kind)
          const setI = businessOtherNames.get(ki) || new Set()
          const setJ = businessOtherNames.get(kj) || new Set()
          setI.add(rows[j].name)
          setJ.add(rows[i].name)
          businessOtherNames.set(ki, setI)
          businessOtherNames.set(kj, setJ)
        }
      }
    }
  }
  for (const sheetName of state.businessSheets) {
    const sheet = getSheet(wb, sheetName)
    if (!sheet) continue
    const range = getRange(sheet)
    if (!range) continue
    for (let r = 39; r <= range.e.r + 1; r++) {
      const f = normalizeText(getCell(sheet, r, 6))
      if (shouldSkipRule8Row(sheet, r, f)) continue
      const k = key(sheetName, r)
      if (businessViolated.has(k)) {
        const kind = businessKindByKey.get(k) || 'near'
        const msg =
          kind === 'dup'
            ? '业务功能点内存在重复的功能名称'
            : '业务功能点内存在相近的功能名称'
        var _vIdx8 = pushRule8(sheetName, r, msg, businessOtherNames.get(k))
        // 'near' 类型需要 AI 二次验证，标记为待验证
        if (kind === 'near') {
          out[_vIdx8].aiPending = true
          out[_vIdx8].aiStatus = 'pending'
          rule8RowViolationMap.set(sheetName + '|' + r, _vIdx8)
        }
      }
    }
  }

  // ② 技术功能点(TFP)内：先按同一 sheet 下 A-E 相同分组，再判 F 列重复或相近
  const tfpSheets = detectTfpSheets(wb)
  const tfpViolated = new Set()
  for (const sheetName of tfpSheets) {
    const sheet = getSheet(wb, sheetName)
    if (!sheet) continue
    const range = getRange(sheet)
    if (!range) continue
    /** @type {Map<string, {row: number, name: string}[]>} */
    const byAE = new Map()
    for (let r = 39; r <= range.e.r + 1; r++) {
      const a = normalizeText(getCell(sheet, r, 1))
      const b = normalizeText(getCell(sheet, r, 2))
      const c = normalizeText(getCell(sheet, r, 3))
      const d = normalizeText(getCell(sheet, r, 4))
      const e = normalizeText(getCell(sheet, r, 5))
      const f = normalizeText(getCell(sheet, r, 6))
      if (!a && !b && !c && !d && !e && !f) continue
      if (shouldSkipRule8Row(sheet, r, f)) continue
      const keyAE = `${a}\t${b}\t${c}\t${d}\t${e}`
      const arr = byAE.get(keyAE) || []
      arr.push({ row: r, name: f })
      byAE.set(keyAE, arr)
    }
    for (const [keyAE, rows] of byAE) {
      if (rows.length < 2) continue
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const kind = compareFuncNamesForRule8(rows[i].name, rows[j].name)
          if (!kind) continue
          addRule8Pair(rows[i].name, rows[j].name, kind, sheetName, rows[i].row, rows[j].row, keyAE)
          const ki = key(sheetName, rows[i].row)
          const kj = key(sheetName, rows[j].row)
          tfpViolated.add(ki)
          tfpViolated.add(kj)
          setKindMax(tfpKindByKey, ki, kind)
          setKindMax(tfpKindByKey, kj, kind)
          const setI = tfpOtherNames.get(ki) || new Set()
          const setJ = tfpOtherNames.get(kj) || new Set()
          setI.add(rows[j].name)
          setJ.add(rows[i].name)
          tfpOtherNames.set(ki, setI)
          tfpOtherNames.set(kj, setJ)
        }
      }
    }
  }
  for (const sheetName of tfpSheets) {
    const sheet = getSheet(wb, sheetName)
    if (!sheet) continue
    const range = getRange(sheet)
    if (!range) continue
    for (let r = 39; r <= range.e.r + 1; r++) {
      const f = normalizeText(getCell(sheet, r, 6))
      if (shouldSkipRule8Row(sheet, r, f)) continue
      const k = key(sheetName, r)
      if (tfpViolated.has(k)) {
        const kind = tfpKindByKey.get(k) || 'near'
        const msg =
          kind === 'dup'
            ? '技术功能点(TFP)内存在重复的功能名称'
            : '技术功能点(TFP)内存在相近的功能名称'
        var _vIdx8t = pushRule8(sheetName, r, msg, tfpOtherNames.get(k))
        if (kind === 'near') {
          out[_vIdx8t].aiPending = true
          out[_vIdx8t].aiStatus = 'pending'
          rule8RowViolationMap.set(sheetName + '|' + r, _vIdx8t)
        }
      }
    }
  }

  // ③ 业务功能点 与 技术功能点 之间：同一模块内不能重复或写法相近，并列举 TFP 中对应名称
  /** @type {{name: string, sheet: string, row: number}[]} */
  const businessItems = []
  for (const sheetName of state.businessSheets) {
    const sheet = getSheet(wb, sheetName)
    if (!sheet) continue
    const range = getRange(sheet)
    if (!range) continue
    for (let r = 39; r <= range.e.r + 1; r++) {
      const name = normalizeText(getCell(sheet, r, 6))
      if (!name) continue
      if (shouldSkipRule8Row(sheet, r, name)) continue
      businessItems.push({ name, sheet: sheetName, row: r })
    }
  }
  /** @type {{name: string, sheet: string, row: number}[]} */
  const tfpItems = []
  for (const sheetName of tfpSheets) {
    const sheet = getSheet(wb, sheetName)
    if (!sheet) continue
    const range = getRange(sheet)
    if (!range) continue
    for (let r = 39; r <= range.e.r + 1; r++) {
      const name = normalizeText(getCell(sheet, r, 6))
      if (!name) continue
      if (shouldSkipRule8Row(sheet, r, name)) continue
      tfpItems.push({ name, sheet: sheetName, row: r })
    }
  }
  for (const b of businessItems) {
    if (businessViolated.has(key(b.sheet, b.row))) continue
    const similarTfpNames = new Set()
    var _hasNearCross = false
    for (const t of tfpItems) {
      // 业务 sheet 与 TFP sheet 需同一模块：业务 SDC2022_0408 vs TFP SDC2022_0408 (TFP)
      const baseB = b.sheet
      const baseT = t.sheet.replace(/\s*\(TFP\)$/i, '')
      if (baseB !== baseT) continue
      const crossKind = compareFuncNamesForRule8(b.name, t.name)
      if (!crossKind) continue
      addRule8Pair(b.name, t.name, crossKind, b.sheet, b.row, t.row, 'cross-' + baseB)
      similarTfpNames.add(t.name)
      if (crossKind === 'near') _hasNearCross = true
    }
    if (similarTfpNames.size) {
      var _vIdx8c = pushRule8(b.sheet, b.row, '功能名称与技术功能点(TFP)中重复或写法相近，业务与TFP不能重复。', similarTfpNames)
      if (_hasNearCross) {
        out[_vIdx8c].aiPending = true
        out[_vIdx8c].aiStatus = 'pending'
        rule8RowViolationMap.set(b.sheet + '|' + b.row, _vIdx8c)
      }
    }
  }

  // Rule 14 (v2.0.16) / Rule 13 (v2.0.15): 仅单个名词不同提示（建议）
  // AI 校验对收集（去重）
  const rule14AiPairs = []
  const rule14PairSeen = new Set()
  const rule14AiMap = new Map()
  const rule14RowViolationMap = new Map() // "sheet|row" -> violation index in out[]
  const addRule14Pair = (nameI, nameJ, sheetName, rowI, rowJ, aeGroup) => {
    const pairKey = [nameI, nameJ].sort().join('|||')
    if (rule14PairSeen.has(pairKey)) return
    rule14PairSeen.add(pairKey)
    rule14AiPairs.push({
      nameI: nameI,
      nameJ: nameJ,
      context: { sheet: sheetName, rowI: rowI, rowJ: rowJ, aeGroup: aeGroup },
    })
    rule14AiMap.set(pairKey, { sheet: sheetName, rowI: rowI, rowJ: rowJ })
  }
  {
    const ruleId = state.selectedRuleVersion === 'v2.0.16' ? '14' : '13'
    /** @type {Map<string, Set<string>>} */
    const businessNearOneOtherNames = new Map()
    /** @type {Map<string, Set<string>>} */
    const tfpNearOneOtherNames = new Map()
    /** @type {Map<string, Set<string>>} */
    const crossNearOneOtherNames = new Map()
    const addOtherName = (map, k, name) => {
      const set = map.get(k) || new Set()
      set.add(name)
      map.set(k, set)
    }
    const pushRuleNearOneNoun = (sheet, row, message, otherNames) => {
      const suffix = otherNames && otherNames.size
        ? '，与以下名称仅单个名词不同：' + [...otherNames].map((n) => `"${n}"`).join('、')
        : ''
      out.push({
        type: '建议',
        ruleId,
        ruleName: ruleName(ruleId),
        sheet,
        row,
        col: 6,
        address: addr(row, 6),
        message: message + suffix,
        aiPending: false,
        aiStatus: '',
        aiReason: '',
      })
      return out.length - 1
    }

    // ① 业务功能点内
    for (const sheetName of state.businessSheets) {
      const sheet = getSheet(wb, sheetName)
      if (!sheet) continue
      const range = getRange(sheet)
      if (!range) continue
      /** @type {Map<string, {row: number, name: string}[]>} */
      const byAE = new Map()
      for (let r = 39; r <= range.e.r + 1; r++) {
        const a = normalizeText(getCell(sheet, r, 1))
        const b = normalizeText(getCell(sheet, r, 2))
        const c = normalizeText(getCell(sheet, r, 3))
        const d = normalizeText(getCell(sheet, r, 4))
        const e = normalizeText(getCell(sheet, r, 5))
        const f = normalizeText(getCell(sheet, r, 6))
        if (!a && !b && !c && !d && !e && !f) continue
        if (shouldSkipRule8Row(sheet, r, f)) continue
        const keyAE = `${a}\t${b}\t${c}\t${d}\t${e}`
        const arr = byAE.get(keyAE) || []
        arr.push({ row: r, name: f })
        byAE.set(keyAE, arr)
      }
      for (const [keyAE, rows] of byAE) {
        if (rows.length < 2) continue
        for (let i = 0; i < rows.length; i++) {
          for (let j = i + 1; j < rows.length; j++) {
            if (!isNearOneNounDiffForRule8(rows[i].name, rows[j].name)) continue
            addRule14Pair(rows[i].name, rows[j].name, sheetName, rows[i].row, rows[j].row, keyAE)
            const ki = key(sheetName, rows[i].row)
            const kj = key(sheetName, rows[j].row)
            addOtherName(businessNearOneOtherNames, ki, rows[j].name)
            addOtherName(businessNearOneOtherNames, kj, rows[i].name)
          }
        }
      }
    }
    for (const sheetName of state.businessSheets) {
      const sheet = getSheet(wb, sheetName)
      if (!sheet) continue
      const range = getRange(sheet)
      if (!range) continue
      for (let r = 39; r <= range.e.r + 1; r++) {
        const f = normalizeText(getCell(sheet, r, 6))
        if (shouldSkipRule8Row(sheet, r, f)) continue
        const k = key(sheetName, r)
        if (!businessNearOneOtherNames.has(k)) continue
        var _vIdx14 = pushRuleNearOneNoun(sheetName, r, '业务功能点内存在相近的功能名称（仅单个名词不同）', businessNearOneOtherNames.get(k))
        out[_vIdx14].aiPending = true
        out[_vIdx14].aiStatus = 'pending'
        rule14RowViolationMap.set(sheetName + '|' + r, _vIdx14)
      }
    }

    // ② 技术功能点(TFP)内
    for (const sheetName of tfpSheets) {
      const sheet = getSheet(wb, sheetName)
      if (!sheet) continue
      const range = getRange(sheet)
      if (!range) continue
      /** @type {Map<string, {row: number, name: string}[]>} */
      const byAE = new Map()
      for (let r = 39; r <= range.e.r + 1; r++) {
        const a = normalizeText(getCell(sheet, r, 1))
        const b = normalizeText(getCell(sheet, r, 2))
        const c = normalizeText(getCell(sheet, r, 3))
        const d = normalizeText(getCell(sheet, r, 4))
        const e = normalizeText(getCell(sheet, r, 5))
        const f = normalizeText(getCell(sheet, r, 6))
        if (!a && !b && !c && !d && !e && !f) continue
        if (shouldSkipRule8Row(sheet, r, f)) continue
        const keyAE = `${a}\t${b}\t${c}\t${d}\t${e}`
        const arr = byAE.get(keyAE) || []
        arr.push({ row: r, name: f })
        byAE.set(keyAE, arr)
      }
      for (const [keyAE, rows] of byAE) {
        if (rows.length < 2) continue
        for (let i = 0; i < rows.length; i++) {
          for (let j = i + 1; j < rows.length; j++) {
            if (!isNearOneNounDiffForRule8(rows[i].name, rows[j].name)) continue
            addRule14Pair(rows[i].name, rows[j].name, sheetName, rows[i].row, rows[j].row, keyAE)
            const ki = key(sheetName, rows[i].row)
            const kj = key(sheetName, rows[j].row)
            addOtherName(tfpNearOneOtherNames, ki, rows[j].name)
            addOtherName(tfpNearOneOtherNames, kj, rows[i].name)
          }
        }
      }
    }
    for (const sheetName of tfpSheets) {
      const sheet = getSheet(wb, sheetName)
      if (!sheet) continue
      const range = getRange(sheet)
      if (!range) continue
      for (let r = 39; r <= range.e.r + 1; r++) {
        const f = normalizeText(getCell(sheet, r, 6))
        if (shouldSkipRule8Row(sheet, r, f)) continue
        const k = key(sheetName, r)
        if (!tfpNearOneOtherNames.has(k)) continue
        var _vIdx14t = pushRuleNearOneNoun(sheetName, r, '技术功能点(TFP)内存在相近的功能名称（仅单个名词不同）', tfpNearOneOtherNames.get(k))
        out[_vIdx14t].aiPending = true
        out[_vIdx14t].aiStatus = 'pending'
        rule14RowViolationMap.set(sheetName + '|' + r, _vIdx14t)
      }
    }

    // ③ 业务功能点 与 技术功能点 之间
    for (const b of businessItems) {
      const bk = key(b.sheet, b.row)
      for (const t of tfpItems) {
        const baseB = b.sheet
        const baseT = t.sheet.replace(/\s*\(TFP\)$/i, '')
        if (baseB !== baseT) continue
        if (!isNearOneNounDiffForRule8(b.name, t.name)) continue
        addRule14Pair(b.name, t.name, b.sheet, b.row, t.row, 'cross-' + baseB)
        addOtherName(crossNearOneOtherNames, bk, t.name)
      }
    }
    for (const b of businessItems) {
      const bk = key(b.sheet, b.row)
      if (!crossNearOneOtherNames.has(bk)) continue
      var _vIdx14c = pushRuleNearOneNoun(
        b.sheet,
        b.row,
        '功能名称与技术功能点(TFP)中存在相近名称（仅单个名词不同），建议复核。',
        crossNearOneOtherNames.get(bk),
      )
      out[_vIdx14c].aiPending = true
      out[_vIdx14c].aiStatus = 'pending'
      rule14RowViolationMap.set(b.sheet + '|' + b.row, _vIdx14c)
    }
  }

  // Rule 9: 业务章节功能点多估（按版本选择分组键）
  for (const sheetName of state.businessSheets) {
    const sheet = getSheet(wb, sheetName)
    if (!sheet) continue
    const range = getRange(sheet)
    if (!range) continue
    /** @type {Map<string, {row: number, name: string}[]>} */
    const group = new Map()
    for (let r = 39; r <= range.e.r + 1; r++) {
      const a = normalizeText(getCell(sheet, r, 1))
      const b = normalizeText(getCell(sheet, r, 2))
      const c = normalizeText(getCell(sheet, r, 3))
      const d = normalizeText(getCell(sheet, r, 4))
      const e = normalizeText(getCell(sheet, r, 5))
      const f = normalizeText(getCell(sheet, r, 6))
      if (!a && !b && !c && !d && !e && !f) continue
      const funcCategoryH = normalizeText(getCell(sheet, r, 8))
      if (funcCategoryH.includes('ILF内部逻辑文件') || funcCategoryH === '通用纯前端') {
        // ILF内部逻辑文件、通用纯前端不计入功能点多估统计
        continue
      }
      const key =
        state.selectedRuleVersion === 'v2.0.15'
          ? `${b}\t${c}\t${d}\t${e}` // B系统 C模块 D功能模块 E章节或页数
          : `${a}\t${b}\t${c}\t${d}` // A估算批次 B需求文件名 C章节或页数 D功能模块
      const arr = group.get(key) || []
      arr.push({ row: r, name: f })
      group.set(key, arr)
    }
    for (const [, rows] of group) {
      if (rows.length <= 15) continue
      for (const { row } of rows) {
        out.push({
          type: '建议',
          ruleId: '9',
          ruleName: ruleName('9'),
          sheet: sheetName,
          row,
          col: 6,
          address: addr(row, 6),
          message:
            state.selectedRuleVersion === 'v2.0.15'
              ? `同一系统、模块、功能模块、章节或页数下，功能名称不宜超过${MAX_FUNCTION_NAME_COUNT}项（当前：${rows.length}项）`
              : `同一估算批次、需求文件名、章节或页数、功能模块下，功能名称不宜超过${MAX_FUNCTION_NAME_COUNT}项（当前：${rows.length}项）`,
        })
      }
    }
  }

  // Rule 13 (v2.0.16) / Rule 12 (v2.0.15): 表名重复与引用个数校验（H列为 EQ/EI/EO 时执行）
  if (ilfRows.length) { // ilfRows实际上为EI EQ EO
    const ruleId = state.selectedRuleVersion === 'v2.0.16' ? '13' : '12'
    /** @type {Map<string, {sheet: string, row: number}[]>} */
    const nameMap = new Map()
    for (const it of ilfRows) {
      const name = it.name || ''
      if (!name) continue
      const arr = nameMap.get(name) || []
      arr.push({ sheet: it.sheet, row: it.row })
      nameMap.set(name, arr)
    }
    for (const it of ilfRows) {
      const nText = it.n
      const mText = it.m
      if (!nText || !normalizeText(nText)) continue
      if (!mText || !normalizeText(mText)) continue
      const mNum = Number(String(mText).trim())
      if (!Number.isFinite(mNum)) continue
      const parts = String(nText)
        .split(/[,\，;\；、]+/g)
        .map((s) => s.trim())
        .filter(Boolean)
      if (parts.length > mNum) {
        out.push({
          type: '强制',
          ruleId,
          ruleName: ruleName(ruleId),
          sheet: it.sheet,
          row: it.row,
          col: 14,
          address: addr(it.row, 14),
          message: `N列拆分得到的表名数量（${parts.length}）应小于 M列数字（${mNum}）`,
        })
      }
    }
  }
  // ── AI 大模型统一校验：规则2 + 规则8 + 规则14（v2.0.16 专用）──
  // 第一步：收集规则2 AI 校验项
  var aiItems = []
  var aiRowMap = new Map()
  if (state.selectedRuleVersion === 'v2.0.16' && requireDocs.length > 0) {
    for (var _si = 0; _si < state.businessSheets.length; _si++) {
      var _sheetName = state.businessSheets[_si]
      var _sheet = getSheet(wb, _sheetName)
      if (!_sheet) continue
      var _range = getRange(_sheet)
      if (!_range) continue
      for (var _r = 39; _r <= _range.e.r + 1; _r++) {
        var _name = normalizeText(getCell(_sheet, _r, 6))
        if (!_name) continue
        var _funcCatH = normalizeText(getCell(_sheet, _r, 8))
        // 跳过 ILF 内部逻辑文件
        if (_funcCatH.includes('ILF内部逻辑文件')) continue
        // 跳过埋点 + 通用纯前端
        if (_name.includes('埋点') && _funcCatH === '通用纯前端') continue
        if (_name.length <= 2) continue
        var _batchName = normalizeBatchColumn(getCell(_sheet, _r, 1))
        var _chapterKey = extractChapterKeyFromCell(getCell(_sheet, _r, 3))
        if (!_batchName || !_chapterKey) continue
        var _matchedDoc = requireDocs.find(function(d) { return d.batchName === _batchName })
        if (!_matchedDoc) continue
        aiItems.push({ batch: _batchName, pointIndex: _chapterKey, pointName: _name })
        aiRowMap.set(_batchName + '|' + _chapterKey + '|' + _name, { sheet: _sheetName, row: _r })
      }
    }
  }

  // 第二步：收集比对 inBoth 数据（原 onCompare 逻辑，提前至此合并发送）
  var _combinedInBoth = aiItems.slice() // 先复制规则2的 aiItems
  if (state.selectedRuleVersion === 'v2.0.16' && state.bookWb) {
    // 跨 sheet 去重（同 onCompare 逻辑）
    var _pointList = extractFunctionPoints(state.bookWb)
    var _seenIdx = {}
    var _mergedPointList = []
    for (var _pi = 0; _pi < _pointList.length; _pi++) {
      var _pp = _pointList[_pi]
      var _idxKey = (_pp.index || '') + '|' + (_pp.batch || '') + '|' + (_pp.pointName || '') + '|' + (_pp.funcModule || '')
      if (!_seenIdx[_idxKey]) { _seenIdx[_idxKey] = true; _mergedPointList.push(_pp) }
    }
    var _cmpData = buildComparisonData(_mergedPointList, allWpsList)
    // 缓存 inPoint/inWps 供 onCompare 使用
    _cachedCompareData = { inPoint: _cmpData.inPoint, inWps: _cmpData.inWps }
    // 合并 aiItems 与比对 inBoth（去重，含 wpsDesc 的优先）
    _combinedInBoth = mergeInBothItems(aiItems, _cmpData.inBoth)
  }

  // 通知调用方：引擎检查完成，可以先展示带 AI 加载状态的违例
  if (typeof onEngineDone === 'function') {
    onEngineDone(out.slice())
  }

  // 第三步：统一 Agent 工作流（规则2 + 规则8 + 规则14 + 比对数据合并为一次 initSession）
  _aiTimedOut = false
  _aiCompleted = false
  _aiTimeoutMessage = ''
  _aiAnalysisLog = ''
  _aiAnalysisLogLines = []
  _aiNodeErrors = []
  if (state.selectedRuleVersion === 'v2.0.16' && (_combinedInBoth.length > 0 || rule8AiPairs.length > 0 || rule14AiPairs.length > 0)) {
    var _aiAvail = false
    try { _aiAvail = await apiCheckAiAvailable(state.aiApiUrl) } catch (_) {}
    if (_aiAvail) {
      var _maxLen = Math.max(_combinedInBoth.length, rule8AiPairs.length, rule14AiPairs.length)
      if (_maxLen > 0) {
        var _BATCH = 100
        var _chunks = Math.ceil(_maxLen / _BATCH)

        // 初始化累积缓存（多分块结果将合并至此）
        _cachedCheckListRes = []
        _cachedCombinedInBoth = []

        for (var _ci = 0; _ci < _chunks; _ci++) {
          var _chunkInBoth = _combinedInBoth.slice(_ci * _BATCH, (_ci + 1) * _BATCH)
          var _chunkRule8 = rule8AiPairs.slice(_ci * _BATCH, (_ci + 1) * _BATCH)
          var _chunkRule14 = rule14AiPairs.slice(_ci * _BATCH, (_ci + 1) * _BATCH)

          try {
            // 1. initSession — 获取 session_id
            var _initResp = await fetchWithTimeout(BACKEND_API_URL + '/agentInitSession', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                baseUrl: state.aiApiUrl,
                inBoth: _chunkInBoth,
                rule8Items: _chunkRule8,
                rule14Items: _chunkRule14
              }),
            }, AI_CALL_TIMEOUT)
            var _initData = await _initResp.json()
            var _sessionId = (_initData.data && _initData.data.session_id) || ''
            if (!_sessionId) {
              console.warn('Agent 分块 ' + (_ci + 1) + '/' + _chunks + ' 未获取到 session_id')
              continue
            }
            console.log('[AI] Agent 会话初始化成功，session_id:', _sessionId)

            // 2. agentInitChat — 前端直接读取 SSE 流并解析
            var _chatResp = await fetch(BACKEND_API_URL + '/agentInitChat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl: state.aiApiUrl, sessionId: _sessionId }),
            })

            var _reader = _chatResp.body.getReader()
            var _decoder = new TextDecoder()
            var _agentOut = null
            var _sseBuffer = ''

            var _sseDone = false
            while (!_sseDone) {
              var _chunk = await _reader.read()
              _sseDone = _chunk.done
              var _sseText = _decoder.decode(_chunk.value || new Uint8Array(), { stream: !_sseDone })
              _sseBuffer += _sseText
              var _sseLines = _sseBuffer.split('\n')
              _sseBuffer = _sseLines.pop() || ''
              for (var _li = 0; _li < _sseLines.length; _li++) {
                var _line = _sseLines[_li].trim()
                if (!_line.startsWith('data: ')) continue
                var _raw = _line.slice(6)
                if (_raw === '[DONE]') continue
                if (_raw.startsWith('event:')) continue
                if (_raw.startsWith('data:')) _raw = _raw.slice(5)
                console.log('[AI] Agent SSE:', _raw)
                // 实时追加 SSE 原始行到日志（打字机效果）
                _aiAnalysisLogLines.push(_raw)
                try {
                  var _parsed = JSON.parse(_raw)
                  // ── 收集 AI 节点异常信息（type === "ai" 且 exception 非空）──
                  if (_parsed.type === 'ai') {
                    var _ak2 = _parsed.additional_kwargs || {}
                    var _noOut = (_ak2.node_output && _ak2.node_output.output) || {}
                    var _exc = _noOut.exception
                    if (_exc && String(_exc).trim()) {
                      _aiNodeErrors.push({
                        node_id: _ak2.node_id || '',
                        node_title: _ak2.node_title || '',
                        exception: String(_exc).trim(),
                        _expanded: _aiNodeErrors.length === 0  // 首条默认展开
                      })
                      console.warn('[AI] 节点异常:', _ak2.node_id, _ak2.node_title, _exc)
                      _aiAnalysisLogLines.push('[异常] node_id=' + _ak2.node_id + ' title=' + _ak2.node_title + '\n' + String(_exc))
                    }
                  }
                  // ── 原有最终结果提取逻辑 ──
                  var _addKwargs = _parsed.additional_kwargs || {}
                  if (_addKwargs.node_id === 'end') {
                    var _nodeOutput = _addKwargs.node_output || {}
                    // 循环解析：output 可能是多重转义的 JSON 字符串
                    var _parsedOutput = _nodeOutput.output
                    for (var _dp = 0; _dp < 5; _dp++) {
                      if (typeof _parsedOutput === 'string') {
                        try { _parsedOutput = JSON.parse(_parsedOutput) } catch (_je) { break }
                      } else { break }
                    }
                    _agentOut = _parsedOutput
                    // 解包 finalRes 外层包装（AI 接口新格式）
                    if (_agentOut && _agentOut.finalRes) {
                      _agentOut = _agentOut.finalRes
                    }
                    console.log('[AI] Agent 最终结果:', JSON.stringify(_agentOut))
                    _aiAnalysisLogLines.push('', '===== 最终结果 =====')
                    _aiAnalysisLogLines.push(JSON.stringify(_agentOut, null, 2))
                  }
                } catch (_sseErr) {
                  // 非 JSON 行，忽略
                }
              }
            }

            // 3. 应用三合一结果到 violations
            if (!_agentOut) {
              console.warn('Agent 分块 ' + (_ci + 1) + '/' + _chunks + ' SSE 流结束但未获取到最终结果')
              continue
            }
            if (Array.isArray(_agentOut)) {
              _agentOut = _agentOut[0] || {}
            }

            // 规则2 violations（checkListRes）
            var _clr = _agentOut.checkListRes || []
            for (var _ri = 0; _ri < _clr.length && _ri < _chunkInBoth.length; _ri++) {
              var _res2 = _clr[_ri]
              var _item2 = _chunkInBoth[_ri]
              if (_res2.isInWPS === false) {
                var _key2 = _item2.batch + '|' + _item2.pointIndex + '|' + _item2.pointName
                var _meta2 = aiRowMap.get(_key2)
                if (_meta2) {
                  out.push({
                    type: '强制',
                    ruleId: '2',
                    ruleName: ruleName('2'),
                    sheet: _meta2.sheet,
                    row: _meta2.row,
                    col: 6,
                    address: addr(_meta2.row, 6),
                    message: '功能名称"' + _item2.pointName + '"在第' + _item2.batch + '需求中的需求项' + _item2.pointIndex + '可能未在需求文档中找到依据',
                    source: 'ai',
                    reason: _res2.reason || '',
                  })
                }
              }
            }

            // 规则8 violations（rule8Result）— 更新已有违例的 AI 状态
            var _r8r = _agentOut.rule8Result || []
            console.log('[AI] rule8Result 数量:', _r8r.length, 'rule8AiMap 大小:', rule8AiMap.size, 'rule8RowViolationMap 大小:', rule8RowViolationMap.size)
            for (var _ri = 0; _ri < _r8r.length && _ri < _chunkRule8.length; _ri++) {
              var _r8 = _r8r[_ri]
              var _pk8 = [_r8.nameI, _r8.nameJ].sort().join('|||')
              var _meta8 = rule8AiMap.get(_pk8)
              var _sh8 = (_meta8 && _meta8.sheet) || ''
              var _rwI8 = (_meta8 && _meta8.rowI) || 0
              var _rwJ8 = (_meta8 && _meta8.rowJ) || 0
              // 更新 nameI 对应行的 violation
              var _vKey8I = _sh8 + '|' + _rwI8
              var _vIdx8aiI = rule8RowViolationMap.get(_vKey8I)
              console.log('[AI] rule8 匹配:', _r8.nameI, 'vs', _r8.nameJ, '| pairKey:', _pk8, '| meta:', _meta8 ? '找到' : '未找到', '| vKeyI:', _vKey8I, '| vIdxI:', _vIdx8aiI, '| confirmed:', _r8.aiConfirmed)
              if (_vIdx8aiI !== undefined && out[_vIdx8aiI]) {
                delete out[_vIdx8aiI].aiPending
                out[_vIdx8aiI].aiStatus = _r8.aiConfirmed ? 'confirmed' : 'not-confirmed'
                out[_vIdx8aiI].aiReason = _r8.reason || ''
                console.log('[AI] rule8 违例已更新(rowI):', out[_vIdx8aiI].message, '-> aiStatus:', out[_vIdx8aiI].aiStatus)
              }
              // 更新 nameJ 对应行的 violation（与 nameI 行展示相同的 reason）
              if (_rwJ8 && _rwJ8 !== _rwI8) {
                var _vKey8J = _sh8 + '|' + _rwJ8
                var _vIdx8aiJ = rule8RowViolationMap.get(_vKey8J)
                if (_vIdx8aiJ !== undefined && out[_vIdx8aiJ]) {
                  delete out[_vIdx8aiJ].aiPending
                  out[_vIdx8aiJ].aiStatus = _r8.aiConfirmed ? 'confirmed' : 'not-confirmed'
                  out[_vIdx8aiJ].aiReason = _r8.reason || ''
                  console.log('[AI] rule8 违例已更新(rowJ):', out[_vIdx8aiJ].message, '-> aiStatus:', out[_vIdx8aiJ].aiStatus)
                }
              }
            }

            // 规则14 violations（rule14Result）— 更新已有违例的 AI 状态
            var _r14r = _agentOut.rule14Result || []
            console.log('[AI] rule14Result 数量:', _r14r.length, 'rule14AiMap 大小:', rule14AiMap.size, 'rule14RowViolationMap 大小:', rule14RowViolationMap.size)
            for (var _ri = 0; _ri < _r14r.length && _ri < _chunkRule14.length; _ri++) {
              var _r14 = _r14r[_ri]
              var _pk14 = [_r14.nameI, _r14.nameJ].sort().join('|||')
              var _meta14 = rule14AiMap.get(_pk14)
              var _sh14 = (_meta14 && _meta14.sheet) || ''
              var _rwI14 = (_meta14 && _meta14.rowI) || 0
              var _rwJ14 = (_meta14 && _meta14.rowJ) || 0
              // 更新 nameI 对应行的 violation
              var _vKey14I = _sh14 + '|' + _rwI14
              var _vIdx14aiI = rule14RowViolationMap.get(_vKey14I)
              console.log('[AI] rule14 匹配:', _r14.nameI, 'vs', _r14.nameJ, '| pairKey:', _pk14, '| meta:', _meta14 ? '找到' : '未找到', '| vKeyI:', _vKey14I, '| vIdxI:', _vIdx14aiI, '| confirmed:', _r14.aiConfirmed)
              if (_vIdx14aiI !== undefined && out[_vIdx14aiI]) {
                delete out[_vIdx14aiI].aiPending
                out[_vIdx14aiI].aiStatus = _r14.aiConfirmed ? 'confirmed' : 'not-confirmed'
                out[_vIdx14aiI].aiReason = _r14.reason || ''
                console.log('[AI] rule14 违例已更新(rowI):', out[_vIdx14aiI].message, '-> aiStatus:', out[_vIdx14aiI].aiStatus)
              }
              // 更新 nameJ 对应行的 violation（与 nameI 行展示相同的 reason）
              if (_rwJ14 && _rwJ14 !== _rwI14) {
                var _vKey14J = _sh14 + '|' + _rwJ14
                var _vIdx14aiJ = rule14RowViolationMap.get(_vKey14J)
                if (_vIdx14aiJ !== undefined && out[_vIdx14aiJ]) {
                  delete out[_vIdx14aiJ].aiPending
                  out[_vIdx14aiJ].aiStatus = _r14.aiConfirmed ? 'confirmed' : 'not-confirmed'
                  out[_vIdx14aiJ].aiReason = _r14.reason || ''
                  console.log('[AI] rule14 违例已更新(rowJ):', out[_vIdx14aiJ].message, '-> aiStatus:', out[_vIdx14aiJ].aiStatus)
                }
              }
            }

            // 缓存 Agent 返回的比对结果供 onCompare 复用（多分块累积合并）
            _cachedCheckListRes = _cachedCheckListRes.concat(_agentOut.checkListRes || [])
            _cachedCombinedInBoth = _cachedCombinedInBoth.concat(_chunkInBoth)
          } catch (_e) {
            console.warn('Agent 分块 ' + (_ci + 1) + '/' + _chunks + ' 处理失败：', _e && _e.message)
            // 检测超时错误
            if (_e && (_e.name === 'AbortError' || (_e.message && _e.message.includes('timeout')))) {
              _aiTimedOut = true
              _aiTimeoutMessage = 'AI 大模型连接超时（已等待 ' + Math.round(AI_CALL_TIMEOUT / 1000) + ' 秒），请检查网络连接或 AI 服务状态后重试。'
              console.warn('[AI] 连接超时:', _aiTimeoutMessage)
              _aiCompleted = true  // 标记 AI 已结束（超时）
              _aiAnalysisLog = _aiAnalysisLogLines.join('\n')
              break  // 超时后不再继续处理其他分块
            }
          }
        }
        _aiCompleted = true  // 标记 AI 统一校验已完成
        _aiAnalysisLog = _aiAnalysisLogLines.join('\n')  // 一次性拼接（O(n) 替代 O(n²)）
        // 打印多分块合并后的缓存结果，便于排查比对数据完整性
        console.log('[AI] 分块合并完成 — 总分块数:', _chunks,
          '| checkListRes 总计:', _cachedCheckListRes.length, '条',
          '| combinedInBoth 总计:', _cachedCombinedInBoth.length, '条')
        console.log('[AI] 合并后 checkListRes:', JSON.stringify(_cachedCheckListRes))
        console.log('[AI] 合并后 combinedInBoth:', JSON.stringify(_cachedCombinedInBoth))
      }
    }
  }

  // 清理：移除所有仍标记为 aiPending 的违例（AI 未运行或未匹配到结果）
  for (var _vi = 0; _vi < out.length; _vi++) {
    if (out[_vi].aiPending) {
      out[_vi].aiPending = false
      out[_vi].aiStatus = ''
      out[_vi].aiReason = ''
    }
  }

  return out
  } finally {
    _runChecksRunning = false
  }
}


// -----------------------------
// Vue UI (no bundler)
// -----------------------------

must(typeof Vue !== 'undefined', '未加载 Vue，请检查 index.html 是否已引入 vue.min.js')

applyRulesByVersion()

// ═══════════════════════════════════════════════════════════
//  V3.0 扩展：ITA 后置检查（自动下载）/ 检查历史 / 数据收集
//  通过 window.__newEstimationApp 注入 Vue 组件（见文件中部）
// ═══════════════════════════════════════════════════════════

window.ItaExtension = {
  data() {
    return {
      /** 第 1 步来源模式：manual=手动上传 ita=从 ITA 导入 */
      itaMode: 'manual',
      /** content.js 传入的待检项目：{prjid, projectno, projname, projtype, files:[...]} */
      itaPayload: null,
      /** 页内搜索 ITA 项目（入口 B） */
      itaSearchName: '',
      itaSearching: false,
      itaSearchResults: [],
      itaSearchLoaded: false,
      /** 后置检查执行状态 */
      itaRunning: false,
      itaProgress: '',
      /** v3.2 来源锁定：'' | 'manual' | 'ita'（材料加载后锁定来源，重置解除） */
      itaSourceLocked: '',
      /** 入口判定：fcPendingItaImport 存在 = 悬浮球路径（Case#1/2），否则菜单路径（Case#3） */
      itaEntryBall: false,
    }
  },

  computed: {
    itaEstimationFiles() {
      return (this.itaPayload && this.itaPayload.files || []).filter(function (f) { return f.role === 'estimation' })
    },
    itaRequirementFiles() {
      return (this.itaPayload && this.itaPayload.files || []).filter(function (f) { return f.role === 'requirement' })
    },
    itaBatchOptions() {
      // 估算书 A 列批次去重（v2.0.16 批次映射用）
      var wb = this.state.bookWb
      var opts = []
      if (!wb || this.state.selectedRuleVersion !== 'v2.0.16') return opts
      for (var si = 0; si < this.state.businessSheets.length; si++) {
        var sheet = getSheet(wb, this.state.businessSheets[si])
        if (!sheet) continue
        var range = getRange(sheet)
        if (!range) continue
        for (var r = 39; r <= range.e.r + 1; r++) {
          var name = normalizeText(getCell(sheet, r, 6))
          if (!name) continue
          var batchVal = normalizeBatchColumn(getCell(sheet, r, 1))
          if (batchVal && opts.indexOf(batchVal) < 0) opts.push(batchVal)
        }
      }
      return opts
    },
  },

  methods: {
    /** mounted：读取 content.js 写入的待检任务 */
    initItaImport() {
      try {
        var self = this
        // 调试沙箱：?itaMock=1 时放开 ITA 通道（否则测试注入的悬浮球跳转进来是 Case#3，无法调试 ITA 导入）
        try {
          if (new URLSearchParams(window.location.search).get('itaMock') === '1') {
            self.itaEntryBall = true
          }
        } catch (e) { /* 忽略 */ }
        // ITA 上下文跳入：悬浮球菜单在 ita.abc 域跳转时自动带 ?itaFrom=1（content.js openExtPage）。
        // 只放开通道、不注入 payload——用户走页内「搜索并选择 ITA 项目」浮层
        // （扩展页有 host_permissions http://ita.abc/* 免 CORS，搜索与下载可直连）。
        // 外网/直接打开不带此参数，保持禁用（Case#3 防呆不回归）。
        try {
          if (new URLSearchParams(window.location.search).get('itaFrom') === '1') {
            self.itaEntryBall = true
          }
        } catch (e) { /* 忽略 */ }
        chrome.storage.local.get(['fcPendingItaImport'], function (r) {
          var payload = r.fcPendingItaImport
          if (payload && payload.files && payload.files.length) {
            self.itaEntryBall = true
            self.itaPayload = payload
            self.itaMode = 'ita'
            self.setStatus('已从 ITA 带入项目「' + (payload.projname || payload.prjid) + '」的 ' + payload.files.length + ' 个文档，请确认角色与批次后加载。', 'info')
            if (typeof window.__itaSearchOpenWithPayload === 'function') {
              window.__itaSearchOpenWithPayload(payload)
            }
          }
        })
      } catch (e) { /* 非扩展环境 */ }
    },

    itaClearPayload() {
      this.itaPayload = null
      try { chrome.storage.local.remove(['fcPendingItaImport']) } catch (e) {}
    },

    /** ITA 文件角色识别（与 content.js guessFileRole 保持一致） */
    guessFileRole(name) {
      var ext = (String(name).split('.').pop() || '').toLowerCase()
      if (['xlsx', 'et'].indexOf(ext) >= 0 && /估算/i.test(name)) return 'estimation'
      if (['wps', 'wpsx', 'doc', 'docx', 'txt', 'md'].indexOf(ext) >= 0 && /需求/i.test(name)) return 'requirement'
      return 'unknown'
    },

    /** 入口 B：页内搜索 ITA 项目 */
    async itaSearch() {
      var projname = (this.itaSearchName || '').trim()
      if (!projname) {
        this.$message.warning('请输入项目名称')
        return
      }
      this.itaSearching = true
      this.itaSearchResults = []
      try {
        // ⚠ 该接口参数形状未经抓包验证；pageSize 与 content.js 项目查询统一为 100
        var body = 'bizdomain=0&projname=' + encodeURIComponent(projname) + '&projectno=&status=&projtype=&currentstage=&zhuModLvl=&applytime=&page=1&pageSize=100'
        var resp = await fetch('http://ita.abc/ita/project/searchProj2022.action', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest' // ITA ajax 请求标配（抓包佐证）
          },
          body: body,
          credentials: 'include',
        })
        var result = await resp.json()
        this.itaSearchResults = (result && result.data) || []
        this.itaSearchLoaded = true
        if (!this.itaSearchResults.length) this.$message.error('未找到符合条件的 ITA 项目')
      } catch (e) {
        this.$message.error('ITA 项目查询失败：' + (e.message || '网络错误'))
      } finally {
        this.itaSearching = false
      }
    },

    /** 入口 B：选中项目 → 拉文档列表 → 组装待检任务 */
    async itaPickProject(prjid) {
      var proj = this.itaSearchResults.find(function (x) { return x.prjid === prjid })
      if (!proj) return
      this.setStatus('正在获取项目文档列表…', 'loading')
      try {
        var resp = await fetch('http://ita.abc/ita/project/searchProj.action', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest' // ITA ajax 请求标配（抓包佐证）
          },
          body: 'bizdomain=0&prjid=' + encodeURIComponent(prjid),
          credentials: 'include',
        })
        var result = await resp.json()
        var detail = result && result.data && result.data[0] ? result.data[0] : null
        var fileList = (detail && detail.fileList) || []
        this.itaPayload = {
          prjid: prjid || '',
          projectno: proj.projectno || '',
          projname: proj.projname || '',
          projtype: proj.projtype || '',
          files: fileList.map(function (f) {
            var name = f.namFile || f.nmlName || ''
            return {
              idFile: f.idFile || '',
              idPsn: f.idPsn || '',
              name: name,
              size: f.fileSize || 0,
              role: guessFileRole(name),
              batchName: '',
            }
          }),
        }
        this.itaPrepareBatches()
        this.setStatus('已获取「' + proj.projname + '」的 ' + fileList.length + ' 个文档，请确认后开始检查。', 'ok')
      } catch (e) {
        this.setStatus('获取项目文档失败：' + (e.message || '网络错误'), 'err')
      }
    },

    /** 需求文件默认批次：按 A 列批次顺序预填 */
    itaPrepareBatches() {
      if (this.state.selectedRuleVersion !== 'v2.0.16') return
      var opts = this.itaBatchOptions
      this.itaRequirementFiles.forEach(function (f, i) {
        // v3.2：用户在浮层中指定的批次优先，仅补空（保证流程与用户选择完全对应）
        if (!f.batchName) f.batchName = opts[i] || ('批次' + (i + 1))
      })
    },

    /** 下载单个 ITA 文件（带登录 Cookie） */
    async itaDownloadFile(f) {
      var url = 'http://ita.abc/ita/downloadFileById.action?idFile=' + encodeURIComponent(f.idFile || '') + '&idPsn=' + encodeURIComponent(f.idPsn || '')
      var resp = await fetch(url, { credentials: 'include' })
      if (resp.status === 401 || resp.status === 403) {
        throw new Error('ITA 登录已失效（HTTP ' + resp.status + '），请刷新 ita.abc 页面重新登录后重试')
      }
      if (!resp.ok) throw new Error('下载失败 HTTP ' + resp.status + '：' + f.name)
      var blob = await resp.blob()
      return new File([blob], f.name || ('file_' + f.idFile), { type: 'application/octet-stream' })
    },

    /** 后置导入主流程：下载 → 加载估算书与需求文档（检查在第 3 步执行） */
    async itaLoad() {
      if (this.itaRunning) return
      var payload = this.itaPayload
      if (!payload) {
        this.$message.warning('没有待检查的 ITA 项目，请先在 ita.abc 页面发起或在上方搜索')
        return
      }
      var est = this.itaEstimationFiles
      var reqs = this.itaRequirementFiles
      if (est.length === 0) {
        this.$message.error('未识别到规模估算书（.xlsx/.et 且文件名含"估算"），请在上表中人工指定角色')
        return
      }
      if (est.length > 1) {
        this.$message.error('识别到多份估算书，请仅保留一份角色为"估算书"（其余改为忽略）')
        return
      }

      this.itaRunning = true
      this.itaProgress = ''
      var self = this
      try {
        // 0) 重置旧数据（含后端缓存）
        await this.resetAll()
        this.itaRunning = true

        // 1) 下载并加载估算书
        self.itaProgress = '（1/3）下载估算书：' + est[0].name
        var bookFile = await self.itaDownloadFile(est[0])
        await self.loadBookFile(bookFile)
        if (!self.state.bookWb) throw new Error('估算书解析失败')

        self.itaPrepareBatches()

        // 2) 下载需求书（v2.0.16 按批次上传后端；v2.0.15 前端加载）
        for (var i = 0; i < reqs.length; i++) {
          var rf = reqs[i]
          self.itaProgress = '（2/3）下载需求文档 ' + (i + 1) + '/' + reqs.length + '：' + rf.name
          var file = await self.itaDownloadFile(rf)
          var itaMockMode = false
          try { itaMockMode = new URLSearchParams(window.location.search).get('itaMock') === '1' } catch (e) {}
          if (self.state.selectedRuleVersion === 'v2.0.16' && !itaMockMode) {
            var batchName = rf.batchName || ('批次' + (i + 1))
            var formData = new FormData()
            formData.append('file', file)
            formData.append('batchName', batchName)
            var resp = await fetch(BACKEND_API_URL + '/api/upload', { method: 'POST', body: formData })
            if (!resp.ok) {
              var errData = await resp.json().catch(function () { return {} })
              throw new Error(errData.error || ('上传失败 (' + resp.status + ')：' + rf.name))
            }
            var ext = rf.name.indexOf('.') >= 0 ? rf.name.split('.').pop().toLowerCase() : ''
            self.state.requireDocs = [...self.state.requireDocs, { fileName: rf.name, ext: ext, batchName: batchName }]
          } else {
            await self.loadRequireFile(file)
            // 前端解析路径（v2.0.15 / itaMock 沙箱）：补齐浮层中指定的批次
            var docs = self.state.requireDocs || []
            var last = docs.length ? docs[docs.length - 1] : null
            if (last && !last.batchName) last.batchName = rf.batchName || ('批次' + (i + 1))
          }
        }

        // 3) 加载完成：解锁「执行检查」卡片（currentStep=2），保持 ITA 页签高亮
        self.itaProgress = ''
        self.itaSourceLocked = 'ita'
        if (self.state.requireDocs.length > 0) {
          self.currentStep = Math.max(self.currentStep, 2)
        }
        self.setStatus('已从 ITA 加载估算书与 ' + self.state.requireDocs.length + ' 个需求文档，请点击「执行检查」运行规则检查。', 'ok')
      } catch (e) {
        this.$message.error('后置检查失败：' + (e.message || e))
        this.setStatus('后置检查失败：' + (e.message || e), 'err')
      } finally {
        this.itaRunning = false
      }
    },

    /** 检查完成：写入检查历史 + 数据收集上报 */
    async persistCheckResult(v, startedAt) {
      try {
        var violations = v || []
        var must = violations.filter(function (x) { return x.type === '强制' }).length
        var suggest = violations.filter(function (x) { return x.type === '建议' }).length
        var ai = violations.filter(function (x) { return x.source === 'ai' }).length

        var perRule = {}
        violations.forEach(function (x) {
          var k = x.ruleId || '?'
          perRule[k] = (perRule[k] || 0) + 1
        })

        var files = []
        if (this.state.bookFileName) files.push({ name: this.state.bookFileName, role: 'estimation', size: 0 })
        ;(this.state.requireDocs || []).forEach(function (d) {
          files.push({ name: d.fileName, role: 'requirement', size: 0, batchName: d.batchName || '' })
        })

        var project = this.itaPayload
          ? {
              prjid: this.itaPayload.prjid || '',
              projectno: this.itaPayload.projectno || '',
              projname: this.itaPayload.projname || '',
              projtype: this.itaPayload.projtype || '',
            }
          : null

        var record = {
          type: 'estimation',
          source: this.itaPayload ? 'ita' : 'manual',
          project: project,
          ruleVersion: this.state.selectedRuleVersion,
          files: files,
          summary: {
            sheets: this.state.businessSheets.length,
            must: must,
            suggest: suggest,
            ai: ai,
            total: violations.length,
          },
          detail: { violations: violations },
          durationSec: startedAt ? Math.round((Date.now() - startedAt) / 100) / 10 : null,
          aiUrl: this.state.aiApiUrl || null,
        }

        if (typeof HistoryStore !== 'undefined') {
          await HistoryStore.save(record)
        }
        // 统计后端落库（异步 fire-and-forget；endpoint 未配置时静默跳过）
        if (window.CollectSync) window.CollectSync.enqueue(record)

        // 数据收集上报（开发文档 4.5：违例明细 + 统计，不含文档正文）
        if (typeof reportCollect !== 'undefined') {
          reportCollect({
            time: new Date().toISOString(),
            meta: { ua: navigator.userAgent, trigger: this.itaPayload ? 'ita' : 'manual' },
            project: project,
            book: {
              fileName: this.state.bookFileName || '',
              sheets: this.state.businessSheets,
              sheetCount: this.state.businessSheets.length,
            },
            requires: (this.state.requireDocs || []).map(function (d) {
              return { batchName: d.batchName || '', fileName: d.fileName }
            }),
            run: { ruleVersion: this.state.selectedRuleVersion, aiEnabled: !!this.state.aiApiUrl },
            stats: { total: violations.length, must: must, suggest: suggest, ai: ai, perRule: perRule },
            violations: violations.map(function (x) {
              return {
                ruleId: x.ruleId || '', type: x.type, source: x.source || 'rule',
                sheet: x.sheet, row: x.row, col: x.col || '', message: x.message || x.text || '',
              }
            }),
          })
        }
      } catch (e) {
        console.warn('检查历史/数据收集失败（不影响检查结果）:', e)
      }
    },
  },
}

// ITA 文件角色识别（供 itaPickProject 内的内联调用）
function guessFileRole(name) {
  var ext = (String(name).split('.').pop() || '').toLowerCase()
  if (['xlsx', 'et'].indexOf(ext) >= 0 && /估算/i.test(name)) return 'estimation'
  if (['wps', 'wpsx', 'doc', 'docx', 'txt', 'md'].indexOf(ext) >= 0 && /需求/i.test(name)) return 'requirement'
  return 'unknown'
}

window.__newEstimationApp = function (opts) {
  if (window.__ESTIMATION_TEMPLATE) {
    opts.render = window.__ESTIMATION_TEMPLATE.render
    opts.staticRenderFns = window.__ESTIMATION_TEMPLATE.staticRenderFns
  }
  if (window.ItaExtension) {
    var __origData = opts.data
    opts.data = function () {
      return Object.assign(typeof __origData === 'function' ? __origData.call(this) : __origData, window.ItaExtension.data())
    }
    opts.methods = Object.assign({}, opts.methods, window.ItaExtension.methods)
    opts.computed = Object.assign({}, opts.computed, window.ItaExtension.computed)
  }
  var vm = new Vue(opts)
  if (window.ItaExtension && vm.initItaImport) vm.initItaImport()
  return vm
}

window.__newEstimationApp({
  el: '#app',
  data() {
    return {
      state,
      statusText: '请先选择检查规则版本，再选择规模估算书并运行检查。',
      statusKind: 'info', // info | ok | err | loading
      previewStartRow: 38,
      previewPageSize: 100,
      previewRefreshKey: 0,
      showPreviewViolationsCol: true,
      dragOver: false,
      requireDragOver: false,
      batchDialogVisible: false,
      batchDialogFile: null,
      batchDialogFileName: '',
      batchDialogDragOver: false,
      debugDialogVisible: false,
      debugDialogFile: null,
      debugDialogFileName: '',
      debugDialogDragOver: false,
      debugResult: null,
      uploading: false,
      debugStatusText: '',
      debugStatusKind: '',
      startBatchNumber: 1,
      compareRes: null,
      pointList: null,
      aiCompareLoading: false,
      aiAnalysisLog: '',
      // AI 思考动画 — 三阶段状态
      aiThinkingPhase: 'idle',        // 'idle' | 'thinking' | 'done'
      aiThinkingText: '',             // 当前展示的文字
      aiThinkingSweepIdx: 0,          // 当前高亮字符位置
      aiThinkingSweepDir: 1,          // 扫描方向 1=左→右, -1=右→左
      thinkingPhrases: [
        'AI 思考中…', 'AI 琢磨中…', 'AI 掐指一算…', 'AI 头脑风暴中…',
        'AI 深度思考中…', 'AI 灵光一闪…', 'AI 查阅典籍中…', 'AI 逐字推敲中…',
        'AI 疯狂计算中…', 'AI 脑细胞燃烧中…', 'AI 翻找知识库…', 'AI 正在做阅读理解…',
        'AI 正在对答案…', 'AI 绞尽脑汁中…', 'AI 发动技能：分析…', 'AI 眼神变犀利了…',
        'AI 喝了口咖啡继续…', 'AI 灵感迸发中…', 'AI 正在逐行扫描…', 'AI 动用洪荒之力…',
        'AI 打开显微镜…', 'AI 正在匹配关键信息…', 'AI 启动超级分析模式…', 'AI 正在挠头思考…',
      ],
      currentThinkingPhrase: '',
      aiSseEventCount: 0,
      showAiHelp: false,
      activeResultTab: 'violations',
      aiConfigExpanded: false,
      hasChecked: false,
      currentStep: 0,
      aiUrlTested: false,
      aiConfigPopVisible: false,
      rulesDrawerVisible: false,
      compareSubTab: 'inPoint',
      aiCheckBanner: { text: '', type: '' },
      aiAbortController: null,
      // 分页状态
      compareInPointPage: 1,
      compareInPointPageSize: 10,
      compareInWpsPage: 1,
      compareInWpsPageSize: 10,
      aiComparePage: 1,
      aiComparePageSize: 10,
      aiCompareFilter: 'all',
      violationTypeFilter: 'all',
      violationsPage: 1,
      violationsPageSize: 10,
      // ── 版本检查与更新 ──
      currentVersion: '',
      updateAvailable: false,
      latestVersion: null,
      updateChangelog: [],
      updatePackageSize: 0,
      updatePhase: 'idle',
      updateProgress: 0,
      updateStageMessage: '',
      updateDetailMessage: '',
      updateErrorCode: null,
      updateErrorMessage: '',
      updateCanRetry: false,
      showUpdateDialog: false,
      showUpdateProgress: false,
      showUpdateComplete: false,
      showUpdateError: false,
      autoCheckTimer: null,
      reconnectTimer: null,
    }
  },
  async mounted() {
    await this.apiReset()
    await this.apiCleanupTemp()
    await this.checkAiOnMount()
    var self = this
    this.$nextTick(function () { self._initSortable() })

    // 先确保后端运行，再检查版本更新
    this.ensureBackendRunning().then(function () {
      self.initVersionCheck()
    })
  },
  computed: {
    statusClass() {
      if (this.statusKind === 'ok') return 'status--ok'
      if (this.statusKind === 'err') return 'status--err'
      if (this.statusKind === 'loading') return 'status--loading'
      return ''
    },
    canRun() {
      var hasBook = !!this.state.bookWb
      var hasDocs = (this.state.requireDocs || []).length > 0
      var noTocIssue = Object.keys(this.state.tocConsistencyMap || {}).length === 0
      return hasBook && hasDocs && noTocIssue
    },
    canCompare() {
      return !!this.state.bookWb && (this.state.requireDocs || []).length > 0
    },
    violationMustCount() {
      return this.state.violations.filter(function (v) { return v.type === '强制' }).length
    },
    violationSuggestCount() {
      return this.state.violations.filter(function (v) { return v.type !== '强制' }).length
    },
    compareInPointCount() {
      return this.compareRes && this.compareRes.inPoint ? this.compareRes.inPoint.length : 0
    },
    compareInWpsCount() {
      return this.compareRes && this.compareRes.inWps ? this.compareRes.inWps.length : 0
    },
    lowConfidenceItems() {
      if (!this.compareRes || !this.compareRes.inBoth) return []
      return this.compareRes.inBoth.filter(function (item) {
        return item.similarityRate != null && item.similarityRate <= 0.5
      })
    },
    lowConfidenceCount() {
      return this.lowConfidenceItems.length
    },
    compareInPointBySheet() {
      if (!this.compareRes || !this.compareRes.inPoint || !this.compareRes.inPoint.length) return []
      var summary = new Map()
      for (var i = 0; i < this.compareRes.inPoint.length; i++) {
        var item = this.compareRes.inPoint[i]
        var key = (item.batch || '') + '|' + (item.index || '')
        if (!summary.has(key)) {
          summary.set(key, { batch: item.batch, index: item.index, pointName: item.pointName, count: 0 })
        }
        summary.get(key).count++
      }
      return Array.from(summary.values())
    },
    compareInWpsBySheet() {
      if (!this.compareRes || !this.compareRes.inWps || !this.compareRes.inWps.length) return []
      var summary = new Map()
      for (var i = 0; i < this.compareRes.inWps.length; i++) {
        var item = this.compareRes.inWps[i]
        var key = (item.batch || '') + '|' + (item.index || '')
        if (!summary.has(key)) {
          summary.set(key, { batch: item.batch, index: item.index, wpsDesc: item.wpsDesc, count: 0 })
        }
        summary.get(key).count++
      }
      return Array.from(summary.values())
    },
    paginatedCompareInPoint() {
      var list = (this.compareRes && this.compareRes.inPoint) ? this.compareRes.inPoint : []
      var page = this.compareInPointPage
      var pageSize = this.compareInPointPageSize
      var start = (page - 1) * pageSize
      return list.slice(start, start + pageSize)
    },
    paginatedCompareInWps() {
      var list = (this.compareRes && this.compareRes.inWps) ? this.compareRes.inWps : []
      var page = this.compareInWpsPage
      var pageSize = this.compareInWpsPageSize
      var start = (page - 1) * pageSize
      return list.slice(start, start + pageSize)
    },
    filteredAiCompareResults() {
      if (!this.compareRes || !this.compareRes.inBoth) return []
      var f = this.aiCompareFilter
      if (f === 'matched') return this.compareRes.inBoth.filter(function(item) { return item.aiMatched === true })
      if (f === 'mismatched') return this.compareRes.inBoth.filter(function(item) { return item.aiMatched === false })
      return this.compareRes.inBoth
    },
    paginatedAiCompareResults() {
      var list = this.filteredAiCompareResults
      var page = this.aiComparePage
      var pageSize = this.aiComparePageSize
      var start = (page - 1) * pageSize
      return list.slice(start, start + pageSize)
    },
    aiReviewStats() {
      if (!this.compareRes) return null
      var inBoth = (this.compareRes.inBoth || []).length
      var inPoint = (this.compareRes.inPoint || []).length
      var inWps = (this.compareRes.inWps || []).length
      return {
        total: inBoth + inPoint,
        reviewed: inBoth,
        matched: inBoth - this.aiMismatchCount,
        mismatched: this.aiMismatchCount,
        over: inPoint,
        under: inWps
      }
    },
    aiMismatchCount() {
      if (!this.compareRes || !this.compareRes.inBoth) return 0
      return this.compareRes.inBoth.filter(function(item) {
        return item.aiMatched === false
      }).length
    },
    aiMismatchByBatch() {
      // 按批次统计不匹配数量
      if (!this.compareRes || !this.compareRes.inBoth) return []
      var summary = new Map()
      for (var i = 0; i < this.compareRes.inBoth.length; i++) {
        var item = this.compareRes.inBoth[i]
        if (item.aiMatched === false) {
          var batch = item.batch || '未知批次'
          if (!summary.has(batch)) {
            summary.set(batch, { batch: batch, mismatchCount: 0 })
          }
          summary.get(batch).mismatchCount++
        }
      }
      return Array.from(summary.values())
    },
    compareSummaryBySheet() {
      if (!this.compareRes) return []
      var summary = new Map()
      
      if (this.compareRes.inPoint) {
        for (var i = 0; i < this.compareRes.inPoint.length; i++) {
          var item = this.compareRes.inPoint[i]
          var key = (item.sheet || '') + '|' + (item.batch || '')
          if (!summary.has(key)) {
            summary.set(key, { sheet: item.sheet, batch: item.batch, count: 0 })
          }
          summary.get(key).count++
        }
      }
      
      if (this.compareRes.inWps) {
        for (var j = 0; j < this.compareRes.inWps.length; j++) {
          var item = this.compareRes.inWps[j]
          var key = '需求文档|' + (item.batch || '')
          if (!summary.has(key)) {
            summary.set(key, { sheet: '需求文档', batch: item.batch, count: 0 })
          }
          summary.get(key).count++
        }
      }
      
      return Array.from(summary.values())
    },
    compareInPointSummary() {
      if (!this.compareRes || !this.compareRes.inPoint) return []
      var summary = new Map()
      for (var i = 0; i < this.compareRes.inPoint.length; i++) {
        var item = this.compareRes.inPoint[i]
        var key = (item.sheet || '') + '|' + (item.batch || '')
        if (!summary.has(key)) {
          summary.set(key, { sheet: item.sheet, batch: item.batch, count: 0 })
        }
        summary.get(key).count++
      }
      return Array.from(summary.values())
    },
    compareInWpsSummary() {
      if (!this.compareRes || !this.compareRes.inWps) return []
      var summary = new Map()
      for (var j = 0; j < this.compareRes.inWps.length; j++) {
        var item = this.compareRes.inWps[j]
        var key = '需求文档|' + (item.batch || '')
        if (!summary.has(key)) {
          summary.set(key, { sheet: '需求文档', batch: item.batch, count: 0 })
        }
        summary.get(key).count++
      }
      return Array.from(summary.values())
    },
    /** 合并多估/漏估为统一表格数据 */
    compareEstimateSummary() {
      var result = []
      var inPoint = this.compareInPointSummary
      for (var i = 0; i < inPoint.length; i++) {
        result.push({ sheet: inPoint[i].sheet, batch: inPoint[i].batch, count: inPoint[i].count, type: '多估' })
      }
      var inWps = this.compareInWpsSummary
      for (var j = 0; j < inWps.length; j++) {
        result.push({ sheet: inWps[j].sheet, batch: inWps[j].batch, count: inWps[j].count, type: '漏估' })
      }
      return result
    },
    violationSummaryBySheet() {
      var summary = new Map()
      for (var i = 0; i < this.state.violations.length; i++) {
        var v = this.state.violations[i]
        var cur = summary.get(v.sheet) || { sheet: v.sheet, mustCount: 0, suggestCount: 0, mustRules: new Map(), suggestRules: new Map() }
        if (v.type === '强制') {
          cur.mustCount++
          // 记录强制违例的规则（按规则ID去重，统计数量）
          var ruleKey = v.ruleId || 'unknown'
          var ruleInfo = cur.mustRules.get(ruleKey) || { ruleId: v.ruleId, ruleName: v.ruleName, count: 0 }
          ruleInfo.count++
          cur.mustRules.set(ruleKey, ruleInfo)
        } else {
          cur.suggestCount++
          // 记录建议违例的规则（按规则ID去重，统计数量）
          var ruleKey = v.ruleId || 'unknown'
          var ruleInfo = cur.suggestRules.get(ruleKey) || { ruleId: v.ruleId, ruleName: v.ruleName, count: 0 }
          ruleInfo.count++
          cur.suggestRules.set(ruleKey, ruleInfo)
        }
        summary.set(v.sheet, cur)
      }
      // 将 Map 转换为数组
      return Array.from(summary.values()).map(function (item) {
        return {
          sheet: item.sheet,
          mustCount: item.mustCount,
          suggestCount: item.suggestCount,
          mustRules: Array.from(item.mustRules.values()),
          suggestRules: Array.from(item.suggestRules.values())
        }
      })
    },
    sortedTocKeys() {
      if (!this.debugResult || !this.debugResult.toc) return []
      return Object.keys(this.debugResult.toc).sort(function (a, b) {
        var pa = a.split('.').map(Number)
        var pb = b.split('.').map(Number)
        for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
          if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
        }
        return 0
      })
    },
    sortedContentMapKeys() {
      if (!this.debugResult || !this.debugResult.contentMap) return []
      return Object.keys(this.debugResult.contentMap).sort(function (a, b) {
        var pa = a.split('.').map(Number)
        var pb = b.split('.').map(Number)
        for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
          if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
        }
        return 0
      })
    },
    sortedAiCompareResults() {
      // 自然排序：先按批次顺序（第一批、第二批...），再按章节号数值排序
      if (!this.compareRes || !this.compareRes.inBoth) return []
      var BATCH_ORDER = ['第一批', '第二批', '第三批', '第四批', '第五批', '第六批', '第七批', '第八批', '第九批', '第十批']
      return this.compareRes.inBoth.slice().sort(function (a, b) {
        var batchA = a.batch || ''
        var batchB = b.batch || ''
        var batchIdxA = BATCH_ORDER.indexOf(batchA)
        var batchIdxB = BATCH_ORDER.indexOf(batchB)
        if (batchIdxA !== batchIdxB) {
          if (batchIdxA === -1) return 1
          if (batchIdxB === -1) return -1
          return batchIdxA - batchIdxB
        }
        var indexA = a.index || ''
        var indexB = b.index || ''
        // 提取数字进行数值排序
        var numA = parseFloat(indexA) || 0
        var numB = parseFloat(indexB) || 0
        if (numA !== numB) return numA - numB
        return indexA.localeCompare(indexB)
      })
    },
    aiUrlStatusLabel() {
      const s = this.state.aiUrlStatus
      if (s === 'testing') return '正在测试…'
      if (s === 'ok') return '✓ 已连接'
      if (s === 'err') return '✗ 未连接'
      return '未测试'
    },
    aiUrlStatusClass() {
      const s = this.state.aiUrlStatus
      if (s === 'ok') return 'ai-status--ok'
      if (s === 'err') return 'ai-status--err'
      return ''
    },
    aiConfigStatus() {
      if (!this.state.aiApiUrl) return 'none'
      if (!this.aiUrlTested) return 'untested'
      if (this.state.aiUrlStatus === 'ok') return 'ok'
      return 'err'
    },
    aiConfigTip() {
      const base = '可点击右上角 ⚙ 配置按钮'
      switch (this.aiConfigStatus) {
        case 'none': return '尚未配置 AI 大模型 API，运行检查时将无法进行 AI 语义分析。' + base + '进行设置。'
        case 'untested': return 'AI API 地址已填写但未验证连接。' + base + '测试连接。'
        case 'err': return 'AI 大模型 API 连接失败，请检查地址是否正确。' + base + '重新设置。'
        default: return ''
      }
    },
    /** 规模估算书上传区：有书且有需求书时锁定，避免误替换 */
    uploadLocked() {
      return !!(this.state.bookFileName && (this.state.requireDocs || []).length > 0)
    },
    /** 业务需求书上传区：仅当未加载规模估算书时禁用，支持持续添加多个需求书 */
    requireUploadLocked() {
      return !this.state.bookFileName
    },
    visibleSheetName() {
      const f = this.state.violationSheetFilter || '__ALL__'
      if (f === '__ALL__') return this.state.businessSheets[0] || null
      return f
    },
    /** 预览右侧"违例清单列"按 (sheet|row) 聚合 */
    previewRowViolationsMap() {
      /** @type {Map<string, {text: string, items: {text: string, type: string}[]}>} */
      const m = new Map()
      for (const g of this.groupedViolationRows) {
        m.set(`${g.sheet}|${g.row}`, { text: g.text, items: g.items })
      }
      return m
    },
    previewHeaderCols() {
      void this.previewRefreshKey
      return this.visibleSheetName ? Array.from({ length: 14 }, (_, i) => i + 1) : []
    },
    previewTableData() {
      void this.previewRefreshKey
      const wb = this.state.bookWb
      const sheetName = this.visibleSheetName
      if (!wb || !sheetName) return []
      const sheet = getSheet(wb, sheetName)
      if (!sheet) return []
      const startRow = Math.max(1, Number(this.previewStartRow || 38))
      const pageSize = Math.max(10, Math.min(200, Number(this.previewPageSize || 40)))
      const range = getRange(sheet)
      if (!range) return []
      const endRow = Math.min(range.e.r + 1, startRow + pageSize - 1)
      const rows = []
      for (let r = startRow; r <= endRow; r++) {
        /** @type {any} */
        const rowObj = { rowNum: r }
        for (let c = 1; c <= 14; c++) {
          rowObj[`c${c}`] = normalizeText(getCell(sheet, r, c))
        }
        const rowKey = `${sheetName}|${r}`
        const rowViolations = this.previewRowViolationsMap.get(rowKey)
        rowObj.violationsText = rowViolations ? rowViolations.text : ''
        rowObj.violationsItems = rowViolations ? rowViolations.items : []
        rows.push(rowObj)
      }
      return rows
    },
    visibleViolations() {
      const filter = this.state.violationSheetFilter || '__ALL__'
      return filter === '__ALL__'
        ? this.state.violations
        : this.state.violations.filter((v) => v.sheet === filter)
    },
    filteredGroupedViolationRows() {
      var filter = this.violationTypeFilter
      var rows = this.groupedViolationRows
      if (filter === 'must') {
        return rows.map(function(row) {
          return { sheet: row.sheet, row: row.row, items: row.items.filter(function(item) { return item.type === '强制' }) }
        }).filter(function(row) { return row.items.length > 0 })
      }
      if (filter === 'suggest') {
        return rows.map(function(row) {
          return { sheet: row.sheet, row: row.row, items: row.items.filter(function(item) { return item.type === '建议' }) }
        }).filter(function(row) { return row.items.length > 0 })
      }
      return rows
    },
    paginatedViolationRows() {
      var list = this.filteredGroupedViolationRows
      var page = this.violationsPage
      var pageSize = this.violationsPageSize
      var start = (page - 1) * pageSize
      return list.slice(start, start + pageSize)
    },
    groupedViolationRows() {
      /** @type {Map<string, {sheet: string, row: number, items: {text: string, type: string, source?: string, reason?: string}[]}>} */
      const byKey = new Map()
      for (const v of this.visibleViolations) {
        const key = `${v.sheet}|${v.row}`
        const label = `【${v.type} 规则${v.ruleId} ${v.ruleName}】${v.address}：${v.message}`
        const cur = byKey.get(key) || { sheet: v.sheet, row: v.row, items: [] }
        cur.items.push({ text: label, type: v.type, source: v.source || '', reason: v.reason || '', message: v.message, aiPending: v.aiPending || false, aiStatus: v.aiStatus || '', aiReason: v.aiReason || '' })
        byKey.set(key, cur)
      }
      return [...byKey.values()].map((g) => ({
        sheet: g.sheet,
        row: g.row,
        text: g.items.map((it, i) => `${i + 1}. ${it.text}`).join('\n'),
        items: g.items.map((it, i) => ({ text: `${i + 1}. ${it.text}`, type: it.type, source: it.source, reason: it.reason, message: it.message, aiPending: it.aiPending, aiStatus: it.aiStatus, aiReason: it.aiReason })),
      }))
    },
    resultSummaryHtml() {
      /** @type {Map<string, {must: number, suggest: number}>} */
      const summary = new Map()
      for (const item of this.state.violations) {
        const cur = summary.get(item.sheet) || { must: 0, suggest: 0 }
        if (item.type === '强制') cur.must++
        else cur.suggest++
        summary.set(item.sheet, cur)
      }
      const lines = [...summary.entries()].map(
        ([s, c], i) => `${i + 1}. ${escapeHtml(s)}  强制${c.must}条、建议${c.suggest}条`
      )
      return lines.length ? lines.join('；<br>') : ''
    },
    aiEnabledForViolations() {
      return !!(this.state.aiApiUrl && this.state.aiUrlStatus === 'ok')
    },
  },
  watch: {
    violationTypeFilter() {
      this.violationsPage = 1
    },
    'state.violationSheetFilter'() {
      this.violationsPage = 1
    },
    aiCompareFilter() {
      this.aiComparePage = 1
    },
    'state.selectedRuleVersion': {
      immediate: true,
      handler(newVal, oldVal) {
        this.state.customRules = null
        applyRulesByVersion()
        if (oldVal && oldVal !== newVal && this.state.requireDocs && this.state.requireDocs.length > 0) {
          this.state.requireDocs = []
          this.setStatus(`已切换至 ${newVal}，需求文档数据已清空。`, 'info')
        }
      },
    },
    // 思考动画显隐由 aiThinkingPhase 标志位控制（idle/thinking/done）
  },
  methods: {
    colToLetter,
    formatScheme(scheme) {
      const s = String(scheme || '').replace(/\\n/g, '\n')
      const lines = s.split('\n')
      const escaped = lines.map((line) => escapeHtml(line))
      const withMarkup = escaped.map((line) => {
        if (line.trimStart().startsWith('规则来源')) {
          return '<span class="scheme-basis">' + line + '</span>'
        }
        if (line.trimStart().startsWith('【用户开启AI')) {
          return '<div class="scheme-ai-card">' + line + '</div>'
        }
        return line
      })
      return withMarkup.join('<br>')
    },
    ruleRowClassName({ row }) {
      if (row.supported === false) return 'ruleRow--unsupported'
      return ''
    },
    similarityClass(val) {
      var str = String(val).replace('%', '')
      var v = parseFloat(str)
      if (isNaN(v)) return ''
      if (v > 1) v = v / 100
      if (v <= 0.3) return 'similarity--low'
      if (v <= 0.6) return 'similarity--mid'
      return 'similarity--high'
    },
    formatSimilarity(val) {
      if (val == null) return '-'
      var str = String(val)
      if (str.indexOf('%') !== -1) return str
      var v = parseFloat(str)
      if (isNaN(v)) return '-'
      if (v <= 1) return (v * 100).toFixed(0) + '%'
      return str + '%'
    },
    openBookPicker() {
      const input = this.$refs.bookFile
      if (input) {
        // allow selecting the same file again
        input.value = ''
        input.click()
      }
    },
    openRequirePicker() {
      const input = this.$refs.requireFile
      if (input) {
        input.value = ''
        input.click()
      }
    },
    setStatus(text, kind = 'info') {
      this.statusText = text
      this.statusKind = kind
    },
    async testAiConnection() {
      const url = this.state.aiApiUrl
      if (!url) {
        this.state.aiUrlStatus = 'err'
        return
      }
      this.state.aiUrlStatus = 'testing'
      const result = await apiTestAiUrl(url)
      this.state.aiUrlStatus = result.ok ? 'ok' : 'err'
      this.aiUrlTested = true
      if (result.ok) {
        this.saveAiUrl()
        this.setStatus('AI 连接测试成功并已保存', 'ok')
        this.aiCheckBanner = { text: 'AI 辅助检查已就绪 ✓', type: 'ok' }
      } else {
        this.setStatus('AI 连接测试失败：' + (result.error || '未知错误'), 'err')
        this.aiCheckBanner = { text: 'AI API 连接异常，请重新测试', type: 'err' }
      }
    },
    saveAiUrl() {
      const url = this.state.aiApiUrl
      if (url) {
        localStorage.setItem('aiApiUrl', url)
        this.setStatus('AI API 地址已保存', 'ok')
      } else {
        localStorage.removeItem('aiApiUrl')
        this.setStatus('已清除 AI API 地址', 'info')
      }
    },
    refreshPreview() {
      this.previewRefreshKey++
    },

    removeBookFile() {
      if (this.$refs.bookFile) this.$refs.bookFile.value = ''
      this.state.bookWb = null
      this.state.businessSheets = []
      this.state.selectedSheet = null
      this.state.bookFileName = ''
      this.state.violations = []
      this.state.violationMap = new Map()
      this.state.violationSheetFilter = '__ALL__'
      this.pointList = null
      this.compareRes = null
      this.hasChecked = false
      this.currentStep = 0
      this.setStatus('规模估算书已移除。', 'info')
      this.refreshPreview()
    },

    previewViolationListForCell(rowNum, colNum) {
      const sheetName = this.visibleSheetName
      if (!sheetName) return []
      const k = `${sheetName}|${rowNum}|${colNum}`
      return this.state.violationMap.get(k) || []
    },
    previewCellClassName({ row, column }) {
      const prop = column && (column.property || '')
      const m = /^c(\d+)$/.exec(String(prop))
      if (!m) return ''
      const colNum = Number(m[1])
      const rowNum = row && row.rowNum
      if (!rowNum || !colNum) return ''
      const violationsHere = this.previewViolationListForCell(rowNum, colNum)
      if (!violationsHere || !violationsHere.length) return ''
      const aiAny = violationsHere.some((x) => x.source === 'ai')
      if (aiAny) return 'cell--ai'
      const mustAny = violationsHere.some((x) => x.type === '强制')
      return mustAny ? 'cell--must' : 'cell--suggest'
    },
    previewCellTitle(rowNum, colNum) {
      const violationsHere = this.previewViolationListForCell(rowNum, colNum)
      if (!violationsHere || !violationsHere.length) return ''
      return violationsHere.map((x) => `[${x.type}] ${x.ruleId} ${x.message}`).join('\n')
    },
    async loadBookFile(file) {
      this.state.bookWb = null
      this.state.businessSheets = []
      this.state.selectedSheet = null
      this.state.violations = []
      this.state.violationMap = new Map()
      this.state.violationSheetFilter = '__ALL__'

      if (!file) {
        this.setStatus('请选择规模估算书文件。', 'err')
        return
      }
      if (!this.isValidBookFormat(file.name || '')) {
        this.$notify({
          title: '文件格式不支持',
          message: (file.name || '') + ' 不是支持的格式，请上传 .xlsx / .et 文件',
          type: 'error',
          duration: 5000
        })
        return
      }
      try {
        this.setStatus('正在读取规模估算书…', 'loading')
        const wb = await readWorkbookFromFile(file)
        this.state.bookWb = wb
        this.state.businessSheets = detectBusinessSheets(wb)
        this.state.violationSheetFilter = this.state.businessSheets[0] || '__ALL__'
        this.state.bookFileName = file.name || ''
        this.pointList = extractFunctionPoints(wb)
        console.log('提取的功能点估算项：', this.pointList)
        this.setStatus(
          `已加载：共 ${wb.SheetNames.length} 个 sheet；业务功能点 sheet：${this.state.businessSheets.length} 个。`,
          'ok'
        )
        this.refreshPreview()
        this.currentStep = Math.max(this.currentStep, 1)
      } catch (e) {
        this.setStatus(`规模估算书读取失败：${e.message}`, 'err')
      }
    },
    /** 模式禁用（Case#1/2/3）：ITA 需悬浮球路径且手动材料未占用；手动在 ITA 材料加载后禁用 */
    modeDisabled(mode) {
      if (mode === 'ita') return !this.itaEntryBall || this.itaSourceLocked === 'manual'
      if (mode === 'manual') return this.itaSourceLocked === 'ita'
      return false
    },
    async onBookFileSelected(e) {
      const file = e && e.target && e.target.files && e.target.files[0]
      await this.loadBookFile(file)
      this.lockManualSource()
    },
    async onDropFile(e) {
      this.dragOver = false
      const file = e && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
      await this.loadBookFile(file)
      this.lockManualSource()
    },
    /** 手动材料加载成功 → 锁定 manual 来源，禁用 ITA 导入并丢弃未确认的携带数据 */
    lockManualSource() {
      if (this.state.bookFileName) {
        this.itaSourceLocked = 'manual'
        this.itaPayload = null
        try { chrome.storage.local.remove(['fcPendingItaImport']) } catch (e) { /* 非扩展环境 */ }
      }
    },
    onDropRequireFile(e) {
      this.requireDragOver = false
      const file = e && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
      this.loadRequireFile(file)
    },
    async loadRequireFile(file) {
      if (!file) {
        this.setStatus('未选择需求文件。', 'err')
        return
      }
      const fileName = file.name || ''
      if (!this.isValidUploadFormat(fileName)) {
        this.$notify({
          title: '文件格式不支持',
          message: fileName + ' 不是支持的格式，请上传 .wps / .docx 文件',
          type: 'error',
          duration: 5000
        })
        return
      }
      const docs = this.state.requireDocs || []
      if (docs.some((d) => (d.fileName || '').trim() === fileName.trim())) {
        this.$notify({
          title: '重复文件',
          message: fileName + ' 已上传，请勿重复添加',
          type: 'warning',
          duration: 4000
        })
        return
      }
      try {
        this.setStatus('正在读取需求文件…', 'loading')
        const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : ''
        let text = ''

        // .docx：用 mammoth 正规解析
        if (ext === 'docx' && typeof mammoth !== 'undefined') {
          const arrayBuffer = await file.arrayBuffer()
          const result = await mammoth.extractRawText({ arrayBuffer })
          text = (result && result.value) || ''
        } else if (ext === 'wps') {
          const arrayBuffer = await file.arrayBuffer()
          const u8 = new Uint8Array(arrayBuffer)
          const isZip = u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4b
          if (isZip && typeof mammoth !== 'undefined') {
            const result = await mammoth.extractRawText({ arrayBuffer })
            text = (result && result.value) || ''
          } else {
            text = extractReadableTextFromBinary(arrayBuffer)
          }
        } else {
          text = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onerror = () => reject(reader.error || new Error('读取失败'))
            reader.onload = () => resolve(String(reader.result || ''))
            reader.readAsText(file)
          })
        }
        this.state.requireDocs = [...docs, { fileName, text, ext }]
        this.currentStep = Math.max(this.currentStep, 2)
        this.setStatus(`已添加需求文件：${fileName}（共 ${this.state.requireDocs.length} 个）`, 'ok')
      } catch (e) {
        this.setStatus(`需求文件读取失败：${e.message}`, 'err')
      }
    },
    openBatchDialog() {
      if (!this.state.bookFileName) {
        this.setStatus('请先上传规模估算书。', 'err')
        return
      }
      this.batchDialogVisible = true
      this.batchDialogFile = null
      this.batchDialogFileName = ''
    },

    openBatchFilePicker() {
      const input = this.$refs.batchFileInput
      if (input) {
        input.value = ''
        input.click()
      }
    },

    onBatchFileSelected(e) {
      const file = e && e.target && e.target.files && e.target.files[0]
      if (!file) return
      if (!this.isValidUploadFormat(file.name || '')) {
        this.$notify({
          title: '文件格式不支持',
          message: (file.name || '') + ' 不是支持的格式，请上传 .wps / .docx 文件',
          type: 'error',
          duration: 5000
        })
        return
      }
      this.batchDialogFile = file
      this.batchDialogFileName = file.name || ''
    },

    onBatchDialogDrop(e) {
      this.batchDialogDragOver = false
      const file = e && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
      if (!file) return
      if (!this.isValidUploadFormat(file.name || '')) {
        this.$notify({
          title: '文件格式不支持',
          message: (file.name || '') + ' 不是支持的格式，请上传 .wps / .docx 文件',
          type: 'error',
          duration: 5000
        })
        return
      }
      this.batchDialogFile = file
      this.batchDialogFileName = file.name || ''
    },

    async confirmBatchUpload() {
      const file = this.batchDialogFile
      if (!file) return
      const fileName = file.name || ''
      const docs = this.state.requireDocs || []
      if (docs.some((d) => (d.fileName || '').trim() === fileName.trim())) {
        this.setStatus(`禁止提交重复文件：${fileName}`, 'err')
        return
      }
      try {
        this.setStatus('正在上传需求文件…', 'loading')
        var startNum = parseInt(this.startBatchNumber, 10) || 1
        var count = docs.length
        var current = startNum + count
        var nums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
                    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']
        const batchName = '第' + (nums[current - 1] || current) + '批'

        const formData = new FormData()
        formData.append('file', file)
        formData.append('batchName', batchName)

        const resp = await fetch(`${BACKEND_API_URL}/api/upload`, {
          method: 'POST',
          body: formData,
        })

        if (!resp.ok) {
          const errData = await resp.json().catch(function () { return {} })
          throw new Error(errData.error || '上传失败 (' + resp.status + ')')
        }

        const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : ''
        this.state.requireDocs = [...docs, { fileName, ext, batchName }]
        this.currentStep = Math.max(this.currentStep, 2)
        this.setStatus('已添加' + batchName + '需求文件：' + fileName + '（共 ' + (this.state.requireDocs.length) + ' 个批次）', 'ok')
        this.batchDialogVisible = false
        this.batchDialogFile = null
        this.batchDialogFileName = ''
      } catch (e) {
        this.setStatus('需求文件上传失败：' + e.message, 'err')
      }
    },

    cancelBatchDialog() {
      this.batchDialogVisible = false
      this.batchDialogFile = null
      this.batchDialogFileName = ''
      this.batchDialogDragOver = false
    },

    _getNextBatchName() {
      var startNum = parseInt(this.startBatchNumber, 10) || 1
      var count = (this.state.requireDocs || []).length
      var current = startNum + count
      var nums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
                  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']
      return '第' + (nums[current - 1] || current) + '批'
    },
    _initSortable() {
      var el = this.$refs.docTagList
      if (!el || el._sortableInitialized) return
      var self = this
      Sortable.create(el, {
        handle: '.doc-tag-drag-handle',
        animation: 150,
        ghostClass: 'doc-tag-ghost',
        onEnd: function (evt) {
          var items = JSON.parse(JSON.stringify(self.state.requireDocs))
          var moved = items.splice(evt.oldIndex, 1)[0]
          items.splice(evt.newIndex, 0, moved)
          var nums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
                      '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']
          self.state.requireDocs = items.map(function (doc, i) {
            return Object.assign({}, doc, { batchName: '第' + (nums[i] || (i + 1)) + '批' })
          })
          self.setStatus('需求文档批次顺序已调整', 'ok')
        }
      })
      el._sortableInitialized = true
    },
    openDebugDialog() {
      this.debugDialogVisible = true
      this.debugDialogFile = null
      this.debugDialogFileName = ''
      this.debugDialogDragOver = false
      this.debugResult = null
      this.uploading = false
    },
    openDebugFilePicker() {
      this.$refs.debugFileInput && this.$refs.debugFileInput.click()
    },
    isValidUploadFormat(fileName) {
      var ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : ''
      return ext === 'wps' || ext === 'docx'
    },
    isValidBookFormat(fileName) {
      var ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : ''
      return ext === 'xlsx' || ext === 'et'
    },
    formatBatchIndex(idx) {
      var nums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
                  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']
      return '第' + (nums[idx] || (idx + 1)) + '批'
    },
    setDebugStatus(text, kind) {
      this.debugStatusText = text
      this.debugStatusKind = kind || 'info'
    },
    onDebugFileSelected(e) {
      const file = e && e.target && e.target.files && e.target.files[0]
      if (file) {
        if (!this.isValidUploadFormat(file.name || '')) {
          this.$notify({
            title: '文件格式不支持',
            message: (file.name || '') + ' 不是支持的格式，请上传 .wps / .docx 文件',
            type: 'error',
            duration: 5000
          })
          return
        }
        this.debugDialogFile = file
        this.debugDialogFileName = file.name || ''
      }
    },
    onDebugDialogDrop(e) {
      const file = e.dataTransfer.files[0]
      if (file) {
        if (!this.isValidUploadFormat(file.name || '')) {
          this.$notify({
            title: '文件格式不支持',
            message: (file.name || '') + ' 不是支持的格式，请上传 .wps / .docx 文件',
            type: 'error',
            duration: 5000
          })
          this.debugDialogDragOver = false
          return
        }
        this.debugDialogFile = file
        this.debugDialogFileName = file.name || ''
      }
      this.debugDialogDragOver = false
    },
    async confirmDebugUpload() {
      const file = this.debugDialogFile
      if (!file) return
      try {
        var docs = this.state.requireDocs || []
        var fileName = file.name || ''
        if (docs.some(function (d) { return (d.fileName || '').trim() === fileName.trim() })) {
          this.setDebugStatus('禁止提交重复文件：' + fileName, 'err')
          this.uploading = false
          return
        }
        this.uploading = true
        this.setStatus('正在解析需求文档…', 'loading')
        var nextBatch = this._getNextBatchName()
        const formData = new FormData()
        formData.append('file', file)
        formData.append('batch', nextBatch)
        const resp = await fetch(`${BACKEND_API_URL}/api/debug/upload`, {
          method: 'POST',
          body: formData,
        })
        if (!resp.ok) {
          const errData = await resp.json().catch(function () { return {} })
          throw new Error(errData.error || '调试上传失败 (' + resp.status + ')')
        }
        const result = await resp.json()
        this.debugResult = result

        var wpsList = result.wpsList || []
        allWpsList = allWpsList.concat(wpsList)
        console.log('当前 allWpsList（共 ' + allWpsList.length + ' 条）：', allWpsList)

        var batchName = nextBatch
        var tocFromResult = result.toc || {}
        for (var tKey in tocFromResult) {
          if (tocFromResult.hasOwnProperty(tKey)) {
            state.requireTocMap[batchName + '|' + tKey] = tocFromResult[tKey]
          }
        }

        var tocConsistency = result.tocConsistency
        if (tocConsistency) {
          state.tocConsistencyMap[batchName] = tocConsistency
        }

        var docs = this.state.requireDocs || []
        if (!docs.some(function (d) { return (d.batchName || '') === batchName })) {
          this.state.requireDocs = docs.concat([{ fileName: file.name || '', ext: '', batchName: batchName }])
        }

        this.uploading = false
        this.setStatus('需求文档解析完成', 'ok')
        var self = this
        this.$nextTick(function () { self._initSortable() })
      } catch (e) {
        this.uploading = false
        this.setDebugStatus('需求文档解析失败：' + e.message, 'err')
      }
    },

    async confirmQuickUpload() {
      const file = this.debugDialogFile
      if (!file) return
      try {
        var docs = this.state.requireDocs || []
        var fileName = file.name || ''
        if (docs.some(function (d) { return (d.fileName || '').trim() === fileName.trim() })) {
          this.setDebugStatus('禁止提交重复文件：' + fileName, 'err')
          this.uploading = false
          return
        }
        this.uploading = true
        this.setStatus('正在上传需求文档…', 'loading')
        var nextBatch = this._getNextBatchName()
        const formData = new FormData()
        formData.append('file', file)
        formData.append('batch', nextBatch)
        const resp = await fetch(`${BACKEND_API_URL}/api/debug/upload`, {
          method: 'POST',
          body: formData,
        })
        if (!resp.ok) {
          const errData = await resp.json().catch(function () { return {} })
          throw new Error(errData.error || '直接上传失败 (' + resp.status + ')')
        }
        const result = await resp.json()

        var wpsList = result.wpsList || []
        allWpsList = allWpsList.concat(wpsList)

        var batchName = nextBatch
        var tocFromResult = result.toc || {}
        for (var tKey in tocFromResult) {
          if (tocFromResult.hasOwnProperty(tKey)) {
            state.requireTocMap[batchName + '|' + tKey] = tocFromResult[tKey]
          }
        }

        var tocConsistency = result.tocConsistency
        if (tocConsistency) {
          state.tocConsistencyMap[batchName] = tocConsistency
        }

        var docs = this.state.requireDocs || []
        if (!docs.some(function (d) { return (d.batchName || '') === batchName })) {
          this.state.requireDocs = docs.concat([{ fileName: file.name || '', ext: '', batchName: batchName }])
        }
        this.currentStep = Math.max(this.currentStep, 2)
        this.debugDialogVisible = false
        this.debugDialogFile = null
        this.debugDialogFileName = ''
        this.debugResult = null
        this.uploading = false
        this.setStatus('已添加' + batchName + '需求文件：' + (file.name || ''), 'ok')
        var self = this
        this.$nextTick(function () { self._initSortable() })
      } catch (e) {
        this.uploading = false
        this.setStatus('需求文档上传失败：' + e.message, 'err')
      }
    },

    cancelDebugDialog() {
      this.debugDialogVisible = false
      this.debugDialogFile = null
      this.debugDialogFileName = ''
      this.debugDialogDragOver = false
      this.debugResult = null
      this.uploading = false
      this.debugStatusText = ''
      this.debugStatusKind = ''
    },

    removeBatchDoc(batchName) {
      var remaining = (this.state.requireDocs || []).filter(function (d) { return (d.batchName || '') !== batchName })
      var nums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
                  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']
      this.state.requireDocs = remaining.map(function (doc, i) {
        return Object.assign({}, doc, { batchName: '第' + (nums[i] || (i + 1)) + '批' })
      })

      // 重建 tocConsistencyMap：移除被删批次，其余按新编号重新分配 key
      var newMap = {}
      var kept = []
      for (var oldName in this.state.tocConsistencyMap) {
        if (this.state.tocConsistencyMap.hasOwnProperty(oldName) && oldName !== batchName) {
          kept.push(this.state.tocConsistencyMap[oldName])
        }
      }
      for (var k = 0; k < kept.length; k++) {
        newMap[remaining[k].batchName] = kept[k]
      }
      this.state.tocConsistencyMap = newMap

      // 清理 requireTocMap 中属于该批次的条目
      var prefix = batchName + '|'
      for (var tKey in this.state.requireTocMap) {
        if (this.state.requireTocMap.hasOwnProperty(tKey) && tKey.indexOf(prefix) === 0) {
          delete this.state.requireTocMap[tKey]
        }
      }
      // 重建 requireTocMap 的 key（对应重命名后的批次）
      var tocMap = this.state.requireTocMap
      var tocKeys = Object.keys(tocMap)
      for (var ti = 0; ti < tocKeys.length; ti++) {
        var oldKey = tocKeys[ti]
        var pipeIdx = oldKey.indexOf('|')
        if (pipeIdx < 0) continue
        var oldBatch = oldKey.substring(0, pipeIdx)
        var indexPart = oldKey.substring(pipeIdx)
        var newBatch = this.state.requireDocs[ti] ? this.state.requireDocs[ti].batchName : oldBatch
        var newKey = newBatch + indexPart
        if (oldKey !== newKey) {
          tocMap[newKey] = tocMap[oldKey]
          delete tocMap[oldKey]
        }
      }
    },

    removeRequireDoc(fileName) {
      // 原有逻辑：移除文档记录
      this.state.requireDocs = (this.state.requireDocs || []).filter((d) => (d.fileName || '') !== fileName)
      // 方案A：删除需求文档时清空所有相关数据
      allWpsList = []
      _cachedCompareData = null
      _cachedCheckListRes = null
      _cachedCombinedInBoth = null
      this.compareRes = null
      this.aiCompareLoading = false
      this.stopAiLogSync()
      _aiAnalysisLog = ''
  _aiAnalysisLogLines = []
      this.currentStep = 1
      this.state.violations = []
      this.state.violationMap = new Map()
      this.hasChecked = false
      this.activeResultTab = 'compareGroup'
      this.state.tocConsistencyMap = {}
    },
    onRequireFileSelected(e) {
      const file = e && e.target && e.target.files && e.target.files[0]
      this.loadRequireFile(file)
    },
    async onRunChecks() {
      const isV2016 = state.selectedRuleVersion === 'v2.0.16'
      const aiSuffix = isV2016 && state.requireDocs.length > 0 ? '（AI 增强模式）' : ''
      this.setStatus('正在检查…' + aiSuffix, 'loading')
      const __t0 = Date.now()
      // 清空上一次检查结果，进入加载状态
      this.compareRes = null
      this.aiCompareLoading = true   // 提前显示加载动画（AI 比对页签 + 表格）
      this.state.violations = []
      this.state.violationMap = new Map()
      this.hasChecked = false
      this.aiComparePage = 1
      this.compareSubTab = 'inPoint'
      // 清空模块级 AI 缓存（上一次 API 返回的比对结果），防止旧数据残留
      _cachedCompareData = null
      _cachedCheckListRes = null
      _cachedCombinedInBoth = null
      _aiTimedOut = false
      _aiTimeoutMessage = ''
      _aiCompleted = false
      _aiAnalysisLog = ''
  _aiAnalysisLogLines = []
      _aiNodeErrors = []
      // 启动 AI 思考动画
      if (isV2016) {
        this.startAiLogSync()
      }
      // 强制 Vue 渲染清空后的空状态，避免 runChecks 内部同步回调
      // 立即重填 compareRes 导致用户看不到清空效果
      await this.$nextTick()
      var self = this
      try {
        // 引擎检查完成后立即展示（带 AI 加载中状态），不阻塞 UI
        var engineViolations = null
        var compareDone = false
        var _wGen = _workflowGen
        const v = await runChecks(function (interimViolations) {
          if (_wGen !== _workflowGen) return // 已重置，丢弃在途结果
          engineViolations = interimViolations
          self.state.violations = interimViolations
          self.state.violationMap = buildViolationMap(interimViolations)
          self.activeResultTab = 'violations'
          self.hasChecked = true
          self.currentStep = 3
          self.refreshPreview()
          // 引擎检查完成后立即执行比对，展示加载动画
          if (!compareDone && state.selectedRuleVersion === 'v2.0.16') {
            compareDone = true
            self.aiCompareLoading = true  // AI 比对结果页签 + 表格加载中
            self.onCompare()
          }
          // 展示 AI 进行中状态
          var pendingCount = interimViolations.filter(function (x) { return x.aiPending }).length
          if (pendingCount > 0) {
            self.setStatus('引擎检查完成，AI 大模型正在验证 ' + pendingCount + ' 条…', 'loading')
          } else if (state.selectedRuleVersion === 'v2.0.16') {
            self.setStatus('引擎检查完成，AI 大模型正在分析中…', 'loading')
          }
        })
        this.state.violations = v
        this.state.violationMap = buildViolationMap(v)
        this.activeResultTab = 'violations'
        this.hasChecked = true
        this.currentStep = 3

        const mustCount = v.filter((x) => x.type === '强制').length
        const suggestCount = v.filter((x) => x.type === '建议').length
        /** @type {Map<string, {must: number, suggest: number}>} */
        const summary = new Map()
        for (const item of v) {
          const cur = summary.get(item.sheet) || { must: 0, suggest: 0 }
          if (item.type === '强制') cur.must++
          else cur.suggest++
          summary.set(item.sheet, cur)
        }
        const sheetsLines = [...summary.entries()].map(
          ([s, c], i) => `${i + 1}. ${s}  强制${c.must}条、建议${c.suggest}条；`
        )
        const detail = sheetsLines.length ? '\n  ' + sheetsLines.join('\n  ') : ''
        const aiConfirmedCount = v.filter((x) => x.aiStatus === 'confirmed').length
        const aiNotConfirmedCount = v.filter((x) => x.aiStatus === 'not-confirmed').length
        var aiResultSuffix = ''
        if (aiConfirmedCount > 0 || aiNotConfirmedCount > 0) {
          aiResultSuffix = `（AI 验证确认 ${aiConfirmedCount} 条，不构成违例 ${aiNotConfirmedCount} 条）`
        }
        this.setStatus(`检查完成：强制 ${mustCount} 条，建议 ${suggestCount} 条${aiResultSuffix}\n${detail}`, 'ok')
        this.$notify({
          title: '检查完成',
          message: '强制 ' + mustCount + ' 条，建议 ' + suggestCount + ' 条' + aiResultSuffix,
          type: 'success',
          duration: 5000
        })
        this.refreshPreview()
        await this.persistCheckResult(v, __t0)

        // 如果 onCompare 还未执行（非 v2.0.16），则清空 compareRes
        if (!compareDone) {
          this.compareRes = null
        } else {
          // AI 已完成，重新调用 onCompare 以应用缓存的 AI 结果到比对表格
          this.onCompare()
        }
        // 停止 AI 日志实时同步
        this.stopAiLogSync()
      } catch (e) {
        this.stopAiLogSync()
        this.setStatus(`检查失败：${e.message}`, 'err')
      }
    },
    /**
     * 从批次名称中提取数字编号，支持多种格式：
     *   "第一批" → 1, "第二批" → 2
     *   "第1批"  → 1, "第2批次" → 2
     *   "1"      → 1
     * 返回 null 表示无法提取
     */
    extractBatchNumber(batchStr) {
      if (!batchStr) return null
      var cnNums = {
        '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,
        '十一':11,'十二':12,'十三':13,'十四':14,'十五':15,'十六':16,'十七':17,'十八':18,'十九':19,'二十':20
      }
      // 匹配 "第X批" 或 "第X批次" 格式
      var m = batchStr.match(/第(.+?)批/)
      if (m) {
        var numStr = m[1]
        if (cnNums[numStr] !== undefined) return cnNums[numStr]
        var n = parseInt(numStr, 10)
        if (!isNaN(n)) return n
      }
      // 尝试纯数字
      var n = parseInt(batchStr, 10)
      if (!isNaN(n)) return n
      return null
    },

    /**
     * 为估算书中的批次值找到对应的需求文档批次名。
     * 优先精确匹配；如果失败则通过数字编号映射；如果仍失败且仅有一个需求批次，
     * 则使用该唯一批次作为兜底。
     */
    resolvePointBatch(pointBatch, wpsBatchNames, wpsNumToName) {
      if (!pointBatch) {
        // 空批次：如果仅有一个需求批次，直接使用它
        if (wpsBatchNames.length === 1) return wpsBatchNames[0]
        return ''
      }
      // 精确匹配
      if (wpsBatchNames.indexOf(pointBatch) !== -1) return pointBatch
      // 通过数字编号映射
      var num = this.extractBatchNumber(pointBatch)
      if (num !== null && wpsNumToName[num] !== undefined) return wpsNumToName[num]
      // 兜底：仅一个需求批次时使用
      if (wpsBatchNames.length === 1) return wpsBatchNames[0]
      // 无法映射，保留原始值（将无法匹配，归入 inPoint）
      console.warn('[resolvePointBatch] 无法映射批次: pointBatch=' + pointBatch + ', wpsBatchNames=' + JSON.stringify(wpsBatchNames))
      return pointBatch
    },

    async onCompare() {
      var pointList = this.pointList || []

      // [DIAG] 诊断日志（console.error 始终输出，不受 DEBUG_LOG 控制）
      console.error('[DIAG] onCompare 开始 — pointList 原始:', pointList.length, '条 | allWpsList:', allWpsList.length, '条')

      // 跨 sheet 合并：按 index（章节号）去重
      var seenIndexes = {}
      var mergedPointList = []
      for (var pi = 0; pi < pointList.length; pi++) {
        var p = pointList[pi]
        var idx = (p.index || '') + '|' + (p.batch || '') + '|' + (p.pointName || '') + '|' + (p.funcModule || '')
        if (!seenIndexes[idx]) {
          seenIndexes[idx] = true
          mergedPointList.push(p)
        }
      }
      pointList = mergedPointList

      console.error('[DIAG] 去重后 pointList:', pointList.length, '条')

      // 使用 buildComparisonData 构建比对数据（已去重）
      var cmpData = buildComparisonData(pointList, allWpsList)
      // 如果 runChecks 已缓存了比对数据，优先使用缓存的（保证一致性）
      var inBoth = cmpData.inBoth
      var inPoint = (_cachedCompareData && _cachedCompareData.inPoint) ? _cachedCompareData.inPoint : cmpData.inPoint
      var inWps = (_cachedCompareData && _cachedCompareData.inWps) ? _cachedCompareData.inWps : cmpData.inWps

      console.error('[DIAG] buildComparisonData 结果 — inBoth:', inBoth.length, '条 | inPoint:', inPoint.length, '条 | inWps:', inWps.length, '条')

      console.log('[onCompare] inBoth 数量:', inBoth.length)
      console.log('[onCompare] inPoint 数量:', inPoint.length)
      console.log('[onCompare] inWps 数量:', inWps.length)

      this.compareRes = {
        inBoth: inBoth,
        inPoint: inPoint,
        inWps: inWps,
        aiTimedOut: _aiTimedOut,
        aiTimeoutMessage: _aiTimeoutMessage,
        aiNodeErrors: _aiNodeErrors.slice()
      }
      this.activeResultTab = 'compareGroup'
      console.log('compareRes：', this.compareRes)
      this.setStatus(
        '比对完成：均在 ' + inBoth.length + ' 条，仅估算书 ' + inPoint.length + ' 条，仅需求文档 ' + inWps.length + ' 条',
        'ok'
      )

      // 使用 runChecks 中统一 Agent 流缓存的 AI 结果（避免重复 initSession）
      var cachedResults = _cachedCheckListRes
      var cachedItems = _cachedCombinedInBoth

      console.error('[DIAG] 缓存 — checkListRes:', (cachedResults ? cachedResults.length : 'null'),
        '条 | combinedInBoth:', (cachedItems ? cachedItems.length : 'null'), '条')
      // 打印前 3 对 key 样本，检查格式一致性
      if (inBoth.length > 0 && cachedItems && cachedItems.length > 0) {
        for (var _ds = 0; _ds < Math.min(3, inBoth.length, cachedItems.length); _ds++) {
          var _ib = inBoth[_ds]
          var _ci = cachedItems[_ds]
          console.error('[DIAG] key样本#' + _ds +
            ' | inBoth: batch=' + _ib.batch + ' index=' + _ib.index + ' pointName=' + _ib.pointName +
            ' | cached: batch=' + _ci.batch + ' index=' + _ci.index + ' pointName=' + _ci.pointName)
        }
      }

      if (cachedResults && cachedResults.length > 0 && cachedItems && cachedItems.length > 0) {
        var _matchCount = 0
        // 在缓存中查找匹配项（按 batch|index|pointName 匹配）
        for (var ai = 0; ai < inBoth.length; ai++) {
          var item = inBoth[ai]
          var itemKey = (item.batch || '') + '|' + (item.index || '') + '|' + (item.pointName || '')
          var matchIdx = -1
          for (var ci = 0; ci < cachedItems.length; ci++) {
            var cachedKey = (cachedItems[ci].batch || '') + '|' + (cachedItems[ci].index || '') + '|' + (cachedItems[ci].pointName || '')
            if (cachedKey === itemKey) {
              matchIdx = ci
              break
            }
          }
          if (matchIdx >= 0 && cachedResults[matchIdx]) {
            _matchCount++
            var resultItem = cachedResults[matchIdx]
            this.$set(inBoth[ai], 'aiMatched', resultItem.isInWPS != null ? resultItem.isInWPS : '')
            this.$set(inBoth[ai], 'aiReason', resultItem.reason || '')
            this.$set(inBoth[ai], 'similarityRate', resultItem.similarityRate != null ? resultItem.similarityRate : null)
            this.$set(inBoth[ai], 'aiDesc', resultItem.descDetail || '')
          }
        }
        console.error('[DIAG] 缓存匹配成功:', _matchCount, '/', inBoth.length, '条')
        this.aiCompareLoading = false
        this.compareRes = Object.assign({}, this.compareRes)
        // 标志位：非空即显示日志区域（内容已通过 rAF 直接写入 DOM）
        this.aiAnalysisLog = _aiAnalysisLog ? '⏳' : ''
        this.activeResultTab = 'compareGroup'
        this.compareSubTab = 'aiCompare'
        this.setStatus('AI 分析完成（复用规则检查 Agent 结果）', 'ok')
      } else {
        // 无缓存 AI 结果（例如 AI 未启用或统一 Agent 流未执行）
        // 如果 AI 已完成（超时 / 返回空结果），清除加载状态
        if (_aiTimedOut || _aiCompleted) {
          this.aiCompareLoading = false
        }
        // 如果 AI 超时，切换到 AI 比对结果页签显示超时提示
        if (_aiTimedOut) {
          this.compareSubTab = 'aiCompare'
          this.$notify({
            title: 'AI 分析超时',
            message: _aiTimeoutMessage || 'AI 大模型连接超时，规则引擎检查结果仍然可用',
            type: 'warning',
            duration: 6000
          })
        }
      }
      // AI 节点异常通知
      if (_aiNodeErrors.length > 0) {
        this.compareSubTab = 'aiCompare'
        this.$notify({
          title: 'AI 分析异常',
          message: '共 ' + _aiNodeErrors.length + ' 个 AI 节点执行异常，请查看 AI 比对结果页签中的异常详情',
          type: 'error',
          duration: 8000
        })
      }
    },
    /** 重置工作流：中止进行中任务 + 清空材料与检查结果 + 解除来源锁定（v3.2） */
    async resetWorkflow() {
      this.itaSourceLocked = ''
      this.itaPayload = null
      try { chrome.storage.local.remove(['fcPendingItaImport']) } catch (e) { /* 非扩展环境 */ }
      _workflowGen++
      await this.resetAll()
      this.itaMode = 'manual'
      this.currentStep = 0
      this.setStatus('已重置上传材料与检查结果，可重新选择导入方式。', 'ok')
    },
    async resetAll() {
      this.stopAiLogSync()
      if (this.aiAbortController) {
        this.aiAbortController.abort()
        this.aiAbortController = null
        this.aiCompareLoading = false
      }
      try {
        await fetch(`${BACKEND_API_URL}/api/reset`, { method: 'POST' })
      } catch (e) {
        console.warn('后端重置失败:', e.message)
      }
      allWpsList = []
      _cachedCompareData = null
      _cachedCheckListRes = null
      _cachedCombinedInBoth = null
      this.pointList = null
      if (this.$refs.bookFile) this.$refs.bookFile.value = ''
      if (this.$refs.requireFile) this.$refs.requireFile.value = ''
      this.state.customRules = null
      this.state.bookWb = null
      this.state.businessSheets = []
      this.state.selectedSheet = null
      this.state.violations = []
      this.state.violationMap = new Map()
      this.state.violationSheetFilter = '__ALL__'
      this.state.bookFileName = ''
      this.state.requireDocs = []
      this.state.requireTocMap = {}
      this.state.tocConsistencyMap = {}
      this.batchDialogVisible = false
      this.batchDialogFile = null
      this.batchDialogFileName = ''
      this.compareRes = null
      this.aiCompareLoading = false
      this.aiAnalysisLog = ''
      this.aiThinkingPhase = 'idle'
      this._stopSweep()
      _aiTimedOut = false
      _aiCompleted = false
      _aiTimeoutMessage = ''
      _aiAnalysisLog = ''
  _aiAnalysisLogLines = []
      _aiNodeErrors = []
      this.activeResultTab = 'violations'
      this.hasChecked = false
      this.currentStep = 0
      this.aiUrlTested = false
      this.aiConfigPopVisible = false
      this.compareSubTab = 'inPoint'
      this.startBatchNumber = 1
      applyRulesByVersion()
      this.setStatus('已重置。', 'ok')
      this.refreshPreview()
      await this.apiCleanupTemp()
      await this.checkAiOnMount()
    },

    handleRulesDrawerClose() {
      this.rulesDrawerVisible = false
    },

    onRulesVersionChange() {
      applyRulesByVersion()
    },

    async apiReset() {
      try {
        await fetch(`${BACKEND_API_URL}/api/reset`, { method: 'POST' })
      } catch (e) {
        console.warn('后端重置失败:', e.message)
      }
    },

    async apiCleanupTemp() {
      try {
        await fetch(`${BACKEND_API_URL}/api/cleanup-temp`, { method: 'POST' })
      } catch (e) {
        console.warn('临时文件清理失败:', e.message)
      }
    },

    async checkAiOnMount() {
      const url = this.state.aiApiUrl
      if (!url) {
        this.aiCheckBanner = { text: '建议配置 AI 大模型 API 以获得更好的功能点检查能力', type: 'warn' }
        return
      }
      try {
        const available = await apiCheckAiAvailable(url)
        if (available) {
          this.state.aiUrlStatus = 'ok'
          this.aiUrlTested = true
          this.aiCheckBanner = { text: 'AI 辅助检查已就绪 ✓', type: 'ok' }
        } else {
          this.state.aiUrlStatus = 'err'
          this.aiUrlTested = true
          this.aiCheckBanner = { text: 'AI API 连接异常，请重新测试', type: 'err' }
        }
      } catch (_) {
        this.state.aiUrlStatus = 'err'
        this.aiUrlTested = true
        this.aiCheckBanner = { text: 'AI API 连接异常，请重新测试', type: 'err' }
      }
    },

    async loadHtml2Canvas() {
      if (typeof html2canvas !== 'undefined') return Promise.resolve()
      return new Promise(function (resolve, reject) {
        var script = document.createElement('script')
        script.src = './vendor/html2canvas.min.js'
        script.onload = resolve
        script.onerror = reject
        document.head.appendChild(script)
      })
    },

    async saveViolationsAsImage() {
      try {
        await this.loadHtml2Canvas()
        var tabName = this.activeResultTab
        var targetId = tabName === 'summary' ? 'summaryTabContent' : 'violationsTabContent'
        var el = document.getElementById(targetId)
        if (!el) {
          this.setStatus('未找到目标区域', 'err')
          return
        }
        var canvas = await html2canvas(el, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
        })
        var prefix = tabName === 'summary' ? '结果摘要' : '违例清单'
        var link = document.createElement('a')
        link.download = prefix + '_' + new Date().toISOString().slice(0, 10) + '.png'
        link.href = canvas.toDataURL('image/png')
        link.click()
        if (typeof ELEMENT !== 'undefined' && ELEMENT.Message) {
          ELEMENT.Message({ message: prefix + '已保存为图片', type: 'success', duration: 2000 })
        }
      } catch (e) {
        this.setStatus('保存图片失败：' + e.message, 'err')
      }
    },
    async saveAsImage() {
      try {
        await this.loadHtml2Canvas()
        var tabName = this.activeResultTab
        var targetId = tabName === 'summary' ? 'summaryTabContent' : 'violationsTabContent'
        var el = document.getElementById(targetId)
        if (!el) {
          this.setStatus('未找到目标区域', 'err')
          return
        }
        var canvas = await html2canvas(el, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
        })
        var prefix = tabName === 'summary' ? '结果摘要' : '违例清单'
        var link = document.createElement('a')
        link.download = prefix + '_' + new Date().toISOString().slice(0, 10) + '.png'
        link.href = canvas.toDataURL('image/png')
        link.click()
        if (typeof ELEMENT !== 'undefined' && ELEMENT.Message) {
          ELEMENT.Message({ message: prefix + '已保存为图片', type: 'success', duration: 2000 })
        }
      } catch (e) {
        this.setStatus('保存图片失败：' + e.message, 'err')
      }
    },

    async copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
        } else {
          const ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.focus()
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        if (typeof ELEMENT !== 'undefined' && ELEMENT && typeof ELEMENT.Message === 'function') {
          ELEMENT.Message({ message: '复制成功', type: 'success', duration: 1200 })
        } else {
          this.setStatus('说明已复制到剪贴板。', 'ok')
        }
      } catch (e) {
        this.setStatus('复制失败，请手动选择文本复制。', 'err')
      }
    },
    /** 随机取一个思考词（避免与上一个重复） */
    _pickThinkingPhrase() {
      var phrases = this.thinkingPhrases
      if (!phrases || !phrases.length) return 'AI 思考中…'
      var pool = phrases.filter(function (p) { return p !== this.currentThinkingPhrase }.bind(this))
      if (!pool.length) pool = phrases
      return pool[Math.floor(Math.random() * pool.length)]
    },
    /** 启动 AI 思考动画 — 逐字扫描高亮 + SSE 事件计数 */
    startAiLogSync() {
      this._stopSweep()
      if (this._aiLogRafId) cancelAnimationFrame(this._aiLogRafId)
      if (this._phraseTimer) clearInterval(this._phraseTimer)
      // 进入思考阶段
      this.aiThinkingPhase = 'thinking'
      this.aiAnalysisLog = '⏳'
      this.aiSseEventCount = 0
      this.currentThinkingPhrase = this._pickThinkingPhrase()
      this.aiThinkingText = this.currentThinkingPhrase
      this.aiThinkingSweepIdx = 0
      this.aiThinkingSweepDir = 1
      var self = this

      // rAF：追踪 SSE 事件计数
      var _lastLen = 0
      function _syncFrame() {
        var cur = _aiAnalysisLog || ''
        if (cur.length !== _lastLen) {
          _lastLen = cur.length
          var lines = cur.split('\n')
          var count = 0
          for (var i = 0; i < lines.length; i++) {
            if (lines[i].trim()) count++
          }
          self.aiSseEventCount = count
        }
        self._aiLogRafId = requestAnimationFrame(_syncFrame)
      }
      self._aiLogRafId = requestAnimationFrame(_syncFrame)

      // 思考词轮播：2-3 秒随机切换
      this._phraseTimer = setInterval(function () {
        self.currentThinkingPhrase = self._pickThinkingPhrase()
        self.aiThinkingText = self.currentThinkingPhrase
      }, 3500 + Math.floor(Math.random() * 2500))

      // 逐字扫描动画：左右往复
      this._startSweep()
    },

    /** 启动逐字扫描（左→右 → 右→左 往复） */
    _startSweep() {
      var self = this
      var chars = this.aiThinkingText || ''
      var len = chars.length
      if (!len) return

      this._sweepTimer = setInterval(function () {
        // 方向边界检查
        if (self.aiThinkingSweepIdx >= len - 1) {
          self.aiThinkingSweepDir = -1
        } else if (self.aiThinkingSweepIdx <= 0) {
          self.aiThinkingSweepDir = 1
        }
        self.aiThinkingSweepIdx += self.aiThinkingSweepDir
      }, 220)
    },

    /** 停止逐字扫描 */
    _stopSweep() {
      if (this._sweepTimer) {
        clearInterval(this._sweepTimer)
        this._sweepTimer = null
      }
    },

    /** 停止 AI 思考动画 — 保留展示区域，切换为完成态 */
    stopAiLogSync() {
      this._stopSweep()
      if (this._aiLogRafId) {
        cancelAnimationFrame(this._aiLogRafId)
        this._aiLogRafId = null
      }
      if (this._phraseTimer) {
        clearInterval(this._phraseTimer)
        this._phraseTimer = null
      }
      // 保留 wrapper，切换为完成态（保留最终 SSE 计数）
      this.aiThinkingPhase = 'done'
      this.aiThinkingText = 'AI 分析完成'
      // aiSseEventCount 保留最终值，不清零
      this.currentThinkingPhrase = ''
    },

    // ═══════════════════════════════════════════════════════
    //  版本检查与自动更新
    // ═══════════════════════════════════════════════════════

    /** 协议拉起后端（projecttool:// 由「安装后端.bat」注册，iframe 方式避免导航离开当前页） */
    triggerProtocolLaunch() {
      try {
        var iframe = document.createElement('iframe')
        iframe.style.display = 'none'
        iframe.src = 'projecttool://start'
        document.body.appendChild(iframe)
        setTimeout(function () { iframe.remove() }, 1000)
        return true
      } catch (e) { return false }
    },

    /** 检测后端是否运行，不可达时自动拉起 exe，等待就绪后返回 */
    async ensureBackendRunning() {
      // Step 1: 快速检查后端是否已在运行
      try {
        var resp = await fetch(BACKEND_API_URL + '/api/version/current', { signal: AbortSignal.timeout(2000) })
        if (resp.ok) return  // 后端已在运行
      } catch (e) {}

      // Step 2: 不在运行，拉起新后端（优先 Native Messaging，与 workbench.js tryStartBackend 同款；
      // 回退 projecttool:// 协议——两者均由「安装后端.bat」注册。严禁使用 filechecker://：
      // 那是旧 WPS 工具的残留注册，指向已废弃的 wps_server.exe）
      try {
        var self = this
        await new Promise(function (resolve) {
          try {
            chrome.runtime.sendNativeMessage('com.projecttool.startbackend', { action: 'start' }, function (resp) {
              if (chrome.runtime.lastError || !(resp && resp.ok)) resolve(self.triggerProtocolLaunch())
              else resolve(true)
            })
          } catch (e) { resolve(self.triggerProtocolLaunch()) }
        })
      } catch (e) {}

      // Step 3: 等待后端启动（最多等 15 秒，每 2 秒检测一次）
      for (var i = 0; i < 8; i++) {
        await new Promise(function (r) { setTimeout(r, 2000) })
        try {
          var resp2 = await fetch(BACKEND_API_URL + '/api/version/current', { signal: AbortSignal.timeout(2000) })
          if (resp2.ok) return  // 后端已就绪
        } catch (e) {}
      }
    },

    /** 初始化版本检查 */
    async initVersionCheck() {
      try {
        var resp = await fetch(BACKEND_API_URL + '/api/version/current')
        if (!resp.ok) return
        var data = await resp.json()
        this.currentVersion = data.version || '0.0.0.0'

        if (data.update_enabled && data.auto_check) {
          await this.checkForUpdate(true)  // silent: 自动检查，不弹错误
        }
      } catch (e) {
        console.warn('[版本检查] 初始化失败:', e)
      }
    },

    /** 检查是否有新版本 */
    async checkForUpdate(silent) {
      this.updatePhase = 'checking'
      try {
        var resp = await fetch(BACKEND_API_URL + '/api/version/check')
        if (!resp.ok) { this.updatePhase = 'idle'; return }
        var data = await resp.json()
        if (data.error) {
          if (!silent) {
            this.updateErrorMessage = data.error
            this.updateErrorCode = 'CHECK_FAILED'
            this.updateCanRetry = true
            this.showUpdateError = true
          }
          console.warn('[版本检查]', data.error)
          this.updatePhase = 'idle'
          return
        }
        this.updateAvailable = data.update_available
        if (data.update_available) {
          this.latestVersion = data.latest_version
          this.updateChangelog = data.changelog || []
          this.updatePackageSize = data.package_size || 0
          this.showUpdateDialog = true
        } else if (!silent) {
          // 手动检查且已是最新版本时，toast 提示
          this.setStatus('✅ 已是最新版本 v' + this.currentVersion, 'ok')
        }
      } catch (e) {
        if (!silent) {
          this.updateErrorMessage = '无法连接到后端服务，请确认后端已启动'
          this.updateErrorCode = 'NETWORK_UNREACHABLE'
          this.updateCanRetry = false
          this.showUpdateError = true
        }
        console.warn('[版本检查] 检查失败:', e)
      }
      this.updatePhase = 'idle'
    },

    /** 格式化文件大小 */
    formatUpdateSize(bytes) {
      if (!bytes || bytes === 0) return ''
      if (bytes < 1024) return bytes + ' B'
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
      return (bytes / 1048576).toFixed(1) + ' MB'
    },

    /** 开始更新 */
    async startUpdate() {
      this.showUpdateDialog = false
      this.showUpdateProgress = true
      this.updatePhase = 'downloading'
      this.updateProgress = 0
      this.updateStageMessage = '正在准备更新...'
      this.updateDetailMessage = ''
      this.updateErrorMessage = ''

      try {
        var resp = await fetch(BACKEND_API_URL + '/api/version/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        var data = await resp.json()
        if (data.status === 'error') {
          this.updatePhase = 'error'
          this.updateErrorMessage = data.message || '启动更新失败'
          this.showUpdateError = true
          return
        }
        this.pollUpdateProgress()
      } catch (e) {
        this.updatePhase = 'error'
        this.updateErrorMessage = '无法连接到后端服务'
        this.showUpdateError = true
      }
    },

    /** 轮询更新进度 */
    pollUpdateProgress() {
      var self = this
      var poll = function () {
        fetch(BACKEND_API_URL + '/api/version/status')
          .then(function (resp) {
            if (!resp.ok) {
              if (self.updatePhase === 'restarting') {
                self.reconnectTimer = setTimeout(poll, 2000)
                return
              }
              self.updatePhase = 'error'
              self.updateErrorMessage = '无法获取更新状态'
              self.showUpdateError = true
              return
            }
            return resp.json()
          })
          .then(function (data) {
            if (!data) return
            var prevPhase = self.updatePhase
            self.updatePhase = data.phase || 'idle'
            self.updateProgress = data.progress_percent || 0
            self.updateStageMessage = data.stage_message || ''
            self.updateDetailMessage = data.detail_message || ''
            self.updateErrorCode = data.error_code
            self.updateErrorMessage = data.error_message || ''
            self.updateCanRetry = data.can_retry !== false

            // 后端重启后重连成功（phase 从 restarting 变回 idle），视为更新完成
            if (prevPhase === 'restarting' && data.phase === 'idle') {
              self.showUpdateProgress = false
              self.showUpdateComplete = true
              if (self.latestVersion) {
                self.currentVersion = self.latestVersion
              }
              return
            }
            if (data.phase === 'success') {
              self.showUpdateProgress = false
              self.showUpdateComplete = true
              if (self.latestVersion) {
                self.currentVersion = self.latestVersion
              }
              return
            }
            if (data.phase === 'error') {
              self.showUpdateProgress = false
              self.showUpdateError = true
              return
            }
            if (data.phase === 'restarting') {
              self.updateStageMessage = data.stage_message || '后端服务正在重启，预计 5-10 秒...'
              self.reconnectTimer = setTimeout(poll, 2000)
              return
            }
            setTimeout(poll, 1000)
          })
          .catch(function () {
            if (self.updatePhase === 'restarting') {
              self.reconnectTimer = setTimeout(poll, 2000)
              return
            }
            setTimeout(poll, 2000)
          })
      }
      poll()
    },

    retryUpdate() {
      this.showUpdateError = false
      this.startUpdate()
    },
    dismissUpdate() { this.showUpdateDialog = false },
    dismissComplete() { this.showUpdateComplete = false },
    dismissError() {
      this.showUpdateError = false
      this.updatePhase = 'idle'
    },
    reloadPage() { window.location.reload(true) },
  },
}
)
