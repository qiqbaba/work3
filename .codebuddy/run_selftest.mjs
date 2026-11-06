import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

/** Playwright 可通过环境变量或本地 node_modules 解析，不再硬编码某台机器的绝对路径。 */
function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_CORE) candidates.push(process.env.PLAYWRIGHT_CORE);
  candidates.push('playwright', 'playwright-core');
  for (const c of candidates) {
    try {
      const mod = require(c);
      if (mod && mod.chromium) return mod;
    } catch (e) { /* try next */ }
  }
  throw new Error('找不到 Playwright：请执行 npm install，或设置 PLAYWRIGHT_CORE=<playwright-core 路径>');
}

function gitHash() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch (e) { return null; }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.bat': 'text/plain; charset=utf-8', '.ps1': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const target = process.argv[2] || 'selftest.html';
const outFile = path.join(ROOT, '.codebuddy', process.argv[3] || 'selftest-results-run.json');

const playwright = loadPlaywright();
const launchOptions = { headless: true, args: ['--no-sandbox'] };
if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;
const browser = await playwright.chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const consoleErrors = [];
const badRequests = [];
page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + (e.stack || e.message)));
page.on('console', async m => {
  if (m.type() !== 'error') return;
  let where = '';
  try { where = await page.evaluate(() => (document.querySelector('#selftestPanel h2') || {}).textContent || ''); } catch (e) { /* ignore */ }
  consoleErrors.push('CONSOLE[' + where + ']: ' + m.text());
});
page.on('requestfailed', r => badRequests.push('FAILED ' + r.url() + ' :: ' + (r.failure()?.errorText || '')));
page.on('response', r => { if (r.status() >= 400) badRequests.push('HTTP ' + r.status() + ' ' + r.url()); });
await page.goto(`http://127.0.0.1:${port}/${target}`, { waitUntil: 'load' });

let result;
let timedOut = false;
if (target === 'selftest.html') {
  try {
    await page.waitForFunction(() => window.__selftestDone === true, null, { timeout: 15 * 60 * 1000, polling: 250 });
  } catch (e) {
    timedOut = true;
    console.log('TIMEOUT waiting for selftest to finish');
  }
  result = await page.evaluate(() => ({
    summary: window.__selftestSummary || 'NO SUMMARY',
    lines: window.__selftestLines || [],
    tools: window.__test ? window.__test.TOOLS.map(t => ({ id: t.id, name: t.name, cat: t.cat, accept: t.accept, minFiles: t.minFiles, maxFiles: t.maxFiles, options: (t.options || []).map(o => ({ key: o.key, type: o.type, def: o.def, min: o.min, max: o.max })) })) : [],
  }));
} else {
  // 冒烟：验证正式页 / 单文件构建产物可加载第三方库、渲染工具卡并完成一次真实处理
  result = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const info = {
      cards: document.querySelectorAll('#toolGrid .tool-card').length,
      libs: { PDFLib: typeof PDFLib, pdfjsLib: typeof pdfjsLib, JSZip: typeof JSZip, jsQR: typeof jsQR },
      workerSrc: (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) ? String(pdfjsLib.GlobalWorkerOptions.workerSrc || '').slice(0, 60) : '',
      errors: [],
    };
    try {
      if (typeof jsQR !== 'function') info.errors.push('jsQR 二维码解码库未加载');
      const doc1 = await PDFLib.PDFDocument.create();
      doc1.addPage([200, 300]).drawText('SMOKE-A', { x: 20, y: 200, size: 14 });
      const doc2 = await PDFLib.PDFDocument.create();
      doc2.addPage([200, 300]).drawText('SMOKE-B', { x: 20, y: 200, size: 14 });
      const mk = async (d, n) => new File([await d.save()], n, { type: 'application/pdf' });
      const cards = Array.from(document.querySelectorAll('#toolGrid .tool-card'));
      const card = cards.find(c => c.querySelector('.tool-name') && c.querySelector('.tool-name').textContent === 'PDF 合并');
      if (!card) throw new Error('未找到 PDF 合并 工具卡');
      card.click();
      const dt = new DataTransfer();
      dt.items.add(await mk(doc1, 'a.pdf'));
      dt.items.add(await mk(doc2, 'b.pdf'));
      const ev = new Event('drop', { bubbles: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      document.getElementById('wsDropzone').dispatchEvent(ev);
      const alerts = [];
      const old = window.alert;
      window.alert = m => alerts.push(String(m));
      document.getElementById('wsRunBtn').click();
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) {
        if (!document.getElementById('wsResultsSection').hidden || alerts.length) break;
        await sleep(100);
      }
      window.alert = old;
      info.alerts = alerts;
      info.resultsHidden = document.getElementById('wsResultsSection').hidden;
      info.resultCount = document.getElementById('wsResultsGrid').querySelectorAll('.preview-card').length;
      if (info.resultsHidden) info.errors.push('处理结果未生成: ' + JSON.stringify(alerts));
      else if (info.resultCount !== 1) info.errors.push('结果数量异常: ' + info.resultCount);
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await (await mk(doc1, 'w.pdf')).arrayBuffer()) }).promise;
      const pg = await pdf.getPage(1);
      const vp = pg.getViewport({ scale: 1 });
      const cv = document.createElement('canvas');
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      info.renderOk = cv.width === 200 && cv.height === 300;
      if (!info.renderOk) info.errors.push('PDF.js 渲染失败');
    } catch (e) {
      info.errors.push(e && e.message ? e.message : String(e));
    }
    return info;
  });
}

const failures = [];
if (timedOut) failures.push('TIMEOUT: 自检未在 15 分钟内完成');
if (target === 'selftest.html') {
  const lines = result.lines || [];
  if (!lines.length) failures.push('NO TEST CASES: 未收集到任何用例');
  for (const l of lines) if (l.status !== 'PASS') failures.push('CASE: ' + l.name + ' | ' + l.detail);
  if (!/FAIL=0/.test(result.summary || '')) failures.push('SUMMARY: ' + result.summary);
} else {
  for (const e of (result.errors || [])) failures.push('SMOKE: ' + e);
  // 工具会持续新增，只校验已集成的工具集仍然完整渲染（基线 79 项）
  if (result.cards < 79) failures.push('SMOKE: 工具卡数量=' + result.cards);
  if (result.renderOk !== true) failures.push('SMOKE: PDF.js 渲染失败');
  if (result.resultCount !== 1) failures.push('SMOKE: 结果数量=' + result.resultCount);
}
for (const e of consoleErrors) failures.push('PAGE ERROR: ' + e.slice(0, 240));
for (const e of badRequests) failures.push('BAD REQUEST: ' + e.slice(0, 240));

const all = {
  schemaVersion: 2,
  target,
  generatedAt: new Date().toISOString(),
  gitHash: gitHash(),
  ...result,
  consoleErrors,
  badRequests,
  timedOut,
  ok: failures.length === 0,
  failures,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(all, null, 2));

if (target === 'selftest.html') {
  console.log('SUMMARY:', result.summary);
} else {
  console.log('SMOKE:', JSON.stringify({ cards: result.cards, libs: result.libs, workerSrc: result.workerSrc, resultCount: result.resultCount, renderOk: result.renderOk, errors: result.errors, alerts: result.alerts }));
}
console.log('PAGE ERRORS:', consoleErrors.length);
console.log('BAD REQUESTS:', badRequests.length);
console.log('FAILURES:', failures.length);
for (const f of failures.slice(0, 20)) console.log('  - ' + f);
console.log('RESULT FILE:', outFile);

await browser.close();
server.close();
if (failures.length) process.exitCode = 1;
