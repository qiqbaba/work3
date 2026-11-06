/**
 * 票据识别工作台端到端实测：用 PyWork2 的真实发票 PDF 与序时簿 .xls，
 * 在真实浏览器里按迁移后的四页 UI 验证二维码解码、本地解析、排序、重命名、
 * 合成 PDF、导出 Excel，并分别在生产页与离线单文件版走一遍完整交互。
 *
 *   node .codebuddy/run_bill_e2e.mjs [样本目录]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const SAMPLES = path.resolve(process.argv[2] || 'D:/programme/PyWork2/test_doc');
const require = createRequire(import.meta.url);
const playwright = require('playwright');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf', '.png': 'image/png', '.xls': 'application/vnd.ms-excel',
};

// 测试页与生产页共用同一份 app.js / DOM，只额外打开测试钩子、不加载 selftest.js
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('  <script src="./app.js"></script>',
    '  <script>window.__ENABLE_TEST_HOOKS__ = true;</script>\n  <script src="./app.js"></script>');

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/bill-e2e.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    return res.end(indexHtml);
  }
  const file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const invoiceDir = path.join(SAMPLES, 'invoice');
const pdfNames = fs.readdirSync(invoiceDir).filter(n => /\.pdf$/i.test(n) && !n.includes('发票合并')).slice(0, 4);
if (pdfNames.length < 3) throw new Error('样本发票 PDF 不足 3 个：' + invoiceDir);
const xlsName = fs.readdirSync(SAMPLES).find(n => /\.xls$/i.test(n));
if (!xlsName) throw new Error('缺少序时簿 .xls：' + SAMPLES);
const payload = {
  pdfs: pdfNames.map(n => ({ name: n, b64: fs.readFileSync(path.join(invoiceDir, n)).toString('base64') })),
  xls: { name: xlsName, b64: fs.readFileSync(path.join(SAMPLES, xlsName)).toString('base64') },
};

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] });

/* ---------------- 1. 工作台核心功能（测试钩子页 + 真实样本） ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message)));
  await page.goto(`http://127.0.0.1:${port}/bill-e2e.html`, { waitUntil: 'load' });
  const result = await page.evaluate(async data => {
    const mk = ({ name, b64 }) => {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new File([bytes], name, { type: /\.pdf$/i.test(name) ? 'application/pdf' : 'application/vnd.ms-excel' });
    };
    const T = window.__test;
    const el = id => document.getElementById('bill-' + id);
    const pdfs = data.pdfs.map(mk);
    const xls = mk(data.xls);
    const out = { libs: { jsQR: typeof jsQR, pdfjsLib: typeof pdfjsLib, PDFLib: typeof PDFLib }, tools: T.TOOLS.length };

    T.billApp.open();
    out.navCount = document.querySelectorAll('.bill-nav-item').length;
    out.pageIds = Array.from(document.querySelectorAll('.bill-page'), e => e.id);
    T.billCacheClear();

    // 真实数电票二维码解码
    const records = [];
    for (const f of pdfs) records.push(await T.billBuildRecord(f, { useQr: true, useCache: false }));
    out.records = records.map(r => ({
      name: r.file_name, number: r.invoice_number, amount: r.amount, date: r.invoice_date,
      status: r.status, from_qr: r.from_qr, qr_text: r.qr_text, check_code: r.qr_check_code,
      buyer: r.buyer, seller: r.seller, tax: r.tax_amount,
    }));

    // 发票管理页：扫描 → 本地解析 → 表格 / 汇总
    T.billApp.showPage('invoice');
    T.billApp.scanFiles(pdfs, '真实发票样本');
    await T.billApp.parseLocal();
    const tableRecords = T.billApp.state.invoice.records;
    out.table = {
      count: tableRecords.length,
      rows: document.querySelectorAll('#bill-invoice-table-body tr').length,
      status: document.getElementById('bill-invoice-status').textContent,
      summary: document.getElementById('bill-invoice-summary').textContent,
      firstRow: (document.querySelector('#bill-invoice-table-body tr') || {}).textContent || '',
    };
    const xlsx = await T.billRecordsToXlsx(tableRecords);
    const pz = await JSZip.loadAsync(await xlsx.arrayBuffer());
    out.xlsx = {
      sheets: Object.keys(pz.files).filter(n => /xl\/worksheets\/sheet\d+\.xml$/.test(n)).length,
      sheet2: (await pz.file('xl/worksheets/sheet2.xml').async('string')).slice(0, 4000),
    };

    // 序时簿导入（真实 .xls）
    const imported = await T.billImportOrder(xls, 20);
    out.imported = { count: imported.numbers.length, selected: imported.selected, first: imported.numbers.slice(0, 2) };
    await T.billApp.importOrder(xls);
    const orderText = el('invoice-custom-order').value;
    out.order = {
      count: orderText.split(/\r?\n/).filter(Boolean).length,
      source: el('invoice-order-source').textContent,
      sortMode: el('invoice-sort-mode').value,
    };

    // 按指定号码倒序排序
    const nums = tableRecords.map(r => r.invoice_number).filter(Boolean);
    const wanted = nums.slice(0, 3).reverse();
    el('invoice-sort-mode').value = 'custom';
    el('invoice-custom-order').value = wanted.join('\n');
    T.billApp.sort();
    out.sortedNumbers = T.billApp.state.invoice.records.map(r => r.invoice_number);
    out.sortNotice = el('invoice-sort-notice-text').textContent;

    // 命名预览 + 重命名副本 ZIP
    el('invoice-prefix').value = '发票';
    el('invoice-start').value = '1';
    el('invoice-digits').value = '3';
    el('invoice-name-template').value = '{前缀}{序号}_{发票号码}_{金额}';
    T.billApp.refreshPreview();
    out.preview = T.billApp.state.invoice.preview.slice();
    const plan = T.billBuildRenamePlan(T.billApp.state.invoice.records, {
      prefix: '发票', start: 1, digits: 3, template: '{前缀}{序号}_{发票号码}_{金额}',
    });
    const rz = await JSZip.loadAsync(await (await T.billRenamedZip(plan, '重命名报告')).arrayBuffer());
    out.renamedNames = Object.keys(rz.files);

    // 按当前表格顺序合成 PDF
    const merged = await T.billMergeRecordsToPdf(T.billApp.state.invoice.records.slice(0, 3));
    out.mergedPages = (await PDFLib.PDFDocument.load(await merged.blob.arrayBuffer())).getPageCount();
    out.mergedNames = merged.merged;

    // 银行回单页
    T.billApp.showPage('bank');
    el('ocr-json').value = '';
    el('bank-ocr-json').value = '';
    T.billApp.setBillFiles('bank_slip', pdfs.slice(0, 1));
    await T.billApp.recognizeBills('bank_slip');
    out.billResults = T.billApp.state.bills.bank_slip.results.map(r => ({ ok: r.ok, items: r.items.length, amount: r.amount }));

    // 系统设置页
    T.billApp.showPage('settings');
    out.settings = {
      title: el('page-title').textContent,
      hasSecret: !!el('secret-id'), hasOcrJson: !!el('ocr-json'),
    };
    return out;
  }, payload);

  check(result.libs.jsQR === 'function', 'jsQR 未加载');
  check(result.tools === 79, '工具总数应为 79，实际 ' + result.tools);
  check(result.navCount === 4 && result.pageIds.length === 4, '工作台应有 4 个导航项 / 4 个页面：' + JSON.stringify(result.pageIds));
  check(result.records.length >= 3, '真实发票解析数量不足');
  for (const r of result.records) {
    check(r.from_qr === true, `${r.name}：二维码未解码成功`);
    check(/^\d{20}$/.test(r.number || ''), `${r.name}：未取得 20 位发票号码（${r.number}）`);
    check(Number.isFinite(r.amount) && r.amount !== 0, `${r.name}：未取得金额（${r.amount}）`);
    check(!!r.date && !!r.check_code, `${r.name}：未取得开票日期或校验码`);
    check(r.status === '本地解析', `${r.name}：状态异常 ${r.status}`);
    const m = (r.qr_text || '').split(',');
    if (m.length > 4) check(Math.abs(parseFloat(m[4]) - r.amount) < 0.005, `${r.name}：金额与二维码不一致`);
  }
  check(result.table.count === result.records.length && result.table.rows === result.records.length,
    `工作台表格行数异常：${JSON.stringify(result.table)}`);
  check(result.table.status.includes('完成'), '本地解析状态未显示完成：' + result.table.status);
  check(result.table.summary.includes('合计 ¥'), '汇总缺少合计金额：' + result.table.summary);
  check(result.xlsx.sheets === 2 && result.xlsx.sheet2.includes(result.records[0].number), '导出的发票信息.xlsx 缺少明细 / 号码');
  check(result.imported.count >= 200, '序时簿导入数量异常：' + result.imported.count);
  check(result.order.count >= 200 && result.order.sortMode === 'custom', '工作台未导入序时簿号码：' + JSON.stringify(result.order));
  const expectedOrder = result.records.slice(0, 3).map(r => r.number).reverse();
  check(expectedOrder.every((n, i) => result.sortedNumbers[i] === n),
    '排序结果顺序不符：' + JSON.stringify(result.sortedNumbers));
  check(result.sortNotice.includes('匹配'), '缺少排序核对提示');
  check(result.preview.length === result.records.length && result.preview[0].includes(expectedOrder[0]), '命名预览异常：' + JSON.stringify(result.preview));
  check(result.renamedNames.length === 5 && result.renamedNames.some(n => n.includes(expectedOrder[0])),
    '重命名副本异常：' + JSON.stringify(result.renamedNames));
  check(result.mergedPages === 3, '合成 PDF 页数应为 3，实际 ' + result.mergedPages);
  check(result.mergedNames[0].includes(expectedOrder[0]), '合成顺序与排序不一致');
  check(result.billResults.length === 1 && result.billResults[0].ok, '银行回单页识别失败');
  check(result.settings.title === '系统设置' && result.settings.hasSecret && result.settings.hasOcrJson, '系统设置页缺失');
  check(pageErrors.length === 0, '页面脚本异常：' + pageErrors.join(' | '));
  console.log('[工作台] 样本记录:', JSON.stringify(result.records.map(r => ({ n: r.number, a: r.amount, qr: r.from_qr }))));
  console.log('[工作台] 表格:', result.table.rows, '行 /', result.table.summary, '序时簿:', result.order.count, '个号码');
  console.log('[工作台] 排序:', result.sortedNumbers.slice(0, 3), '预览:', result.preview.slice(0, 2), '合成页数:', result.mergedPages);
  await page.close();
}

/* ---------------- 2. 生产页 / 离线单文件版 UI 实测 ---------------- */
async function uiFlow(url, label) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [], warnings = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('requestfailed', r => {
    // file:// 下 blob:null worker 会被 Chromium 拒绝，pdf.js 回退到主线程 worker
    if (r.url().startsWith('blob:null/')) warnings.push('worker ' + r.url().slice(0, 40));
    else errors.push('FAILED ' + r.url());
  });
  await page.goto(url, { waitUntil: 'load' });
  const info = await page.evaluate(async data => {
    const mk = ({ name, b64 }) => {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new File([bytes], name, { type: 'application/pdf' });
    };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const el = id => document.getElementById('bill-' + id);
    const info = {
      cards: document.querySelectorAll('#toolGrid .tool-card').length,
      libs: { jsQR: typeof jsQR, PDFLib: typeof PDFLib, pdfjsLib: typeof pdfjsLib, JSZip: typeof JSZip },
      alerts: [], errors: [],
    };
    window.alert = m => info.alerts.push(String(m));
    // 与测试钩子页共享 localStorage 时清掉缓存，确保「本地解析」按钮可用
    try { localStorage.removeItem('pdf2png.billCache.v1'); } catch (e) { /* file:// 可能禁用存储 */ }
    const captured = [];
    const createUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = b => { captured.push(b); return createUrl(b); };
    try {
      // PDF.js 渲染能力（二维码解码依赖）
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await mk(data.pdfs[0]).arrayBuffer()) }).promise;
      const pg = await doc.getPage(1);
      const vp = pg.getViewport({ scale: 1 });
      const cv = document.createElement('canvas');
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      info.renderOk = cv.width > 100 && cv.height > 100;

      // 点击顶部「票据识别」导航直接进入工作台，切到发票管理页
      const nav = document.querySelector('#headerNav [data-cat="bill"]');
      if (!nav) throw new Error('未找到「票据识别」导航');
      nav.click();
      info.appActive = document.body.classList.contains('bill-app-active');
      info.navCount = document.querySelectorAll('.bill-nav-item').length;
      document.querySelector('.bill-nav-item[data-bill-page="invoice"]').click();
      info.invoicePageActive = el('page-invoice').classList.contains('active');

      // 通过页面的文件输入框载入真实发票
      const dt = new DataTransfer();
      dt.items.add(mk(data.pdfs[0]));
      const input = el('invoice-files-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      info.pathText = el('invoice-folder-path').textContent;
      el('invoice-local-parse').click();
      const t0 = Date.now();
      while (Date.now() - t0 < 90000) {
        if (el('invoice-status').textContent.includes('完成') || info.alerts.length) break;
        await sleep(120);
      }
      info.status = el('invoice-status').textContent;
      info.rows = document.querySelectorAll('#bill-invoice-table-body tr').length;
      info.rowText = (document.querySelector('#bill-invoice-table-body tr') || {}).textContent || '';
      info.summary = el('invoice-summary').textContent;

      // 点击「导出 Excel」并校验下载内容
      el('invoice-export').click();
      await sleep(900);
      const last = captured[captured.length - 1];
      if (last) {
        const zip = await JSZip.loadAsync(await last.arrayBuffer());
        const sheet2 = zip.file('xl/worksheets/sheet2.xml');
        info.exportHasNumber = sheet2 ? (await sheet2.async('string')).includes((data.pdfs[0].name.match(/\d{20}/) || [''])[0]) : false;
      }

      // 返回工具箱
      el('back-btn').click();
      info.backOk = !document.body.classList.contains('bill-app-active') && !document.getElementById('homeView').hidden;
    } catch (e) { info.errors.push(e && e.message ? e.message : String(e)); }
    return info;
  }, payload);
  check(info.cards === 79, `${label} 工具卡数量=${info.cards}`);
  check(info.libs.jsQR === 'function', `${label} jsQR 未加载`);
  check(info.renderOk === true, `${label} PDF.js 页面渲染失败（二维码解码依赖它）`);
  check(info.appActive === true && info.navCount === 4 && info.invoicePageActive === true,
    `${label} 工作台 / 四页导航异常：${JSON.stringify(info)}`);
  check(info.rows === 1, `${label} 发票表格未渲染：${info.rows}`);
  const firstNumber = (pdfNames[0].match(/\d{20}/) || [''])[0];
  check(info.rowText.includes(firstNumber), `${label} 表格行缺少真实发票号码：${info.rowText.slice(0, 160)}`);
  check(info.summary.includes('合计 ¥'), `${label} 汇总异常：${info.summary}`);
  check(info.status.includes('完成'), `${label} 本地解析未完成：${info.status}`);
  check(info.exportHasNumber === true, `${label} 导出 Excel 缺少发票号码`);
  check(info.backOk === true, `${label} 返回工具箱失败`);
  check(info.alerts.length === 0, `${label} 出现错误提示：${info.alerts.join(' | ')}`);
  check(info.errors.length === 0, `${label} 流程异常：${info.errors.join(' | ')}`);
  check(errors.length === 0, `${label} 页面错误：${errors.join(' | ')}`);
  console.log(`[${label}] 卡片=${info.cards} 工作台=${info.appActive} 表格=${info.rows} 导出=${info.exportHasNumber} 返回=${info.backOk}${warnings.length ? ' 已知环境警告=' + warnings.length : ''}`);
  await page.close();
}
await uiFlow(`http://127.0.0.1:${port}/index.html`, '生产页');
await uiFlow('file:///' + path.join(ROOT, 'office-toolbox-offline.html').replace(/\\/g, '/'), '离线单文件版');

await browser.close();
server.close();
const report = { generatedAt: new Date().toISOString(), samples: SAMPLES, ok: failures.length === 0, failures };
fs.writeFileSync(path.join(ROOT, '.codebuddy', 'bill-e2e-results.json'), JSON.stringify(report, null, 2));
console.log('E2E FAILURES:', failures.length);
failures.forEach(f => console.log('  - ' + f));
console.log('RESULT FILE:', path.join(ROOT, '.codebuddy', 'bill-e2e-results.json'));
if (failures.length) process.exitCode = 1;
