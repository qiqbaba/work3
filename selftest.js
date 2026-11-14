/**
 * selftest.js - 功能自动化测试（测试后可删除）
 * 在浏览器中逐项调用 app.js 暴露的工具函数并校验输出。
 */
(async function () {
  'use strict';
  const T = window.__test;
  const rows = [];
  const $ = id => document.getElementById(id);

  function assert(cond, msg) { if (!cond) throw new Error('断言失败: ' + msg); }
  function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`); }
  function arrEq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`); }

  /* ---------- 固定测试数据 ---------- */
  async function fetchFile(url, name, type) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('fetch 失败 ' + url);
    return new File([await r.arrayBuffer()], name, { type });
  }
  async function makeImageFile(fmt, w, h, name) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.fillStyle = '#3366cc'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#cc3333'; c.fillRect(w * 0.2, h * 0.2, w * 0.3, h * 0.3);
    c.fillStyle = '#ffffff'; c.font = '24px sans-serif'; c.fillText('TEST ' + name, 16, h - 16);
    const blob = await new Promise(res => cv.toBlob(res, fmt, 0.9));
    return new File([blob], name, { type: fmt });
  }
  async function makePdfFile(name, texts) {
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    for (const t of texts) {
      const page = doc.addPage([400, 600]);
      if (t) {
        t.split('\n').forEach((line, li) => {
          page.drawText(line, { x: 40, y: 520 - li * 30, size: 22, font });
        });
      }
    }
    return new File([await doc.save()], name, { type: 'application/pdf' });
  }
  async function makeLandscapePdf(name) {
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const page = doc.addPage([600, 400]);
    page.drawText('LEFT-HALF', { x: 40, y: 200, size: 20, font });
    page.drawText('RIGHT-HALF', { x: 340, y: 200, size: 20, font });
    return new File([await doc.save()], name, { type: 'application/pdf' });
  }
  async function makeRotatedTextPdf(name) {
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const page = doc.addPage([400, 600]);
    page.drawText('ROTATED-LINE-ONE', { x: 60, y: 100, size: 22, font, rotate: PDFLib.degrees(90) });
    return new File([await doc.save()], name, { type: 'application/pdf' });
  }
  async function makeImagePdf(name, imgFile) {
    const doc = await PDFLib.PDFDocument.create();
    const img = await doc.embedPng(await imgFile.arrayBuffer());
    const page = doc.addPage([400, 600]);
    page.drawImage(img, { x: 50, y: 200, width: 300, height: 180 });
    return new File([await doc.save()], name, { type: 'application/pdf' });
  }
  async function makeAttachmentPdf(name) {
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    doc.addPage([400, 600]).drawText('DOC-WITH-ATTACHMENT', { x: 40, y: 520, size: 22, font });
    await doc.attach(new TextEncoder().encode('hello attachment'), 'hello.txt', { mimeType: 'text/plain' });
    return new File([await doc.save()], name, { type: 'application/pdf' });
  }

  async function pdfInfo(blob) {
    const doc = await PDFLib.PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
    return {
      pages: doc.getPageCount(),
      title: doc.getTitle() || '',
      sizes: doc.getPageIndices().map(i => { const s = doc.getPage(i).getSize(); return [Math.round(s.width), Math.round(s.height)]; }),
      rotations: doc.getPageIndices().map(i => doc.getPage(i).getRotation().angle || 0),
    };
  }
  async function imgInfo(blob) {
    const bmp = await createImageBitmap(blob);
    return { w: bmp.width, h: bmp.height };
  }
  async function blobCanvas(blob) {
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    return cv;
  }
  async function pageTexts(blob) {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      out.push(tc.items.map(it => it.str).join(' ').trim());
    }
    return out;
  }

  async function runTool(id, files, optOverrides) {
    const tool = T.TOOLS.find(t => t.id === id);
    if (!tool) throw new Error('工具不存在: ' + id);
    const opts = {};
    for (const o of (tool.options || [])) opts[o.key] = (o.type === 'file') ? null : o.def;
    if (optOverrides) Object.assign(opts, optOverrides);
    const ctx = { files, get: k => opts[k], progress: () => { } };
    return await tool.run(ctx);
  }

  /* ---------- 测试用例 ---------- */
  const samplePdf = () => fetchFile('./sample.pdf', 'sample.pdf', 'application/pdf');

  const tests = [];
  const t = (name, fn) => tests.push({ name, fn });

  /* --- 纯函数单元测试 --- */
  t('纯函数: parsePageRanges 基本解析', () => {
    arrEq(T.parsePageRanges('1-3, 5', 6), [1, 2, 3, 5], '范围解析');
    arrEq(T.parsePageRanges('', 3), [1, 2, 3], '空串=全部');
    arrEq(T.parsePageRanges('2', 3), [2], '单页');
  });
  t('纯函数: parsePageRanges 越界与非法输入', () => {
    let threw = false;
    try { T.parsePageRanges('9', 3); } catch (e) { threw = true; }
    assert(threw, '越界应抛错');
    threw = false;
    try { T.parsePageRanges('3-1', 5); } catch (e) { threw = true; }
    assert(threw, '倒序范围应抛错');
  });
  t('纯函数: parseRangeGroups 分组', () => {
    const g = T.parseRangeGroups('1-2; 3', 4);
    arrEq(g, [[1, 2], [3]], '分组解析');
  });
  t('纯函数: bookletOrder 顺序', () => {
    arrEq(T.bookletOrder(8), [7, 0, 1, 6, 5, 2, 3,4], '8页小册子顺序');
    arrEq(T.bookletOrder(4), [3, 0, 1, 2], '4页小册子顺序');
    arrEq(T.bookletOrder(5), [-1, 0, 1, -1, -1, 2, 3, 4], '5页补白顺序');
  });
  t('纯函数: diffLines 差异', () => {
    const ops = T.diffLines(['a', 'b', 'c'], ['a', 'x', 'c']);
    const sig = ops.map(o => o.t).join('');
    assert(sig.includes('+') && sig.includes('-') && sig.includes('='), '应含增删同');
    assert(T.diffLines(new Array(2600).fill('x'), ['x']) === null, '超大规模应返回 null');
  });
  t('纯函数: formatBytes / sanitizeFileName / escapeHtml', () => {
    eq(T.formatBytes(0), '0 B', '0字节');
    eq(T.formatBytes(1024), '1 KB', '1KB');
    eq(T.sanitizeFileName('a/b:*c'), 'a_b__c', '非法字符替换');
    eq(T.escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;', 'HTML转义');
  });

  /* --- PDF 处理 --- */
  t('pdf-merge 合并页数正确', async () => {
    const f1 = await makePdfFile('m1.pdf', ['P1', 'P2']);
    const f2 = await makePdfFile('m2.pdf', ['P3']);
    const r = await runTool('pdf-merge', [f1, f2]);
    eq(r.length, 1, '输出文件数');
    const info = await pdfInfo(r[0].blob);
    eq(info.pages, 3, '合并后页数');
  });
  t('pdf-split 每页拆分', async () => {
    const f = await makePdfFile('s.pdf', ['P1', 'P2', 'P3']);
    const r = await runTool('pdf-split', [f], { mode: 'each' });
    eq(r.length, 3, '拆分文件数');
    const txts = await pageTexts(r[1].blob);
    eq(txts[0], 'P2', '第2个文件内容应为 P2');
  });
  t('pdf-split 按范围分组', async () => {
    const f = await makePdfFile('s.pdf', ['P1', 'P2', 'P3', 'P4']);
    const r = await runTool('pdf-split', [f], { mode: 'ranges', groups: '1-2; 3' });
    eq(r.length, 2, '分组数');
    eq((await pdfInfo(r[0].blob)).pages, 2, '第一组页数');
  });
  t('pdf-split 奇偶页', async () => {
    const f = await makePdfFile('s.pdf', ['P1', 'P2', 'P3', 'P4']);
    const r = await runTool('pdf-split', [f], { mode: 'oddeven' });
    eq(r.length, 2, '奇偶文件数');
    const oddTxt = await pageTexts(r[0].blob);
    arrEq(oddTxt, ['P1', 'P3'], '奇数页内容');
  });
  t('pdf-pages 提取页面', async () => {
    const f = await makePdfFile('p.pdf', ['P1', 'P2', 'P3', 'P4']);
    const r = await runTool('pdf-pages', [f], { mode: 'extract', range: '2-3' });
    const txts = await pageTexts(r[0].blob);
    arrEq(txts, ['P2', 'P3'], '提取内容');
  });
  t('pdf-pages 删除页面', async () => {
    const f = await makePdfFile('p.pdf', ['P1', 'P2', 'P3', 'P4']);
    const r = await runTool('pdf-pages', [f], { mode: 'delete', range: '1, 3' });
    const txts = await pageTexts(r[0].blob);
    arrEq(txts, ['P2', 'P4'], '删除后内容');
  });
  t('pdf-pages 删除全部页面应报错', async () => {
    const f = await makePdfFile('p.pdf', ['P1']);
    let threw = false;
    try { await runTool('pdf-pages', [f], { mode: 'delete', range: '1' }); } catch (e) { threw = true; }
    assert(threw, '应抛出结果为空错误');
  });
  t('pdf-rotate 旋转角度写入', async () => {
    const f = await makePdfFile('r.pdf', ['P1', 'P2']);
    const r = await runTool('pdf-rotate', [f], { angle: '90', range: '' });
    const info = await pdfInfo(r[0].blob);
    arrEq(info.rotations, [90, 90], '旋转角');
  });
  t('pdf-pagenum 添加页码', async () => {
    const f = await makePdfFile('n.pdf', ['P1', 'P2']);
    const r = await runTool('pdf-pagenum', [f]);
    eq(r.length, 1, '输出');
    eq((await pdfInfo(r[0].blob)).pages, 2, '页数不变');
  });
  t('pdf-textwm 文字水印', async () => {
    const f = await makePdfFile('w.pdf', ['P1']);
    const r = await runTool('pdf-textwm', [f], { text: '机密资料', mode: 'tile' });
    eq((await pdfInfo(r[0].blob)).pages, 1, '输出页数');
  });
  t('pdf-textwm 空水印文字应报错', async () => {
    const f = await makePdfFile('w.pdf', ['P1']);
    let threw = false;
    try { await runTool('pdf-textwm', [f], { text: '  ' }); } catch (e) { threw = true; }
    assert(threw, '应报错');
  });
  t('pdf-imgwm 骑缝章模式', async () => {
    const f = await makePdfFile('s.pdf', ['P1', 'P2', 'P3']);
    const seal = await makeImageFile('image/png', 200, 200, 'seal.png');
    const r = await runTool('pdf-imgwm', [f], { seal, mode: 'seal' });
    eq((await pdfInfo(r[0].blob)).pages, 3, '输出页数');
  });
  t('pdf-imgwm 未选图片应报错', async () => {
    const f = await makePdfFile('s.pdf', ['P1']);
    let threw = false;
    try { await runTool('pdf-imgwm', [f], { seal: null }); } catch (e) { threw = true; }
    assert(threw, '应报错');
  });
  t('pdf-compress 压缩输出', async () => {
    const f = await samplePdf();
    const r = await runTool('pdf-compress', [f], { level: 'heavy' });
    eq(r.length, 1, '输出数');
    assert(r[0].meta && r[0].meta.includes('→'), '应含体积对比 meta');
    assert((await pdfInfo(r[0].blob)).pages > 0, '页数>0');
  });
  t('pdf-blank 空白页检测与移除', async () => {
    const f = await makePdfFile('b.pdf', ['TEXT-PAGE-ONE-LINE-A\nLINE-B\nLINE-C', '', 'TEXT-PAGE-THREE-A\nLINE-B\nLINE-C']);
    const r = await runTool('pdf-blank', [f], { threshold: 0.15, mode: 'remove' });
    const report = r.find(x => x.name.includes('报告'));
    assert(report, '应有报告');
    const txt = await report.blob.text();
    assert(txt.includes('2'), '报告应列出第2页为空白');
    const cleaned = r.find(x => x.name.includes('去空白页'));
    assert(cleaned, '应有去空白页 PDF');
    eq((await pdfInfo(cleaned.blob)).pages, 2, '移除后页数');
  });
  t('pdf-spread 对开页左右拆分', async () => {
    const f = await makeLandscapePdf('sp.pdf');
    const r = await runTool('pdf-spread', [f], { direction: 'lr' });
    const info = await pdfInfo(r[0].blob);
    eq(info.pages, 2, '拆分后页数');
    arrEq(info.sizes, [[300, 400], [300, 400]], '半页尺寸');
    const txts = await pageTexts(r[0].blob);
    assert(txts[0].includes('LEFT') && txts[1].includes('RIGHT'), '左右内容顺序');
  });
  t('pdf-nup 2合1拼版', async () => {
    const f = await makePdfFile('u.pdf', ['P1', 'P2', 'P3']);
    const r = await runTool('pdf-nup', [f], { layout: '2', gap: 8 });
    eq((await pdfInfo(r[0].blob)).pages, 2, '拼版页数');
  });
  t('pdf-nup 4合1拼版', async () => {
    const f = await makePdfFile('u.pdf', ['P1', 'P2', 'P3', 'P4', 'P5']);
    const r = await runTool('pdf-nup', [f], { layout: '4', gap: 8 });
    eq((await pdfInfo(r[0].blob)).pages, 2, '拼版页数');
  });

  /* --- 转换提取 --- */
  t('pdf-to-img PNG 输出尺寸', async () => {
    const f = await makePdfFile('i.pdf', ['P1', 'P2']);
    const r = await runTool('pdf-to-img', [f], { format: 'png', dpi: '72', range: '' });
    eq(r.length, 2, '图片数');
    const info = await imgInfo(r[0].blob);
    eq(info.w, 400, '宽');
    eq(info.h, 600, '高');
  });
  t('pdf-to-img JPG 页面范围', async () => {
    const f = await makePdfFile('i.pdf', ['P1', 'P2', 'P3']);
    const r = await runTool('pdf-to-img', [f], { format: 'jpeg', dpi: '72', range: '2', quality: 80 });
    eq(r.length, 1, '范围限定');
    eq(r[0].name.includes('第2页'), true, '文件名页码');
  });
  t('img-to-pdf A4 转换', async () => {
    const i1 = await makeImageFile('image/png', 300, 200, 'a.png');
    const i2 = await makeImageFile('image/jpeg', 400, 300, 'b.jpg');
    const r = await runTool('img-to-pdf', [i1, i2], { size: 'a4', margin: 24 });
    const info = await pdfInfo(r[0].blob);
    eq(info.pages, 2, '页数');
    eq(info.sizes[0][0], 595, 'A4 宽');
  });
  t('pdf-to-text 提取文字', async () => {
    const f = await makePdfFile('tx.pdf', ['HELLO-WORLD-ALPHA', 'SECOND-PAGE-BETA']);
    const r = await runTool('pdf-to-text', [f]);
    const txt = await r[0].blob.text();
    assert(txt.includes('HELLO-WORLD-ALPHA') && txt.includes('SECOND-PAGE-BETA'), '文字内容');
  });
  t('pdf-meta 修改元数据', async () => {
    const f = await makePdfFile('mt.pdf', ['P1']);
    const r = await runTool('pdf-meta', [f], { title: 'MetaTitleX', author: 'Tester' });
    const doc = await PDFLib.PDFDocument.load(await r[0].blob.arrayBuffer());
    eq(doc.getTitle(), 'MetaTitleX', '标题');
    eq(doc.getAuthor(), 'Tester', '作者');
  });
  t('pdf-extract-images 提取内嵌图片', async () => {
    const img = await makeImageFile('image/png', 120, 90, 'x.png');
    const f = await makeImagePdf('ei.pdf', img);
    const r = await runTool('pdf-extract-images', [f], { minSize: 50 });
    assert(r.length >= 1 && r[0].blob.type === 'image/png', '应提取到图片');
    const info = await imgInfo(r[0].blob);
    eq(info.w, 120, '原图宽');
  });

  /* --- 图片工具 --- */
  t('img-convert PNG→WebP', async () => {
    const i = await makeImageFile('image/png', 100, 80, 'c.png');
    const r = await runTool('img-convert', [i], { format: 'webp', quality: 90 });
    eq(r[0].name.endsWith('.webp'), true, '扩展名');
    eq(r[0].blob.type, 'image/webp', 'MIME');
  });
  t('img-convert PNG→JPG 白底', async () => {
    const i = await makeImageFile('image/png', 100, 80, 'c.png');
    const r = await runTool('img-convert', [i], { format: 'jpeg', quality: 90 });
    eq(r[0].blob.type, 'image/jpeg', 'MIME');
  });
  t('img-compress 限制宽度', async () => {
    const i = await makeImageFile('image/png', 800, 600, 'big.png');
    const r = await runTool('img-compress', [i], { quality: 70, maxWidth: 400, format: 'jpeg' });
    const info = await imgInfo(r[0].blob);
    eq(info.w, 400, '缩放后宽');
  });
  t('img-compress 限制高度 / 同时限制宽高', async () => {
    const tall = await makeImageFile('image/png', 400, 800, 'tall.png');
    const byHeight = await runTool('img-compress', [tall], { quality: 70, maxWidth: 0, maxHeight: 400, format: 'jpeg' });
    const info = await imgInfo(byHeight[0].blob);
    arrEq([info.w, info.h], [200, 400], '按高度等比缩放');
    const both = await runTool('img-compress', [tall], { quality: 70, maxWidth: 100, maxHeight: 100, format: 'jpeg' });
    const info2 = await imgInfo(both[0].blob);
    arrEq([info2.w, info2.h], [50, 100], '宽高同时限制取更小比例');
  });
  t('img-compress 预估输出大小与正式结果一致', async () => {
    const i = await makeImageFile('image/png', 800, 600, 'est.png');
    const opts = { quality: '60', maxWidth: '400', maxHeight: '0', format: 'jpeg' };
    const tool = T.TOOLS.find(t => t.id === 'img-compress');
    const text = await tool.estimate({ files: [i], get: k => opts[k], progress: () => {} });
    assert(text.includes('→ 约'), '预估文案: ' + text);
    const real = await runTool('img-compress', [i], opts);
    assert(text.includes(T.formatBytes(real[0].blob.size)), '预估体积应与正式输出一致: ' + text);
  });
  t('img-resize 按百分比', async () => {
    const i = await makeImageFile('image/png', 200, 100, 'r.png');
    const r = await runTool('img-resize', [i], { mode: 'percent', value: 50 });
    const info = await imgInfo(r[0].blob);
    arrEq([info.w, info.h], [100, 50], '缩放尺寸');
  });
  t('img-resize 按宽度', async () => {
    const i = await makeImageFile('image/png', 200, 100, 'r.png');
    const r = await runTool('img-resize', [i], { mode: 'width', value: 100 });
    const info = await imgInfo(r[0].blob);
    arrEq([info.w, info.h], [100, 50], '按宽缩放');
  });
  t('img-rotate 90° 尺寸交换', async () => {
    const i = await makeImageFile('image/png', 200, 100, 'rot.png');
    const r = await runTool('img-rotate', [i], { angle: '90', flipH: false, flipV: false });
    const info = await imgInfo(r[0].blob);
    arrEq([info.w, info.h], [100, 200], '旋转后尺寸');
  });
  t('img-watermark 平铺水印', async () => {
    const i = await makeImageFile('image/png', 300, 200, 'wm.png');
    const r = await runTool('img-watermark', [i], { text: '内部资料', mode: 'tile' });
    const info = await imgInfo(r[0].blob);
    arrEq([info.w, info.h], [300, 200], '尺寸不变');
  });
  t('img-watermark 空文字应报错', async () => {
    const i = await makeImageFile('image/png', 100, 100, 'wm.png');
    let threw = false;
    try { await runTool('img-watermark', [i], { text: '' }); } catch (e) { threw = true; }
    assert(threw, '应报错');
  });
  t('img-merge 纵向拼接', async () => {
    const i1 = await makeImageFile('image/png', 300, 100, 'm1.png');
    const i2 = await makeImageFile('image/png', 200, 150, 'm2.png');
    const r = await runTool('img-merge', [i1, i2], { direction: 'vertical', gap: 10, bg: '#ffffff' });
    const info = await imgInfo(r[0].blob);
    arrEq([info.w, info.h], [300, 260], '拼接尺寸(含间距)');
  });
  t('img-merge 横向拼接', async () => {
    const i1 = await makeImageFile('image/png', 300, 100, 'm1.png');
    const i2 = await makeImageFile('image/png', 200, 150, 'm2.png');
    const r = await runTool('img-merge', [i1, i2], { direction: 'horizontal', gap: 0, bg: '#ffffff' });
    const info = await imgInfo(r[0].blob);
    arrEq([info.w, info.h], [500, 150], '横向拼接尺寸');
  });
  t('img-convert BMP / TIFF 导出与 TIFF 回读', async () => {
    const i = await makeImageFile('image/png', 80, 60, 'fmt.png');
    const bmp = await runTool('img-convert', [i], { format: 'bmp', quality: 90 });
    eq(bmp[0].blob.type, 'image/bmp', 'BMP MIME');
    eq(bmp[0].name.endsWith('.bmp'), true, 'BMP 扩展名');
    const tif = await runTool('img-convert', [i], { format: 'tiff', quality: 90 });
    eq(tif[0].blob.type, 'image/tiff', 'TIFF MIME');
    const back = new File([await tif[0].blob.arrayBuffer()], 'back.tiff', { type: 'image/tiff' });
    const png = await runTool('img-convert', [back], { format: 'png', quality: 90 });
    const info = await imgInfo(png[0].blob);
    arrEq([info.w, info.h], [80, 60], 'TIFF 回读尺寸');
  });

  /* --- 页面排版 --- */
  t('pdf-crop 裁剪边距', async () => {
    const f = await makePdfFile('cr.pdf', ['P1']);
    const r = await runTool('pdf-crop', [f], { mode: 'pt', top: 20, right: 30, bottom: 40, left: 50 });
    const info = await pdfInfo(r[0].blob);
    arrEq(info.sizes[0], [320, 540], '裁剪后尺寸');
  });
  t('pdf-crop 过大边距应报错', async () => {
    // 400x600 页面；上下边距之和超过页高才应触发"裁剪后尺寸过小"
    const f = await makePdfFile('cr.pdf', ['P1']);
    let threw = false;
    try { await runTool('pdf-crop', [f], { mode: 'pt', top: 595, right: 0, bottom: 5, left: 0 }); } catch (e) { threw = true; }
    assert(threw, '应报错');
  });
  t('pdf-autorotate 旋转文字页检测', async () => {
    const f = await makeRotatedTextPdf('ar.pdf');
    const r = await runTool('pdf-autorotate', [f]);
    const info = await pdfInfo(r[0].blob);
    eq(info.rotations[0], 90, '旋转 90° 的文字页应设 /Rotate 90');
  });
  t('pdf-booklet 仅重排顺序', async () => {
    const f = await makePdfFile('bk.pdf', ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
    const r = await runTool('pdf-booklet', [f], { layout: 'reorder', gap: 8 });
    const txts = await pageTexts(r[0].blob);
    arrEq(txts, ['P8', 'P1', 'P2', 'P7', 'P6', 'P3', 'P4', 'P5'], '小册子页序');
  });
  t('pdf-booklet 双联拼版', async () => {
    const f = await makePdfFile('bk.pdf', ['P1', 'P2', 'P3', 'P4']);
    const r = await runTool('pdf-booklet', [f], { layout: 'nup', gap: 8 });
    eq((await pdfInfo(r[0].blob)).pages, 2, '张数');
  });
  t('pdf-longpage 单长页', async () => {
    const f = await makePdfFile('lp.pdf', ['P1', 'P2', 'P3']);
    const r = await runTool('pdf-longpage', [f], { gap: 10 });
    const info = await pdfInfo(r[0].blob);
    eq(info.pages, 1, '单页');
    arrEq(info.sizes[0], [400, 1820], '长页尺寸');
  });
  t('pdf-page-size 统一 A4', async () => {
    const f = await makePdfFile('ps.pdf', ['P1', 'P2']);
    const r = await runTool('pdf-page-size', [f], { size: 'a4', fit: 'contain' });
    const info = await pdfInfo(r[0].blob);
    arrEq(info.sizes, [[595, 842], [595, 842]], 'A4 尺寸');
  });
  t('pdf-overlay 叠加文档', async () => {
    const base = await makePdfFile('ob.pdf', ['P1', 'P2', 'P3']);
    const over = await makePdfFile('ov.pdf', ['HEAD']);
    const r = await runTool('pdf-overlay', [base], { over, opacity: 0.5, scale: 'fit' });
    eq((await pdfInfo(r[0].blob)).pages, 3, '页数不变');
  });
  t('pdf-overlay 未选叠加文档应报错', async () => {
    const base = await makePdfFile('ob.pdf', ['P1']);
    let threw = false;
    try { await runTool('pdf-overlay', [base], { over: null }); } catch (e) { threw = true; }
    assert(threw, '应报错');
  });
  t('pdf-add-text 添加文字', async () => {
    const f = await makePdfFile('at.pdf', ['P1', 'P2']);
    const r = await runTool('pdf-add-text', [f], { text: '审批通过', range: '', x: 50, y: 50 });
    eq((await pdfInfo(r[0].blob)).pages, 2, '页数不变');
  });
  t('pdf-add-image 添加图片', async () => {
    const f = await makePdfFile('ai.pdf', ['P1']);
    const img = await makeImageFile('image/png', 100, 60, 'logo.png');
    const r = await runTool('pdf-add-image', [f], { img, range: '', x: 80, y: 20, widthPct: 30 });
    eq((await pdfInfo(r[0].blob)).pages, 1, '页数不变');
  });

  /* --- 转换增强 --- */
  t('pdf-scanfx 调色输出', async () => {
    const f = await makePdfFile('sf.pdf', ['P1', 'P2']);
    const r = await runTool('pdf-scanfx', [f], { brightness: 1.1, contrast: 1.3, grayscale: true, invert: false, dpi: '150', quality: 80 });
    eq((await pdfInfo(r[0].blob)).pages, 2, '页数不变');
  });

  /* --- 安全清理 --- */
  t('pdf-remove-annots 删除批注', async () => {
    const f = await samplePdf();
    const r = await runTool('pdf-remove-annots', [f]);
    eq(r.length, 1, '输出');
    assert(r[0].meta.includes('批注'), 'meta 说明');
  });
  t('pdf-sanitize 安全净化', async () => {
    const f = await samplePdf();
    const r = await runTool('pdf-sanitize', [f], { rmAttach: true });
    eq(r.length, 1, '输出');
  });
  t('pdf-flatten 扁平化', async () => {
    const f = await makePdfFile('fl.pdf', ['P1']);
    const r = await runTool('pdf-flatten', [f], { dpi: '150', quality: 80 });
    eq((await pdfInfo(r[0].blob)).pages, 1, '页数');
  });

  /* --- 文档工具 --- */
  t('pdf-compare 文档对比', async () => {
    const fa = await makePdfFile('ca.pdf', ['LINE-A\nLINE-B\nLINE-C']);
    const fb = await makePdfFile('cb.pdf', ['LINE-A\nLINE-X\nLINE-C']);
    const r = await runTool('pdf-compare', [fa, fb]);
    eq(r.length, 2, '报告文件数');
    const html = await r[0].blob.text();
    assert(html.includes('文档对比报告'), 'HTML 报告');
    assert(html.includes('add') && html.includes('del'), '含增删标注');
  });
  t('pdf-info 文档信息', async () => {
    const f = await samplePdf();
    const r = await runTool('pdf-info', [f]);
    const txt = await r[0].blob.text();
    assert(txt.includes('页数：') && txt.includes('PDF 版本'), '报告字段');
  });
  t('pdf-auto-rename 首行命名', async () => {
    const f = await makePdfFile('orig.pdf', ['REPORT TITLE ALPHA', 'body text']);
    const r = await runTool('pdf-auto-rename', [f], { source: 'firstline', prefix: 'C_' });
    eq(r[0].name, 'C_REPORT TITLE ALPHA.pdf', '重命名结果');
  });
  t('pdf-attachments 添加/提取/删除', async () => {
    const f = await makeAttachmentPdf('att.pdf');
    // 提取
    const r1 = await runTool('pdf-attachments', [f], { mode: 'extract' });
    assert(r1.length === 1 && r1[0].name.includes('hello'), '提取附件名: ' + JSON.stringify(r1.map(x => x.name)));
    eq(await r1[0].blob.text(), 'hello attachment', '附件内容');
    // 删除
    const r2 = await runTool('pdf-attachments', [f], { mode: 'remove' });
    assert(r2[0].name.includes('去附件'), '删除附件输出');
    // 添加
    const base = await makePdfFile('base.pdf', ['P1']);
    const att = new File([new TextEncoder().encode('data-x')], 'data-x.bin', { type: 'application/octet-stream' });
    const r3 = await runTool('pdf-attachments', [base, att], { mode: 'add' });
    const back = await runTool('pdf-attachments', [new File([await r3[0].blob.arrayBuffer()], 'out.pdf', { type: 'application/pdf' })], { mode: 'extract' });
    assert(back.length === 1 && back[0].name.includes('data-x'), '回读附件');
  });

  /* --- 真实 sample.pdf 全流程抽测 --- */
  t('sample.pdf: 提取文字非空', async () => {
    const f = await samplePdf();
    const r = await runTool('pdf-to-text', [f]);
    const txt = await r[0].blob.text();
    assert(txt.length > 0, '应提取到文字');
  });
  t('sample.pdf: 旋转 270°', async () => {
    const f = await samplePdf();
    const r = await runTool('pdf-rotate', [f], { angle: '270', range: '' });
    const info = await pdfInfo(r[0].blob);
    assert(info.rotations.every(a => a === 270), '全部 270°');
  });

  /* ---------- 边界与异常用例（第二批） ---------- */
  t('边界: pdf-crop 边距超过页面应报错', async () => {
    const f = await makePdfFile('cr.pdf', ['P1']);
    let threw = false;
    try { await runTool('pdf-crop', [f], { mode: 'pt', top: 0, right: 350, bottom: 0, left: 100 }); } catch (e) { threw = true; }
    assert(threw, '左右边距之和超过页宽应报错');
  });
  t('边界: pdf-blank 全为空白页不应输出去空白页 PDF', async () => {
    const f = await makePdfFile('ab.pdf', ['', '', '']);
    const r = await runTool('pdf-blank', [f], { threshold: 0.15, mode: 'remove' });
    const cleaned = r.find(x => x.name.includes('去空白页'));
    assert(!cleaned, '全部为空白页时不应输出去空白页 PDF');
    assert(r.some(x => x.name.includes('报告')), '仍应输出检测报告');
  });
  t('边界: pdf-split 范围分组为空应报错', async () => {
    const f = await makePdfFile('s.pdf', ['P1']);
    let threw = false;
    try { await runTool('pdf-split', [f], { mode: 'ranges', groups: '  ' }); } catch (e) { threw = true; }
    assert(threw, '空分组应报错');
  });
  t('边界: pdf-pages 范围越界应报错', async () => {
    const f = await makePdfFile('p.pdf', ['P1']);
    let threw = false;
    try { await runTool('pdf-pages', [f], { mode: 'extract', range: '99' }); } catch (e) { threw = true; }
    assert(threw, '越界范围应报错');
  });
  t('边界: pdf-attachments add 模式首个非 PDF 应报错', async () => {
    const f = await makePdfFile('p.pdf', ['P1']);
    const att = new File([new TextEncoder().encode('x')], 'x.bin', { type: 'application/octet-stream' });
    let threw = false;
    try { await runTool('pdf-attachments', [att, f], { mode: 'add' }); } catch (e) { threw = true; }
    assert(threw, '首个文件非 PDF 应报错');
  });
  t('边界: pdf-attachments add 模式缺少附件应报错', async () => {
    const f = await makePdfFile('p.pdf', ['P1']);
    let threw = false;
    try { await runTool('pdf-attachments', [f], { mode: 'add' }); } catch (e) { threw = true; }
    assert(threw, '缺附件应报错');
  });
  t('边界: pdf-auto-rename 无标题回退原名', async () => {
    const f = await makePdfFile('orig-name.pdf', ['body']);
    const r = await runTool('pdf-auto-rename', [f], { source: 'title', prefix: '' });
    eq(r[0].name, 'orig-name.pdf', '回退文件名');
  });
  t('边界: pdf-booklet 3 页补白拼版', async () => {
    const f = await makePdfFile('bk3.pdf', ['P1', 'P2', 'P3']);
    const r = await runTool('pdf-booklet', [f], { layout: 'nup', gap: 0 });
    eq((await pdfInfo(r[0].blob)).pages, 2, '补白后张数');
  });
  t('边界: pdf-textwm 居中模式单页', async () => {
    const f = await makePdfFile('w.pdf', ['P1']);
    const r = await runTool('pdf-textwm', [f], { text: 'W', mode: 'center', angle: 45, opacity: 0.5 });
    eq((await pdfInfo(r[0].blob)).pages, 1, '输出');
  });
  t('边界: pdf-to-text 无文字 PDF 输出空文本', async () => {
    const f = await makePdfFile('nb.pdf', ['']);
    const r = await runTool('pdf-to-text', [f]);
    const txt = await r[0].blob.text();
    assert(typeof txt === 'string', '输出为字符串');
  });
  t('边界: pdf-compare 传入 3 个文件仅对比前 2 个并提示', async () => {
    const fa = await makePdfFile('c1.pdf', ['A1\nA2']);
    const fb = await makePdfFile('c2.pdf', ['A1\nB2']);
    const fc = await makePdfFile('c3.pdf', ['C1']);
    const r = await runTool('pdf-compare', [fa, fb, fc]);
    assert(r.length === 2, '仍输出 2 个报告');
    const html = await r[0].blob.text();
    assert(html.includes('仅对比前 2 个'), '报告应提示第 3 个文件被忽略');
  });
  t('边界: img-rotate 旋转+双翻转', async () => {
    const i = await makeImageFile('image/png', 200, 100, 'rv.png');
    const r = await runTool('img-rotate', [i], { angle: '180', flipH: true, flipV: true });
    const info = await imgInfo(r[0].blob);
    arrEq([info.w, info.h], [200, 100], '180° 尺寸不变');
  });
  t('边界: pdf-nup 单页', async () => {
    const f = await makePdfFile('n1.pdf', ['P1']);
    const r = await runTool('pdf-nup', [f], { layout: '2', gap: 0 });
    eq((await pdfInfo(r[0].blob)).pages, 1, '单页拼版');
  });
  t('边界: pdf-longpage 单页文档', async () => {
    const f = await makePdfFile('l1.pdf', ['P1']);
    const r = await runTool('pdf-longpage', [f], { gap: 0 });
    const info = await pdfInfo(r[0].blob);
    arrEq(info.sizes[0], [400, 600], '尺寸不变');
  });
  t('边界: pdf-page-size 自定义+拉伸', async () => {
    const f = await makePdfFile('ps.pdf', ['P1']);
    const r = await runTool('pdf-page-size', [f], { size: 'custom', width: 300, height: 300, fit: 'stretch' });
    arrEq((await pdfInfo(r[0].blob)).sizes[0], [300, 300], '自定义尺寸');
  });
  t('边界: pdf-to-img WebP 输出', async () => {
    const f = await makePdfFile('w1.pdf', ['P1']);
    const r = await runTool('pdf-to-img', [f], { format: 'webp', dpi: '72', range: '' });
    eq(r[0].blob.type, 'image/webp', 'MIME');
  });
  t('边界: sanitizeFileName 空名', () => {
    eq(T.sanitizeFileName(''), '未命名', '空文件名回退');
    eq(T.sanitizeFileName('  '), '未命名', '空白文件名回退');
  });

  /* ---------- UI 集成测试（第三批，模拟真实交互） ---------- */
  const alerts = [];
  const origAlert = window.alert;
  window.alert = m => alerts.push(String(m));

  function el(id) { return document.getElementById(id); }
  function dropFiles(files) {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    const ev = new Event('drop', { bubbles: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    el('wsDropzone').dispatchEvent(ev);
  }
  async function waitFor(fn, timeout, what) {
    const t0 = Date.now();
    while (Date.now() - t0 < (timeout || 30000)) {
      if (fn()) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('等待超时: ' + what);
  }
  function openToolByName(kw, name) {
    const s = el('toolSearch');
    s.value = kw;
    s.dispatchEvent(new Event('input'));
    const cards = Array.from(el('toolGrid').querySelectorAll('.tool-card'));
    const card = cards.find(c => c.querySelector('.tool-name').textContent === name);
    if (!card) throw new Error('未找到工具卡片: ' + name);
    card.click();
    return card;
  }
  function setOpt(key, value) {
    const input = el('wsOptions').querySelector(`[data-key="${key}"]`);
    if (!input) throw new Error('未找到选项: ' + key);
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
    return input;
  }

  t('诊断: window.alert 拦截是否生效', () => {
    const desc = Object.getOwnPropertyDescriptor(window, 'alert');
    const descInfo = `writable=${desc && desc.writable}, value=${desc && desc.value ? String(desc.value).slice(0, 50) : 'accessor'}`;
    alert('ping-direct');
    assert(alerts.length === 1, `alert 应被拦截捕获，实际 alerts=${JSON.stringify(alerts)}；desc=${descInfo}`);
    alerts.length = 0;
  });
  t('UI: 搜索过滤工具卡片', () => {
    const s = el('toolSearch');
    s.value = '水印';
    s.dispatchEvent(new Event('input'));
    const n = el('toolGrid').querySelectorAll('.tool-card').length;
    eq(n, T.TOOLS.filter(t => (t.name + ' ' + t.desc + ' ' + (t.keywords || '')).includes('水印')).length, '搜索"水印"结果数');
    s.value = 'zzz不存在zzz';
    s.dispatchEvent(new Event('input'));
    eq(el('noResult').hidden, false, '无结果提示应显示');
    s.value = '';
    s.dispatchEvent(new Event('input'));
  });
  t('UI: 分类导航切换', () => {
    resetSearch();
    el('headerNav').querySelector('[data-cat="img"]').click();
    eq(el('toolGrid').querySelectorAll('.tool-card').length, T.TOOLS.filter(t => t.cat === 'img').length, '图片工具数量');
    el('headerNav').querySelector('[data-cat="pdf"]').click();
    eq(el('toolGrid').querySelectorAll('.tool-card').length, T.TOOLS.filter(t => t.cat === 'pdf').length, 'PDF 处理数量');
    el('headerNav').querySelector('[data-cat="all"]').click();
    eq(el('toolGrid').querySelectorAll('.tool-card').length, T.TOOLS.length, '全部工具数量');
  });
  t('UI: 主题切换写入 localStorage', () => {
    const before = document.documentElement.getAttribute('data-theme');
    el('themeToggleBtn').click();
    const after = document.documentElement.getAttribute('data-theme');
    assert(before !== after, '主题应变化');
    eq(localStorage.getItem('theme'), after, 'localStorage 与 DOM 一致');
    el('themeToggleBtn').click();
  });
  t('UI: 打开工具与返回', () => {
    openToolByName('拼接', '图片拼接');
    eq(el('workspaceView').hidden, false, '工作区显示');
    eq(el('wsTitle').textContent, '图片拼接', '标题');
    el('wsBackBtn').click();
    eq(el('homeView').hidden, false, '返回首页');
  });
  t('UI: 拖拽添加/排序/删除文件', async () => {
    openToolByName('拼接', '图片拼接');
    const i1 = await makeImageFile('image/png', 100, 50, 'ui1.png');
    const i2 = await makeImageFile('image/png', 100, 50, 'ui2.png');
    dropFiles([i1, i2]);
    eq(T.state.files.length, 2, '拖入文件数');
    eq(el('wsFileList').querySelectorAll('.file-item').length, 2, '列表行数');
    el('wsFileList').querySelectorAll('[data-act="up"]')[1].click();
    eq(T.state.files[0].name, 'ui2.png', '上移后顺序');
    el('wsFileList').querySelectorAll('[data-act="rm"]')[0].click();
    eq(T.state.files.length, 1, '删除后数量');
    dropFiles([i1]);
    eq(T.state.files.length, 2, '再次拖入');
  });
  t('UI: 无文件时主按钮禁用并给出提示', () => {
    openToolByName('提取文字', 'PDF 提取文字');
    eq(el('wsRunBtn').disabled, true, '无文件时应禁用开始处理');
    assert(el('wsRunHint').textContent.includes('至少'), '应提示至少需要几个文件: ' + el('wsRunHint').textContent);
    eq(el('wsRunHint').classList.contains('is-blocked'), true, '提示应为警示态');
  });
  t('UI: 文件数不足 minFiles 时禁用并提示还差几个', async () => {
    openToolByName('合并', 'PDF 合并');
    const f = await makePdfFile('one.pdf', ['P1']);
    dropFiles([f]);
    eq(T.state.files.length, 1, '已选 1 个文件');
    eq(el('wsRunBtn').disabled, true, '不足 2 个文件应禁用开始处理');
    assert(el('wsRunHint').textContent.includes('还需 1'), '提示还需 1 个: ' + el('wsRunHint').textContent);
    const f2 = await makePdfFile('two.pdf', ['P2']);
    dropFiles([f2]);
    eq(el('wsRunBtn').disabled, false, '补足文件后应恢复可点击');
  });
  t('UI: 完整流程-图片拼接出结果', async () => {
    openToolByName('拼接', '图片拼接');
    const i1 = await makeImageFile('image/png', 120, 60, 'f1.png');
    const i2 = await makeImageFile('image/png', 100, 80, 'f2.png');
    dropFiles([i1, i2]);
    alerts.length = 0;
    el('wsRunBtn').click();
    await waitFor(() => !el('wsResultsSection').hidden || alerts.length > 0, 30000, '处理完成');
    assert(el('wsResultsSection').hidden === false, '结果区显示, alerts=' + JSON.stringify(alerts));
    eq(el('wsResultsGrid').querySelectorAll('.preview-card').length, 1, '结果卡片数');
    eq(el('wsZipBtn').disabled, true, '单结果 ZIP 应禁用');
    assert(el('wsResultsGrid').querySelector('img'), '图片结果应有缩略图');
  });
  t('UI: 图片压缩参数变化实时预估', async () => {
    openToolByName('压缩', '图片压缩');
    const i = await makeImageFile('image/png', 900, 600, 'ui-est.png');
    dropFiles([i]);
    const readEstimate = () => {
      const p = el('wsOptions').querySelector('.option-estimate-text');
      return p ? p.textContent : '';
    };
    await waitFor(() => readEstimate().includes('→ 约'), 15000, '预估结果显示');
    const before = readEstimate();
    const w = el('wsOptions').querySelector('[data-key="maxWidth"]');
    w.value = '100';
    w.dispatchEvent(new Event('input'));
    await waitFor(() => readEstimate().includes('→ 约') && readEstimate() !== before, 15000, '参数变化后重新预估');
    el('wsBackBtn').click();
  });
  t('UI: 从功能返回保留原滚动位置', async () => {
    resetSearch();
    el('headerNav').querySelector('[data-cat="all"]').click();
    // 上一用例返回首页时会在 rAF 里还原滚动位置，先让它落地再滚，避免两者竞争
    await new Promise(r => setTimeout(r, 120));
    window.scrollTo(0, 600);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const before = window.scrollY;
    assert(before > 100, '页面应可滚动，实际 y=' + before);
    el('toolGrid').querySelectorAll('.tool-card')[4].click();
    await new Promise(r => setTimeout(r, 100));
    el('wsBackBtn').click();
    await new Promise(r => setTimeout(r, 250));
    assert(Math.abs(window.scrollY - before) <= 2, '返回后应回到原位置：期望 ' + before + '，实际 ' + window.scrollY);
  });
  t('UI: ZIP 打包按钮图标保留', async () => {
    openToolByName('转图片', 'PDF 转图片');
    const f = await makePdfFile('zip-src.pdf', ['P1', 'P2']);
    dropFiles([f]);
    setOpt('dpi', '72');
    el('wsRunBtn').click();
    await waitFor(() => !el('wsResultsSection').hidden, 30000, '转图片完成');
    assert(el('wsResultsGrid').querySelectorAll('.preview-card').length >= 2, '多结果');
    eq(el('wsZipBtn').disabled, false, 'ZIP 应可用');
    const hadSvg = !!el('wsZipBtn').querySelector('svg');
    el('wsZipBtn').click();
    await waitFor(() => !el('wsZipBtn').disabled, 60000, 'ZIP 打包完成');
    const hasSvg = !!el('wsZipBtn').querySelector('svg');
    assert(hadSvg && hasSvg, `ZIP 按钮图标应在打包前后保留（前=${hadSvg} 后=${hasSvg}）`);
  });
  t('UI: 图片结果灯箱打开与关闭', async () => {
    const img = el('wsResultsGrid').querySelector('.preview-thumbnail-box img');
    assert(img, '存在图片缩略图');
    img.parentNode.click();
    eq(el('lightboxModal').classList.contains('active'), true, '灯箱打开');
    el('lightboxCloseBtn').click();
    eq(el('lightboxModal').classList.contains('active'), false, '灯箱关闭');
  });
  t('UI: 选项区渲染（select/checkbox/file/color）', async () => {
    openToolByName('骑缝章', '图片水印 / 骑缝章');
    const opts = el('wsOptions');
    assert(opts.querySelector('input[type="file"]'), 'file 选项');
    assert(opts.querySelector('select'), 'select 选项');
    openToolByName('扫描件调色', '扫描件调色 / 反色');
    assert(opts.querySelector('input[type="checkbox"]'), 'checkbox 选项');
    openToolByName('页码', '添加页码');
    assert(opts.querySelector('input[type="color"]'), 'color 选项');
    assert(opts.querySelector('input[type="number"]'), 'number 选项');
    el('wsBackBtn').click();
  });
  t('UI: 无选项工具隐藏右栏，文件区占满', () => {
    openToolByName('合并', 'PDF 合并');
    const cols = el('wsCols');
    eq(cols.classList.contains('no-options'), true, '无选项时切换为单列');
    eq(getComputedStyle(el('wsOptions').parentElement).display, 'none', '右栏隐藏');
    openToolByName('转图片', 'PDF 转图片');
    eq(cols.classList.contains('no-options'), false, '有选项时恢复两栏');
    el('wsBackBtn').click();
  });
  t('UI: 非法类型文件被拒绝（toast 提示）', async () => {
    openToolByName('合并', 'PDF 合并');
    T.state.files.length = 0;
    const bad = new File([new TextEncoder().encode('x')], 'evil.exe', { type: 'application/x-msdownload' });
    dropFiles([bad]);
    const toasts = Array.from(document.querySelectorAll('#toastStack .toast')).map(n => n.textContent);
    assert(toasts.some(t => t.includes('类型不支持')), '应提示类型不支持: ' + JSON.stringify(toasts) + '；drop 后 files=' + T.state.files.length);
    eq(T.state.files.length, 0, '不应加入列表');
    el('wsBackBtn').click();
  });
  t('UI: 分类 chips / 搜索清空 / 空状态建议', () => {
    resetSearch();
    el('headerNav').querySelector('[data-cat="all"]').click();
    const chips = el('catChips');
    chips.querySelector('[data-cat="img"]').click();
    eq(T.state.cat, 'img', '切到图片分类');
    const imgs = Array.from(el('toolGrid').querySelectorAll('.tool-card'));
    eq(imgs.length, T.TOOLS.filter(t => t.cat === 'img').length, '图片工具数量');
    assert(imgs.every(c => c.classList.contains('tool-card')), 'chips 切换后渲染正常');
    chips.querySelector('[data-cat="all"]').click();
    eq(T.state.cat, 'all', '切回全部');

    const s = el('toolSearch');
    s.value = '不存在zzz';
    s.dispatchEvent(new Event('input'));
    eq(el('noResult').hidden, false, '显示空状态');
    eq(el('searchBox').classList.contains('has-keyword'), true, '显示清除按钮');
    el('noResult').querySelector('[data-suggest="水印"]').click();
    assert(s.value === '水印', '建议词回填搜索框: ' + s.value);
    el('searchClearBtn').click();
    eq(s.value, '', '清除按钮清空输入');
    eq(el('searchBox').classList.contains('has-keyword'), false, '隐藏清除按钮');
    eq(el('noResult').hidden, true, '清空后恢复列表');
  });

  /* ---------- 最近使用 / 自定义置顶（第四批） ---------- */
  function resetSearch() {
    const s = el('toolSearch');
    s.value = '';
    s.dispatchEvent(new Event('input'));
  }
  t('UI: 置顶工具添加/移除与持久化', () => {
    while (el('pinnedRow').querySelector('.quick-unpin')) el('pinnedRow').querySelector('.quick-unpin').click();
    resetSearch();
    const card = el('toolGrid').querySelectorAll('.tool-card')[1];
    const name = card.querySelector('.tool-name').textContent;
    const id = card.dataset.id;
    card.querySelector('.card-pin').click();
    eq(el('pinnedSection').hidden, false, '置顶区应显示');
    eq(el('pinnedRow').querySelectorAll('.quick-card').length, 1, '置顶卡片数');
    eq(el('pinnedRow').querySelector('.quick-name').textContent, name, '置顶名称一致');
    arrEq(JSON.parse(localStorage.getItem('officetoolbox.pinned')), [id], '已持久化');
    el('pinnedRow').querySelector('.quick-unpin').click();
    eq(el('pinnedSection').hidden, true, '取消后置顶区隐藏');
    arrEq(JSON.parse(localStorage.getItem('officetoolbox.pinned')), [], '持久化已清空');
  });
  t('UI: 置顶拖动排序', () => {
    while (el('pinnedRow').querySelector('.quick-unpin')) el('pinnedRow').querySelector('.quick-unpin').click();
    resetSearch();
    const pinByName = name => {
      const c = Array.from(el('toolGrid').querySelectorAll('.tool-card')).find(x => x.querySelector('.tool-name').textContent === name);
      c.querySelector('.card-pin').click();
    };
    pinByName('PDF 合并');
    pinByName('PDF 拆分');
    let names = () => Array.from(el('pinnedRow').querySelectorAll('.quick-name')).map(n => n.textContent);
    arrEq(names(), ['PDF 合并', 'PDF 拆分'], '初始置顶顺序');
    const items = el('pinnedRow').querySelectorAll('.quick-card');
    const dt = new DataTransfer();
    const ev1 = new Event('dragstart', { bubbles: true });
    Object.defineProperty(ev1, 'dataTransfer', { value: dt });
    items[0].dispatchEvent(ev1);
    const ev2 = new Event('drop', { bubbles: true });
    Object.defineProperty(ev2, 'dataTransfer', { value: dt });
    items[1].dispatchEvent(ev2);
    arrEq(names(), ['PDF 拆分', 'PDF 合并'], '拖动后顺序');
    eq(JSON.parse(localStorage.getItem('officetoolbox.pinned')).length, 2, '顺序已持久化');
    while (el('pinnedRow').querySelector('.quick-unpin')) el('pinnedRow').querySelector('.quick-unpin').click();
  });
  t('UI: 最近使用记录与清空', async () => {
    el('recentClearBtn').click();
    openToolByName('提取文字', 'PDF 提取文字');
    const f = await makePdfFile('rec.pdf', ['HELLO']);
    dropFiles([f]);
    alerts.length = 0;
    el('wsRunBtn').click();
    await waitFor(() => !el('wsResultsSection').hidden || alerts.length > 0, 30000, '处理完成');
    assert(el('wsResultsSection').hidden === false, '结果应生成, alerts=' + JSON.stringify(alerts));
    el('wsBackBtn').click();
    eq(el('recentSection').hidden, false, '最近使用区显示');
    eq(el('recentRow').querySelector('.quick-name').textContent, 'PDF 提取文字', '记录工具名');
    arrEq(JSON.parse(localStorage.getItem('officetoolbox.recent')), ['pdf-to-text'], '持久化记录');
    el('recentClearBtn').click();
    eq(el('recentSection').hidden, true, '清空后隐藏');
    arrEq(JSON.parse(localStorage.getItem('officetoolbox.recent')), [], '持久化已清空');
  });

  /* ---------- 加密与格式转换（第五批） ---------- */
  const ENC_FIXTURES = {"fx_rc4_pw":"JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgMyAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKMyAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDIgMCBSCi9SZXNvdXJjZXMgPDwKL0ZvbnQgPDwKL0hlbHZldGljYS03MDk4NDgwNzg5IDQgMCBSCj4+Ci9YT2JqZWN0IDw8Cj4+Ci9FeHRHU3RhdGUgPDwKPj4KPj4KL01lZGlhQm94IFsgMCAwIDMwMCAyMDAgXQovQW5ub3RzIFsgXQovQ29udGVudHMgWyA1IDAgUiBdCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQovRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZwo+PgplbmRvYmoKNSAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovTGVuZ3RoIDExMQo+PgpzdHJlYW0KByhS0lTq5TLvpkrkO0eT0WQ9q/B+KJmD1TtblZPAaEIgjjL7mn43S8hUm4CXo3bTEkJWU/LC1COyfcpG2jlZYJxho3bLz/fy1GvQBB/A2wCZT6CIAWvz822aL46zKX/wd0s3XUT+Ap2eWhgVHO/ECmVuZHN0cmVhbQplbmRvYmoKNiAwIG9iago8PAovUHJvZHVjZXIgPGUxMWFmOWY5ZWJkNmQ5YzY1ZmNiNGE1ZGJhZjU0MDQyZTQzMzk5MjZhMWVjZGZmODM5NjA5ZmJkMzg2NDZmOWQzYzNkZWJjZDBlZGZkNTllMDhmY2I0ZTM2OWE4ZmJjMjc4YTYwYjgzNjY1MjlmNmE5YzRjOWI2YzI1OTVjZmNjYmRmOTA1MWQzOGZhYmIxZjM4YWYwODIyZjg2ZDhhYjJmM2EyMDYxOTQ4ODcwYjYzODg5Nj4KL01vZERhdGUgPDViZGZjYmI5ZDk4NGU4OTE2ZmQ1N2IwNTg5YTg3NTE2YmU+Ci9DcmVhdG9yIDxlMTFhZjlmOWViZDZkOWM2NWZjYjRhNWRiYWY1NDA0MmU0MzM5OTI2YTFlY2RmZjgzOTYwOWZiZDM4NjQ2ZjlkM2MzZGViY2QwZWRmZDU5ZTA4ZmNiNGUzNjlhOGZiYzI3OGE2MGI4MzY2NTI5ZjZhOWM0YzliNmMyNTk1Y2ZjY2JkZjkwNTFkMzhmYWJiMWYzOGFmMDgyMmY4NmQ4YWIyZjNhMjA2MTk0ODg3MGI2Mzg4OTY+Ci9DcmVhdGlvbkRhdGUgPDViZGZjYmI5ZDk4NGU4OTE2ZmQ1N2IwNTg5YTg3NTE2YmU+Cj4+CmVuZG9iago3IDAgb2JqCjw8Ci9WIDIKL1IgMwovTGVuZ3RoIDEyOAovUCA0Mjk0OTY3MjkyCi9GaWx0ZXIgL1N0YW5kYXJkCi9PIDwwZWE3ZDcxZjkzNmVmMjk4Zjc3NWFiOTM2NDQxODAwYzgyZTUyNTJkZTBiMGZkYzEyMDU4MjMwNjNlNTZjMzI2PgovVSA8MGMwYmExYTUzOGU1OGJkZmFmZDE2YmJlYmIyNzlmMTkyOGJmNGU1ZTRlNzU4YTQxNjQwMDRlNTZmZmZhMDEwOD4KPj4KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY0IDAwMDAwIG4gCjAwMDAwMDAxMjMgMDAwMDAgbiAKMDAwMDAwMDMxNyAwMDAwMCBuIAowMDAwMDAwNDE0IDAwMDAwIG4gCjAwMDAwMDA1OTcgMDAwMDAgbiAKMDAwMDAwMTEwMCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDgKL1Jvb3QgMSAwIFIKL0luZm8gNiAwIFIKL0lEIFsgPDYxMzg2MTM4MzYzNzYzMzI2NjY2NjEzNzY2MzUzMzMzNjQ2NDM2MzIzMDM0NjEzNzM5NjU2NjMzMzIzMDM0NjU+IDw2MTM4NjEzODM2Mzc2MzMyNjY2NjYxMzc2NjM1MzMzMzY0NjQzNjMyMzAzNDYxMzczOTY1NjYzMzMyMzAzNDY1PiBdCi9FbmNyeXB0IDcgMCBSCj4+CnN0YXJ0eHJlZgoxMzE1CiUlRU9GCg==","fx_rc4_empty":"JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgMyAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKMyAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDIgMCBSCi9SZXNvdXJjZXMgPDwKL0ZvbnQgPDwKL0hlbHZldGljYS03MDk4NDgwNzg5IDQgMCBSCj4+Ci9YT2JqZWN0IDw8Cj4+Ci9FeHRHU3RhdGUgPDwKPj4KPj4KL01lZGlhQm94IFsgMCAwIDMwMCAyMDAgXQovQW5ub3RzIFsgXQovQ29udGVudHMgWyA1IDAgUiBdCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQovRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZwo+PgplbmRvYmoKNSAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovTGVuZ3RoIDExMQo+PgpzdHJlYW0KWzySw4GNSYJpQ9mSd2MHTFMH2C2Jebud3dNX/t8sv/7ky233n1mz4xJbc0cBZjdhA2u2jwGBirxvwcRK9c01Kt3OEK99ExdX3cZoDO4HuovO8kz5a8qmj1+DV3kTRyKJRqGBC7jdaxSpJxL4u6DWCmVuZHN0cmVhbQplbmRvYmoKNiAwIG9iago8PAovUHJvZHVjZXIgPGE5MjM0NWQ3MjY5YTk3YWJkZjRiMzYyZDRmNjk2ZWM5OWU4MTdiYjRhMzA3ZGI2ZDI5MmIwNjM0MDY4OTliOGZmOTM2ZWI3NmM4NzQ2NDJkNzE0ODVkMDFkNmMzZjhmZjhjZDc1ZmFhNjg2N2ZiZDVlZWI3ZWU5YWRjY2M5ZDE1OTkzZjNhZTA4ZThmOWNjNWZmOWEyMDBkZmFkODMyNjIyYWM4NjE3ZDVjMThlZWM2NjYwMz4KL01vZERhdGUgPDEzZTY3Nzk3MTRjOGE2ZmNlZjU1MDc3NTdjMzQ1YjlkYzQ+Ci9DcmVhdG9yIDxhOTIzNDVkNzI2OWE5N2FiZGY0YjM2MmQ0ZjY5NmVjOTllODE3YmI0YTMwN2RiNmQyOTJiMDYzNDA2ODk5YjhmZjkzNmViNzZjODc0NjQyZDcxNDg1ZDAxZDZjM2Y4ZmY4Y2Q3NWZhYTY4NjdmYmQ1ZWViN2VlOWFkY2NjOWQxNTk5M2YzYWUwOGU4ZjljYzVmZjlhMjAwZGZhZDgzMjYyMmFjODYxN2Q1YzE4ZWVjNjY2MDM+Ci9DcmVhdGlvbkRhdGUgPDEzZTY3Nzk3MTRjOGE2ZmNlZjU1MDc3NTdjMzQ1YjlkYzQ+Cj4+CmVuZG9iago3IDAgb2JqCjw8Ci9WIDIKL1IgMwovTGVuZ3RoIDEyOAovUCA0Mjk0OTY3MjkyCi9GaWx0ZXIgL1N0YW5kYXJkCi9PIDw1NjZmYTg3M2VlMzNjNzk3Y2QzYjkwNGZkYWRmODE0YWZhMzRkZjlhMzhmNmVkNDFiOTg0ZTJjNmRhMmFhNmY1PgovVSA8MGYzZGZhNmZmNmM0ZGNiOTYyYTQzZWRlZTI4MzdlNGIyOGJmNGU1ZTRlNzU4YTQxNjQwMDRlNTZmZmZhMDEwOD4KPj4KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY0IDAwMDAwIG4gCjAwMDAwMDAxMjMgMDAwMDAgbiAKMDAwMDAwMDMxNyAwMDAwMCBuIAowMDAwMDAwNDE0IDAwMDAwIG4gCjAwMDAwMDA1OTcgMDAwMDAgbiAKMDAwMDAwMTEwMCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDgKL1Jvb3QgMSAwIFIKL0luZm8gNiAwIFIKL0lEIFsgPDYxMzg2MTM4MzYzNzYzMzI2NjY2NjEzNzY2MzUzMzMzNjQ2NDM2MzIzMDM0NjEzNzM5NjU2NjMzMzIzMDM0NjU+IDw2MTM4NjEzODM2Mzc2MzMyNjY2NjYxMzc2NjM1MzMzMzY0NjQzNjMyMzAzNDYxMzczOTY1NjYzMzMyMzAzNDY1PiBdCi9FbmNyeXB0IDcgMCBSCj4+CnN0YXJ0eHJlZgoxMzE1CiUlRU9GCg==","fx_aes128_pw":"JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgMyAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKMyAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDIgMCBSCi9SZXNvdXJjZXMgPDwKL0ZvbnQgPDwKL0hlbHZldGljYS03MDk4NDgwNzg5IDQgMCBSCj4+Ci9YT2JqZWN0IDw8Cj4+Ci9FeHRHU3RhdGUgPDwKPj4KPj4KL01lZGlhQm94IFsgMCAwIDMwMCAyMDAgXQovQW5ub3RzIFsgXQovQ29udGVudHMgWyA1IDAgUiBdCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQovRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZwo+PgplbmRvYmoKNSAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovTGVuZ3RoIDEyOAo+PgpzdHJlYW0Ke4PLTUPFQVviadjm5xl7kJ9c7owZ/XwKFwfhB+yaBGP5YdI8fCxui0pRqSdaiJm9uSwW+lcC4RAnDH9wDa7n1V6QYv4dljZqYMnbn28QKlQKB8TEGDwtjyH99zsL7oQ1mfqXxUg/GmQ++VcNOZp/I/dUD0raYtO++4bFjVBZ2Z8KZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqCjw8Ci9Qcm9kdWNlciA8ZjlmNzdhYTQ3NDE0YmNkOWViMWRlYWQ2MmEyYzIwZmE1NjIzZDU4ZDYzNzc0MjEyZTI3Y2EzMmRmZDljODE5ZjY5Njg2NzU0MmE1ZDNkZjZkZGY1YzczNTJiOGQyNDY1NTYwNThmYjk5NGI0ZjRlMzFlOGMyNWU3ZGVjNWIwODhkMjg1NjllYTZhOTZjNDhlOWIwMWY4ZDk2YjVkYzI4NWJkMWNhOTY0ZDIzZTgzNjQwNGQwM2YxOWY0ZWU2NzA5YWU4MzViZDBkNGRiM2Q4ZWM2ZTU0YzgyZDc1MmQ1YTE+Ci9Nb2REYXRlIDxjMDJjYmUxNzViYjg2MDg1ZTk3NDIyMDY1OTI5MjM5NzRjN2ExODRlMGJlNWZlNGEwYWVkZDg3Zjc2MWJiZDI3ZGViN2I4YTg3MWI1MzhjMjQ3MjU4NTdlOTJkNjNiYTM+Ci9DcmVhdG9yIDwzMjcwMDQ5MzRkYjExNTA2N2FiM2MwMjcwZWU1ZDlmOTQ5ZTkyOTMwNmIxZjUwOWU1ZDgwNGJkYzYxYTVkNTIwNDk3MTYyODUyNjEyNzQ4MjZjYWRlMzU2MzhhODcxMTMyMzZhMDA0NmU3ODhiYmU0ZjhiNDE4MGY0MDYwOWRkYTM3ZWY1MDU5YTViN2I5NDA3Mjk1Y2E5ZWNlNzk5ZjhkZjI5YWE5MDEzZjRhODMwZDM5MTM3MTFlMjA5ODA2OWY0ZTZmMGQyMGJiNDU4ZmRhOTI0Zjg3YTZmMmU0YjBhMT4KL0NyZWF0aW9uRGF0ZSA8NTFlZTZjMTQyOWVkNGZlYmE1ZTRkMjdiZDRjMWI3OTY4ZjZiZjIyYTJmNGVhZGE2ZDNmNmIwZmMyOTllMWEzNTZjOTlkNjU0ZWEzMjBlZTQ4ZWRmODFmNDM3Yzg0MDM1Pgo+PgplbmRvYmoKNyAwIG9iago8PAovViA0Ci9SIDQKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8MGVhN2Q3MWY5MzZlZjI5OGY3NzVhYjkzNjQ0MTgwMGM4MmU1MjUyZGUwYjBmZGMxMjA1ODIzMDYzZTU2YzMyNj4KL1UgPDBjMGJhMWE1MzhlNThiZGZhZmQxNmJiZWJiMjc5ZjE5MjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Ci9DRiA8PAovU3RkQ0YgPDwKL0F1dGhFdmVudCAvRG9jT3BlbgovQ0ZNIC9BRVNWMgovTGVuZ3RoIDE2Cj4+Cj4+Ci9TdG1GIC9TdGRDRgovU3RyRiAvU3RkQ0YKPj4KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY0IDAwMDAwIG4gCjAwMDAwMDAxMjMgMDAwMDAgbiAKMDAwMDAwMDMxNyAwMDAwMCBuIAowMDAwMDAwNDE0IDAwMDAwIG4gCjAwMDAwMDA2MTQgMDAwMDAgbiAKMDAwMDAwMTMyOSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDgKL1Jvb3QgMSAwIFIKL0luZm8gNiAwIFIKL0lEIFsgPDYxMzg2MTM4MzYzNzYzMzI2NjY2NjEzNzY2MzUzMzMzNjQ2NDM2MzIzMDM0NjEzNzM5NjU2NjMzMzIzMDM0NjU+IDw2MTM4NjEzODM2Mzc2MzMyNjY2NjYxMzc2NjM1MzMzMzY0NjQzNjMyMzAzNDYxMzczOTY1NjYzMzMyMzAzNDY1PiBdCi9FbmNyeXB0IDcgMCBSCj4+CnN0YXJ0eHJlZgoxNjM2CiUlRU9GCg==","fx_aes256_pw":"JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgMyAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKMyAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDIgMCBSCi9SZXNvdXJjZXMgPDwKL0ZvbnQgPDwKL0hlbHZldGljYS03MDk4NDgwNzg5IDQgMCBSCj4+Ci9YT2JqZWN0IDw8Cj4+Ci9FeHRHU3RhdGUgPDwKPj4KPj4KL01lZGlhQm94IFsgMCAwIDMwMCAyMDAgXQovQW5ub3RzIFsgXQovQ29udGVudHMgWyA1IDAgUiBdCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQovRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZwo+PgplbmRvYmoKNSAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovTGVuZ3RoIDEyOAo+PgpzdHJlYW0Krzo7gYIFl+j+SpuBJLmk2j6v7cB3vOLzZNcPwOVradhb62C/RJS2uLKSoWWRsT+1uM7V1gDjHrRiLmKaLOuf2HVB1lr/5MwPsCSdGlTFYELP5JT/quqMsP9ixE+FV6ExLCfPCZecCuDCxM9+g8EkZzsID2WtWw7cuFPHA9FsA+wKZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqCjw8Ci9Qcm9kdWNlciA8OTJmNzkzYmU2NTUwYzE1MTBlNDZiZTk5NzlhMGZjZDgyYTM1MTQ3ZGRjMzgzMTZhMzhiODhmN2Q2YmJlOTNlMjI0ZmVmNDE0Yzc2MThhNjdkMTQwZTZjY2ZlM2RjNzMyM2E0MzAzMmE5YzcxODg1ZmQ0NTFiZWMyMGQxNWEzZDdhNjkzM2JkZDhhMzQ1MzdlOWI2NmM0ODlhOTNhZWE0YzQzNWJlZGEwZjQyMzEwNTBkMjZkYmEzZWRhMTVkOTc4ODJkOGRhODQ2MzJjYjQ0ZDE1YTUzMmQxMTFiOTI4NTA+Ci9Nb2REYXRlIDw3ZTk4OTZiMWU3ZDY2ZDM4NDNjYzYzNTZhNDE2Y2RmYjM4ZTFiYmQ5NDFlMjMxNzk4MjBjNjgzNTQwZjcyYmFmNDRkZDFjNWYzOWYyM2Q2MWQzN2Q5ZDNjM2QzNDZiYmE+Ci9DcmVhdG9yIDw0MGE3MjFlY2ZhNTg4NzdiMzYxZTFlOWJiNTI3NjQwNWFlODI4YWE4YjIzNjVhMDNkZTA4ZWYzNDY0OTY1NzEzMjAwZDk2Zjg0MTMzODhlYTY1ZjE4OTNhNzg5NWJmNWZjOWNlMzQxODBlNGI0ZDIzNzUzNjM4ZjI2NTcxYjVjODU4NDFmNmVmZjQ5MWE0YjFhNzc2Yzg4MDgwNzk2M2Y2ZTc2MjZkNjczMWYwM2ZhNGU3MDM5YWNhMWQ3ZGNmOGRjYmM4MTIwMjI2OTA4NjhkMDIzOWRiMmYyNmVmNDZiOT4KL0NyZWF0aW9uRGF0ZSA8YTJiOTU0NGIwYTNmZDQ4MTZhMDhlNGMwODY2NDFlY2Q0MzUxODQ2NzBlNzhiNTAzMTNhY2IzZjljNjgyZDg2YThhMzJhYzFiZWMxNWU4YWU5ODZlM2UxY2FkZGYxODk1Pgo+PgplbmRvYmoKNyAwIG9iago8PAovViA1Ci9SIDYKL0xlbmd0aCAyNTYKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8N2ZiMDFiYmQ0YzdmYzYzNDAyMDVkZDgyZDMxNjBlYTJkZWVmYTVhMWQyOTkxNTAwYWZiMDljNjQzNDE2MDRmMzM4MjJlMGFmZDBkNDViZmZiNTBmYzEzYmI3YWU3NTU0PgovVSA8YzExNWIxMTUyODk4NDM1OTM3ZjRhOWU2ZTk3OTRkMjYyODg5YzM2MTM3ODNiY2Q3ZDZiOTFlYmI4NGY2Nzc4ZjY5MGMxZjNhM2EyNTU1YTk0MjFhYjU2YzM1NmNmYTMxPgovQ0YgPDwKL1N0ZENGIDw8Ci9BdXRoRXZlbnQgL0RvY09wZW4KL0NGTSAvQUVTVjMKL0xlbmd0aCAzMgo+Pgo+PgovU3RtRiAvU3RkQ0YKL1N0ckYgL1N0ZENGCi9PRSA8ZDRlYmQ0ZWNmYjdiZWI3YTcxYWM1MTAxNTRhNzBhMzA1MWNiN2YwZjhjZTA2ZTE5Mzg0ZTYwN2U4ODdhNGYxMD4KL1VFIDwwYzBmYWY2NTQxM2IxZThhZmE0YzRjYzY3MDU4MzhlMzdiNmUzNGQ3YTM3MWQ5MmI0YTA3MTNmNTAzMDliZjQ3PgovUGVybXMgPDY3Mzk1OTViNjIzY2EzZWRmMzYyNTNhMzEwZGY0YzM0Pgo+PgplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyMyAwMDAwMCBuIAowMDAwMDAwMzE3IDAwMDAwIG4gCjAwMDAwMDA0MTQgMDAwMDAgbiAKMDAwMDAwMDYxNCAwMDAwMCBuIAowMDAwMDAxMzI5IDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgOAovUm9vdCAxIDAgUgovSW5mbyA2IDAgUgovSUQgWyA8NjEzODYxMzgzNjM3NjMzMjY2NjY2MTM3NjYzNTMzMzM2NDY0MzYzMjMwMzQ2MTM3Mzk2NTY2MzMzMjMwMzQ2NT4gPDYxMzg2MTM4MzYzNzYzMzI2NjY2NjEzNzY2MzUzMzMzNjQ2NDM2MzIzMDM0NjEzNzM5NjU2NjMzMzIzMDM0NjU+IF0KL0VuY3J5cHQgNyAwIFIKPj4Kc3RhcnR4cmVmCjE4ODQKJSVFT0YK"};
  t('加密基础: MD5/SHA/RC4/AES 向量', () => {
    const hx = b => T.bytesToHex(b);
    eq(hx(T.md5Bytes(T.utf8ToBytes(''))), 'd41d8cd98f00b204e9800998ecf8427e', 'md5 空串');
    eq(hx(T.md5Bytes(T.utf8ToBytes('abc'))), '900150983cd24fb0d6963f7d28e17f72', 'md5 abc');
    eq(hx(T.sha256Bytes(T.utf8ToBytes('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256 abc');
    eq(hx(T.sha512Bytes(T.utf8ToBytes('abc'), 512)).slice(0, 32), 'ddaf35a193617abacc417349ae204131', 'sha512 abc');
    eq(hx(T.sha512Bytes(T.utf8ToBytes(''), 384)), '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b', 'sha384 空串');
    eq(hx(T.rc4Bytes(T.utf8ToBytes('Key'), T.utf8ToBytes('Plaintext'))).toUpperCase(), 'BBF316E8D940AF0AD3', 'rc4 RFC 向量');
    const aesKey = new Uint8Array(16), aesPt = new Uint8Array(16);
    for (let i = 0; i < 16; i++) { aesKey[i] = i; aesPt[i] = i * 0x11; }
    eq(hx(T.aesCbcEncrypt(aesKey, new Uint8Array(16), aesPt)), '69c4e0d86a7b0430d8cdb78070b4c55a', 'aes-128 FIPS 向量');
  });
  t('pdf-protect 加密后需密码打开，pdf-unlock 解密还原', async () => {
    const f = await makePdfFile('sec.pdf', ['SECRET-CONTENT-ALPHA', 'SECRET-CONTENT-BETA']);
    const r1 = await runTool('pdf-protect', [f], { password: 'pw123' });
    eq(r1.length, 1, '加密输出数');
    const encBytes = new Uint8Array(await r1[0].blob.arrayBuffer());
    let needPwd = false;
    try { await pdfjsLib.getDocument({ data: encBytes.slice() }).promise; } catch (e) { needPwd = true; }
    assert(needPwd, '无密码时 PDF.js 应要求密码');
    const dd = await pdfjsLib.getDocument({ data: encBytes.slice(), password: 'pw123' }).promise;
    const tc = await (await dd.getPage(1)).getTextContent();
    assert(tc.items.map(i => i.str).join('').includes('SECRET-CONTENT-ALPHA'), 'PDF.js 解密后文字正确');
    const encFile = new File([encBytes], 'sec_enc.pdf', { type: 'application/pdf' });
    const r2 = await runTool('pdf-unlock', [encFile], { password: 'pw123' });
    const txts = await pageTexts(r2[0].blob);
    assert(txts.join(' ').includes('SECRET-CONTENT-ALPHA'), '解锁后文字正确');
    eq((await pdfInfo(r2[0].blob)).pages, 2, '解锁后页数不变');
    let threw = false;
    try { await runTool('pdf-unlock', [encFile], { password: 'wrong' }); } catch (e) { threw = true; }
    assert(threw, '错误密码应报错');
  });
  t('解密: pypdf RC4/AES 外部样本', async () => {
    assert(ENC_FIXTURES, '加密样本数据缺失');
    const cases = [['fx_rc4_pw', 'pw123'], ['fx_rc4_empty', ''], ['fx_aes128_pw', 'pw123'], ['fx_aes256_pw', 'pw123']];
    for (const [name, pwd] of cases) {
      const raw = atob(ENC_FIXTURES[name]);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const f = new File([bytes], name + '.pdf', { type: 'application/pdf' });
      const r = await runTool('pdf-unlock', [f], { password: pwd });
      const txts = await pageTexts(r[0].blob);
      assert(txts.join(' ').includes('AES-FIXTURE-MARKER'), name + ' 解密后应含标记');
    }
  });
  t('PDF 转 Word/Excel/HTML', async () => {
    const f = await makePdfFile('conv.pdf', ['CONVERT-TEXT-ALPHA\nLINE-TWO', 'PAGE-TWO-BETA']);
    const rw = await runTool('pdf-to-word', [f]);
    eq(rw[0].name.endsWith('.docx'), true, 'docx 扩展名');
    const wzip = await JSZip.loadAsync(await rw[0].blob.arrayBuffer());
    const docXml = await wzip.file('word/document.xml').async('string');
    assert(docXml.includes('CONVERT-TEXT-ALPHA') && docXml.includes('PAGE-TWO-BETA'), 'docx 内容');
    const rx = await runTool('pdf-to-excel', [f]);
    const xzip = await JSZip.loadAsync(await rx[0].blob.arrayBuffer());
    const sheetXml = await xzip.file('xl/worksheets/sheet1.xml').async('string');
    assert(sheetXml.includes('CONVERT-TEXT-ALPHA'), 'xlsx 内容');
    const rh = await runTool('pdf-to-html', [f]);
    const html = await rh[0].blob.text();
    assert(html.includes('CONVERT-TEXT-ALPHA') && html.includes('class="page"'), 'html 内容');
  });
  t('Word/Excel/PPT 转 PDF', async () => {
    const f = await makePdfFile('w2p.pdf', ['DOCX-PARAGRAPH-ONE', 'DOCX-PARAGRAPH-TWO']);
    const rw = await runTool('pdf-to-word', [f]);
    const docxFile = new File([await rw[0].blob.arrayBuffer()], 'w2p.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const r1 = await runTool('word-to-pdf', [docxFile]);
    assert((await pdfInfo(r1[0].blob)).pages >= 1, 'word-to-pdf 至少 1 页');
    const rx = await runTool('pdf-to-excel', [f]);
    const xlsxFile = new File([await rx[0].blob.arrayBuffer()], 'e2p.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const r2 = await runTool('excel-to-pdf', [xlsxFile]);
    assert((await pdfInfo(r2[0].blob)).pages >= 1, 'excel-to-pdf 至少 1 页');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
    zip.file('ppt/presentation.xml', '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="9144000" cy="5143500"/></p:presentation>');
    zip.file('ppt/slides/slide1.xml', '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="5486400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>SLIDE-TITLE-TEXT</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
    const pptxFile = new File([await zip.generateAsync({ type: 'blob' })], 'demo.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    const r3 = await runTool('ppt-to-pdf', [pptxFile]);
    assert((await pdfInfo(r3[0].blob)).pages >= 1, 'ppt-to-pdf 至少 1 页');
  });

  /* ---------- 第六批：79 项工具全量巡检 + 新增工具深度测试 ---------- */
  const textFile = (name, text, type) => new File([text], name, { type: type || 'text/plain;charset=utf-8' });

  async function makeMetaPdfFile(name) {
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    doc.addPage([400, 600]).drawText('META-DOC', { x: 40, y: 520, size: 22, font });
    doc.setTitle('SecretTitleX'); doc.setAuthor('SecretAuthorX');
    doc.setSubject('SecretSubjectX'); doc.setKeywords(['SecretKeywordX']);
    doc.setProducer('SecretProducerX'); doc.setCreator('SecretCreatorX');
    // 关闭对象流，便于在原始字节中校验元数据是否被彻底移除
    return new File([await doc.save({ useObjectStreams: false })], name, { type: 'application/pdf' });
  }
  const hexUtf16 = s => Array.from(s).map(ch => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();

  async function makeFormPdfFile(name) {
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('FORM-DOC', { x: 40, y: 260, size: 20, font });
    const form = doc.getForm();
    const tf = form.createTextField('username');
    tf.setText('old-value');
    tf.addToPage(page, { x: 40, y: 190, width: 200, height: 24 });
    const cb = form.createCheckBox('agree');
    cb.addToPage(page, { x: 40, y: 150, width: 20, height: 20 });
    const dd = form.createDropdown('city');
    dd.addOptions(['BJ', 'SH']);
    dd.select('BJ');
    dd.addToPage(page, { x: 40, y: 110, width: 120, height: 24 });
    return new File([await doc.save()], name, { type: 'application/pdf' });
  }

  async function makeColoredPdfFile(name) {
    const doc = await PDFLib.PDFDocument.create();
    const page = doc.addPage([200, 200]);
    page.drawRectangle({ x: 20, y: 20, width: 160, height: 160, color: PDFLib.rgb(1, 0, 0) });
    return new File([await doc.save()], name, { type: 'application/pdf' });
  }

  async function makeStyledPdfFile(name) {
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const page = doc.addPage([400, 600]);
    page.drawText('HEADING-BIG', { x: 40, y: 500, size: 30, font });
    page.drawText('body-line-one', { x: 40, y: 440, size: 12, font });
    page.drawText('body-line-two', { x: 40, y: 410, size: 12, font });
    return new File([await doc.save()], name, { type: 'application/pdf' });
  }

  async function makeImageTextPdfFile(name, imgFile) {
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const img = await doc.embedPng(await imgFile.arrayBuffer());
    const page = doc.addPage([400, 600]);
    page.drawText('TEXT-NEAR-IMAGE', { x: 40, y: 520, size: 20, font });
    page.drawImage(img, { x: 50, y: 200, width: 200, height: 120 });
    return new File([await doc.save()], name, { type: 'application/pdf' });
  }

  function makeGifFile(name) {
    const b64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new File([bytes], name, { type: 'image/gif' });
  }

  const makeSvgFile = name => new File([
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect x="0" y="0" width="120" height="90" fill="#3366cc"/></svg>'
  ], name, { type: 'image/svg+xml' });

  async function makeNoiseImageFile(name, w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    const id = c.createImageData(w, h);
    let seed = 12345;
    for (let i = 0; i < id.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      id.data[i] = seed & 255; id.data[i + 1] = (seed >> 8) & 255;
      id.data[i + 2] = (seed >> 16) & 255; id.data[i + 3] = 255;
    }
    c.putImageData(id, 0, 0);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    return new File([blob], name, { type: 'image/png' });
  }

  async function renderPdfCanvas(blob, pageNum, scale) {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    const page = await doc.getPage(pageNum || 1);
    const vp = page.getViewport({ scale: scale || 1 });
    const cv = document.createElement('canvas');
    cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
    const ctx = cv.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return cv;
  }
  function darkPixels(cv) {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 600) n++;
    return n;
  }
  function pixel(cv, x, y) {
    return Array.from(cv.getContext('2d').getImageData(x, y, 1, 1).data).slice(0, 3);
  }
  function assertOutputs(list, what) {
    assert(Array.isArray(list) && list.length > 0, what + ' 输出为空');
    for (const o of list) {
      assert(o.blob && o.blob.size > 0, what + ' 输出文件为空: ' + (o && o.name));
      assert(o.name && !/undefined|NaN/.test(o.name), what + ' 输出文件名异常: ' + o.name);
    }
  }

  let _fx = null;
  async function FX() {
    if (_fx) return _fx;
    const pdf1 = await makePdfFile('one.pdf', ['SINGLE-PAGE-ALPHA']);
    const pdf2 = await makePdfFile('two.pdf', ['SECOND-DOC-BETA']);
    const pdf3 = await makePdfFile('three.pdf', ['PAGE-ONE-ALPHA', 'PAGE-TWO-BETA', 'PAGE-THREE-GAMMA']);
    const png = await makeImageFile('image/png', 120, 90, 'pic.png');
    const jpeg = await makeImageFile('image/jpeg', 100, 80, 'pic.jpg');
    const docxBlob = (await runTool('pdf-to-word', [pdf1]))[0].blob;
    const xlsxBlob = (await runTool('pdf-to-excel', [pdf1]))[0].blob;
    const pptxBlob = (await runTool('pdf-to-ppt', [pdf1], { dpi: '96' }))[0].blob;
    const encBlob = (await runTool('pdf-protect', [pdf1], { password: 'pw' }))[0].blob;
    _fx = {
      pdf1, pdf2, pdf3, png, jpeg,
      webp: await makeImageFile('image/webp', 90, 70, 'pic.webp'),
      svg: makeSvgFile('pic.svg'), gif: makeGifFile('pic.gif'),
      metaPdf: await makeMetaPdfFile('meta.pdf'),
      formPdf: await makeFormPdfFile('form.pdf'),
      styledPdf: await makeStyledPdfFile('styled.pdf'),
      coloredPdf: await makeColoredPdfFile('colored.pdf'),
      imagePdf: await makeImageTextPdfFile('withimg.pdf', png),
      attachPdf: await makeAttachmentPdf('att.pdf'),
      docx: new File([await docxBlob.arrayBuffer()], 'doc.docx', { type: docxBlob.type }),
      xlsx: new File([await xlsxBlob.arrayBuffer()], 'sheet.xlsx', { type: xlsxBlob.type }),
      pptx: new File([await pptxBlob.arrayBuffer()], 'slides.pptx', { type: pptxBlob.type }),
      encrypted: new File([await encBlob.arrayBuffer()], 'enc.pdf', { type: 'application/pdf' }),
      txt: textFile('note.txt', 'HELLO TEXT FILE\nSECOND LINE'),
      md: textFile('note.md', '# Heading\n- item one\nplain text'),
      csv: textFile('grid.csv', 'name,age\nAlice,30\nBob,25'),
      html: textFile('page.html', '<html><body><h1>Title</h1><p>Hello <b>World</b></p></body></html>', 'text/html'),
      htmlPlain: textFile('plain.html', '<html><body><p>Hello</p></body></html>', 'text/html'),
    };
    return _fx;
  }

  t('巡检: 全部工具逐项执行（默认分支全覆盖）', async () => {
    const fx = await FX();
    const P = [fx.pdf3], I = [fx.png];
    const cfg = {
      'pdf-merge': { files: [fx.pdf1, fx.pdf2] },
      'pdf-split': { files: P },
      'pdf-pages': { files: P, opts: { mode: 'extract', range: '1-2' } },
      'pdf-rotate': { files: P },
      'pdf-pagenum': { files: P },
      'pdf-textwm': { files: P, opts: { text: 'WM' } },
      'pdf-imgwm': { files: P, opts: { seal: fx.png } },
      'pdf-compress': { files: P, opts: { level: 'light' } },
      'pdf-blank': { files: P, opts: { mode: 'report' } },
      'pdf-spread': { files: P },
      'pdf-nup': { files: P },
      'pdf-to-img': { files: [fx.pdf1], opts: { dpi: '72' } },
      'img-to-pdf': { files: I },
      'pdf-to-text': { files: P },
      'pdf-meta': { files: P, opts: { title: 'T' } },
      'img-convert': { files: I, opts: { format: 'webp' } },
      'img-compress': { files: I },
      'img-resize': { files: I },
      'img-rotate': { files: I },
      'img-watermark': { files: I },
      'img-merge': { files: [fx.png, fx.jpeg] },
      'img-crop': { files: I, opts: { mode: 'ratio', ratio: '1:1' } },
      'img-split': { files: I, opts: { mode: 'grid', rows: '2', cols: '2' } },
      'img-editor': { files: I, opts: { preset: 'vintage', sharpen: '70' } },
      'img-meme': { files: I, opts: { top: 'TOP', bottom: 'BOTTOM' } },
      'img-upscale': { files: I, opts: { scale: '2', sharpen: '80' } },
      'img-remove-bg': { files: I, opts: { mode: 'edge', tolerance: '30' } },
      'img-exif': { files: [fx.jpeg], opts: { mode: 'report' } },
      'img-compress-size': { files: [fx.jpeg], opts: { target: '40' } },
      'img-base64': { files: I, opts: { mode: 'to' } },
      'img-rename': { files: I },
      'img-info': { files: I },
      'img-dpi': { files: [fx.jpeg] },
      'img-frame': { files: I },
      'img-mask': { files: I },
      'img-idphoto': { files: I, opts: { size: '1', paper: '6', dpi: '150' } },
      'img-to-ico': { files: I, opts: { sizes: 'common' } },
      'img-compare': { files: [fx.png, fx.jpeg] },
      'img-to-word': { files: I },
      'pdf-crop': { files: P },
      'pdf-autorotate': { files: P },
      'pdf-booklet': { files: P },
      'pdf-longpage': { files: P },
      'pdf-page-size': { files: P },
      'pdf-overlay': { files: P, opts: { over: fx.pdf1 } },
      'pdf-add-text': { files: P },
      'pdf-add-image': { files: P, opts: { img: fx.png } },
      'pdf-extract-images': { files: [fx.imagePdf] },
      'pdf-scanfx': { files: [fx.pdf1], opts: { dpi: '72' } },
      'pdf-remove-annots': { files: [fx.attachPdf] },
      'pdf-sanitize': { files: [fx.attachPdf] },
      'pdf-flatten': { files: [fx.pdf1], opts: { dpi: '72' } },
      'pdf-compare': { files: [fx.pdf1, fx.pdf2] },
      'pdf-info': { files: [fx.metaPdf] },
      'pdf-auto-rename': { files: [fx.pdf1], opts: { source: 'firstline' } },
      'pdf-attachments': { files: [fx.attachPdf], opts: { mode: 'extract' } },
      'pdf-unlock': { files: [fx.encrypted], opts: { password: 'pw' } },
      'pdf-protect': { files: [fx.pdf1], opts: { password: 'pw' } },
      'pdf-to-word': { files: P },
      'pdf-to-excel': { files: P },
      'pdf-to-html': { files: P },
      'word-to-pdf': { files: [fx.docx] },
      'excel-to-pdf': { files: [fx.xlsx] },
      'ppt-to-pdf': { files: [fx.pptx] },
      'pdf-reorder': { files: P, opts: { mode: 'reverse' } },
      'pdf-clean-meta': { files: [fx.metaPdf] },
      'pdf-grayscale': { files: [fx.pdf1], opts: { scale: '1.5' } },
      'pdf-longimg': { files: P, opts: { dpi: '72' } },
      'pdf-to-ppt': { files: [fx.pdf1], opts: { dpi: '96' } },
      'pdf-to-md': { files: [fx.styledPdf] },
      'pdf-to-csv': { files: P },
      'pdf-to-rtf': { files: P },
      'pdf-repair': { files: [fx.pdf1], opts: { mode: 'resave' } },
      'pdf-form-fill': { files: [fx.formPdf], opts: { mode: 'list' } },
      'pdf-sign': { files: P, opts: { mode: 'text' } },
      'pdf-redact': { files: P, opts: { rects: '1:0,0,10,10', mode: 'cover' } },
      'pdf-header-footer': { files: P },
      'pdf-del-images': { files: [fx.imagePdf] },
      'text-to-pdf': { files: [fx.txt] },
    };
    const failures = [];
    for (const tool of T.TOOLS) {
      const c = cfg[tool.id];
      if (!c) { failures.push(tool.id + ': 缺少巡检配置'); continue; }
      try {
        const r = await runTool(tool.id, c.files, c.opts);
        assertOutputs(r, tool.id);
      } catch (e) {
        failures.push(tool.id + ': ' + (e && e.message ? e.message : String(e)));
      }
    }
    assert(failures.length === 0, '巡检失败项：' + failures.join(' | '));
    return '覆盖 ' + T.TOOLS.length + ' 项';
  });

  /* --- 对齐 iloveimg / imagestool 新增的图片增强工具 --- */
  /* 构造一张带标准 APP1(EXIF) 的 JPEG：制造商 TestCam、型号 X100 */
  async function makeExifJpeg(name) {
    const src = new Uint8Array(await (await makeImageFile('image/jpeg', 80, 60, 'exif-src.jpg')).arrayBuffer());
    const tiff = new Uint8Array(51);
    const dv = new DataView(tiff.buffer);
    tiff[0] = 0x49; tiff[1] = 0x49;
    dv.setUint16(2, 42, true);
    dv.setUint32(4, 8, true);
    dv.setUint16(8, 2, true);
    dv.setUint16(10, 0x010F, true); dv.setUint16(12, 2, true); dv.setUint32(14, 8, true); dv.setUint32(18, 38, true);
    dv.setUint16(22, 0x0110, true); dv.setUint16(24, 2, true); dv.setUint32(26, 5, true); dv.setUint32(30, 46, true);
    dv.setUint32(34, 0, true);
    const put = (offset, text) => { for (let i = 0; i < text.length; i++) tiff[offset + i] = text.charCodeAt(i); };
    put(38, 'TestCam\0');
    put(46, 'X100\0');
    const seg = new Uint8Array(2 + 2 + 6 + tiff.length);
    seg[0] = 0xFF; seg[1] = 0xE1;
    new DataView(seg.buffer).setUint16(2, 2 + 6 + tiff.length, false);
    seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
    seg.set(tiff, 10);
    const out = new Uint8Array(src.length + seg.length);
    out.set(src.subarray(0, 2), 0);
    out.set(seg, 2);
    out.set(src.subarray(2), 2 + seg.length);
    return new File([out], name, { type: 'image/jpeg' });
  }

  t('新增: img-crop 比例 / 像素区域 / 自动去边', async () => {
    const i = await makeImageFile('image/png', 300, 100, 'crop.png');
    const sq = await runTool('img-crop', [i], { mode: 'ratio', ratio: '1:1', anchor: 'center', format: 'png' });
    const info = await imgInfo(sq[0].blob);
    arrEq([info.w, info.h], [100, 100], '1:1 居中裁剪');
    const rect = await runTool('img-crop', [i], { mode: 'rect', rect: '10,20,50,40', format: 'png' });
    const info2 = await imgInfo(rect[0].blob);
    arrEq([info2.w, info2.h], [50, 40], '自定义像素区域');
    const cv = document.createElement('canvas');
    cv.width = 200; cv.height = 160;
    const c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 200, 160);
    c.fillStyle = '#cc3333'; c.fillRect(40, 40, 120, 80);
    const border = new File([await new Promise(res => cv.toBlob(res, 'image/png'))], 'border.png', { type: 'image/png' });
    const trimmed = await runTool('img-crop', [border], { mode: 'trim', tolerance: 20, sides: 'all', format: 'png' });
    const info3 = await imgInfo(trimmed[0].blob);
    arrEq([info3.w, info3.h], [120, 80], '自动去白边');
    let threw = false;
    try { await runTool('img-crop', [i], { mode: 'rect', rect: '' }); } catch (e) { threw = true; }
    assert(threw, '缺少像素区域应报错');
  });
  t('新增: img-split 行列等分与固定尺寸', async () => {
    const i = await makeImageFile('image/png', 200, 100, 'split.png');
    const r = await runTool('img-split', [i], { mode: 'grid', rows: '2', cols: '3' });
    eq(r.length, 6, '切成 6 块');
    const info = await imgInfo(r[0].blob);
    arrEq([info.w, info.h], [67, 50], '首块尺寸');
    const bySize = await runTool('img-split', [i], { mode: 'size', tileW: '80', tileH: '60' });
    eq(bySize.length, 6, '按固定尺寸切块数');
  });
  t('新增: img-remove-bg 纯色背景转透明 PNG', async () => {
    const i = await makeImageFile('image/png', 100, 100, 'bg.png');
    const r = await runTool('img-remove-bg', [i], { mode: 'edge', tolerance: 10, feather: 0 });
    const cv = await blobCanvas(r[0].blob);
    eq(cv.getContext('2d').getImageData(1, 1, 1, 1).data[3], 0, '角落背景应完全透明');
    eq(cv.getContext('2d').getImageData(30, 30, 1, 1).data[3], 255, '中心色块应保留');
  });
  t('新增: img-editor 滤镜 / 锐化 / 暗角', async () => {
    const i = await makeImageFile('image/png', 120, 90, 'ed.png');
    const r = await runTool('img-editor', [i], { preset: 'grayscale', sharpen: '70', vignette: true, format: 'png' });
    const cv = await blobCanvas(r[0].blob);
    arrEq([cv.width, cv.height], [120, 90], '尺寸不变');
    const px = pixel(cv, 10, 10);
    assert(Math.abs(px[0] - px[1]) <= 2 && Math.abs(px[1] - px[2]) <= 2, '应为灰度像素: ' + px);
  });
  t('新增: img-meme 上下配文', async () => {
    const i = await makeImageFile('image/png', 400, 300, 'meme.png');
    const r = await runTool('img-meme', [i], { top: '上排文字', bottom: '下排文字', fontPct: 10, strokePct: 7 });
    const cv = await blobCanvas(r[0].blob);
    arrEq([cv.width, cv.height], [400, 300], '尺寸不变');
    const d = cv.getContext('2d').getImageData(0, 0, 400, 60).data;
    let white = 0;
    for (let p = 0; p < d.length; p += 4) if (d[p] > 240 && d[p + 1] > 240 && d[p + 2] > 240) white++;
    assert(white > 50, '顶部应绘制出白色文字像素: ' + white);
    let threw = false;
    try { await runTool('img-meme', [i], { top: '', bottom: '' }); } catch (e) { threw = true; }
    assert(threw, '空文字应报错');
  });
  t('新增: img-upscale 放大倍数', async () => {
    const i = await makeImageFile('image/png', 100, 60, 'up.png');
    const r2 = await runTool('img-upscale', [i], { scale: '2', sharpen: '80', format: 'png' });
    const info2 = await imgInfo(r2[0].blob);
    arrEq([info2.w, info2.h], [200, 120], '放大 2 倍');
    const r15 = await runTool('img-upscale', [i], { scale: '1.5', sharpen: '0', format: 'png' });
    const info15 = await imgInfo(r15[0].blob);
    arrEq([info15.w, info15.h], [150, 90], '放大 1.5 倍');
  });
  t('新增: img-compress-size 压缩到目标体积', async () => {
    const i = await makeNoiseImageFile('target.png', 500, 400);
    const r = await runTool('img-compress-size', [i], { target: '40', format: 'jpeg' });
    assert(r[0].blob.size <= 40 * 1024, '输出应不超过 40 KB，实际 ' + r[0].blob.size);
  });
  t('新增: img-exif 读取 / 清除 / 压缩后保留', async () => {
    const exifJpeg = await makeExifJpeg('exif.jpg');
    const report = await runTool('img-exif', [exifJpeg], { mode: 'report' });
    const text = await report[0].blob.text();
    assert(text.includes('TestCam') && text.includes('X100'), '应读出制造商与型号: ' + text.slice(0, 300));
    const stripped = await runTool('img-exif', [exifJpeg], { mode: 'strip', format: 'jpeg' });
    const again = await runTool('img-exif', [new File([stripped[0].blob], 's.jpg', { type: 'image/jpeg' })], { mode: 'report' });
    const cleared = await again[0].blob.text();
    assert(!cleared.includes('TestCam') && cleared.includes('未检测到'), '应清除元数据: ' + cleared.slice(0, 300));
    const kept = await runTool('img-compress', [exifJpeg], { quality: 60, maxWidth: 0, maxHeight: 0, format: 'jpeg', keepExif: true });
    const keptReport = await runTool('img-exif', [new File([kept[0].blob], 'k.jpg', { type: 'image/jpeg' })], { mode: 'report' });
    assert((await keptReport[0].blob.text()).includes('TestCam'), '压缩后应保留 EXIF');
  });

  /* --- 办公图片常见功能补齐 --- */
  t('新增: img-base64 双向转换与纯文本输入', async () => {
    const i = await makeImageFile('image/png', 120, 90, 'b64.png');
    const enc = await runTool('img-base64', [i], { mode: 'to', dataUrl: true, wrap: 0, format: 'keep' });
    const text = await enc[0].blob.text();
    assert(text.startsWith('data:image/png;base64,'), '应输出 data URL');
    const dec = await runTool('img-base64', [], { mode: 'from', paste: text });
    eq(dec[0].name, 'Base64解码图片.png', '解码扩展名');
    const info = await imgInfo(dec[0].blob);
    arrEq([info.w, info.h], [120, 90], '还原后尺寸');
    const txtFile = new File([await enc[0].blob.arrayBuffer()], 'enc.txt', { type: 'text/plain' });
    const dec2 = await runTool('img-base64', [txtFile], { mode: 'from', paste: '' });
    eq((await imgInfo(dec2[0].blob)).w, 120, '从 .txt 文件还原');
    const plain = await runTool('img-base64', [i], { mode: 'to', dataUrl: false, wrap: 76 });
    const plainText = await plain[0].blob.text();
    assert(!plainText.includes('data:') && plainText.includes('\n'), '纯 Base64 应无前缀且自动换行');
  });
  t('新增: img-rename 模板 / 补零 / 重名去重', async () => {
    const a = await makeImageFile('image/png', 20, 10, 'a.png');
    const b = await makeImageFile('image/png', 20, 10, 'b.PNG');
    const r = await runTool('img-rename', [a, b], { pattern: '扫描_{n}_{w}x{h}', start: 1, digits: 3, extCase: 'lower' });
    eq(r[0].name, '扫描_001_20x10.png', '第一张命名');
    eq(r[1].name, '扫描_002_20x10.png', '第二张命名与扩展名小写');
    const dup = await runTool('img-rename', [a, b], { pattern: '同名', start: 1, digits: 2, extCase: 'lower' });
    eq(dup[0].name, '同名.png', '重名第一张');
    eq(dup[1].name, '同名(2).png', '重名自动加序号');
  });
  t('新增: img-info CSV / JSON 素材清单', async () => {
    const i = await makeImageFile('image/png', 120, 60, '清单.png');
    const csv = await runTool('img-info', [i], { format: 'csv' });
    const text = await csv[0].blob.text();
    const head = new Uint8Array(await csv[0].blob.arrayBuffer()).subarray(0, 3);
    arrEq([head[0], head[1], head[2]], [0xEF, 0xBB, 0xBF], 'CSV 应带 UTF-8 BOM');
    assert(text.includes('清单.png') && text.includes('2.000'), 'CSV 含文件名与宽高比');
    const json = await runTool('img-info', [i], { format: 'json' });
    const list = JSON.parse(await json[0].blob.text());
    eq(list.length, 1, 'JSON 行数');
    eq(list[0]['宽(px)'], 120, 'JSON 宽度');
  });
  t('新增: img-dpi 写入 JPEG / PNG 分辨率元数据', async () => {
    const jpg = await makeImageFile('image/jpeg', 80, 60, 'd.jpg');
    const r1 = await runTool('img-dpi', [jpg], { dpi: 300, format: 'keep' });
    const b1 = new Uint8Array(await r1[0].blob.arrayBuffer());
    const d1 = new DataView(b1.buffer);
    let units = 0, density = 0;
    for (let p = 2; p + 16 < b1.length;) {
      if (b1[p] !== 0xFF) { p++; continue; }
      const m = b1[p + 1];
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
      if (m === 0xDA || m === 0xD9) break;
      if (m === 0xE0) { units = b1[p + 11]; density = d1.getUint16(p + 12, false); break; }
      p += 2 + d1.getUint16(p + 2, false);
    }
    eq(units, 1, 'JFIF 单位应为 DPI');
    eq(density, 300, 'JFIF Xdensity');
    const png = await makeImageFile('image/png', 80, 60, 'd.png');
    const r2 = await runTool('img-dpi', [png], { dpi: 200, format: 'keep' });
    const b2 = new Uint8Array(await r2[0].blob.arrayBuffer());
    const d2 = new DataView(b2.buffer);
    let ppm = 0;
    for (let p = 8; p + 12 < b2.length;) {
      const len = d2.getUint32(p, false);
      const type = String.fromCharCode(b2[p + 4], b2[p + 5], b2[p + 6], b2[p + 7]);
      if (type === 'pHYs') { ppm = d2.getUint32(p + 8, false); break; }
      if (type === 'IDAT' || type === 'IEND') break;
      p += 12 + len;
    }
    eq(ppm, Math.round(200 / 0.0254), 'PNG pHYs 像素/米');
  });
  t('新增: img-frame 留白 / 圆形头像', async () => {
    const i = await makeImageFile('image/png', 100, 80, 'f.png');
    const r = await runTool('img-frame', [i], { pad: 10, shape: 'none', format: 'png' });
    const info = await imgInfo(r[0].blob);
    arrEq([info.w, info.h], [120, 100], '四周留白后的尺寸');
    const circle = await runTool('img-frame', [i], { pad: 0, shape: 'circle', transparentBg: true, format: 'png' });
    const ci = await imgInfo(circle[0].blob);
    arrEq([ci.w, ci.h], [80, 80], '圆形模式居中裁剪为正方形');
    const cv = await blobCanvas(circle[0].blob);
    eq(cv.getContext('2d').getImageData(1, 1, 1, 1).data[3], 0, '圆形四角应透明');
  });
  t('新增: img-mask 马赛克 / 涂黑 / 非法区域', async () => {
    const i = await makeNoiseImageFile('mask.png', 60, 60);
    const r = await runTool('img-mask', [i], { rects: '0,0,60,30', mode: 'mosaic', block: 10 });
    const d = (await blobCanvas(r[0].blob)).getContext('2d').getImageData(0, 0, 60, 60).data;
    const p2 = (5 * 60 + 5) * 4;
    arrEq([d[0], d[1], d[2]], [d[p2], d[p2 + 1], d[p2 + 2]], '同一马赛克块颜色一致');
    let varied = 0;
    for (let x = 1; x < 60; x++) {
      const a = (40 * 60 + x) * 4, b = a - 4;
      if (d[a] !== d[b]) varied++;
    }
    assert(varied > 10, '未打码区域应保留细节');
    const solid = await runTool('img-mask', [i], { rects: '10%,10%,30,30', mode: 'solid', color: '#000000' });
    const px = (await blobCanvas(solid[0].blob)).getContext('2d').getImageData(10, 10, 1, 1).data;
    arrEq([px[0], px[1], px[2]], [0, 0, 0], '纯色遮盖');
    let threw = false;
    try { await runTool('img-mask', [i], { rects: 'bad', mode: 'mosaic' }); } catch (e) { threw = true; }
    assert(threw, '非法区域格式应报错');
  });
  t('新增: img-idphoto 相纸排版', async () => {
    const i = await makeImageFile('image/png', 200, 300, 'p.png');
    const r = await runTool('img-idphoto', [i], { size: '1', paper: '6', dpi: '150', bg: 'keep', count: '4', gap: '1' });
    const info = await imgInfo(r[0].blob);
    eq(info.w, Math.round(152 / 25.4 * 150), '6 寸相纸宽度');
    assert(r[0].meta.includes('4 张'), '排版张数: ' + r[0].meta);
    const a4 = await runTool('img-idphoto', [i], { size: '2', paper: 'a4', dpi: '150', bg: 'keep', count: '0' });
    eq((await imgInfo(a4[0].blob)).h, Math.round(297 / 25.4 * 150), 'A4 相纸高度');
  });
  t('新增: img-to-ico 多尺寸图标容器', async () => {
    const i = await makeImageFile('image/png', 120, 100, 'icon.png');
    const r = await runTool('img-to-ico', [i], { sizes: 'all', fit: 'crop' });
    eq(r[0].name.endsWith('.ico'), true, '扩展名');
    const b = new Uint8Array(await r[0].blob.arrayBuffer());
    const dv = new DataView(b.buffer);
    arrEq([dv.getUint16(0, true), dv.getUint16(2, true), dv.getUint16(4, true)], [0, 1, 6], 'ICO 头与图标数');
    eq(b[6], 16, '第 1 个图标 16px');
    eq(b[22], 32, '第 2 个图标 32px');
    eq(b[86], 0, '256px 在目录中记为 0');
    eq(b[dv.getUint32(18, true)], 0x89, '内嵌数据为 PNG 签名');
  });
  t('新增: img-compare 并排 / 差异高亮', async () => {
    const a = await makeImageFile('image/png', 100, 80, 'ca.png');
    const b = await makeImageFile('image/png', 100, 80, 'cb.png');
    const side = await runTool('img-compare', [a, b], { mode: 'side', labels: true, tolerance: 12 });
    eq(side.length, 2, '输出对比图与报告');
    const info = await imgInfo(side[0].blob);
    arrEq([info.w, info.h], [216, 114], '并排画布尺寸');
    const same = await runTool('img-compare', [a, a], { mode: 'diff', tolerance: 0, labels: false });
    const report = await same[1].blob.text();
    assert(report.includes('0 / 8000'), '同图差异应为 0: ' + report);
  });
  t('新增: img-to-word 生成可解析的 docx', async () => {
    const a = await makeImageFile('image/png', 120, 90, 'w1.png');
    const b = await makeImageFile('image/jpeg', 100, 80, 'w2.jpg');
    const r = await runTool('img-to-word', [a, b], { widthCm: 12, title: '图片台账', caption: true, pageBreak: true, format: 'keep' });
    eq(r[0].name, '图片文档.docx', '输出文件名');
    const zip = await JSZip.loadAsync(await r[0].blob.arrayBuffer());
    assert(zip.file('word/document.xml'), '缺少 document.xml');
    assert(zip.file('word/media/image1.png'), '缺少第一张 PNG');
    assert(zip.file('word/media/image2.jpg'), '缺少第二张 JPG');
    const doc = await zip.file('word/document.xml').async('string');
    assert(doc.includes('图片台账') && doc.includes('w1.png') && doc.includes('w:br'), '标题/文件名/分页');
    const rels = await zip.file('word/_rels/document.xml.rels').async('string');
    assert(rels.includes('rId1') && rels.includes('rId2'), '图片关系');
    const dom = new DOMParser().parseFromString(doc, 'application/xml');
    eq(dom.getElementsByTagName('parsererror').length, 0, 'document.xml 应为良构 XML');
  });
  t('新增: img-to-word 生成 Excel 且 XML 转义正确', async () => {
    const png = await makeImageFile('image/png', 30, 20, 'x.png');
    const weird = new File([await png.arrayBuffer()], 'A&B <测试>.png', { type: 'image/png' });
    const r = await runTool('img-to-word', [weird], { target: 'xlsx', widthCm: 8, caption: true, format: 'keep' });
    eq(r[0].name, '图片台账.xlsx', '输出文件名');
    const zip = await JSZip.loadAsync(await r[0].blob.arrayBuffer());
    assert(zip.file('xl/media/image1.png'), '缺少媒体图片');
    assert(zip.file('xl/drawings/drawing1.xml'), '缺少 drawing 部件');
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    const dom = new DOMParser().parseFromString(sheet, 'application/xml');
    eq(dom.getElementsByTagName('parsererror').length, 0, 'sheet1.xml 应为良构 XML');
    assert(sheet.includes('A&amp;B &lt;测试&gt;'), '文件名应做 XML 转义');
    const drawing = await zip.file('xl/drawings/drawing1.xml').async('string');
    assert(drawing.includes('oneCellAnchor') && drawing.includes('r:embed'), '图片锚点与关系');
  });
  t('新增: img-watermark Logo 水印与 img-merge 宫格拼图', async () => {
    const i = await makeImageFile('image/png', 200, 150, 'w.png');
    const logo = await makeImageFile('image/png', 40, 40, 'logo.png');
    const wm = await runTool('img-watermark', [i], { wmType: 'image', logo, mode: 'corner', logoScale: 25, logoOpacity: 0.8 });
    eq((await imgInfo(wm[0].blob)).w, 200, 'Logo 水印不改变尺寸');
    const a = await makeImageFile('image/png', 100, 80, 'g1.png');
    const b = await makeImageFile('image/png', 100, 80, 'g2.png');
    const c = await makeImageFile('image/png', 100, 80, 'g3.png');
    const grid = await runTool('img-merge', [a, b, c], { direction: 'grid', cols: '2', gap: '10', cellFit: 'contain' });
    const info = await imgInfo(grid[0].blob);
    arrEq([info.w, info.h], [210, 170], '2 列宫格尺寸');
  });
  t('UI: 纯文本输入工具无需选择文件即可运行', async () => {
    openToolByName('Base64', '图片与 Base64 互转');
    const png = await makeImageFile('image/png', 20, 20, 'q.png');
    const enc = await runTool('img-base64', [png], { mode: 'to', dataUrl: true });
    setOpt('mode', 'from');
    setOpt('paste', await enc[0].blob.text());
    alerts.length = 0;
    el('wsRunBtn').click();
    await waitFor(() => !el('wsResultsSection').hidden || alerts.length > 0, 30000, '处理完成');
    assert(el('wsResultsSection').hidden === false, '结果区显示, alerts=' + JSON.stringify(alerts));
    eq(el('wsResultsGrid').querySelectorAll('.preview-card').length, 1, '结果卡片数');
    el('wsBackBtn').click();
    resetSearch();
  });

  /* --- 新增工具深度测试 --- */
  t('新增: pdf-reorder 自定义顺序/逆序/重复页', async () => {
    const f = await makePdfFile('ro.pdf', ['P1', 'P2', 'P3']);
    const r1 = await runTool('pdf-reorder', [f], { mode: 'custom', order: '3,1,2,1' });
    arrEq(await pageTexts(r1[0].blob), ['P3', 'P1', 'P2', 'P1'], '自定义顺序含重复页');
    const r2 = await runTool('pdf-reorder', [f], { mode: 'reverse', order: '' });
    arrEq(await pageTexts(r2[0].blob), ['P3', 'P2', 'P1'], '整份倒序');
    let threw = false;
    try { await runTool('pdf-reorder', [f], { mode: 'custom', order: '' }); } catch (e) { threw = true; }
    assert(threw, '空顺序应给出错误提示');
  });
  t('新增: pdf-clean-meta 彻底清除文档属性', async () => {
    const fx = await FX();
    const before = new TextDecoder('latin1').decode(await fx.metaPdf.arrayBuffer());
    assert(before.includes(hexUtf16('SecretTitleX')), '样本应含敏感元数据');
    const r = await runTool('pdf-clean-meta', [fx.metaPdf], { resetId: true });
    const doc = await PDFLib.PDFDocument.load(await r[0].blob.arrayBuffer());
    eq(doc.getTitle() || '', '', '标题');
    eq(doc.getAuthor() || '', '', '作者');
    eq(doc.getSubject() || '', '', '主题');
    // 展开对象流，确认原始字节里也没有残留的孤立元数据对象
    const verify = await PDFLib.PDFDocument.load(await r[0].blob.arrayBuffer());
    const after = new TextDecoder('latin1').decode(await verify.save({ useObjectStreams: false }));
    assert(!after.includes(hexUtf16('SecretTitleX')), '输出中不应残留标题');
    assert(!after.includes(hexUtf16('SecretAuthorX')), '输出中不应残留作者');
  });
  t('新增: pdf-grayscale 彩色页转灰度', async () => {
    const fx = await FX();
    const r = await runTool('pdf-grayscale', [fx.coloredPdf], { scale: '1.5', quality: 85 });
    eq((await pdfInfo(r[0].blob)).pages, 1, '页数');
    const cv = await renderPdfCanvas(r[0].blob, 1, 1);
    const [red, green, blue] = pixel(cv, 100, 100);
    assert(Math.abs(red - green) <= 6 && Math.abs(green - blue) <= 6, `灰度像素应 R=G=B，实际 ${[red, green, blue]}`);
    assert(red < 250, '彩色区域不应变成纯白');
  });
  t('新增: pdf-longimg 方向/范围/PNG 格式', async () => {
    const f = await makePdfFile('li.pdf', ['P1', 'P2', 'P3']);
    const v = await runTool('pdf-longimg', [f], { format: 'jpeg', dpi: '72', direction: 'vertical', range: '' });
    arrEq([(await imgInfo(v[0].blob)).w, (await imgInfo(v[0].blob)).h], [400, 1800], '纵向长图');
    const h = await runTool('pdf-longimg', [f], { format: 'jpeg', dpi: '72', direction: 'horizontal', range: '' });
    arrEq([(await imgInfo(h[0].blob)).w, (await imgInfo(h[0].blob)).h], [1200, 600], '横向长图');
    const p = await runTool('pdf-longimg', [f], { format: 'png', dpi: '72', direction: 'vertical', range: '2-3' });
    eq(p[0].blob.type, 'image/png', 'PNG 格式');
    arrEq([(await imgInfo(p[0].blob)).w, (await imgInfo(p[0].blob)).h], [400, 1200], '范围限定');
  });
  t('新增: pdf-to-ppt 生成有效 PPTX 且能往返转回 PDF 保留内容', async () => {
    const fx = await FX();
    const r = await runTool('pdf-to-ppt', [fx.pdf3], { dpi: '96', quality: 80 });
    assert(r[0].name.endsWith('.pptx'), '扩展名');
    const zip = await JSZip.loadAsync(await r[0].blob.arrayBuffer());
    const names = Object.keys(zip.files);
    for (let i = 1; i <= 3; i++) assert(names.includes(`ppt/slides/slide${i}.xml`), `slide${i}.xml`);
    assert(names.some(n => n.startsWith('ppt/media/')), '应包含页面图片');
    const pptxFile = new File([await r[0].blob.arrayBuffer()], 'round.pptx', { type: r[0].blob.type });
    const back = await runTool('ppt-to-pdf', [pptxFile]);
    eq((await pdfInfo(back[0].blob)).pages, 3, '往返页数');
    const cv = await renderPdfCanvas(back[0].blob, 1, 1);
    assert(darkPixels(cv) > 200, '往返后页面不应为空白（应保留 PDF 页面内容）');
  });
  t('新增: pdf-to-md 标题层级推断', async () => {
    const fx = await FX();
    const r = await runTool('pdf-to-md', [fx.styledPdf]);
    const md = await r[0].blob.text();
    assert(md.includes('# HEADING-BIG'), '大字号应为一级标题: ' + JSON.stringify(md));
    assert(md.includes('body-line-one'), '正文内容');
    eq(r[0].name, 'styled.md', '输出文件名');
  });
  t('新增: pdf-to-csv BOM/内容/多页分隔', async () => {
    const fx = await FX();
    const r = await runTool('pdf-to-csv', [fx.pdf3]);
    const csv = await r[0].blob.text();
    const bom = new Uint8Array(await r[0].blob.slice(0, 3).arrayBuffer());
    arrEq(Array.from(bom), [0xEF, 0xBB, 0xBF], '应带 UTF-8 BOM');
    assert(csv.includes('PAGE-ONE-ALPHA') && csv.includes('PAGE-TWO-BETA'), '表格内容');
    assert(csv.includes('\r\n'), 'CRLF 换行');
  });
  t('新增: pdf-to-rtf 结构与分页', async () => {
    const fx = await FX();
    const r = await runTool('pdf-to-rtf', [fx.pdf3]);
    const txt = await r[0].blob.text();
    assert(txt.startsWith('{\\rtf1') && txt.endsWith('}'), 'RTF 结构');
    assert(txt.includes('\\par') && txt.includes('\\page'), '段落与分页');
    assert(txt.includes('PAGE-ONE-ALPHA'), '正文内容');
  });
  t('新增: pdf-repair 三种修复方式', async () => {
    const fx = await FX();
    for (const mode of ['resave', 'rebuild', 'auto']) {
      const r = await runTool('pdf-repair', [fx.pdf1], { mode, scale: '1.5' });
      eq((await pdfInfo(r[0].blob)).pages, 1, mode + ' 页数');
      assert(r[0].meta.includes('保存') || r[0].meta.includes('重绘'), mode + ' 说明: ' + r[0].meta);
    }
    const keep = await runTool('pdf-repair', [fx.pdf1], { mode: 'resave' });
    assert((await pageTexts(keep[0].blob))[0].includes('SINGLE-PAGE-ALPHA'), 'resave 应保留文字');
  });
  t('新增: pdf-form-fill 字段清单/填写/扁平化/异常', async () => {
    const fx = await FX();
    const list = await runTool('pdf-form-fill', [fx.formPdf], { mode: 'list' });
    const t = await list[0].blob.text();
    assert(t.includes('username') && t.includes('文本框'), '字段清单: ' + JSON.stringify(t));
    assert(t.includes('agree') && t.includes('复选框'), '复选框字段');
    const fill = await runTool('pdf-form-fill', [fx.formPdf], { mode: 'fill', mapping: 'username=Alice\nagree=true\ncity=SH', flatten: false });
    const doc = await PDFLib.PDFDocument.load(await fill[0].blob.arrayBuffer());
    const form = doc.getForm();
    eq(form.getTextField('username').getText(), 'Alice', '文本字段值');
    assert(form.getCheckBox('agree').isChecked(), '复选框已勾选');
    eq(form.getDropdown('city').getSelected()[0], 'SH', '下拉框选中值');
    const flat = await runTool('pdf-form-fill', [fx.formPdf], { mode: 'fill', mapping: 'username=Bob', flatten: true });
    const doc2 = await PDFLib.PDFDocument.load(await flat[0].blob.arrayBuffer());
    eq(doc2.getForm().getFields().length, 0, '扁平化后字段数');
    let threw = false;
    try { await runTool('pdf-form-fill', [fx.formPdf], { mode: 'fill', mapping: '' }); } catch (e) { threw = true; }
    assert(threw, '空映射应报错');
  });
  t('新增: pdf-sign 文字/图片签名与缺图报错', async () => {
    const fx = await FX();
    const txt = await runTool('pdf-sign', [fx.pdf3], { mode: 'text', sigText: '张三', pages: '2', position: 'top-left' });
    eq((await pdfInfo(txt[0].blob)).pages, 3, '文字签名页数');
    const img = await runTool('pdf-sign', [fx.pdf3], { mode: 'image', sigFile: fx.png, pages: '', position: 'center' });
    eq((await pdfInfo(img[0].blob)).pages, 3, '图片签名页数');
    let threw = false;
    try { await runTool('pdf-sign', [fx.pdf3], { mode: 'image', sigFile: null }); } catch (e) { threw = true; }
    assert(threw, '缺少签名图片应报错');
  });
  t('新增: pdf-redact 遮盖/固化/格式校验', async () => {
    const f = await makePdfFile('secret.pdf', ['SECRET-MARK-ALPHA']);
    const cover = await runTool('pdf-redact', [f], { rects: '1:0,0,100,20', color: 'black', mode: 'cover' });
    assert((await pageTexts(cover[0].blob)).join('').includes('SECRET-MARK-ALPHA'), 'cover 模式保留文字层');
    const cvCover = await renderPdfCanvas(cover[0].blob, 1, 1);
    const [r0, g0, b0] = pixel(cvCover, 200, 40);
    assert(r0 + g0 + b0 < 120, '遮盖区域应为黑色，实际 ' + [r0, g0, b0]);
    const flat = await runTool('pdf-redact', [f], { rects: '*:0,0,100,20', color: 'black', mode: 'flatten' });
    assert(!(await pageTexts(flat[0].blob)).join('').includes('SECRET-MARK-ALPHA'), '固化后文字不可恢复');
    eq((await pdfInfo(flat[0].blob)).pages, 1, '固化页数');
    let threw = false;
    try { await runTool('pdf-redact', [f], { rects: 'bad-line', mode: 'cover' }); } catch (e) { threw = true; }
    assert(threw, '非法区域格式应报错');
  });
  t('新增: pdf-header-footer 页码变量/跳过首页/空内容报错', async () => {
    const f = await makePdfFile('hf.pdf', ['BODY-A', 'BODY-B']);
    const r = await runTool('pdf-header-footer', [f], { header: 'H-{n}-{file}', footer: '第 {n} 页 / 共 {total} 页', skipFirst: true });
    eq((await pdfInfo(r[0].blob)).pages, 2, '页数');
    const p1 = darkPixels(await renderPdfCanvas(r[0].blob, 1, 1));
    const p2 = darkPixels(await renderPdfCanvas(r[0].blob, 2, 1));
    assert(p2 > p1 + 100, `跳过首页时第 2 页应多出页眉页脚（第一页=${p1}，第二页=${p2}）`);
    let threw = false;
    try { await runTool('pdf-header-footer', [f], { header: '', footer: '' }); } catch (e) { threw = true; }
    assert(threw, '页眉页脚都为空应报错');
  });
  t('新增: pdf-del-images 删除图片后文字可提取且页面可正常渲染', async () => {
    const fx = await FX();
    const r = await runTool('pdf-del-images', [fx.imagePdf], { range: '' });
    assert(r[0].meta.includes('已删除 1 张图片'), '删除数量: ' + r[0].meta);
    assert((await pageTexts(r[0].blob))[0].includes('TEXT-NEAR-IMAGE'), '文字保留');
    const d = await pdfjsLib.getDocument({ data: new Uint8Array(await r[0].blob.arrayBuffer()) }).promise;
    const page = await d.getPage(1);
    await page.getOperatorList();
    const cv = await renderPdfCanvas(r[0].blob, 1, 1);
    assert(darkPixels(cv) > 50, '页面仍可渲染出文字');
    const leftovers = await runTool('pdf-extract-images', [new File([await r[0].blob.arrayBuffer()], 'clean.pdf', { type: 'application/pdf' })], { minSize: 80 });
    assert(leftovers.length === 1 && leftovers[0].name.includes('无图片'), '输出中不应再含可提取图片');
    // 大图场景：原始图片对象必须真正从文件中移除（体积显著减小）
    const noisy = await makeNoiseImageFile('noise.png', 220, 180);
    const bigPdf = await makeImageTextPdfFile('bigimg.pdf', noisy);
    const r2 = await runTool('pdf-del-images', [bigPdf], { range: '' });
    assert(r2[0].blob.size < bigPdf.size * 0.5, `原始图片数据应被移除（${bigPdf.size} → ${r2[0].blob.size}）`);
  });
  t('新增: text-to-pdf TXT/MD/CSV/HTML 四种格式', async () => {
    const fx = await FX();
    for (const [key, file] of [['txt', fx.txt], ['md', fx.md], ['csv', fx.csv], ['html', fx.html]]) {
      const r = await runTool('text-to-pdf', [file], { fontSize: 12 });
      assert(r[0].name.endsWith('.pdf'), key + ' 扩展名');
      const info = await pdfInfo(r[0].blob);
      assert(info.pages >= 1, key + ' 至少 1 页');
      eq(info.sizes[0][0], key === 'csv' ? 842 : 595, key + ' 页宽');
    }
  });
  t('新增: text-to-pdf HTML 内联标签文字不丢失', async () => {
    const richFile = textFile('inline.html', '<html><body><p>Hello <b>World</b></p></body></html>', 'text/html');
    const plainFile = textFile('inline-plain.html', '<html><body><p>Hello</p></body></html>', 'text/html');
    const rich = await runTool('text-to-pdf', [richFile], { fontSize: 14 });
    const plain = await runTool('text-to-pdf', [plainFile], { fontSize: 14 });
    const a = darkPixels(await renderPdfCanvas(rich[0].blob, 1, 1));
    const b = darkPixels(await renderPdfCanvas(plain[0].blob, 1, 1));
    assert(a > b + 50, `含 <b>World</b> 的 HTML 应保留内联文字（rich=${a}, plain=${b}）`);
  });

  /* --- 既有工具未覆盖的分支 --- */
  t('分支: pdf-to-img BMP/TIFF/透明背景', async () => {
    const fx = await FX();
    const bmp = await runTool('pdf-to-img', [fx.pdf1], { format: 'bmp', dpi: '72', range: '' });
    const head = new TextDecoder('latin1').decode(new Uint8Array(await bmp[0].blob.slice(0, 2).arrayBuffer()));
    eq(head, 'BM', 'BMP 文件头');
    const tiff = await runTool('pdf-to-img', [fx.pdf1], { format: 'tiff', dpi: '72', range: '' });
    const dv = new DataView(await tiff[0].blob.slice(0, 4).arrayBuffer());
    assert(dv.getUint8(0) === 0x49 && dv.getUint8(1) === 0x49 && dv.getUint16(2, true) === 42, 'TIFF 文件头');
    const png = await runTool('pdf-to-img', [fx.pdf1], { format: 'png', dpi: '72', range: '', transparent: true });
    const cv = await renderPdfCanvas(fx.pdf1, 1, 1);
    assert(cv.width > 0, 'PDF 可渲染');
    eq((await imgInfo(png[0].blob)).w, 400, '透明 PNG 宽度');
  });
  t('分支: img-to-pdf WebP/GIF/BMP/SVG 与 fit 尺寸', async () => {
    const fx = await FX();
    const bmpBlob = (await runTool('pdf-to-img', [fx.pdf1], { format: 'bmp', dpi: '72', range: '' }))[0].blob;
    const bmp = new File([await bmpBlob.arrayBuffer()], 'page.bmp', { type: 'image/bmp' });
    const files = [fx.png, fx.jpeg, fx.webp, fx.gif, bmp, fx.svg];
    const r = await runTool('img-to-pdf', files, { size: 'a4', margin: 12 });
    eq((await pdfInfo(r[0].blob)).pages, files.length, '每种图片一页');
    const fit = await runTool('img-to-pdf', [fx.png], { size: 'fit', margin: 0 });
    arrEq((await pdfInfo(fit[0].blob)).sizes[0], [120, 90], '与图片同尺寸');
  });
  t('分支: 图片工具全部选项组合', async () => {
    const fx = await FX();
    for (const format of ['png', 'jpeg', 'webp']) {
      const r = await runTool('img-convert', [fx.png], { format, quality: 80 });
      assert(r[0].blob.type === 'image/' + format.replace('jpeg', 'jpeg'), format + ' 输出类型: ' + r[0].blob.type);
    }
    for (const mode of ['percent', 'width', 'height']) {
      const r = await runTool('img-resize', [fx.png], { mode, value: 50 });
      assert((await imgInfo(r[0].blob)).w > 0, '缩放 ' + mode);
    }
    for (const angle of ['0', '90', '180', '270']) {
      const r = await runTool('img-rotate', [fx.png], { angle, flipH: false, flipV: false });
      assert((await imgInfo(r[0].blob)).w > 0, '旋转 ' + angle);
    }
    for (const format of ['jpeg', 'webp', 'png']) {
      const r = await runTool('img-compress', [fx.png], { format, quality: 60, maxWidth: 1920 });
      assert(r[0].blob.size > 0, '压缩 ' + format);
    }
    const corner = await runTool('img-watermark', [fx.png], { text: 'WM', mode: 'corner' });
    eq((await imgInfo(corner[0].blob)).w, 120, '右下角水印尺寸');
  });
  t('分支: pdf-crop 百分比 / pdf-spread 方向 / pdf-nup 6&9 合 1', async () => {
    const f = await makePdfFile('br.pdf', ['P1', 'P2']);
    const crop = await runTool('pdf-crop', [f], { mode: 'pct', top: 10, right: 10, bottom: 10, left: 10 });
    arrEq((await pdfInfo(crop[0].blob)).sizes[0], [320, 480], '百分比裁剪尺寸');
    const land = await makeLandscapePdf('br-land.pdf');
    for (const direction of ['lr', 'tb', 'auto']) {
      const r = await runTool('pdf-spread', [land], { direction });
      eq((await pdfInfo(r[0].blob)).pages, 2, '对开页拆分 ' + direction);
    }
    for (const layout of ['2', '4']) {
      const src = await makePdfFile('nup.pdf', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
      const r = await runTool('pdf-nup', [src], { layout, gap: 0 });
      eq((await pdfInfo(r[0].blob)).pages, Math.ceil(10 / Number(layout)), '拼版 ' + layout);
    }
  });
  t('分支: pdf-compress 三档 / pdf-blank 仅检测 / pdf-pagenum 起始页码', async () => {
    const fx = await FX();
    for (const level of ['light', 'medium', 'heavy']) {
      const r = await runTool('pdf-compress', [fx.pdf1], { level });
      assert(r[0].meta.includes('→'), '体积对比 ' + level);
      eq((await pdfInfo(r[0].blob)).pages, 1, '页数 ' + level);
    }
    const blank = await makePdfFile('bl.pdf', ['', 'HAS-TEXT']);
    const r = await runTool('pdf-blank', [blank], { mode: 'report', threshold: 0.15 });
    assert(r.length === 1 && (await r[0].blob.text()).includes('1'), '仅检测模式输出报告');
    const pnum = await runTool('pdf-pagenum', [fx.pdf3], { start: 5, position: 'top-right', template: 'P{n}/{total}' });
    eq((await pdfInfo(pnum[0].blob)).pages, 3, '页码页数');
  });
  t('分支: pdf-textwm 居中 / pdf-imgwm 平铺 / pdf-overlay 拉伸', async () => {
    const fx = await FX();
    const wm = await runTool('pdf-textwm', [fx.pdf1], { text: '机密', mode: 'center', angle: 0, opacity: 0.5 });
    eq((await pdfInfo(wm[0].blob)).pages, 1, '居中水印');
    const seal = await runTool('pdf-imgwm', [fx.pdf1], { seal: fx.png, mode: 'tile', widthPct: 20, opacity: 0.5 });
    eq((await pdfInfo(seal[0].blob)).pages, 1, '平铺水印');
    const ov = await runTool('pdf-overlay', [fx.pdf3], { over: fx.pdf1, opacity: 0.5, scale: 'stretch' });
    eq((await pdfInfo(ov[0].blob)).pages, 3, '叠加页数');
  });
  t('分支: pdf-meta 全字段 / pdf-auto-rename 标题 / pdf-attachments 增删', async () => {
    const fx = await FX();
    const m = await runTool('pdf-meta', [fx.pdf1], { title: 'NT', author: 'NA', subject: 'NS', keywords: 'k1,k2' });
    const d = await PDFLib.PDFDocument.load(await m[0].blob.arrayBuffer());
    eq(d.getTitle(), 'NT', '标题'); eq(d.getAuthor(), 'NA', '作者');
    eq(d.getSubject(), 'NS', '主题'); assert(String(d.getKeywords()).includes('k1'), '关键词');
    const rn = await runTool('pdf-auto-rename', [fx.metaPdf], { source: 'title', prefix: 'X_' });
    assert(rn[0].name.startsWith('X_'), '前缀生效: ' + rn[0].name);
    const rm = await runTool('pdf-attachments', [fx.attachPdf], { mode: 'remove' });
    const back = await runTool('pdf-attachments', [new File([await rm[0].blob.arrayBuffer()], 'rm.pdf', { type: 'application/pdf' })], { mode: 'extract' });
    assert(back.length === 1 && back[0].name.includes('无附件'), '附件已删除: ' + JSON.stringify(back.map(x => x.name)));
  });
  t('分支: pdf-scanfx 反色 / pdf-sanitize 保留附件 / pdf-to-img 范围', async () => {
    const fx = await FX();
    const s = await runTool('pdf-scanfx', [fx.pdf1], { brightness: 1, contrast: 1, grayscale: false, invert: true, dpi: '72', quality: 70 });
    eq((await pdfInfo(s[0].blob)).pages, 1, '反色页数');
    const clean = await runTool('pdf-sanitize', [fx.attachPdf], { rmAttach: false });
    const back = await runTool('pdf-attachments', [new File([await clean[0].blob.arrayBuffer()], 'san.pdf', { type: 'application/pdf' })], { mode: 'extract' });
    assert(back.length >= 1, 'rmAttach=false 应保留附件');
    const imgs = await runTool('pdf-to-img', [fx.pdf3], { format: 'png', dpi: '72', range: '2-3' });
    eq(imgs.length, 2, '范围输出数量');
  });

  /* --- UI 补充 --- */
  t('UI: 文件预览列表/网格切换与持久化', () => {
    el('fileViewGridBtn').click();
    eq(T.state.fileView, 'grid', '切换到网格');
    eq(localStorage.getItem('officetoolbox.fileViewMode'), 'grid', '持久化网格');
    el('fileViewListBtn').click();
    eq(T.state.fileView, 'list', '切换回列表');
  });
  t('UI: 多页 PDF 结果灯箱逐页翻页与 Esc 关闭', async () => {
    openToolByName('合并', 'PDF 合并');
    const a = await makePdfFile('lb1.pdf', ['L1']);
    const b = await makePdfFile('lb2.pdf', ['L2', 'L3']);
    dropFiles([a, b]);
    alerts.length = 0;
    el('wsRunBtn').click();
    await waitFor(() => !el('wsResultsSection').hidden || alerts.length > 0, 30000, '合并完成');
    assert(!el('wsResultsSection').hidden, '结果区显示: ' + JSON.stringify(alerts));
    const thumb = el('wsResultsGrid').querySelector('.preview-thumbnail-box.is-pdf');
    assert(thumb, '应有 PDF 缩略图');
    thumb.click();
    await waitFor(() => el('lightboxPageInfo').textContent.includes('/ 3'), 30000, '灯箱渲染首页');
    eq(el('lightboxModal').classList.contains('active'), true, '灯箱打开');
    eq(el('lightboxPager').hidden, false, '翻页控件显示');
    await waitFor(() => !el('lightboxNextBtn').disabled, 10000, '下一页可用');
    el('lightboxNextBtn').click();
    await waitFor(() => el('lightboxPageInfo').textContent === '2 / 3', 30000, '翻到第 2 页');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    eq(el('lightboxModal').classList.contains('active'), false, 'Esc 关闭灯箱');
    el('wsBackBtn').click();
  });
  t('UI: 搜索与分类组合筛选', () => {
    resetSearch();
    el('headerNav').querySelector('[data-cat="img"]').click();
    const s = el('toolSearch');
    s.value = '压缩';
    s.dispatchEvent(new Event('input'));
    const n = el('toolGrid').querySelectorAll('.tool-card').length;
    const expected = T.TOOLS.filter(t => t.cat === 'img' && (t.name + ' ' + t.desc + ' ' + (t.keywords || '')).includes('压缩')).length;
    eq(n, expected, '图片分类 + 关键词结果数');
    s.value = ''; s.dispatchEvent(new Event('input'));
    el('headerNav').querySelector('[data-cat="all"]').click();
  });
  t('部署: version.json 完整性与 install.bat 占位符可用', async () => {
    const v = await (await fetch('./version.json?t=' + Date.now())).json();
    assert(v.schemaVersion === 2, '版本清单结构版本');
    assert(/^v[0-9a-f]{16}$/.test(v.version), '版本号应为产物内容哈希: ' + v.version);
    assert(/^[0-9a-f]{64}$/.test(v.sha256) && v.size > 0, '应包含产物 sha256 与 size');
    assert(v.scripts && /^[0-9a-f]{64}$/.test(v.scripts['update.ps1']), '应包含安装/更新脚本哈希');
    assert(v.vendor && Object.keys(v.vendor).length === 5, '应记录 5 个第三方库哈希');
    assert(v.updated && !Number.isNaN(Date.parse(v.updated)), '更新时间应为合法 ISO 时间');
    assert(v.file === 'office-toolbox-offline.html', '分发文件名');
    const bat = await (await fetch('./install.bat?t=' + Date.now())).text();
    assert(bat.includes('http://REPLACE_ME:8000'), '安装脚本应保留服务器地址占位符');
  });
  t('部署: 网页提供可见的一键安装入口与 install.bat 功能说明', () => {
    const card = $('deploySection');
    assert(card, '缺少局域网部署卡片');
    assert(card.style.display !== 'none', '部署卡片未展示');
    assert($('headerInstallBtn'), '顶部缺少安装入口');
    assert(card.textContent.includes('install.bat'), '卡片未说明 install.bat');
    assert(card.querySelector('.deploy-features'), '缺少安装能力说明');
    assert(card.querySelector('.deploy-details'), '缺少安装流程说明');
  });
  t('部署: 首次安装需弹窗确认，未确认前不自动下载', () => {
    const dlg = $('installPrompt');
    assert(dlg, '缺少安装确认框');
    assert(dlg.hidden, '自动化环境不应自动弹出确认框');
    $('headerInstallBtn').click();
    assert(!dlg.hidden, '点击安装入口后未弹出确认框');
    assert($('installPromptConfirm') && $('installPromptLater'), '确认框缺少选择按钮');
    $('installPromptLater').click();
    assert(dlg.hidden, '选择暂不安装后未关闭确认框');
    eq(localStorage.getItem('officetoolbox.installPrompt'), 'later', '未记住用户首次选择');
  });

  /* ---------- 票据 / 发票复刻功能专项测试 ---------- */
  const INV_N1 = '26932000001715031706';
  const INV_N2 = '26932000001649024626';
  const invPdf = (num, date, amount) => makePdfFile(`dzfp_${num}_测试公司.pdf`, [
    [`INVOICE ${num}`, `${date} ${amount.toFixed(2)}`, 'BUYER: Test Company A', 'SELLER: Test Company B'].join('\n'),
  ]);
  const makeRec = (name, num, amount) => {
    const r = T.billEmptyRecord(new File(['x'], name));
    r.invoice_number = num; r.amount = amount; r.status = '本地解析';
    return r;
  };

  t('票据: 文件名号码 / 二维码文本 / 金额 / 日期纯函数', () => {
    eq(T.billExtractFilenameNumber('dzfp_26932000001649024626_公司_20261026184344.pdf'), INV_N2, '文件名提取 20 位号码');
    eq(T.billExtractFilenameNumber('no-number.pdf'), '', '无号码返回空');
    const qr = T.billParseQrText('01,31,,26932000001649024626,-368.94,20261009,,5AB9');
    eq(qr.number, INV_N2, '二维码号码');
    eq(qr.amount, -368.94, '二维码红字负数金额');
    eq(qr.date, '2026年10月09日', '二维码日期');
    eq(qr.check_code, '5AB9', '二维码校验码');
    eq(qr.crc, '5AB9', '二维码 CRC 段');
    eq(qr.crc_verified, true, '数电票 CRC-16 校验通过');
    eq(qr.kind, '电子发票（增值税专用发票）', '数电票票种判定');
    eq(qr.amount_is_total, true, '数电票金额为价税合计');
    const old = T.billParseQrText('01,10,037002200112,29703880,0.35,20240730,16159808100987561106,FE18,');
    eq(old.number, '29703880', '老票 8 位号码不被 20 位校验码误覆盖');
    eq(old.check_code, '16159808100987561106', '老票校验码按标准段位');
    eq(old.crc, 'FE18', '老票 CRC 段');
    eq(old.crc_verified, true, '老票 CRC-16 校验通过');
    eq(old.kind, '增值税电子普通发票', '老票票种判定');
    eq(old.amount_is_total, false, '老票金额为不含税金额');
    eq(old.amount_label, '金额（不含税）', '老票金额口径标注');
    eq(old.amount, 0.35, '老票金额');
    const dig = T.billParseQrText('01,32,,24117000000554334250,499.00,20240910,,39CF');
    eq(dig.number, '24117000000554334250', '数电票 20 位号码');
    eq(dig.kind, '电子发票（普通发票）', '数电票普票判定');
    eq(dig.crc_verified, true, '数电票普通发票 CRC-16 校验通过');
    eq(T.billParseQrText('not-a-qr'), null, '非法二维码文本');
    eq(T.billParseQrText('02,10,037002200112,29703880,0.35,20240730,,FE18'), null, '非 01 起始文本不识别');
    const kindOf = s => T.billParseQrText(s).kind;
    eq(kindOf('01,32,,24119000001649024626,100.00,20240910,,ABCD'), '铁路电子客票', '20 位号码衍生票种：铁路');
    eq(kindOf('01,32,,24118000001649024626,100.00,20240910,,ABCD'), '航空运输电子客票行程单', '20 位号码衍生票种：航空');
    eq(kindOf('01,32,,24117900001649024626,100.00,20240910,,ABCD'), '通行费发票', '类型 32 通行费判定');
    eq(kindOf('01,33,,12345678,100.00,20240910,,ABCD'), '机动车销售统一发票', '机动车票种判定');
    eq(kindOf('01,99,CZ1234567890,12345678,100.00,20240910,,ABCD'), '财政票据', 'CZ 代码财政票据');
    eq(kindOf('01,99,100000009000,12345678,100.00,20240910,,ABCD'), '区块链电子发票', '12 位代码区块链票');
    eq(T.billNormalizeNumber('00123456'), '123456', '号码去前导零');
    eq(T.billNormalizeDate('2026年10月9日'), '20261009', '日期归一化');
    eq(T.billCleanAmount('¥1,680.00'), 1680, '金额清洗');
    eq(T.billCnAmountToFloat('壹仟陆佰捌拾圆整'), 1680, '中文大写金额');
    arrEq(T.billParseCustomOrder('a,b\nc；d、e'), ['a', 'b', 'c', 'd', 'e'], '自定义顺序分隔符');
  });
  t('票据: PDF 文本层字段提取与云端 OCR 响应解析', () => {
    const p = T.billParsePdfInvoiceText('电子发票（增值税专用发票）\n' + INV_N1 + '\n2026年10月15日\n浙江珍诚医药科技有限公司\n宁波大红鹰药业股份有限公司\n¥1486.73\n¥193.27\n壹仟陆佰捌拾圆整\n¥1680.00');
    eq(p.invoice_number, INV_N1, '文本层号码');
    eq(p.invoice_date, '2026年10月15日', '文本层日期');
    eq(p.amount, 1680, '文本层价税合计');
    eq(p.tax_amount, 193.27, '文本层税额');
    eq(p.buyer, '浙江珍诚医药科技有限公司', '购买方');
    eq(p.seller, '宁波大红鹰药业股份有限公司', '销售方');
    const b = T.billParseBillResult({ BankSlipInfos: [{ Name: '付款人', Value: '甲公司' }, { Name: '金额', Value: '1,680.00' }] }, false);
    eq(b.amount, 1680, '回单金额');
    eq(T.billParseBillResult({ BankSlipInfos: [{ Name: '票面金额', Value: '168000' }] }, true).amount, 1680, '承兑汇票金额按分换算');
    const rec = T.billEmptyRecord(new File(['x'], 'ocr.pdf'));
    T.billApplyInvoiceResponse(rec, { MixedInvoiceItems: [{ TypeDescription: '全电发票', SingleInvoiceInfos: { VatElectronicSpecialInvoiceFull: { Number: INV_N1, Total: '1680.00', Date: '2026年10月15日', Buyer: '甲公司', Seller: '乙公司' } } }] });
    eq(rec.status, '识别成功', 'OCR 解析状态');
    eq(rec.invoice_number, INV_N1, 'OCR 号码');
    eq(rec.amount, 1680, 'OCR 金额');
  });
  t('票据: 8 种排序 / 统计 / 命名模板', () => {
    const recs = [makeRec('c.pdf', 'N3', 30), makeRec('a.pdf', 'N1', 10), makeRec('b.pdf', 'N2', 20)];
    const ordered = T.billSortRecords(recs, 'custom', 'N2\nN1\nN9');
    arrEq(ordered.map(r => r.invoice_number), ['N2', 'N1', 'N3'], '自定义顺序，未列出的排最后');
    const stats = T.billSortStats(recs, ordered, 'custom', 'N2\nN1\nN9');
    eq(stats.matched, 2, '匹配数');
    eq(stats.missing_count, 1, '序时簿缺少文件数');
    arrEq(T.billSortRecords(recs, 'amount_desc', '').map(r => r.amount), [30, 20, 10], '金额降序');
    arrEq(T.billSortRecords(recs, 'original', '').map(r => r.file_name), ['a.pdf', 'b.pdf', 'c.pdf'], '原文件名顺序');
    const r = recs[1];
    r.invoice_date = '2026年10月15日';
    eq(T.billRenderNameTemplate(r, 2, '发票', 3, '{前缀}{序号}_{发票号码}'), '发票002_N1', '模板字段替换');
    eq(T.billRenderNameTemplate(r, 1, '', 2, '{发票号码}_{金额}'), 'N1_10.00', '空前缀 / 金额字段');
    let threw = false;
    try { T.billRenderNameTemplate(r, 1, '', 3, '{不存在}'); } catch (e) { threw = true; }
    assert(threw, '未知模板字段应报错');
    const plan = T.billBuildRenamePlan(recs, { prefix: '发票', start: 1, digits: 3, template: '{前缀}{序号}' });
    arrEq(plan.map(p => p.new_name), ['发票001.pdf', '发票002.pdf', '发票003.pdf'], '重命名计划');
  });
  t('票据: Excel 序时簿候选列识别与号码顺序', async () => {
    const xlsx = await T.buildXlsxBlob([T.billGridSheet('销售发票序时簿', ['日期', '发票号码'], [
      ['2026-10-15', INV_N1], ['2026-10-09', INV_N2],
    ])]);
    const file = new File([await xlsx.arrayBuffer()], '序时簿.xlsx');
    const sheets = await T.billReadOrderSheets(file);
    const scan = T.billScanOrderCandidates(sheets, 20);
    const selected = scan.candidates[scan.suggested];
    eq(selected.length_match, true, '应选中 20 位号码列');
    arrEq(T.billReadOrderNumbers(sheets, selected), [INV_N1, INV_N2], '号码顺序');
    const imported = await T.billImportOrder(file, 20);
    arrEq(imported.numbers, [INV_N1, INV_N2], '导入结果');
    await T.billApp.importOrder(file);
    const orderText = document.getElementById('bill-invoice-custom-order').value;
    eq(document.getElementById('bill-invoice-sort-mode').value, 'custom', '工作台自动切换自定义排序');
    assert(orderText.indexOf(INV_N1) >= 0 && orderText.indexOf(INV_N1) < orderText.indexOf(INV_N2), '工作台号码清单顺序');
    assert(document.getElementById('bill-invoice-order-source').textContent.includes('序时簿.xlsx'), '号码来源显示');
  });
  t('票据工作台: 本地解析 / 表格渲染 / 导出 Excel / 缓存命中', async () => {
    T.billCacheClear();
    const f = await invPdf(INV_N1, '2026-10-15', 1680);
    const rec = await T.billBuildRecord(f, { useQr: false, useCache: false });
    eq(rec.invoice_number, INV_N1, '文件名号码');
    eq(rec.amount, 1680, '文本层金额');
    eq(rec.status, '本地解析', '本地解析状态');
    T.billApp.scanFiles([f], '测试目录');
    await T.billApp.parseLocal();
    const records = T.billApp.state.invoice.records;
    eq(records.length, 1, '扫描记录数');
    eq(records[0].invoice_number, INV_N1, '工作台解析号码');
    eq(records[0].status, '本地解析', '工作台解析状态');
    eq(document.querySelectorAll('#bill-invoice-table-body tr').length, 1, '发票表格行数');
    assert(document.getElementById('bill-invoice-summary').textContent.includes('合计'), '汇总信息');
    const blob = await T.billRecordsToXlsx(records);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    eq(zip.file('xl/worksheets/sheet1.xml') && zip.file('xl/worksheets/sheet2.xml') ? 2 : 0, 2, '明细 + 文件清单双工作表');
    assert((await zip.file('xl/worksheets/sheet2.xml').async('string')).includes(INV_N1), '文件清单含号码');
    const a = await T.billBuildRecord(f, { useQr: false });
    const b = await T.billBuildRecord(f, { useQr: false });
    eq(b.from_cache, true, '重复解析命中缓存');
    eq(b.invoice_number, a.invoice_number, '缓存内容一致');
    eq(T.billCacheStats().files, 1, '缓存条目数');
    T.billCacheClear();
    eq(T.billCacheStats().files, 0, '清空缓存');
  });
  t('票据工作台: 排序 / 命名预览 / 重命名副本 / 合成 PDF', async () => {
    const billEl = id => document.getElementById('bill-' + id);
    const f1 = await invPdf(INV_N1, '2026-10-15', 1680);
    const f2 = await invPdf(INV_N2, '2026-10-09', 368.94);
    T.billCacheClear();
    T.billApp.scanFiles([f1, f2], '测试目录');
    await T.billApp.parseLocal();
    billEl('invoice-sort-mode').value = 'custom';
    billEl('invoice-custom-order').value = INV_N2 + '\n' + INV_N1;
    T.billApp.sort();
    const recs = T.billApp.state.invoice.records;
    arrEq(recs.map(r => r.invoice_number), [INV_N2, INV_N1], '表格按指定顺序重排');
    assert(!billEl('invoice-sort-notice').hidden, '排序核对提示显示');
    billEl('invoice-prefix').value = '发票';
    billEl('invoice-start').value = '1';
    billEl('invoice-digits').value = '3';
    billEl('invoice-name-template').value = '{前缀}{序号}_{发票号码}';
    T.billApp.refreshPreview();
    arrEq(T.billApp.state.invoice.preview, [`发票001_${INV_N2}.pdf`, `发票002_${INV_N1}.pdf`], '文件名预览');
    const plan = T.billBuildRenamePlan(recs, {
      prefix: '发票', start: 1, digits: 3, template: '{前缀}{序号}_{发票号码}',
    });
    const zipBlob = await T.billRenamedZip(plan, '重命名报告');
    const rzip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    assert(rzip.file(`发票001_${INV_N2}.pdf`) && rzip.file(`发票002_${INV_N1}.pdf`), '重命名副本: ' + Object.keys(rzip.files).join(' | '));
    const merged = await T.billMergeRecordsToPdf(recs);
    eq((await pdfInfo(merged.blob)).pages, 2, '合成 PDF 页数');
    arrEq(merged.merged, recs.map(r => r.file_name), '按当前表格顺序合成');
    assert(merged.merged[0].includes(INV_N2), '合成顺序与排序一致');
  });
  t('票据工作台: 银行回单 / 承兑汇票识别与 OCR JSON 导入', async () => {
    const billEl = id => document.getElementById('bill-' + id);
    const f = await invPdf(INV_N1, '2026-10-15', 1680);
    T.billApp.showPage('bank');
    billEl('ocr-json').value = '';
    billEl('bank-ocr-json').value = '';
    T.billApp.setBillFiles('bank_slip', [f]);
    await T.billApp.recognizeBills('bank_slip');
    const bucket = T.billApp.state.bills.bank_slip;
    eq(bucket.results.length, 1, '回单结果条数');
    assert(bucket.results[0].items.some(([, v]) => String(v).includes(INV_N1)), '本地文本层字段含文件号码');
    eq(document.querySelectorAll('#bill-bank-results .bill-result-card').length, 1, '结果卡片渲染');
    billEl('bank-ocr-json').value = JSON.stringify({ BankSlipInfos: [{ Name: '付款人', Value: '甲公司' }, { Name: '金额', Value: '1,680.00' }] });
    await T.billApp.recognizeBills('bank_slip');
    eq(bucket.results[0].amount, 1680, '回单 OCR 金额');
    assert(bucket.results[0].items.some(([k, v]) => k === '付款人' && v === '甲公司'), 'OCR 字段落表');
    eq(billEl('bank-summary-amount').textContent, '¥1,680.00', '合计金额汇总');
    T.billApp.showPage('acceptance');
    billEl('acceptance-ocr-json').value = JSON.stringify({ BankSlipInfos: [{ Name: '票面金额', Value: '168000' }] });
    T.billApp.setBillFiles('acceptance', [f]);
    await T.billApp.recognizeBills('acceptance');
    eq(T.billApp.state.bills.acceptance.results[0].amount, 1680, '承兑汇票金额按分换算');
  });
  t('票据工作台: 导航直接进入 / 四页切换 / 返回工具箱', () => {
    resetSearch();
    eq(el('headerNav').querySelector('[data-cat="bill"]').textContent.trim(), '票据识别', '导航名称');
    eq(T.TOOLS.filter(t => t.cat === 'bill').length, 0, '票据识别不再注册工具卡片');
    el('headerNav').querySelector('[data-cat="bill"]').click();
    eq(document.body.classList.contains('bill-app-active'), true, '点击导航直接进入工作台');
    eq(el('homeView').hidden, true, '首页隐藏');
    eq(document.getElementById('billAppView').hidden, false, '工作台可见');
    eq(document.getElementById('bill-page-title').textContent, '银行回单识别', '默认打开银行回单');
    for (const page of ['acceptance', 'invoice', 'settings', 'bank']) {
      document.querySelector(`.bill-nav-item[data-bill-page="${page}"]`).click();
      eq(document.getElementById('bill-page-' + page).classList.contains('active'), true, page + ' 页激活');
    }
    eq(document.getElementById('bill-invoice-table-body').tagName, 'TBODY', '发票表格已迁移');
    eq(document.getElementById('bill-secret-id').tagName, 'INPUT', '系统设置表单已迁移');
    document.getElementById('bill-back-btn').click();
    eq(document.body.classList.contains('bill-app-active'), false, '返回工具箱');
    eq(el('homeView').hidden, false, '首页恢复显示');
    eq(el('headerNav').querySelector('[data-cat="all"]').classList.contains('active'), true, '返回后恢复全部工具高亮');
  });

  /* ---------- 回归：本轮修复的边界问题 ---------- */
  t('回归: pdf-nup 2合1 等比缩放不变形', async () => {
    const f = await makePdfFile('nup-ratio.pdf', ['A', 'B']);
    const r = await runTool('pdf-nup', [f], { layout: '2', gap: 8 });
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await r[0].blob.arrayBuffer()) }).promise;
    const tc = await (await doc.getPage(1)).getTextContent();
    const it = tc.items.find(x => x.str.trim());
    assert(it, '拼版后应保留文字');
    const sx = Math.abs(it.transform[0]), sy = Math.abs(it.transform[3]);
    assert(Math.abs(sx - sy) < 0.01, `内容横纵缩放应一致，实际 ${sx} / ${sy}`);
  });

  t('回归: 添加图片「下0 上100」方向正确', async () => {
    const f = await makePdfFile('pos.pdf', ['']);
    const cv = document.createElement('canvas');
    cv.width = 40; cv.height = 20;
    const c = cv.getContext('2d');
    c.fillStyle = '#ff0000'; c.fillRect(0, 0, 40, 20);
    const png = await new Promise(res => cv.toBlob(res, 'image/png'));
    const img = new File([png], 'red.png', { type: 'image/png' });
    const opt = y => ({ img, range: '', x: 50, y, widthPct: 30, opacity: 1 });
    const lower = await runTool('pdf-add-image', [f], opt(0));
    const upper = await runTool('pdf-add-image', [f], opt(100));
    const redY = async blob => {
      const out = await renderPdfCanvas(blob, 1, 1);
      const d = out.getContext('2d').getImageData(0, 0, out.width, out.height).data;
      let sum = 0, n = 0;
      for (let y = 0; y < out.height; y++) {
        for (let x = 0; x < out.width; x++) {
          const i = (y * out.width + x) * 4;
          if (d[i] > 180 && d[i + 1] < 80 && d[i + 2] < 80) { sum += y; n++; }
        }
      }
      assert(n > 100, '渲染结果中未找到红色图片像素');
      return sum / n;
    };
    const yLower = await redY(lower[0].blob), yUpper = await redY(upper[0].blob);
    assert(yLower > yUpper + 100, `下0 应比 上100 更靠下（canvas y: ${yLower} / ${yUpper}）`);
  });

  t('回归: HTML 转 PDF 保留 body 级裸文本', async () => {
    const rich = textFile('body-inline.html', '<html><body>Hello <b>World</b></body></html>', 'text/html');
    const plain = textFile('body-only.html', '<html><body><b>World</b></body></html>', 'text/html');
    const a = darkPixels(await renderPdfCanvas((await runTool('text-to-pdf', [rich], { fontSize: 14 }))[0].blob, 1, 1));
    const b = darkPixels(await renderPdfCanvas((await runTool('text-to-pdf', [plain], { fontSize: 14 }))[0].blob, 1, 1));
    assert(a > b + 50, `body 裸文本不应丢失（含 Hello=${a}，不含=${b}）`);
  });

  t('回归: XLSX 导出保留数值 0', async () => {
    const blob = await T.buildXlsxBlob([{ name: 's', grid: [['金额', 0, '']] }]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    assert(sheet.includes('>0<'), '数值 0 不应被写成空单元格');
  });

  t('回归: 序时簿 CSV 支持 BOM 与引号字段', async () => {
    const csv = textFile('order.csv', '\ufeff发票号码,备注\n' + INV_N1 + ',"含,逗号"\n' + INV_N2 + ',普通', 'text/csv');
    const sheets = await T.billReadOrderSheets(csv);
    eq(sheets[0].grid[0][0], '发票号码', '应去掉 UTF-8 BOM');
    eq(sheets[0].grid[1][1], '含,逗号', '引号字段不应被拆列');
    const scan = T.billScanOrderCandidates(sheets, 20);
    const selected = scan.candidates[scan.suggested];
    arrEq(T.billReadOrderNumbers(sheets, selected), [INV_N1, INV_N2], '号码顺序');
  });

  /* ---------- 本轮修复的边界回归 ---------- */
  const LF = String.fromCharCode(10);
  const CRLF = String.fromCharCode(13, 10);
  const BOM = String.fromCharCode(0xFEFF);

  t('回归: 范围形式的页面越界与非法输入应报错', () => {
    for (const bad of ['99-100', '0-2', '-', '1-2-3', '4-6', '3-1']) {
      let threw = false;
      try { T.parsePageRanges(bad, 3); } catch (e) { threw = true; }
      assert(threw, '越界/非法范围应报错: ' + bad);
    }
    arrEq(T.parsePageRanges('1 - 3', 3), [1, 2, 3], '允许范围中的空格');
  });

  t('回归: CSV 引号字段内的换行不拆行', () => {
    const grid = T.parseCsvGrid(BOM + '编号,备注' + CRLF + 'A1,"第一行' + LF + '第二行"' + CRLF + 'A2,普通' + CRLF, ',');
    arrEq(grid, [['编号', '备注'], ['A1', '第一行' + LF + '第二行'], ['A2', '普通']], '引号内换行应留在同一单元格');
    arrEq(T.parseCsvGrid('a,b' + CRLF + '1,"x;y"' + CRLF, ',;'), [['a', 'b'], ['1', 'x;y']], '多分隔符');
  });

  t('回归: 序时簿 CSV 引号内换行不影响号码识别', async () => {
    const csv = textFile('order-multiline.csv',
      BOM + '发票号码,备注' + LF + INV_N1 + ',"含,逗号' + LF + '与第二行"' + CRLF + INV_N2 + ',普通', 'text/csv');
    const sheets = await T.billReadOrderSheets(csv);
    eq(sheets[0].grid.length, 3, '不应因引号内换行多出记录行');
    assert(sheets[0].grid[1][1].includes('与第二行'), '引号字段内容应完整');
    const scan = T.billScanOrderCandidates(sheets, 20);
    arrEq(T.billReadOrderNumbers(sheets, scan.candidates[scan.suggested]), [INV_N1, INV_N2], '号码顺序');
  });

  t('回归: 无文本 PDF 转 Excel 应报错而非输出空工作簿', async () => {
    const blank = await makePdfFile('blank.pdf', ['']);
    let threw = false;
    try { await runTool('pdf-to-excel', [blank]); } catch (e) { threw = true; }
    assert(threw, '无文本层 PDF 不应静默生成 0 工作表的非法 xlsx');
  });

  t('回归: 证件照排版最后一行也居中', async () => {
    const i = await makeImageFile('image/png', 200, 300, 'p.png');
    const dpi = 150, gapMm = 1;
    const r = await runTool('img-idphoto', [i], {
      size: '1', paper: '6', dpi: String(dpi), bg: 'keep', count: '8', gap: String(gapMm), guide: false,
    });
    const cv = await blobCanvas(r[0].blob);
    const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const mm = v => Math.max(1, Math.round(v / 25.4 * dpi));
    const ph = mm(35), gap = Math.round(gapMm / 25.4 * dpi);
    const oy = Math.round((cv.height - (2 * ph + gap)) / 2);
    const y = oy + ph + gap + Math.floor(ph * 0.7);
    let min = cv.width, max = -1;
    for (let x = 0; x < cv.width; x++) {
      const k = (y * cv.width + x) * 4;
      if (data[k + 2] > 150 && data[k] < 100) { if (x < min) min = x; if (x > max) max = x; }
    }
    assert(max > min, '第二行应能检测到照片像素');
    assert(Math.abs((min + max) / 2 - cv.width / 2) <= 2, '第二行应水平居中: ' + min + '..' + max);
  });

  /* ---------- 执行 ---------- */
  const panel = document.createElement('div');
  panel.id = 'selftestPanel';
  panel.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;color:#111;overflow:auto;padding:16px;font:13px/1.6 Consolas,monospace;';
  document.body.appendChild(panel);

  let pass = 0, fail = 0;
  const lines = [];
  for (const tc of tests) {
    const t0 = performance.now();
    let status, detail;
    try {
      const extra = await tc.fn();
      status = 'PASS';
      detail = extra || '';
      pass++;
    } catch (e) {
      status = 'FAIL';
      detail = (e && e.message) ? e.message : String(e);
      fail++;
    }
    const ms = Math.round(performance.now() - t0);
    lines.push({ name: tc.name, status, ms, detail });
    panel.innerHTML = `<h2 style="margin:0 0 8px">自测进度 ${lines.length}/${tests.length}</h2>` +
      '<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">' +
      '<tr><th style="width:34px">#</th><th>用例</th><th style="width:60px">结果</th><th style="width:60px">耗时</th><th>说明</th></tr>' +
      lines.map((l, i) => `<tr style="background:${l.status === 'PASS' ? '#eef9ee' : '#fdeeee'}"><td>${i + 1}</td><td>${l.name}</td><td><b>${l.status}</b></td><td>${l.ms}ms</td><td>${String(l.detail).replace(/</g, '&lt;')}</td></tr>`).join('') +
      '</table>';
    await new Promise(r => setTimeout(r, 0));
  }
  panel.innerHTML += `<h2>完成：${pass} 通过 / ${fail} 失败 / 共 ${tests.length}</h2>`;
  window.__selftestDone = true;
  window.__selftestSummary = `PASS=${pass} FAIL=${fail} TOTAL=${tests.length}`;
  window.__selftestLines = lines;
})().catch(e => {
  document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;background:#fff;z-index:99999;padding:20px;color:#c00;font:16px monospace">测试框架异常: ' + String(e && e.stack || e).replace(/</g, '&lt;') + '</div>');
  window.__selftestDone = true;
  window.__selftestSummary = 'HARNESS ERROR';
});
