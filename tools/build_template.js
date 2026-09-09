#!/usr/bin/env node
/**
 * estimation 模板离线编译脚本
 *
 * 背景：MV3 扩展页 CSP 禁止 unsafe-eval，Vue 2 运行时模板编译（new Function）
 * 无法工作。此脚本把 estimation.html 中 #app 的模板一次性预编译为 render 函数，
 * 生成 estimation.render.js（纯函数执行，无 eval）。
 *
 * 用法：node tools/build_template.js   （修改 estimation.html 模板后需重新执行）
 */
const fs = require('fs');
const path = require('path');
const compiler = require('/tmp/vuebuild/node_modules/vue-template-compiler');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'estimation.html'), 'utf-8');

// 提取 #app 根元素内部作为模板（结束边界：第一个 <script 标签前的最后一个 </div>）
const startMark = '<div id="app" class="app" v-cloak>';
const start = html.indexOf(startMark);
const firstScript = html.indexOf('<script');
const end = html.lastIndexOf('</div>', firstScript);
if (start < 0 || firstScript < 0 || end < 0) {
  console.error('未找到 #app 模板边界');
  process.exit(1);
}
let inner = html.slice(start + startMark.length, end);
// 离线编译要求单根：包一层 display:contents 的包装 div（不影响布局）
inner = '<div class="app-root">' + inner + '</div>';

const res = compiler.compile(inner, { outputSourceRange: false });
if (res.errors && res.errors.length) {
  console.error('模板编译错误:');
  res.errors.forEach((e) => console.error(' -', typeof e === 'string' ? e : e.msg));
  process.exit(1);
}

const out = `// !! 本文件由 tools/build_template.js 自动生成（源：estimation.html 的 #app 模板）
// !! MV3 CSP 禁止 unsafe-eval，Vue 运行时无法在扩展页编译模板，故离线预编译为 render 函数。
// !! 修改 estimation.html 模板后请重新执行：node tools/build_template.js
window.__ESTIMATION_TEMPLATE = {
  render: function () { ${res.render} },
  staticRenderFns: [${res.staticRenderFns.map((s) => `function () { ${s} }`).join(',')}]
};
`;

fs.writeFileSync(path.join(ROOT, 'estimation.render.js'), out, 'utf-8');
console.log('✅ estimation.render.js 生成成功（render +', res.staticRenderFns.length, '个 staticRenderFns）');
