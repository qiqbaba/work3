#!/usr/bin/env node
/**
 * 办公文件工具箱 — 局域网服务（Node 原生模块，零 npm 依赖）
 *
 *   node server.js                    默认 0.0.0.0:8080，启动即构建，并监听源码变化自动发布新版本
 *   node server.js --port 9000        换端口；端口被占用时自动顺延，install.bat 会带上实际地址
 *   node server.js --no-watch         不监听源码变化
 *   node server.js --no-build         不执行构建，仅用现有产物提供服务
 *   node server.js --open             监听成功后自动用系统默认浏览器打开本机页面
 *
 * 与客户端安装 / 更新链路的约定：
 *   /version.json                    最新构建清单，客户端据此判断是否有新版本
 *   /install.bat                    必须保留 http://REPLACE_ME:8000 占位符（网页下载时替换为 location.origin）
 *   注：占位符里的 8000 只是被替换的字符串，服务实际端口与之无关。
 *   /install.ps1 /update.ps1        必须与 version.json 中的 sha256 一致
 *   /office-toolbox-offline.html    必须与 version.json 中的 sha256 / size 一致
 * 因此这里采用白名单放行，绝不暴露 .git / .codebuddy / node_modules / 服务端源码等目录。
 * 所有响应 no-store：网页刷新即最新，version.json 也不会被客户端缓存而漏掉更新。
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, exec } = require('child_process');

const ROOT = __dirname;
const BUILDER = path.join(ROOT, 'build_single.js');
const MANIFEST = path.join(ROOT, 'version.json');
const PLACEHOLDER = 'http://REPLACE_ME:8000';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.bat': 'text/plain; charset=utf-8',
  '.ps1': 'text/plain; charset=utf-8',
};

// 网页版需要的资源 + 客户端安装/更新需要的分发文件；缺一个都不启动，避免半套发布。
const PUBLIC_FILES = [
  'index.html', 'style.css', 'app.js',
  'selftest.html', 'selftest.js', 'sample.pdf',
  'office-toolbox-offline.html', 'version.json',
  'install.bat', 'install.ps1', 'update.ps1',
];
const PUBLIC_DIRS = ['lib/', 'src/'];

// 只监听输入源；构建产物（app.js / version.json / 单文件版）不在其中，避免自触发循环。
const WATCH_TARGETS = [
  'index.html', 'style.css', 'install.bat', 'install.ps1', 'update.ps1', 'src', 'lib',
];

const HELP = `用法: node server.js [选项]
  --port, -p <n>    监听端口，默认 8080，被占用时自动顺延（也可用环境变量 PORT）
  --host <addr>     监听地址，默认 0.0.0.0（也可用环境变量 HOST）
  --watch            监听源码变化并自动重建（默认开启）
  --no-watch         关闭监听
  --no-build         启动时不执行构建
  --open             监听成功后自动打开系统默认浏览器（默认关闭）
  --no-open          不自动打开浏览器
  -h, --help         显示本说明`;

function parseArgs(argv) {
  const opts = {
    port: Number(process.env.PORT || 8080),
    host: process.env.HOST || '0.0.0.0',
    watch: true,
    build: true,
    open: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '--port' || a === '-p') opts.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) opts.port = Number(a.slice(7));
    else if (a === '--host') opts.host = argv[++i];
    else if (a.startsWith('--host=')) opts.host = a.slice(7);
    else if (a === '--watch') opts.watch = true;
    else if (a === '--no-watch') opts.watch = false;
    else if (a === '--no-build') opts.build = false;
    else if (a === '--open') opts.open = true;
    else if (a === '--no-open') opts.open = false;
    else throw new Error(`未知参数: ${a}\n${HELP}`);
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    throw new Error(`端口不合法: ${opts.port}`);
  }
  if (!opts.host) throw new Error('监听地址不能为空');
  return opts;
}

function readVersion() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).version || ''; }
  catch (e) { return ''; }
}

/** 调用唯一构建器；内容未变时它不会写盘，客户端也就不会收到无意义的更新。 */
function build() {
  const before = readVersion();
  const r = spawnSync(process.execPath, [BUILDER], { cwd: ROOT, stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`构建失败（退出码 ${r.status}），请先修复源码`);
  const after = readVersion();
  if (after && after !== before) {
    console.log(`[发布] 新版本 ${after} 已生成；已安装客户端会在下次检查时自动更新。`);
  } else {
    console.log(`[发布] 当前版本 ${after || '未知'}（内容未变化，客户端无需更新）。`);
  }
  return after;
}

/** 发布前自检：清单、占位符、离线版哈希必须自洽，否则客户端安装必然失败。 */
function checkRelease() {
  for (const rel of PUBLIC_FILES) {
    if (!fs.existsSync(path.join(ROOT, rel))) throw new Error(`缺少分发文件 ${rel}，请先运行 node build_single.js`);
  }
  for (const rel of PUBLIC_DIRS) {
    if (!fs.existsSync(path.join(ROOT, rel))) throw new Error(`缺少资源目录 ${rel}`);
  }
  if (!fs.readFileSync(path.join(ROOT, 'install.bat'), 'utf8').includes(PLACEHOLDER)) {
    throw new Error('install.bat 缺少服务器地址占位符，网页无法注入本机地址');
  }
  const v = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const payload = fs.readFileSync(path.join(ROOT, 'office-toolbox-offline.html'));
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  if (hash !== v.sha256 || payload.length !== v.size) {
    throw new Error('version.json 与离线版哈希/大小不一致，请先运行 node build_single.js');
  }
  return v.version;
}

/** 源码变动后自动重建：version.json 的版本是内容哈希，变化即触发客户端更新。 */
function startWatch() {
  const watchers = [];
  let timer = null;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { build(); }
      catch (e) { console.error(`[发布] 自动构建失败：${e.message}；服务继续提供上一版本。`); }
    }, 400);
  };
  for (const rel of WATCH_TARGETS) {
    const target = path.join(ROOT, rel);
    if (!fs.existsSync(target)) continue;
    const isDir = fs.statSync(target).isDirectory();
    try {
      watchers.push(fs.watch(target, { recursive: isDir, persistent: true }, changed));
    } catch (e) {
      // 少数平台不支持递归监听时退化为目录级监听，不影响服务本身。
      try { watchers.push(fs.watch(target, { persistent: true }, changed)); }
      catch (e2) { console.warn(`[发布] 无法监听 ${rel}：${e2.message}`); }
    }
  }
  return () => { clearTimeout(timer); watchers.forEach(w => w.close()); };
}

function isPublic(rel) {
  if (PUBLIC_FILES.includes(rel)) return true;
  if (!PUBLIC_DIRS.some(dir => rel.startsWith(dir))) return false;
  return Object.prototype.hasOwnProperty.call(MIME, path.posix.extname(rel).toLowerCase());
}

function lanAddresses() {
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if ((a.family !== 'IPv4' && a.family !== 4) || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      list.push({ name, address: a.address });
    }
  }
  const rank = ip => ip.startsWith('192.168.') ? 3 : ip.startsWith('10.') ? 2 : 1;
  return list.sort((x, y) => rank(y.address) - rank(x.address) || x.name.localeCompare(y.name));
}

function printBanner(opts, version, port) {
  const lines = [
    '',
    '============================================================',
    ' 办公文件工具箱 · 局域网服务已启动',
    ` 版本:       ${version}`,
    ` 本机:       http://127.0.0.1:${port}/`,
  ];
  const addrs = lanAddresses();
  if (!addrs.length) lines.push(' 局域网:     未发现可用网卡地址，请检查网络连接');
  addrs.forEach((a, i) => {
    const label = i === 0 ? ' 局域网:    ' : '            ';
    const hint = a.name.toLowerCase().includes('virtual') || a.name.toLowerCase().includes('vethernet')
      ? '  (虚拟网卡，通常不可达)' : '';
    lines.push(`${label} http://${a.address}:${port}/   [${a.name}]${hint}`);
  });
  lines.push(
    '------------------------------------------------------------',
    ' 其他设备连同一 WiFi / 路由器，浏览器打开上面的局域网地址即可使用；',
    ' 页面内「安装到本机」下载 install.bat，装好后离线可用并自动更新。',
    opts.watch
      ? ' 源码变更会自动重建并发布新版本，已安装客户端后台自动拉取。'
      : ' 当前未监听源码变化；改完源码请运行 node build_single.js 发布更新。',
    ` 无法访问时：确认同一路由器，并在 Windows 防火墙放行 TCP ${port} 入站（专用网络）。`,
    ' 地址列表不全时可用 ipconfig 查看本机其他 IPv4，选与设备同网段的地址。',
    ' 建议固定端口（--port 或 start.bat 参数），重启后地址不变，已装客户端才能持续更新。',
    ' Ctrl+C 停止服务。',
    '============================================================',
    '',
  );
  console.log(lines.join('\n'));
  if (opts.host === '127.0.0.1' || opts.host === 'localhost' || opts.host === '::1') {
    console.warn('[警告] 当前仅监听回环地址，局域网其他设备无法访问；去掉 --host 即可改为 0.0.0.0。');
  }
}

function createServer() {
  return http.createServer((req, res) => {
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (e) { pathname = req.url; }
    console.log(`[${new Date().toTimeString().slice(0, 8)}] ${ip} ${req.method} ${pathname}`);

    const reject = (code, text, headers) => {
      res.writeHead(code, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        ...headers,
      });
      res.end(text);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reject(405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    }

    let rel = pathname.replace(/\\/g, '/').replace(/^\/+/, '');
    if (rel === '') rel = 'index.html';
    rel = path.posix.normalize(rel);
    const segments = rel.split('/');
    if (rel.includes('\0') || rel === '..' || rel.startsWith('../') ||
        segments.some(s => s.startsWith('.') || s === 'node_modules')) {
      return reject(403, 'Forbidden');
    }
    if (!isPublic(rel)) return reject(404, 'Not Found');

    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep)) return reject(403, 'Forbidden');
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return reject(404, 'Not Found');
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  });
}

/** 用系统默认浏览器打开页面；URL 仅由本机地址与实际端口拼成，失败不影响服务。 */
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, err => {
    if (err) console.warn(`[浏览器] 自动打开失败：${err.message}；请手动访问 ${url}`);
    else console.log(`[浏览器] 已自动打开 ${url}`);
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.build) build();
  const version = checkRelease();
  const server = createServer();
  const stopWatch = opts.watch ? startWatch() : () => {};

  // 8000 常被微信等程序占用；自动顺延可保证双击启动总能成功，横幅打印实际端口。
  let tried = 0;
  const MAX_PORT_TRIES = 10;
  server.on('error', e => {
    if (e.code === 'EADDRINUSE' && tried < MAX_PORT_TRIES - 1) {
      const next = opts.port + ++tried;
      console.warn(`[端口] ${next - 1} 已被占用，自动改用 ${next} ...`);
      server.listen(next, opts.host);
      return;
    }
    if (e.code === 'EADDRINUSE') {
      console.error(`端口 ${opts.port} ~ ${opts.port + MAX_PORT_TRIES - 1} 均被占用；请指定其他端口：node server.js --port 9000`);
    } else {
      console.error(`服务启动失败：${e.message}`);
    }
    stopWatch();
    process.exit(1);
  });
  let opened = false;
  server.on('listening', () => {
    const port = server.address().port;
    printBanner(opts, version, port);
    if (opts.open && !opened) {
      opened = true;
      const host = opts.host === '0.0.0.0' || opts.host === '::' ? '127.0.0.1'
        : opts.host.includes(':') ? `[${opts.host}]` : opts.host;
      openBrowser(`http://${host}:${port}/`);
    }
  });
  server.listen(opts.port, opts.host);

  const shutdown = () => {
    stopWatch();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

try { main(); }
catch (e) { console.error(`启动失败：${e.message}`); process.exit(1); }
