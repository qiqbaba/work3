#!/usr/bin/env node
/**
 * 办公文件工具箱 — 唯一构建器（Node 原生模块，零 npm 依赖）
 *
 *   node build_single.js            生成全部产物；内容不变时不会写盘（幂等）
 *   node build_single.js --check    只校验产物与源码是否一致，供 CI / verify.js 使用
 *
 * 唯一真相源：index.html、style.css、src/manifest.json + src/**、lib/*.min.js、
 *             install.bat / install.ps1 / update.ps1
 * 生成产物：  app.js、selftest.html、office-toolbox-offline.html、version.json
 *
 * 设计约束：离线单文件版必须能在 file:// 下双击运行，因此源码分区以
 * classic script 片段存放，构建期按 manifest 拼进同一个 IIFE。这样既让
 * 源码可拆分维护，又不引入打包器 / ESM 的 CORS 限制。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const read = p => fs.readFileSync(p, 'utf8');
const readBuf = p => fs.readFileSync(p);
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const assert = (ok, msg) => { if (!ok) throw new Error('构建失败: ' + msg); };

const CSS_TAG = '<link rel="stylesheet" href="./style.css">';
const VENDOR_TAG = [
  '  <!-- Local Vendor Scripts -->',
  '  <script src="./lib/pdf.min.js"></script>',
  '  <script src="./lib/pdf-lib.min.js"></script>',
  '  <script src="./lib/jszip.min.js"></script>',
  '  <script src="./lib/jsqr.js"></script>',
].join('\n');
const APP_TAG = '  <script src="./app.js"></script>';
const DEPLOY_RE = /  <!-- LAN Deployment Logic \(active only when served over http\/https\) -->[\s\S]*?\n  <\/script>\n/;
const DEPLOY_SECTION_RE = / {8}<!-- LAN Deployment Card \(shown only when accessed over http\/https\) -->\n {8}<section class="card deploy-card" id="deploySection"[\s\S]*?\n {8}<\/section>\n/;
const DEPLOY_CSS_RE = /\/\* ={4,} Deploy Card ={4,} \*\/[\s\S]*?(?=\/\* ={4,} )/;

const OUTPUTS = ['app.js', 'selftest.html', 'office-toolbox-offline.html', 'version.json'];

function compute() {
  const manifestFiles = JSON.parse(read(path.join(SRC, 'manifest.json')));
  assert(Array.isArray(manifestFiles) && manifestFiles.length > 0, 'src/manifest.json 为空');
  const seen = new Set();
  const app = manifestFiles.map(rel => {
    assert(!path.isAbsolute(rel) && !rel.includes('..'), '非法的分区路径: ' + rel);
    assert(!seen.has(rel), 'manifest.json 中分区重复: ' + rel);
    seen.add(rel);
    const file = path.join(SRC, rel);
    assert(fs.existsSync(file), '缺少源码分区: src/' + rel);
    return read(file);
  }).join('');

  // 生成前先做语法编译，避免把坏代码写进产物。
  new vm.Script(app, { filename: 'app.js' });

  const indexHtml = read(path.join(ROOT, 'index.html'));
  const css = read(path.join(ROOT, 'style.css'));
  const lib = name => read(path.join(ROOT, 'lib', name));
  const vendor = Object.fromEntries(
    ['pdf.min.js', 'pdf.worker.min.js', 'pdf-lib.min.js', 'jszip.min.js', 'jsqr.js']
      .map(n => [n, sha(readBuf(path.join(ROOT, 'lib', n)))])
  );

  // 锚点必须全部命中；旧构建器会静默降级成半成品，这里改为硬失败。
  assert(indexHtml.includes(CSS_TAG), 'index.html 缺少 style.css 引用锚点');
  assert(indexHtml.includes(VENDOR_TAG), 'index.html 缺少 Local Vendor Scripts 锚点');
  assert((indexHtml.match(new RegExp(escapeRegExp(APP_TAG), 'g')) || []).length === 1,
    'index.html 中 app.js 引用锚点必须恰好出现一次');

  // 离线单文件版没有局域网安装入口，部署卡片及其样式无需随包分发。
  assert(DEPLOY_SECTION_RE.test(indexHtml), 'index.html 缺少局域网部署卡片锚点');
  assert(DEPLOY_CSS_RE.test(css), 'style.css 缺少 Deploy Card 样式块');
  const inlineCss = `<style>\n${css.replace(DEPLOY_CSS_RE, '')}\n  </style>`;
  // 内联顺序与源码版 index.html 保持一致，避免两份产物的依赖加载顺序漂移。
  const inlineVendor = [
    '  <!-- 100% 离线自包含第三方库 -->',
    '  <script id="pdfWorkerCode" type="text/plain">',
    lib('pdf.worker.min.js'),
    '  </script>',
    '  <script>', lib('pdf.min.js'), '  </script>',
    '  <script>', lib('pdf-lib.min.js'), '  </script>',
    '  <script>', lib('jszip.min.js'), '  </script>',
    '  <script>', lib('jsqr.js'), '  </script>',
  ].join('\n');
  const inlineApp = ['  <!-- 核心业务交互逻辑 -->', '  <script>', app, '  </script>'].join('\n');

  let single = indexHtml
    .replace(CSS_TAG, () => inlineCss)
    .replace(VENDOR_TAG, () => inlineVendor)
    .replace(APP_TAG, () => inlineApp);

  // 离线单文件版不提供局域网安装入口，去掉只在 http(s) 下生效的部署脚本与卡片。
  assert(DEPLOY_RE.test(single), '未找到可移除的 LAN 部署脚本');
  single = single.replace(DEPLOY_RE, '');
  assert(DEPLOY_SECTION_RE.test(single), '未找到可移除的局域网部署卡片');
  single = single.replace(DEPLOY_SECTION_RE, '');

  // 输出校验：不允许残留任何相对外链，确保真正 100% 自包含。
  assert(!/<script[^>]+src="\.\//.test(single), '单文件版残留 <script src="./..."> 外链');
  assert(!/<link[^>]+href="\.\//.test(single), '单文件版残留 <link href="./..."> 外链');
  assert(!single.includes('id="deploySection"'), '单文件版残留局域网部署卡片');
  assert(!single.includes('.deploy-card'), '单文件版残留部署卡片样式');
  assert(single.includes('id="pdfWorkerCode"'), '单文件版缺少内嵌 Worker');
  assert(single.includes(inlineApp), '单文件版未内联 app.js');
  assert(/<\/body>/.test(single), '单文件版结构不完整');

  // 自检页完全由 index.html 生成，DOM/CSS 与生产页同源，只多三行脚本。
  const testHtml = indexHtml.replace(APP_TAG, () => [
    '  <!-- 自检页由 build_single.js 生成；被测代码就是生产 app.js -->',
    '  <script>window.__ENABLE_TEST_HOOKS__ = true;</script>',
    APP_TAG,
    '  <script src="./selftest.js"></script>',
  ].join('\n'));

  const singleBuf = Buffer.from(single, 'utf8');
  const scripts = Object.fromEntries(
    ['install.bat', 'install.ps1', 'update.ps1']
      .map(n => [n, sha(readBuf(path.join(ROOT, n)))])
  );
  // 安装/更新脚本同样是发布输入：只哈希单文件 HTML 会让脚本改动后 version 不变，
  // 服务端不发布新版本、已安装客户端也不会拉取修复后的脚本。
  const version = 'v' + sha(Buffer.concat([
    singleBuf,
    Buffer.from(JSON.stringify({ scripts, vendor }), 'utf8'),
  ])).slice(0, 16);

  let updated = new Date().toISOString();
  let manifest = {};
  const versionPath = path.join(ROOT, 'version.json');
  if (fs.existsSync(versionPath)) {
    try { manifest = JSON.parse(read(versionPath)); } catch (e) { /* 首次构建 */ }
    if (manifest.version === version && manifest.updated) updated = manifest.updated;
  }
  const versionJson = JSON.stringify({
    schemaVersion: 2,
    name: 'office-toolbox',
    product: '办公文件工具箱',
    file: 'office-toolbox-offline.html',
    notes: '单文件离线版；客户端更新前必须校验 sha256 与 size',
    version,
    updated,
    size: singleBuf.length,
    sha256: sha(singleBuf),
    appSha256: sha(Buffer.from(app, 'utf8')),
    scripts,
    vendor,
  }, null, 2) + '\n';

  return {
    outputs: {
      'app.js': app,
      'selftest.html': testHtml,
      'office-toolbox-offline.html': single,
      'version.json': versionJson,
    },
    version,
    vendor,
  };
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function writeIfChanged(rel, content) {
  const file = path.join(ROOT, rel);
  if (fs.existsSync(file) && read(file) === content) return false;
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

function main() {
  const check = process.argv.includes('--check');
  const { outputs, version } = compute();
  let drift = 0;
  for (const name of OUTPUTS) {
    const file = path.join(ROOT, name);
    const same = fs.existsSync(file) && read(file) === outputs[name];
    if (!same) drift++;
    if (check) {
      console.log(`${same ? 'OK     ' : 'DRIFT  '} ${name}`);
    } else {
      const written = writeIfChanged(name, outputs[name]);
      console.log(`${written ? 'WRITE  ' : 'SAME   '} ${name}`);
    }
  }
  if (check) {
    if (drift) {
      console.error(`\n产物与源码不一致（${drift} 个），请运行: node build_single.js`);
      process.exit(1);
    }
    console.log(`\n一致性校验通过，版本 ${version}`);
  } else {
    console.log(`\n构建完成，版本 ${version}（内容哈希，未变更时不会触发客户端更新）`);
  }
}

module.exports = { compute, OUTPUTS, ROOT };
if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
