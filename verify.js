#!/usr/bin/env node
/**
 * 零依赖静态校验：产物一致性、语法、依赖锁定、发布清单与安装脚本完整性。
 *   node verify.js     全部通过时退出码 0，否则 1（供 CI / 预提交钩子使用）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = __dirname;
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = p => fs.readFileSync(p, 'utf8');
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg} (${String(a).slice(0, 80)} != ${String(b).slice(0, 80)})`); };
const ok = (v, msg) => { if (!v) throw new Error(msg); };

const checks = [];
const failures = [];
function check(name, fn) {
  try { fn(); checks.push(['PASS', name]); }
  catch (e) { checks.push(['FAIL', name]); failures.push(`${name} :: ${e.message}`); }
}

let out;
const { compute, OUTPUTS } = require('./build_single.js');
check('构建器可从源码计算出全部产物', () => { out = compute(); });

check('四个产物与源码完全一致（构建应幂等）', () => {
  for (const name of OUTPUTS) {
    const file = path.join(ROOT, name);
    ok(fs.existsSync(file), name + ' 缺失');
    eq(read(file), out.outputs[name], name + ' 与源码不一致');
  }
});

check('app.js 语法可编译', () => {
  new vm.Script(out.outputs['app.js'], { filename: 'app.js' });
});

check('不存在测试副本 selftest_app.js', () => {
  ok(!fs.existsSync(path.join(ROOT, 'selftest_app.js')), '发现遗留的手工副本');
});

check('自检页与生产页共用同一份 app.js 且 DOM 不漂移', () => {
  const idx = out ? read(path.join(ROOT, 'index.html')) : '';
  const test = out.outputs['selftest.html'];
  ok(idx.includes('<script src="./app.js"></script>'), '生产页未引用 app.js');
  ok(test.includes('<script src="./app.js"></script>'), '自检页未引用生产 app.js');
  ok(test.includes('__ENABLE_TEST_HOOKS__'), '自检页未开启测试钩子');
  ok(!test.includes('selftest_app.js'), '自检页仍引用副本');
  const restored = test.replace(
    /  <!-- 自检页由 build_single\.js 生成[^\n]*\n  <script>window\.__ENABLE_TEST_HOOKS__ = true;<\/script>\n  <script src="\.\/app\.js"><\/script>\n  <script src="\.\/selftest\.js"><\/script>/,
    '  <script src="./app.js"></script>'
  );
  eq(restored, idx, '自检页 DOM 与生产页不一致');
});

check('离线单文件版 100% 自包含', () => {
  const s = out.outputs['office-toolbox-offline.html'];
  ok(!/<script[^>]+src="\.\//.test(s), '残留脚本外链');
  ok(!/<link[^>]+href="\.\//.test(s), '残留样式外链');
  ok(s.includes('id="pdfWorkerCode"'), '缺少内嵌 Worker');
  ok(!s.includes('LAN Deployment Logic'), '离线版残留局域网部署脚本');
  ok(!s.includes('deploySection'), '离线版残留局域网部署卡片');
  ok(!s.includes('.deploy-card'), '离线版残留部署卡片样式');
  ok(s.includes(out.outputs['app.js']), '内联业务代码与 app.js 不一致');
});

check('version.json 完整性字段与磁盘文件一致', () => {
  const v = JSON.parse(out.outputs['version.json']);
  const singlePath = path.join(ROOT, 'office-toolbox-offline.html');
  ok(/^v[0-9a-f]{16}$/.test(v.version), '版本号应为内容哈希');
  eq(v.sha256, sha(singlePath), '产物 sha256');
  eq(v.size, fs.statSync(singlePath).size, '产物 size');
  eq(v.appSha256, sha(path.join(ROOT, 'app.js')), 'app.js sha256');
  for (const [name, hash] of Object.entries(v.scripts)) eq(hash, sha(path.join(ROOT, name)), name + ' 哈希');
  for (const [name, hash] of Object.entries(v.vendor)) eq(hash, sha(path.join(ROOT, 'lib', name)), 'lib/' + name + ' 哈希');
});

check('第三方依赖锁定清单与实际文件一致', () => {
  const locked = JSON.parse(read(path.join(ROOT, 'lib', 'versions.json')));
  const v = JSON.parse(out.outputs['version.json']);
  for (const [name, meta] of Object.entries(locked.files)) {
    ok(meta.source, name + ' 缺少来源记录');
    eq(meta.sha256, sha(path.join(ROOT, 'lib', name)), name + ' 校验和不匹配');
    eq(meta.sha256, v.vendor[name], name + ' 与 version.json 不一致');
  }
  eq(Object.keys(locked.files).length, 5, '依赖数量');
});

check('安装 / 更新链路具备完整性校验与回滚', () => {
  const upd = read(path.join(ROOT, 'update.ps1'));
  const ins = read(path.join(ROOT, 'install.ps1'));
  const bat = read(path.join(ROOT, 'install.bat'));
  ok(bat.includes('Get-FileHash'), 'install.bat 缺少哈希校验');
  ok(bat.includes('http://REPLACE_ME:8000'), '安装脚本占位符丢失');
  ok(/Get-Sha256/.test(upd) && /Restore-Backup/.test(upd), 'update.ps1 缺少校验或回滚');
  ok(/Get-Sha256/.test(ins), 'install.ps1 缺少清单校验');
});

check('源码分区清单完整且无重复', () => {
  const list = JSON.parse(read(path.join(ROOT, 'src', 'manifest.json')));
  eq(new Set(list).size, list.length, '分区重复');
  for (const f of list) ok(fs.existsSync(path.join(ROOT, 'src', f)), '缺少分区 ' + f);
  ok(list.length > 60, '分区数量异常（工具应逐个独立成文件）');
});

for (const [status, name] of checks) console.log(`${status}  ${name}`);
console.log(`\n${checks.length - failures.length}/${checks.length} 项校验通过`);
if (failures.length) {
  console.error('\n校验失败：');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
