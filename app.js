/**
 * 办公文件工具箱 - 核心框架与工具实现
 * 100% Client-side: PDF.js (渲染) + pdf-lib (PDF 编辑) + JSZip (打包) + Canvas (图片)
 */
(function () {
  'use strict';

  /* 旧版以 pdf2png.* 存储置顶、票据配置等数据；改名后一次性迁移，旧键保留以兼容回退。 */
  (function migrateLegacyKeys() {
    var names = ['pinned', 'recent', 'fileViewMode', 'billConfig', 'billCache.v1', 'installPrompt'];
    try {
      names.forEach(function (name) {
        var oldKey = 'pdf2png.' + name;
        var newKey = 'officetoolbox.' + name;
        if (localStorage.getItem(newKey) === null) {
          var value = localStorage.getItem(oldKey);
          if (value !== null) localStorage.setItem(newKey, value);
        }
      });
    } catch (e) { /* 存储不可用时跳过迁移 */ }
  })();
  /* ============================================================
     1. PDF.js Worker 初始化
     ============================================================ */
  if (typeof pdfjsLib !== 'undefined') {
    const embeddedWorkerEl = document.getElementById('pdfWorkerCode');
    if (embeddedWorkerEl && embeddedWorkerEl.textContent.trim()) {
      try {
        const workerBlob = new Blob([embeddedWorkerEl.textContent], { type: 'application/javascript' });
        pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
      } catch (e) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
      }
    } else {
      pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
    }
  }

  /* ============================================================
     2. 主题管理
     ============================================================ */
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const billThemeToggleBtn = document.getElementById('billThemeToggleBtn');
  const themeModeSelect = document.getElementById('themeModeSelect');
  const THEME_KEY = 'theme';
  const THEME_PREF_KEY = 'themePref';
  const themeMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  /* CSS 只维护浅色 / 深色两套变量。auto 在这里解析成具体的 data-theme，
     不再把整套暗色变量在 @media 里复制一份；系统配色变化时自动跟随。 */
  function resolveTheme(pref) {
    if (pref === 'dark' || pref === 'light') return pref;
    return themeMedia && themeMedia.matches ? 'dark' : 'light';
  }

  function themeLabel(pref, resolved) {
    if (pref === 'auto') {
      return `主题：跟随系统（当前${resolved === 'dark' ? '深色' : '浅色'}），点击切换到${resolved === 'dark' ? '浅色' : '深色'}`;
    }
    if (pref === 'light') return '主题：浅色，点击切换到深色';
    return '主题：深色，点击恢复跟随系统';
  }

  /* 主界面和票据顶栏共用同一主题状态，按钮语义同时更新。 */
  function syncThemeButton(pref, resolved) {
    const label = themeLabel(pref, resolved);
    [themeToggleBtn, billThemeToggleBtn].forEach(button => {
      if (!button) return;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('data-theme-pref', pref);
      button.setAttribute('aria-pressed', String(pref !== 'auto'));
    });
    if (themeModeSelect) themeModeSelect.value = pref;
  }

  function applyTheme(pref) {
    const normalized = pref === 'dark' || pref === 'light' ? pref : 'auto';
    const resolved = resolveTheme(normalized);
    document.documentElement.setAttribute('data-theme', resolved);
    // theme 键始终等于 DOM 上的实际主题（兼容旧数据与诊断），
    // themePref 单独保存用户选择（含 auto）。
    try {
      localStorage.setItem(THEME_KEY, resolved);
      localStorage.setItem(THEME_PREF_KEY, normalized);
    } catch (e) { /* 隐私模式仅影响持久化，不影响本次主题 */ }
    syncThemeButton(normalized, resolved);
  }

  function currentPref() {
    try {
      const saved = localStorage.getItem(THEME_PREF_KEY);
      if (saved === 'auto' || saved === 'dark' || saved === 'light') return saved;
      const legacy = localStorage.getItem(THEME_KEY);
      return legacy === 'dark' || legacy === 'light' ? legacy : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  function initTheme() {
    applyTheme(currentPref());
    if (themeMedia) {
      const onChange = () => { if (currentPref() === 'auto') applyTheme('auto'); };
      if (themeMedia.addEventListener) themeMedia.addEventListener('change', onChange);
      else if (themeMedia.addListener) themeMedia.addListener(onChange);
    }
  }

  function toggleTheme() {
    const pref = currentPref();
    const resolved = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    // auto → 手动反向主题；浅色 → 深色；深色 → 恢复跟随系统。
    if (pref === 'auto') applyTheme(resolved === 'dark' ? 'light' : 'dark');
    else if (pref === 'light') applyTheme('dark');
    else applyTheme('auto');
  }
  if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
  if (billThemeToggleBtn) billThemeToggleBtn.addEventListener('click', toggleTheme);
  if (themeModeSelect) {
    themeModeSelect.addEventListener('change', () => applyTheme(themeModeSelect.value));
  }
  initTheme();
  /* ============================================================
     3. 通用工具函数
     ============================================================ */

  /* 集中配置：原先散落在各分区的魔数统一在此维护 */
  const CONFIG = Object.freeze({
    maxAutoPdfThumbs: 8,
    pdfPreviewConcurrency: 2,
    previewCacheMax: 64,
    recentMax: 8,
    downloadUrlLifetimeMs: 30000,
    zipLevel: 6,
  });

  /* 统一提示出口：右下角 toast，不阻塞操作，也不会打断连续处理。 */
  const TOAST_ICONS = {
    error: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>',
    success: '<circle cx="12" cy="12" r="10"></circle><polyline points="8 12.5 11 15.5 16 9.5"></polyline>',
    warn: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
  };
  let toastStack = null;

  function showToast(message, type, duration) {
    const text = String(message == null ? '' : message);
    if (!text) return '';
    if (!toastStack || !toastStack.isConnected) {
      toastStack = document.createElement('div');
      toastStack.className = 'toast-stack';
      toastStack.id = 'toastStack';
      document.body.appendChild(toastStack);
    }
    const kind = TOAST_ICONS[type] ? type : 'info';
    const el = document.createElement('div');
    el.className = 'toast is-' + kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + TOAST_ICONS[kind] + '</svg><span></span>';
    el.lastElementChild.textContent = text;
    toastStack.appendChild(el);
    while (toastStack.children.length > 3) toastStack.firstElementChild.remove();
    const ttl = duration || (kind === 'error' ? 6000 : 3600);
    setTimeout(() => {
      el.style.transition = 'opacity .18s ease';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 220);
    }, ttl);
    return text;
  }

  /** 统一错误出口：用户可见错误全部经此处理。 */
  function reportError(message, err) {
    const text = String(message || '操作失败');
    if (err) console.error('[办公文件工具箱]', text, err);
    showToast(text, 'error');
    return text;
  }

  function preferredScrollBehavior() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  }

  function focusableIn(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hidden && el.getClientRects().length);
  }

  function trapModalFocus(event, container) {
    if (event.key !== 'Tab' || !container) return;
    const focusable = focusableIn(container);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* Object URL 统一登记，避免各分区各自 revoke 造成重复释放或遗漏。 */
  const objectUrls = new Set();
  function trackUrl(url) { if (url) objectUrls.add(url); return url; }
  function revokeUrl(url) {
    if (!url) return;
    objectUrls.delete(url);
    try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
  }
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // 页面范围解析："1-3, 5" -> [1,2,3,5]；"1-3;4-6;7" -> 分组
  function parsePageRanges(rangeStr, maxPages) {
    if (!rangeStr || !rangeStr.trim()) {
      return Array.from({ length: maxPages }, (_, i) => i + 1);
    }
    const pages = new Set();
    for (let part of rangeStr.split(/[,，]/)) {
      part = part.trim();
      if (!part) continue;
      if (part.includes('-')) {
        const [a, b] = part.split('-');
        const rawFrom = parseInt(a, 10), rawTo = parseInt(b, 10);
        if (Number.isFinite(rawFrom) && Number.isFinite(rawTo) && rawFrom > rawTo) {
          throw new Error(`页面范围无效：${part}（起始页不能大于结束页）`);
        }
        const from = Math.max(1, Math.min(rawFrom || 1, maxPages));
        const to = Math.min(maxPages, Math.max(rawTo || maxPages, 1));
        for (let i = from; i <= to; i++) pages.add(i);
      } else {
        const n = parseInt(part, 10);
        if (!isNaN(n) && n >= 1 && n <= maxPages) pages.add(n);
      }
    }
    const sorted = Array.from(pages).sort((a, b) => a - b);
    if (!sorted.length) throw new Error(`页面范围无效：${rangeStr}（文档共 ${maxPages} 页）`);
    return sorted;
  }

  // 多组范围解析："1-3; 4-6; 7" -> [[1,2,3],[4,5,6],[7]]
  function parseRangeGroups(rangeStr, maxPages) {
    return rangeStr.split(/[;；]/)
      .map(g => g.trim())
      .filter(Boolean)
      .map(g => parsePageRanges(g, maxPages))
      .filter(g => g.length > 0);
  }

  function triggerDownload(blob, filename) {
    const url = trackUrl(URL.createObjectURL(blob));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => revokeUrl(url), CONFIG.downloadUrlLifetimeMs);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type || 'image/png', quality));
  }

  async function loadPdfDoc(file) {
    const buf = await file.arrayBuffer();
    return PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
  }

  async function loadPdfjsDoc(file) {
    const buf = await file.arrayBuffer();
    return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  }

  function baseName(name) {
    return name.replace(/\.[^/.]+$/, '');
  }

  function bytesToBlob(bytes, mime) {
    return new Blob([bytes], { type: mime });
  }

  // 将文字渲染为透明 PNG（借助系统字体，支持中文）
  function makeTextImage(text, opts) {
    const fontPx = (opts.fontPx || 32);
    const pad = (opts.pad != null) ? opts.pad : Math.round(fontPx * 0.35);
    const bold = opts.bold ? 'bold ' : '';
    const font = `${bold}${fontPx}px "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif`;
    const meas = document.createElement('canvas').getContext('2d');
    meas.font = font;
    const tw = Math.ceil(meas.measureText(text).width);
    const th = Math.ceil(fontPx * 1.45);
    const angle = (opts.angle || 0) * Math.PI / 180;
    const w = Math.ceil(Math.abs(tw * Math.cos(angle)) + Math.abs(th * Math.sin(angle))) + pad * 2;
    const h = Math.ceil(Math.abs(tw * Math.sin(angle)) + Math.abs(th * Math.cos(angle))) + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(w, 2);
    canvas.height = Math.max(h, 2);
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(angle);
    ctx.font = font;
    ctx.fillStyle = opts.color || '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    return canvas;
  }

  // 将任意常见格式的图片嵌入 PDF（JPG/PNG 直接嵌入，其余经 imageFileToCanvas 转 PNG）
  async function embedImageFile(pdfDoc, file) {
    const buf = await file.arrayBuffer();
    const isPng = /png$/i.test(file.name) || file.type === 'image/png';
    const isJpeg = /jpe?g$/i.test(file.name) || file.type === 'image/jpeg';
    if (isPng) {
      try { return await pdfDoc.embedPng(buf); } catch (e) { /* fall through */ }
    }
    if (isJpeg) {
      try { return await pdfDoc.embedJpg(buf); } catch (e) { /* fall through */ }
    }
    const canvas = await imageFileToCanvas(file);
    const png = await canvasToBlob(canvas, 'image/png');
    return pdfDoc.embedPng(await png.arrayBuffer());
  }

  // pdf.js 渲染某页到 canvas
  async function renderPageToCanvas(pdfDoc, pageNum, scale, transparent, renderOpts) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d', { alpha: !!transparent });
    if (!transparent) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const params = {
      canvasContext: ctx,
      viewport,
      background: transparent ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,1)',
    };
    if (renderOpts && renderOpts.annotationMode != null) params.annotationMode = renderOpts.annotationMode;
    await page.render(params).promise;
    return canvas;
  }

  function safeLookup(dict, key, type) {
    try { return dict && dict.lookup(PDFLib.PDFName.of(key), type); } catch (e) { return null; }
  }

  function getEmbeddedFilesDict(pdfDoc) {
    const names = safeLookup(pdfDoc.catalog, 'Names', PDFLib.PDFDict);
    return names ? safeLookup(names, 'EmbeddedFiles', PDFLib.PDFDict) : null;
  }

  // PDF 十六进制字符串（UTF-16BE）转可读文件名
  function pdfTextValueToString(value) {
    if (!value) return '';
    try {
      if (typeof value.decode === 'function') {
        const decoded = value.decode();
        if (typeof decoded === 'string') return decoded;
      }
    } catch (e) { /* ignore */ }
    let str = '';
    try { str = value.asString ? value.asString() : String(value); } catch (e) { /* ignore */ }
    if (/^[0-9A-Fa-f]+$/.test(str) && str.length >= 4 && str.length % 4 === 0) {
      let decoded = '';
      for (let i = 0; i < str.length; i += 4) {
        const code = parseInt(str.slice(i, i + 4), 16);
        if (i === 0 && code === 0xFEFF) continue;
        decoded += String.fromCharCode(code);
      }
      if (decoded) return decoded;
    }
    return str;
  }

  function collectEmbeddedFileEntries(node, out, depth) {
    if (!node || depth > 20) return;
    const arr = safeLookup(node, 'Names', PDFLib.PDFArray);
    if (arr) {
      for (let i = 1; i < arr.size(); i += 2) {
        let spec = null;
        try { spec = arr.lookup(i, PDFLib.PDFDict); } catch (e) { spec = null; }
        if (!spec) continue;
        let fname = '';
        try {
          fname = pdfTextValueToString(spec.get(PDFLib.PDFName.of('UF'))) ||
                  pdfTextValueToString(spec.get(PDFLib.PDFName.of('F')));
        } catch (e) { /* ignore */ }
        let bytes = null;
        try {
          const efDict = safeLookup(spec, 'EF', PDFLib.PDFDict);
          const stream = efDict && efDict.lookup(PDFLib.PDFName.of('F'));
          if (stream) {
            try { bytes = PDFLib.decodePDFRawStream(stream).decode(); }
            catch (e) { if (stream.getContents) bytes = stream.getContents(); }
          }
        } catch (e) { /* ignore */ }
        if (bytes) out.push({ name: fname || ('附件' + (out.length + 1)), bytes });
      }
    }
    const kids = safeLookup(node, 'Kids', PDFLib.PDFArray);
    if (kids) {
      for (let i = 0; i < kids.size(); i++) {
        let kid = null;
        try { kid = kids.lookup(i, PDFLib.PDFDict); } catch (e) { kid = null; }
        if (kid) collectEmbeddedFileEntries(kid, out, depth + 1);
      }
    }
  }

  // 读取 PDF 内嵌附件（递归遍历名称树的 Names / Kids）
  function listEmbeddedFiles(pdfDoc) {
    const out = [];
    try {
      const ef = getEmbeddedFilesDict(pdfDoc);
      if (ef) collectEmbeddedFileEntries(ef, out, 0);
    } catch (e) { /* ignore */ }
    return out;
  }

  // 递归清除所有潜在风险动作（/JavaScript、/Launch、/SubmitForm、/ImportData、/GoToR、/URI），
  // 覆盖批注、书签、表单域等全部间接对象；删除动作载荷键使其失效
  const RISKY_ACTION_KEYS = {
    JavaScript: ['JS'],
    Launch: ['F', 'Win'],
    SubmitForm: ['F', 'Fields', 'Flags'],
    ImportData: ['F'],
    GoToR: ['F', 'D'],
    URI: ['URI'],
  };
  function stripRiskyActions(doc) {
    let count = 0;
    const visited = new Set();
    const neutralize = (node) => {
      let type = '';
      try {
        const s = node.get(PDFLib.PDFName.of('S'));
        type = s ? String(s).replace(/^\//, '') : '';
      } catch (e) { return false; }
      const keys = RISKY_ACTION_KEYS[type];
      if (!keys) return false;
      let touched = false;
      for (const k of keys) {
        try {
          if (node.get(PDFLib.PDFName.of(k))) {
            node.delete(PDFLib.PDFName.of(k));
            touched = true;
          }
        } catch (e) { /* ignore */ }
      }
      return touched;
    };
    const visit = (node, depth) => {
      if (!node || depth > 20) return;
      if (node.dict instanceof PDFLib.PDFDict) node = node.dict;
      if (node instanceof PDFLib.PDFDict) {
        if (visited.has(node)) return;
        visited.add(node);
        if (neutralize(node)) count++;
        let keys = [];
        try { keys = node.keys(); } catch (e) { keys = []; }
        for (const key of keys) {
          let value = null;
          try { value = node.get(key); } catch (e) { value = null; }
          visit(value, depth + 1);
        }
        return;
      }
      if (node instanceof PDFLib.PDFArray) {
        if (visited.has(node)) return;
        visited.add(node);
        for (let i = 0; i < node.size(); i++) {
          let value = null;
          try { value = node.get(i); } catch (e) { value = null; }
          visit(value, depth + 1);
        }
      }
    };
    try {
      for (const entry of doc.context.enumerateIndirectObjects()) visit(entry[1], 0);
    } catch (e) { /* ignore */ }
    return count;
  }

  function copyDocumentMetadata(target, source) {
    try {
      const title = source.getTitle();
      const author = source.getAuthor();
      const subject = source.getSubject();
      const keywords = source.getKeywords();
      const producer = source.getProducer();
      const creator = source.getCreator();
      const created = source.getCreationDate();
      const modified = source.getModificationDate();
      if (title) target.setTitle(title);
      if (author) target.setAuthor(author);
      if (subject) target.setSubject(subject);
      if (keywords) target.setKeywords(keywords.split(/\s+/).filter(Boolean));
      if (producer) target.setProducer(producer);
      if (creator) target.setCreator(creator);
      if (created instanceof Date && !isNaN(created.getTime())) target.setCreationDate(created);
      if (modified instanceof Date && !isNaN(modified.getTime())) target.setModificationDate(modified);
    } catch (e) { /* ignore */ }
  }

  // 小册子拼版页序（n 页补齐为 4 的倍数后按折页顺序重排）
  function bookletOrder(n) {
    const padded = Math.ceil(n / 4) * 4;
    const order = [];
    let left = 0, right = padded - 1;
    while (left < right) {
      order.push(right, left, left + 1, right - 1);
      left += 2;
      right -= 2;
    }
    return order.map(i => (i < n ? i : -1)); // -1 = 补白页
  }

  // 栅格化重建 PDF（可叠加 canvas filter，用于扫描件增强 / 扁平化）
  async function rasterizePdfToBlob(file, opts, onProgress) {
    let source = file;
    if (opts.flattenForms) {
      try {
        const libDoc = await loadPdfDoc(file);
        const form = libDoc.getForm();
        if (form.getFields().length) form.flatten();
        source = new Blob([await libDoc.save()], { type: 'application/pdf' });
      } catch (e) {
        source = file;
      }
    }
    const src = await loadPdfjsDoc(source);
    const annotationMode = (typeof pdfjsLib !== 'undefined' && pdfjsLib.AnnotationMode)
      ? pdfjsLib.AnnotationMode.ENABLE
      : undefined;
    const total = src.numPages;
    const doc = await PDFLib.PDFDocument.create();
    for (let i = 1; i <= total; i++) {
      if (onProgress) onProgress(i - 1, total, `正在处理第 ${i}/${total} 页…`);
      const page = await src.getPage(i);
      const pt = page.getViewport({ scale: 1 });
      let cv = await renderPageToCanvas(src, i, opts.scale, false, { annotationMode });
      if (opts.filter) {
        const filtered = document.createElement('canvas');
        filtered.width = cv.width;
        filtered.height = cv.height;
        const c = filtered.getContext('2d');
        c.filter = opts.filter;
        c.drawImage(cv, 0, 0);
        cv = filtered;
      }
      const jpg = await canvasToBlob(cv, 'image/jpeg', opts.quality);
      const img = await doc.embedJpg(await jpg.arrayBuffer());
      const out = doc.addPage([pt.width, pt.height]);
      out.drawImage(img, { x: 0, y: 0, width: pt.width, height: pt.height });
    }
    return bytesToBlob(await doc.save(), 'application/pdf');
  }

  // 提取 PDF 文本行（按 y 坐标聚行，页间加分页标记）
  async function extractPdfLines(file) {
    const doc = await loadPdfjsDoc(file);
    const lines = [];
    for (let i = 1; i <= doc.numPages; i++) {
      lines.push(`--- 第 ${i} 页 ---`);
      const tc = await (await doc.getPage(i)).getTextContent();
      let lastY = null, buf = [];
      for (const item of tc.items) {
        const y = item.transform ? item.transform[5] : 0;
        if (lastY !== null && Math.abs(y - lastY) > 2.5) {
          lines.push(buf.join('').replace(/\s+/g, ' ').trim());
          buf = [];
        }
        buf.push(item.str);
        lastY = y;
      }
      if (buf.length) lines.push(buf.join('').replace(/\s+/g, ' ').trim());
    }
    return lines.filter(l => l !== '');
  }

  // 行级 LCS 文本差异（规模过大时返回 null）
  function diffLines(aLines, bLines) {
    const n = aLines.length, m = bLines.length;
    if (n > 2500 || m > 2500) return null;
    const dp = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * (m + 1) + j] = aLines[i] === bLines[j]
          ? dp[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (aLines[i] === bLines[j]) { ops.push({ t: '=', s: aLines[i] }); i++; j++; }
      else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) { ops.push({ t: '-', s: aLines[i] }); i++; }
      else { ops.push({ t: '+', s: bLines[j] }); j++; }
    }
    while (i < n) ops.push({ t: '-', s: aLines[i++] });
    while (j < m) ops.push({ t: '+', s: bLines[j++] });
    return ops;
  }

  // 清理文件名非法字符
  function sanitizeFileName(name) {
    return (name || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || '未命名';
  }

  // HTML 转义（用于把文件名安全插入 innerHTML）
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ============================================================
     3b. 图片编解码：常见格式统一入口
     - 输入：浏览器原生可解码的格式直接解码；TIFF / ICO 用内置解码器兜底，
             HEIC / PSD 等无法解码的格式给出明确提示
     - 输出：PNG / JPG / WebP / AVIF（浏览器支持时）/ BMP / TIFF
     ============================================================ */

  /* 图片工具统一接受的文件扩展名：accept 属性与拖拽校验共用 */
  const IMAGE_EXTS = [
    'jpg', 'jpeg', 'jpe', 'jfif', 'png', 'apng', 'webp', 'gif', 'bmp', 'dib',
    'tif', 'tiff', 'svg', 'ico', 'cur', 'avif', 'heic', 'heif'
  ];
  const IMAGE_ACCEPT = ['image/*'].concat(IMAGE_EXTS.map(ext => '.' + ext)).join(',');
  const IMAGE_FORMAT_LABEL = 'JPG / PNG / WebP / GIF / BMP / TIFF / SVG / ICO / AVIF';

  function imageExtOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function isImageFileName(name) {
    return IMAGE_EXTS.indexOf(imageExtOf(name)) >= 0;
  }

  function canvasFromDrawable(src, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(src, 0, 0, w, h);
    return canvas;
  }

  /* 浏览器原生解码（含 EXIF 方向）：失败时由调用方回退到内置解码器 */
  function imageBlobToCanvas(blob) {
    return new Promise((resolve, reject) => {
      const url = trackUrl(URL.createObjectURL(blob));
      const el = new Image();
      el.onload = () => {
        try {
          const w = el.naturalWidth || el.width;
          const h = el.naturalHeight || el.height;
          if (!w || !h) throw new Error('图片尺寸为空');
          resolve(canvasFromDrawable(el, w, h));
        } catch (e) {
          reject(e);
        } finally {
          revokeUrl(url);
        }
      };
      el.onerror = () => {
        revokeUrl(url);
        reject(new Error('图片解码失败'));
      };
      el.src = url;
    });
  }

  /* 通过文件头识别浏览器普遍无法解码的格式 */
  function sniffImageKind(bytes) {
    const b = bytes;
    if (!b || b.length < 4) return '';
    if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) return 'tiff';
    if (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a) return 'tiff';
    if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02) && b[3] === 0x00) return 'ico';
    if (b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53) return 'psd';
    if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
      if (/^(hei[cxms]|hevc|hevx|mif1|msf1)$/.test(brand)) return 'heic';
    }
    return '';
  }

  async function imageFileToCanvas(file) {
    try {
      return await imageBlobToCanvas(file);
    } catch (nativeErr) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = sniffImageKind(bytes);
      if (kind === 'tiff') {
        try {
          return await tiffToCanvas(bytes);
        } catch (e) {
          throw new Error('TIFF 解码失败：' + (e && e.message ? e.message : '文件可能已损坏') + '（' + file.name + '）');
        }
      }
      if (kind === 'ico') {
        try {
          return await icoToCanvas(bytes);
        } catch (e) {
          throw new Error('ICO 解码失败：' + (e && e.message ? e.message : '文件可能已损坏') + '（' + file.name + '）');
        }
      }
      if (kind === 'heic') throw new Error('浏览器无法解码 HEIC / HEIF，请先在系统相册中导出为 JPG 再处理：' + file.name);
      if (kind === 'psd') throw new Error('暂不支持 PSD，请先导出为 PNG / JPG：' + file.name);
      throw new Error('图片加载失败，格式可能不受支持：' + file.name);
    }
  }

  function createByteSink(initial) {
    let buf = new Uint8Array(Math.max(256, initial || 1024));
    let len = 0;
    return {
      push(byte) {
        if (len === buf.length) {
          const next = new Uint8Array(buf.length * 2);
          next.set(buf);
          buf = next;
        }
        buf[len++] = byte;
      },
      bytes() { return buf.subarray(0, len); }
    };
  }

  /* ---- PackBits 解压（TIFF 压缩方式 32773） ---- */
  function packBitsDecompress(data) {
    const sink = createByteSink(data.length * 2);
    for (let i = 0; i < data.length;) {
      const n = data[i++];
      if (n < 128) {
        const end = Math.min(data.length, i + n + 1);
        while (i < end) sink.push(data[i++]);
      } else if (n > 128) {
        if (i >= data.length) break;
        const val = data[i++];
        for (let k = 0; k < 257 - n; k++) sink.push(val);
      }
    }
    return sink.bytes();
  }

  /* ---- LZW 解压（TIFF 压缩方式 5，MSB 优先、提前一位换宽） ---- */
  function lzwDecompress(data) {
    const sink = createByteSink(data.length * 4);
    let dict = [];
    let codeLen = 9;
    let bitPos = 0;
    const totalBits = data.length * 8;
    const readCode = () => {
      if (bitPos + codeLen > totalBits) return -1;
      let code = 0;
      for (let i = 0; i < codeLen; i++) {
        code = (code << 1) | ((data[bitPos >> 3] >> (7 - (bitPos & 7))) & 1);
        bitPos++;
      }
      return code;
    };
    const resetDict = () => {
      dict = new Array(258);
      for (let i = 0; i < 256; i++) dict[i] = [i];
      codeLen = 9;
    };
    resetDict();
    let prev = null;
    while (bitPos < totalBits) {
      const code = readCode();
      if (code < 0 || code === 257) break;
      if (code === 256) { resetDict(); prev = null; continue; }
      let entry = dict[code];
      if (!entry) {
        if (!prev) throw new Error('LZW 数据损坏');
        entry = prev.concat(prev[0]);
      }
      for (let i = 0; i < entry.length; i++) sink.push(entry[i]);
      if (prev && dict.length < 4096) dict.push(prev.concat(entry[0]));
      prev = entry;
      if (codeLen < 12 && dict.length === (1 << codeLen) - 1) codeLen++;
    }
    return sink.bytes();
  }

  async function tiffDecompress(data, compression) {
    if (compression === 1) return data;
    if (compression === 32773) return packBitsDecompress(data);
    if (compression === 5) return lzwDecompress(data);
    if (compression === 8 || compression === 32946) {
      if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解压 Deflate 压缩的 TIFF');
      try {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) {
        throw new Error('Deflate 像素数据解压失败');
      }
    }
    if (compression === 2 || compression === 3 || compression === 4) {
      throw new Error('暂不支持传真压缩（CCITT G3 / G4）的 TIFF，请先转为 PDF 或 PNG');
    }
    throw new Error('暂不支持该 TIFF 压缩方式（' + compression + '）');
  }

  const TIFF_TYPE_BYTES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  function tiffFirst(arr, def) {
    return arr && arr.length ? arr[0] : def;
  }

  /* 解析 TIFF 结构（经典 32 位 TIFF，支持条带与分块存储） */
  function tiffParse(bytes) {
    if (bytes.length < 8) throw new Error('文件不完整');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const le = bytes[0] === 0x49 && bytes[1] === 0x49;
    if (!le && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) throw new Error('不是有效的 TIFF 文件');
    const u16 = o => dv.getUint16(o, le);
    const u32 = o => dv.getUint32(o, le);
    const magic = u16(2);
    if (magic === 43) throw new Error('暂不支持 BigTIFF，请另存为普通 TIFF');
    if (magic !== 42) throw new Error('不是有效的 TIFF 文件');
    const ifdOffset = u32(4);
    if (ifdOffset + 2 > bytes.length) throw new Error('文件结构不完整');
    const tags = {};
    const count = u16(ifdOffset);
    for (let i = 0; i < count; i++) {
      const e = ifdOffset + 2 + i * 12;
      if (e + 12 > bytes.length) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const n = u32(e + 4);
      const unit = TIFF_TYPE_BYTES[type] || 1;
      const size = unit * n;
      const offset = size <= 4 ? e + 8 : u32(e + 8);
      if (offset < 0 || offset + size > bytes.length) continue;
      tags[tag] = { type, count: n, offset, unit };
    }
    const values = (tag) => {
      const t = tags[tag];
      if (!t) return null;
      const out = new Array(t.count);
      for (let i = 0; i < t.count; i++) {
        const o = t.offset + i * t.unit;
        if (t.type === 3) out[i] = dv.getUint16(o, le);
        else if (t.type === 4) out[i] = dv.getUint32(o, le);
        else if (t.type === 1 || t.type === 7) out[i] = dv.getUint8(o);
        else if (t.type === 6) out[i] = dv.getInt8(o);
        else if (t.type === 8) out[i] = dv.getInt16(o, le);
        else if (t.type === 9) out[i] = dv.getInt32(o, le);
        else if (t.type === 5) out[i] = dv.getUint32(o, le) / (dv.getUint32(o + 4, le) || 1);
        else if (t.type === 10) out[i] = dv.getInt32(o, le) / (dv.getInt32(o + 4, le) || 1);
        else if (t.type === 11) out[i] = dv.getFloat32(o, le);
        else if (t.type === 12) out[i] = dv.getFloat64(o, le);
        else out[i] = 0;
      }
      return out;
    };

    const width = tiffFirst(values(256), 0);
    const height = tiffFirst(values(257), 0);
    if (!width || !height) throw new Error('缺少图片尺寸信息');
    const bitsArr = values(258) || [1];
    const samples = tiffFirst(values(277), 0) || bitsArr.length;
    const bits = bitsArr.length === 1 && samples > 1 ? new Array(samples).fill(bitsArr[0]) : bitsArr;
    const compression = tiffFirst(values(259), 1);
    const photo = tiffFirst(values(262), samples >= 3 ? 2 : 1);
    const predictor = tiffFirst(values(317), 1);
    const planar = tiffFirst(values(284), 1);
    const orientation = tiffFirst(values(274), 1);
    const colorMap = values(320);

    const chunks = [];
    if (tags[324] && tags[325]) {
      const tw = tiffFirst(values(322), 0) || width;
      const th = tiffFirst(values(323), 0) || height;
      const offs = values(324) || [];
      const sizes = values(325) || [];
      const across = Math.max(1, Math.ceil(width / tw));
      for (let i = 0; i < offs.length; i++) {
        const x = (i % across) * tw;
        const y = Math.floor(i / across) * th;
        if (y >= height) break;
        chunks.push({ x, y, w: Math.min(tw, width - x), h: Math.min(th, height - y), offset: offs[i], byteCount: sizes[i] || 0 });
      }
    } else {
      const offs = values(273) || [];
      const sizes = values(279) || [];
      const rowsPerStrip = tiffFirst(values(278), 0) || height;
      for (let i = 0; i < offs.length; i++) {
        const y = i * rowsPerStrip;
        if (y >= height) break;
        const next = i + 1 < offs.length ? offs[i + 1] : bytes.length;
        chunks.push({
          x: 0, y, w: width, h: Math.min(rowsPerStrip, height - y),
          offset: offs[i], byteCount: sizes[i] || Math.max(0, next - offs[i])
        });
      }
    }
    if (!chunks.length) throw new Error('缺少像素数据');

    return { width, height, samples, bits, compression, photo, predictor, planar, orientation, colorMap, le, chunks };
  }

  /* 水平差分预测（Predictor = 2）还原 */
  function tiffUndoPredictor(raw, rowSamples, samples, bps, le) {
    if (bps === 8) {
      for (let base = 0; base + rowSamples <= raw.length; base += rowSamples) {
        for (let i = samples; i < rowSamples; i++) raw[base + i] = (raw[base + i] + raw[base + i - samples]) & 0xFF;
      }
      return;
    }
    if (bps === 16) {
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const rowBytes = rowSamples * 2;
      for (let base = 0; base + rowBytes <= raw.length; base += rowBytes) {
        for (let i = samples; i < rowSamples; i++) {
          const o = base + i * 2;
          dv.setUint16(o, (dv.getUint16(o, le) + dv.getUint16(o - samples * 2, le)) & 0xFFFF, le);
        }
      }
      return;
    }
    throw new Error('暂不支持 ' + bps + ' 位色深的水平差分预测');
  }

  async function tiffPixels(info, bytes) {
    const bps = info.bits[0];
    if (info.planar === 2) throw new Error('暂不支持分通道（Planar）存储的 TIFF');
    if (info.photo === 6) throw new Error('暂不支持 YCbCr 色彩空间的 TIFF，请先转为 JPG / PNG');
    if ([1, 2, 4, 8, 16].indexOf(bps) < 0) throw new Error('暂不支持 ' + bps + ' 位色深的 TIFF');
    if (info.photo === 3 && !info.colorMap) throw new Error('调色板数据缺失');

    const to8 = bps === 16 ? (v => v >> 8) : bps === 8 ? (v => v) : (v => Math.round(v * 255 / ((1 << bps) - 1)));
    const maxSample = (1 << bps) - 1;
    let read;
    if (bps === 8) read = (raw, i) => raw[i] || 0;
    else if (bps === 16) read = info.le
      ? (raw, i) => (raw[i * 2] || 0) | ((raw[i * 2 + 1] || 0) << 8)
      : (raw, i) => ((raw[i * 2] || 0) << 8) | (raw[i * 2 + 1] || 0);
    else read = (raw, i) => {
      const bit = i * bps;
      const byte = raw[bit >> 3] || 0;
      return (byte >> (8 - bps - (bit & 7))) & maxSample;
    };

    const colorMap = info.colorMap;
    const paletteSize = colorMap ? Math.floor(colorMap.length / 3) : 0;
    const rgba = new Uint8ClampedArray(info.width * info.height * 4);

    for (const chunk of info.chunks) {
      if (chunk.offset < 0 || chunk.offset + chunk.byteCount > bytes.length || chunk.byteCount <= 0) {
        throw new Error('像素数据超出文件末尾');
      }
      let raw = bytes.subarray(chunk.offset, chunk.offset + chunk.byteCount);
      raw = await tiffDecompress(raw, info.compression);
      const rowSamples = chunk.w * info.samples;
      if (info.predictor === 2) tiffUndoPredictor(raw, rowSamples, info.samples, bps, info.le);
      const samples = info.samples;
      for (let y = 0; y < chunk.h; y++) {
        const base = y * rowSamples;
        let di = ((chunk.y + y) * info.width + chunk.x) * 4;
        for (let x = 0; x < chunk.w; x++) {
          const si = base + x * samples;
          if (info.photo === 2) {
            rgba[di] = to8(read(raw, si));
            rgba[di + 1] = to8(read(raw, si + 1));
            rgba[di + 2] = to8(read(raw, si + 2));
            rgba[di + 3] = samples > 3 ? to8(read(raw, si + 3)) : 255;
          } else if (info.photo === 3) {
            const idx = Math.min(read(raw, si), Math.max(0, paletteSize - 1));
            rgba[di] = colorMap[idx] >> 8;
            rgba[di + 1] = colorMap[paletteSize + idx] >> 8;
            rgba[di + 2] = colorMap[paletteSize * 2 + idx] >> 8;
            rgba[di + 3] = 255;
          } else if (info.photo === 5) {
            const c = to8(read(raw, si));
            const m = to8(read(raw, si + 1));
            const yv = to8(read(raw, si + 2));
            const k = samples > 3 ? to8(read(raw, si + 3)) : 0;
            rgba[di] = Math.round((255 - c) * (255 - k) / 255);
            rgba[di + 1] = Math.round((255 - m) * (255 - k) / 255);
            rgba[di + 2] = Math.round((255 - yv) * (255 - k) / 255);
            rgba[di + 3] = 255;
          } else {
            const v = to8(read(raw, si));
            const gray = info.photo === 0 ? 255 - v : v;
            rgba[di] = gray;
            rgba[di + 1] = gray;
            rgba[di + 2] = gray;
            rgba[di + 3] = samples > 1 ? to8(read(raw, si + 1)) : 255;
          }
          di += 4;
        }
      }
    }
    return rgba;
  }

  /* 应用 TIFF / EXIF 方向（1-8） */
  function applyImageOrientation(canvas, orientation) {
    const o = orientation | 0;
    if (o <= 1 || o > 8) return canvas;
    const w = canvas.width, h = canvas.height;
    const swap = o >= 5;
    const out = document.createElement('canvas');
    out.width = swap ? h : w;
    out.height = swap ? w : h;
    const ctx = out.getContext('2d');
    switch (o) {
      case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, h, w); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
    }
    ctx.drawImage(canvas, 0, 0);
    return out;
  }

  async function tiffJpegToCanvas(info, bytes) {
    const canvas = document.createElement('canvas');
    canvas.width = info.width;
    canvas.height = info.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, info.width, info.height);
    for (const chunk of info.chunks) {
      const slice = bytes.subarray(chunk.offset, chunk.offset + chunk.byteCount);
      if (!slice.length) continue;
      const part = await imageBlobToCanvas(new Blob([slice], { type: 'image/jpeg' }));
      ctx.drawImage(part, chunk.x, chunk.y, chunk.w, chunk.h);
    }
    return canvas;
  }

  async function tiffToCanvas(bytes) {
    const info = tiffParse(bytes);
    let canvas;
    if (info.compression === 7) {
      canvas = await tiffJpegToCanvas(info, bytes);
    } else {
      const data = await tiffPixels(info, bytes);
      canvas = document.createElement('canvas');
      canvas.width = info.width;
      canvas.height = info.height;
      canvas.getContext('2d').putImageData(new ImageData(data, info.width, info.height), 0, 0);
    }
    return applyImageOrientation(canvas, info.orientation);
  }

  /* ---- ICO / CUR 解码（取最大尺寸图像，支持 PNG 内嵌与 BMP 位图） ---- */
  async function icoToCanvas(bytes) {
    if (bytes.length < 6) throw new Error('文件不完整');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = dv.getUint16(4, true);
    if (!count) throw new Error('不包含图像');
    let best = null;
    for (let i = 0; i < count; i++) {
      const e = 6 + i * 16;
      if (e + 16 > bytes.length) break;
      const w = dv.getUint8(e) || 256;
      const h = dv.getUint8(e + 1) || 256;
      const size = dv.getUint32(e + 8, true);
      const off = dv.getUint32(e + 12, true);
      if (!size || off + size > bytes.length) continue;
      if (!best || w * h > best.w * best.h) best = { w, h, size, off };
    }
    if (!best) throw new Error('图像数据损坏');
    const data = bytes.subarray(best.off, best.off + best.size);
    if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
      return imageBlobToCanvas(new Blob([data], { type: 'image/png' }));
    }
    return icoDibToCanvas(data);
  }

  function icoDibToCanvas(data) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const headerSize = dv.getUint32(0, true);
    const width = dv.getInt32(4, true);
    const fullHeight = Math.abs(dv.getInt32(8, true));
    const height = fullHeight >> 1;
    const bpp = dv.getUint16(14, true);
    const compression = dv.getUint32(16, true);
    const clrUsed = dv.getUint32(32, true);
    if (!width || !height) throw new Error('尺寸无效');
    if (compression !== 0 && compression !== 3) throw new Error('暂不支持该压缩方式');
    if ([1, 4, 8, 24, 32].indexOf(bpp) < 0) throw new Error('暂不支持 ' + bpp + ' 位色深');

    const paletteCount = bpp <= 8 ? (clrUsed || (1 << bpp)) : 0;
    const paletteOffset = headerSize;
    const xorOffset = paletteOffset + paletteCount * 4;
    const xorRow = Math.floor((bpp * width + 31) / 32) * 4;
    const maskRow = Math.floor((width + 31) / 32) * 4;
    const maskOffset = xorOffset + xorRow * height;
    if (xorOffset + xorRow * height > data.length) throw new Error('像素数据不完整');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    const px = image.data;

    let hasAlpha = false;
    if (bpp === 32) {
      for (let y = 0; y < height && !hasAlpha; y++) {
        const row = xorOffset + (height - 1 - y) * xorRow;
        for (let x = 0; x < width; x++) {
          if (data[row + x * 4 + 3]) { hasAlpha = true; break; }
        }
      }
    }

    for (let y = 0; y < height; y++) {
      const row = xorOffset + (height - 1 - y) * xorRow;
      let di = y * width * 4;
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, a = 255;
        if (bpp === 32) {
          const o = row + x * 4;
          b = data[o]; g = data[o + 1]; r = data[o + 2];
          a = hasAlpha ? data[o + 3] : 255;
        } else if (bpp === 24) {
          const o = row + x * 3;
          b = data[o]; g = data[o + 1]; r = data[o + 2];
        } else {
          const bit = x * bpp;
          let idx;
          if (bpp === 8) idx = data[row + x];
          else if (bpp === 4) idx = (data[row + (bit >> 3)] >> (4 - (bit & 7))) & 0xF;
          else idx = (data[row + (bit >> 3)] >> (7 - (bit & 7))) & 1;
          const po = paletteOffset + idx * 4;
          b = data[po] || 0; g = data[po + 1] || 0; r = data[po + 2] || 0;
        }
        if (bpp !== 32) {
          const mo = maskOffset + (height - 1 - y) * maskRow + (x >> 3);
          if (mo < data.length && ((data[mo] >> (7 - (x & 7))) & 1)) a = 0;
        }
        px[di] = r; px[di + 1] = g; px[di + 2] = b; px[di + 3] = a;
        di += 4;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  /* ---- 输出格式 ---- */
  const imageExportCache = {};

  function imageExportSupported(format) {
    const fmt = String(format || '').toLowerCase();
    if (fmt === 'bmp' || fmt === 'tiff') return true;
    const mime = fmt === 'jpg' || fmt === 'jpeg' ? 'image/jpeg' : 'image/' + fmt;
    if (imageExportCache[mime] != null) return imageExportCache[mime];
    let ok = false;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      ok = canvas.toDataURL(mime).indexOf('data:' + mime) === 0;
    } catch (e) { ok = false; }
    imageExportCache[mime] = ok;
    return ok;
  }

  function imageOutputExt(format) {
    const fmt = String(format || 'png').toLowerCase();
    return fmt === 'jpeg' ? 'jpg' : fmt;
  }

  /* 透明背景压到白底，供 JPG / BMP / TIFF 等不支持透明的格式使用 */
  function flattenCanvasOnWhite(canvas) {
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    return out;
  }

  async function canvasToImageBlob(canvas, format, quality) {
    const fmt = String(format || 'png').toLowerCase();
    if (fmt === 'bmp') return bytesToBlob(canvasToBmpBytes(canvas), 'image/bmp');
    if (fmt === 'tiff') return bytesToBlob(canvasToTiffBytes(canvas), 'image/tiff');
    if (!imageExportSupported(fmt)) {
      throw new Error('当前浏览器不支持导出 ' + fmt.toUpperCase() + '，请改用 PNG / JPG / WebP / BMP / TIFF');
    }
    const mime = fmt === 'jpg' || fmt === 'jpeg' ? 'image/jpeg' : 'image/' + fmt;
    const blob = await canvasToBlob(canvas, mime, quality);
    if (!blob) throw new Error('导出 ' + fmt.toUpperCase() + ' 失败');
    return blob;
  }
  /* ============================================================
     3c. 图片附加能力：EXIF 读取与保留、锐化、文本换行
     - EXIF：支持 JPEG(APP1) / TIFF / PNG(eXIf) / WebP(EXIF) 读取
     - 保留元数据：压缩 JPG 时把原始 APP1 段搬运到新 JPEG
     - 锐化：分离式 3×3 均值模糊 + 反锐化掩模，O(像素) 且省内存
     ============================================================ */

  const EXIF_TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  const EXIF_TAGS_IFD0 = {
    0x0100: '图像宽度', 0x0101: '图像高度', 0x010E: '图像描述', 0x010F: '制造商',
    0x0110: '相机型号', 0x0112: '方向', 0x011A: '水平分辨率', 0x011B: '垂直分辨率',
    0x0128: '分辨率单位', 0x0131: '软件', 0x0132: '修改时间', 0x013B: '作者',
    0x8298: '版权', 0x0213: 'YCbCr 定位',
  };

  const EXIF_TAGS_EXIF = {
    0x829A: '曝光时间', 0x829D: '光圈值', 0x8822: '曝光程序', 0x8827: 'ISO 感光度',
    0x9000: 'EXIF 版本', 0x9003: '拍摄时间', 0x9004: '数字化时间', 0x9101: '色彩空间配置',
    0x9201: '快门速度', 0x9202: '最大光圈', 0x9204: '曝光补偿', 0x9207: '测光模式',
    0x9209: '闪光灯', 0x920A: '焦距', 0x9290: '秒', 0x9291: '亚秒', 0x9292: '原始亚秒',
    0xA000: 'FlashPix 版本', 0xA001: '色彩空间', 0xA002: '像素宽度', 0xA003: '像素高度',
    0xA402: '曝光模式', 0xA403: '白平衡', 0xA405: '等效焦距', 0xA406: '场景模式',
    0xA408: '对比度', 0xA409: '饱和度', 0xA40A: '锐度', 0xA430: '相机所有者', 0xA434: '镜头型号',
  };

  const EXIF_TAGS_GPS = {
    0x0000: 'GPS 版本', 0x0001: '纬度参考', 0x0002: '纬度', 0x0003: '经度参考',
    0x0004: '经度', 0x0005: '高度参考', 0x0006: '高度', 0x0007: 'GPS 时间',
    0x001D: 'GPS 日期',
  };

  function exifRound(n, digits) {
    const v = Number(n);
    if (!Number.isFinite(v)) return String(n);
    return String(parseFloat(v.toFixed(digits)));
  }

  /* 在字节流里定位 TIFF 头，返回 { base, le }；不含 EXIF 时返回 null */
  function locateExifTiff(bytes) {
    if (!bytes || bytes.length < 8) return null;
    const isTiff = (bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4D && bytes[1] === 0x4D);
    if (isTiff) {
      const le = bytes[0] === 0x49;
      const magic = le ? (bytes[2] | (bytes[3] << 8)) : ((bytes[2] << 8) | bytes[3]);
      return magic === 42 ? { base: 0, le } : null;
    }
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      // JPEG：逐段扫描，命中 APP1 且载荷以 "Exif\0\0" 开头
      let i = 2;
      while (i + 4 <= bytes.length) {
        if (bytes[i] !== 0xFF) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
        if (marker === 0xDA || marker === 0xD9) break;
        const len = (bytes[i + 2] << 8) | bytes[i + 3];
        if (len < 2) break;
        if (marker === 0xE1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 &&
            bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
          const base = i + 10;
          return base + 8 <= bytes.length ? { base, le: bytes[base] === 0x49 } : null;
        }
        i += 2 + len;
      }
      return null;
    }
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      let i = 8;
      while (i + 8 <= bytes.length) {
        const len = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
        const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
        if (type === 'eXIf') return { base: i + 8, le: bytes[i + 8] === 0x49 };
        if (type === 'IEND') break;
        i += 12 + len;
      }
      return null;
    }
    if (bytes.length > 16 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      let i = 12;
      while (i + 8 <= bytes.length) {
        const type = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
        const len = (bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)) >>> 0;
        if (type === 'EXIF') {
          const withHead = bytes[i + 8] === 0x45 && bytes[i + 9] === 0x78;
          const base = i + (withHead ? 14 : 8);
          return base + 8 <= bytes.length ? { base, le: bytes[base] === 0x49 } : null;
        }
        i += 8 + len + (len & 1);
      }
    }
    return null;
  }

  function readExifValue(dv, offset, type, count, le) {
    if (type === 2) {
      let s = '';
      for (let i = 0; i < count; i++) {
        const code = dv.getUint8(offset + i);
        if (code === 0) break;
        s += String.fromCharCode(code);
      }
      return s.trim();
    }
    const out = [];
    for (let i = 0; i < count; i++) {
      const o = offset + i * (EXIF_TYPE_SIZE[type] || 1);
      if (type === 1 || type === 7) out.push(dv.getUint8(o));
      else if (type === 3) out.push(dv.getUint16(o, le));
      else if (type === 4) out.push(dv.getUint32(o, le));
      else if (type === 5) out.push(dv.getUint32(o + 4, le) ? dv.getUint32(o, le) / dv.getUint32(o + 4, le) : 0);
      else if (type === 6) out.push(dv.getInt8(o));
      else if (type === 8) out.push(dv.getInt16(o, le));
      else if (type === 9) out.push(dv.getInt32(o, le));
      else if (type === 10) out.push(dv.getInt32(o + 4, le) ? dv.getInt32(o, le) / dv.getInt32(o + 4, le) : 0);
      else if (type === 11) out.push(dv.getFloat32(o, le));
      else if (type === 12) out.push(dv.getFloat64(o, le));
      else out.push(0);
    }
    return out.length === 1 ? out[0] : out;
  }

  /* 读取全部可识别 EXIF 条目，返回 [{ group, tag, label, value }] */
  function readExifEntries(bytes) {
    const tiff = locateExifTiff(bytes);
    if (!tiff) return [];
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const base = tiff.base;
    const le = tiff.le;
    if (base + 8 > bytes.length) return [];
    const entries = [];
    const visited = new Set();
    const readIfd = (offset, group, depth) => {
      if (depth > 3 || !offset || visited.has(offset)) return;
      visited.add(offset);
      const start = base + offset;
      if (start < 0 || start + 2 > bytes.length) return;
      const count = dv.getUint16(start, le);
      if (count > 500) return;
      for (let i = 0; i < count; i++) {
        const e = start + 2 + i * 12;
        if (e + 12 > bytes.length) break;
        const tag = dv.getUint16(e, le);
        const type = dv.getUint16(e + 2, le);
        const n = dv.getUint32(e + 4, le);
        const unit = EXIF_TYPE_SIZE[type] || 1;
        const size = unit * n;
        if (size <= 0) continue;
        const valueOffset = size <= 4 ? e + 8 : base + dv.getUint32(e + 8, le);
        if (valueOffset < 0 || valueOffset + size > bytes.length) continue;
        if (tag === 0x8769) { readIfd(dv.getUint32(e + 8, le), 'exif', depth + 1); continue; }
        if (tag === 0x8825) { readIfd(dv.getUint32(e + 8, le), 'gps', depth + 1); continue; }
        const names = group === 'gps' ? EXIF_TAGS_GPS : (group === 'exif' ? EXIF_TAGS_EXIF : EXIF_TAGS_IFD0);
        const label = names[tag];
        if (!label) continue;
        entries.push({ group, tag, label, value: readExifValue(dv, valueOffset, type, n, le) });
      }
    };
    readIfd(dv.getUint32(base + 4, le), 'ifd0', 0);
    return entries;
  }

  const EXIF_ORIENTATION_TEXT = {
    1: '正常', 2: '水平镜像', 3: '旋转 180°', 4: '垂直镜像',
    5: '镜像后旋转 90°', 6: '顺时针旋转 90°', 7: '镜像后旋转 270°', 8: '逆时针旋转 90°',
  };

  function exifEntryByTag(entries, tag) {
    for (const e of entries) if (e.tag === tag) return e;
    return null;
  }

  function exifGpsText(entries, valueTag, refTag) {
    const item = exifEntryByTag(entries, valueTag);
    if (!item || !Array.isArray(item.value) || item.value.length < 3) return '';
    const ref = exifEntryByTag(entries, refTag);
    const deg = item.value[0] + item.value[1] / 60 + item.value[2] / 3600;
    const dir = ref && typeof ref.value === 'string' ? ref.value : '';
    return `${exifRound(deg, 6)}° ${dir}`.trim();
  }

  /* 把 EXIF 条目整理成「标签：值」的可读文本行；onlyGroup 用于按段落输出 */
  function exifReportLines(entries, onlyGroup) {
    const lines = [];
    for (const entry of entries) {
      if (onlyGroup && entry.group !== onlyGroup) continue;
      if (entry.tag === 0x0001 || entry.tag === 0x0003) continue; // 经纬度参考并入坐标行
      let text;
      if (entry.tag === 0x0002) text = exifGpsText(entries, 0x0002, 0x0001);
      else if (entry.tag === 0x0004) text = exifGpsText(entries, 0x0004, 0x0003);
      else if (entry.tag === 0x0006) {
        const ref = exifEntryByTag(entries, 0x0005);
        text = exifRound(entry.value, 2) + ' m' + (ref && ref.value === 1 ? '（海平面以下）' : '');
      } else text = exifFormatValue(entry);
      if (text === '') continue;
      lines.push(`${entry.label}：${text}`);
    }
    return lines;
  }

  function exifFormatValue(entry) {
    const v = entry.value;
    const first = Array.isArray(v) ? v[0] : v;
    const num = Number(first);
    switch (entry.tag) {
      case 0x0112: return EXIF_ORIENTATION_TEXT[first] || String(first);
      case 0x011A: case 0x011B: return exifRound(num, 2) + ' dpi';
      case 0x0128: return ({ 1: '无单位', 2: '英寸', 3: '厘米' })[first] || String(first);
      case 0x829A: {
        if (!Number.isFinite(num) || num <= 0) return String(first);
        return num >= 1 ? `${exifRound(num, 2)} 秒` : `1/${Math.round(1 / num)} 秒`;
      }
      case 0x829D: case 0x9202: return 'f/' + exifRound(num, 1);
      case 0x8827: return 'ISO ' + first;
      case 0x9201: return '1/' + Math.round(Math.pow(2, num)) + ' 秒';
      case 0x9204: return (num > 0 ? '+' : '') + exifRound(num, 2) + ' EV';
      case 0x9209: return (first & 1) ? '已闪光' : '未闪光';
      case 0x920A: case 0xA405: return exifRound(num, 1) + ' mm';
      case 0xA403: return first === 0 ? '自动' : '手动';
      case 0xA402: return ({ 0: '自动曝光', 1: '手动曝光', 2: '程序自动', 3: '光圈优先', 4: '快门优先' })[first] || String(first);
      case 0xA001: return first === 1 ? 'sRGB' : String(first);
      default: break;
    }
    if (Array.isArray(v)) {
      return v.map(x => (typeof x === 'number' ? exifRound(x, 4) : x)).join(', ');
    }
    if (typeof v === 'number') return exifRound(v, 4);
    return String(v);
  }

  /* ---- JPEG 元数据（APP1）搬运 ---- */
  function jpegExifSegment(bytes) {
    if (!bytes || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
    let i = 2;
    while (i + 4 <= bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) break;
      if (marker === 0xE1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 &&
          bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
        return bytes.subarray(i, Math.min(bytes.length, i + 2 + len));
      }
      i += 2 + len;
    }
    return null;
  }

  /* 复制 EXIF 段时把方向标记改回 1：像素已在 canvas 里摆正，再转一次会歪 */
  function resetExifOrientation(segment) {
    if (!segment || segment.length < 18) return segment;
    const base = 10;
    const le = segment[base] === 0x49;
    const dv = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
    const ifd = dv.getUint32(base + 4, le);
    const ifdStart = base + ifd;
    if (ifdStart + 2 > segment.length) return segment;
    const count = dv.getUint16(ifdStart, le);
    for (let i = 0; i < count; i++) {
      const e = ifdStart + 2 + i * 12;
      if (e + 12 > segment.length) break;
      if (dv.getUint16(e, le) === 0x0112) {
        dv.setUint16(e + 8, 1, le);
        break;
      }
    }
    return segment;
  }

  function jpegWithExif(jpegBytes, segment) {
    if (!segment || !segment.length) return jpegBytes;
    const out = new Uint8Array(jpegBytes.length + segment.length);
    out.set(jpegBytes.subarray(0, 2), 0);
    out.set(segment, 2);
    out.set(jpegBytes.subarray(2), 2 + segment.length);
    return out;
  }

  /* ---- 锐化：反锐化掩模（先 3×3 均值模糊，再按差值补偿） ---- */
  function sharpenCanvas(canvas, amount) {
    const strength = Math.min(1, Math.max(0, (parseFloat(amount) || 0) / 100)) * 1.8;
    const w = canvas.width, h = canvas.height;
    if (strength <= 0 || w < 3 || h < 3) return canvas;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const src = img.data;
    const out = new Uint8ClampedArray(src.length);
    out.set(src);
    const rowSum = () => new Float32Array(w * 3);
    const rows = [rowSum(), rowSum(), rowSum()];
    const fill = (y, buf) => {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const xl = x > 0 ? x - 1 : 0;
        const xr = x < w - 1 ? x + 1 : w - 1;
        const b = x * 3;
        for (let c = 0; c < 3; c++) {
          buf[b + c] = src[(row + xl) * 4 + c] + src[(row + x) * 4 + c] + src[(row + xr) * 4 + c];
        }
      }
    };
    fill(0, rows[0]);
    fill(0, rows[1]);
    for (let y = 0; y < h; y++) {
      fill(y < h - 1 ? y + 1 : h - 1, rows[2]);
      const [up, mid, down] = rows;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const b = x * 3;
        for (let c = 0; c < 3; c++) {
          const p = src[i + c];
          const blur = (up[b + c] + mid[b + c] + down[b + c]) / 9;
          out[i + c] = p + (p - blur) * strength;
        }
      }
      rows.push(rows.shift());
    }
    ctx.putImageData(new ImageData(out, w, h), 0, 0);
    return canvas;
  }

  /* ---- 文本按宽度折行（逐字符，兼容中文与连续西文） ---- */
  function wrapTextLines(ctx, text, maxWidth) {
    const lines = [];
    for (const para of String(text == null ? '' : text).split(/\r?\n/)) {
      if (!para) { lines.push(''); continue; }
      let line = '';
      for (const ch of para) {
        const test = line + ch;
        if (line && ctx.measureText(test).width > maxWidth) {
          lines.push(line);
          line = ch;
        } else {
          line = test;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /* ---- 等比绘制到新画布（高质量插值） ---- */
  function resizedCanvas(canvas, w, h) {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w));
    out.height = Math.max(1, Math.round(h));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out;
  }

  function hexToRgbTriplet(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex == null ? '' : hex).trim());
    if (!m) return [255, 255, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* ---- 自动去边：从四边逐行/逐列判断是否与角落同色 ---- */
  function trimCanvasBounds(canvas, tolerance, sides) {
    const w = canvas.width, h = canvas.height;
    const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const ref = [0, 0, 0];
    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
    for (const [cx, cy] of corners) {
      const i = (cy * w + cx) * 4;
      ref[0] += data[i] / 4;
      ref[1] += data[i + 1] / 4;
      ref[2] += data[i + 2] / 4;
    }
    const limit = Math.max(0, Math.min(100, parseFloat(tolerance) || 0)) * 4.42;
    const limitSq = limit * limit;
    const match = (i) => {
      const dr = data[i] - ref[0], dg = data[i + 1] - ref[1], db = data[i + 2] - ref[2];
      return dr * dr + dg * dg + db * db <= limitSq;
    };
    const rowMatches = (y) => {
      let hit = 0;
      for (let x = 0; x < w; x++) if (match((y * w + x) * 4)) hit++;
      return hit >= w * 0.98;
    };
    const colMatches = (x) => {
      let hit = 0;
      for (let y = 0; y < h; y++) if (match((y * w + x) * 4)) hit++;
      return hit >= h * 0.98;
    };
    let top = 0, bottom = h - 1, left = 0, right = w - 1;
    if (sides !== 'horizontal') {
      while (top <= bottom && rowMatches(top)) top++;
      while (bottom >= top && rowMatches(bottom)) bottom--;
    }
    if (sides !== 'vertical') {
      while (left <= right && colMatches(left)) left++;
      while (right >= left && colMatches(right)) right--;
    }
    if (right < left || bottom < top) throw new Error('整幅图与边角同色，无法判断可裁剪的范围，请降低容差');
    return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  }

  /* ---- alpha 通道羽化（可分离滑动窗口均值） ---- */
  function featherAlphaChannel(px, w, h, radius) {
    const r = Math.max(0, Math.round(radius));
    if (!r) return;
    const n = w * h;
    const win = r * 2 + 1;
    const src = new Float32Array(n);
    for (let i = 0; i < n; i++) src[i] = px[i * 4 + 3];
    const tmp = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / win;
        sum -= src[row + Math.min(w - 1, Math.max(0, x - r))];
        sum += src[row + Math.min(w - 1, Math.max(0, x + r + 1))];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        px[(y * w + x) * 4 + 3] = Math.round(sum / win);
        sum -= tmp[Math.min(h - 1, Math.max(0, y - r)) * w + x];
        sum += tmp[Math.min(h - 1, Math.max(0, y + r + 1)) * w + x];
      }
    }
  }

  /* ---- 纯色背景去除：默认从四边泛洪，避免误删画面内部的同色区域 ---- */
  function removeFlatBackground(canvas, opts) {
    const cfg = opts || {};
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const px = img.data;
    let target;
    if (cfg.mode === 'color') {
      target = hexToRgbTriplet(cfg.color);
    } else {
      target = [0, 0, 0];
      const probes = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
      for (const [x, y] of probes) {
        const i = (y * w + x) * 4;
        target[0] += px[i] / 4;
        target[1] += px[i + 1] / 4;
        target[2] += px[i + 2] / 4;
      }
    }
    const limit = Math.max(0, Math.min(100, parseFloat(cfg.tolerance) || 0)) * 4.42;
    const limitSq = limit * limit;
    const match = (p) => {
      const i = p * 4;
      const dr = px[i] - target[0], dg = px[i + 1] - target[1], db = px[i + 2] - target[2];
      return dr * dr + dg * dg + db * db <= limitSq;
    };
    const removed = new Uint8Array(w * h);
    let count = 0;
    if (cfg.mode === 'color') {
      for (let p = 0; p < w * h; p++) if (match(p)) { removed[p] = 1; count++; }
    } else {
      const stack = new Int32Array(w * h);
      let sp = 0;
      const push = (p) => {
        if (removed[p] || !match(p)) return;
        removed[p] = 1;
        count++;
        stack[sp++] = p;
      };
      for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
      while (sp) {
        const p = stack[--sp];
        const x = p % w;
        if (x > 0) push(p - 1);
        if (x < w - 1) push(p + 1);
        if (p >= w) push(p - w);
        if (p + w < w * h) push(p + w);
      }
    }
    if (!count) throw new Error('没有像素匹配背景色，可调高容差或改用指定颜色模式');
    for (let p = 0; p < w * h; p++) if (removed[p]) px[p * 4 + 3] = 0;
    featherAlphaChannel(px, w, h, cfg.feather);
    ctx.putImageData(img, 0, 0);
    return { canvas, ratio: count / (w * h) };
  }

  /* ---- 压到指定体积：先在原尺寸上二分质量，仍超标再等比缩小重试 ---- */
  async function compressCanvasToTarget(canvas, targetBytes, format) {
    const mime = format === 'webp' ? 'image/webp' : 'image/jpeg';
    const encode = (cv, q) => canvasToBlob(cv, mime, Math.min(1, Math.max(0.05, q / 100)));
    let scale = 1;
    let fallback = null;
    for (let round = 0; round < 9; round++) {
      const src = scale >= 0.999 ? canvas : resizedCanvas(canvas, canvas.width * scale, canvas.height * scale);
      let lo = 5, hi = 95, fit = null, smallest = null;
      for (let i = 0; i < 7 && lo <= hi; i++) {
        const q = Math.round((lo + hi) / 2);
        const blob = await encode(src, q);
        if (!blob || !blob.size) break;
        if (!smallest || blob.size < smallest.blob.size) smallest = { blob, q };
        if (blob.size <= targetBytes) {
          fit = { blob, q };
          lo = q + 1;
        } else {
          hi = q - 1;
        }
      }
      if (fit) return { blob: fit.blob, quality: fit.q, scale };
      if (!smallest) break;
      fallback = { blob: smallest.blob, quality: smallest.q, scale };
      scale *= 0.85;
      if (scale < 0.08) break;
    }
    if (!fallback) throw new Error('无法生成目标大小的图片，请放宽目标体积');
    return { ...fallback, missed: true };
  }
  /* ============================================================
     3d. 办公图片常用能力
     - 编码：Base64、ICO 容器、JPEG/PNG DPI 元数据、CSV 单元格
     - 文档：图片批量插入 Word（OOXML）
     - 绘制：边框圆角、马赛克打码、证件照尺寸、图片对比
     ============================================================ */

  /* ---- Base64（分块转换，避免大图栈溢出） ---- */
  function bytesToBase64(bytes) {
    let raw = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      raw += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + step, bytes.length)));
    }
    return btoa(raw);
  }

  function base64ToBytes(text) {
    let s = String(text == null ? '' : text)
      .replace(/^\s*data:[^,]*;base64,/i, '')
      .replace(/\s+/g, '')
      .replace(/-/g, '+').replace(/_/g, '/');
    if (!s) throw new Error('Base64 内容为空');
    s = s.slice(0, Math.ceil(s.length / 4) * 4).replace(/=+$/, '');
    while (s.length % 4) s += '=';
    let bin;
    try { bin = atob(s); } catch (e) { throw new Error('Base64 内容无效，无法解码'); }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* 按文件头识别图片格式（Base64 解码 / 打包 Word 时使用） */
  function detectImageMime(bytes) {
    const b = bytes;
    if (!b || b.length < 4) return '';
    const fourCC = String.fromCharCode(b[0], b[1], b[2], b[3]);
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
    if (fourCC === 'GIF8') return 'image/gif';
    if (fourCC.slice(0, 2) === 'BM') return 'image/bmp';
    if (fourCC === 'RIFF' && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP') return 'image/webp';
    if (fourCC === 'II*\u0000' || fourCC === 'MM\u0000*') return 'image/tiff';
    if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 1 || b[2] === 2) && b[3] === 0x00) return 'image/x-icon';
    return '';
  }

  function imageMimeToExt(mime) {
    return {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp',
      'image/webp': 'webp', 'image/tiff': 'tiff', 'image/x-icon': 'ico',
    }[mime] || 'png';
  }

  /* ---- ICO 容器：目录 + 多个内嵌 PNG（Vista+ / 全平台通用） ---- */
  async function canvasToIcoBlob(canvas, sizes, fit) {
    const maxSide = Math.max(canvas.width, canvas.height);
    const minSide = Math.min(canvas.width, canvas.height);
    const square = document.createElement('canvas');
    square.width = square.height = fit === 'contain' ? maxSide : minSide;
    const c = square.getContext('2d');
    if (fit === 'contain') {
      const s = Math.min(square.width / canvas.width, square.height / canvas.height);
      const w = Math.round(canvas.width * s), h = Math.round(canvas.height * s);
      c.drawImage(canvas, (square.width - w) / 2, (square.height - h) / 2, w, h);
    } else {
      c.drawImage(canvas, (canvas.width - minSide) / 2, (canvas.height - minSide) / 2,
        minSide, minSide, 0, 0, minSide, minSide);
    }
    const frames = [];
    for (const size of sizes) {
      const cv = resizedCanvas(square, size, size);
      const blob = await canvasToBlob(cv, 'image/png');
      if (!blob) throw new Error('ICO 内部图像生成失败');
      frames.push({ size, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    const dirSize = 6 + frames.length * 16;
    const out = new Uint8Array(dirSize + frames.reduce((sum, f) => sum + f.bytes.length, 0));
    const dv = new DataView(out.buffer);
    dv.setUint16(0, 0, true);
    dv.setUint16(2, 1, true);
    dv.setUint16(4, frames.length, true);
    let offset = dirSize;
    frames.forEach((frame, i) => {
      const e = 6 + i * 16;
      out[e] = out[e + 1] = frame.size >= 256 ? 0 : frame.size;
      out[e + 2] = 0;
      out[e + 3] = 0;
      dv.setUint16(e + 4, 1, true);
      dv.setUint16(e + 6, 32, true);
      dv.setUint32(e + 8, frame.bytes.length, true);
      dv.setUint32(e + 12, offset, true);
      out.set(frame.bytes, offset);
      offset += frame.bytes.length;
    });
    return bytesToBlob(out, 'image/x-icon');
  }

  /* ---- 打印 DPI：直接改元数据，不重新压缩像素 ---- */
  function setJpegDpi(bytes, dpi) {
    if (!bytes || bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error('不是有效的 JPEG 文件');
    const d = Math.max(1, Math.round(dpi));
    let i = 2;
    while (i + 4 <= bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) break;
      const isJfif = marker === 0xE0 && bytes[i + 4] === 0x4A && bytes[i + 5] === 0x46 &&
        bytes[i + 6] === 0x49 && bytes[i + 7] === 0x46;
      if (isJfif && len >= 16) {
        const out = bytes.slice();
        const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
        out[i + 11] = 1;              // 单位：点/英寸
        dv.setUint16(i + 12, d, false);
        dv.setUint16(i + 14, d, false);
        return out;
      }
      i += 2 + len;
    }
    const app0 = new Uint8Array(18);
    app0.set([0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x01]);
    new DataView(app0.buffer).setUint16(12, d, false);
    new DataView(app0.buffer).setUint16(14, d, false);
    const out = new Uint8Array(bytes.length + app0.length);
    out.set(bytes.subarray(0, 2), 0);
    out.set(app0, 2);
    out.set(bytes.subarray(2), 2 + app0.length);
    return out;
  }

  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32Of(bytes, start, length) {
    let c = 0xFFFFFFFF;
    for (let i = start; i < start + length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function setPngDpi(bytes, dpi) {
    if (!bytes || bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) {
      throw new Error('不是有效的 PNG 文件');
    }
    const ppm = Math.max(1, Math.round(Math.max(1, dpi) / 0.0254));
    const payload = new Uint8Array(9);
    const pdv = new DataView(payload.buffer);
    pdv.setUint32(0, ppm, false);
    pdv.setUint32(4, ppm, false);
    payload[8] = 1; // 单位：米
    const chunk = new Uint8Array(21);
    chunk.set([0x00, 0x00, 0x00, 0x09, 0x70, 0x48, 0x59, 0x73], 0);
    chunk.set(payload, 8);
    new DataView(chunk.buffer).setUint32(17, crc32Of(chunk, 4, 13), false);
    let i = 8;
    while (i + 8 <= bytes.length) {
      const len = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
      const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
      if (type === 'pHYs' && len === 9) {
        const out = bytes.slice();
        out.set(payload, i + 8);
        new DataView(out.buffer, out.byteOffset, out.byteLength)
          .setUint32(i + 17, crc32Of(out, i + 4, 13), false);
        return out;
      }
      if (type === 'IDAT' || type === 'IEND') break;
      i += 12 + len;
    }
    const ihdrLen = ((bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11]) >>> 0;
    const at = 8 + 12 + ihdrLen;
    if (at + 8 > bytes.length) throw new Error('PNG 结构不完整');
    const out = new Uint8Array(bytes.length + chunk.length);
    out.set(bytes.subarray(0, at), 0);
    out.set(chunk, at);
    out.set(bytes.subarray(at), at + chunk.length);
    return out;
  }

  /* ---- CSV 单元格转义 ---- */
  function csvCell(value) {
    const s = String(value == null ? '' : value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* ---- 图片批量插入 Word（最小可用 OOXML，图片为 png/jpg 原始数据） ---- */
  function buildDocxWithImages(images, opts) {
    const cfg = opts || {};
    const zip = new JSZip();
    const EXT_CT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
    const defaults = Array.from(new Set(images.map(im => im.ext)))
      .map(ext => `<Default Extension="${ext}" ContentType="${EXT_CT[ext] || 'image/png'}"/>`).join('');
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + defaults + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      images.map((im, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.name}"/>`).join('') +
      '</Relationships>';
    zip.file('word/_rels/document.xml.rels', rels);
    const EMU_PER_CM = 360000;
    const widthCm = Math.max(1, Math.min(25, cfg.widthCm || 15));
    const cx = Math.round(widthCm * EMU_PER_CM);
    let body = '';
    images.forEach((im, idx) => {
      const cy = Math.max(1, Math.round(cx * im.h / Math.max(1, im.w)));
      const rid = 'rId' + (idx + 1);
      const name = '图片 ' + (idx + 1);
      const inline = `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${idx + 2}" name="${xmlEsc(name)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${idx + 2}" name="${xmlEsc(im.name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
      if (cfg.title) body += `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(cfg.title)}</w:t></w:r></w:p>`;
      body += `<w:p><w:r>${inline}</w:r></w:p>`;
      if (cfg.caption) body += `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(im.caption || '')}</w:t></w:r></w:p>`;
      if (cfg.pageBreak && idx < images.length - 1) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      zip.file('word/media/' + im.name, im.bytes);
    });
    zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>');
    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE',
    });
  }

  /* ---- 图片批量插入 Excel：一个工作表，图片按行锚定（最小 OOXML） ---- */
  function buildXlsxWithImages(images, opts) {
    const cfg = opts || {};
    const zip = new JSZip();
    const EXT_CT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
    const defaults = Array.from(new Set(images.map(im => im.ext)))
      .map(ext => `<Default Extension="${ext}" ContentType="${EXT_CT[ext] || 'image/png'}"/>`).join('');
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + defaults + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS + '><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + REL + '"><sheets><sheet name="图片" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS + '><Relationship Id="rId1" Type="' + REL + '/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    const EMU_PER_PX = 9525;
    const widthPx = Math.round(Math.max(1, Math.min(25, cfg.widthCm || 15)) / 2.54 * 96);
    const rows = images.map((im, i) => {
      const cy = Math.round(widthPx * im.h / Math.max(1, im.w) * EMU_PER_PX);
      const heightPt = Math.round(cy / 12700);
      return `<row r="${i + 1}" ht="${heightPt}" customHeight="1"><c r="A${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(im.caption || '')}</t></is></c></row>`;
    }).join('');
    zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + REL + '"><sheetData>' + rows + '</sheetData><drawing r:id="rId1"/></worksheet>');
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS + '><Relationship Id="rId1" Type="' + REL + '/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
    const anchors = images.map((im, i) => {
      const cx = Math.round(widthPx * EMU_PER_PX);
      const cy = Math.round(widthPx * im.h / Math.max(1, im.w) * EMU_PER_PX);
      return `<xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${i}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="${xmlEsc(im.name)}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
    }).join('');
    zip.file('xl/drawings/drawing1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + REL + '">' + anchors + '</xdr:wsDr>');
    zip.file('xl/drawings/_rels/drawing1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS + '>' + images.map((im, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/image" Target="../media/${im.name}"/>`).join('') + '</Relationships>');
    images.forEach(im => zip.file('xl/media/' + im.name, im.bytes));
    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      compression: 'DEFLATE',
    });
  }

  /* ---- 边框 / 圆角 / 留白 ---- */
  function roundedRectPath(c, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y); c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr); c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h); c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr); c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  function framedCanvas(src, opts) {
    const cfg = opts || {};
    const pad = Math.max(0, Math.round(cfg.pad || 0));
    const shape = cfg.shape || 'none';
    const circle = shape === 'circle';
    const side = Math.min(src.width, src.height);
    const iw = circle ? side : src.width;
    const ih = circle ? side : src.height;
    const out = document.createElement('canvas');
    out.width = iw + pad * 2;
    out.height = ih + pad * 2;
    const c = out.getContext('2d');
    if (!cfg.transparent) {
      c.fillStyle = cfg.bg || '#ffffff';
      c.fillRect(0, 0, out.width, out.height);
    }
    const x = pad, y = pad;
    c.save();
    if (circle) {
      c.beginPath();
      c.arc(out.width / 2, out.height / 2, Math.min(iw, ih) / 2, 0, Math.PI * 2);
      c.clip();
    } else if (shape === 'rounded' && cfg.radius > 0) {
      roundedRectPath(c, x, y, iw, ih, cfg.radius);
      c.clip();
    }
    c.drawImage(src, (src.width - iw) / 2, (src.height - ih) / 2, iw, ih, x, y, iw, ih);
    c.restore();
    if (cfg.border > 0) {
      c.strokeStyle = cfg.borderColor || '#000000';
      c.lineWidth = cfg.border;
      if (circle) {
        c.beginPath();
        c.arc(out.width / 2, out.height / 2, Math.min(iw, ih) / 2 - cfg.border / 2, 0, Math.PI * 2);
        c.stroke();
      } else if (shape === 'rounded' && cfg.radius > 0) {
        roundedRectPath(c, x, y, iw, ih, cfg.radius);
        c.stroke();
      } else {
        c.strokeRect(x, y, iw, ih);
      }
    }
    return out;
  }

  /* ---- 打码区域解析：x,y,宽,高；支持像素与百分比，分号 / 换行分隔 ---- */
  function parseRectList(text, w, h) {
    const rects = [];
    for (const raw of String(text == null ? '' : text).split(/[;；\r\n]+/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(/[,，\s]+/).filter(Boolean);
      if (parts.length !== 4) throw new Error('区域格式应为「x,y,宽,高」，当前：' + line);
      const toPx = (v, base) => {
        const n = parseFloat(v);
        if (!Number.isFinite(n)) throw new Error('区域坐标不是数字：' + line);
        return /%$/.test(String(v)) ? Math.round(n / 100 * base) : Math.round(n);
      };
      let x = toPx(parts[0], w), y = toPx(parts[1], h);
      let rw = toPx(parts[2], w), rh = toPx(parts[3], h);
      if (rw <= 0 || rh <= 0) throw new Error('区域宽高必须大于 0：' + line);
      x = Math.max(0, Math.min(w - 1, x));
      y = Math.max(0, Math.min(h - 1, y));
      rw = Math.min(rw, w - x);
      rh = Math.min(rh, h - y);
      if (rw > 0 && rh > 0) rects.push({ x, y, w: rw, h: rh });
    }
    if (!rects.length) throw new Error('请填写至少一个打码区域，格式为「x,y,宽,高」');
    return rects;
  }

  function applyMosaicRegions(canvas, rects, opts) {
    const cfg = opts || {};
    const mode = cfg.mode || 'mosaic';
    const c = canvas.getContext('2d');
    for (const r of rects) {
      if (mode === 'solid') {
        c.fillStyle = cfg.color || '#000000';
        c.fillRect(r.x, r.y, r.w, r.h);
      } else if (mode === 'blur') {
        const copy = document.createElement('canvas');
        copy.width = r.w;
        copy.height = r.h;
        copy.getContext('2d').drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        c.save();
        c.beginPath();
        c.rect(r.x, r.y, r.w, r.h);
        c.clip();
        c.drawImage(copy, r.x, r.y);
        c.filter = `blur(${Math.max(1, cfg.blur || 8)}px)`;
        c.drawImage(copy, r.x, r.y);
        c.filter = 'none';
        c.restore();
      } else {
        const block = Math.max(2, Math.round(cfg.block || 12));
        const img = c.getImageData(r.x, r.y, r.w, r.h);
        const d = img.data;
        for (let by = 0; by < r.h; by += block) {
          for (let bx = 0; bx < r.w; bx += block) {
            const xe = Math.min(bx + block, r.w), ye = Math.min(by + block, r.h);
            let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
            for (let y = by; y < ye; y++) {
              for (let x = bx; x < xe; x++) {
                const i = (y * r.w + x) * 4;
                sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; sa += d[i + 3]; n++;
              }
            }
            const cr = sr / n, cg = sg / n, cb = sb / n, ca = sa / n;
            for (let y = by; y < ye; y++) {
              for (let x = bx; x < xe; x++) {
                const i = (y * r.w + x) * 4;
                d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = ca;
              }
            }
          }
        }
        c.putImageData(img, r.x, r.y);
      }
    }
    return canvas;
  }

  /* ---- 证件照 / 相纸规格（单位 mm） ---- */
  const ID_PHOTO_SIZES = {
    '1': { label: '1 寸', w: 25, h: 35 },
    'small1': { label: '小 1 寸', w: 22, h: 32 },
    'big1': { label: '大 1 寸', w: 33, h: 48 },
    '2': { label: '2 寸', w: 35, h: 49 },
    'small2': { label: '小 2 寸', w: 35, h: 45 },
    'visa': { label: '签证方照', w: 51, h: 51 },
  };
  const ID_PHOTO_PAPERS = {
    '6': { label: '6 寸相纸', w: 152, h: 102 },
    'a5': { label: 'A5', w: 148, h: 210 },
    'a4': { label: 'A4', w: 210, h: 297 },
  };

  /* ---- 两图对比：并排 / 叠加 / 差异高亮 ---- */
  function compareCanvasPair(a, b, mode, tolerance, labels) {
    const w = a.width, h = a.height;
    const bFit = (b.width === w && b.height === h) ? b : resizedCanvas(b, w, h);
    const out = document.createElement('canvas');
    const c = out.getContext('2d');
    const gap = 16;
    if (mode === 'side') {
      out.width = w * 2 + gap;
      out.height = h + (labels ? 34 : 0);
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, out.width, out.height);
      c.drawImage(a, 0, 0);
      c.drawImage(bFit, w + gap, 0);
      if (labels) {
        c.fillStyle = '#222222';
        c.font = 'bold 22px sans-serif';
        c.textAlign = 'center';
        c.fillText('A', w / 2, h + 24);
        c.fillText('B', w + gap + w / 2, h + 24);
      }
      return { canvas: out, changed: 0, total: 0 };
    }
    out.width = w;
    out.height = h;
    if (mode === 'overlay') {
      c.drawImage(a, 0, 0);
      c.globalAlpha = 0.5;
      c.drawImage(bFit, 0, 0);
      c.globalAlpha = 1;
      return { canvas: out, changed: 0, total: 0 };
    }
    const da = a.getContext('2d').getImageData(0, 0, w, h).data;
    const db = bFit.getContext('2d').getImageData(0, 0, w, h).data;
    const img = c.createImageData(w, h);
    const d = img.data;
    const limit = Math.max(0, tolerance || 0) * 3;
    let changed = 0;
    for (let i = 0; i < d.length; i += 4) {
      const delta = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      if (delta > limit) {
        d[i] = 255; d[i + 1] = 64; d[i + 2] = 64;
        changed++;
      } else {
        const gray = Math.round((da[i] + da[i + 1] + da[i + 2]) / 9);
        d[i] = d[i + 1] = d[i + 2] = gray;
      }
      d[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return { canvas: out, changed, total: w * h };
  }
  /* ============================================================
     4. 加密基础与文档格式（纯 JS）
     MD5 / SHA-2 / RC4 / AES、PDF 标准安全处理器（R2-R6）、
     Office 格式（docx / xlsx / pptx）解析与生成
     ============================================================ */
  function utf8ToBytes(str) { return new TextEncoder().encode(str); }
  function latin1ToBytes(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }
  function bytesToHex(b) {
    let s = '';
    for (let i = 0; i < b.length; i++) s += (b[i] + 0x100).toString(16).slice(1);
    return s;
  }
  function hexToBytes(hex) {
    const clean = String(hex).replace(/[^0-9A-Fa-f]/g, '');
    const out = new Uint8Array(clean.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  function concatBytes(list) {
    let n = 0;
    for (const a of list) n += a.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const a of list) { out.set(a, o); o += a.length; }
    return out;
  }
  function xorKeyBytes(key, x) {
    const out = new Uint8Array(key.length);
    for (let i = 0; i < key.length; i++) out[i] = key[i] ^ x;
    return out;
  }
  function secureRandom(n) {
    const out = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(out);
    else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
  }
  function u32le(n) {
    return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  }
  function bytesEqual(a, b, n) {
    const len = n == null ? a.length : n;
    if (a.length < len || b.length < len) return false;
    for (let i = 0; i < len; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /* ---- MD5 ---- */
  const MD5_S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const MD5_K = [0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391];
  function md5Bytes(input) {
    const msg = input;
    const n = msg.length;
    const total = (((n + 8) >> 6) + 1) * 64;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[n] = 0x80;
    const bitLen = n * 8;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, bitLen >>> 0, true);
    dv.setUint32(total - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const w = new Uint32Array(16);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, true);
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * i) % 16; }
        const tmp = d;
        d = c; c = b;
        const sum = (a + f + MD5_K[i] + w[g]) | 0;
        b = (b + ((sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i])))) | 0;
        a = tmp;
      }
      a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
    }
    const out = new Uint8Array(16);
    const odv = new DataView(out.buffer);
    odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
    odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
    return out;
  }

  /* ---- SHA-256 ---- */
  const SHA256_H0 = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const SHA256_K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
  function sha256Bytes(input) {
    const msg = input;
    const n = msg.length;
    const total = (((n + 8) >> 6) + 1) * 64;
    const buf = new Uint8Array(total);
    buf.set(msg); buf[n] = 0x80;
    const bitLen = n * 8;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);
    dv.setUint32(total - 4, bitLen >>> 0, false);
    const h = Uint32Array.from(SHA256_H0);
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = (rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i++) {
        const S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
        const S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i], false);
    return out;
  }

  /* ---- SHA-512 / SHA-384（BigInt） ---- */
  const M64 = 0xffffffffffffffffn;
  function rotr64(x, n) { return ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64; }
  const SHA512_H0 = [0x6a09e667f3bcc908n,0xbb67ae8584caa73bn,0x3c6ef372fe94f82bn,0xa54ff53a5f1d36f1n,0x510e527fade682d1n,0x9b05688c2b3e6c1fn,0x1f83d9abfb41bd6bn,0x5be0cd19137e2179n];
  const SHA384_H0 = [0xcbbb9d5dc1059ed8n,0x629a292a367cd507n,0x9159015a3070dd17n,0x152fecd8f70e5939n,0x67332667ffc00b31n,0x8eb44a8768581511n,0xdb0c2e0d64f98fa7n,0x47b5481dbefa4fa4n];
  const SHA512_K = [0x428a2f98d728ae22n,0x7137449123ef65cdn,0xb5c0fbcfec4d3b2fn,0xe9b5dba58189dbbcn,0x3956c25bf348b538n,0x59f111f1b605d019n,0x923f82a4af194f9bn,0xab1c5ed5da6d8118n,0xd807aa98a3030242n,0x12835b0145706fben,0x243185be4ee4b28cn,0x550c7dc3d5ffb4e2n,0x72be5d74f27b896fn,0x80deb1fe3b1696b1n,0x9bdc06a725c71235n,0xc19bf174cf692694n,0xe49b69c19ef14ad2n,0xefbe4786384f25e3n,0x0fc19dc68b8cd5b5n,0x240ca1cc77ac9c65n,0x2de92c6f592b0275n,0x4a7484aa6ea6e483n,0x5cb0a9dcbd41fbd4n,0x76f988da831153b5n,0x983e5152ee66dfabn,0xa831c66d2db43210n,0xb00327c898fb213fn,0xbf597fc7beef0ee4n,0xc6e00bf33da88fc2n,0xd5a79147930aa725n,0x06ca6351e003826fn,0x142929670a0e6e70n,0x27b70a8546d22ffcn,0x2e1b21385c26c926n,0x4d2c6dfc5ac42aedn,0x53380d139d95b3dfn,0x650a73548baf63den,0x766a0abb3c77b2a8n,0x81c2c92e47edaee6n,0x92722c851482353bn,0xa2bfe8a14cf10364n,0xa81a664bbc423001n,0xc24b8b70d0f89791n,0xc76c51a30654be30n,0xd192e819d6ef5218n,0xd69906245565a910n,0xf40e35855771202an,0x106aa07032bbd1b8n,0x19a4c116b8d2d0c8n,0x1e376c085141ab53n,0x2748774cdf8eeb99n,0x34b0bcb5e19b48a8n,0x391c0cb3c5c95a63n,0x4ed8aa4ae3418acbn,0x5b9cca4f7763e373n,0x682e6ff3d6b2b8a3n,0x748f82ee5defb2fcn,0x78a5636f43172f60n,0x84c87814a1f0ab72n,0x8cc702081a6439ecn,0x90befffa23631e28n,0xa4506cebde82bde9n,0xbef9a3f7b2c67915n,0xc67178f2e372532bn,0xca273eceea26619cn,0xd186b8c721c0c207n,0xeada7dd6cde0eb1en,0xf57d4f7fee6ed178n,0x06f067aa72176fban,0x0a637dc5a2c898a6n,0x113f9804bef90daen,0x1b710b35131c471bn,0x28db77f523047d84n,0x32caab7b40c72493n,0x3c9ebe0a15c9bebcn,0x431d67c49c100d4cn,0x4cc5d4becb3e42b6n,0x597f299cfc657e2an,0x5fcb6fab3ad6faecn,0x6c44198c4a475817n];
  function sha512Bytes(input, variant) {
    const msg = input;
    const n = msg.length;
    const total = (((n + 17) >> 7) + 1) * 128;
    const buf = new Uint8Array(total);
    buf.set(msg); buf[n] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setBigUint64(total - 8, BigInt(n) * 8n, false);
    const h = (variant === 384 ? SHA384_H0 : SHA512_H0).slice();
    const w = new Array(80);
    for (let off = 0; off < total; off += 128) {
      for (let i = 0; i < 16; i++) w[i] = dv.getBigUint64(off + i * 8, false);
      for (let i = 16; i < 80; i++) {
        const s0 = (rotr64(w[i - 15], 1) ^ rotr64(w[i - 15], 8) ^ (w[i - 15] >> 7n)) & M64;
        const s1 = (rotr64(w[i - 2], 19) ^ rotr64(w[i - 2], 61) ^ (w[i - 2] >> 6n)) & M64;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & M64;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 80; i++) {
        const S1 = (rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41)) & M64;
        const ch = ((e & f) ^ ((~e) & g)) & M64;
        const t1 = (hh + S1 + ch + SHA512_K[i] + w[i]) & M64;
        const S0 = (rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39)) & M64;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) & M64;
        const t2 = (S0 + maj) & M64;
        hh = g; g = f; f = e; e = (d + t1) & M64; d = c; c = b; b = a; a = (t1 + t2) & M64;
      }
      h[0] = (h[0] + a) & M64; h[1] = (h[1] + b) & M64; h[2] = (h[2] + c) & M64; h[3] = (h[3] + d) & M64;
      h[4] = (h[4] + e) & M64; h[5] = (h[5] + f) & M64; h[6] = (h[6] + g) & M64; h[7] = (h[7] + hh) & M64;
    }
    const outLen = variant === 384 ? 48 : 64;
    const out = new Uint8Array(outLen);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < outLen / 8; i++) odv.setBigUint64(i * 8, h[i], false);
    return out;
  }

  /* ---- RC4 ---- */
  function rc4Bytes(key, data) {
    const S = new Uint8Array(256);
    for (let i = 0; i < 256; i++) S[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 0xff;
      const t = S[i]; S[i] = S[j]; S[j] = t;
    }
    const out = new Uint8Array(data.length);
    let i = 0; j = 0;
    for (let k = 0; k < data.length; k++) {
      i = (i + 1) & 0xff; j = (j + S[i]) & 0xff;
      const t = S[i]; S[i] = S[j]; S[j] = t;
      out[k] = data[k] ^ S[(S[i] + S[j]) & 0xff];
    }
    return out;
  }

  /* ---- AES ---- */
  const AES_SBOX = new Uint8Array([99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22]);
  const AES_INV_SBOX = new Uint8Array(256);
  for (let i = 0; i < 256; i++) AES_INV_SBOX[AES_SBOX[i]] = i;
  function xtime(a) { return ((a << 1) ^ (a & 0x80 ? 0x11b : 0)) & 0xff; }
  function gfMul(a, b) {
    let r = 0;
    while (b) {
      if (b & 1) r ^= a;
      a = xtime(a);
      b >>>= 1;
    }
    return r & 0xff;
  }
  function aesExpandKey(key) {
    const nk = key.length / 4;
    const nr = nk + 6;
    const w = new Uint8Array(16 * (nr + 1));
    w.set(key);
    let bytes = key.length;
    let rcon = 1;
    while (bytes < w.length) {
      let t = [w[bytes - 4], w[bytes - 3], w[bytes - 2], w[bytes - 1]];
      if (bytes % (4 * nk) === 0) {
        t = [AES_SBOX[t[1]] ^ rcon, AES_SBOX[t[2]], AES_SBOX[t[3]], AES_SBOX[t[0]]];
        rcon = xtime(rcon);
      } else if (nk > 6 && bytes % (4 * nk) === 16) {
        t = [AES_SBOX[t[0]], AES_SBOX[t[1]], AES_SBOX[t[2]], AES_SBOX[t[3]]];
      }
      for (let i = 0; i < 4; i++) w[bytes + i] = w[bytes - 4 * nk + i] ^ t[i];
      bytes += 4;
    }
    return { w, nr };
  }
  function aesAddRoundKey(s, w, round) {
    for (let i = 0; i < 16; i++) s[i] ^= w[round * 16 + i];
  }
  function aesEncryptBlock(rk, block) {
    const s = new Uint8Array(block);
    aesAddRoundKey(s, rk.w, 0);
    for (let round = 1; round <= rk.nr; round++) {
      for (let i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]];
      for (let r = 1; r < 4; r++) {
        const tmp = [s[r], s[r + 4], s[r + 8], s[r + 12]];
        for (let c = 0; c < 4; c++) s[r + 4 * c] = tmp[(c + r) % 4];
      }
      if (round < rk.nr) {
        for (let c = 0; c < 4; c++) {
          const i = 4 * c;
          const v0 = s[i], v1 = s[i + 1], v2 = s[i + 2], v3 = s[i + 3];
          s[i] = xtime(v0) ^ (xtime(v1) ^ v1) ^ v2 ^ v3;
          s[i + 1] = v0 ^ xtime(v1) ^ (xtime(v2) ^ v2) ^ v3;
          s[i + 2] = v0 ^ v1 ^ xtime(v2) ^ (xtime(v3) ^ v3);
          s[i + 3] = (xtime(v0) ^ v0) ^ v1 ^ v2 ^ xtime(v3);
        }
      }
      aesAddRoundKey(s, rk.w, round);
    }
    return s;
  }
  function aesDecryptBlock(rk, block) {
    const s = new Uint8Array(block);
    aesAddRoundKey(s, rk.w, rk.nr);
    for (let round = rk.nr - 1; round >= 0; round--) {
      for (let r = 1; r < 4; r++) {
        const tmp = [s[r], s[r + 4], s[r + 8], s[r + 12]];
        for (let c = 0; c < 4; c++) s[r + 4 * c] = tmp[(c + 4 - r) % 4];
      }
      for (let i = 0; i < 16; i++) s[i] = AES_INV_SBOX[s[i]];
      aesAddRoundKey(s, rk.w, round);
      if (round > 0) {
        for (let c = 0; c < 4; c++) {
          const i = 4 * c;
          const v0 = s[i], v1 = s[i + 1], v2 = s[i + 2], v3 = s[i + 3];
          s[i] = gfMul(v0, 14) ^ gfMul(v1, 11) ^ gfMul(v2, 13) ^ gfMul(v3, 9);
          s[i + 1] = gfMul(v0, 9) ^ gfMul(v1, 14) ^ gfMul(v2, 11) ^ gfMul(v3, 13);
          s[i + 2] = gfMul(v0, 13) ^ gfMul(v1, 9) ^ gfMul(v2, 14) ^ gfMul(v3, 11);
          s[i + 3] = gfMul(v0, 11) ^ gfMul(v1, 13) ^ gfMul(v2, 9) ^ gfMul(v3, 14);
        }
      }
    }
    return s;
  }
  function aesCbcEncrypt(key, iv, data) {
    const rk = aesExpandKey(key);
    const out = new Uint8Array(data.length);
    let prev = iv;
    for (let i = 0; i < data.length; i += 16) {
      const blk = new Uint8Array(16);
      for (let j = 0; j < 16; j++) blk[j] = data[i + j] ^ prev[j];
      const enc = aesEncryptBlock(rk, blk);
      out.set(enc, i);
      prev = enc;
    }
    return out;
  }
  function aesCbcDecrypt(key, iv, data) {
    const rk = aesExpandKey(key);
    const out = new Uint8Array(data.length);
    let prev = iv;
    for (let i = 0; i < data.length; i += 16) {
      const dec = aesDecryptBlock(rk, data.subarray(i, i + 16));
      for (let j = 0; j < 16; j++) out[i + j] = dec[j] ^ prev[j];
      prev = data.subarray(i, i + 16);
    }
    return out;
  }
  function aesPkcs7Pad(data) {
    const pad = 16 - (data.length % 16);
    const out = new Uint8Array(data.length + pad);
    out.set(data);
    out.fill(pad, data.length);
    return out;
  }
  function aesPkcs7Unpad(data) {
    if (!data.length) return data;
    const pad = data[data.length - 1];
    if (pad < 1 || pad > 16) return data;
    return data.subarray(0, data.length - pad);
  }

  /* ---- PDF 标准安全处理器（V1/V2 R2-R3 RC4、V4 R4 AES-128、V5 R5/R6 AES-256） ---- */
  const PDF_PAD = hexToBytes('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A');
  function pdfPadPassword(pwd) {
    const out = new Uint8Array(32);
    const n = Math.min(32, pwd.length);
    out.set(pwd.subarray(0, n));
    out.set(PDF_PAD.subarray(0, 32 - n), n);
    return out;
  }
  function pdfR234FileKey(pwd, O, P, ID1, R, keyLen, metaEnc) {
    const parts = [pdfPadPassword(pwd), O, u32le(P >>> 0), ID1];
    if (R >= 4 && !metaEnc) parts.push(new Uint8Array([255, 255, 255, 255]));
    let h = md5Bytes(concatBytes(parts));
    if (R >= 3) for (let i = 0; i < 50; i++) h = md5Bytes(h.subarray(0, keyLen));
    return h.slice(0, keyLen);
  }
  function pdfOKey(ownerPwd, R, keyLen) {
    let h = md5Bytes(pdfPadPassword(ownerPwd));
    if (R >= 3) for (let i = 0; i < 50; i++) h = md5Bytes(h);
    return h.slice(0, keyLen);
  }
  function pdfOValue(oKey, userPwd, R) {
    let o = rc4Bytes(oKey, pdfPadPassword(userPwd));
    if (R >= 3) for (let i = 1; i < 20; i++) o = rc4Bytes(xorKeyBytes(oKey, i), o);
    return o;
  }
  function pdfUValue(fileKey, R, ID1) {
    if (R <= 2) return rc4Bytes(fileKey, PDF_PAD);
    let u = rc4Bytes(fileKey, md5Bytes(concatBytes([PDF_PAD, ID1])));
    for (let i = 1; i < 20; i++) u = rc4Bytes(xorKeyBytes(fileKey, i), u);
    return concatBytes([u, PDF_PAD.subarray(0, 16)]);
  }
  function pdfVerifyR234(pwd, enc, ID1, keyLen, metaEnc) {
    const key = pdfR234FileKey(pwd, enc.O, enc.P, ID1, enc.R, keyLen, metaEnc);
    const u = pdfUValue(key, enc.R, ID1);
    return bytesEqual(u, enc.U, enc.R >= 3 ? 16 : 32) ? key : null;
  }
  function pdfVerifyOwnerR234(ownerPwd, enc, ID1, keyLen, metaEnc) {
    const oKey = pdfOKey(ownerPwd, enc.R, keyLen);
    let userPad;
    if (enc.R <= 2) userPad = rc4Bytes(oKey, enc.O);
    else {
      userPad = enc.O;
      for (let i = 19; i >= 0; i--) userPad = rc4Bytes(xorKeyBytes(oKey, i), userPad);
    }
    return pdfVerifyR234(userPad, enc, ID1, keyLen, metaEnc);
  }
  function pdfHash56(R, pwd, salt, udata) {
    let k = sha256Bytes(concatBytes([pwd, salt, udata]));
    if (R < 6) return k;
    let count = 0;
    for (;;) {
      count++;
      const k1 = concatBytes([pwd, k, udata]);
      const rep = new Uint8Array(k1.length * 64);
      for (let i = 0; i < 64; i++) rep.set(k1, i * k1.length);
      const e = aesCbcEncrypt(k.subarray(0, 16), k.subarray(16, 32), rep);
      let sum = 0;
      for (let i = 0; i < 16; i++) sum += e[i];
      const fn = [sha256Bytes, d => sha512Bytes(d, 384), d => sha512Bytes(d, 512)][sum % 3];
      k = fn(e);
      if (count >= 64 && e[e.length - 1] <= count - 32) break;
    }
    return k.subarray(0, 32);
  }
  function pdfVerifyR56(pwd, enc, side) {
    const p = pwd.subarray(0, 127);
    const zero = new Uint8Array(0);
    if (side === 'user') {
      const U = enc.U;
      if (!bytesEqual(pdfHash56(enc.R, p, U.subarray(32, 40), zero), U.subarray(0, 32))) return null;
      return aesCbcDecrypt(pdfHash56(enc.R, p, U.subarray(40, 48), zero), new Uint8Array(16), enc.UE);
    }
    const O = enc.O;
    const u48 = enc.U.subarray(0, 48);
    if (!bytesEqual(pdfHash56(enc.R, p, O.subarray(32, 40), u48), O.subarray(0, 32))) return null;
    return aesCbcDecrypt(pdfHash56(enc.R, p, O.subarray(40, 48), u48), new Uint8Array(16), enc.OE);
  }
  function pdfObjectKey(fileKey, V, keyLen, idnum, gen, aes) {
    if (V >= 5) return fileKey;
    const n = V === 1 ? 5 : keyLen;
    const data = concatBytes([
      fileKey.subarray(0, n),
      new Uint8Array([idnum & 0xff, (idnum >>> 8) & 0xff, (idnum >>> 16) & 0xff, gen & 0xff, (gen >>> 8) & 0xff]),
    ]);
    const h = md5Bytes(aes ? concatBytes([data, latin1ToBytes('sAlT')]) : data);
    return h.subarray(0, Math.min(n + 5, 16));
  }
  function pdfCryptRaw(data, info, idnum, gen, encrypt) {
    const cfm = info.cfm;
    if (cfm === 'Identity') return data;
    const aesRoundTrip = (key) => {
      if (encrypt) {
        const iv = secureRandom(16);
        return concatBytes([iv, aesCbcEncrypt(key, iv, aesPkcs7Pad(data))]);
      }
      if (data.length < 16 || (data.length % 16) !== 0) return data;
      return aesPkcs7Unpad(aesCbcDecrypt(key, data.subarray(0, 16), data.subarray(16)));
    };
    if (cfm === 'AESV3') return aesRoundTrip(info.fileKey);
    const useAes = cfm === 'AESV2';
    const key = pdfObjectKey(info.fileKey, info.V, info.keyLen, idnum, gen, useAes);
    return useAes ? aesRoundTrip(key) : rc4Bytes(key, data);
  }
  function pdfReadEncryptInfo(doc) {
    const ti = doc.context.trailerInfo;
    if (!ti.Encrypt) return null;
    const encObj = doc.context.lookup(ti.Encrypt) || ti.Encrypt;
    if (!(encObj instanceof PDFLib.PDFDict)) return null;
    const num = k => {
      try { const v = encObj.lookup(PDFLib.PDFName.of(k)); return v && typeof v.asNumber === 'function' ? v.asNumber() : null; }
      catch (e) { return null; }
    };
    const byt = k => {
      try { const v = encObj.lookup(PDFLib.PDFName.of(k)); return v && v.asBytes ? v.asBytes() : null; }
      catch (e) { return null; }
    };
    const V = num('V') || 0;
    const R = num('R') || 0;
    const keyLen = (num('Length') || (V === 1 ? 40 : V >= 5 ? 256 : 128)) / 8;
    const P = (num('P') || 0) | 0;
    const O = byt('O'), U = byt('U');
    if (!O || !U) throw new Error('无法解析加密字典');
    const OE = byt('OE') || new Uint8Array(0), UE = byt('UE') || new Uint8Array(0);
    let ID1 = new Uint8Array(0);
    try {
      const idArr = ti.ID;
      const first = idArr && idArr.lookup ? idArr.lookup(0) : null;
      if (first && first.asBytes) ID1 = first.asBytes();
    } catch (e) { /* ignore */ }
    const info = { V, R, P, O, U, OE, UE, ID1, keyLen, metaEnc: true, cfm: 'V2', encRef: ti.Encrypt };
    if (V >= 4) {
      try {
        const me = encObj.lookup(PDFLib.PDFName.of('EncryptMetadata'));
        if (me && String(me) === 'false') info.metaEnc = false;
      } catch (e) { /* ignore */ }
      let cfm = 'V2';
      try {
        const cf = encObj.lookupMaybe(PDFLib.PDFName.of('CF'), PDFLib.PDFDict);
        const std = cf && cf.lookupMaybe(PDFLib.PDFName.of('StdCF'), PDFLib.PDFDict);
        const mode = std ? String(std.lookup(PDFLib.PDFName.of('CFM'))) : '';
        if (mode === '/AESV2') cfm = 'AESV2';
        else if (mode === '/AESV3') cfm = 'AESV3';
        else if (mode === '/Identity') cfm = 'Identity';
      } catch (e) { /* ignore */ }
      if (V >= 5) cfm = 'AESV3';
      info.cfm = cfm;
    }
    return info;
  }
  function pdfDeriveFileKey(password, enc) {
    const pwd = enc.R >= 5 ? utf8ToBytes(password || '').subarray(0, 127) : latin1ToBytes(password || '');
    if (enc.R >= 5) {
      return pdfVerifyR56(pwd, enc, 'user') || pdfVerifyR56(pwd, enc, 'owner');
    }
    return pdfVerifyR234(pwd, enc, enc.ID1, enc.keyLen, enc.metaEnc)
      || pdfVerifyOwnerR234(pwd, enc, enc.ID1, enc.keyLen, enc.metaEnc);
  }
  function pdfCryptWalk(doc, enc, encrypt) {
    const info = enc;
    const skipObjs = new Set();
    if (!encrypt && info.encRef) {
      const encObj = doc.context.lookup(info.encRef);
      if (encObj) skipObjs.add(encObj);
    }
    const transform = (obj, idnum, gen, depth) => {
      if (!obj || depth > 25) return obj;
      if (obj instanceof PDFLib.PDFString || obj instanceof PDFLib.PDFHexString) {
        const raw = obj.asBytes();
        if (!raw || !raw.length) return obj;
        return PDFLib.PDFHexString.of(bytesToHex(pdfCryptRaw(raw, info, idnum, gen, encrypt)));
      }
      if (obj.contents instanceof Uint8Array && obj.dict instanceof PDFLib.PDFDict) {
        const type = safeLookup(obj.dict, 'Type', PDFLib.PDFName);
        const isMeta = type && String(type) === '/Metadata';
        if (!(isMeta && !info.metaEnc && !encrypt)) {
          if (obj.contents.length) obj.contents = pdfCryptRaw(obj.contents, info, idnum, gen, encrypt);
          try { obj.dict.set(PDFLib.PDFName.of('Length'), PDFLib.PDFNumber.of(obj.contents.length)); } catch (e) { /* ignore */ }
        }
        for (const key of obj.dict.keys()) {
          const v = obj.dict.get(key);
          obj.dict.set(key, transform(v, idnum, gen, depth + 1));
        }
        return obj;
      }
      if (obj instanceof PDFLib.PDFDict) {
        const isSig = String(safeLookup(obj, 'Type', PDFLib.PDFName) || '') === '/Sig';
        for (const key of obj.keys()) {
          if (isSig && String(key) === '/Contents') continue;
          obj.set(key, transform(obj.get(key), idnum, gen, depth + 1));
        }
        return obj;
      }
      if (obj instanceof PDFLib.PDFArray) {
        for (let i = 0; i < obj.size(); i++) obj.set(i, transform(obj.get(i), idnum, gen, depth + 1));
        return obj;
      }
      return obj;
    };
    for (const entry of doc.context.enumerateIndirectObjects()) {
      const ref = entry[0], obj = entry[1];
      if (skipObjs.has(obj)) continue;
      const idnum = typeof ref.objectNumber === 'number' ? ref.objectNumber : Number(String(ref).split(' ')[0]);
      const gen = typeof ref.generationNumber === 'number' ? ref.generationNumber : Number(String(ref).split(' ')[1]) || 0;
      transform(obj, idnum, gen, 0);
    }
  }
  function pdfEncryptDoc(doc, userPwd) {
    const ownerPwd = userPwd;
    const ti = doc.context.trailerInfo;
    const id1 = secureRandom(16), id2 = secureRandom(16);
    const idArr = PDFLib.PDFArray.withContext(doc.context);
    idArr.push(PDFLib.PDFHexString.of(bytesToHex(id1)));
    idArr.push(PDFLib.PDFHexString.of(bytesToHex(id2)));
    ti.ID = idArr;
    const R = 3, V = 2, keyLen = 16, P = -4;
    const O = pdfOValue(pdfOKey(ownerPwd, R, keyLen), userPwd, R);
    const fileKey = pdfR234FileKey(userPwd, O, P, id1, R, keyLen, true);
    const U = pdfUValue(fileKey, R, id1);
    const info = { V, R, P, O, U, ID1: id1, keyLen, metaEnc: true, cfm: 'V2', fileKey };
    pdfCryptWalk(doc, info, true);
    const enc = PDFLib.PDFDict.withContext(doc.context);
    enc.set(PDFLib.PDFName.of('Filter'), PDFLib.PDFName.of('Standard'));
    enc.set(PDFLib.PDFName.of('V'), PDFLib.PDFNumber.of(V));
    enc.set(PDFLib.PDFName.of('R'), PDFLib.PDFNumber.of(R));
    enc.set(PDFLib.PDFName.of('Length'), PDFLib.PDFNumber.of(128));
    enc.set(PDFLib.PDFName.of('P'), PDFLib.PDFNumber.of(P));
    enc.set(PDFLib.PDFName.of('O'), PDFLib.PDFHexString.of(bytesToHex(O)));
    enc.set(PDFLib.PDFName.of('U'), PDFLib.PDFHexString.of(bytesToHex(U)));
    ti.Encrypt = doc.context.register(enc);
  }

  /* ---- Office 格式：docx / xlsx 生成与解析、pptx 解析 ---- */
  function xmlEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function buildDocxBlob(pages) {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    let body = '';
    pages.forEach((lines, pi) => {
      for (const ln of lines) body += '<w:p><w:r><w:t xml:space="preserve">' + xmlEsc(ln) + '</w:t></w:r></w:p>';
      if (pi < pages.length - 1) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    });
    zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>');
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  }
  function buildXlsxBlob(sheets) {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => '<sheet name="' + xmlEsc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '</Relationships>');
    sheets.forEach((sheet, si) => {
      const colLetter = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
      const rowsXml = sheet.grid.map((row, ri) => {
        const cells = row.map((cell, ci) => cell ? '<c r="' + colLetter(ci) + (ri + 1) + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(cell) + '</t></is></c>' : '').join('');
        return cells ? '<row r="' + (ri + 1) + '">' + cells + '</row>' : '';
      }).join('');
      const cols = [];
      for (let ci = 0; ci < (sheet.colWidths ? sheet.colWidths.length : 0); ci++) cols.push('<col min="' + (ci + 1) + '" max="' + (ci + 1) + '" width="' + (sheet.colWidths[ci] / 7).toFixed(1) + '" customWidth="1"/>');
      zip.file('xl/worksheets/sheet' + (si + 1) + '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + (cols.length ? '<cols>' + cols.join('') + '</cols>' : '') + '<sheetData>' + rowsXml + '</sheetData></worksheet>');
    });
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  }
  async function parseDocxFile(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entry = zip.file('word/document.xml');
    if (!entry) throw new Error('无法识别的 docx 文件');
    const xml = await entry.async('string');
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    const paras = [];
    for (const p of dom.getElementsByTagName('w:p')) {
      let text = '';
      let bold = false, size = 0, align = '';
      for (const node of p.getElementsByTagName('*')) {
        const tag = node.tagName.split(':').pop();
        if (tag === 't') text += node.textContent;
        else if (tag === 'b') bold = true;
        else if (tag === 'sz') size = parseInt(node.getAttribute('w:val'), 10) || 0;
        else if (tag === 'jc') align = node.getAttribute('w:val') || '';
      }
      paras.push({ text, bold, size: size ? size / 2 : 0, align });
    }
    return paras;
  }
  async function parseXlsxFile(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const shared = [];
    const ssEntry = zip.file('xl/sharedStrings.xml');
    if (ssEntry) {
      const ssDom = new DOMParser().parseFromString(await ssEntry.async('string'), 'application/xml');
      for (const si of ssDom.getElementsByTagName('si')) {
        let t = '';
        for (const n of si.getElementsByTagName('t')) t += n.textContent;
        shared.push(t);
      }
    }
    const wbDom = new DOMParser().parseFromString(await (zip.file('xl/workbook.xml') || zip.file('xl/workbook.xml')).async('string'), 'application/xml');
    const relsDom = new DOMParser().parseFromString(await zip.file('xl/_rels/workbook.xml.rels').async('string'), 'application/xml');
    const relMap = {};
    for (const rel of relsDom.getElementsByTagName('Relationship')) relMap[rel.getAttribute('Id')] = rel.getAttribute('Target');
    const sheets = [];
    const sheetEls = wbDom.getElementsByTagName('sheet');
    for (let si = 0; si < sheetEls.length; si++) {
      const name = sheetEls[si].getAttribute('name') || ('Sheet' + (si + 1));
      const rid = sheetEls[si].getAttribute('r:id') || sheetEls[si].getAttribute('r:Id');
      const target = relMap[rid] || ('worksheets/sheet' + (si + 1) + '.xml');
      const entry = zip.file('xl/' + target.replace(/^\//, '')) || zip.file('xl/worksheets/sheet' + (si + 1) + '.xml');
      if (!entry) continue;
      const wsDom = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
      const grid = [];
      for (const row of wsDom.getElementsByTagName('row')) {
        const cells = [];
        for (const c of row.getElementsByTagName('c')) {
          const ref = c.getAttribute('r') || '';
          const colStr = ref.replace(/\d+/g, '');
          let ci = 0;
          for (const ch of colStr) ci = ci * 26 + (ch.charCodeAt(0) - 64);
          ci = Math.max(0, ci - 1);
          const type = c.getAttribute('t');
          let val = '';
          if (type === 'inlineStr') {
            for (const t of c.getElementsByTagName('t')) val += t.textContent;
          } else {
            const v = c.getElementsByTagName('v')[0];
            val = v ? v.textContent : '';
            if (type === 's') val = shared[parseInt(val, 10)] || '';
          }
          cells[ci] = val;
        }
        for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
        grid.push(cells);
      }
      sheets.push({ name, grid });
    }
    return sheets;
  }
  async function parsePptxFile(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    let sw = 720, sh = 405;
    const presEntry = zip.file('ppt/presentation.xml');
    if (presEntry) {
      const pDom = new DOMParser().parseFromString(await presEntry.async('string'), 'application/xml');
      const sldSz = pDom.getElementsByTagName('p:sldSz')[0] || pDom.getElementsByTagName('sldSz')[0];
      if (sldSz) {
        sw = (parseInt(sldSz.getAttribute('cx'), 10) || 9144000) / 12700;
        sh = (parseInt(sldSz.getAttribute('cy'), 10) || 5143500) / 12700;
      }
    }
    const slideNames = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => (parseInt(a.match(/\d+/)[0], 10) || 0) - (parseInt(b.match(/\d+/)[0], 10) || 0));
    const slides = [];
    for (const name of slideNames) {
      const dom = new DOMParser().parseFromString(await zip.file(name).async('string'), 'application/xml');
      const shapes = [];
      for (const sp of dom.getElementsByTagName('p:sp')) {
        const off = sp.getElementsByTagName('a:off')[0];
        const ext = sp.getElementsByTagName('a:ext')[0];
        let text = '';
        for (const t of sp.getElementsByTagName('a:t')) text += t.textContent;
        if (!text.trim()) continue;
        shapes.push({
          x: off ? parseInt(off.getAttribute('x'), 10) / 12700 : 0,
          y: off ? parseInt(off.getAttribute('y'), 10) / 12700 : 0,
          w: ext ? parseInt(ext.getAttribute('cx'), 10) / 12700 : 100,
          h: ext ? parseInt(ext.getAttribute('cy'), 10) / 12700 : 30,
          text,
        });
      }

      // 图片型幻灯片（例如由「PDF 转 PPT」生成）在 slide.xml 里是 p:pic，
      // 媒体文件通过同名 .rels 里的 r:embed 指向 ppt/media/*，必须一并解析，
      // 否则这类幻灯片转换后会变成空白页。
      const relsName = 'ppt/slides/_rels/' + name.split('/').pop() + '.rels';
      const relsEntry = zip.file(relsName);
      const relMap = {};
      if (relsEntry) {
        const relsDom = new DOMParser().parseFromString(await relsEntry.async('string'), 'application/xml');
        for (const rel of relsDom.getElementsByTagName('Relationship')) {
          relMap[rel.getAttribute('Id')] = rel.getAttribute('Target');
        }
      }
      const resolveMedia = target => {
        let p = String(target || '').replace(/\\/g, '/');
        if (p.charAt(0) === '/') return p.slice(1);
        if (p.indexOf('../') === 0) return 'ppt/' + p.slice(3);
        if (p.indexOf('./') === 0) p = p.slice(2);
        return 'ppt/slides/' + p;
      };
      const images = [];
      for (const pic of dom.getElementsByTagName('p:pic')) {
        const blip = pic.getElementsByTagName('a:blip')[0] || pic.getElementsByTagName('blip')[0];
        const rid = blip && (blip.getAttribute('r:embed') || blip.getAttribute('embed'));
        const target = rid && relMap[rid];
        const entry = target && zip.file(resolveMedia(target));
        if (!entry) continue;
        try {
          const bytes = await entry.async('uint8array');
          const off = pic.getElementsByTagName('a:off')[0];
          const ext = pic.getElementsByTagName('a:ext')[0];
          images.push({
            bytes: new Uint8Array(bytes),
            x: off ? (parseInt(off.getAttribute('x'), 10) || 0) / 12700 : 0,
            y: off ? (parseInt(off.getAttribute('y'), 10) || 0) / 12700 : 0,
            w: ext ? (parseInt(ext.getAttribute('cx'), 10) || 0) / 12700 : sw,
            h: ext ? (parseInt(ext.getAttribute('cy'), 10) || 0) / 12700 : sh,
          });
        } catch (e) { /* 跳过损坏的媒体文件 */ }
      }
      slides.push({ shapes, images });
    }
    return { sw, sh, slides };
  }
  function makeOfficeCanvas(w, h) {
    const scale = 2;
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * scale);
    cv.height = Math.round(h * scale);
    const c = cv.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, cv.width, cv.height);
    return { cv, c, scale };
  }
  async function pdfPageLines(file) {
    const doc = await loadPdfjsDoc(file);
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      const lines = [];
      let lastY = null, buf = [];
      for (const item of tc.items) {
        const y = item.transform ? item.transform[5] : 0;
        if (lastY !== null && Math.abs(y - lastY) > 2.5) {
          lines.push(buf.join('').replace(/\s+/g, ' ').trim());
          buf = [];
        }
        buf.push(item.str);
        lastY = y;
      }
      if (buf.length) lines.push(buf.join('').replace(/\s+/g, ' ').trim());
      out.push(lines.filter(l => l !== ''));
    }
    return out;
  }
  async function pdfTextItems(file) {
    const doc = await loadPdfjsDoc(file);
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const t = it.transform || [1, 0, 0, 1, 0, 0];
        out.push({ page: p, pageW: vp.width, pageH: vp.height, x: t[4], y: t[5], size: Math.hypot(t[2], t[3]) || 10, str: it.str });
      }
    }
    return out;
  }
  async function renderParasToPdf(paras, outName) {
    const PW = 595, PH = 842, MARGIN = 56, SCALE = 2;
    const pages = [];
    let cur = makeOfficeCanvas(PW, PH);
    let y = MARGIN;
    for (const p of paras) {
      const fs = p.size || 12;
      const lh = fs * 1.55;
      const fontCss = (p.bold ? 'bold ' : '') + Math.round(fs * SCALE) + 'px "Microsoft YaHei", sans-serif';
      const align = p.align === 'center' ? 'center' : p.align === 'right' ? 'right' : 'left';
      const x = align === 'center' ? PW / 2 : align === 'right' ? PW - MARGIN : MARGIN;
      const maxWPx = (PW - MARGIN * 2) * SCALE;
      const setup = () => {
        cur.c.font = fontCss;
        cur.c.fillStyle = '#000000';
        cur.c.textAlign = align;
      };
      setup();
      const drawLine = (line) => {
        if (y > PH - MARGIN) {
          pages.push(cur);
          cur = makeOfficeCanvas(PW, PH);
          y = MARGIN;
          setup();
        }
        cur.c.fillText(line, x * SCALE, y * SCALE);
        y += lh;
      };
      const chars = Array.from(p.text || '');
      if (!chars.length) { y += lh; continue; }
      let line = '';
      for (const ch of chars) {
        if (line && cur.c.measureText(line + ch).width > maxWPx) { drawLine(line); line = ch; }
        else line += ch;
      }
      if (line) drawLine(line);
      y += lh * 0.35;
    }
    pages.push(cur);
    const doc = await PDFLib.PDFDocument.create();
    for (const pg of pages) {
      const png = await canvasToBlob(pg.cv, 'image/png');
      const page = doc.addPage([PW, PH]);
      page.drawImage(await doc.embedPng(await png.arrayBuffer()), { x: 0, y: 0, width: PW, height: PH });
    }
    return [{ name: outName, blob: bytesToBlob(await doc.save(), 'application/pdf') }];
  }
  function clusterIdx(values, tol) {
    const sorted = values.slice().sort((a, b) => a - b);
    const groups = [];
    for (const v of sorted) {
      if (groups.length && v - groups[groups.length - 1].ref <= tol) {
        const g = groups[groups.length - 1];
        g.sum += v; g.n++;
        g.ref = g.sum / g.n;
      } else groups.push({ ref: v, sum: v, n: 1 });
    }
    return groups.map(g => g.ref);
  }

  /* ---- 有序页码列表解析："3,1-2,1" -> [3,1,2,1]（保持顺序、允许重复） ---- */
  function parseOrderList(str, maxPages) {
    const out = [];
    for (let part of String(str || '').split(/[,，]/)) {
      part = part.trim();
      if (!part) continue;
      if (part.includes('-')) {
        const [a, b] = part.split('-');
        const from = parseInt(a, 10), to = parseInt(b, 10);
        if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error(`页面序号无效：${part}`);
        const step = from <= to ? 1 : -1;
        for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
          if (i < 1 || i > maxPages) throw new Error(`页码 ${i} 超出范围（共 ${maxPages} 页）`);
          out.push(i);
        }
      } else {
        const n = parseInt(part, 10);
        if (!Number.isFinite(n) || n < 1 || n > maxPages) throw new Error(`页码 ${part} 超出范围（共 ${maxPages} 页）`);
        out.push(n);
      }
    }
    if (!out.length) throw new Error('页面顺序为空');
    return out;
  }

  /* ---- 提取 PDF 文本行（含字号，用于 Markdown 标题推断） ---- */
  async function pdfStyledLines(file) {
    const doc = await loadPdfjsDoc(file);
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      const rows = [];
      let lastY = null, buf = [], sizes = [];
      const flush = () => {
        const text = buf.join('').replace(/\s+/g, ' ').trim();
        if (text) rows.push({ text, size: sizes.length ? Math.max.apply(null, sizes) : 12 });
        buf = []; sizes = [];
      };
      for (const item of tc.items) {
        const y = item.transform ? item.transform[5] : 0;
        if (lastY !== null && Math.abs(y - lastY) > 2.5) flush();
        buf.push(item.str);
        if (item.transform) sizes.push(Math.hypot(item.transform[2], item.transform[3]) || 12);
        lastY = y;
      }
      flush();
      pages.push(rows);
    }
    return pages;
  }

  /* ---- BMP 编码（24 位无压缩，canvas -> Uint8Array） ---- */
  function canvasToBmpBytes(canvas) {
    const w = canvas.width, h = canvas.height;
    const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const rowSize = Math.floor((24 * w + 31) / 32) * 4;
    const pixelSize = rowSize * h;
    const fileSize = 54 + pixelSize;
    const buf = new Uint8Array(fileSize);
    const dv = new DataView(buf.buffer);
    buf[0] = 0x42; buf[1] = 0x4D;
    dv.setUint32(2, fileSize, true);
    dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true);
    dv.setInt32(22, h, true);
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 24, true);
    dv.setUint32(30, 0, true);
    dv.setUint32(34, pixelSize, true);
    dv.setInt32(38, 2835, true);
    dv.setInt32(42, 2835, true);
    let o = 54;
    for (let y = h - 1; y >= 0; y--) {
      const rowStart = o;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        buf[o++] = px[i + 2];
        buf[o++] = px[i + 1];
        buf[o++] = px[i];
      }
      while (o - rowStart < rowSize) buf[o++] = 0;
    }
    return buf;
  }

  /* ---- TIFF 编码（小端、无压缩 RGB、单条带，canvas -> Uint8Array） ---- */
  function canvasToTiffBytes(canvas) {
    const w = canvas.width, h = canvas.height;
    const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const pixelBytes = w * h * 3;
    const entryCount = 11;
    const ifdSize = 2 + entryCount * 12 + 4;
    const bitsOffset = 8 + ifdSize;
    const dataOffset = bitsOffset + 6;
    const buf = new Uint8Array(dataOffset + pixelBytes);
    const dv = new DataView(buf.buffer);
    buf[0] = 0x49; buf[1] = 0x49;
    dv.setUint16(2, 42, true);
    dv.setUint32(4, 8, true);
    dv.setUint16(8, entryCount, true);
    let e = 10;
    const entry = (tag, type, count, value) => {
      dv.setUint16(e, tag, true);
      dv.setUint16(e + 2, type, true);
      dv.setUint32(e + 4, count, true);
      dv.setUint32(e + 8, value, true);
      e += 12;
    };
    entry(256, 3, 1, w);
    entry(257, 3, 1, h);
    entry(258, 3, 3, bitsOffset);
    entry(259, 3, 1, 1);
    entry(262, 3, 1, 2);
    entry(273, 4, 1, dataOffset);
    entry(277, 3, 1, 3);
    entry(278, 4, 1, h);
    entry(279, 4, 1, pixelBytes);
    entry(284, 3, 1, 1);
    entry(296, 3, 1, 2);
    dv.setUint32(e, 0, true);
    dv.setUint16(bitsOffset, 8, true);
    dv.setUint16(bitsOffset + 2, 8, true);
    dv.setUint16(bitsOffset + 4, 8, true);
    let o = dataOffset;
    for (let i = 0; i < w * h; i++) {
      buf[o++] = px[i * 4];
      buf[o++] = px[i * 4 + 1];
      buf[o++] = px[i * 4 + 2];
    }
    return buf;
  }

  /* ---- 生成 PPTX（每页幻灯片一张整页图片，纯 JSZip 构建 OOXML） ---- */
  function buildPptxBlob(images) {
    const zip = new JSZip();
    const EMU = 12700;
    const sw = Math.round((images[0] ? images[0].wPt : 595) * EMU);
    const sh = Math.round((images[0] ? images[0].hPt : 842) * EMU);
    const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
    const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    const RELS_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' + images.map((im, i) => '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('') + '</Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS_NS + '><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
    zip.file('ppt/presentation.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ' + A + ' ' + R + ' ' + P + '><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' + images.map((im, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>').join('') + '</p:sldIdLst><p:sldSz cx="' + sw + '" cy="' + sh + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>');
    zip.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS_NS + '><Relationship Id="rId1" Type="' + REL + '/slideMaster" Target="slideMasters/slideMaster1.xml"/>' + images.map((im, i) => '<Relationship Id="rId' + (i + 2) + '" Type="' + REL + '/slide" Target="slides/slide' + (i + 1) + '.xml"/>').join('') + '</Relationships>');
    zip.file('ppt/theme/theme1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme ' + A + ' name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>');
    zip.file('ppt/slideMasters/slideMaster1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ' + A + ' ' + R + ' ' + P + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>');
    zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS_NS + '><Relationship Id="rId1" Type="' + REL + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="' + REL + '/theme" Target="../theme/theme1.xml"/></Relationships>');
    zip.file('ppt/slideLayouts/slideLayout1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ' + A + ' ' + R + ' ' + P + ' type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>');
    zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS_NS + '><Relationship Id="rId1" Type="' + REL + '/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>');
    images.forEach((im, i) => {
      const n = i + 1;
      const mediaName = 'image' + n + '.jpg';
      zip.file('ppt/media/' + mediaName, im.bytes);
      // 图片按幻灯片尺寸等比缩放居中
      const s = Math.min(sw / (im.wPt * EMU), sh / (im.hPt * EMU));
      const cw = Math.round(im.wPt * EMU * s), ch = Math.round(im.hPt * EMU * s);
      const cx = Math.round((sw - cw) / 2), cy = Math.round((sh - ch) / 2);
      zip.file('ppt/slides/slide' + n + '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ' + A + ' ' + R + ' ' + P + '><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ' + n + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="' + cx + '" y="' + cy + '"/><a:ext cx="' + cw + '" cy="' + ch + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>');
      zip.file('ppt/slides/_rels/slide' + n + '.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS_NS + '><Relationship Id="rId1" Type="' + REL + '/image" Target="../media/' + mediaName + '"/><Relationship Id="rId2" Type="' + REL + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');
    });
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
  }

  /* ---- RTF 转义（非 ASCII 用 \uN? 形式，兼容 Word/WPS） ---- */
  function rtfEscape(s) {
    let out = '';
    for (const ch of String(s)) {
      const code = ch.codePointAt(0);
      if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
      else if (ch === '\n') out += '\\par ';
      else if (code < 128) out += ch;
      else if (code <= 0xFFFF) out += '\\u' + (code > 32767 ? code - 65536 : code) + '?';
      else {
        const cp = code - 0x10000;
        const hi = 0xD800 + (cp >> 10), lo = 0xDC00 + (cp & 0x3FF);
        out += '\\u' + (hi - 65536) + '?\\u' + (lo - 65536) + '?';
      }
    }
    return out;
  }

  /* ---- 行列网格渲染为 PDF 表格（供 CSV 转 PDF 使用） ---- */
  async function renderGridToPdf(grid, outName) {
    const PW = 842, PH = 595, colW = 110, rowH = 24, perPage = Math.floor((PH - 70) / rowH);
    const cols = grid.reduce((m, r) => Math.max(m, r.length), 1);
    const doc = await PDFLib.PDFDocument.create();
    for (let r0 = 0; r0 < Math.max(1, grid.length); r0 += perPage) {
      const { cv, c, scale } = makeOfficeCanvas(PW, PH);
      for (let ri = 0; ri < perPage && r0 + ri < grid.length; ri++) {
        const row = grid[r0 + ri] || [];
        const y = 30 + ri * rowH;
        for (let ci = 0; ci < cols; ci++) {
          const x = 24 + ci * colW;
          c.strokeStyle = '#999';
          c.lineWidth = 1;
          c.strokeRect(x * scale, y * scale, colW * scale, rowH * scale);
          const txt = String(row[ci] || '').slice(0, 14);
          if (txt) {
            c.fillStyle = '#000';
            c.font = '20px "Microsoft YaHei", sans-serif';
            c.fillText(txt, (x + 5) * scale, (y + rowH * 0.68) * scale);
          }
        }
      }
      const png = await canvasToBlob(cv, 'image/png');
      const page = doc.addPage([PW, PH]);
      page.drawImage(await doc.embedPng(await png.arrayBuffer()), { x: 0, y: 0, width: PW, height: PH });
    }
    return [{ name: outName, blob: bytesToBlob(await doc.save(), 'application/pdf') }];
  }

  /* ============================================================
     5. 图标（内联 SVG）
     ============================================================ */
  const ICONS = {
    merge: '<polyline points="8 6 3 12 8 18"></polyline><polyline points="16 6 21 12 16 18"></polyline><line x1="12" y1="4" x2="12" y2="20"></line>',
    split: '<circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line>',
    pages: '<rect x="8" y="3" width="8" height="11" rx="1"></rect><path d="M16 8h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h2"></path>',
    rotate: '<polyline points="21 4 21 10 15 10"></polyline><path d="M21 10a9 9 0 1 0-2.64 6.36"></path>',
    hash: '<line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line>',
    droplet: '<path d="M12 2.7l5.66 5.66a8 8 0 1 1-11.31 0z"></path>',
    stamp: '<path d="M5 22h14"></path><path d="M5 18h14v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4z"></path><circle cx="12" cy="6" r="3"></circle>',
    compress: '<polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><line x1="7" y1="12" x2="17" y2="12"></line>',
    spread: '<rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="12" y1="5" x2="12" y2="19"></line>',
    grid: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>',
    text: '<polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line>',
    info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
    img2pdf: '<rect x="3" y="3" width="14" height="14" rx="2"></rect><circle cx="8" cy="8" r="1.5"></circle><polyline points="17 13 12 8 3 17"></polyline><path d="M14 21h7v-7"></path><line x1="21" y1="21" x2="14" y2="14"></line>',
    pdf2img: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><circle cx="10" cy="13" r="1.5"></circle><polyline points="18 17 14 13 9 18"></polyline>',
    convert: '<polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></polyline>',
    resize: '<polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line>',
    flip: '<path d="M12 3v18"></path><path d="M8 8l-5 4 5 4z"></path><path d="M16 8l5 4-5 4z"></path>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"></path><path d="M18 22V8a2 2 0 0 0-2-2H2"></path>',
    booklet: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>',
    scroll: '<rect x="7" y="2" width="10" height="20" rx="2"></rect><line x1="10" y1="7" x2="14" y2="7"></line><line x1="10" y1="11" x2="14" y2="11"></line><line x1="10" y1="15" x2="12" y2="15"></line>',
    overlay: '<rect x="2" y="6" width="13" height="13" rx="2"></rect><path d="M22 8v11a2 2 0 0 1-2 2H8"></path>',
    pen: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
    photo: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path>',
    wand: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>',
    eraser: '<line x1="4" y1="20" x2="20" y2="20"></line><path d="M5 16l7-12 7 6-6 6z"></path>',
    trash: '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>',
    broom: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"></path><line x1="5" y1="21" x2="19" y2="21"></line>',
    compare: '<path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"></path><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><line x1="12" y1="2" x2="12" y2="22"></line>',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line>',
    receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"></path><line x1="9" y1="8" x2="15" y2="8"></line><line x1="9" y1="12" x2="15" y2="12"></line><line x1="9" y1="16" x2="13" y2="16"></line>',
  };

  const CAT_NAMES = { pdf: 'PDF 处理', img: '图片工具', bill: '票据识别' };

  /* ============================================================
     5.1 票据 / 发票业务核心
     复刻 PyWork2（票据识别工具）的本地解析、二维码、排序、命名、
     序时簿导入与 Excel 导出能力。全部在浏览器内完成，不上传文件。
     ============================================================ */
  const BILL_SORT_MODES = [
    ['custom', '指定发票号码顺序'], ['number_asc', '发票号码 升序'], ['number_desc', '发票号码 降序'],
    ['amount_asc', '发票金额 升序'], ['amount_desc', '发票金额 降序'],
    ['date_asc', '开票日期 升序'], ['date_desc', '开票日期 降序'], ['original', '原文件名顺序'],
  ];
  const BILL_TEMPLATE_FIELDS = [
    ['{前缀}', '前缀'], ['{序号}', '序号'], ['{发票号码}', '发票号码'], ['{发票代码}', '发票代码'],
    ['{开票日期}', '开票日期'], ['{金额}', '价税合计'], ['{税额}', '税额'], ['{发票类型}', '发票类型'],
    ['{购买方}', '购买方'], ['{销售方}', '销售方'], ['{大写金额}', '大写金额'],
    ['{页数}', '页数'], ['{原文件名}', '原文件名'],
  ];
  const BILL_QR_TYPE_LABELS = {
    '01': '增值税专用发票', '04': '增值税普通发票',
    '10': '增值税电子普通发票', '20': '增值税电子专用发票',
    '11': '卷式发票', '14': '通行费发票',
    '31': '电子发票（增值税专用发票）', '32': '电子发票（普通发票）',
    '33': '机动车销售统一发票', '34': '二手车销售统一发票',
  };
  const BILL_TYPE_LABELS = {
    VatSpecialInvoice: '增值税专用发票', VatCommonInvoice: '增值税普通发票',
    VatElectronicCommonInvoice: '增值税电子普通发票', VatElectronicSpecialInvoice: '增值税电子专用发票',
    VatElectronicInvoiceBlockchain: '区块链电子发票', VatElectronicInvoiceToll: '电子通行费发票',
    VatElectronicSpecialInvoiceFull: '全电发票（专用）', VatElectronicInvoiceFull: '全电发票（普通）',
    MachinePrintedInvoice: '通用机打发票', BusInvoice: '汽车票', ShippingInvoice: '轮船票',
    TollInvoice: '过路过桥费发票', OtherInvoice: '其他发票', TaxiTicket: '出租车票',
    QuotaInvoice: '定额发票', AirTransport: '机票行程单', TrainTicket: '火车票',
    BankSlip: '银行回单', ShoppingReceipt: '购物小票', SaleInventory: '销售清单',
  };
  const BILL_FIELD_LABELS = {
    Title: '发票标题', Kind: '发票种类', FormType: '表单类型', FormName: '表单名称',
    Code: '发票代码', CodeConfirm: '发票代码（校验）', Number: '发票号码',
    NumberConfirm: '发票号码（校验）', ElectronicFullNumber: '全电发票号码',
    ElectronicTicketNum: '电子客票号', SerialNumber: '流水号', Date: '开票日期',
    DateGetOn: '乘车日期', Time: '时间', Total: '价税合计', TotalCn: '价税合计（大写）',
    PretaxAmount: '不含税金额', SubTotal: '金额合计', SubTax: '税额合计', Tax: '税额',
    TaxAmount: '税额', TaxRate: '税率', Price: '金额', Fare: '票价', Buyer: '购买方',
    BuyerTaxID: '购买方税号', BuyerAddrTel: '购买方地址电话', BuyerBankAccount: '购买方开户行及账号',
    Seller: '销售方', SellerTaxID: '销售方税号', SellerAddrTel: '销售方地址电话',
    SellerBankAccount: '销售方开户行及账号', MachineCode: '机器编号', CheckCode: '校验码',
    Remark: '备注', Issuer: '开票人', Reviewer: '复核人', Receiptor: '收款人',
    Content: '内容', ServiceName: '服务名称', InvoiceStatus: '发票状态',
  };
  const BILL_HEADER_KEYWORDS = [
    ['数电票号码', 100], ['全电发票号码', 100], ['电子发票号码', 95], ['发票号码', 100],
    ['发票号', 90], ['票据号码', 85], ['税控号', 80], ['号码', 60],
  ];
  const BILL_SKIP_WORDS = new Set([
    '合计', '小计', '总计', '发票号码', '发票号', '数电票号码', '全电发票号码',
    '票据号码', '税控号', '号码', '日期', '金额', '序号', '备注',
  ]);
  const BILL_CACHE_KEY = 'officetoolbox.billCache.v1';
  const BILL_CACHE_MAX = 400;

  function billText(v) {
    return (v == null || typeof v === 'object') ? '' : String(v).trim();
  }
  function billSafeFloat(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  function billCleanAmount(v) {
    const text = billText(v);
    if (!text) return 0;
    const negative = text.includes('-') || text.includes('负');
    const cleaned = text.replace(/[^\d.]/g, '');
    if (!cleaned) return 0;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? (negative ? -n : n) : 0;
  }
  function billCnAmountToFloat(v) {
    let text = billText(v);
    if (!text) return 0;
    const negative = text.includes('负') || text.startsWith('-');
    text = text.replace(/负数|负|整|正/g, '');
    const digits = { 零: 0, 〇: 0, 壹: 1, 一: 1, 贰: 2, 二: 2, 叁: 3, 三: 3, 肆: 4, 四: 4, 伍: 5, 五: 5, 陆: 6, 六: 6, 柒: 7, 七: 7, 捌: 8, 八: 8, 玖: 9, 九: 9 };
    const units = { 拾: 10, 十: 10, 佰: 100, 百: 100, 仟: 1000, 千: 1000, 万: 10000, 亿: 100000000 };
    const parseSection = s => {
      let val = 0, temp = 0;
      for (const ch of s) {
        if (ch in digits) temp = digits[ch];
        else if (ch in units) {
          if (!temp && (ch === '拾' || ch === '十')) temp = 1;
          val += temp * units[ch];
          temp = 0;
        } else break;
      }
      return val + temp;
    };
    let total = 0, remaining = text;
    if (remaining.includes('亿')) {
      const p = remaining.split('亿'); total += parseSection(p[0]) * 1e8; remaining = p[1] || '';
    }
    if (remaining.includes('万')) {
      const p = remaining.split('万'); total += parseSection(p[0]) * 1e4; remaining = p[1] || '';
    }
    let yuan = '';
    if (remaining.includes('元')) { const p = remaining.split('元'); yuan = p[0]; remaining = p[1] || ''; }
    else if (remaining.includes('圆')) { const p = remaining.split('圆'); yuan = p[0]; remaining = p[1] || ''; }
    if (yuan) total += parseSection(yuan);
    else if (remaining && !/角|分/.test(remaining)) { total += parseSection(remaining); remaining = ''; }
    if (remaining.includes('角')) {
      const p = remaining.split('角');
      const m = p[0].match(/([零〇壹一贰二叁三肆四伍五陆六柒七捌八玖九])$/);
      if (m) total += digits[m[1]] * 0.1;
      remaining = p[1] || '';
    }
    if (remaining.includes('分')) {
      const p = remaining.split('分');
      const m = p[0].match(/([零〇壹一贰二叁三肆四伍五陆六柒七捌八玖九])$/);
      if (m) total += digits[m[1]] * 0.01;
    }
    const result = Math.round(total * 100) / 100;
    return negative ? -result : result;
  }
  function billFormatAmount(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v || '');
  }
  function billNormalizeNumber(v) {
    const text = billText(v).replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
    if (/^\d+$/.test(text)) return text.replace(/^0+/, '') || '0';
    return text;
  }
  function billNormalizeDate(v) {
    const text = billText(v);
    const m = text.match(/(\d{4})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/);
    if (m) return m[1] + String(parseInt(m[2], 10)).padStart(2, '0') + String(parseInt(m[3], 10)).padStart(2, '0');
    const digits = text.replace(/\D/g, '');
    if (digits.length === 8) return digits;
    if (digits.length === 6) return '20' + digits;
    return '';
  }
  function billFullwidthDigits(s) {
    return String(s || '').replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  }
  function billExtractFilenameNumber(name) {
    const stem = billFullwidthDigits(String(name || '').replace(/\.[^/.]+$/, ''));
    const patterns = [
      /(?:dzfp|dzfapiao|invoice)[_\- ]*(\d{20})(?!\d)/i,
      /(?:数电|全电|电子)?(?:发票|票)(?:号码)?[_\- ]*(\d{20})(?!\d)/,
      /(?<!\d)(\d{20})(?!\d)/,
    ];
    for (const re of patterns) {
      const m = stem.match(re);
      if (m) return m[1];
    }
    return '';
  }
  function billParseCustomOrder(text) {
    return billText(text).split(/[\s,，;；、|]+/).filter(Boolean);
  }
  function billNaturalCompare(a, b) {
    const pa = String(a || '').split(/(\d+)/).filter(Boolean);
    const pb = String(b || '').split(/(\d+)/).filter(Boolean);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || '', y = pb[i] || '';
      const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) {
        const d = Number(x) - Number(y);
        if (d) return d < 0 ? -1 : 1;
      } else {
        const c = x.toUpperCase().localeCompare(y.toUpperCase());
        if (c) return c < 0 ? -1 : 1;
      }
    }
    return 0;
  }

  /* ---------------- 发票二维码与 PDF 文本层 ---------------- */
  /* 二维码格式（GB/T《电子凭证入账要求 第2部分》附录 D）：
     01 , 发票类型 , 发票代码 , 发票号码 , 合计金额 , 开票日期(YYYYMMDD) , 发票校验码(可空) , CRC(4)
     金额含义随票种变化：20 位数电票为价税合计，老票为不含税金额。
     票种判定与 CRC-16 规则参照 InvoiceClip 的 InvoiceParser（上游 QrToInvoice，MIT）。 */
  function billCrc16(text) {
    let crc = 0;
    for (let i = 0; i < text.length; i++) {
      crc ^= (text.charCodeAt(i) & 0xff) << 8;
      for (let bit = 0; bit < 8; bit++) {
        crc = ((crc & 0x8000) ? ((crc << 1) ^ 0x8005) : (crc << 1)) & 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  /** CRC 覆盖「CRC 字段之前的全部字符」。各开票系统对末尾逗号处理不一致，两种都试；
      不匹配返回 null 表示「未校验」，不返回 false，避免把格式差异误报为内容错误。 */
  function billVerifyQrCrc(normalized, expected) {
    if (!/^[0-9A-Za-z]{4}$/.test(expected)) return null;
    const cut = normalized.lastIndexOf(',');
    if (cut < 0) return null;
    const prefix = normalized.slice(0, cut);
    const want = expected.toUpperCase();
    return billCrc16(prefix) === want || billCrc16(prefix + ',') === want ? true : null;
  }
  function billDetectQrKind(typeCode, code, number) {
    if (/^\d{20}$/.test(number)) {
      if (number[4] === '8') return '航空运输电子客票行程单';
      if (number[4] === '9') return '铁路电子客票';
      // 上游写作 substring(3,6) == "79"，3 字符与 2 字符比较恒为 false；
      // 按「号码第 5-6 位为 79」修正，且避开上面第 5 位 8/9 的客票分支。
      if (typeCode === '32' && number.slice(4, 6) === '79') return '通行费发票';
      if (BILL_QR_TYPE_LABELS[typeCode]) return BILL_QR_TYPE_LABELS[typeCode];
      return '数电票';
    }
    if (BILL_QR_TYPE_LABELS[typeCode]) return BILL_QR_TYPE_LABELS[typeCode];
    if (code.startsWith('CZ')) return '财政票据';
    if (code.length === 12) {
      const tail = code.slice(10, 12);
      if (tail === '11') return '增值税电子普通发票';
      if (tail === '13') return '增值税电子专用发票';
      if (tail === '12') return '通行费发票';
      if (tail === '04' || tail === '05') return '增值税普通发票';
      if (tail === '06' || tail === '07') return '卷式发票';
      if (code[0] === '1' && code.slice(7, 9) === '09' && code.endsWith('0')) return '区块链电子发票';
    }
    if (code.length === 10) {
      const flag = code[7];
      if (flag === '1' || flag === '5' || flag === '2' || flag === '7') return '增值税专用发票';
      if (flag === '3' || flag === '6') return '增值税普通发票';
    }
    return '其他发票';
  }
  function billParseQrText(text) {
    const raw = billText(text);
    const normalized = raw.replace(/,+$/, '');
    const parts = normalized.split(',').map(p => p.trim());
    if (parts.length < 6 || parts[0] !== '01') return null;
    const typeCode = parts[1] || '';
    const code = parts[2] || '';
    const number = parts[3] || '';
    const amount = parts[4] ? (() => {
      const m = parts[4].replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
      return m ? Math.round(parseFloat(m[0]) * 100) / 100 : null;
    })() : null;
    let date = '';
    if (/^\d{8}$/.test(parts[5] || '')) {
      const y = parts[5].slice(0, 4), mo = parts[5].slice(4, 6), d = parts[5].slice(6, 8);
      const dt = new Date(Date.UTC(+y, +mo - 1, +d));
      if (dt.getUTCFullYear() === +y && dt.getUTCMonth() === +mo - 1 && dt.getUTCDate() === +d) {
        date = `${y}年${mo}月${d}日`;
      }
    }
    if (!number && amount == null && !date) return null;
    const crc = parts[7] || '';
    const isDigital = /^\d{20}$/.test(number);
    return {
      version: parts[0], type_code: typeCode, code, number, amount, date,
      // 标准第 7 段为校验码；数电票该段为空时保留历史行为，回退展示第 8 段。
      check_code: parts[6] || crc,
      invoice_check_code: parts[6] || '', crc,
      crc_verified: billVerifyQrCrc(normalized, crc),
      kind: billDetectQrKind(typeCode, code, number),
      is_digital: isDigital,
      amount_is_total: isDigital,
      amount_label: isDigital ? '价税合计' : '金额（不含税）',
      text: raw,
    };
  }
  function billQrTypeLabel(code) {
    return BILL_QR_TYPE_LABELS[billText(code)] || '数电发票';
  }
  function billParsePdfInvoiceText(text) {
    const raw = String(text || '');
    const compact = raw.replace(/[ \t]+/g, ' ');
    const out = {
      invoice_number: '', invoice_date: '', amount: 0, tax_amount: 0, total_cn: '',
      buyer: '', seller: '', invoice_type: '', invoice_code: '', issuer: '', check_code: '',
      items: [],
    };
    const num = compact.match(/(?<!\d)\d{20}(?!\d)/);
    if (num) out.invoice_number = num[0];
    const code = compact.match(/(?<!\d)\d{10,12}(?!\d)/);
    if (code) out.invoice_code = code[0];
    const date = compact.match(/(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/);
    if (date) out.invoice_date = `${date[1]}年${String(+date[2]).padStart(2, '0')}月${String(+date[3]).padStart(2, '0')}日`;
    let money = Array.from(compact.matchAll(/[¥￥]\s*(-?[\d,]+\.\d{2})(?!\d)/g), m => billCleanAmount(m[1]));
    if (!money.length) money = Array.from(compact.matchAll(/(?<![\d.])(-?[\d,]+\.\d{2})(?!\d)/g), m => billCleanAmount(m[1]));
    money = money.filter(Number.isFinite);
    if (money.length) {
      let total = 0;
      for (const m of money) if (Math.abs(m) > Math.abs(total)) total = m;
      out.amount = Math.round(total * 100) / 100;
      // 不含税金额 + 税额 = 价税合计，取该配对中绝对值较小的作为税额
      let tax = 0;
      for (let i = 0; i < money.length; i++) {
        for (let j = i + 1; j < money.length; j++) {
          if (Math.abs(money[i] + money[j] - total) >= 0.005) continue;
          const cand = Math.abs(money[i]) < Math.abs(money[j]) ? money[i] : money[j];
          if (Math.abs(cand) > Math.abs(tax)) tax = cand;
        }
      }
      out.tax_amount = Math.round(tax * 100) / 100;
    }
    const cn = compact.match(/[零〇壹一贰二叁三肆四伍五陆六柒七捌八玖九拾十佰百仟千万亿圆元角分整正负]{4,}/);
    if (cn) {
      out.total_cn = cn[0];
      if (!out.amount) out.amount = billCnAmountToFloat(cn[0]);
    }
    const type = compact.match(/(?:电子发票|数电发票|全电发票|增值税[^，,。；;\n]{0,12}发票)[（(][^）)\n]{0,20}[）)]?/);
    if (type) out.invoice_type = type[0];
    else if (/电子发票/.test(compact)) out.invoice_type = '电子发票';
    const companies = Array.from(compact.matchAll(/[\u4e00-\u9fa5A-Za-z0-9（）()·\-]{2,40}(?:有限责任公司|股份有限公司|有限公司|公司|集团|合作社|药店|医院|商行|中心|厂)/g), m => m[0]);
    const uniq = [];
    for (const c of companies) if (!uniq.includes(c)) uniq.push(c);
    out.buyer = uniq[0] || '';
    out.seller = uniq[1] || '';
    const ids = Array.from(compact.matchAll(/(?<!\d)([0-9A-Z]{15,20})(?!\d)/g), m => m[1])
      .filter(v => v !== out.invoice_number && /\d/.test(v) && /[A-Z]/.test(v));
    if (ids[0]) out.items.push(['购买方税号', ids[0]]);
    if (ids[1]) out.items.push(['销售方税号', ids[1]]);
    return out;
  }
  function billParseOcrInput(text) {
    const raw = billText(text);
    if (!raw) return [];
    let value;
    try { value = JSON.parse(raw); } catch (e) { throw new Error('云端 OCR JSON 格式无效：' + e.message); }
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.results)) return value.results;
    return [value];
  }

  function billCanvasQr(canvas) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, w, h);
    if (typeof jsQR === 'function') {
      const res = jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (res && res.data) return res.data;
    }
    return '';
  }
  function billCropCanvas(src, x, y, w, h) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.min(w, src.width - x));
    cv.height = Math.max(1, Math.min(h, src.height - y));
    cv.getContext('2d').drawImage(src, x, y, cv.width, cv.height, 0, 0, cv.width, cv.height);
    return cv;
  }
  async function billBarcodeDetect(canvas) {
    if (typeof BarcodeDetector === 'undefined') return '';
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const found = await detector.detect(canvas);
      for (const f of found || []) if (f.rawValue) return f.rawValue;
    } catch (e) { /* 浏览器不支持该格式时静默回退 */ }
    return '';
  }
  async function billDecodeQrFromCanvas(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return '';
    let text = '';
    try {
      // 数电发票二维码通常在左上角，先扫描裁剪区可显著加快批量处理
      const crop = billCropCanvas(canvas, 0, 0, Math.ceil(canvas.width * 0.62), Math.ceil(canvas.height * 0.55));
      text = billCanvasQr(crop) || await billBarcodeDetect(crop);
      if (!text) text = billCanvasQr(canvas) || await billBarcodeDetect(canvas);
    } catch (e) { /* 渲染或解码失败按无二维码处理 */ }
    return billText(text);
  }
  async function billPageCanvas(page, scale) {
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.floor(vp.width);
    cv.height = Math.floor(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    return cv;
  }
  async function billAnalyzePdf(file, opts) {
    const out = { text: '', qrText: '', page_count: 0 };
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data }).promise;
    try {
      out.page_count = doc.numPages;
      const pages = Math.min(2, doc.numPages);
      for (let i = 1; i <= pages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        out.text += tc.items.map(it => it.str).join('\n') + '\n';
        if (opts && opts.useQr !== false && !out.qrText) {
          out.qrText = await billDecodeQrFromCanvas(await billPageCanvas(page, 2));
          if (!out.qrText && i === 1 && doc.numPages === 1) {
            out.qrText = await billDecodeQrFromCanvas(await billPageCanvas(page, 3));
          }
        }
      }
    } finally {
      if (typeof doc.destroy === 'function') await doc.destroy();
    }
    return out;
  }
  async function billDecodeQrFromImage(file) {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.floor(bitmap.width * scale));
      cv.height = Math.max(1, Math.floor(bitmap.height * scale));
      cv.getContext('2d').drawImage(bitmap, 0, 0, cv.width, cv.height);
      return await billDecodeQrFromCanvas(cv);
    } finally { bitmap.close(); }
  }
  function billExt(name) {
    const m = String(name || '').toLowerCase().match(/(\.[^.]+)$/);
    return m ? m[1] : '';
  }
  function billIsImage(name) {
    return ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.tif', '.tiff'].includes(billExt(name));
  }
  /** 统一分析 PDF / 图片 / OFD：文本层、二维码文本与页数。 */
  async function billAnalyzeFile(file, useQr) {
    const out = { text: '', qrText: '', page_count: 0, error: '' };
    try {
      if (billExt(file.name) === '.pdf') {
        const a = await billAnalyzePdf(file, { useQr: useQr !== false });
        out.text = a.text; out.qrText = a.qrText; out.page_count = a.page_count;
      } else if (billIsImage(file.name) && useQr !== false) {
        out.qrText = await billDecodeQrFromImage(file);
        out.page_count = 1;
      }
    } catch (e) {
      out.error = '文件解析失败：' + (e && e.message ? e.message : e);
    }
    return out;
  }

  /* ---------------- 云端 OCR 响应解析（与原项目同款字段规则） ---------------- */
  function billParseBillResult(data, isAcceptance) {
    const items = [];
    let numAmount = 0, cnAmount = 0, hasNum = false, hasCn = false;
    const processAmount = (name, val) => {
      if (!/金额|Total|小计|合计|票面/.test(billText(name))) return billText(val);
      if (/大写/.test(billText(name))) {
        const n = billCnAmountToFloat(val);
        if (n > 0) { cnAmount = n; hasCn = true; }
      } else {
        const n = billCleanAmount(val);
        if (n > 0) {
          const corrected = isAcceptance ? n / 100 : n;
          numAmount = corrected; hasNum = true;
          return billFormatAmount(corrected);
        }
      }
      return billText(val);
    };
    const parseItem = item => {
      if (!item || typeof item !== 'object') return;
      if (item.Total) processAmount('Total', item.Total);
      const infos = item.SingleInvoiceInfos;
      if (infos && !Array.isArray(infos) && typeof infos === 'object') {
        const other = infos.OtherInvoice;
        if (other) {
          if (other.Total) processAmount('Total', other.Total);
          for (const row of other.OtherInvoiceListItems || []) {
            items.push([billText(row.Name), processAmount(row.Name, row.Value)]);
          }
        }
      } else if (Array.isArray(infos)) {
        for (const info of infos) {
          if (info && typeof info === 'object') items.push([billText(info.Name), processAmount(info.Name, info.Value)]);
        }
      }
    };
    if (!data || typeof data !== 'object' || data.Error) {
      return { ok: false, items: [], amount: 0, error: billText(data && data.Error) || '识别失败' };
    }
    if (Array.isArray(data.BankSlipInfos)) {
      for (const info of data.BankSlipInfos) {
        items.push([billText(info.Name), processAmount(info.Name, info.Value)]);
      }
    } else if (Array.isArray(data.MixedInvoiceItems)) {
      for (const item of data.MixedInvoiceItems) parseItem(item);
    } else if (Array.isArray(data.OtherInvoiceListItems)) {
      for (const info of data.OtherInvoiceListItems) {
        items.push([billText(info.Name), processAmount(info.Name, info.Value)]);
      }
    }
    if (!items.length) {
      for (const [key, val] of Object.entries(data)) {
        if (val == null || typeof val === 'object') continue;
        if (['Rect', 'Type', 'Code', 'Polygon'].includes(key)) continue;
        items.push([key, processAmount(key, val)]);
      }
    }
    return { ok: true, items, amount: Math.round((hasNum ? numAmount : (hasCn ? cnAmount : 0)) * 100) / 100, error: '' };
  }
  function billLocalBillOcr(analysis, file) {
    const infos = [];
    const seen = new Set();
    const push = (name, value) => {
      const n = billText(name), v = billText(value);
      if (!n || !v || seen.has(n)) return;
      seen.add(n);
      infos.push({ Name: n, Value: v });
    };
    for (const line of String(analysis.text || '').split(/\r?\n/)) {
      const m = line.trim().match(/^(.{2,20}?)[:：]\s*(.{1,80})$/);
      if (m) push(m[1], m[2]);
    }
    const money = Array.from(String(analysis.text || '').matchAll(/[¥￥]\s*(-?[\d,]+\.\d{2})/g), m => m[1]);
    if (money.length) push('金额（小写）', money[money.length - 1]);
    const num = billExtractFilenameNumber(file.name);
    if (num) push('文件号码', num);
    if (!infos.length) push('文件名', file.name);
    return { BankSlipInfos: infos };
  }
  function billParseSingleInvoice(payload, key, typeDescription, page) {
    const items = [];
    for (const [k, v] of Object.entries(payload)) {
      if (v == null || typeof v === 'object') continue;
      const t = billText(v);
      if (t) items.push([BILL_FIELD_LABELS[k] || k, t]);
    }
    let amount = 0;
    for (const k of ['Total', 'Price', 'Fare', 'PretaxAmount']) {
      if (payload[k]) { amount = billCleanAmount(payload[k]); if (amount) break; }
    }
    if (!amount) amount = billCnAmountToFloat(payload.TotalCn);
    const first = keys => {
      for (const k of keys) if (billText(payload[k])) return billText(payload[k]);
      return '';
    };
    return {
      type: typeDescription || BILL_TYPE_LABELS[key] || key,
      code: first(['Code', 'CodeConfirm']),
      number: first(['Number', 'NumberConfirm', 'ElectronicFullNumber', 'ElectronicTicketNum', 'SerialNumber']),
      date: first(['Date', 'DateGetOn', 'DateStart']),
      amount: Math.round(amount * 100) / 100,
      tax: Math.round(billCleanAmount(payload.Tax || payload.TaxAmount) * 100) / 100,
      total_cn: billText(payload.TotalCn),
      buyer: first(['Buyer']), seller: first(['Seller']),
      title: billText(payload.Title), page: page || 0, items,
    };
  }
  function billApplyInvoiceResponse(rec, data) {
    const invoices = [];
    const mixed = data && Array.isArray(data.MixedInvoiceItems) ? data.MixedInvoiceItems : [];
    for (const item of mixed) {
      if (!item || typeof item !== 'object') continue;
      const desc = billText(item.TypeDescription);
      const page = item.Page;
      const single = item.SingleInvoiceInfos;
      let found = false;
      if (single && !Array.isArray(single) && typeof single === 'object') {
        for (const [key, payload] of Object.entries(single)) {
          if (!payload || typeof payload !== 'object') continue;
          if (key === 'OtherInvoice') {
            invoices.push({
              type: desc || '其他发票', code: '', number: '', date: '', amount: billCleanAmount(payload.Value),
              tax: 0, total_cn: '', buyer: '', seller: '', title: '', page: page || 0,
              items: [[billText(payload.Name) || '其他发票', billText(payload.Value)]],
            });
          } else invoices.push(billParseSingleInvoice(payload, key, desc, page));
          found = true;
        }
      } else if (Array.isArray(single)) {
        const pairs = single.filter(x => x && typeof x === 'object')
          .map(x => [billText(x.Name), billText(x.Value)]).filter(p => p[0] || p[1]);
        if (pairs.length) {
          invoices.push({
            type: desc || '其他发票', code: '', number: '', date: '', amount: 0, tax: 0,
            total_cn: '', buyer: '', seller: '', title: '', page: page || 0, items: pairs,
          });
          found = true;
        }
      }
      if (!found) {
        const note = desc || billText(item.Code) || '未识别';
        rec.error = rec.error ? rec.error + '；' + note : note;
      }
    }
    if (!invoices.length && data && Array.isArray(data.OtherInvoiceListItems)) {
      const pairs = data.OtherInvoiceListItems.filter(x => x && typeof x === 'object')
        .map(x => [billText(x.Name), billText(x.Value)]).filter(p => p[0] || p[1]);
      if (pairs.length) {
        invoices.push({
          type: '其他发票', code: '', number: '', date: '', amount: 0, tax: 0,
          total_cn: '', buyer: '', seller: '', title: '', page: 0, items: pairs,
        });
      }
    }
    if (!invoices.length) {
      rec.status = '识别失败';
      rec.error = rec.error || '未识别到发票信息';
      return rec;
    }
    invoices.sort((a, b) => (a.page || 0) - (b.page || 0));
    const primary = invoices[0];
    rec.invoices = invoices;
    rec.invoice_type = primary.type;
    rec.invoice_code = primary.code;
    rec.invoice_number = primary.number;
    rec.invoice_date = primary.date;
    rec.total_cn = primary.total_cn;
    rec.buyer = primary.buyer;
    rec.seller = primary.seller;
    rec.items = primary.items.slice();
    rec.amount = Math.round(invoices.reduce((s, i) => s + billSafeFloat(i.amount), 0) * 100) / 100;
    rec.tax_amount = Math.round(invoices.reduce((s, i) => s + billSafeFloat(i.tax), 0) * 100) / 100;
    rec.page_count = parseInt(data.TotalPDFCount, 10) || Math.max(1, ...invoices.map(i => parseInt(i.page, 10) || 1));
    rec.status = '识别成功';
    rec.error = '';
    return rec;
  }

  /* ---------------- 识别记录与本地缓存 ---------------- */
  function billEmptyRecord(file) {
    return {
      file, path: file.name, file_name: file.name, status: '待识别', error: '',
      invoices: [], invoice_type: '', invoice_code: '', invoice_number: '', invoice_date: '',
      amount: 0, tax_amount: 0, total_cn: '', buyer: '', seller: '', items: [], page_count: 0,
      from_cache: false, from_filename: false, from_qr: false, from_ocr: false,
      qr_check_code: '', qr_type_code: '', qr_text: '', qr_crc: '',
      amount_is_total: true,
    };
  }
  function billIsSuccess(rec) { return rec.status === '识别成功'; }
  function billIsUsable(rec) {
    return rec.status === '识别成功' || rec.status === '本地解析' || rec.status === '号码已提取';
  }
  function billApplyFilenameNumber(rec) {
    const n = billExtractFilenameNumber(rec.file_name);
    if (!n) return '';
    rec.invoice_number = n;
    rec.from_filename = true;
    if (!billIsSuccess(rec)) { rec.status = '本地解析'; rec.error = ''; }
    return n;
  }
  function billCacheRead() {
    try {
      const v = JSON.parse(localStorage.getItem(BILL_CACHE_KEY) || '{}');
      return (v && typeof v === 'object') ? v : {};
    } catch (e) { return {}; }
  }
  function billCacheKey(file) {
    return [file.name, file.size, file.lastModified || 0].join('|');
  }
  function billCacheGet(file) {
    const hit = billCacheRead()[billCacheKey(file)];
    return hit && typeof hit === 'object' ? hit.record : null;
  }
  function billCachePut(file, rec) {
    try {
      const cache = billCacheRead();
      const keys = Object.keys(cache);
      if (keys.length >= BILL_CACHE_MAX) {
        keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
        for (const k of keys.slice(0, keys.length - BILL_CACHE_MAX + 1)) delete cache[k];
      }
      const copy = { ...rec };
      delete copy.file;
      cache[billCacheKey(file)] = { ts: Date.now(), record: copy };
      localStorage.setItem(BILL_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* 隐私模式或容量不足时忽略缓存 */ }
  }
  function billCacheClear() {
    try { localStorage.removeItem(BILL_CACHE_KEY); } catch (e) { /* ignore */ }
  }
  function billCacheStats() {
    const cache = billCacheRead();
    return { files: Object.keys(cache).length, results: Object.keys(cache).length };
  }
  function billMergeTextFields(rec, parsed, onlyMissing) {
    const assign = (key, value) => {
      if (!value) return;
      if (!onlyMissing || !rec[key]) rec[key] = value;
    };
    assign('invoice_number', parsed.invoice_number);
    assign('invoice_date', parsed.invoice_date);
    assign('invoice_code', parsed.invoice_code);
    assign('invoice_type', parsed.invoice_type);
    assign('total_cn', parsed.total_cn);
    assign('buyer', parsed.buyer);
    assign('seller', parsed.seller);
    if (!onlyMissing || !rec.amount) rec.amount = parsed.amount || rec.amount;
    if (!onlyMissing || !rec.tax_amount) rec.tax_amount = parsed.tax_amount || rec.tax_amount;
    for (const pair of parsed.items || []) {
      if (!rec.items.some(x => x[0] === pair[0])) rec.items.push(pair);
    }
  }
  function billRecordItems(rec) {
    const amountLabel = rec.amount_is_total === false ? '金额（不含税）' : '价税合计';
    const pairs = [
      ['发票类型', rec.invoice_type], ['发票代码', rec.invoice_code], ['发票号码', rec.invoice_number],
      ['开票日期', rec.invoice_date], [amountLabel, rec.amount ? rec.amount.toFixed(2) : ''],
      ['税额', rec.tax_amount ? rec.tax_amount.toFixed(2) : ''],
      ['价税合计（大写）', rec.total_cn], ['购买方', rec.buyer], ['销售方', rec.seller],
      ['二维码校验码', rec.qr_check_code], ['二维码CRC', rec.qr_crc], ['二维码类型代码', rec.qr_type_code],
    ];
    const out = [];
    const seen = new Set();
    for (const [k, v] of pairs.concat(rec.items || [])) {
      if (!v || seen.has(k)) continue;
      seen.add(k);
      out.push([k, billText(v)]);
    }
    return out;
  }
  async function billBuildRecord(file, opts) {
    const o = opts || {};
    let rec = billEmptyRecord(file);
    if (o.useCache !== false) {
      const hit = billCacheGet(file);
      if (hit) return { ...rec, ...hit, file, path: file.name, file_name: file.name, from_cache: true };
    }
    const filenameNumber = billApplyFilenameNumber(rec);
    const ext = billExt(file.name);
    const analysis = await billAnalyzeFile(file, o.useQr !== false);
    if (analysis.error) rec.error = analysis.error;
    const parsedText = analysis.text ? billParsePdfInvoiceText(analysis.text) : null;
    let qr = null;
    if (analysis.qrText) {
      qr = billParseQrText(analysis.qrText);
      if (qr) {
        rec.from_qr = true;
        rec.qr_text = analysis.qrText;
        rec.qr_type_code = qr.type_code;
        rec.qr_check_code = qr.check_code;
        rec.qr_crc = qr.crc;
        rec.invoice_type = qr.kind || billQrTypeLabel(qr.type_code);
        if (qr.code) rec.invoice_code = qr.code;
        if (qr.number) {
          if (filenameNumber && billNormalizeNumber(filenameNumber) !== billNormalizeNumber(qr.number)) {
            rec.error = '文件名号码与二维码号码不一致，已采用二维码号码';
          }
          rec.invoice_number = qr.number;
        }
        if (qr.amount != null) {
          rec.amount = qr.amount;
          rec.amount_is_total = qr.amount_is_total;
        }
        if (qr.date) rec.invoice_date = qr.date;
        rec.status = '本地解析';
      }
    }
    // 二维码 / 文件名号码优先，PDF 文本层只补齐缺失字段，避免明细数字误覆盖
    if (parsedText) billMergeTextFields(rec, parsedText, true);
    if (o.ocrData && typeof o.ocrData === 'object') {
      const localItems = billRecordItems(rec);
      const localAmount = rec.amount;
      billApplyInvoiceResponse(rec, o.ocrData);
      rec.from_ocr = true;
      if (!rec.amount) rec.amount = localAmount;
      for (const pair of localItems) if (!rec.items.some(x => x[0] === pair[0])) rec.items.push(pair);
    }
    rec.page_count = rec.page_count || analysis.page_count || 0;
    if (!rec.invoice_number && !rec.invoice_date && !rec.amount) {
      rec.status = '待识别';
      rec.error = rec.error || (ext === '.ofd' ? 'OFD 需先转换为 PDF 或图片' : '未找到二维码，文件名中也未找到 20 位发票号码');
    } else if (!billIsSuccess(rec)) {
      rec.status = '本地解析';
    }
    if (o.useCache !== false && rec.invoice_number && billIsUsable(rec)) billCachePut(file, rec);
    return rec;
  }
  async function billBuildRecords(files, opts, onStep) {
    const o = opts || {};
    const records = [];
    for (let i = 0; i < files.length; i++) {
      if (onStep) onStep(i, files.length, files[i].name);
      records.push(await billBuildRecord(files[i], {
        useQr: o.useQr !== false, useCache: o.useCache !== false,
        ocrData: Array.isArray(o.ocrList) ? o.ocrList[i] : null,
      }));
    }
    return records;
  }

  /* ---------------- 排序 / 命名 ---------------- */
  function billSortRecords(records, mode, customText) {
    const numberMode = ['custom', 'number_asc', 'number_desc'].includes(mode);
    const valid = records.filter(r => numberMode ? !!r.invoice_number : (billIsUsable(r) && (r.amount || r.invoice_date)));
    const invalid = records.filter(r => !valid.includes(r));
    let ordered = valid.slice();
    if (mode === 'custom') {
      const order = billParseCustomOrder(customText);
      const rank = new Map();
      order.forEach((n, i) => {
        const key = billNormalizeNumber(n);
        if (key && !rank.has(key)) rank.set(key, i);
      });
      const decorated = ordered.map((r, i) => {
        const pos = rank.get(billNormalizeNumber(r.invoice_number));
        return [{ has: pos == null ? 1 : 0, pos: pos == null ? i : pos }, r];
      });
      decorated.sort((a, b) => a[0].has - b[0].has || a[0].pos - b[0].pos);
      ordered = decorated.map(d => d[1]);
    } else if (mode === 'number_asc' || mode === 'number_desc') {
      ordered.sort((a, b) => billNaturalCompare(a.invoice_number || a.file_name, b.invoice_number || b.file_name));
      if (mode === 'number_desc') ordered.reverse();
    } else if (mode === 'amount_asc' || mode === 'amount_desc') {
      ordered.sort((a, b) => (a.amount - b.amount) * (mode === 'amount_desc' ? -1 : 1));
    } else if (mode === 'date_asc' || mode === 'date_desc') {
      const dated = ordered.filter(r => billNormalizeDate(r.invoice_date));
      const undated = ordered.filter(r => !billNormalizeDate(r.invoice_date));
      dated.sort((a, b) => billNormalizeDate(a.invoice_date).localeCompare(billNormalizeDate(b.invoice_date)) * (mode === 'date_desc' ? -1 : 1));
      ordered = dated.concat(undated);
    } else {
      ordered.sort((a, b) => billNaturalCompare(a.file_name, b.file_name));
    }
    return ordered.concat(invalid);
  }
  function billSortStats(records, ordered, mode, customText) {
    const stats = { total: records.length, matched: 0, missing: [], missing_count: 0, unmatched: [], failed: [], order: [] };
    const index = new Map(records.map((r, i) => [r, i]));
    stats.order = ordered.map(r => index.get(r));
    if (mode !== 'custom') {
      stats.matched = ordered.filter(r => r.invoice_number).length;
      return stats;
    }
    const numbers = billParseCustomOrder(customText);
    const rank = new Set(numbers.map(billNormalizeNumber).filter(Boolean));
    const known = new Set(records.filter(r => r.invoice_number).map(r => billNormalizeNumber(r.invoice_number)));
    const seen = new Set();
    for (const n of numbers) {
      const k = billNormalizeNumber(n);
      if (k && !known.has(k) && !seen.has(k)) { seen.add(k); stats.missing.push(n); }
    }
    stats.missing_count = stats.missing.length;
    for (const r of ordered) {
      if (!r.invoice_number) stats.failed.push(r.file_name);
      else if (rank.has(billNormalizeNumber(r.invoice_number))) stats.matched++;
      else stats.unmatched.push(r.file_name);
    }
    return stats;
  }
  function billPreferredLength(records) {
    const counts = new Map();
    for (const r of records) {
      if (!r.invoice_number) continue;
      const len = String(r.invoice_number).replace(/\D/g, '').length;
      if (len >= 4) counts.set(len, (counts.get(len) || 0) + 1);
    }
    let best = 20, bestCount = 0;
    for (const [len, count] of counts) if (count > bestCount) { best = len; bestCount = count; }
    return best;
  }
  function billCleanComponent(v, limit) {
    return billText(v).replace(/[\\/:*?"<>|\r\n\t]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit || 60);
  }
  function billTemplateValues(rec, seq, prefix, digits) {
    return {
      '{前缀}': billCleanComponent(prefix, 40),
      '{序号}': String(seq).padStart(Math.max(1, Math.min(8, digits)), '0'),
      '{发票号码}': billCleanComponent(rec.invoice_number, 40),
      '{发票代码}': billCleanComponent(rec.invoice_code, 40),
      '{开票日期}': billNormalizeDate(rec.invoice_date) || billCleanComponent(rec.invoice_date, 20),
      '{金额}': rec.amount ? rec.amount.toFixed(2) : '',
      '{税额}': rec.tax_amount ? rec.tax_amount.toFixed(2) : '',
      '{发票类型}': billCleanComponent(rec.invoice_type, 40),
      '{购买方}': billCleanComponent(rec.buyer, 40),
      '{销售方}': billCleanComponent(rec.seller, 40),
      '{大写金额}': billCleanComponent(rec.total_cn, 60),
      '{页数}': rec.page_count ? String(rec.page_count) : '',
      '{原文件名}': billCleanComponent(baseName(rec.file_name), 60),
    };
  }
  function billRenderNameTemplate(rec, seq, prefix, digits, template) {
    const tpl = billText(template);
    if (!tpl) throw new Error('命名模板不能为空');
    const values = billTemplateValues(rec, seq, prefix, digits);
    let name = tpl.replace(/\{([^{}]+)\}/g, (m, key) => {
      const k = '{' + key + '}';
      if (!(k in values)) throw new Error('模板字段 ' + k + ' 不存在');
      return values[k];
    });
    name = name.replace(/([_\- ])\1+/g, '$1').replace(/^[ _\-.]+|[ _\-.]+$/g, '');
    name = billCleanComponent(name, 120).replace(/^[ _\-.]+|[ _\-.]+$/g, '');
    return name || values['{序号}'];
  }
  function billBuildTargetName(rec, seq, opts) {
    const digits = Math.max(1, Math.min(8, parseInt(opts.digits, 10) || 3));
    return billRenderNameTemplate(rec, seq, opts.prefix || '', digits, opts.template || '{前缀}{序号}');
  }
  function billBuildRenamePlan(records, opts) {
    const used = new Set();
    const start = parseInt(opts.start, 10);
    return records.map((rec, i) => {
      const seq = (Number.isFinite(start) ? start : 1) + i;
      const base = billBuildTargetName(rec, seq, opts);
      const ext = billExt(rec.file_name) || '.pdf';
      let name = base + ext, suffix = 2;
      while (used.has(name.toLowerCase())) name = base + '_' + (suffix++) + ext;
      used.add(name.toLowerCase());
      return { record: rec, old_name: rec.file_name, new_name: name, sequence: seq };
    });
  }

  /* ---------------- Excel / 文本 / ZIP 输出 ---------------- */
  function billGridSheet(name, columns, rows, widths) {
    return {
      name,
      grid: [columns].concat(rows.map(row => row.map(v => (v == null ? '' : String(v))))),
      colWidths: widths || columns.map(c => Math.min(40, Math.max(10, String(c).length * 2 + 6)) * 7),
    };
  }
  function billTextBlob(text) {
    return new Blob(['\uFEFF' + String(text || ''),], { type: 'text/plain;charset=utf-8' });
  }
  async function billRecordsToXlsx(records) {
    const detailColumns = ['文件序号', '源文件', '发票类型', '发票代码', '发票号码', '开票日期', '价税合计', '税额', '价税合计（大写）', '购买方', '销售方', '页码', '识别状态', '错误信息'];
    const fileColumns = ['序号', '文件名', '识别状态', '发票类型', '发票号码', '开票日期', '价税合计', '税额', '发票张数', '错误信息'];
    const detailRows = [], fileRows = [];
    records.forEach((rec, i) => {
      const idx = i + 1;
      fileRows.push([
        idx, rec.file_name, rec.status, rec.invoice_type || '', rec.invoice_number,
        rec.invoice_date, billIsUsable(rec) && rec.amount ? rec.amount.toFixed(2) : '',
        billIsSuccess(rec) && rec.tax_amount ? rec.tax_amount.toFixed(2) : '',
        (rec.invoices || []).length, rec.error,
      ]);
      if (billIsSuccess(rec) && (rec.invoices || []).length) {
        for (const inv of rec.invoices) {
          detailRows.push([
            idx, rec.file_name, inv.type || '', inv.code || '', inv.number || '', inv.date || '',
            billSafeFloat(inv.amount), billSafeFloat(inv.tax), inv.total_cn || '', inv.buyer || '',
            inv.seller || '', inv.page || '', rec.status, '',
          ]);
        }
      } else if (rec.invoice_number || rec.amount || rec.invoice_date) {
        detailRows.push([
          idx, rec.file_name, rec.invoice_type || '', rec.invoice_code || '', rec.invoice_number || '',
          rec.invoice_date || '', rec.amount || 0, rec.tax_amount || 0, rec.total_cn || '',
          rec.buyer || '', rec.seller || '', rec.page_count || '', rec.status, rec.error || '',
        ]);
      } else {
        detailRows.push([idx, rec.file_name, '', '', '', '', '', '', '', '', '', '', rec.status, rec.error]);
      }
    });
    return buildXlsxBlob([
      billGridSheet('发票明细', detailColumns, detailRows),
      billGridSheet('文件清单', fileColumns, fileRows),
    ]);
  }
  async function billResultsToXlsx(results) {
    const columns = ['文件名'];
    const seen = new Set(columns);
    const rows = [];
    for (const r of results) {
      const row = { 文件名: r.file_name };
      if (!r.ok) {
        row.错误原因 = r.error || '';
        if (!seen.has('错误原因')) { columns.push('错误原因'); seen.add('错误原因'); }
      } else {
        for (const pair of r.items || []) {
          const name = billText(pair[0]);
          if (!name) continue;
          row[name] = billText(pair[1]);
          if (!seen.has(name)) { columns.push(name); seen.add(name); }
        }
        row.识别金额 = r.amount ? r.amount.toFixed(2) : '';
        if (!seen.has('识别金额')) { columns.push('识别金额'); seen.add('识别金额'); }
      }
      rows.push(row);
    }
    return buildXlsxBlob([billGridSheet('识别结果', columns, rows.map(r => columns.map(c => r[c] || '')))]);
  }
  function billSummaryText(lines) {
    return billTextBlob(lines.join('\r\n') + '\r\n');
  }
  async function billZipFiles(entries) {
    const zip = new JSZip();
    for (const e of entries) zip.file(e.name, e.blob || e.file);
    return zip.generateAsync({ type: 'blob', compression: 'STORE' });
  }
  /** 按记录顺序合成 PDF（PDF 直接拷贝页面，图片转成一页，OFD 跳过）。 */
  async function billMergeRecordsToPdf(records, onStep) {
    const out = await PDFLib.PDFDocument.create();
    const merged = [], skipped = [];
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (onStep) onStep(i, records.length, rec.file_name);
      const ext = billExt(rec.file_name);
      try {
        if (ext === '.pdf') {
          const src = await loadPdfDoc(rec.file);
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach(p => out.addPage(p));
          merged.push(rec.file_name);
        } else if (billIsImage(rec.file_name)) {
          const bitmap = await createImageBitmap(rec.file);
          const cv = document.createElement('canvas');
          cv.width = bitmap.width; cv.height = bitmap.height;
          cv.getContext('2d').drawImage(bitmap, 0, 0);
          bitmap.close();
          const png = await canvasToBlob(cv, 'image/png');
          const img = await out.embedPng(await png.arrayBuffer());
          const scale = Math.min(555 / cv.width, 802 / cv.height);
          const w = cv.width * scale, h = cv.height * scale;
          const page = out.addPage([595.28, 841.89]);
          page.drawImage(img, { x: (595.28 - w) / 2, y: (841.89 - h) / 2, width: w, height: h });
          merged.push(rec.file_name);
        } else {
          skipped.push([rec.file_name, ext === '.ofd' ? 'OFD 格式暂不支持合成 PDF' : '不支持的文件格式']);
        }
      } catch (e) {
        skipped.push([rec.file_name, e && e.message ? e.message : String(e)]);
      }
    }
    if (!merged.length) throw new Error('没有可合并的文件：' + (skipped[0] ? skipped[0][1] : '请检查输入文件'));
    const bytes = await out.save();
    return { blob: bytesToBlob(bytes, 'application/pdf'), merged, skipped };
  }
  /** 浏览器无法原地改名：把重命名副本与说明打包成 ZIP 供下载。 */
  async function billRenamedZip(plan, report) {
    const entries = [{ name: '00_重命名说明.txt', blob: billTextBlob(report) }];
    for (const p of plan) entries.push({ name: p.new_name, file: p.record.file });
    return billZipFiles(entries);
  }

  /* ---------------- Excel 序时簿号码导入 ---------------- */
  function billCellText(v) {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    return String(v).replace(/\u3000/g, ' ').trim();
  }
  function billIsInvoiceLike(text) {
    if (!text || text.length > 40 || BILL_SKIP_WORDS.has(text)) return false;
    if ((text.match(/\d/g) || []).length < 4) return false;
    return /^[0-9A-Za-z\- ]+$/.test(text);
  }
  function billColumnLetter(i) {
    let s = '', n = i + 1;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
    return s;
  }
  async function billReadOrderSheets(file) {
    const name = String(file.name || '').toLowerCase();
    if (/\.(xlsx|xlsm)$/.test(name)) return parseXlsxFile(file);
    if (/\.(csv|txt)$/.test(name)) {
      const text = await file.text();
      const grid = text.split(/\r?\n/).map(line => line.split(/[,\t;，]/).map(s => s.trim()));
      return [{ name: baseName(file.name), grid }];
    }
    if (/\.xls$/.test(name)) {
      // BIFF8 的共享字符串常以压缩 Latin-1 保存，直接按首次出现顺序提取长数字串，
      // 与 xlrd 读出的列顺序一致；无需引入额外的 OLE2/BIFF 解析依赖。
      const bytes = new Uint8Array(await file.arrayBuffer());
      const chunks = [];
      for (let i = 0; i < bytes.length; i += 8192) {
        chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
      }
      const latin = chunks.join('');
      let utf16 = '';
      try { utf16 = new TextDecoder('utf-16le').decode(bytes); } catch (e) { /* ignore */ }
      const collect = pattern => {
        const found = [];
        const seen = new Set();
        for (const source of [latin, utf16]) {
          for (const m of source.matchAll(pattern)) {
            const v = m[1];
            if (!seen.has(v)) { seen.add(v); found.push(v); }
          }
        }
        return found;
      };
      // 先严格匹配 20 位数电票号码，避免账号 / 税号混入；没有时再放宽位数
      const found = collect(/(?<!\d)(\d{20})(?!\d)/g);
      const loose = found.length ? found : collect(/(?<!\d)(\d{18,24})(?!\d)/g);
      if (!loose.length) throw new Error('未在该 .xls 文件中找到发票号码（可另存为 .xlsx 后重试）');
      return [{ name: '序时簿（二进制提取）', grid: [['发票号码']].concat(loose.map(v => [v])) }];
    }
    throw new Error('仅支持 .xlsx / .xls / .xlsm / .csv / .txt 序时簿文件');
  }
  function billScanOrderCandidates(sheets, preferredLength) {
    let pref = parseInt(preferredLength, 10);
    if (!Number.isFinite(pref) || pref < 4 || pref > 40) pref = 20;
    const candidates = [];
    for (const sheet of sheets || []) {
      const rows = sheet.grid || [];
      const columnCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
      for (let col = 0; col < Math.min(columnCount, 120); col++) {
        let header = '', headerRow = -1, weight = 0, fallback = '', fallbackRow = -1;
        for (let r = 0; r < Math.min(20, rows.length); r++) {
          const text = billCellText(rows[r][col]);
          if (!text) continue;
          if (fallbackRow < 0 && !billIsInvoiceLike(text) && text.length <= 40) { fallback = text; fallbackRow = r; }
          for (const [kw, w] of BILL_HEADER_KEYWORDS) {
            if (text.includes(kw)) { if (w > weight) { weight = w; header = text; headerRow = r; } break; }
          }
        }
        if (!weight && fallbackRow >= 0) { header = fallback; headerRow = fallbackRow; }
        const values = [];
        const seen = new Set();
        for (let r = Math.max(0, headerRow + 1); r < rows.length; r++) {
          const text = billCellText(rows[r][col]);
          if (!billIsInvoiceLike(text) || seen.has(text)) continue;
          seen.add(text); values.push(text);
        }
        if (!values.length) continue;
        if (headerRow < 0) header = billColumnLetter(col) + ' 列（无表头）';
        const lengths = new Map();
        for (const v of values) {
          const len = (v.match(/\d/g) || []).length;
          lengths.set(len, (lengths.get(len) || 0) + 1);
        }
        let dominant = 0, dominantCount = 0;
        for (const [len, count] of lengths) if (count > dominantCount) { dominant = len; dominantCount = count; }
        const ratio = dominantCount / values.length;
        const lengthMatch = dominant === pref;
        const score = lengthMatch
          ? 1000000 + (weight >= 85 ? 500000 : weight * 10) + Math.min(values.length, 999) * 1000 + Math.round(ratio * 100)
          : weight * 1000 + Math.min(values.length, 999);
        candidates.push({
          sheet: sheet.name, column: col, header, header_row: headerRow, count: values.length,
          keyword: weight > 0, length: dominant, length_ratio: ratio, length_match: lengthMatch, score,
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score || b.count - a.count || a.sheet.localeCompare(b.sheet) || a.column - b.column);
    const list = candidates.slice(0, 40);
    let suggested = -1;
    if (list.some(c => c.length_match)) suggested = 0;
    else {
      const i = list.findIndex(c => c.keyword);
      if (i >= 0) suggested = i;
    }
    return { candidates: list, suggested, preferred_length: pref };
  }
  function billReadOrderNumbers(sheets, candidate) {
    const sheet = (sheets || []).find(s => s.name === candidate.sheet);
    if (!sheet) return [];
    const grid = sheet.grid || [];
    const start = Math.max(0, (candidate.header_row || -1) + 1);
    const numbers = [], seen = new Set();
    for (let r = start; r < grid.length; r++) {
      const text = billCellText(grid[r][candidate.column]);
      if (!billIsInvoiceLike(text) || seen.has(text)) continue;
      seen.add(text); numbers.push(text);
      if (numbers.length >= 5000) break;
    }
    return numbers;
  }
  async function billImportOrder(file, preferredLength) {
    const sheets = await billReadOrderSheets(file);
    const scan = billScanOrderCandidates(sheets, preferredLength);
    const selected = scan.suggested >= 0 ? scan.candidates[scan.suggested] : null;
    const numbers = selected ? billReadOrderNumbers(sheets, selected) : [];
    return {
      file_name: file.name, sheets: sheets.map(s => s.name), candidates: scan.candidates,
      selected, numbers, preferred_length: scan.preferred_length,
    };
  }
  async function billResolveOrder(ctx, records, mode) {
    const file = ctx.get('orderFile');
    if (file && typeof file.arrayBuffer === 'function') {
      const imported = await billImportOrder(file, billPreferredLength(records));
      if (imported.numbers.length) {
        return { text: imported.numbers.join('\n'), mode: 'custom', source: imported, warning: '' };
      }
      return {
        text: ctx.get('customOrder') || '', mode, source: imported,
        warning: '序时簿未找到可用的发票号码列，已忽略该文件并按当前顺序处理',
      };
    }
    return { text: ctx.get('customOrder') || '', mode, source: null, warning: '' };
  }
  /* ============================================================
     5. 工具注册表（79 项办公常用功能）
     ============================================================ */
  const TOOLS = [
    /* ---------- PDF 处理 ---------- */
    {
      id: 'pdf-merge', name: 'PDF 合并', cat: 'pdf', icon: 'merge', minFiles: 2, accept: '.pdf',
      desc: '将多个 PDF 文件按顺序合并为一个文档，可拖拽排序。',
      keywords: '合并 merge 拼接 组合',
      options: [],
      async run(ctx) {
        const out = await PDFLib.PDFDocument.create();
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在合并第 ${i + 1}/${ctx.files.length} 个文件…`);
          const src = await loadPdfDoc(ctx.files[i]);
          if (i === 0) copyDocumentMetadata(out, src);
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach(p => out.addPage(p));
        }
        const bytes = await out.save();
        return [{ name: 'PDF合并结果.pdf', blob: bytesToBlob(bytes, 'application/pdf') }];
      }
    },
    {
      id: 'pdf-split', name: 'PDF 拆分', cat: 'pdf', icon: 'split', minFiles: 1, single: true, accept: '.pdf',
      desc: '按页面范围、每一页或奇偶页将 PDF 拆分为多个文件。',
      keywords: '拆分 split 分割 分开',
      options: [
        { key: 'mode', type: 'select', label: '拆分方式', def: 'each', choices: [['each', '每一页生成一个 PDF'], ['ranges', '按多组范围拆分'], ['oddeven', '奇偶页分成两个 PDF']] },
        { key: 'groups', type: 'text', label: '范围分组', def: '1-3; 4-6', placeholder: '用分号分隔，如：1-3; 4-6; 7', hint: '如 1-3; 4-6', requiredWhen: { mode: 'ranges' }, visibleWhen: { mode: 'ranges' } },
      ],
      async run(ctx) {
        const file = ctx.files[0];
        const out = [];
        const src = await loadPdfDoc(file);
        const total = src.getPageCount();
        const base = baseName(file.name);
        const mode = ctx.get('mode');

        const copyRange = async (indices, name) => {
          const doc = await PDFLib.PDFDocument.create();
          const pages = await doc.copyPages(src, indices);
          pages.forEach(p => doc.addPage(p));
          out.push({ name, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        };

        if (mode === 'each') {
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在拆分第 ${i + 1}/${total} 页…`);
            await copyRange([i], `${base}_第${i + 1}页.pdf`);
          }
        } else if (mode === 'oddeven') {
          const odd = [], even = [];
          for (let i = 0; i < total; i++) (i % 2 === 0 ? odd : even).push(i);
          ctx.progress(1, 2, '正在提取奇数页…');
          if (odd.length) await copyRange(odd, `${base}_奇数页.pdf`);
          ctx.progress(2, 2, '正在提取偶数页…');
          if (even.length) await copyRange(even, `${base}_偶数页.pdf`);
        } else {
          const groups = parseRangeGroups(ctx.get('groups'), total);
          if (!groups.length) throw new Error('请输入有效的范围分组');
          for (let i = 0; i < groups.length; i++) {
            ctx.progress(i, groups.length, `正在拆分第 ${i + 1}/${groups.length} 组…`);
            await copyRange(groups[i].map(p => p - 1), `${base}_第${i + 1}部分.pdf`);
          }
        }
        return out;
      }
    },
    {
      id: 'pdf-pages', name: '页面提取 / 删除', cat: 'pdf', icon: 'pages', minFiles: 1, accept: '.pdf',
      desc: '按页面范围提取指定页面，或删除指定页面生成新 PDF。',
      keywords: '页面 提取 删除 抽取 裁页',
      options: [
        { key: 'mode', type: 'select', label: '操作方式', def: 'extract', choices: [['extract', '提取选中页面'], ['delete', '删除选中页面']] },
        { key: 'range', type: 'text', label: '页面范围', def: '1-3', placeholder: '如：1-3, 5, 8' },
      ],
      async run(ctx) {
        const out = [];
        const mode = ctx.get('mode');
        for (let fi = 0; fi < ctx.files.length; fi++) {
          const file = ctx.files[fi];
          ctx.progress(fi, ctx.files.length, `正在处理 ${file.name}…`);
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const selected = parsePageRanges(ctx.get('range'), total);
          const indices = (mode === 'extract')
            ? selected.map(p => p - 1)
            : Array.from({ length: total }, (_, i) => i).filter(i => !selected.includes(i + 1));
          if (!indices.length) throw new Error(`结果为空，请检查页面范围（共 ${total} 页）`);
          const doc = await PDFLib.PDFDocument.create();
          const pages = await doc.copyPages(src, indices);
          pages.forEach(p => doc.addPage(p));
          const suffix = mode === 'extract' ? '提取' : '删除后';
          out.push({ name: `${baseName(file.name)}_${suffix}.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-rotate', name: 'PDF 旋转', cat: 'pdf', icon: 'rotate', minFiles: 1, accept: '.pdf',
      desc: '对全部或指定页面进行旋转，支持 90°/180°/270°。',
      keywords: '旋转 rotate 转向 翻转',
      options: [
        { key: 'angle', type: 'select', label: '旋转角度', def: '90', choices: [['90', '顺时针 90°'], ['180', '180°'], ['270', '逆时针 90°']] },
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
      ],
      async run(ctx) {
        const out = [];
        const angle = parseInt(ctx.get('angle'), 10);
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          const pages = parsePageRanges(ctx.get('range'), total);
          pages.forEach(p => {
            const page = doc.getPage(p - 1);
            const cur = page.getRotation().angle || 0;
            page.setRotation(PDFLib.degrees((cur + angle) % 360));
          });
          out.push({ name: `${baseName(file.name)}_旋转${angle}度.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-pagenum', name: '添加页码', cat: 'pdf', icon: 'hash', minFiles: 1, accept: '.pdf',
      desc: '为 PDF 页面添加页码，支持位置、起始编号与自定义格式。',
      keywords: '页码 编号 pagenumber 打码',
      options: [
        { key: 'position', type: 'select', label: '页码位置', def: 'bottom-center', choices: [['bottom-center', '底部居中'], ['bottom-right', '底部右侧'], ['bottom-left', '底部左侧'], ['top-center', '顶部居中'], ['top-right', '顶部右侧']] },
        { key: 'template', type: 'text', label: '页码格式', def: '第 {n} 页 / 共 {total} 页', placeholder: '{n}=当前页 {total}=总页数' },
        { key: 'start', type: 'number', label: '起始页码', def: 1, min: 0 },
        { key: 'fontPx', type: 'number', label: '字号 (px)', def: 28, min: 10, max: 120 },
        { key: 'color', type: 'color', label: '文字颜色', def: '#333333' },
      ],
      async run(ctx) {
        const out = [];
        const tpl = ctx.get('template') || '{n}';
        const startRaw = parseInt(ctx.get('start'), 10);
        const start = Number.isFinite(startRaw) ? Math.max(0, startRaw) : 1;
        const fontPx = parseInt(ctx.get('fontPx'), 10) || 28;
        const color = ctx.get('color') || '#333333';
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在添加页码 ${i + 1}/${total}…`);
            const page = doc.getPage(i);
            const { width, height } = page.getSize();
            const text = tpl.replace(/\{n\}/g, String(start + i)).replace(/\{total\}/g, String(total));
            const cv = makeTextImage(text, { fontPx, color, bold: false });
            const png = await canvasToBlob(cv, 'image/png');
            const img = await doc.embedPng(await png.arrayBuffer());
            const scale = 0.75; // px -> pt
            const w = cv.width * scale, h = cv.height * scale;
            const margin = 18;
            const pos = ctx.get('position') || 'bottom-center';
            let x = (width - w) / 2, y = margin;
            if (pos.endsWith('right')) x = width - w - margin;
            if (pos.endsWith('left')) x = margin;
            if (pos.startsWith('top')) y = height - h - margin;
            page.drawImage(img, { x, y, width: w, height: h, opacity: 0.9 });
          }
          out.push({ name: `${baseName(file.name)}_页码版.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-textwm', name: '文字水印', cat: 'pdf', icon: 'droplet', minFiles: 1, accept: '.pdf',
      desc: '为 PDF 添加文字水印，支持平铺或居中、角度与透明度。',
      keywords: '水印 watermark 文字 标记',
      options: [
        { key: 'text', type: 'text', label: '水印文字', def: '内部资料', placeholder: '输入水印内容' },
        { key: 'mode', type: 'select', label: '排列方式', def: 'tile', choices: [['tile', '斜向平铺'], ['center', '页面居中']] },
        { key: 'angle', type: 'number', label: '倾斜角度', def: 30, min: -90, max: 90 },
        { key: 'fontPx', type: 'number', label: '字号 (px)', def: 48, min: 12, max: 200 },
        { key: 'opacity', type: 'number', label: '透明度 (0.05-1)', def: 0.15, min: 0.05, max: 1, step: 0.05 },
        { key: 'color', type: 'color', label: '水印颜色', def: '#888888' },
      ],
      async run(ctx) {
        const out = [];
        const text = ctx.get('text');
        if (!text || !text.trim()) throw new Error('请输入水印文字');
        const fontPx = parseInt(ctx.get('fontPx'), 10) || 48;
        const angle = parseFloat(ctx.get('angle')) || 0;
        const opacity = Math.min(1, Math.max(0.05, parseFloat(ctx.get('opacity')) || 0.15));
        const color = ctx.get('color') || '#888888';
        const cv = makeTextImage(text, { fontPx, angle, color });
        const png = await canvasToBlob(cv, 'image/png');
        const bytes = await png.arrayBuffer();
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          const img = await doc.embedPng(bytes);
          const scale = 0.75;
          const w = cv.width * scale, h = cv.height * scale;
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在添加水印 ${i + 1}/${total}…`);
            const page = doc.getPage(i);
            const { width, height } = page.getSize();
            if (ctx.get('mode') === 'center') {
              page.drawImage(img, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h, opacity });
            } else {
              const stepX = w * 1.6, stepY = h * 2.2;
              for (let y = -h; y < height + h; y += stepY) {
                for (let x = -w; x < width + w; x += stepX) {
                  page.drawImage(img, { x, y, width: w, height: h, opacity });
                }
              }
            }
          }
          out.push({ name: `${baseName(file.name)}_水印版.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-imgwm', name: '图片水印 / 骑缝章', cat: 'pdf', icon: 'stamp', minFiles: 1, accept: '.pdf',
      desc: '将印章 / Logo 盖到 PDF 页面，支持骑缝章。',
      keywords: '骑缝章 印章 盖章 图片水印 logo',
      options: [
        { key: 'seal', type: 'file', label: '水印图片', accept: IMAGE_ACCEPT, required: true, hint: `支持 ${IMAGE_FORMAT_LABEL}，PNG 透明底印章效果最佳` },
        { key: 'mode', type: 'select', label: '盖章方式', def: 'seal', choices: [['seal', '骑缝章（每页盖一条竖切片）'], ['center', '页面居中'], ['tile', '斜向平铺'], ['corner', '右下角']] },
        { key: 'widthPct', type: 'number', label: '宽度占页宽 %', def: 30, min: 2, max: 100 },
        { key: 'opacity', type: 'number', label: '透明度 (0.1-1)', def: 1, min: 0.1, max: 1, step: 0.1 },
      ],
      async run(ctx) {
        const sealFile = ctx.get('seal');
        if (!sealFile) throw new Error('请先选择水印图片');
        const mode = ctx.get('mode');
        const widthPct = Math.min(100, Math.max(2, parseFloat(ctx.get('widthPct')) || 30)) / 100;
        const opacity = Math.min(1, Math.max(0.1, parseFloat(ctx.get('opacity')) || 1));
        const sealCanvas = await imageFileToCanvas(sealFile);
        const out = [];
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          // 骑缝章：把图片竖切成 total 条
          const slices = [];
          if (mode === 'seal') {
            const sliceW = sealCanvas.width / total;
            for (let i = 0; i < total; i++) {
              const cv = document.createElement('canvas');
              cv.width = Math.ceil(sliceW);
              cv.height = sealCanvas.height;
              cv.getContext('2d').drawImage(sealCanvas, i * sliceW, 0, sliceW, sealCanvas.height, 0, 0, cv.width, cv.height);
              slices.push(cv);
            }
          } else {
            slices.push(sealCanvas);
          }
          const embeds = [];
          for (const cv of slices) {
            const blob = await canvasToBlob(cv, 'image/png');
            embeds.push(await doc.embedPng(await blob.arrayBuffer()));
          }
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在盖章 ${i + 1}/${total}…`);
            const page = doc.getPage(i);
            const { width, height } = page.getSize();
            const draw = (img, iw, ih, x, y) => page.drawImage(img, { x, y, width: iw, height: ih, opacity });
            if (mode === 'seal') {
              const img = embeds[i];
              const iw = width * widthPct * (1 / Math.max(1, total * 0.25));
              const ih = iw * (slices[i].height / slices[i].width);
              // 盖在右边缘，一半压在页面外（骑缝效果）
              draw(img, iw, ih, width - iw * 0.55, (height - ih) / 2);
            } else {
              const img = embeds[0];
              const iw = width * widthPct;
              const ih = iw * (sealCanvas.height / sealCanvas.width);
              if (mode === 'center') draw(img, iw, ih, (width - iw) / 2, (height - ih) / 2);
              else if (mode === 'corner') draw(img, iw, ih, width - iw - 20, 20);
              else {
                const stepX = iw * 2.2, stepY = ih * 2.6;
                for (let y = -ih; y < height + ih; y += stepY)
                  for (let x = -iw; x < width + iw; x += stepX)
                    draw(img, iw, ih, x, y);
              }
            }
          }
          out.push({ name: `${baseName(file.name)}_盖章版.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-compress', name: 'PDF 压缩', cat: 'pdf', icon: 'compress', minFiles: 1, accept: '.pdf',
      desc: '压缩 PDF 体积，适合扫描件。',
      keywords: '压缩 compress 减小 瘦身',
      options: [
        { key: 'level', type: 'select', label: '压缩强度', def: 'medium', choices: [['light', '轻度（清晰优先）'], ['medium', '中度（均衡）'], ['heavy', '深度（体积优先）']] },
      ],
      async run(ctx) {
        const cfgs = {
          light: { scale: 1.6, quality: 0.82 },
          medium: { scale: 1.2, quality: 0.62 },
          heavy: { scale: 0.85, quality: 0.42 },
        };
        const cfg = cfgs[ctx.get('level')] || cfgs.medium;
        const out = [];
        for (const file of ctx.files) {
          const pdfjsDoc = await loadPdfjsDoc(file);
          const total = pdfjsDoc.numPages;
          const doc = await PDFLib.PDFDocument.create();
          for (let i = 1; i <= total; i++) {
            ctx.progress(i - 1, total, `正在压缩第 ${i}/${total} 页…`);
            const p1 = await pdfjsDoc.getPage(i);
            const pt = p1.getViewport({ scale: 1 });
            const cv = await renderPageToCanvas(pdfjsDoc, i, cfg.scale, false);
            const jpg = await canvasToBlob(cv, 'image/jpeg', cfg.quality);
            const img = await doc.embedJpg(await jpg.arrayBuffer());
            const page = doc.addPage([pt.width, pt.height]);
            page.drawImage(img, { x: 0, y: 0, width: pt.width, height: pt.height });
          }
          const blob = bytesToBlob(await doc.save(), 'application/pdf');
          const changePct = Math.round((1 - blob.size / file.size) * 100);
          out.push({
            name: `${baseName(file.name)}_压缩.pdf`,
            blob,
            meta: `${formatBytes(file.size)} → ${formatBytes(blob.size)}（${changePct >= 0 ? '省' : '增'} ${Math.abs(changePct)}%）`
          });
        }
        return out;
      }
    },
    {
      id: 'pdf-blank', name: '空白页检测', cat: 'pdf', icon: 'scan', minFiles: 1, accept: '.pdf',
      desc: '检测并移除扫描件中的空白页。',
      keywords: '空白页 检测 扫描 去空白',
      options: [
        { key: 'threshold', type: 'number', label: '判定阈值（墨迹占比 %）', def: 0.15, min: 0.02, max: 5, step: 0.05 },
        { key: 'mode', type: 'select', label: '输出方式', def: 'remove', choices: [['remove', '生成移除空白页的 PDF'], ['report', '仅输出检测报告']] },
      ],
      async run(ctx) {
        const threshold = Math.max(0.02, parseFloat(ctx.get('threshold')) || 0.15) / 100;
        const out = [];
        for (const file of ctx.files) {
          const pdfjsDoc = await loadPdfjsDoc(file);
          const total = pdfjsDoc.numPages;
          const blankPages = [];
          for (let i = 1; i <= total; i++) {
            ctx.progress(i - 1, total, `正在检测第 ${i}/${total} 页…`);
            const cv = await renderPageToCanvas(pdfjsDoc, i, 0.25, false);
            const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            let ink = 0;
            const pixels = cv.width * cv.height;
            for (let p = 0; p < data.length; p += 16) { // 抽样
              if (data[p] < 235 || data[p + 1] < 235 || data[p + 2] < 235) ink++;
            }
            const ratio = (ink * 4) / pixels;
            if (ratio < threshold) blankPages.push(i);
          }
          const report = `《${file.name}》空白页检测报告\n总页数：${total}\n阈值：${(threshold * 100).toFixed(2)}%\n空白页：${blankPages.length ? blankPages.join(', ') : '无'}\n`;
          out.push({ name: `${baseName(file.name)}_空白页报告.txt`, blob: new Blob([report], { type: 'text/plain' }) });
          if (ctx.get('mode') === 'remove' && blankPages.length) {
            const src = await loadPdfDoc(file);
            const keep = Array.from({ length: total }, (_, i) => i).filter(i => !blankPages.includes(i + 1));
            if (keep.length) {
              const doc = await PDFLib.PDFDocument.create();
              const pages = await doc.copyPages(src, keep);
              pages.forEach(p => doc.addPage(p));
              out.push({ name: `${baseName(file.name)}_去空白页.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
            }
          }
        }
        return out;
      }
    },
    {
      id: 'pdf-spread', name: '对开页拆分', cat: 'pdf', icon: 'spread', minFiles: 1, accept: '.pdf',
      desc: '将横向对开的扫描页一分为二，还原为单页 PDF。',
      keywords: '对开 拆页 跨页 spread 扫描',
      options: [
        { key: 'direction', type: 'select', label: '拆分方向', def: 'auto', choices: [['auto', '自动（按横竖判断）'], ['lr', '左右拆分'], ['tb', '上下拆分']] },
      ],
      async run(ctx) {
        const out = [];
        const dir = ctx.get('direction');
        for (const file of ctx.files) {
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const doc = await PDFLib.PDFDocument.create();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在拆分第 ${i + 1}/${total} 页…`);
            const [sp] = await doc.copyPages(src, [i]);
            const { width, height } = sp.getSize();
            const isLandscape = width > height;
            const doLR = dir === 'lr' || (dir === 'auto' && isLandscape);
            if (doLR) {
              const half = width / 2;
              doc.addPage([half, height]).drawPage(await doc.embedPage(sp, { left: 0, bottom: 0, right: half, top: height }), { x: 0, y: 0, width: half, height });
              doc.addPage([half, height]).drawPage(await doc.embedPage(sp, { left: half, bottom: 0, right: width, top: height }), { x: 0, y: 0, width: half, height });
            } else {
              const half = height / 2;
              doc.addPage([width, half]).drawPage(await doc.embedPage(sp, { left: 0, bottom: half, right: width, top: height }), { x: 0, y: 0, width, height: half });
              doc.addPage([width, half]).drawPage(await doc.embedPage(sp, { left: 0, bottom: 0, right: width, top: half }), { x: 0, y: 0, width, height: half });
            }
          }
          out.push({ name: `${baseName(file.name)}_对开拆分.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-nup', name: '多页拼版', cat: 'pdf', icon: 'grid', minFiles: 1, accept: '.pdf',
      desc: '将多页缩印拼合到一页。',
      keywords: '拼版 缩印 nup 合并页 打印',
      options: [
        { key: 'layout', type: 'select', label: '版式', def: '2', choices: [['2', '每张 2 页（上下）'], ['4', '每张 4 页（2×2）']] },
        { key: 'gap', type: 'number', label: '页间距 (pt)', def: 8, min: 0, max: 60 }],
      async run(ctx) {
        const out = [];
        const per = parseInt(ctx.get('layout'), 10) === 4 ? 4 : 2;
        const gap = Math.max(0, parseFloat(ctx.get('gap')) || 0);
        for (const file of ctx.files) {
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const doc = await PDFLib.PDFDocument.create();
          const srcSize = src.getPage(0).getSize();
          const cols = per === 4 ? 2 : 1;
          const rows = per === 4 ? 2 : 2;
          for (let i = 0; i < total; i += per) {
            ctx.progress(i, total, `正在拼版 ${Math.min(i + per, total)}/${total}…`);
            const page = doc.addPage([srcSize.width, srcSize.height]);
            const cellW = (srcSize.width - gap * (cols + 1)) / cols;
            const cellH = (srcSize.height - gap * (rows + 1)) / rows;
            for (let k = 0; k < per && i + k < total; k++) {
              const [sp] = await doc.copyPages(src, [i + k]);
              const ep = await doc.embedPage(sp);
              const c = k % cols, r = Math.floor(k / cols);
              const x = gap + c * (cellW + gap);
              const y = srcSize.height - gap - (r + 1) * cellH - r * gap;
              page.drawPage(ep, { x, y, width: cellW, height: cellH });
            }
          }
          out.push({ name: `${baseName(file.name)}_${per}合1.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },

    /* ---------- PDF 转换 ---------- */
    {
      id: 'pdf-to-img', name: 'PDF 转图片', cat: 'pdf', icon: 'pdf2img', minFiles: 1, accept: '.pdf',
      desc: '将 PDF 页面导出为 PNG / JPG 等图片。',
      keywords: 'PDF转图片 转PNG 转JPG 转BMP 转TIFF 导出图片',
      options: [
        { key: 'format', type: 'select', label: '输出格式', def: 'png', choices: [['png', 'PNG（无损）'], ['jpeg', 'JPG（体积小）'], ['webp', 'WebP'], ['bmp', 'BMP'], ['tiff', 'TIFF']] },
        { key: 'dpi', type: 'select', label: '渲染分辨率', def: '150', choices: [['72', '72 DPI（快速预览）'], ['150', '150 DPI（推荐）'], ['300', '300 DPI（高清打印）']] },
        { key: 'quality', type: 'number', label: 'JPG/WebP 质量 (1-100)', def: 90, min: 10, max: 100 },
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
        { key: 'transparent', type: 'checkbox', label: 'PNG 保留透明背景', def: false },
      ],
      async run(ctx) {
        const out = [];
        const scale = (parseInt(ctx.get('dpi'), 10) || 150) / 72;
        const format = ctx.get('format') || 'png';
        const quality = (parseInt(ctx.get('quality'), 10) || 90) / 100;
        const transparent = format === 'png' && ctx.get('transparent');
        for (const file of ctx.files) {
          const pdfDoc = await loadPdfjsDoc(file);
          const pages = parsePageRanges(ctx.get('range'), pdfDoc.numPages);
          for (let k = 0; k < pages.length; k++) {
            ctx.progress(k, pages.length, `正在渲染 ${file.name} 第 ${pages[k]} 页…`);
            const cv = await renderPageToCanvas(pdfDoc, pages[k], scale, transparent);
            let blob, ext;
            if (format === 'bmp') {
              blob = bytesToBlob(canvasToBmpBytes(cv), 'image/bmp');
              ext = 'bmp';
            } else if (format === 'tiff') {
              blob = bytesToBlob(canvasToTiffBytes(cv), 'image/tiff');
              ext = 'tiff';
            } else {
              const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
              blob = await canvasToBlob(cv, mime, quality);
              ext = format === 'jpeg' ? 'jpg' : format;
            }
            out.push({
              name: `${baseName(file.name)}_第${pages[k]}页.${ext}`,
              blob,
              meta: `${cv.width} × ${cv.height} px`
            });
          }
        }
        return out;
      }
    },
    {
      id: 'img-to-pdf', name: '图片转 PDF', cat: 'img', icon: 'img2pdf', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '将多张图片合并为 PDF，支持 A4 排版。',
      keywords: '图片转PDF JPG转PDF PNG转PDF 合成PDF',
      options: [
        { key: 'size', type: 'select', label: '页面尺寸', def: 'a4', choices: [['a4', 'A4（图片自适应居中）'], ['fit', '与图片同尺寸']] },
        { key: 'margin', type: 'number', label: '页边距 (pt)', def: 24, min: 0, max: 150 },
      ],
      async run(ctx) {
        const doc = await PDFLib.PDFDocument.create();
        const useA4 = ctx.get('size') !== 'fit';
        const margin = Math.max(0, parseFloat(ctx.get('margin')) || 0);
        const A4 = [595.28, 841.89];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在转换 ${i + 1}/${ctx.files.length}…`);
          const file = ctx.files[i];
          const img = await embedImageFile(doc, file);
          const iw = img.width, ih = img.height;
          const pw = useA4 ? A4[0] : iw + margin * 2;
          const ph = useA4 ? A4[1] : ih + margin * 2;
          const page = doc.addPage([pw, ph]);
          const availW = pw - margin * 2, availH = ph - margin * 2;
          const s = Math.min(availW / iw, availH / ih, 1);
          const w = iw * s, h = ih * s;
          page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        }
        return [{ name: '图片转PDF结果.pdf', blob: bytesToBlob(await doc.save(), 'application/pdf') }];
      }
    },
    {
      id: 'pdf-to-text', name: 'PDF 提取文字', cat: 'pdf', icon: 'text', minFiles: 1, accept: '.pdf',
      desc: '提取 PDF 文本并导出为 TXT。',
      keywords: '提取文字 文本 txt 复制 抽字',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在提取 ${file.name} 的文字…`);
          const lines = await extractPdfLines(file);
          const text = lines
            .map(l => /^--- 第 \d+ 页 ---$/.test(l) ? '' : l)
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
          ctx.progress(1, 1, `已提取 ${file.name} 的文字`);
          out.push({ name: `${baseName(file.name)}.txt`, blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) });
        }
        return out;
      }
    },
    {
      id: 'pdf-meta', name: '文档信息修改', cat: 'pdf', icon: 'info', minFiles: 1, accept: '.pdf',
      desc: '查看并修改 PDF 的标题、作者、主题等文档属性。',
      keywords: '属性 元数据 标题 作者 meta',
      options: [
        { key: 'title', type: 'text', label: '标题', def: '', placeholder: '留空保持不变' },
        { key: 'author', type: 'text', label: '作者', def: '', placeholder: '留空保持不变' },
        { key: 'subject', type: 'text', label: '主题', def: '', placeholder: '留空保持不变' },
        { key: 'keywords', type: 'text', label: '关键词', def: '', placeholder: '逗号分隔' },
      ],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const title = ctx.get('title'), author = ctx.get('author');
          const subject = ctx.get('subject'), keywords = ctx.get('keywords');
          if (title) doc.setTitle(title);
          if (author) doc.setAuthor(author);
          if (subject) doc.setSubject(subject);
          if (keywords) doc.setKeywords(keywords.split(/[,，]/).map(s => s.trim()).filter(Boolean));
          doc.setModificationDate(new Date());
          out.push({ name: `${baseName(file.name)}_信息修改.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },

    /* ---------- 图片工具 ---------- */
    {
      id: 'img-convert', name: '图片格式转换', cat: 'img', icon: 'convert', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '在 JPG / PNG / WebP / AVIF 等格式间转换。',
      keywords: '格式转换 png jpg webp avif bmp tiff 转换',
      options: [
        {
          key: 'format', type: 'select', label: '目标格式', def: 'png',
          // AVIF 编码支持依浏览器而定，不支持时不展示该选项
          choices: [['png', 'PNG（无损）'], ['jpeg', 'JPG'], ['webp', 'WebP']]
            .concat(imageExportSupported('avif') ? [['avif', 'AVIF']] : [])
            .concat([['bmp', 'BMP'], ['tiff', 'TIFF']])
        },
        { key: 'quality', type: 'number', label: 'JPG/WebP 质量 (1-100)', def: 92, min: 10, max: 100 },
      ],
      async run(ctx) {
        const format = ctx.get('format') || 'png';
        const quality = (parseInt(ctx.get('quality'), 10) || 92) / 100;
        const needWhiteBg = format === 'jpeg' || format === 'bmp' || format === 'tiff';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在转换 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const source = needWhiteBg ? flattenCanvasOnWhite(cv) : cv;
          const blob = await canvasToImageBlob(source, format, quality);
          out.push({ name: `${baseName(ctx.files[i].name)}.${imageOutputExt(format)}`, blob });
        }
        return out;
      }
    },
    {
      id: 'img-compress', name: '图片压缩', cat: 'img', icon: 'compress', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '压缩图片体积，可调质量与尺寸。',
      keywords: '图片压缩 减小 压缩 quality 尺寸 宽高',
      options: [
        { key: 'quality', type: 'number', label: '输出质量 (1-100)', def: 75, min: 10, max: 100 },
        { key: 'maxWidth', type: 'number', label: '最大宽度 (px)', def: 1920, min: 0, max: 10000, hint: '0 表示不限制宽度' },
        { key: 'maxHeight', type: 'number', label: '最大高度 (px)', def: 0, min: 0, max: 10000, hint: '0 表示不限制高度；宽高同时限制时等比缩小到两者之内' },
        { key: 'format', type: 'select', label: '输出格式', def: 'jpeg', choices: [['jpeg', 'JPG'], ['webp', 'WebP'], ['png', 'PNG']] },
        { key: 'keepExif', type: 'checkbox', label: '保留 EXIF', def: false, hint: '保留拍摄时间等元数据' },
      ],
      async run(ctx) {
        const quality = (parseInt(ctx.get('quality'), 10) || 75) / 100;
        const readLimit = (v, def) => {
          const n = parseInt(v, 10);
          return Number.isFinite(n) && n >= 0 ? n : def;
        };
        const maxWidth = readLimit(ctx.get('maxWidth'), 1920);
        const maxHeight = readLimit(ctx.get('maxHeight'), 0);
        const format = ctx.get('format');
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在压缩 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const scaleW = maxWidth > 0 ? maxWidth / cv.width : 1;
          const scaleH = maxHeight > 0 ? maxHeight / cv.height : 1;
          const scale = Math.min(1, scaleW, scaleH);
          let source = cv;
          if (scale < 1) {
            const scaled = document.createElement('canvas');
            scaled.width = Math.max(1, Math.round(cv.width * scale));
            scaled.height = Math.max(1, Math.round(cv.height * scale));
            scaled.getContext('2d').drawImage(cv, 0, 0, scaled.width, scaled.height);
            source = scaled;
          }
          // JPG 不支持透明，统一压到白底
          if (format === 'jpeg') source = flattenCanvasOnWhite(source);
          let blob = await canvasToImageBlob(source, format, quality);
          let note = '';
          // 保留 EXIF：把原始 JPEG 的 APP1 段原样搬到新文件，方向标记重置为 1
          if (ctx.get('keepExif') && format === 'jpeg') {
            try {
              const original = new Uint8Array(await ctx.files[i].arrayBuffer());
              const seg = jpegExifSegment(original);
              if (seg) {
                const merged = jpegWithExif(new Uint8Array(await blob.arrayBuffer()), resetExifOrientation(seg));
                blob = new Blob([merged], { type: 'image/jpeg' });
                note = ' · 已保留 EXIF';
              }
            } catch (e) { /* 元数据搬运失败时保持无元数据输出 */ }
          }
          const ext = format === 'jpeg' ? 'jpg' : format;
          out.push({
            name: `${baseName(ctx.files[i].name)}_压缩.${ext}`,
            blob,
            meta: `${formatBytes(ctx.files[i].size)} → ${formatBytes(blob.size)} · ${source.width} × ${source.height} px${note}`
          });
        }
        return out;
      },
      /* 按当前参数真实跑一遍首个文件，给出与正式输出一致的体积预估 */
      async estimate(ctx) {
        if (!ctx.files.length) return '选择文件后显示预计大小';
        const file = ctx.files[0];
        const results = await this.run({ files: [file], get: ctx.get, progress: () => {} });
        const blob = results && results[0] && results[0].blob;
        if (!blob || !blob.size) return '无法预估';
        const pct = file.size ? Math.round((blob.size - file.size) / file.size * 100) : 0;
        const trend = Math.abs(pct) < 1
          ? '体积基本不变'
          : (pct > 0 ? `体积增加约 ${pct}%` : `体积减少约 ${-pct}%`);
        const note = ctx.files.length > 1 ? '，按第 1 个文件估算' : '';
        return `${formatBytes(file.size)} → 约 ${formatBytes(blob.size)}（${trend}${note}）`;
      }
    },
    {
      id: 'img-resize', name: '图片缩放', cat: 'img', icon: 'resize', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按百分比或宽度等比缩放图片。',
      keywords: '缩放 resize 尺寸 大小 改尺寸',
      options: [
        { key: 'mode', type: 'select', label: '缩放方式', def: 'percent', choices: [['percent', '按百分比'], ['width', '按目标宽度'], ['height', '按目标高度']] },
        { key: 'value', type: 'number', label: '数值', def: 50, min: 1, max: 10000 },
      ],
      async run(ctx) {
        const mode = ctx.get('mode');
        const value = Math.max(1, parseFloat(ctx.get('value')) || 50);
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在缩放 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          let w, h;
          if (mode === 'percent') { w = cv.width * value / 100; h = cv.height * value / 100; }
          else if (mode === 'width') { w = value; h = cv.height * (value / cv.width); }
          else { h = value; w = cv.width * (value / cv.height); }
          const scaled = document.createElement('canvas');
          scaled.width = Math.max(1, Math.round(w));
          scaled.height = Math.max(1, Math.round(h));
          scaled.getContext('2d').drawImage(cv, 0, 0, scaled.width, scaled.height);
          const blob = await canvasToBlob(scaled, 'image/png');
          out.push({ name: `${baseName(ctx.files[i].name)}_缩放.png`, blob, meta: `${scaled.width} × ${scaled.height} px` });
        }
        return out;
      }
    },
    {
      id: 'img-rotate', name: '图片旋转 / 翻转', cat: 'img', icon: 'flip', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '旋转或翻转图片。',
      keywords: '旋转 翻转 rotate flip 转方向',
      options: [
        { key: 'angle', type: 'select', label: '旋转角度', def: '90', choices: [['0', '不旋转'], ['90', '顺时针 90°'], ['180', '180°'], ['270', '逆时针 90°']] },
        { key: 'flipH', type: 'checkbox', label: '水平翻转', def: false },
        { key: 'flipV', type: 'checkbox', label: '垂直翻转', def: false },
      ],
      async run(ctx) {
        const angle = parseInt(ctx.get('angle'), 10) || 0;
        const flipH = ctx.get('flipH'), flipV = ctx.get('flipV');
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在处理 ${i + 1}/${ctx.files.length}…`);
          const src = await imageFileToCanvas(ctx.files[i]);
          const swap = angle === 90 || angle === 270;
          const cv = document.createElement('canvas');
          cv.width = swap ? src.height : src.width;
          cv.height = swap ? src.width : src.height;
          const c = cv.getContext('2d');
          c.translate(cv.width / 2, cv.height / 2);
          c.rotate(angle * Math.PI / 180);
          c.scale(flipH ? -1 : 1, flipV ? -1 : 1);
          c.drawImage(src, -src.width / 2, -src.height / 2);
          const blob = await canvasToBlob(cv, 'image/png');
          out.push({ name: `${baseName(ctx.files[i].name)}_旋转.png`, blob });
        }
        return out;
      }
    },
    {
      id: 'img-watermark', name: '图片加水印', cat: 'img', icon: 'droplet', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '为图片添加文字或 Logo 水印，支持平铺。',
      keywords: '图片水印 watermark 加水印 logo 标记 版权',
      options: [
        { key: 'wmType', type: 'select', label: '水印类型', def: 'text', choices: [['text', '文字水印'], ['image', '图片水印（Logo / 印章）']] },
        { key: 'text', type: 'text', label: '水印文字', def: '仅供内部使用', requiredWhen: { wmType: 'text' }, visibleWhen: { wmType: 'text' } },
        { key: 'logo', type: 'file', label: 'Logo 图片', accept: IMAGE_ACCEPT, requiredWhen: { wmType: 'image' }, visibleWhen: { wmType: 'image' }, hint: '建议使用透明背景 PNG' },
        { key: 'mode', type: 'select', label: '排列方式', def: 'tile', choices: [['tile', '斜向平铺'], ['corner', '右下角']] },
        { key: 'opacity', type: 'number', label: '文字透明度 (0.05-1)', def: 0.25, min: 0.05, max: 1, step: 0.05, visibleWhen: { wmType: 'text' } },
        { key: 'fontPct', type: 'number', label: '字号占图宽 %', def: 5, min: 1, max: 30, visibleWhen: { wmType: 'text' }, advanced: true },
        { key: 'color', type: 'color', label: '水印颜色', def: '#ffffff', visibleWhen: { wmType: 'text' }, advanced: true },
        { key: 'logoScale', type: 'number', label: 'Logo 占图宽 %', def: 20, min: 3, max: 100, visibleWhen: { wmType: 'image' } },
        { key: 'logoOpacity', type: 'number', label: 'Logo 透明度 (0.05-1)', def: 0.4, min: 0.05, max: 1, step: 0.05, visibleWhen: { wmType: 'image' }, advanced: true },
      ],
      async run(ctx) {
        const wmType = ctx.get('wmType') || 'text';
        const text = ctx.get('text') || '';
        const opacity = Math.min(1, Math.max(0.05, parseFloat(ctx.get('opacity')) || 0.25));
        const fontPct = Math.max(1, parseFloat(ctx.get('fontPct')) || 5) / 100;
        const color = ctx.get('color') || '#ffffff';
        const mode = ctx.get('mode');
        let logo = null;
        let logoScale = 0.2, logoOpacity = 0.4;
        if (wmType === 'image') {
          const logoFile = ctx.get('logo');
          if (!logoFile) throw new Error('请选择作为水印的 Logo 图片');
          logo = await imageFileToCanvas(logoFile);
          logoScale = Math.max(3, Math.min(100, parseFloat(ctx.get('logoScale')) || 20)) / 100;
          logoOpacity = Math.min(1, Math.max(0.05, parseFloat(ctx.get('logoOpacity')) || 0.4));
        } else if (!text.trim()) {
          throw new Error('请输入水印文字');
        }
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在添加水印 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const c = cv.getContext('2d');
          const fontPx = Math.max(12, Math.round(cv.width * fontPct));
          if (logo) {
            const lw = Math.max(8, Math.round(cv.width * logoScale));
            const lh = Math.max(1, Math.round(logo.height * lw / logo.width));
            c.globalAlpha = logoOpacity;
            if (mode === 'corner') {
              c.drawImage(logo, cv.width - lw - fontPx * 0.3, cv.height - lh - fontPx * 0.3, lw, lh);
            } else {
              c.translate(cv.width / 2, cv.height / 2);
              c.rotate(-Math.PI / 9);
              const stepX = lw * 1.7, stepY = lh * 2.2;
              for (let y = -cv.height; y < cv.height * 2; y += stepY)
                for (let x = -cv.width; x < cv.width * 2; x += stepX)
                  c.drawImage(logo, x - lw / 2, y - lh / 2, lw, lh);
            }
          } else {
            c.font = `bold ${fontPx}px "Microsoft YaHei", sans-serif`;
            c.fillStyle = color;
            c.globalAlpha = opacity;
            if (mode === 'corner') {
              c.textAlign = 'right';
              c.textBaseline = 'bottom';
              c.fillText(text, cv.width - fontPx * 0.5, cv.height - fontPx * 0.5);
            } else {
              c.textAlign = 'center';
              c.textBaseline = 'middle';
              c.translate(cv.width / 2, cv.height / 2);
              c.rotate(-Math.PI / 9);
              const stepX = fontPx * text.length * 1.9;
              const stepY = fontPx * 3;
              for (let y = -cv.height; y < cv.height * 2; y += stepY)
                for (let x = -cv.width; x < cv.width * 2; x += stepX)
                  c.fillText(text, x, y);
            }
          }
          c.globalAlpha = 1;
          const blob = await canvasToBlob(cv, 'image/png');
          out.push({ name: `${baseName(ctx.files[i].name)}_水印.png`, blob });
        }
        return out;
      }
    },
    {
      id: 'img-merge', name: '图片拼接', cat: 'img', icon: 'layers', minFiles: 2, accept: IMAGE_ACCEPT,
      desc: '将多张图片拼成长图或九宫格。',
      keywords: '拼接 长图 合并图片 宫格 九宫格 拼图 stitch',
      options: [
        { key: 'direction', type: 'select', label: '拼接方向', def: 'vertical', choices: [['vertical', '纵向（上下）'], ['horizontal', '横向（左右）'], ['grid', '宫格拼图']] },
        { key: 'gap', type: 'number', label: '间距 (px)', def: 0, min: 0, max: 200 },
        { key: 'bg', type: 'color', label: '背景颜色', def: '#ffffff' },
        { key: 'cols', type: 'number', label: '宫格列数', def: 2, min: 1, max: 20, hint: '仅「宫格拼图」时生效' },
        { key: 'cellFit', type: 'select', label: '单元格适配', def: 'contain', choices: [['contain', '完整显示（留白）'], ['cover', '填满裁剪']], hint: '仅「宫格拼图」时生效' },
      ],
      async run(ctx) {
        const direction = ctx.get('direction') || 'vertical';
        const vertical = direction !== 'horizontal';
        const gap = Math.max(0, parseInt(ctx.get('gap'), 10) || 0);
        const bg = ctx.get('bg') || '#ffffff';
        const canvases = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在加载 ${i + 1}/${ctx.files.length}…`);
          canvases.push(await imageFileToCanvas(ctx.files[i]));
        }
        const cv = document.createElement('canvas');
        if (direction === 'grid') {
          const cols = Math.max(1, Math.min(20, parseInt(ctx.get('cols'), 10) || 2));
          const rows = Math.ceil(canvases.length / cols);
          const cellW = Math.max(...canvases.map(c => c.width));
          const cellH = Math.max(...canvases.map(c => c.height));
          cv.width = cols * cellW + gap * (cols - 1);
          cv.height = rows * cellH + gap * (rows - 1);
          const c = cv.getContext('2d');
          c.fillStyle = bg;
          c.fillRect(0, 0, cv.width, cv.height);
          const cover = ctx.get('cellFit') === 'cover';
          canvases.forEach((item, idx) => {
            const scale = cover
              ? Math.max(cellW / item.width, cellH / item.height)
              : Math.min(cellW / item.width, cellH / item.height);
            const w = item.width * scale, h = item.height * scale;
            const left = (idx % cols) * (cellW + gap);
            const top = Math.floor(idx / cols) * (cellH + gap);
            c.drawImage(item, left + (cellW - w) / 2, top + (cellH - h) / 2, w, h);
          });
        } else if (vertical) {
          cv.width = Math.max(...canvases.map(c => c.width));
          cv.height = canvases.reduce((s, c) => s + c.height, 0) + gap * (canvases.length - 1);
        } else {
          cv.height = Math.max(...canvases.map(c => c.height));
          cv.width = canvases.reduce((s, c) => s + c.width, 0) + gap * (canvases.length - 1);
        }
        if (direction !== 'grid') {
          const c = cv.getContext('2d');
          c.fillStyle = bg;
          c.fillRect(0, 0, cv.width, cv.height);
          let pos = 0;
          for (const item of canvases) {
            const x = vertical ? (cv.width - item.width) / 2 : pos;
            const y = vertical ? pos : (cv.height - item.height) / 2;
            c.drawImage(item, x, y);
            pos += (vertical ? item.height : item.width) + gap;
          }
        }
        ctx.progress(1, 1, '拼接完成');
        const blob = await canvasToBlob(cv, 'image/png');
        return [{ name: '图片拼接结果.png', blob, meta: `${cv.width} × ${cv.height} px` }];
      }
    },

    /* ---------- 借鉴 Stirling-PDF：页面排版 ---------- */
    {
      id: 'img-crop', name: '图片裁剪', cat: 'img', icon: 'crop', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按比例、像素区域或去除白边裁剪图片。',
      keywords: '裁剪 crop 剪切 比例 方形 1:1 去白边 切边',
      options: [
        { key: 'mode', type: 'select', label: '裁剪方式', def: 'ratio', section: '裁剪范围', choices: [['ratio', '按固定比例'], ['rect', '自定义像素区域'], ['trim', '自动去除纯色边距']] },
        { key: 'ratio', type: 'select', label: '目标比例', def: '1:1', visibleWhen: { mode: 'ratio' }, choices: [['1:1', '1:1 正方形'], ['4:3', '4:3 横向'], ['3:4', '3:4 竖向'], ['16:9', '16:9 宽屏'], ['9:16', '9:16 竖屏'], ['3:2', '3:2 横向'], ['2:3', '2:3 竖向'], ['5:4', '5:4']] },
        { key: 'anchor', type: 'select', label: '裁剪位置', def: 'center', visibleWhen: { mode: 'ratio' }, choices: [['center', '居中'], ['top', '靠上'], ['bottom', '靠下'], ['left', '靠左'], ['right', '靠右'], ['top-left', '左上角'], ['top-right', '右上角'], ['bottom-left', '左下角'], ['bottom-right', '右下角']] },
        { key: 'rect', type: 'text', label: '像素区域', def: '', requiredWhen: { mode: 'rect' }, visibleWhen: { mode: 'rect' }, placeholder: '例如 100,50,800,600', hint: '格式：x,y,宽,高（px）' },
        { key: 'tolerance', type: 'number', label: '去边容差 (0-100)', def: 10, min: 0, max: 100, visibleWhen: { mode: 'trim' }, hint: '判断「与边角同色」的宽松程度' },
        { key: 'sides', type: 'select', label: '去边方向', def: 'all', visibleWhen: { mode: 'trim' }, choices: [['all', '四边'], ['vertical', '仅上下'], ['horizontal', '仅左右']] },
        { key: 'format', type: 'select', label: '输出格式', def: 'png', section: '输出', choices: [['png', 'PNG（保留透明）'], ['jpeg', 'JPG'], ['webp', 'WebP']] },
      ],
      async run(ctx) {
        const mode = ctx.get('mode') || 'ratio';
        const anchor = ctx.get('anchor') || 'center';
        const format = ctx.get('format') || 'png';
        const quality = 0.92;
        let rect = null;
        if (mode === 'rect') {
          const nums = String(ctx.get('rect') || '').split(/[,，\s]+/).map(v => parseInt(v, 10));
          if (nums.length !== 4 || nums.some(n => !Number.isFinite(n))) {
            throw new Error('自定义裁剪需要填写「x,y,宽,高」四个数字，例如 100,50,800,600');
          }
          rect = { x: nums[0], y: nums[1], w: nums[2], h: nums[3] };
          if (rect.w <= 0 || rect.h <= 0) throw new Error('裁剪区域的宽高必须大于 0');
        }
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在裁剪 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          let box;
          if (mode === 'trim') {
            box = trimCanvasBounds(cv, ctx.get('tolerance'), ctx.get('sides'));
          } else if (mode === 'rect') {
            const x = Math.max(0, Math.min(cv.width - 1, rect.x));
            const y = Math.max(0, Math.min(cv.height - 1, rect.y));
            box = {
              x, y,
              w: Math.min(rect.w, cv.width - x),
              h: Math.min(rect.h, cv.height - y),
            };
          } else {
            const parts = String(ctx.get('ratio') || '1:1').split(':').map(v => parseFloat(v) || 1);
            const ratio = parts[0] / (parts[1] || 1);
            let cw = cv.width, ch = Math.round(cv.width / ratio);
            if (ch > cv.height) { ch = cv.height; cw = Math.round(cv.height * ratio); }
            cw = Math.max(1, Math.min(cv.width, cw));
            ch = Math.max(1, Math.min(cv.height, ch));
            const dx = cv.width - cw, dy = cv.height - ch;
            const x = anchor.indexOf('left') >= 0 ? 0 : (anchor.indexOf('right') >= 0 ? dx : dx / 2);
            const y = anchor.indexOf('top') >= 0 ? 0 : (anchor.indexOf('bottom') >= 0 ? dy : dy / 2);
            box = { x: Math.round(x), y: Math.round(y), w: cw, h: ch };
          }
          const cvOut = document.createElement('canvas');
          cvOut.width = box.w;
          cvOut.height = box.h;
          cvOut.getContext('2d').drawImage(cv, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
          const source = format === 'jpeg' ? flattenCanvasOnWhite(cvOut) : cvOut;
          const blob = await canvasToImageBlob(source, format, quality);
          out.push({
            name: `${baseName(ctx.files[i].name)}_裁剪.${imageOutputExt(format)}`,
            blob,
            meta: `${cv.width} × ${cv.height} → ${box.w} × ${box.h} px`,
          });
        }
        return out;
      }
    },
    {
      id: 'img-split', name: '图片分割', cat: 'img', icon: 'grid', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按行列或尺寸切分图片，支持长图、九宫格。',
      keywords: '分割 切分 切片 九宫格 网格 split 切开',
      options: [
        { key: 'mode', type: 'select', label: '分割方式', def: 'grid', choices: [['grid', '按行列等分'], ['size', '按固定尺寸切块']] },
        { key: 'rows', type: 'number', label: '纵向等分份数', def: 2, min: 1, max: 20 },
        { key: 'cols', type: 'number', label: '横向等分份数', def: 2, min: 1, max: 20 },
        { key: 'tileW', type: 'number', label: '切块宽度 (px)', def: 1080, min: 10, max: 20000, hint: '仅「按固定尺寸」时生效' },
        { key: 'tileH', type: 'number', label: '切块高度 (px)', def: 1080, min: 10, max: 20000, hint: '仅「按固定尺寸」时生效' },
      ],
      async run(ctx) {
        const mode = ctx.get('mode') || 'grid';
        const rows = Math.max(1, Math.min(20, parseInt(ctx.get('rows'), 10) || 1));
        const cols = Math.max(1, Math.min(20, parseInt(ctx.get('cols'), 10) || 1));
        const tileW = Math.max(10, parseInt(ctx.get('tileW'), 10) || 1080);
        const tileH = Math.max(10, parseInt(ctx.get('tileH'), 10) || 1080);
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在分割 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const boxes = [];
          if (mode === 'size') {
            for (let y = 0; y < cv.height; y += tileH) {
              for (let x = 0; x < cv.width; x += tileW) {
                boxes.push({ x, y, w: Math.min(tileW, cv.width - x), h: Math.min(tileH, cv.height - y) });
              }
            }
          } else {
            for (let r = 0; r < rows; r++) {
              const y = Math.round(cv.height * r / rows);
              const h = Math.round(cv.height * (r + 1) / rows) - y;
              for (let c = 0; c < cols; c++) {
                const x = Math.round(cv.width * c / cols);
                const w = Math.round(cv.width * (c + 1) / cols) - x;
                if (w > 0 && h > 0) boxes.push({ x, y, w, h, r: r + 1, c: c + 1 });
              }
            }
          }
          if (!boxes.length) throw new Error('分割份数超出画面尺寸，请调小份数或切块尺寸');
          if (boxes.length > 400) throw new Error(`本次会生成 ${boxes.length} 张图片，超过 400 张上限，请调大等分尺寸`);
          for (let idx = 0; idx < boxes.length; idx++) {
            const box = boxes[idx];
            const part = document.createElement('canvas');
            part.width = box.w;
            part.height = box.h;
            part.getContext('2d').drawImage(cv, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
            const label = box.r ? `_r${box.r}c${box.c}` : `_${String(idx + 1).padStart(2, '0')}`;
            const blob = await canvasToBlob(part, 'image/png');
            out.push({
              name: `${baseName(ctx.files[i].name)}${label}.png`,
              blob,
              meta: `${box.w} × ${box.h} px（${box.x}, ${box.y}）`,
            });
          }
        }
        ctx.progress(1, 1, `分割完成，共 ${out.length} 张`);
        return out;
      }
    },
    {
      id: 'img-editor', name: '照片编辑器', cat: 'img', icon: 'wand', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '调整亮度、对比度、滤镜与锐化等效果。',
      keywords: '编辑 修图 滤镜 亮度 对比度 饱和度 色相 锐化 暗角 调色',
      options: [
        {
          key: 'preset', type: 'select', label: '预设滤镜', def: 'none',
          choices: [
            ['none', '不使用（仅按下方参数调色）'], ['grayscale', '黑白'], ['sepia', '褐调'],
            ['vintage', '复古'], ['warm', '暖色'], ['cool', '冷色'],
            ['punch', '高对比'], ['fade', '褪色胶片'],
          ],
        },
        { key: 'brightness', type: 'number', label: '亮度 (-100 ~ 100)', def: 0, min: -100, max: 100 },
        { key: 'contrast', type: 'number', label: '对比度 (-100 ~ 100)', def: 0, min: -100, max: 100 },
        { key: 'saturation', type: 'number', label: '饱和度 (-100 ~ 100)', def: 0, min: -100, max: 100 },
        { key: 'hue', type: 'number', label: '色相偏移 (-180 ~ 180°)', def: 0, min: -180, max: 180 },
        { key: 'blur', type: 'number', label: '模糊半径 (px)', def: 0, min: 0, max: 20, step: 0.5 },
        {
          key: 'sharpen', type: 'select', label: '锐化强度', def: '0',
          choices: [['0', '不锐化'], ['45', '轻度'], ['70', '标准'], ['100', '强']],
        },
        { key: 'vignette', type: 'checkbox', label: '暗角', def: false, hint: '四周压暗，突出画面中心' },
        { key: 'format', type: 'select', label: '输出格式', def: 'jpeg', choices: [['jpeg', 'JPG'], ['png', 'PNG（保留透明）'], ['webp', 'WebP']] },
      ],
      async run(ctx) {
        const presets = {
          none: '', grayscale: 'grayscale(1)', sepia: 'sepia(0.85)',
          vintage: 'sepia(0.35) saturate(1.2) contrast(1.05)',
          warm: 'sepia(0.2) saturate(1.25) hue-rotate(-8deg)',
          cool: 'hue-rotate(12deg) saturate(1.1)',
          punch: 'contrast(1.35) saturate(1.15)',
          fade: 'contrast(0.9) brightness(1.08) saturate(0.85)',
        };
        const num = (key, def) => {
          const v = parseFloat(ctx.get(key));
          return Number.isFinite(v) ? v : def;
        };
        const brightness = 100 + num('brightness', 0);
        const contrast = 100 + num('contrast', 0);
        const saturation = 100 + num('saturation', 0);
        const hue = num('hue', 0);
        const blur = Math.max(0, num('blur', 0));
        const sharpen = Math.max(0, Math.min(100, num('sharpen', 0)));
        const vignette = !!ctx.get('vignette');
        const format = ctx.get('format') || 'jpeg';
        const filters = [
          presets[ctx.get('preset')] || '',
          `brightness(${Math.max(0, brightness)}%)`,
          `contrast(${Math.max(0, contrast)}%)`,
          `saturate(${Math.max(0, saturation)}%)`,
        ];
        if (hue) filters.push(`hue-rotate(${hue}deg)`);
        if (blur) filters.push(`blur(${blur}px)`);
        const filterStr = filters.filter(Boolean).join(' ');
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在调色 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const edited = document.createElement('canvas');
          edited.width = cv.width;
          edited.height = cv.height;
          const c = edited.getContext('2d');
          c.filter = filterStr;
          c.drawImage(cv, 0, 0);
          c.filter = 'none';
          if (sharpen > 0) sharpenCanvas(edited, sharpen);
          if (vignette) {
            const grad = c.createRadialGradient(
              edited.width / 2, edited.height / 2, Math.min(edited.width, edited.height) * 0.25,
              edited.width / 2, edited.height / 2, Math.max(edited.width, edited.height) * 0.72
            );
            grad.addColorStop(0, 'rgba(0,0,0,0)');
            grad.addColorStop(1, 'rgba(0,0,0,0.55)');
            c.fillStyle = grad;
            c.fillRect(0, 0, edited.width, edited.height);
          }
          const source = format === 'jpeg' ? flattenCanvasOnWhite(edited) : edited;
          const blob = await canvasToImageBlob(source, format, 0.92);
          out.push({
            name: `${baseName(ctx.files[i].name)}_编辑.${imageOutputExt(format)}`,
            blob,
            meta: `${edited.width} × ${edited.height} px`,
          });
        }
        return out;
      }
    },
    {
      id: 'img-meme', name: '表情包生成器', cat: 'img', icon: 'text', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '给图片加配文，快速做表情包。',
      keywords: '表情包 meme 配文 文字 图片加字 上排 下排 梗图',
      options: [
        { key: 'top', type: 'text', label: '上排文字', def: '', placeholder: '例如：当我说要早睡' },
        { key: 'bottom', type: 'text', label: '下排文字', def: '', placeholder: '例如：结果刷到凌晨三点' },
        { key: 'fontPct', type: 'number', label: '字号占图宽 %', def: 9, min: 3, max: 25 },
        { key: 'color', type: 'color', label: '文字颜色', def: '#ffffff' },
        { key: 'strokeColor', type: 'color', label: '描边颜色', def: '#000000' },
        { key: 'strokePct', type: 'number', label: '描边粗细 (% 字号)', def: 7, min: 0, max: 25 },
      ],
      async run(ctx) {
        const top = String(ctx.get('top') || '').trim();
        const bottom = String(ctx.get('bottom') || '').trim();
        if (!top && !bottom) throw new Error('请至少填写上排或下排文字');
        const fontPct = Math.max(3, Math.min(25, parseFloat(ctx.get('fontPct')) || 9)) / 100;
        const color = ctx.get('color') || '#ffffff';
        const strokeColor = ctx.get('strokeColor') || '#000000';
        const strokePct = Math.max(0, Math.min(25, parseFloat(ctx.get('strokePct')) || 0)) / 100;
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在添加文字 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const c = cv.getContext('2d');
          const fontPx = Math.max(12, Math.round(cv.width * fontPct));
          const lineH = fontPx * 1.18;
          const strokeW = fontPx * strokePct;
          c.font = `bold ${fontPx}px "Microsoft YaHei", "PingFang SC", Impact, sans-serif`;
          c.textAlign = 'center';
          c.textBaseline = 'top';
          c.lineJoin = 'round';
          c.miterLimit = 2;
          const maxW = Math.max(fontPx * 2, cv.width - fontPx * 0.6);
          const paint = (lines, startY) => {
            lines.forEach((line, idx) => {
              const y = startY + idx * lineH;
              if (strokeW > 0) {
                c.lineWidth = strokeW;
                c.strokeStyle = strokeColor;
                c.strokeText(line, cv.width / 2, y);
              }
              c.fillStyle = color;
              c.fillText(line, cv.width / 2, y);
            });
          };
          const topLines = top ? wrapTextLines(c, top, maxW) : [];
          const bottomLines = bottom ? wrapTextLines(c, bottom, maxW) : [];
          if (topLines.length) paint(topLines, fontPx * 0.4);
          if (bottomLines.length) {
            paint(bottomLines, cv.height - bottomLines.length * lineH - fontPx * 0.4);
          }
          const blob = await canvasToBlob(cv, 'image/png');
          out.push({
            name: `${baseName(ctx.files[i].name)}_表情包.png`,
            blob,
            meta: `${cv.width} × ${cv.height} px`,
          });
        }
        return out;
      }
    },
    {
      id: 'img-upscale', name: '图片放大增强', cat: 'img', icon: 'resize', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按 1.5–4 倍放大图片并锐化。',
      keywords: '放大 无损放大 提升清晰度 upscale 变大 2倍 4倍 增强',
      options: [
        { key: 'scale', type: 'select', label: '放大倍数', def: '2', choices: [['1.5', '1.5 倍'], ['2', '2 倍'], ['3', '3 倍'], ['4', '4 倍']] },
        {
          key: 'sharpen', type: 'select', label: '锐化强度', def: '80',
          choices: [['0', '不锐化（仅放大）'], ['50', '轻度'], ['80', '标准'], ['100', '强']],
        },
        { key: 'format', type: 'select', label: '输出格式', def: 'png', choices: [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']] },
      ],
      async run(ctx) {
        const scale = Math.max(1, parseFloat(ctx.get('scale')) || 2);
        const sharpen = Math.max(0, Math.min(100, parseFloat(ctx.get('sharpen')) || 0));
        const format = ctx.get('format') || 'png';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在放大 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const targetW = Math.round(cv.width * scale);
          const targetH = Math.round(cv.height * scale);
          if (targetW * targetH > 80000000) {
            throw new Error(`放大后为 ${targetW} × ${targetH} px，超过 8000 万像素上限，请降低倍数或先缩小原图`);
          }
          const up = resizedCanvas(cv, targetW, targetH);
          if (sharpen > 0) sharpenCanvas(up, sharpen);
          const source = format === 'jpeg' ? flattenCanvasOnWhite(up) : up;
          const blob = await canvasToImageBlob(source, format, 0.92);
          const tag = Number.isInteger(scale) ? String(scale) : String(scale).replace('.', 'x');
          out.push({
            name: `${baseName(ctx.files[i].name)}_放大${tag}倍.${imageOutputExt(format)}`,
            blob,
            meta: `${cv.width} × ${cv.height} → ${targetW} × ${targetH} px`,
          });
        }
        return out;
      }
    },
    {
      id: 'img-remove-bg', name: '图片抠图（纯色背景）', cat: 'img', icon: 'eraser', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '去除纯色背景，输出透明 PNG，适合证件照。',
      keywords: '抠图 去背景 透明 去白底 remove background 去底色',
      options: [
        { key: 'mode', type: 'select', label: '取色方式', def: 'edge', choices: [['edge', '取四角背景色（推荐）'], ['color', '指定颜色']] },
        { key: 'color', type: 'color', label: '要移除的颜色', def: '#ffffff', hint: '仅在「指定颜色」时生效' },
        { key: 'tolerance', type: 'number', label: '容差 (0-100)', def: 18, min: 0, max: 100, hint: '数值越大，判定为背景的范围越宽松' },
        { key: 'feather', type: 'number', label: '边缘羽化 (px)', def: 1, min: 0, max: 5, hint: '让抠图边缘过渡自然，避免出现硬锯齿' },
      ],
      async run(ctx) {
        const mode = ctx.get('mode') || 'edge';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在抠图 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          let result;
          try {
            result = removeFlatBackground(cv, {
              mode,
              color: ctx.get('color'),
              tolerance: ctx.get('tolerance'),
              feather: ctx.get('feather'),
            });
          } catch (e) {
            throw new Error(`${ctx.files[i].name}：${e && e.message ? e.message : '抠图失败'}`);
          }
          const blob = await canvasToBlob(result.canvas, 'image/png');
          out.push({
            name: `${baseName(ctx.files[i].name)}_透明背景.png`,
            blob,
            meta: `去除 ${Math.round(result.ratio * 100)}% 像素 · ${result.canvas.width} × ${result.canvas.height} px`,
          });
        }
        return out;
      }
    },
    {
      id: 'img-exif', name: '图片 EXIF 信息', cat: 'img', icon: 'info', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '查看照片 EXIF 信息，或一键清除元数据。',
      keywords: 'exif 元数据 拍摄参数 gps 定位 清除信息 隐私',
      options: [
        { key: 'mode', type: 'select', label: '操作', def: 'report', choices: [['report', '查看 EXIF 信息'], ['strip', '清除元数据并另存']] },
        { key: 'format', type: 'select', label: '清除后的格式', def: 'jpeg', choices: [['jpeg', 'JPG'], ['png', 'PNG']], hint: '仅在「清除元数据」时生效' },
      ],
      async run(ctx) {
        const mode = ctx.get('mode') || 'report';
        const format = ctx.get('format') === 'png' ? 'png' : 'jpeg';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在解析 ${i + 1}/${ctx.files.length}…`);
          const file = ctx.files[i];
          const bytes = new Uint8Array(await file.arrayBuffer());
          const entries = readExifEntries(bytes);
          let cv = null;
          try { cv = await imageFileToCanvas(file); } catch (e) { cv = null; }
          if (mode === 'strip') {
            if (!cv) throw new Error('无法解码该图片，无法清除元数据：' + file.name);
            const source = format === 'jpeg' ? flattenCanvasOnWhite(cv) : cv;
            const blob = await canvasToImageBlob(source, format, 0.92);
            out.push({
              name: `${baseName(file.name)}_已清除元数据.${imageOutputExt(format)}`,
              blob,
              meta: '已重新编码，EXIF / GPS / 设备信息全部移除',
            });
            continue;
          }
          const lines = [];
          lines.push(`文件名：${file.name}`);
          lines.push(`文件大小：${formatBytes(file.size)}`);
          lines.push(`文件类型：${file.type || '未知'}`);
          lines.push(`图像尺寸：${cv ? `${cv.width} × ${cv.height} px` : '无法解码（格式不受支持）'}`);
          lines.push(`EXIF 信息：${entries.length ? `共 ${entries.length} 项` : '未检测到（可能已被清除或非拍摄原图）'}`);
          const sections = [['ifd0', '--- 图像信息 ---'], ['exif', '--- 拍摄参数 ---'], ['gps', '--- GPS 位置 ---']];
          for (const [group, title] of sections) {
            const list = exifReportLines(entries, group);
            if (list.length) {
              lines.push(title);
              for (const line of list) lines.push(line);
            }
          }
          out.push({
            name: `${baseName(file.name)}_EXIF.txt`,
            blob: new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }),
            meta: entries.length ? `${entries.length} 项 EXIF` : '无 EXIF',
          });
        }
        return out;
      }
    },
    {
      id: 'img-compress-size', name: '压缩到指定大小', cat: 'img', icon: 'compress', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按目标体积（KB）自动压缩图片。',
      keywords: '指定大小 压缩 kb 体积 限制 上传 小于',
      options: [
        { key: 'target', type: 'number', label: '目标大小 (KB)', def: 200, min: 5, max: 100000 },
        { key: 'format', type: 'select', label: '输出格式', def: 'jpeg', choices: [['jpeg', 'JPG'], ['webp', 'WebP']] },
      ],
      async run(ctx) {
        const targetKB = Math.max(5, parseInt(ctx.get('target'), 10) || 200);
        const targetBytes = targetKB * 1024;
        const format = ctx.get('format') === 'webp' ? 'webp' : 'jpeg';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在压缩 ${i + 1}/${ctx.files.length} 到 ${targetKB} KB…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const source = flattenCanvasOnWhite(cv);
          const res = await compressCanvasToTarget(source, targetBytes, format);
          const parts = [
            `${formatBytes(ctx.files[i].size)} → ${formatBytes(res.blob.size)}`,
            `质量 ${res.quality}`,
          ];
          if (res.scale < 0.999) {
            parts.push(`缩放至 ${Math.round(res.scale * 100)}%（${Math.round(source.width * res.scale)} × ${Math.round(source.height * res.scale)} px）`);
          }
          if (res.missed) parts.push('已取最小体积，仍未达到目标');
          out.push({
            name: `${baseName(ctx.files[i].name)}_目标${targetKB}KB.${imageOutputExt(format)}`,
            blob: res.blob,
            meta: parts.join(' · '),
          });
        }
        return out;
      }
    },
    {
      id: 'img-base64', name: '图片与 Base64 互转', cat: 'img', icon: 'convert',
      minFiles: 0, accept: IMAGE_ACCEPT + ',.txt,.b64',
      desc: '图片与 Base64 / Data URL 互转。',
      keywords: 'base64 dataurl 编码 解码 图片转文本 内嵌图片 html css',
      options: [
        { key: 'mode', type: 'select', label: '转换方向', def: 'to', choices: [['to', '图片 → Base64 文本'], ['from', 'Base64 文本 → 图片']] },
        { key: 'paste', type: 'textarea', label: 'Base64 / Data URL 文本', def: '', visibleWhen: { mode: 'from' }, placeholder: 'data:image/png;base64,iVBORw0KGgo…', hint: '可粘贴文本或选择 .txt 文件' },
        { key: 'dataUrl', type: 'checkbox', label: '输出 Data URL 前缀', def: true, visibleWhen: { mode: 'to' }, hint: '输出可直接用于网页的 Data URL' },
        { key: 'wrap', type: 'number', label: '每行字符数', def: 0, min: 0, max: 1000, visibleWhen: { mode: 'to' }, hint: '0 表示不换行', advanced: true },
        { key: 'format', type: 'select', label: '编码前先转换格式', def: 'keep', visibleWhen: { mode: 'to' }, advanced: true, choices: [['keep', '保持原始字节（不重压缩）'], ['png', '转为 PNG'], ['jpeg', '转为 JPG']] },
      ],
      validateOptions(opts, files) {
        if ((opts.mode || 'to') === 'from') {
          const hasText = String(opts.paste || '').trim() || files.some(f => /\.(txt|b64)$/i.test(f.name));
          return hasText ? '' : '请粘贴 Base64 文本，或选择一个 .txt / .b64 文件';
        }
        return files.length ? '' : '图片 → Base64 需要至少选择一张图片';
      },
      async run(ctx) {
        const mode = ctx.get('mode') || 'to';
        if (mode === 'from') {
          let text = String(ctx.get('paste') || '').trim();
          let source = '粘贴文本';
          if (!text) {
            const f = ctx.files.find(x => /\.(txt|b64)$/i.test(x.name));
            if (!f) throw new Error('请粘贴 Base64 文本，或选择一个保存了 Base64 的 .txt / .b64 文件');
            if (f.size > 30 * 1024 * 1024) throw new Error('文本文件过大（超过 30 MB）');
            text = (await f.text()).trim();
            source = f.name;
          }
          const bytes = base64ToBytes(text);
          const mime = detectImageMime(bytes);
          if (!mime) throw new Error('解码后的数据不是可识别的图片（支持 PNG / JPG / GIF / WebP / BMP / TIFF / ICO）');
          return [{
            name: `Base64解码图片.${imageMimeToExt(mime)}`,
            blob: bytesToBlob(bytes, mime),
            meta: `来源：${source} · ${formatBytes(bytes.length)}`,
          }];
        }
        if (!ctx.files.length) throw new Error('请先选择要编码的图片文件');
        const kind = ctx.get('format') || 'keep';
        const wrap = Math.max(0, parseInt(ctx.get('wrap'), 10) || 0);
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在编码 ${i + 1}/${ctx.files.length}…`);
          const f = ctx.files[i];
          let bytes, mime;
          if (kind === 'png' || kind === 'jpeg') {
            const cv = await imageFileToCanvas(f);
            const src = kind === 'jpeg' ? flattenCanvasOnWhite(cv) : cv;
            const blob = await canvasToBlob(src, kind === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92);
            bytes = new Uint8Array(await blob.arrayBuffer());
            mime = blob.type;
          } else {
            bytes = new Uint8Array(await f.arrayBuffer());
            mime = /^image\//.test(f.type) ? f.type : (detectImageMime(bytes) || 'application/octet-stream');
          }
          let b64 = bytesToBase64(bytes);
          if (wrap > 0) b64 = b64.replace(new RegExp(`(.{${wrap}})`, 'g'), '$1\n');
          const text = (ctx.get('dataUrl') ? `data:${mime};base64,` : '') + b64;
          out.push({
            name: `${baseName(f.name)}_base64.txt`,
            blob: new Blob([text], { type: 'text/plain;charset=utf-8' }),
            meta: `${formatBytes(f.size)} → ${formatBytes(text.length)} 文本`,
          });
        }
        return out;
      }
    },
    {
      id: 'img-rename', name: '图片批量重命名', cat: 'img', icon: 'tag', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按序号、原名、日期等模板批量重命名。',
      keywords: '重命名 批量改名 序号 前缀 归档 整理 rename',
      options: [
        { key: 'pattern', type: 'text', label: '命名模板', def: '{name}_{n}', hint: '占位符：{n} 序号、{name} 原名、{date} 日期、{w} 宽、{h} 高' },
        { key: 'start', type: 'number', label: '起始序号', def: 1, min: 0, max: 999999 },
        { key: 'digits', type: 'number', label: '序号位数（自动补零）', def: 2, min: 1, max: 8 },
        { key: 'extCase', type: 'select', label: '扩展名大小写', def: 'keep', choices: [['keep', '保持原样'], ['lower', '转小写'], ['upper', '转大写']] },
      ],
      async run(ctx) {
        const pattern = String(ctx.get('pattern') || '{name}_{n}');
        const start = Math.max(0, parseInt(ctx.get('start'), 10) || 0);
        const digits = Math.max(1, Math.min(8, parseInt(ctx.get('digits'), 10) || 2));
        const extCase = ctx.get('extCase') || 'keep';
        const now = new Date();
        const two = v => String(v).padStart(2, '0');
        const date = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`;
        const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
        const needSize = /\{w\}|\{h\}/.test(pattern);
        const seen = new Set();
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在命名 ${i + 1}/${ctx.files.length}…`);
          const f = ctx.files[i];
          let w = '', h = '';
          if (needSize) {
            try {
              const cv = await imageFileToCanvas(f);
              w = String(cv.width);
              h = String(cv.height);
            } catch (e) { /* 无法解码时留空 */ }
          }
          const rawExt = imageExtOf(f.name);
          const ext = extCase === 'lower' ? rawExt.toLowerCase() : (extCase === 'upper' ? rawExt.toUpperCase() : rawExt);
          const values = {
            n: String(start + i).padStart(digits, '0'),
            name: baseName(f.name), date, time, w, h, ext,
          };
          let stem = sanitizeFileName(pattern.replace(/\{(\w+)\}/g, (m, key) => values[key] != null ? values[key] : m)) || '图片';
          let name = ext ? `${stem}.${ext}` : stem;
          if (seen.has(name)) {
            let k = 2;
            while (seen.has(`${stem}(${k})${ext ? '.' + ext : ''}`)) k++;
            name = `${stem}(${k})${ext ? '.' + ext : ''}`;
          }
          seen.add(name);
          out.push({ name, blob: f, meta: `${f.name} → ${name}` });
        }
        return out;
      }
    },
    {
      id: 'img-info', name: '图片信息清单', cat: 'img', icon: 'info', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '查看图片尺寸、格式等信息，导出清单。',
      keywords: '图片信息 属性 尺寸 清单 csv 盘点 宽高 透明度',
      options: [
        { key: 'format', type: 'select', label: '清单格式', def: 'csv', choices: [['csv', 'CSV（Excel 可直接打开）'], ['txt', 'TXT 文本表格'], ['json', 'JSON']] },
      ],
      async run(ctx) {
        const headers = ['序号', '文件名', '格式', '宽(px)', '高(px)', '宽高比', '大小(B)', '大小', '含透明', 'EXIF项数'];
        const rows = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在读取 ${i + 1}/${ctx.files.length}…`);
          const f = ctx.files[i];
          const bytes = new Uint8Array(await f.arrayBuffer());
          let w = '', h = '', ratio = '', alpha = '未知';
          try {
            const cv = await imageFileToCanvas(f);
            w = cv.width;
            h = cv.height;
            ratio = (Math.round(w / h * 1000) / 1000).toFixed(3);
            const data = cv.getContext('2d').getImageData(0, 0, w, h).data;
            const step = Math.max(1, Math.floor(Math.sqrt(w * h) / 200)) * 4;
            let transparent = false;
            for (let p = 3; p < data.length; p += step) {
              if (data[p] < 255) { transparent = true; break; }
            }
            alpha = transparent ? '是' : '否';
          } catch (e) { /* 不支持解码的格式保留空值 */ }
          let exifCount = 0;
          try { exifCount = readExifEntries(bytes).length; } catch (e) { /* ignore */ }
          rows.push([
            i + 1, f.name, imageExtOf(f.name).toUpperCase() || (f.type || '未知'),
            w || '—', h || '—', ratio || '—', f.size, formatBytes(f.size), alpha, exifCount,
          ]);
        }
        const format = ctx.get('format') || 'csv';
        let blob, ext;
        if (format === 'json') {
          const list = rows.map(r => Object.fromEntries(headers.map((k, i) => [k, r[i]])));
          blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json;charset=utf-8' });
          ext = 'json';
        } else if (format === 'txt') {
          const lines = [headers.join(' | '), ...rows.map(r => r.map(String).join(' | '))];
          blob = new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
          ext = 'txt';
        } else {
          const lines = [headers, ...rows].map(r => r.map(csvCell).join(','));
          blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
          ext = 'csv';
        }
        return [{ name: `图片信息清单.${ext}`, blob, meta: `共 ${rows.length} 张图片` }];
      }
    },
    {
      id: 'img-dpi', name: '图片 DPI / 打印尺寸', cat: 'img', icon: 'resize', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '设置 JPG / PNG 的打印 DPI 与尺寸。',
      keywords: 'dpi ppi 分辨率 打印 300dpi 相纸 尺寸 pHYs',
      options: [
        { key: 'dpi', type: 'number', label: '目标 DPI', def: 300, min: 72, max: 1200, hint: '照片打印常用 300 DPI，屏幕用 72–96 DPI' },
        { key: 'format', type: 'select', label: '输出格式', def: 'keep', choices: [['keep', '保持 JPG / PNG 原像素（无损）'], ['jpeg', '统一转 JPG'], ['png', '统一转 PNG']] },
      ],
      async run(ctx) {
        const dpi = Math.max(1, Math.min(1200, parseInt(ctx.get('dpi'), 10) || 300));
        const format = ctx.get('format') || 'keep';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在写入 DPI ${i + 1}/${ctx.files.length}…`);
          const f = ctx.files[i];
          const bytes = new Uint8Array(await f.arrayBuffer());
          const mime = detectImageMime(bytes);
          let data, ext, outMime;
          if (format === 'keep' && mime === 'image/jpeg') {
            data = setJpegDpi(bytes, dpi); ext = 'jpg'; outMime = 'image/jpeg';
          } else if (format === 'keep' && mime === 'image/png') {
            data = setPngDpi(bytes, dpi); ext = 'png'; outMime = 'image/png';
          } else {
            const target = format === 'png' ? 'png' : 'jpeg';
            const cv = await imageFileToCanvas(f);
            const src = target === 'jpeg' ? flattenCanvasOnWhite(cv) : cv;
            const blob = await canvasToBlob(src, target === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92);
            const raw = new Uint8Array(await blob.arrayBuffer());
            data = target === 'png' ? setPngDpi(raw, dpi) : setJpegDpi(raw, dpi);
            ext = imageOutputExt(target);
            outMime = blob.type;
          }
          let dims = '';
          try {
            const cv = await imageFileToCanvas(f);
            dims = `${cv.width} × ${cv.height} px → ${(cv.width / dpi * 2.54).toFixed(1)} × ${(cv.height / dpi * 2.54).toFixed(1)} cm`;
          } catch (e) { dims = `${dpi} DPI`; }
          out.push({
            name: `${baseName(f.name)}_${dpi}dpi.${ext}`,
            blob: bytesToBlob(data, outMime),
            meta: dims,
          });
        }
        return out;
      }
    },
    {
      id: 'img-frame', name: '图片加边框 / 圆角', cat: 'img', icon: 'image', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '为图片加留白、边框、圆角或裁成头像。',
      keywords: '边框 圆角 留白 圆形头像 相框 描边 frame',
      options: [
        { key: 'pad', type: 'number', label: '四周留白 (px)', def: 24, min: 0, max: 2000 },
        { key: 'shape', type: 'select', label: '形状', def: 'none', choices: [['none', '矩形'], ['rounded', '圆角'], ['circle', '圆形（居中裁剪）']] },
        { key: 'radius', type: 'number', label: '圆角半径 (px)', def: 24, min: 1, max: 2000 },
        { key: 'border', type: 'number', label: '描边粗细 (px)', def: 0, min: 0, max: 200, hint: '0 表示不描边' },
        { key: 'borderColor', type: 'color', label: '描边颜色', def: '#333333' },
        { key: 'bg', type: 'color', label: '留白颜色', def: '#ffffff' },
        { key: 'transparentBg', type: 'checkbox', label: '透明', def: false, hint: '留白区域透明（仅 PNG / WebP 输出有效）' },
        { key: 'format', type: 'select', label: '输出格式', def: 'png', choices: [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']] },
      ],
      async run(ctx) {
        const opts = {
          pad: Math.max(0, parseInt(ctx.get('pad'), 10) || 0),
          shape: ctx.get('shape') || 'none',
          radius: Math.max(1, parseInt(ctx.get('radius'), 10) || 24),
          border: Math.max(0, parseInt(ctx.get('border'), 10) || 0),
          borderColor: ctx.get('borderColor') || '#333333',
          bg: ctx.get('bg') || '#ffffff',
          transparent: !!ctx.get('transparentBg'),
        };
        const format = ctx.get('format') || 'png';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在排版 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const framed = framedCanvas(cv, opts);
          const source = format === 'jpeg' ? flattenCanvasOnWhite(framed) : framed;
          const blob = await canvasToImageBlob(source, format, 0.92);
          out.push({
            name: `${baseName(ctx.files[i].name)}_加框.${imageOutputExt(format)}`,
            blob,
            meta: `${cv.width} × ${cv.height} → ${framed.width} × ${framed.height} px`,
          });
        }
        return out;
      }
    },
    {
      id: 'img-mask', name: '图片打码 / 马赛克', cat: 'img', icon: 'shield', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '对指定区域打码，遮盖敏感信息。',
      keywords: '打码 马赛克 遮挡 隐私 脱敏 模糊 涂黑 mosaic',
      options: [
        { key: 'rects', type: 'textarea', label: '打码区域', def: '0,0,100%,20%', placeholder: '每行一个区域：x,y,宽,高', hint: '支持像素或百分比，如 20,10,300,40' },
        { key: 'mode', type: 'select', label: '遮盖方式', def: 'mosaic', choices: [['mosaic', '马赛克'], ['blur', '高斯模糊'], ['solid', '纯色涂黑']] },
        { key: 'block', type: 'number', label: '马赛克块大小 (px)', def: 12, min: 2, max: 200, visibleWhen: { mode: 'mosaic' } },
        { key: 'blur', type: 'number', label: '模糊半径 (px)', def: 8, min: 1, max: 60, visibleWhen: { mode: 'blur' } },
        { key: 'color', type: 'color', label: '遮盖颜色', def: '#000000', visibleWhen: { mode: 'solid' } },
      ],
      async run(ctx) {
        const mode = ctx.get('mode') || 'mosaic';
        const opts = {
          mode,
          block: Math.max(2, parseInt(ctx.get('block'), 10) || 12),
          blur: Math.max(1, parseInt(ctx.get('blur'), 10) || 8),
          color: ctx.get('color') || '#000000',
        };
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在打码 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          let rects;
          try {
            rects = parseRectList(ctx.get('rects'), cv.width, cv.height);
          } catch (e) {
            throw new Error(`${ctx.files[i].name}：${e && e.message ? e.message : '区域格式错误'}`);
          }
          applyMosaicRegions(cv, rects, opts);
          const blob = await canvasToBlob(cv, 'image/png');
          out.push({
            name: `${baseName(ctx.files[i].name)}_打码.png`,
            blob,
            meta: `${rects.length} 个区域 · ${cv.width} × ${cv.height} px`,
          });
        }
        return out;
      }
    },
    {
      id: 'img-idphoto', name: '证件照排版', cat: 'img', icon: 'photo', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按 1 寸 / 2 寸规格排版证件照并换底色。',
      keywords: '证件照 一寸 二寸 1寸 2寸 排版 相纸 换底色 打印',
      options: [
        { key: 'size', type: 'select', label: '证件照规格', def: '1', choices: [['1', '1 寸 25×35 mm'], ['small1', '小 1 寸 22×32 mm'], ['big1', '大 1 寸 33×48 mm'], ['2', '2 寸 35×49 mm'], ['small2', '小 2 寸 35×45 mm'], ['visa', '签证方照 51×51 mm']] },
        { key: 'paper', type: 'select', label: '相纸 / 纸张', def: '6', choices: [['6', '6 寸相纸 152×102 mm'], ['a5', 'A5 148×210 mm'], ['a4', 'A4 210×297 mm']] },
        { key: 'dpi', type: 'select', label: '输出精度', def: '300', choices: [['300', '300 DPI（打印推荐）'], ['200', '200 DPI'], ['150', '150 DPI（预览）']] },
        { key: 'bg', type: 'select', label: '背景处理', def: 'keep', choices: [['keep', '保留原背景'], ['white', '换白底'], ['red', '换红底'], ['blue', '换蓝底'], ['custom', '自定义底色']], hint: '换底依赖「图片抠图（纯色背景）」，适合背景较纯净的人像' },
        { key: 'customBg', type: 'color', label: '自定义底色', def: '#438EDB' },
        { key: 'tolerance', type: 'number', label: '换底容差 (0-100)', def: 18, min: 0, max: 100 },
        { key: 'gap', type: 'number', label: '照片间距 (mm)', def: 2, min: 0, max: 20 },
        { key: 'count', type: 'number', label: '排版张数', def: 0, min: 0, max: 100, hint: '0 表示排满整张相纸' },
        { key: 'guide', type: 'checkbox', label: '裁切', def: true, hint: '绘制细灰裁切线，方便剪裁' },
      ],
      async run(ctx) {
        const spec = ID_PHOTO_SIZES[ctx.get('size')] || ID_PHOTO_SIZES['1'];
        const paper = ID_PHOTO_PAPERS[ctx.get('paper')] || ID_PHOTO_PAPERS['6'];
        const dpi = Math.max(72, parseInt(ctx.get('dpi'), 10) || 300);
        const mm = v => Math.max(1, Math.round(v / 25.4 * dpi));
        const pw = mm(spec.w), ph = mm(spec.h);
        const PW = mm(paper.w), PH = mm(paper.h);
        const gap = mm(Math.max(0, parseFloat(ctx.get('gap')) || 0));
        if (PW * PH > 40000000) throw new Error('纸张尺寸过大，请降低 DPI 或换小纸张');
        const cols = Math.max(1, Math.floor((PW + gap) / (pw + gap)));
        const rows = Math.max(1, Math.floor((PH + gap) / (ph + gap)));
        const capacity = cols * rows;
        const wanted = Math.max(0, parseInt(ctx.get('count'), 10) || 0);
        const total = wanted ? Math.min(wanted, capacity) : capacity;
        if (!total) throw new Error('当前规格无法在所选纸张上排版，请降低 DPI 或换大纸张');
        const gridW = cols * pw + (cols - 1) * gap;
        const gridH = rows * ph + (rows - 1) * gap;
        const ox = Math.round((PW - gridW) / 2);
        const oy = Math.round((PH - gridH) / 2);
        const bgMode = ctx.get('bg') || 'keep';
        const bgColors = { white: '#ffffff', red: '#d93025', blue: '#438EDB' };
        const fillColor = bgMode === 'custom' ? (ctx.get('customBg') || '#ffffff') : bgColors[bgMode];
        const guide = !!ctx.get('guide');
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在排版 ${i + 1}/${ctx.files.length}…`);
          const src = await imageFileToCanvas(ctx.files[i]);
          let prepared = src;
          let replaced = false;
          if (fillColor) {
            try {
              const cut = removeFlatBackground(src, {
                mode: 'edge', tolerance: ctx.get('tolerance'), feather: 1,
              }).canvas;
              const filled = document.createElement('canvas');
              filled.width = cut.width;
              filled.height = cut.height;
              const fc = filled.getContext('2d');
              fc.fillStyle = fillColor;
              fc.fillRect(0, 0, filled.width, filled.height);
              fc.drawImage(cut, 0, 0);
              prepared = filled;
              replaced = true;
            } catch (e) { /* 背景无法识别时保留原图 */ }
          }
          const targetRatio = pw / ph;
          let sw = prepared.width, sh = prepared.height;
          if (sw / sh > targetRatio) sw = Math.round(sh * targetRatio);
          else sh = Math.round(sw / targetRatio);
          const sx = Math.round((prepared.width - sw) / 2);
          const sy = Math.round((prepared.height - sh) / 2);
          const tile = document.createElement('canvas');
          tile.width = pw;
          tile.height = ph;
          tile.getContext('2d').drawImage(prepared, sx, sy, sw, sh, 0, 0, pw, ph);
          const sheet = document.createElement('canvas');
          sheet.width = PW;
          sheet.height = PH;
          const c = sheet.getContext('2d');
          c.fillStyle = '#ffffff';
          c.fillRect(0, 0, PW, PH);
          for (let k = 0; k < total; k++) {
            const x = ox + (k % cols) * (pw + gap);
            const y = oy + Math.floor(k / cols) * (ph + gap);
            c.drawImage(tile, x, y);
            if (guide) {
              c.strokeStyle = 'rgba(120,120,120,0.55)';
              c.lineWidth = 1;
              c.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1);
            }
          }
          const blob = await canvasToBlob(sheet, 'image/png');
          out.push({
            name: `${baseName(ctx.files[i].name)}_${spec.label}_${dpi}dpi.png`,
            blob,
            meta: `${spec.label} ${spec.w}×${spec.h} mm · ${paper.label} · ${total} 张${replaced ? '（已换底）' : ''}`,
          });
        }
        return out;
      }
    },
    {
      id: 'img-to-ico', name: '图片转 ICO 图标', cat: 'img', icon: 'grid', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '把 Logo / 头像生成 ICO 图标。',
      keywords: 'ico 图标 favicon 网站图标 快捷方式 多尺寸',
      options: [
        {
          key: 'sizes', type: 'select', label: '尺寸组合', def: 'all',
          choices: [
            ['all', '全尺寸 16/32/48/64/128/256'], ['common', '常用 16/32/48'],
            ['logo', '16/32/64/128'], ['256', '仅 256 × 256'],
          ],
        },
        { key: 'fit', type: 'select', label: '非正方图处理', def: 'crop', choices: [['crop', '居中裁剪为正方形'], ['contain', '完整保留（透明留白）']] },
      ],
      async run(ctx) {
        const groups = {
          all: [16, 32, 48, 64, 128, 256], common: [16, 32, 48],
          logo: [16, 32, 64, 128], '256': [256],
        };
        const sizes = groups[ctx.get('sizes')] || groups.all;
        const fit = ctx.get('fit') || 'crop';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在生成图标 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const blob = await canvasToIcoBlob(cv, sizes, fit);
          out.push({
            name: `${baseName(ctx.files[i].name)}.ico`,
            blob,
            meta: `${sizes.length} 个尺寸：${sizes.join(' / ')} px`,
          });
        }
        return out;
      }
    },
    {
      id: 'img-compare', name: '图片对比', cat: 'img', icon: 'compare', minFiles: 2, maxFiles: 2, accept: IMAGE_ACCEPT,
      desc: '并排 / 叠加对比两张图片，标出差异。',
      keywords: '对比 比较 差异 并排 叠加 像素 diff compare',
      options: [
        { key: 'mode', type: 'select', label: '对比方式', def: 'side', choices: [['side', '并排对比'], ['diff', '差异高亮'], ['overlay', '半透明叠加']] },
        { key: 'tolerance', type: 'number', label: '差异容差 (0-255)', def: 12, min: 0, max: 255, hint: '数值越大，越小的颜色变化会被忽略', visibleWhen: { mode: 'diff' } },
        { key: 'labels', type: 'checkbox', label: '并排标注 A / B', def: true, visibleWhen: { mode: 'side' } },
      ],
      async run(ctx) {
        const mode = ctx.get('mode') || 'side';
        const tolerance = Math.max(0, Math.min(255, parseInt(ctx.get('tolerance'), 10) || 0));
        const a = await imageFileToCanvas(ctx.files[0]);
        const b = await imageFileToCanvas(ctx.files[1]);
        ctx.progress(0, 1, '正在生成对比图…');
        const result = compareCanvasPair(a, b, mode, tolerance, !!ctx.get('labels'));
        const blob = await canvasToBlob(result.canvas, 'image/png');
        const lines = [
          `图片 A：${ctx.files[0].name}（${a.width} × ${a.height} px）`,
          `图片 B：${ctx.files[1].name}（${b.width} × ${b.height} px）`,
          `对比方式：${{ side: '并排', diff: '差异高亮', overlay: '半透明叠加' }[mode] || mode}`,
          `差异容差：${tolerance}`,
        ];
        if (mode === 'diff') {
          const pct = result.total ? (result.changed / result.total * 100) : 0;
          lines.push(`差异像素：${result.changed} / ${result.total}（${pct.toFixed(2)}%）`);
          lines.push('红色为差异像素。');
        } else {
          lines.push('尺寸按图 A 统一。');
        }
        if (ctx.files.length > 2) lines.push(`注意：本次仅对比前 2 张图片（共导入 ${ctx.files.length} 张）。`);
        ctx.progress(1, 1, '对比完成');
        return [
          { name: '图片对比结果.png', blob, meta: `${result.canvas.width} × ${result.canvas.height} px` },
          {
            name: '图片对比报告.txt',
            blob: new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' }),
            meta: mode === 'diff' ? `差异 ${((result.changed / (result.total || 1)) * 100).toFixed(2)}%` : '并排 / 叠加报告',
          },
        ];
      }
    },
    {
      id: 'img-to-word', name: '图片插入 Word / Excel', cat: 'img', icon: 'doc', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '把多张图片按顺序插入 Word 或 Excel。',
      keywords: '图片转word docx xlsx excel 图文文档 截图归档 插入图片',
      options: [
        { key: 'target', type: 'select', label: '输出文档', def: 'docx', choices: [['docx', 'Word 文档 (.docx)'], ['xlsx', 'Excel 表格 (.xlsx)']] },
        { key: 'widthCm', type: 'number', label: '图片宽度 (cm)', def: 15, min: 1, max: 25 },
        { key: 'title', type: 'text', label: '文档标题', def: '', placeholder: '留空则不写标题', hint: '仅 Word 生效，写在图片上方' },
        { key: 'caption', type: 'checkbox', label: '标注', def: true, hint: 'Word 写在图片下方，Excel 写在同行首列' },
        { key: 'pageBreak', type: 'checkbox', label: '分页', def: false, hint: '仅 Word 生效，每张图片单独占一页' },
        { key: 'format', type: 'select', label: '嵌入格式', def: 'keep', choices: [['keep', 'JPG / PNG 保持原始字节'], ['png', '统一转 PNG（无损）'], ['jpeg', '统一转 JPG（体积更小）']] },
      ],
      async run(ctx) {
        const format = ctx.get('format') || 'keep';
        const images = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在准备图片 ${i + 1}/${ctx.files.length}…`);
          const f = ctx.files[i];
          const cv = await imageFileToCanvas(f);
          const ext = imageExtOf(f.name).toLowerCase();
          let bytes = null, outExt = '';
          if (format === 'keep' && (ext === 'png' || ext === 'jpg' || ext === 'jpeg')) {
            // 扩展名可能与实际内容不符，按文件头确认后再直接复用原始字节
            const raw = new Uint8Array(await f.arrayBuffer());
            const mime = detectImageMime(raw);
            if (mime === 'image/png' || mime === 'image/jpeg') {
              bytes = raw;
              outExt = mime === 'image/png' ? 'png' : 'jpg';
            }
          }
          if (!bytes) {
            const target = format === 'jpeg' ? 'jpeg' : 'png';
            const src = target === 'jpeg' ? flattenCanvasOnWhite(cv) : cv;
            const blob = await canvasToBlob(src, target === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92);
            bytes = new Uint8Array(await blob.arrayBuffer());
            outExt = imageOutputExt(target);
          }
          images.push({
            name: `image${i + 1}.${outExt}`,
            ext: outExt,
            bytes,
            w: cv.width,
            h: cv.height,
            caption: f.name,
          });
        }
        const xlsx = ctx.get('target') === 'xlsx';
        ctx.progress(1, 1, `正在生成 ${xlsx ? 'Excel' : 'Word'} 文档…`);
        const cfg = {
          widthCm: Math.max(1, Math.min(25, parseFloat(ctx.get('widthCm')) || 15)),
          title: String(ctx.get('title') || ''),
          caption: !!ctx.get('caption'),
          pageBreak: !!ctx.get('pageBreak'),
        };
        const blob = xlsx ? await buildXlsxWithImages(images, cfg) : await buildDocxWithImages(images, cfg);
        return [{
          name: xlsx ? '图片台账.xlsx' : '图片文档.docx',
          blob,
          meta: `共嵌入 ${images.length} 张图片`,
        }];
      }
    },
    {
      id: 'pdf-crop', name: '页面裁剪', cat: 'pdf', icon: 'crop', minFiles: 1, accept: '.pdf',
      desc: '按统一边距裁剪页面可视区域，去除白边或页眉页脚。',
      keywords: '裁剪 crop 去白边 页边距 trim',
      options: [
        { key: 'mode', type: 'select', label: '边距单位', def: 'pt', choices: [['pt', '绝对值 (pt)'], ['pct', '百分比 (%)']] },
        { key: 'top', type: 'number', label: '上边距', def: 20, min: 0 },
        { key: 'right', type: 'number', label: '右边距', def: 20, min: 0 },
        { key: 'bottom', type: 'number', label: '下边距', def: 20, min: 0 },
        { key: 'left', type: 'number', label: '左边距', def: 20, min: 0 },
      ],
      async run(ctx) {
        const out = [];
        const pct = ctx.get('mode') === 'pct';
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在裁剪第 ${i + 1}/${total} 页…`);
            const page = doc.getPage(i);
            const { width, height } = page.getSize();
            const t = (parseFloat(ctx.get('top')) || 0) * (pct ? height / 100 : 1);
            const r = (parseFloat(ctx.get('right')) || 0) * (pct ? width / 100 : 1);
            const b = (parseFloat(ctx.get('bottom')) || 0) * (pct ? height / 100 : 1);
            const l = (parseFloat(ctx.get('left')) || 0) * (pct ? width / 100 : 1);
            const w = width - l - r, h = height - t - b;
            if (w <= 10 || h <= 10) throw new Error(`第 ${i + 1} 页裁剪后尺寸过小，请检查边距`);
            page.setMediaBox(l, b, w, h);
            page.setCropBox(l, b, w, h);
          }
          out.push({ name: `${baseName(file.name)}_裁剪.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-autorotate', name: '自动旋转', cat: 'pdf', icon: 'rotate', minFiles: 1, accept: '.pdf',
      desc: '检测文字方向并自动转正页面。',
      keywords: '自动旋转 autorotate 转正 方向 detect',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          const pdfjsDoc = await loadPdfjsDoc(file);
          const doc = await loadPdfDoc(file);
          const total = pdfjsDoc.numPages;
          let changed = 0;
          for (let i = 1; i <= total; i++) {
            ctx.progress(i - 1, total, `正在检测第 ${i}/${total} 页方向…`);
            const tc = await (await pdfjsDoc.getPage(i)).getTextContent();
            const votes = { 0: 0, 90: 0, 180: 0, 270: 0 };
            for (const item of tc.items) {
              const m = item.transform || [1, 0, 0, 1];
              const ang = ((Math.atan2(m[1], m[0]) * 180 / Math.PI) % 360 + 360) % 360;
              const bucket = Math.round(ang / 90) * 90 % 360;
              votes[bucket] += (item.str || '').length + 1;
            }
            let best = 0, bestW = -1;
            for (const k of [0, 90, 180, 270]) {
              if (votes[k] > bestW) { bestW = votes[k]; best = k; }
            }
            if (bestW <= 0) continue;
            const page = doc.getPage(i - 1);
            const cur = ((page.getRotation().angle % 360) + 360) % 360;
            if (cur !== best) {
              page.setRotation(PDFLib.degrees(best));
              changed++;
            }
          }
          out.push({ name: `${baseName(file.name)}_转正.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: `已调整 ${changed} 页` });
        }
        return out;
      }
    },
    {
      id: 'pdf-booklet', name: '小册子拼版', cat: 'pdf', icon: 'booklet', minFiles: 1, accept: '.pdf', single: true,
      desc: '按小册子顺序重排页面，便于打印。',
      keywords: '小册子 booklet 拼版 装订 骑马订 imposition',
      options: [
        { key: 'layout', type: 'select', label: '输出方式', def: 'reorder', choices: [['reorder', '仅按小册子顺序重排'], ['nup', '每张纸 2 页（双联拼版）']] },
        { key: 'gap', type: 'number', label: '页间距 (pt)', def: 8, min: 0, max: 60 },
      ],
      async run(ctx) {
        const out = [];
        const gap = Math.max(0, parseFloat(ctx.get('gap')) || 0);
        for (const file of ctx.files) {
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const order = bookletOrder(total);
          const size = src.getPage(0).getSize();
          const doc = await PDFLib.PDFDocument.create();
          if (ctx.get('layout') === 'reorder') {
            for (let k = 0; k < order.length; k++) {
              ctx.progress(k, order.length, `正在重排 ${k + 1}/${order.length}…`);
              const idx = order[k];
              if (idx < 0) { doc.addPage([size.width, size.height]); continue; }
              (await doc.copyPages(src, [idx])).forEach(p => doc.addPage(p));
            }
          } else {
            for (let k = 0; k < order.length; k += 2) {
              ctx.progress(k, order.length, `正在拼版 ${k + 1}/${order.length}…`);
              const sheet = doc.addPage([size.width * 2 + gap * 3, size.height + gap * 2]);
              for (let s = 0; s < 2; s++) {
                const idx = order[k + s];
                if (idx == null || idx < 0) continue;
                const [sp] = await doc.copyPages(src, [idx]);
                sheet.drawPage(await doc.embedPage(sp), { x: gap + s * (size.width + gap), y: gap, width: size.width, height: size.height });
              }
            }
          }
          out.push({ name: `${baseName(file.name)}_小册子.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-longpage', name: '合并为单长页', cat: 'pdf', icon: 'scroll', minFiles: 1, accept: '.pdf', single: true,
      desc: '将所有页面纵向拼成一张长页。',
      keywords: '长页 长图 单页 continuous 联页 纵向拼接',
      options: [{ key: 'gap', type: 'number', label: '页间距 (pt)', def: 0, min: 0, max: 100 }],
      async run(ctx) {
        const out = [];
        const gap = Math.max(0, parseFloat(ctx.get('gap')) || 0);
        for (const file of ctx.files) {
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const sizes = [];
          for (let i = 0; i < total; i++) sizes.push(src.getPage(i).getSize());
          const width = Math.max(...sizes.map(s => s.width));
          const height = sizes.reduce((a, s) => a + s.height, 0) + gap * Math.max(0, total - 1);
          const doc = await PDFLib.PDFDocument.create();
          const page = doc.addPage([width, height]);
          let y = height;
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在拼接第 ${i + 1}/${total} 页…`);
            const [sp] = await doc.copyPages(src, [i]);
            const ep = await doc.embedPage(sp);
            const s = sizes[i];
            y -= s.height;
            page.drawPage(ep, { x: (width - s.width) / 2, y, width: s.width, height: s.height });
            y -= gap;
          }
          out.push({ name: `${baseName(file.name)}_单长页.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: `${Math.round(width)} × ${Math.round(height)} pt` });
        }
        return out;
      }
    },
    {
      id: 'pdf-page-size', name: '调整页面尺寸', cat: 'pdf', icon: 'resize', minFiles: 1, accept: '.pdf',
      desc: '统一页面尺寸，内容等比缩放。',
      keywords: '页面尺寸 A4 统一 缩放 页面调整 scale papersize',
      options: [
        { key: 'size', type: 'select', label: '目标尺寸', def: 'a4', choices: [['a4', 'A4 纵向 (595×842 pt)'], ['landscape-a4', 'A4 横向 (842×595 pt)'], ['a3', 'A3 (842×1191 pt)'], ['letter', 'Letter (612×792 pt)'], ['custom', '自定义']] },
        { key: 'width', type: 'number', label: '自定义宽 (pt)', def: 595, min: 20, max: 5000 },
        { key: 'height', type: 'number', label: '自定义高 (pt)', def: 842, min: 20, max: 5000 },
        { key: 'fit', type: 'select', label: '内容适配', def: 'contain', choices: [['contain', '等比缩放并居中'], ['stretch', '拉伸填满']] },
      ],
      async run(ctx) {
        const presets = {
          'a4': [595.28, 841.89], 'landscape-a4': [841.89, 595.28],
          'a3': [841.89, 1190.55], 'letter': [612, 792],
        };
        const preset = presets[ctx.get('size')];
        const tw = preset ? preset[0] : (parseFloat(ctx.get('width')) || 595);
        const th = preset ? preset[1] : (parseFloat(ctx.get('height')) || 842);
        const stretch = ctx.get('fit') === 'stretch';
        const out = [];
        for (const file of ctx.files) {
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const doc = await PDFLib.PDFDocument.create();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在调整第 ${i + 1}/${total} 页…`);
            const [sp] = await doc.copyPages(src, [i]);
            const ep = await doc.embedPage(sp);
            const s = sp.getSize();
            const page = doc.addPage([tw, th]);
            if (stretch) {
              page.drawPage(ep, { x: 0, y: 0, width: tw, height: th });
            } else {
              const k = Math.min(tw / s.width, th / s.height);
              const w = s.width * k, h = s.height * k;
              page.drawPage(ep, { x: (tw - w) / 2, y: (th - h) / 2, width: w, height: h });
            }
          }
          out.push({ name: `${baseName(file.name)}_统一尺寸.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-overlay', name: 'PDF 叠加合并', cat: 'pdf', icon: 'overlay', minFiles: 1, accept: '.pdf', single: true,
      desc: '将另一个 PDF 逐页叠加到文档上。',
      keywords: '叠加 overlay 套打 信头 底图 merge over',
      options: [
        { key: 'over', type: 'file', label: '叠加文档（PDF）', accept: '.pdf', hint: '该文档的页面将叠加到当前文档每一页之上' },
        { key: 'opacity', type: 'number', label: '叠加透明度 (0.1-1)', def: 1, min: 0.1, max: 1, step: 0.1 },
        { key: 'scale', type: 'select', label: '缩放方式', def: 'fit', choices: [['fit', '等比适配页面'], ['stretch', '拉伸填满'], ['keep', '保持原始尺寸居中']] },
      ],
      async run(ctx) {
        const overFile = ctx.get('over');
        if (!overFile) throw new Error('请先选择叠加文档');
        const opacity = Math.min(1, Math.max(0.1, parseFloat(ctx.get('opacity')) || 1));
        const mode = ctx.get('scale');
        const out = [];
        const over = await loadPdfDoc(overFile);
        const overTotal = over.getPageCount();
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在叠加第 ${i + 1}/${total} 页…`);
            const page = doc.getPage(i);
            const [sp] = await doc.copyPages(over, [Math.min(i, overTotal - 1)]);
            const ep = await doc.embedPage(sp);
            const { width, height } = page.getSize();
            const s = sp.getSize();
            if (mode === 'stretch') {
              page.drawPage(ep, { x: 0, y: 0, width, height, opacity });
            } else {
              const k = mode === 'keep'
                ? 1
                : Math.min(width / s.width, height / s.height);
              page.drawPage(ep, { x: (width - s.width * k) / 2, y: (height - s.height * k) / 2, width: s.width * k, height: s.height * k, opacity });
            }
          }
          out.push({ name: `${baseName(file.name)}_叠加.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-add-text', name: '添加文字', cat: 'pdf', icon: 'pen', minFiles: 1, accept: '.pdf',
      desc: '在页面任意位置添加文字。',
      keywords: '添加文字 文字 addtext 盖字 标注文字',
      options: [
        { key: 'text', type: 'text', label: '文字内容', def: '内部资料', placeholder: '输入要添加的文字' },
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
        { key: 'x', type: 'number', label: '水平位置 (%)（左0 右100）', def: 50, min: 0, max: 100 },
        { key: 'y', type: 'number', label: '垂直位置 (%)（下0 上100）', def: 50, min: 0, max: 100 },
        { key: 'fontPx', type: 'number', label: '字号 (px)', def: 36, min: 10, max: 200 },
        { key: 'angle', type: 'number', label: '旋转角度', def: 0, min: -90, max: 90 },
        { key: 'opacity', type: 'number', label: '透明度 (0.05-1)', def: 1, min: 0.05, max: 1, step: 0.05 },
        { key: 'color', type: 'color', label: '文字颜色', def: '#d92020' },
      ],
      async run(ctx) {
        const text = (ctx.get('text') || '').trim();
        if (!text) throw new Error('请输入文字内容');
        const fontPx = parseInt(ctx.get('fontPx'), 10) || 36;
        const angle = parseFloat(ctx.get('angle')) || 0;
        const opacity = Math.min(1, Math.max(0.05, parseFloat(ctx.get('opacity')) || 1));
        const xPct = Math.min(100, Math.max(0, parseFloat(ctx.get('x')) || 0));
        const yPct = Math.min(100, Math.max(0, parseFloat(ctx.get('y')) || 0));
        const cv = makeTextImage(text, { fontPx, angle, color: ctx.get('color') || '#d92020' });
        const png = await canvasToBlob(cv, 'image/png');
        const bytes = await png.arrayBuffer();
        const out = [];
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          const pages = parsePageRanges(ctx.get('range'), total);
          const img = await doc.embedPng(bytes);
          const scale = 0.75;
          const w = cv.width * scale, h = cv.height * scale;
          for (let k = 0; k < pages.length; k++) {
            ctx.progress(k, pages.length, `正在添加文字 ${k + 1}/${pages.length}…`);
            const page = doc.getPage(pages[k] - 1);
            const { width, height } = page.getSize();
            page.drawImage(img, {
              x: width * xPct / 100 - w / 2,
              y: height * (1 - yPct / 100) - h / 2,
              width: w, height: h, opacity,
            });
          }
          out.push({ name: `${baseName(file.name)}_加字.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-add-image', name: '添加图片', cat: 'pdf', icon: 'photo', minFiles: 1, accept: '.pdf',
      desc: '在页面指定位置放置图片。',
      keywords: '添加图片 图片 addimage logo 印章 签名图片',
      options: [
        { key: 'img', type: 'file', label: '图片文件', accept: IMAGE_ACCEPT, required: true, hint: `支持 ${IMAGE_FORMAT_LABEL}（PNG 透明底效果最佳）` },
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
        { key: 'x', type: 'number', label: '水平位置 (%)（左0 右100）', def: 50, min: 0, max: 100 },
        { key: 'y', type: 'number', label: '垂直位置 (%)（下0 上100）', def: 50, min: 0, max: 100 },
        { key: 'widthPct', type: 'number', label: '宽度占页宽 %', def: 30, min: 1, max: 150 },
        { key: 'opacity', type: 'number', label: '透明度 (0.1-1)', def: 1, min: 0.1, max: 1, step: 0.1 },
      ],
      async run(ctx) {
        const imgFile = ctx.get('img');
        if (!imgFile) throw new Error('请先选择图片文件');
        const widthPct = Math.min(150, Math.max(1, parseFloat(ctx.get('widthPct')) || 30)) / 100;
        const opacity = Math.min(1, Math.max(0.1, parseFloat(ctx.get('opacity')) || 1));
        const xPct = Math.min(100, Math.max(0, parseFloat(ctx.get('x')) || 0));
        const yPct = Math.min(100, Math.max(0, parseFloat(ctx.get('y')) || 0));
        const out = [];
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          const pages = parsePageRanges(ctx.get('range'), total);
          const img = await embedImageFile(doc, imgFile);
          for (let k = 0; k < pages.length; k++) {
            ctx.progress(k, pages.length, `正在添加图片 ${k + 1}/${pages.length}…`);
            const page = doc.getPage(pages[k] - 1);
            const { width, height } = page.getSize();
            const w = width * widthPct;
            const h = w * (img.height / img.width);
            page.drawImage(img, {
              x: width * xPct / 100 - w / 2,
              y: height * (1 - yPct / 100) - h / 2,
              width: w, height: h, opacity,
            });
          }
          out.push({ name: `${baseName(file.name)}_加图.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },

    /* ---------- 借鉴 Stirling-PDF：转换提取 ---------- */
    {
      id: 'pdf-extract-images', name: '提取图片', cat: 'pdf', icon: 'photo', minFiles: 1, accept: '.pdf',
      desc: '无损导出 PDF 中内嵌的全部原始图片，打包为 ZIP。',
      keywords: '提取图片 导出图片 extract images 原图',
      options: [{ key: 'minSize', type: 'number', label: '最小尺寸 (px)', def: 80, min: 0, max: 5000 }],
      async run(ctx) {
        const minSize = parseInt(ctx.get('minSize'), 10) || 0;
        const out = [];
        for (const file of ctx.files) {
          const pdfDoc = await loadPdfjsDoc(file);
          const total = pdfDoc.numPages;
          const seen = new Set();
          let count = 0;
          for (let p = 1; p <= total; p++) {
            ctx.progress(p - 1, total, `正在扫描第 ${p}/${total} 页图片…`);
            const page = await pdfDoc.getPage(p);
            const opList = await page.getOperatorList();
            for (let i = 0; i < opList.fnArray.length; i++) {
              const fn = opList.fnArray[i];
              if (fn !== pdfjsLib.OPS.paintImageXObject &&
                  fn !== pdfjsLib.OPS.paintInlineImageXObject &&
                  fn !== pdfjsLib.OPS.paintImageMaskXObject) continue;
              const objId = opList.argsArray[i] && opList.argsArray[i][0];
              if (objId == null || seen.has(objId)) continue;
              seen.add(objId);
              let imgData = null;
              try { imgData = page.objs.get(objId); } catch (e) {
                try { imgData = await new Promise(r => page.objs.get(objId, r)); } catch (e2) { /* skip */ }
              }
              if (!imgData) continue;
              let canvas = null;
              try {
                if (imgData.bitmap) {
                  canvas = document.createElement('canvas');
                  canvas.width = imgData.bitmap.width;
                  canvas.height = imgData.bitmap.height;
                  canvas.getContext('2d').drawImage(imgData.bitmap, 0, 0);
                } else if (imgData.data && imgData.width && imgData.height) {
                  const w = imgData.width, h = imgData.height, d = imgData.data;
                  let rgba;
                  if (d.length === w * h * 4) rgba = new Uint8ClampedArray(d);
                  else if (d.length === w * h * 3) {
                    rgba = new Uint8ClampedArray(w * h * 4);
                    for (let s = 0, t = 0; s < d.length; s += 3, t += 4) {
                      rgba[t] = d[s]; rgba[t + 1] = d[s + 1]; rgba[t + 2] = d[s + 2]; rgba[t + 3] = 255;
                    }
                  } else if (d.length === w * h) {
                    rgba = new Uint8ClampedArray(w * h * 4);
                    for (let s = 0, t = 0; s < d.length; s++, t += 4) {
                      rgba[t] = rgba[t + 1] = rgba[t + 2] = d[s]; rgba[t + 3] = 255;
                    }
                  }
                  if (rgba) {
                    canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
                  }
                }
              } catch (e) { /* skip broken image */ }
              if (!canvas || canvas.width < minSize || canvas.height < minSize) continue;
              count++;
              const blob = await canvasToBlob(canvas, 'image/png');
              out.push({
                name: `${baseName(file.name)}_p${p}_img${count}.png`,
                blob,
                meta: `${canvas.width} × ${canvas.height} px`,
              });
            }
          }
          if (!count) out.push({ name: `${baseName(file.name)}_无图片.txt`, blob: new Blob(['未检测到可提取的内嵌图片。'], { type: 'text/plain' }) });
        }
        return out;
      }
    },
    {
      id: 'pdf-scanfx', name: '扫描件调色 / 反色', cat: 'pdf', icon: 'wand', minFiles: 1, accept: '.pdf',
      desc: '调整亮度、对比度、黑白化或反色，优化扫描件。',
      keywords: '调色 反色 扫描 亮度 对比度 黑白 invert contrast enhance',
      options: [
        { key: 'brightness', type: 'number', label: '亮度 (1 为原样)', def: 1, min: 0.3, max: 2, step: 0.05 },
        { key: 'contrast', type: 'number', label: '对比度 (1 为原样)', def: 1.15, min: 0.3, max: 3, step: 0.05 },
        { key: 'grayscale', type: 'checkbox', label: '黑白化（去彩色）', def: false },
        { key: 'invert', type: 'checkbox', label: '反色（负片效果）', def: false },
        { key: 'dpi', type: 'select', label: '输出分辨率', def: '200', choices: [['150', '150 DPI'], ['200', '200 DPI（推荐）'], ['300', '300 DPI']] },
        { key: 'quality', type: 'number', label: '输出质量 (1-100)', def: 85, min: 30, max: 100 },
      ],
      async run(ctx) {
        const b = parseFloat(ctx.get('brightness')) || 1;
        const c = parseFloat(ctx.get('contrast')) || 1;
        const parts = [`brightness(${b})`, `contrast(${c})`];
        if (ctx.get('grayscale')) parts.push('grayscale(1)');
        if (ctx.get('invert')) parts.push('invert(1)');
        const filter = parts.join(' ');
        const out = [];
        for (const file of ctx.files) {
          const blob = await rasterizePdfToBlob(file, {
            scale: (parseInt(ctx.get('dpi'), 10) || 200) / 72,
            quality: (parseInt(ctx.get('quality'), 10) || 85) / 100,
            filter,
          }, (done, total, text) => ctx.progress(done, total, `${file.name}：${text}`));
          out.push({
            name: `${baseName(file.name)}_调色.pdf`, blob,
            meta: `${formatBytes(file.size)} → ${formatBytes(blob.size)}`,
          });
        }
        return out;
      }
    },

    /* ---------- 借鉴 Stirling-PDF：安全清理 ---------- */
    {
      id: 'pdf-remove-annots', name: '删除批注', cat: 'pdf', icon: 'eraser', minFiles: 1, accept: '.pdf',
      desc: '移除文档中全部批注、高亮、书签标记与注释内容。',
      keywords: '删除批注 批注 remove annotations 注释 高亮',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          let removed = 0;
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在清理第 ${i + 1}/${total} 页批注…`);
            const node = doc.getPage(i).node;
            const annots = node.lookupMaybe(PDFLib.PDFName.of('Annots'), PDFLib.PDFArray);
            if (annots && annots.size() > 0) removed += annots.size();
            node.delete(PDFLib.PDFName.of('Annots'));
          }
          let removedOutline = false;
          if (doc.catalog.get(PDFLib.PDFName.of('Outlines'))) {
            doc.catalog.delete(PDFLib.PDFName.of('Outlines'));
            removedOutline = true;
          }
          out.push({ name: `${baseName(file.name)}_去批注.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: `已移除 ${removed} 条批注${removedOutline ? '及书签' : ''}` });
        }
        return out;
      }
    },
    {
      id: 'pdf-sanitize', name: '安全净化', cat: 'pdf', icon: 'broom', minFiles: 1, accept: '.pdf',
      desc: '移除脚本、动作与内嵌附件等风险内容。',
      keywords: '净化 sanitize 安全 移除javascript 消毒 清理',
      options: [
        { key: 'rmAttach', type: 'checkbox', label: '同时移除内嵌附件', def: true },
      ],
      async run(ctx) {
        const out = [];
        const rmAttach = ctx.get('rmAttach');
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const removed = [];
          if (doc.catalog.get(PDFLib.PDFName.of('OpenAction'))) { doc.catalog.delete(PDFLib.PDFName.of('OpenAction')); removed.push('自动打开动作'); }
          if (doc.catalog.get(PDFLib.PDFName.of('AA'))) { doc.catalog.delete(PDFLib.PDFName.of('AA')); removed.push('文档级附加动作'); }
          const names = safeLookup(doc.catalog, 'Names', PDFLib.PDFDict);
          if (names) {
            if (names.get(PDFLib.PDFName.of('JavaScript'))) {
              names.delete(PDFLib.PDFName.of('JavaScript'));
              removed.push('JavaScript');
            }
            if (rmAttach && names.get(PDFLib.PDFName.of('EmbeddedFiles'))) {
              names.delete(PDFLib.PDFName.of('EmbeddedFiles'));
              removed.push('内嵌附件');
            }
          }
          const total = doc.getPageCount();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在净化第 ${i + 1}/${total} 页…`);
            const node = doc.getPage(i).node;
            if (node.get(PDFLib.PDFName.of('AA'))) {
              node.delete(PDFLib.PDFName.of('AA'));
              if (!removed.includes('页面级附加动作')) removed.push('页面级附加动作');
            }
          }
          const riskCount = stripRiskyActions(doc);
          if (riskCount) removed.push(`风险动作 ${riskCount} 处`);
          out.push({
            name: `${baseName(file.name)}_净化.pdf`,
            blob: bytesToBlob(await doc.save(), 'application/pdf'),
            meta: removed.length ? `已移除：${removed.join('、')}` : '未发现风险内容',
          });
        }
        return out;
      }
    },
    {
      id: 'pdf-flatten', name: '扁平化', cat: 'pdf', icon: 'shield', minFiles: 1, accept: '.pdf',
      desc: '将批注与表单域固化为页面内容。',
      keywords: '扁平化 flatten 固化 表单 批注定稿',
      options: [
        { key: 'dpi', type: 'select', label: '输出清晰度', def: '200', choices: [['150', '150 DPI（体积小）'], ['200', '200 DPI（推荐）'], ['300', '300 DPI（高清）']] },
        { key: 'quality', type: 'number', label: '输出质量 (1-100)', def: 88, min: 30, max: 100 },
      ],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          const blob = await rasterizePdfToBlob(file, {
            scale: (parseInt(ctx.get('dpi'), 10) || 200) / 72,
            quality: (parseInt(ctx.get('quality'), 10) || 88) / 100,
            filter: '',
            flattenForms: true,
          }, (done, total, text) => ctx.progress(done, total, `${file.name}：${text}`));
          out.push({
            name: `${baseName(file.name)}_扁平化.pdf`, blob,
            meta: `${formatBytes(file.size)} → ${formatBytes(blob.size)}`,
          });
        }
        return out;
      }
    },

    /* ---------- 借鉴 Stirling-PDF：文档工具 ---------- */
    {
      id: 'pdf-compare', name: '文档对比', cat: 'pdf', icon: 'compare', minFiles: 2, maxFiles: 2, accept: '.pdf',
      desc: '比较两个 PDF 的文字差异，生成对比报告。',
      keywords: '对比 compare 差异 diff 校对 版本比较',
      options: [],
      async run(ctx) {
        if (ctx.files.length < 2) throw new Error('请选择 2 个 PDF 文件进行对比');
        const [fa, fb] = ctx.files;
        const ignored = ctx.files.length - 2;
        const notice = ignored > 0 ? `注意：共选择了 ${ctx.files.length} 个文件，仅对比前 2 个，其余 ${ignored} 个已忽略。` : '';
        ctx.progress(0, 2, '正在提取第一份文档文字…');
        const a = await extractPdfLines(fa);
        ctx.progress(1, 2, '正在提取第二份文档文字…');
        const b = await extractPdfLines(fb);
        const ops = diffLines(a, b);
        if (!ops) throw new Error('文档行数过多（>2500 行），请拆分后再对比');
        let added = 0, removed = 0;
        const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const rows = ops.map(op => {
          if (op.t === '+') { added++; return `<div class="add">＋ ${esc(op.s)}</div>`; }
          if (op.t === '-') { removed++; return `<div class="del">－ ${esc(op.s)}</div>`; }
          return `<div class="same">&nbsp;&nbsp;${esc(op.s)}</div>`;
        }).join('');
        const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>文档对比报告</title>
<style>body{font:14px/1.7 Consolas,"Microsoft YaHei",monospace;background:#f6f8fa;padding:24px;color:#24292f}
h2{font-size:18px}.summary{background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:12px 16px;margin:12px 0}
.add{background:#e6ffec;color:#116329}.del{background:#ffebe9;color:#82071e}.same{color:#57606a}
.legend span{display:inline-block;padding:2px 10px;border-radius:6px;margin-right:8px;font-size:12px}</style></head><body>
<h2>文档对比报告</h2>
<div class="summary">A：${esc(fa.name)}（${a.length} 行）<br>B：${esc(fb.name)}（${b.length} 行）${notice ? `<br>${esc(notice)}` : ''}<br>
<span class="legend"><span class="add">新增 ${added} 行</span><span class="del">删除 ${removed} 行</span></span></div>
${rows}</body></html>`;
        const summary = `文档对比摘要\n${notice ? notice + '\n' : ''}A：${fa.name}（${a.length} 行）\nB：${fb.name}（${b.length} 行）\n新增：${added} 行\n删除：${removed} 行\n`;
        return [
          { name: '文档对比报告.html', blob: new Blob([html], { type: 'text/html;charset=utf-8' }), meta: `＋${added} －${removed}` },
          { name: '文档对比摘要.txt', blob: new Blob([summary], { type: 'text/plain;charset=utf-8' }) },
        ];
      }
    },
    {
      id: 'pdf-info', name: '文档详细信息', cat: 'pdf', icon: 'info', minFiles: 1, accept: '.pdf',
      desc: '查看 PDF 信息与元数据，导出报告。',
      keywords: '信息 info 元数据 诊断 查看属性 inspect',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在分析 ${file.name}…`);
          const buf = await file.arrayBuffer();
          const head = String.fromCharCode(...new Uint8Array(buf.slice(0, 10)));
          const verMatch = head.match(/%PDF-(\d\.\d)/);
          const doc = await loadPdfDoc(file);
          const lines = [];
          lines.push(`文件名：${file.name}`);
          lines.push(`文件大小：${formatBytes(file.size)}`);
          lines.push(`PDF 版本：${verMatch ? verMatch[1] : '未知'}`);
          lines.push(`页数：${doc.getPageCount()}`);
          lines.push(`是否加密：${doc.isEncrypted ? '是' : '否'}`);
          lines.push('--- 元数据 ---');
          const meta = [
            ['标题', doc.getTitle()], ['作者', doc.getAuthor()], ['主题', doc.getSubject()],
            ['关键词', doc.getKeywords()], ['生成工具', doc.getProducer()], ['创建程序', doc.getCreator()],
            ['创建时间', doc.getCreationDate()], ['修改时间', doc.getModificationDate()],
          ];
          for (const [k, v] of meta) lines.push(`${k}：${v || '（空）'}`);
          lines.push('--- 页面尺寸（前 5 页）---');
          const show = Math.min(5, doc.getPageCount());
          for (let i = 0; i < show; i++) {
            const s = doc.getPage(i).getSize();
            const r = doc.getPage(i).getRotation().angle || 0;
            lines.push(`第 ${i + 1} 页：${s.width.toFixed(1)} × ${s.height.toFixed(1)} pt${r ? `（旋转 ${r}°）` : ''}`);
          }
          const files = listEmbeddedFiles(doc);
          lines.push('--- 附件 ---');
          lines.push(files.length ? files.map(f => `- ${f.name}（${formatBytes(f.bytes.length)}）`).join('\n') : '无内嵌附件');
          out.push({
            name: `${baseName(file.name)}_信息报告.txt`,
            blob: new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }),
            meta: `${doc.getPageCount()} 页`,
          });
        }
        return out;
      }
    },
    {
      id: 'pdf-auto-rename', name: '自动重命名', cat: 'pdf', icon: 'tag', minFiles: 1, accept: '.pdf',
      desc: '按标题或首页文字自动重命名。',
      keywords: '重命名 rename 命名 归档 批量命名',
      options: [
        { key: 'source', type: 'select', label: '命名来源', def: 'title', choices: [['title', '文档标题属性'], ['firstline', '首页第一行文字']] },
        { key: 'prefix', type: 'text', label: '文件名前缀', def: '', placeholder: '如：合同_' },
      ],
      async run(ctx) {
        const prefix = ctx.get('prefix') || '';
        const source = ctx.get('source');
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          const file = ctx.files[i];
          ctx.progress(i, ctx.files.length, `正在命名 ${i + 1}/${ctx.files.length}…`);
          let name = '';
          if (source === 'title') {
            const doc = await loadPdfDoc(file);
            name = doc.getTitle() || '';
          } else {
            const lines = await extractPdfLines(file);
            name = (lines.find(l => !/^---/.test(l) && l.trim()) || '').trim();
          }
          const clean = (name && name.trim()) ? sanitizeFileName(name) : baseName(file.name);
          const bytes = await file.arrayBuffer();
          out.push({ name: `${prefix}${clean}.pdf`, blob: bytesToBlob(bytes, 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-attachments', name: '附件管理', cat: 'pdf', icon: 'doc', minFiles: 1, accept: '*',
      desc: '提取、删除或添加 PDF 内嵌附件。',
      keywords: '附件 attachment 提取附件 内嵌文件 封装',
      options: [
        { key: 'mode', type: 'select', label: '操作方式', def: 'extract', choices: [['extract', '提取全部附件'], ['remove', '删除全部附件'], ['add', '添加附件（第 1 个是 PDF，其余为附件）']] },
      ],
      validateOptions(opts, files) {
        const mode = opts.mode || 'extract';
        if (!files.some(f => /\.pdf$/i.test(f.name))) return '请至少选择一个 PDF 文件';
        if (mode === 'add') {
          if (!/\.pdf$/i.test((files[0] && files[0].name) || '')) return '添加附件时，请把 PDF 文件放在列表第 1 个';
          if (files.length < 2) return '请再选择至少一个要嵌入的附件文件';
        }
        return '';
      },
      async run(ctx) {
        const mode = ctx.get('mode');
        const out = [];
        if (mode === 'add') {
          const pdfFile = ctx.files[0];
          const attachFiles = ctx.files.slice(1);
          if (!pdfFile || !/\.pdf$/i.test(pdfFile.name)) throw new Error('请把 PDF 文件放在第 1 个，其余文件作为附件');
          if (!attachFiles.length) throw new Error('请再选择要嵌入的附件文件');
          const doc = await loadPdfDoc(pdfFile);
          for (let i = 0; i < attachFiles.length; i++) {
            ctx.progress(i, attachFiles.length, `正在嵌入附件 ${i + 1}/${attachFiles.length}…`);
            const bytes = await attachFiles[i].arrayBuffer();
            await doc.attach(bytes, attachFiles[i].name, { mimeType: attachFiles[i].type || 'application/octet-stream' });
          }
          out.push({ name: `${baseName(pdfFile.name)}_带附件.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: `已嵌入 ${attachFiles.length} 个附件` });
          return out;
        }
        for (const file of ctx.files) {
          if (!/\.pdf$/i.test(file.name)) continue;
          const doc = await loadPdfDoc(file);
          if (mode === 'extract') {
            const files = listEmbeddedFiles(doc);
            if (!files.length) {
              out.push({ name: `${baseName(file.name)}_无附件.txt`, blob: new Blob(['该 PDF 无内嵌附件。'], { type: 'text/plain' }) });
            } else {
              for (const att of files) {
                out.push({
                  name: `附件_${sanitizeFileName(att.name)}`,
                  blob: bytesToBlob(att.bytes, 'application/octet-stream'),
                  meta: formatBytes(att.bytes.length),
                });
              }
            }
          } else {
            ctx.progress(0, 1, `正在删除 ${file.name} 的附件…`);
            const names = safeLookup(doc.catalog, 'Names', PDFLib.PDFDict);
            if (names && names.get(PDFLib.PDFName.of('EmbeddedFiles'))) {
              names.delete(PDFLib.PDFName.of('EmbeddedFiles'));
              out.push({ name: `${baseName(file.name)}_去附件.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: '附件已删除' });
            } else {
              out.push({ name: `${baseName(file.name)}_无附件.txt`, blob: new Blob(['该 PDF 无内嵌附件。'], { type: 'text/plain' }) });
            }
          }
        }
        return out;
      }
    },

    /* ---------- 加密解密与格式转换（借鉴 pdf.io） ---------- */
    {
      id: 'pdf-unlock', name: 'PDF 解密', cat: 'pdf', icon: 'eraser', minFiles: 1, accept: '.pdf',
      desc: '移除打开密码与权限限制，导出无密码 PDF。',
      keywords: '解密 unlock 移除密码 去密码 解除密码 破解',
      options: [
        { key: 'password', type: 'password', label: '打开密码', def: '', placeholder: '无密码可留空', autocomplete: 'current-password', hint: '加密文档的打开密码；仅有权限限制的文档可留空' },
      ],
      async run(ctx) {
        const out = [];
        const password = ctx.get('password') || '';
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在解密 ${file.name}…`);
          const buf = await file.arrayBuffer();
          const doc = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
          const enc = pdfReadEncryptInfo(doc);
          if (!enc) throw new Error(`${file.name} 未加密，无需解锁`);
          const fileKey = pdfDeriveFileKey(password, enc);
          if (!fileKey) throw new Error(`密码错误，请检查后重试（${file.name}）`);
          enc.fileKey = fileKey;
          pdfCryptWalk(doc, enc, false);
          delete doc.context.trailerInfo.Encrypt;
          ctx.progress(1, 1, `解密完成 ${file.name}`);
          out.push({ name: `${baseName(file.name)}_已解锁.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: '已移除密码保护' });
        }
        return out;
      }
    },
    {
      id: 'pdf-protect', name: 'PDF 加密', cat: 'pdf', icon: 'shield', minFiles: 1, accept: '.pdf',
      desc: '为 PDF 设置打开密码。',
      keywords: '加密 protect 密码保护 设置密码 加锁',
      options: [
        { key: 'password', type: 'password', label: '打开密码', def: '', placeholder: '请输入密码', required: true, autocomplete: 'new-password', hint: '打开文档时需要输入此密码，请妥善保存' },
      ],
      async run(ctx) {
        const password = (ctx.get('password') || '').trim();
        if (!password) throw new Error('请输入打开密码');
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在加密 ${file.name}…`);
          const doc = await loadPdfDoc(file);
          pdfEncryptDoc(doc, latin1ToBytes(password));
          ctx.progress(1, 1, `加密完成 ${file.name}`);
          // 加密文档必须禁用对象流：打包对象的内层字符串不单独加密，与逐对象加密冲突
          out.push({ name: `${baseName(file.name)}_加密.pdf`, blob: bytesToBlob(await doc.save({ useObjectStreams: false }), 'application/pdf'), meta: '已设置打开密码' });
        }
        return out;
      }
    },
    {
      id: 'pdf-to-word', name: 'PDF 转 Word', cat: 'pdf', icon: 'doc', minFiles: 1, accept: '.pdf',
      desc: '提取 PDF 文字内容生成可编辑的 Word 文档（.docx）。',
      keywords: '转Word word docx 导出word 文档转换',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const pages = await pdfPageLines(file);
          out.push({ name: `${baseName(file.name)}.docx`, blob: await buildDocxBlob(pages), meta: 'Word 文档' });
        }
        return out;
      }
    },
    {
      id: 'pdf-to-excel', name: 'PDF 转 Excel', cat: 'pdf', icon: 'grid', minFiles: 1, accept: '.pdf',
      desc: '提取 PDF 表格文字，生成 Excel。',
      keywords: '转Excel excel xlsx 表格 提取表格',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在分析 ${file.name}…`);
          const items = await pdfTextItems(file);
          const byPage = {};
          for (const it of items) (byPage[it.page] = byPage[it.page] || []).push(it);
          const sheets = Object.keys(byPage).map(pn => {
            const list = byPage[pn];
            const rowYs = clusterIdx(list.map(i => i.y), 4);
            const colXs = clusterIdx(list.map(i => i.x), 8);
            const grid = rowYs.map(ry => {
              const rowItems = list.filter(i => Math.abs(i.y - ry) <= 4);
              return colXs.map(rx =>
                rowItems.filter(i => Math.abs(i.x - rx) <= 8).sort((a, b) => a.x - b.x).map(i => i.str).join(' ').trim()
              );
            });
            return { name: '第' + pn + '页', grid, colWidths: colXs.map(() => 90) };
          });
          out.push({ name: `${baseName(file.name)}.xlsx`, blob: await buildXlsxBlob(sheets), meta: sheets.length + ' 个工作表' });
        }
        return out;
      }
    },
    {
      id: 'pdf-to-html', name: 'PDF 转 HTML', cat: 'pdf', icon: 'text', minFiles: 1, accept: '.pdf',
      desc: '将 PDF 每页转换为保留文字位置排版的 HTML 网页。',
      keywords: '转HTML html 网页 导出网页',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const doc = await loadPdfjsDoc(file);
          let body = '';
          for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const vp = page.getViewport({ scale: 1 });
            const tc = await page.getTextContent();
            let inner = '';
            for (const it of tc.items) {
              if (!it.str) continue;
              const t = it.transform || [1, 0, 0, 1, 0, 0];
              const size = Math.hypot(t[2], t[3]) || 10;
              inner += `<div class="t" style="left:${t[4].toFixed(1)}px;top:${(vp.height - t[5] - size).toFixed(1)}px;font-size:${size.toFixed(1)}px">${escapeHtml(it.str)}</div>`;
            }
            body += `<div class="page" style="width:${vp.width.toFixed(0)}px;height:${vp.height.toFixed(0)}px">${inner}</div>`;
          }
          const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escapeHtml(baseName(file.name))}</title><style>body{margin:0;background:#7c8290;font-family:"Microsoft YaHei",sans-serif}.page{position:relative;background:#fff;margin:14px auto;box-shadow:0 2px 12px rgba(0,0,0,.35);overflow:hidden}.t{position:absolute;white-space:pre;color:#000}</style></head><body>${body}</body></html>`;
          out.push({ name: `${baseName(file.name)}.html`, blob: new Blob([html], { type: 'text/html;charset=utf-8' }), meta: 'HTML 网页' });
        }
        return out;
      }
    },
    {
      id: 'word-to-pdf', name: 'Word 转 PDF', cat: 'pdf', icon: 'img2pdf', minFiles: 1, accept: '.docx',
      desc: '将 Word 文档转换为 PDF。',
      keywords: 'Word转PDF docx转PDF 文档转PDF',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          if (!/\.docx$/i.test(file.name)) throw new Error('仅支持 .docx 格式（旧版 .doc 请先另存为 .docx）');
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const paras = await parseDocxFile(file);
          out.push(...await renderParasToPdf(paras, `${baseName(file.name)}.pdf`));
        }
        return out;
      }
    },
    {
      id: 'excel-to-pdf', name: 'Excel 转 PDF', cat: 'pdf', icon: 'img2pdf', minFiles: 1, accept: '.xlsx',
      desc: '将 Excel 表格按工作表转为 PDF。',
      keywords: 'Excel转PDF xlsx转PDF 表格转PDF',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          if (!/\.xlsx$/i.test(file.name)) throw new Error('仅支持 .xlsx 格式（旧版 .xls 请先另存为 .xlsx）');
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const sheets = await parseXlsxFile(file);
          const doc = await PDFLib.PDFDocument.create();
          const PW = 842, PH = 595, colW = 110, rowH = 24, perPage = Math.floor((PH - 70) / rowH);
          for (const sheet of sheets) {
            const cols = sheet.grid.reduce((m, r) => Math.max(m, r.length), 1);
            for (let r0 = 0; r0 < Math.max(1, sheet.grid.length); r0 += perPage) {
              const { cv, c, scale } = makeOfficeCanvas(PW, PH);
              c.fillStyle = '#000';
              c.font = 'bold 22px "Microsoft YaHei", sans-serif';
              c.fillText(sheet.name, 24 * scale, 36 * scale);
              for (let ri = 0; ri < perPage && r0 + ri < sheet.grid.length; ri++) {
                const row = sheet.grid[r0 + ri] || [];
                const y = 56 + ri * rowH;
                for (let ci = 0; ci < cols; ci++) {
                  const x = 24 + ci * colW;
                  c.strokeStyle = '#999';
                  c.lineWidth = 1;
                  c.strokeRect(x * scale, y * scale, colW * scale, rowH * scale);
                  const txt = String(row[ci] || '').slice(0, 14);
                  if (txt) {
                    c.fillStyle = '#000';
                    c.font = '20px "Microsoft YaHei", sans-serif';
                    c.fillText(txt, (x + 5) * scale, (y + rowH * 0.68) * scale);
                  }
                }
              }
              const png = await canvasToBlob(cv, 'image/png');
              const page = doc.addPage([PW, PH]);
              page.drawImage(await doc.embedPng(await png.arrayBuffer()), { x: 0, y: 0, width: PW, height: PH });
            }
          }
          out.push({ name: `${baseName(file.name)}.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'ppt-to-pdf', name: 'PPT 转 PDF', cat: 'pdf', icon: 'img2pdf', minFiles: 1, accept: '.pptx',
      desc: '将 PPT 演示文稿按页转为 PDF。',
      keywords: 'PPT转PDF pptx转PDF 演示文稿转PDF 幻灯片',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          if (!/\.pptx$/i.test(file.name)) throw new Error('仅支持 .pptx 格式（旧版 .ppt 请先另存为 .pptx）');
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const { sw, sh, slides } = await parsePptxFile(file);
          if (!slides.length) throw new Error('未在 PPTX 中找到可转换的幻灯片');
          const doc = await PDFLib.PDFDocument.create();
          for (const slide of slides) {
            const { cv, c, scale } = makeOfficeCanvas(sw, sh);
            for (const im of (slide.images || [])) {
              try {
                const bitmap = await createImageBitmap(new Blob([im.bytes]));
                c.drawImage(bitmap, im.x * scale, im.y * scale,
                  Math.max(1, im.w * scale), Math.max(1, im.h * scale));
                if (bitmap.close) bitmap.close();
              } catch (e) { /* 跳过无法解码的图片 */ }
            }
            for (const sp of (slide.shapes || [])) {
              const fs = Math.max(10, Math.min(40, sp.h * 0.45));
              c.fillStyle = '#000';
              c.font = 'bold ' + Math.round(fs * scale) + 'px "Microsoft YaHei", sans-serif';
              c.textAlign = 'left';
              const maxW = Math.max(40, sp.w) * scale;
              let line = '', ty = (sp.y + fs * 1.1) * scale;
              for (const ch of Array.from(sp.text)) {
                if (line && c.measureText(line + ch).width > maxW) {
                  c.fillText(line, sp.x * scale, ty);
                  ty += fs * 1.35 * scale;
                  line = ch;
                } else line += ch;
              }
              if (line) c.fillText(line, sp.x * scale, ty);
            }
            const png = await canvasToBlob(cv, 'image/png');
            const page = doc.addPage([sw, sh]);
            page.drawImage(await doc.embedPng(await png.arrayBuffer()), { x: 0, y: 0, width: sw, height: sh });
          }
          out.push({ name: `${baseName(file.name)}.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },

    /* ---------- 补充工具（对标主流在线 PDF 工具站） ---------- */
    {
      id: 'pdf-reorder', name: '页面重排', cat: 'pdf', icon: 'layers', minFiles: 1, accept: '.pdf',
      desc: '按自定义顺序重新排列 PDF 页面，支持逆序、重复页与范围展开。',
      keywords: '重排 排序 排列 页面顺序 reorder 调整顺序',
      options: [
        { key: 'mode', type: 'select', label: '重排方式', def: 'custom', choices: [['custom', '自定义顺序'], ['reverse', '整份倒序']] },
        { key: 'order', type: 'text', label: '页面顺序', def: '', placeholder: '如：3,1,2 或 2-4,1', hint: '仅"自定义顺序"时生效；按输入顺序输出，可重复页码' },
      ],
      async run(ctx) {
        const out = [];
        const mode = ctx.get('mode');
        for (let fi = 0; fi < ctx.files.length; fi++) {
          const file = ctx.files[fi];
          ctx.progress(fi, ctx.files.length, `正在重排 ${file.name}…`);
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const order = mode === 'reverse'
            ? Array.from({ length: total }, (_, i) => total - i)
            : parseOrderList(ctx.get('order'), total);
          const doc = await PDFLib.PDFDocument.create();
          const pages = await doc.copyPages(src, order.map(p => p - 1));
          pages.forEach(p => doc.addPage(p));
          copyDocumentMetadata(doc, src);
          out.push({ name: `${baseName(file.name)}_重排.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-clean-meta', name: '清除元数据', cat: 'pdf', icon: 'broom', minFiles: 1, accept: '.pdf',
      desc: '删除标题、作者等文档属性与元数据。',
      keywords: '清除元数据 删除属性 隐私 metadata 清理信息 去属性',
      options: [
        { key: 'resetId', type: 'checkbox', label: '同时重置文档 ID', def: true },
      ],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在清理 ${file.name}…`);
          const doc = await loadPdfDoc(file);
          let cleared = 0;
          try {
            const info = doc.context.trailerInfo.Info;
            const infoDict = info instanceof PDFLib.PDFDict ? info : (info ? doc.context.lookup(info, PDFLib.PDFDict) : null);
            if (infoDict) {
              const keys = infoDict.keys();
              for (const k of keys) infoDict.delete(k);
              cleared += keys.length;
            }
          } catch (e) { /* ignore */ }
          try {
            if (doc.catalog.get(PDFLib.PDFName.of('Metadata'))) {
              doc.catalog.delete(PDFLib.PDFName.of('Metadata'));
              cleared++;
            }
          } catch (e) { /* ignore */ }
          if (ctx.get('resetId')) {
            try {
              const idArr = PDFLib.PDFArray.withContext(doc.context);
              idArr.push(PDFLib.PDFHexString.of(bytesToHex(secureRandom(16))));
              idArr.push(PDFLib.PDFHexString.of(bytesToHex(secureRandom(16))));
              doc.context.trailerInfo.ID = idArr;
              cleared++;
            } catch (e) { /* ignore */ }
          }
          out.push({ name: `${baseName(file.name)}_去元数据.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: `已清除 ${cleared} 项信息` });
        }
        return out;
      }
    },
    {
      id: 'pdf-grayscale', name: '灰度 PDF', cat: 'pdf', icon: 'image', minFiles: 1, accept: '.pdf',
      desc: '将 PDF 页面转为灰度。',
      keywords: '灰度 去色 黑白 grayscale 黑白化 变灰',
      options: [
        { key: 'scale', type: 'select', label: '渲染质量', def: '2', choices: [['1.5', '标准'], ['2', '清晰（推荐）'], ['3', '高清']] },
        { key: 'quality', type: 'number', label: '输出质量 (1-100)', def: 85, min: 10, max: 100 },
      ],
      async run(ctx) {
        const out = [];
        const scale = parseFloat(ctx.get('scale')) || 2;
        const quality = (parseInt(ctx.get('quality'), 10) || 85) / 100;
        for (let i = 0; i < ctx.files.length; i++) {
          const file = ctx.files[i];
          const blob = await rasterizePdfToBlob(file, { scale, quality, filter: 'grayscale(1)' },
            (d, t, text) => ctx.progress(i + d / t, ctx.files.length, text));
          out.push({ name: `${baseName(file.name)}_灰度.pdf`, blob, meta: '已转为灰度' });
        }
        return out;
      }
    },
    {
      id: 'pdf-longimg', name: 'PDF 转长图', cat: 'pdf', icon: 'scroll', minFiles: 1, accept: '.pdf',
      desc: '将 PDF 多页拼成一张长图。',
      keywords: '长图 拼接 长图导出 合成长图 longimage 转长图',
      options: [
        { key: 'format', type: 'select', label: '输出格式', def: 'jpeg', choices: [['jpeg', 'JPG（体积小）'], ['png', 'PNG（无损）']] },
        { key: 'dpi', type: 'select', label: '渲染分辨率', def: '150', choices: [['72', '72 DPI'], ['150', '150 DPI（推荐）'], ['300', '300 DPI']] },
        { key: 'quality', type: 'number', label: 'JPG 质量 (1-100)', def: 90, min: 10, max: 100 },
        { key: 'direction', type: 'select', label: '拼接方向', def: 'vertical', choices: [['vertical', '纵向拼接'], ['horizontal', '横向拼接']] },
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
      ],
      async run(ctx) {
        const out = [];
        const scale = (parseInt(ctx.get('dpi'), 10) || 150) / 72;
        const format = ctx.get('format') === 'png' ? 'image/png' : 'image/jpeg';
        const quality = (parseInt(ctx.get('quality'), 10) || 90) / 100;
        const vertical = ctx.get('direction') !== 'horizontal';
        for (let fi = 0; fi < ctx.files.length; fi++) {
          const file = ctx.files[fi];
          const src = await loadPdfjsDoc(file);
          const pages = parsePageRanges(ctx.get('range'), src.numPages);
          const canvases = [];
          for (let k = 0; k < pages.length; k++) {
            ctx.progress(fi + (k / pages.length) * 0.8, ctx.files.length, `正在渲染 ${file.name} 第 ${pages[k]} 页…`);
            canvases.push(await renderPageToCanvas(src, pages[k], scale, false));
          }
          const LIMIT = 28000;
          const W = vertical ? Math.max.apply(null, canvases.map(c => c.width)) : canvases.reduce((s, c) => s + c.width, 0);
          const H = vertical ? canvases.reduce((s, c) => s + c.height, 0) : Math.max.apply(null, canvases.map(c => c.height));
          const shrink = Math.min(1, LIMIT / W, LIMIT / H);
          const big = document.createElement('canvas');
          big.width = Math.max(1, Math.round(W * shrink));
          big.height = Math.max(1, Math.round(H * shrink));
          const c = big.getContext('2d');
          c.fillStyle = '#ffffff';
          c.fillRect(0, 0, big.width, big.height);
          let x = 0, y = 0;
          for (const cv of canvases) {
            const dw = cv.width * shrink, dh = cv.height * shrink;
            if (vertical) {
              c.drawImage(cv, 0, y, dw, dh);
              y += dh;
            } else {
              c.drawImage(cv, x, 0, dw, dh);
              x += dw;
            }
          }
          ctx.progress(fi + 0.9, ctx.files.length, `正在编码 ${file.name}…`);
          const blob = await canvasToBlob(big, format, quality);
          out.push({
            name: `${baseName(file.name)}_长图.${format === 'image/png' ? 'png' : 'jpg'}`,
            blob,
            meta: `${big.width} × ${big.height} px` + (shrink < 1 ? '（超限自动缩放）' : '')
          });
        }
        return out;
      }
    },
    {
      id: 'pdf-to-ppt', name: 'PDF 转 PPT', cat: 'pdf', icon: 'convert', minFiles: 1, accept: '.pdf',
      desc: '将 PDF 每页转为一张 PPT 幻灯片。',
      keywords: '转PPT pptx 幻灯片 PowerPoint 转演示 演示文稿',
      options: [
        { key: 'dpi', type: 'select', label: '渲染分辨率', def: '150', choices: [['96', '96 DPI'], ['150', '150 DPI（推荐）'], ['300', '300 DPI']] },
        { key: 'quality', type: 'number', label: 'JPG 质量 (1-100)', def: 88, min: 10, max: 100 },
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
      ],
      async run(ctx) {
        const out = [];
        const scale = (parseInt(ctx.get('dpi'), 10) || 150) / 72;
        const quality = (parseInt(ctx.get('quality'), 10) || 88) / 100;
        for (const file of ctx.files) {
          const src = await loadPdfjsDoc(file);
          const pages = parsePageRanges(ctx.get('range'), src.numPages);
          const images = [];
          for (let k = 0; k < pages.length; k++) {
            ctx.progress(k, pages.length, `正在渲染 ${file.name} 第 ${pages[k]} 页…`);
            const cv = await renderPageToCanvas(src, pages[k], scale, false);
            const jpg = await canvasToBlob(cv, 'image/jpeg', quality);
            images.push({ bytes: new Uint8Array(await jpg.arrayBuffer()), wPt: cv.width / scale, hPt: cv.height / scale });
          }
          const blob = await buildPptxBlob(images);
          out.push({ name: `${baseName(file.name)}.pptx`, blob, meta: `${images.length} 页幻灯片` });
        }
        return out;
      }
    },
    {
      id: 'pdf-to-md', name: 'PDF 转 Markdown', cat: 'pdf', icon: 'text', minFiles: 1, accept: '.pdf',
      desc: '提取 PDF 文字，导出 Markdown 文档。',
      keywords: '转Markdown md markdown 笔记 导出md',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const pages = await pdfStyledLines(file);
          const md = pages.map(rows => {
            const sizes = rows.map(r => r.size).sort((a, b) => a - b);
            const med = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;
            return rows.map(r => {
              const t = r.text;
              if (/^[•·▪◦]\s*/.test(t)) return '- ' + t.replace(/^[•·▪◦]\s*/, '');
              if (r.size >= med * 1.5) return '# ' + t;
              if (r.size >= med * 1.3) return '## ' + t;
              if (r.size >= med * 1.15 && t.length < 40) return '### ' + t;
              return t;
            }).join('\n\n');
          }).join('\n\n---\n\n');
          out.push({ name: `${baseName(file.name)}.md`, blob: new Blob([md], { type: 'text/markdown;charset=utf-8' }), meta: 'Markdown 文档' });
        }
        return out;
      }
    },
    {
      id: 'pdf-to-csv', name: 'PDF 转 CSV', cat: 'pdf', icon: 'grid', minFiles: 1, accept: '.pdf',
      desc: '提取 PDF 表格文字，导出 CSV。',
      keywords: '转CSV csv 表格数据 提取表格 数据导出',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在分析 ${file.name}…`);
          const items = await pdfTextItems(file);
          const byPage = {};
          for (const it of items) (byPage[it.page] = byPage[it.page] || []).push(it);
          const esc = v => {
            const s = String(v == null ? '' : v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          };
          const parts = [];
          Object.keys(byPage).forEach((pn, idx) => {
            const list = byPage[pn];
            const rowYs = clusterIdx(list.map(i => i.y), 4);
            const colXs = clusterIdx(list.map(i => i.x), 8);
            if (idx > 0) parts.push('');
            rowYs.forEach(ry => {
              const rowItems = list.filter(i => Math.abs(i.y - ry) <= 4);
              const row = colXs.map(rx =>
                rowItems.filter(i => Math.abs(i.x - rx) <= 8).sort((a, b) => a.x - b.x).map(i => i.str).join(' ').trim()
              );
              parts.push(row.map(esc).join(','));
            });
          });
          out.push({ name: `${baseName(file.name)}.csv`, blob: new Blob(['\ufeff' + parts.join('\r\n')], { type: 'text/csv;charset=utf-8' }), meta: 'CSV 表格' });
        }
        return out;
      }
    },
    {
      id: 'pdf-to-rtf', name: 'PDF 转 RTF', cat: 'pdf', icon: 'doc', minFiles: 1, accept: '.pdf',
      desc: '提取 PDF 文字生成 RTF 富文本。',
      keywords: '转RTF rtf 富文本 word打开',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const pages = await pdfPageLines(file);
          const body = pages.map(lines =>
            lines.map(l => rtfEscape(l) + '\\par ').join('')
          ).join('\\page ');
          const rtf = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 Microsoft YaHei;}}\\viewkind4\\uc1\\f0\\fs22 ' + body + '}';
          out.push({ name: `${baseName(file.name)}.rtf`, blob: new Blob([rtf], { type: 'application/rtf' }), meta: 'RTF 富文本' });
        }
        return out;
      }
    },
    {
      id: 'pdf-repair', name: '修复 PDF', cat: 'pdf', icon: 'wand', minFiles: 1, accept: '.pdf',
      desc: '修复无法打开或结构损坏的 PDF。',
      keywords: '修复 修复PDF repair 损坏 打不开 纠错 还原',
      options: [
        { key: 'mode', type: 'select', label: '修复方式', def: 'auto', choices: [['auto', '自动（先修复结构，失败则重建）'], ['resave', '仅重新保存（保留文字）'], ['rebuild', '整页重绘（兼容性最强）']] },
        { key: 'scale', type: 'select', label: '重建质量', def: '2', choices: [['1.5', '标准'], ['2', '清晰（推荐）'], ['3', '高清']], hint: '仅"整页重绘"时生效' },
      ],
      async run(ctx) {
        const out = [];
        const mode = ctx.get('mode') || 'auto';
        const scale = parseFloat(ctx.get('scale')) || 2;
        for (let i = 0; i < ctx.files.length; i++) {
          const file = ctx.files[i];
          ctx.progress(i, ctx.files.length, `正在修复 ${file.name}…`);
          if (mode !== 'rebuild') {
            try {
              const doc = await loadPdfDoc(file);
              const bytes = await doc.save();
              out.push({ name: `${baseName(file.name)}_修复.pdf`, blob: bytesToBlob(bytes, 'application/pdf'), meta: '结构已重新保存' });
              continue;
            } catch (e) {
              if (mode === 'resave') throw new Error(`${file.name} 结构修复失败：${e.message}`);
            }
          }
          const blob = await rasterizePdfToBlob(file, { scale, quality: 0.85 },
            (d, t, text) => ctx.progress(i + d / t, ctx.files.length, text));
          out.push({ name: `${baseName(file.name)}_修复.pdf`, blob, meta: '已整页重绘重建' });
        }
        return out;
      }
    },
    {
      id: 'pdf-form-fill', name: 'PDF 表单填写', cat: 'pdf', icon: 'tag', minFiles: 1, accept: '.pdf',
      desc: '填写 PDF 表单，或导出字段清单。',
      keywords: '表单 填写 form 填表 AcroForm 字段 申请表',
      options: [
        { key: 'mode', type: 'select', label: '操作方式', def: 'fill', choices: [['fill', '按映射填写表单'], ['list', '导出字段清单']] },
        { key: 'mapping', type: 'textarea', label: '字段映射', def: '', placeholder: '每行一条：字段名=值', hint: '复选框可填 true/false' },
        { key: 'flatten', type: 'checkbox', label: '填写后扁平化（不可再编辑）', def: false },
      ],
      async run(ctx) {
        const out = [];
        const mode = ctx.get('mode') || 'fill';
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const form = doc.getForm();
          const fields = form.getFields();
          if (mode === 'list') {
            const typeName = f => {
              if (f instanceof PDFLib.PDFTextField) return '文本框';
              if (f instanceof PDFLib.PDFCheckBox) return '复选框';
              if (f instanceof PDFLib.PDFRadioGroup) return '单选组';
              if (f instanceof PDFLib.PDFDropdown) return '下拉框';
              return '按钮/其他';
            };
            const text = fields.length
              ? fields.map(f => `${f.getName()}\t${typeName(f)}`).join('\n')
              : '（该 PDF 不含交互表单字段）';
            out.push({ name: `${baseName(file.name)}_字段清单.txt`, blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), meta: `${fields.length} 个字段` });
            continue;
          }
          const lines = String(ctx.get('mapping') || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          if (!lines.length) throw new Error('请填写字段映射（每行一条：字段名=值）');
          let filled = 0;
          const missing = [];
          for (const line of lines) {
            const eq = line.indexOf('=');
            if (eq <= 0) continue;
            const name = line.slice(0, eq).trim();
            const value = line.slice(eq + 1).trim();
            let f = null;
            try { f = form.getField(name); } catch (e) { missing.push(name); continue; }
            try {
              if (f instanceof PDFLib.PDFCheckBox) {
                if (/^(true|1|y|yes|on|是)$/i.test(value)) f.check(); else f.uncheck();
              } else if (f instanceof PDFLib.PDFTextField) {
                f.setText(value);
              } else if (f instanceof PDFLib.PDFDropdown || f instanceof PDFLib.PDFRadioGroup) {
                f.select(value);
              } else {
                missing.push(name + '（类型不支持）');
                continue;
              }
              filled++;
            } catch (e) {
              missing.push(name + '（' + e.message + '）');
            }
          }
          if (!filled) throw new Error('没有成功填写任何字段：' + (missing.join('；') || '请检查映射格式'));
          if (ctx.get('flatten')) form.flatten();
          out.push({
            name: `${baseName(file.name)}_表单填写.pdf`,
            blob: bytesToBlob(await doc.save(), 'application/pdf'),
            meta: `已填写 ${filled} 项` + (missing.length ? `，${missing.length} 项未匹配` : '')
          });
        }
        return out;
      }
    },
    {
      id: 'pdf-sign', name: 'PDF 签名', cat: 'pdf', icon: 'pen', minFiles: 1, accept: '.pdf',
      desc: '在 PDF 上添加图片或文字签名。',
      keywords: '签名 签署 手写签名 电子签名 sign 签字',
      options: [
        { key: 'mode', type: 'select', label: '签名方式', def: 'image', choices: [['image', '上传签名图片'], ['text', '文字签名']] },
        { key: 'sigFile', type: 'file', label: '签名图片', accept: IMAGE_ACCEPT, requiredWhen: { mode: 'image' }, visibleWhen: { mode: 'image' }, hint: `支持 ${IMAGE_FORMAT_LABEL}，建议使用透明背景 PNG` },
        { key: 'sigText', type: 'text', label: '签名文字', def: '手写签名', placeholder: '输入签名文字', requiredWhen: { mode: 'text' }, visibleWhen: { mode: 'text' } },
        { key: 'pages', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面', advanced: true },
        { key: 'position', type: 'select', label: '签名位置', def: 'bottom-right', choices: [['bottom-right', '右下角'], ['bottom-left', '左下角'], ['top-right', '右上角'], ['top-left', '左上角'], ['center', '页面居中']] },
        { key: 'widthPct', type: 'number', label: '宽度（占页宽 %）', def: 25, min: 5, max: 100 },
        { key: 'opacity', type: 'number', label: '不透明度 %', def: 100, min: 10, max: 100 },
      ],
      async run(ctx) {
        const out = [];
        const mode = ctx.get('mode') || 'image';
        const widthPct = Math.min(100, Math.max(5, parseFloat(ctx.get('widthPct')) || 25)) / 100;
        const opacity = Math.min(1, Math.max(0.1, (parseFloat(ctx.get('opacity')) || 100) / 100));
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          const pages = parsePageRanges(ctx.get('pages'), total);
          let img;
          if (mode === 'text') {
            const text = ctx.get('sigText') || '手写签名';
            const cv = makeTextImage(text, { fontPx: 120, color: '#1a3b8c', bold: true, pad: 24 });
            img = await doc.embedPng(await (await canvasToBlob(cv, 'image/png')).arrayBuffer());
          } else {
            const sigFile = ctx.get('sigFile');
            if (!sigFile) throw new Error('请先上传签名图片（或将签名方式切换为"文字签名"）');
            img = await embedImageFile(doc, sigFile);
          }
          for (let k = 0; k < pages.length; k++) {
            ctx.progress(k, pages.length, `正在签名 ${file.name} 第 ${pages[k]} 页…`);
            const page = doc.getPage(pages[k] - 1);
            const { width, height } = page.getSize();
            const w = width * widthPct;
            const h = w * img.height / img.width;
            const margin = 24;
            const pos = ctx.get('position') || 'bottom-right';
            let x = (width - w) / 2, y = (height - h) / 2;
            if (pos === 'bottom-right') { x = width - w - margin; y = margin; }
            else if (pos === 'bottom-left') { x = margin; y = margin; }
            else if (pos === 'top-right') { x = width - w - margin; y = height - h - margin; }
            else if (pos === 'top-left') { x = margin; y = height - h - margin; }
            page.drawImage(img, { x, y, width: w, height: h, opacity });
          }
          out.push({ name: `${baseName(file.name)}_签名.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-redact', name: '涂黑遮盖（密文）', cat: 'pdf', icon: 'eraser', minFiles: 1, accept: '.pdf',
      desc: '用色块遮盖敏感内容，可彻底固化。',
      keywords: '涂黑 遮盖 密文 脱敏 涂白 redact 敏感信息 删除文字 去水印',
      options: [
        { key: 'rects', type: 'textarea', label: '遮盖区域', def: '', placeholder: '每行一个：页码:左,上,宽,高（百分比）\n例：1:10,20,40,15\n页码可为 1-3 或 *（全部页面）', hint: '坐标为页面宽高的百分比' },
        { key: 'color', type: 'select', label: '遮盖颜色', def: 'black', choices: [['black', '黑色（涂黑）'], ['white', '白色（涂白）']] },
        { key: 'mode', type: 'select', label: '输出方式', def: 'flatten', choices: [['flatten', '固化（安全，遮盖内容不可恢复）'], ['cover', '仅覆盖（保留文字，文件小）']] },
      ],
      async run(ctx) {
        const out = [];
        const raw = String(ctx.get('rects') || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (!raw.length) throw new Error('请至少输入一个遮盖区域');
        const rects = raw.map((line, idx) => {
          const m = line.match(/^([^:：]+)\s*[:：]\s*([\d.]+)\s*[,，]\s*([\d.]+)\s*[,，]\s*([\d.]+)\s*[,，]\s*([\d.]+)$/);
          if (!m) throw new Error(`第 ${idx + 1} 行格式错误：${line}`);
          return { spec: m[1].trim(), l: parseFloat(m[2]), t: parseFloat(m[3]), w: parseFloat(m[4]), h: parseFloat(m[5]) };
        });
        const isWhite = ctx.get('color') === 'white';
        for (let fi = 0; fi < ctx.files.length; fi++) {
          const file = ctx.files[fi];
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          let drawn = 0;
          for (const r of rects) {
            const pages = r.spec === '*' ? Array.from({ length: total }, (_, i) => i + 1) : parsePageRanges(r.spec, total);
            for (const pn of pages) {
              const page = doc.getPage(pn - 1);
              const { width, height } = page.getSize();
              const x = width * r.l / 100;
              const w = width * r.w / 100;
              const top = height * r.t / 100;
              const h = height * r.h / 100;
              page.drawRectangle({
                x, y: height - top - h, width: w, height: h,
                color: isWhite ? PDFLib.rgb(1, 1, 1) : PDFLib.rgb(0, 0, 0),
              });
              drawn++;
            }
          }
          ctx.progress(fi, ctx.files.length, `正在输出 ${file.name}…`);
          let blob = bytesToBlob(await doc.save(), 'application/pdf');
          let meta = `已遮盖 ${drawn} 处`;
          if (ctx.get('mode') === 'flatten') {
            blob = await rasterizePdfToBlob(blob, { scale: 2, quality: 0.9 });
            meta += '（已固化）';
          }
          out.push({ name: `${baseName(file.name)}_遮盖.pdf`, blob, meta });
        }
        return out;
      }
    },
    {
      id: 'pdf-header-footer', name: '页眉页脚', cat: 'pdf', icon: 'hash', minFiles: 1, accept: '.pdf',
      desc: '批量添加页眉页脚，支持页码变量。',
      keywords: '页眉 页脚 header footer 页眉页脚 批注页码',
      options: [
        { key: 'header', type: 'text', label: '页眉文字', def: '', placeholder: '留空不添加；支持 {n} {total} {file}' },
        { key: 'headerPos', type: 'select', label: '页眉位置', def: 'center', choices: [['left', '左侧'], ['center', '居中'], ['right', '右侧']] },
        { key: 'footer', type: 'text', label: '页脚文字', def: '第 {n} 页 / 共 {total} 页', placeholder: '留空不添加；支持 {n} {total} {file}' },
        { key: 'footerPos', type: 'select', label: '页脚位置', def: 'center', choices: [['left', '左侧'], ['center', '居中'], ['right', '右侧']] },
        { key: 'fontPx', type: 'number', label: '字号 (px)', def: 24, min: 10, max: 120 },
        { key: 'color', type: 'color', label: '文字颜色', def: '#666666' },
        { key: 'margin', type: 'number', label: '边距 (pt)', def: 20, min: 4, max: 100 },
        { key: 'skipFirst', type: 'checkbox', label: '封面（首页）不显示', def: false },
      ],
      async run(ctx) {
        const out = [];
        const fontPx = parseInt(ctx.get('fontPx'), 10) || 24;
        const color = ctx.get('color') || '#666666';
        const margin = Math.max(4, parseFloat(ctx.get('margin')) || 20);
        const skipFirst = !!ctx.get('skipFirst');
        const header = ctx.get('header') || '';
        const footer = ctx.get('footer') || '';
        if (!header && !footer) throw new Error('请至少填写页眉或页脚文字');
        const fmt = (tpl, n, total, name) => tpl.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total)).replace(/\{file\}/g, name);
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在添加页眉页脚 ${i + 1}/${total}…`);
            if (skipFirst && i === 0) continue;
            const page = doc.getPage(i);
            const { width, height } = page.getSize();
            const draw = async (tpl, pos, isTop) => {
              if (!tpl) return;
              const text = fmt(tpl, i + 1, total, baseName(file.name));
              const cv = makeTextImage(text, { fontPx, color, bold: false });
              const img = await doc.embedPng(await (await canvasToBlob(cv, 'image/png')).arrayBuffer());
              const scale = 0.75;
              const w = cv.width * scale, h = cv.height * scale;
              let x = (width - w) / 2;
              if (pos === 'left') x = margin;
              if (pos === 'right') x = width - w - margin;
              const y = isTop ? height - h - margin : margin;
              page.drawImage(img, { x, y, width: w, height: h, opacity: 0.9 });
            };
            await draw(header, ctx.get('headerPos') || 'center', true);
            await draw(footer, ctx.get('footerPos') || 'center', false);
          }
          out.push({ name: `${baseName(file.name)}_页眉页脚.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
    {
      id: 'pdf-del-images', name: '删除图片', cat: 'pdf', icon: 'trash', minFiles: 1, accept: '.pdf',
      desc: '删除 PDF 页面中的内嵌图片。',
      keywords: '删除图片 移除图片 去图 清除图片 del-images',
      options: [
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
      ],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          const pages = parsePageRanges(ctx.get('range'), total);
          let removed = 0;
          // 用一张 1×1 全透明图片替换被删除的 XObject，而不是直接删掉资源键：
          // 页面内容流里仍有 /ImN Do 指令，直接删除会留下悬空引用，部分阅读器会报错。
          let blankRef = null;
          const getBlankRef = async () => {
            if (blankRef) return blankRef;
            const cv = document.createElement('canvas');
            cv.width = 1; cv.height = 1;
            cv.getContext('2d').clearRect(0, 0, 1, 1);
            const blob = await canvasToBlob(cv, 'image/png');
            blankRef = blob ? (await doc.embedPng(await blob.arrayBuffer())).ref : null;
            return blankRef;
          };
          const getPageXObject = page => {
            let res = null;
            try { res = page.node.Resources(); } catch (e) { res = null; }
            if (!res && typeof page.node.InheritableResources === 'function') {
              try { res = page.node.InheritableResources(); } catch (e) { /* ignore */ }
            }
            return res ? safeLookup(res, 'XObject', PDFLib.PDFDict) : null;
          };
          const seenDicts = new Set();
          const orphanRefs = new Map();
          for (const pn of pages) {
            ctx.progress(pn - 1, total, `正在处理 ${file.name} 第 ${pn} 页…`);
            const xobj = getPageXObject(doc.getPage(pn - 1));
            if (!xobj || seenDicts.has(xobj)) continue;
            seenDicts.add(xobj);
            const keys = xobj.keys();
            for (const key of keys) {
              let sub = '', st = null;
              try {
                st = xobj.get(key);
                // XObject 字典的值通常是间接引用（PDFRef），必须先解析成流对象
                // 才能读取 /Subtype；否则会漏掉所有图片。
                const obj = st && st.dict instanceof PDFLib.PDFDict ? st : doc.context.lookup(st);
                const dict = obj && obj.dict instanceof PDFLib.PDFDict ? obj.dict
                  : (obj instanceof PDFLib.PDFDict ? obj : null);
                if (dict) {
                  const s = dict.get(PDFLib.PDFName.of('Subtype'));
                  sub = s ? String(s).replace(/^\//, '') : '';
                }
              } catch (e) { /* ignore */ }
              if (sub !== 'Image') continue;
              const blank = await getBlankRef();
              if (blank) xobj.set(key, blank);
              else xobj.delete(key);
              if (st instanceof PDFLib.PDFRef) orphanRefs.set(String(st), st);
              removed++;
            }
          }
          // 真正移除不再被任何页面引用的原始图片对象，否则图片数据仍留在文件里，体积不减。
          if (orphanRefs.size) {
            const stillUsed = new Set();
            for (let i = 0; i < total; i++) {
              const xobj = getPageXObject(doc.getPage(i));
              if (!xobj) continue;
              for (const key of xobj.keys()) {
                const v = xobj.get(key);
                if (v instanceof PDFLib.PDFRef) stillUsed.add(String(v));
              }
            }
            for (const [key, ref] of orphanRefs) {
              if (stillUsed.has(key)) continue;
              try { doc.context.delete(ref); } catch (e) { /* ignore */ }
            }
          }
          out.push({
            name: `${baseName(file.name)}_删图.pdf`,
            blob: bytesToBlob(await doc.save(), 'application/pdf'),
            meta: `已删除 ${removed} 张图片`
          });
        }
        return out;
      }
    },
    {
      id: 'text-to-pdf', name: '文本文档转 PDF', cat: 'pdf', icon: 'doc', minFiles: 1, accept: '.txt,.md,.markdown,.csv,.html,.htm',
      desc: '将 TXT / Markdown / CSV / HTML 转为 PDF。',
      keywords: 'TXT转PDF MD转PDF CSV转PDF HTML转PDF 文本转PDF 记事本 转PDF',
      options: [
        { key: 'fontSize', type: 'number', label: '正文字号 (pt)', def: 12, min: 8, max: 36 },
      ],
      async run(ctx) {
        const out = [];
        const fontSize = Math.min(36, Math.max(8, parseFloat(ctx.get('fontSize')) || 12));
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const text = await file.text();
          const isCsv = /\.csv$/i.test(file.name);
          const isHtml = /\.html?$/i.test(file.name);
          const isMd = /\.(md|markdown)$/i.test(file.name);
          if (isCsv) {
            const grid = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(l => l.trim()).map(line => {
              const cells = [];
              let cur = '', inQ = false;
              for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (inQ) {
                  if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                  else if (ch === '"') inQ = false;
                  else cur += ch;
                } else if (ch === '"') inQ = true;
                else if (ch === ',') { cells.push(cur); cur = ''; }
                else cur += ch;
              }
              cells.push(cur);
              return cells;
            });
            out.push(...await renderGridToPdf(grid, `${baseName(file.name)}.pdf`));
            continue;
          }
          let paras;
          if (isHtml) {
            paras = [];
            const dom = new DOMParser().parseFromString(text, 'text/html');
            const BLOCK_CHILDREN = 'p,div,section,article,header,footer,main,aside,ul,ol,li,table,tr,td,th,blockquote,pre,h1,h2,h3,h4,h5,h6';
            const walk = el => {
              for (const child of Array.from(el.children || [])) {
                const tag = (child.tagName || '').toLowerCase();
                if (tag === 'script' || tag === 'style' || tag === 'head') continue;
                // 只有包含块级子元素时才继续展开；内联子元素（<b>/<span>/<a> 等）
                // 的文本属于当前段落，必须整段读取，否则 "Hello <b>World</b>" 会丢掉前半句。
                const hasBlockChild = child.querySelector && child.querySelector(BLOCK_CHILDREN);
                if (hasBlockChild) { walk(child); continue; }
                const t = (child.textContent || '').replace(/\s+/g, ' ').trim();
                if (!t) continue;
                const h = tag.match(/^h([1-6])$/);
                if (h) { paras.push({ text: t, bold: true, size: Math.max(12, 24 - parseInt(h[1], 10) * 2) }); continue; }
                if (tag === 'li') { paras.push({ text: '• ' + t, size: fontSize }); continue; }
                paras.push({ text: t, size: fontSize });
              }
            };
            walk(dom.body || dom.documentElement);
            if (!paras.length) paras = [{ text: text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), size: fontSize }];
          } else if (isMd) {
            paras = [];
            for (const raw of text.split(/\r?\n/)) {
              const line = raw.trimEnd();
              if (!line.trim()) { paras.push({ text: '', size: fontSize * 0.7 }); continue; }
              const h = line.match(/^(#{1,6})\s+(.*)/);
              if (h) { paras.push({ text: h[2].replace(/\*\*(.+?)\*\*/g, '$1'), bold: true, size: Math.max(12, fontSize + 10 - h[1].length * 2) }); continue; }
              const li = line.match(/^\s*[-*+]\s+(.*)/);
              if (li) { paras.push({ text: '• ' + li[1].replace(/\*\*(.+?)\*\*/g, '$1'), size: fontSize }); continue; }
              paras.push({ text: line.replace(/\*\*(.+?)\*\*/g, '$1'), size: fontSize });
            }
          } else {
            paras = text.split(/\r?\n/).map(l => ({ text: l, size: fontSize }));
          }
          out.push(...await renderParasToPdf(paras, `${baseName(file.name)}.pdf`));
        }
        return out;
      }
    },
  ];

  /* ============================================================
     5.1 工具卡片展示顺序：按功能聚类 + 常用度降序
     TOOLS 只作为功能实现注册表；卡片展示顺序在此集中定义，便于调整。
     未在表中列出的新工具按注册表原顺序追加到末尾，不会遗漏。
     ============================================================ */
  const TOOL_ORDER = [
    // 1. 合并拆分与页面管理
    'pdf-merge', 'pdf-split', 'pdf-pages', 'pdf-reorder',
    'pdf-rotate', 'pdf-crop', 'pdf-page-size', 'pdf-spread',
    'pdf-nup', 'pdf-booklet', 'pdf-longpage', 'pdf-overlay',
    'pdf-autorotate', 'pdf-blank',

    // 2. 格式转换：PDF 与 Office / 文本 / 图片互转
    'pdf-to-word', 'word-to-pdf', 'pdf-to-img', 'img-to-pdf',
    'pdf-to-excel', 'excel-to-pdf', 'pdf-to-ppt', 'ppt-to-pdf',
    'pdf-to-text', 'text-to-pdf', 'pdf-to-html', 'pdf-to-md',
    'pdf-to-csv', 'pdf-to-rtf', 'pdf-longimg', 'img-convert',
    'img-base64', 'img-to-word', 'img-to-ico',

    // 3. 压缩与优化
    'pdf-compress', 'img-compress', 'img-compress-size', 'img-dpi',
    'pdf-grayscale', 'pdf-scanfx', 'pdf-repair',

    // 4. 水印、页码与内容标注
    'pdf-textwm', 'pdf-imgwm', 'img-watermark', 'pdf-pagenum',
    'pdf-header-footer', 'pdf-add-text', 'pdf-add-image',
    'pdf-sign', 'pdf-form-fill',

    // 5. 图片编辑
    'img-resize', 'img-crop', 'img-rotate', 'img-editor', 'img-meme',
    'img-upscale', 'img-remove-bg', 'img-frame', 'img-mask', 'img-idphoto',
    'img-merge', 'img-split', 'img-compare',

    // 6. 内容提取与文档信息
    'pdf-extract-images', 'pdf-info', 'img-exif', 'img-info', 'img-rename',
    'pdf-meta', 'pdf-compare', 'pdf-auto-rename', 'pdf-attachments',

    // 7. 安全、加密与隐私清理
    'pdf-unlock', 'pdf-protect', 'pdf-redact', 'pdf-sanitize',
    'pdf-flatten', 'pdf-clean-meta', 'pdf-remove-annots', 'pdf-del-images',
  ];

  /* 功能簇：TOOL_ORDER 的分组语义在此显式化。
     首页按分类大标题 + 功能簇小标题两层呈现，避免 54 张 PDF 卡片连成一整片。
     簇内未列出的新工具会自动落到「其他」组，不会遗漏。 */
  const TOOL_CLUSTERS = [
    {
      title: '合并与页面管理',
      ids: ['pdf-merge', 'pdf-split', 'pdf-pages', 'pdf-reorder', 'pdf-rotate', 'pdf-crop',
        'pdf-page-size', 'pdf-spread', 'pdf-nup', 'pdf-booklet', 'pdf-longpage', 'pdf-overlay',
        'pdf-autorotate', 'pdf-blank'],
    },
    {
      title: '格式转换',
      ids: ['pdf-to-word', 'word-to-pdf', 'pdf-to-img', 'img-to-pdf', 'pdf-to-excel', 'excel-to-pdf',
        'pdf-to-ppt', 'ppt-to-pdf', 'pdf-to-text', 'text-to-pdf', 'pdf-to-html', 'pdf-to-md',
        'pdf-to-csv', 'pdf-to-rtf', 'pdf-longimg', 'img-convert', 'img-base64', 'img-to-word',
        'img-to-ico'],
    },
    {
      title: '压缩与优化',
      ids: ['pdf-compress', 'img-compress', 'img-compress-size', 'img-dpi', 'pdf-grayscale',
        'pdf-scanfx', 'pdf-repair'],
    },
    {
      title: '水印与标注',
      ids: ['pdf-textwm', 'pdf-imgwm', 'img-watermark', 'pdf-pagenum', 'pdf-header-footer',
        'pdf-add-text', 'pdf-add-image', 'pdf-sign', 'pdf-form-fill'],
    },
    {
      title: '图片编辑',
      ids: ['img-resize', 'img-crop', 'img-rotate', 'img-editor', 'img-meme', 'img-upscale',
        'img-remove-bg', 'img-frame', 'img-mask', 'img-idphoto', 'img-merge', 'img-split',
        'img-compare'],
    },
    {
      title: '内容提取与信息',
      ids: ['pdf-extract-images', 'pdf-info', 'img-exif', 'img-info', 'img-rename', 'pdf-meta',
        'pdf-compare', 'pdf-auto-rename', 'pdf-attachments'],
    },
    {
      title: '安全与隐私清理',
      ids: ['pdf-unlock', 'pdf-protect', 'pdf-redact', 'pdf-sanitize', 'pdf-flatten',
        'pdf-clean-meta', 'pdf-remove-annots', 'pdf-del-images'],
    },
  ];

  /* 卡片短提示：只给名称有歧义、彼此易混淆或存在使用限制的工具。
     其余工具名称已自解释，首页不再铺满灰色小字；完整说明仍在
     TOOLS[].desc（title / aria-label / 工作区头部 / 搜索索引）。
     与 options[].hint 无关，集中在此便于审阅，值控制在窄屏一行内。 */
  const TOOL_HINTS = {
    'pdf-longpage': '输出仍是一页 PDF',
    'pdf-longimg': '输出一张长图片',
    'pdf-meta': '查看或修改标题、作者',
    'pdf-info': '只读查看，可导出报告',
    'pdf-clean-meta': '删除标题、作者等属性',
    'pdf-overlay': '逐页叠加，不是拼接',
    'pdf-nup': '多页缩印到一页',
    'pdf-booklet': '按打印顺序重排',
    'pdf-spread': '扫描对开页一分为二',
    'pdf-sanitize': '移除脚本与内嵌附件',
    'pdf-flatten': '固化批注与表单域',
    'pdf-redact': '可彻底抹除底层内容',
    'pdf-to-word': '提取文字，不还原版式',
    'pdf-to-excel': '提取表格文字',
    'pdf-to-html': '保留文字位置排版',
    'text-to-pdf': 'TXT/MD/CSV/HTML',
    'img-dpi': '改打印 DPI，不改像素',
    'img-compress-size': '按目标 KB 自动压缩',
    'img-remove-bg': '仅适用于纯色背景',
  };

  const ORDERED_TOOLS = (() => {
    const byId = new Map(TOOLS.map(t => [t.id, t]));
    const seen = new Set();
    const ordered = [];
    for (const id of TOOL_ORDER) {
      if (seen.has(id) || !byId.has(id)) continue;
      seen.add(id);
      ordered.push(byId.get(id));
    }
    ordered.push(...TOOLS.filter(t => !seen.has(t.id)));
    return ordered;
  })();

  /* ============================================================
     6. 状态与 DOM
     ============================================================ */
  function loadFileViewMode() {
    try { return localStorage.getItem('officetoolbox.fileViewMode') === 'grid' ? 'grid' : 'list'; }
    catch (e) { return 'list'; }
  }

  const state = {
    tool: null,
    files: [],
    results: [],
    busy: false,
    cat: 'all',
    keyword: '',
    fileView: loadFileViewMode(),
    options: {},          // 当前表单值镜像，避免只能从 DOM 反查状态
    optionSchema: [],     // 当前工具的表单定义（schema 驱动）
    controller: null,     // 正在运行任务的 AbortController
    taskId: 0,            // 隔离已放弃/已切换工具的异步任务结果
    route: '',            // 最近一次写入地址栏的内部路由
  };

  const $ = id => document.getElementById(id);
  const homeView = $('homeView');
  const workspaceView = $('workspaceView');
  const toolGrid = $('toolGrid');
  const noResult = $('noResult');
  const searchResultStatus = $('searchResultStatus');
  const toolSearch = $('toolSearch');
  const headerNav = $('headerNav');
  const wsBackBtn = $('wsBackBtn');
  const wsCrumbCat = $('wsCrumbCat');
  const wsCrumbName = $('wsCrumbName');
  const wsIcon = $('wsIcon');
  const wsTitle = $('wsTitle');
  const wsDesc = $('wsDesc');
  const wsDropzone = $('wsDropzone');
  const wsFileInput = $('wsFileInput');
  const wsDropzoneText = $('wsDropzoneText');
  const wsDropzoneHint = $('wsDropzoneHint');
  const wsFileSummary = $('wsFileSummary');
  const wsFileList = $('wsFileList');
  const fileViewListBtn = $('fileViewListBtn');
  const fileViewGridBtn = $('fileViewGridBtn');
  const wsCols = $('wsCols');
  const wsOptions = $('wsOptions');
  const wsRunBtn = $('wsRunBtn');
  const wsRunHint = $('wsRunHint');
  const wsZipBtn = $('wsZipBtn');
  const wsProgress = $('wsProgress');
  const wsProgressBar = $('wsProgressBar');
  const wsProgressText = $('wsProgressText');
  const wsProgressPct = $('wsProgressPct');
  const wsProgressFill = $('wsProgressFill');
  const wsViewResultsBtn = $('wsViewResultsBtn');
  const wsResultsSection = $('wsResultsSection');
  const wsResultsCount = $('wsResultsCount');
  const wsResultsMeta = $('wsResultsMeta');
  const wsResultsGrid = $('wsResultsGrid');

  /* ============================================================
     7. 工具网格渲染 / 搜索 / 分类
     ============================================================ */
  /* ---- 最近使用 / 自定义置顶（localStorage 持久化，应用更新后保留） ---- */
  const PINNED_KEY = 'officetoolbox.pinned';
  const RECENT_KEY = 'officetoolbox.recent';
  const RECENT_MAX = CONFIG.recentMax;
  const recentSection = $('recentSection');
  const pinnedSection = $('pinnedSection');
  const recentRow = $('recentRow');
  const pinnedRow = $('pinnedRow');
  const recentClearBtn = $('recentClearBtn');
  const catChips = $('catChips');
  const searchBox = $('searchBox');
  const searchClearBtn = $('searchClearBtn');
  let dragPinnedIdx = -1;

  function loadIdList(key) {
    try {
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      // 过滤掉已不存在的工具 id，保证旧版本数据在更新后仍可用
      return Array.isArray(arr) ? arr.filter(id => TOOLS.some(t => t.id === id)) : [];
    } catch (e) { return []; }
  }
  function saveIdList(key, ids) {
    try { localStorage.setItem(key, JSON.stringify(ids)); } catch (e) { /* ignore */ }
  }
  const pinnedIds = loadIdList(PINNED_KEY);
  const recentIds = loadIdList(RECENT_KEY);

  function togglePin(id) {
    const sourceWasGridPin = !!(document.activeElement && document.activeElement.classList.contains('card-pin'));
    const i = pinnedIds.indexOf(id);
    if (i >= 0) pinnedIds.splice(i, 1);
    else pinnedIds.push(id);
    saveIdList(PINNED_KEY, pinnedIds);
    renderQuickSections();
    renderGrid();
    if (sourceWasGridPin) {
      const card = Array.from(toolGrid.querySelectorAll('.tool-card')).find(item => item.dataset.id === id);
      const target = card && card.querySelector('.card-pin');
      if (target) target.focus({ preventScroll: true });
    }
  }

  function recordRecent(id) {
    const i = recentIds.indexOf(id);
    if (i >= 0) recentIds.splice(i, 1);
    recentIds.unshift(id);
    if (recentIds.length > RECENT_MAX) recentIds.length = RECENT_MAX;
    saveIdList(RECENT_KEY, recentIds);
    renderQuickSections();
  }

  function movePinned(id, delta) {
    if (state.cat !== 'all' || state.keyword.trim()) {
      showToast('请切换到“全部”并清空搜索。', 'info');
      return;
    }
    const from = pinnedIds.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= pinnedIds.length) return;
    const moved = pinnedIds.splice(from, 1)[0];
    pinnedIds.splice(to, 0, moved);
    saveIdList(PINNED_KEY, pinnedIds);
    renderQuickSections();
    const card = Array.from(pinnedRow.querySelectorAll('.quick-card')).find(item => item.dataset.id === id);
    const target = card && card.querySelector(`[data-move-dir="${delta}"]`);
    if (target && !target.disabled) target.focus({ preventScroll: true });
    else if (card) card.querySelector('.quick-open').focus({ preventScroll: true });
  }

  function makeQuickCard(t, idx, pinnedCard) {
    const el = document.createElement('div');
    el.className = 'quick-card';
    el.dataset.id = t.id;
    el.title = t.desc;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'quick-open';
    open.setAttribute('aria-label', `${t.name}：${t.desc}`);
    open.innerHTML = `
      <span class="tool-icon cat-${t.cat}"><svg class="icon" viewBox="0 0 24 24">${ICONS[t.icon] || ICONS.doc}</svg></span>
      <span class="quick-name">${escapeHtml(t.name)}</span>`;
    open.addEventListener('click', () => openTool(t.id));
    if (pinnedCard) {
      open.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight');
      open.addEventListener('keydown', event => {
        if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        event.preventDefault();
        movePinned(t.id, event.key === 'ArrowLeft' ? -1 : 1);
      });
    }
    el.appendChild(open);
    // 兼容外部/自动化对卡片本体的点击，但真实交互只由内部 button 承担。
    el.addEventListener('click', e => {
      if (!e.target.closest('.quick-open') && !e.target.closest('.quick-unpin')) openTool(t.id);
    });
    if (pinnedCard) {
      const reorder = document.createElement('span');
      reorder.className = 'quick-reorder';
      [-1, 1].forEach(direction => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'quick-move';
        button.dataset.moveDir = String(direction);
        const filtered = state.cat !== 'all' || !!state.keyword.trim();
        button.disabled = filtered || (direction < 0 ? idx <= 0 : idx >= pinnedIds.length - 1);
        button.setAttribute('aria-label', `${direction < 0 ? '前移' : '后移'} ${t.name}`);
        button.title = filtered
          ? '切换为“全部”后可排序'
          : `${direction < 0 ? '前移' : '后移'}（Alt + ${direction < 0 ? '←' : '→'}）`;
        button.textContent = direction < 0 ? '←' : '→';
        button.addEventListener('click', event => {
          event.stopPropagation();
          movePinned(t.id, direction);
        });
        reorder.appendChild(button);
      });
      el.appendChild(reorder);
      const unpin = document.createElement('button');
      unpin.type = 'button';
      unpin.className = 'quick-unpin';
      unpin.title = '取消置顶';
      unpin.setAttribute('aria-label', '取消置顶 ' + t.name);
      unpin.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
      unpin.addEventListener('click', e => { e.stopPropagation(); togglePin(t.id); });
      el.appendChild(unpin);
      el.draggable = state.cat === 'all' && !state.keyword.trim();
      el.addEventListener('dragstart', () => { dragPinnedIdx = idx; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => { dragPinnedIdx = -1; el.classList.remove('dragging'); });
      el.addEventListener('dragover', e => { e.preventDefault(); });
      el.addEventListener('drop', e => {
        e.preventDefault();
        if (dragPinnedIdx < 0 || dragPinnedIdx === idx) return;
        const moved = pinnedIds.splice(dragPinnedIdx, 1)[0];
        pinnedIds.splice(idx, 0, moved);
        saveIdList(PINNED_KEY, pinnedIds);
        renderQuickSections();
        const card = Array.from(pinnedRow.querySelectorAll('.quick-card')).find(item => item.dataset.id === moved);
        const open = card && card.querySelector('.quick-open');
        if (open) open.focus({ preventScroll: true });
      });
    }
    return el;
  }

  // 最近使用 / 置顶只展示当前分类与搜索词命中的工具，
  // 避免不属于当前板块的工具（如 PDF 工具出现在图片工具里）混入
  function quickVisible(t) {
    if (!t) return false;
    if (state.cat !== 'all' && t.cat !== state.cat) return false;
    const kw = state.keyword.trim().toLowerCase();
    return !kw || (t.name + ' ' + t.desc + ' ' + (t.keywords || '')).toLowerCase().includes(kw);
  }

  function renderQuickSections() {
    const pinnedList = pinnedIds
      .map((id, idx) => ({ t: TOOLS.find(x => x.id === id), idx }))
      .filter(x => quickVisible(x.t));
    pinnedSection.hidden = pinnedList.length === 0;
    pinnedRow.innerHTML = '';
    pinnedList.forEach(({ t, idx }) => pinnedRow.appendChild(makeQuickCard(t, idx, true)));

    const recentList = recentIds.map(id => TOOLS.find(x => x.id === id)).filter(quickVisible);
    recentSection.hidden = recentList.length === 0;
    recentRow.innerHTML = '';
    recentList.forEach(t => recentRow.appendChild(makeQuickCard(t, -1, false)));
  }

  recentClearBtn.addEventListener('click', () => {
    recentIds.length = 0;
    saveIdList(RECENT_KEY, recentIds);
    renderQuickSections();
  });

  // 票据识别不是工具分类：导航项点击后直接进入独立工作台，不渲染卡片
  const CAT_ORDER = ['pdf', 'img'];

  function highlightMatch(value) {
    const text = String(value == null ? '' : value);
    const keyword = state.keyword.trim();
    if (!keyword) return escapeHtml(text);
    const lowerText = text.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    let cursor = 0;
    let index = lowerText.indexOf(lowerKeyword);
    if (index < 0) return escapeHtml(text);
    let html = '';
    while (index >= 0) {
      html += escapeHtml(text.slice(cursor, index));
      html += `<mark class="search-match">${escapeHtml(text.slice(index, index + keyword.length))}</mark>`;
      cursor = index + keyword.length;
      index = lowerText.indexOf(lowerKeyword, cursor);
    }
    return html + escapeHtml(text.slice(cursor));
  }

  /* 卡片小字只在两种情况下出现：
     1) 搜索命中了名称之外的信息，需要解释「为什么会搜到它」；
     2) 名称有歧义 / 有限制，在 TOOL_HINTS 中登记了一行短提示。
     其余卡片只显示图标 + 名称，完整说明仍由 title、aria-label 与工作区头部提供。 */
  function cardNote(t) {
    const kw = state.keyword.trim().toLowerCase();
    if (kw && !t.name.toLowerCase().includes(kw)) return { text: t.desc, isHint: false };
    const hint = TOOL_HINTS[t.id];
    return hint ? { text: hint, isHint: true } : null;
  }

  function makeToolCard(t) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.dataset.id = t.id;
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'tool-card-main';
    main.title = t.desc;
    main.setAttribute('aria-label', t.name + '：' + t.desc);
    const note = cardNote(t);
    main.innerHTML = `
      <span class="tool-icon cat-${t.cat}"><svg class="icon" viewBox="0 0 24 24">${ICONS[t.icon] || ICONS.doc}</svg></span>
      <span class="tool-card-text"><span class="tool-name">${highlightMatch(t.name)}</span>${note ? `<span class="tool-desc${note.isHint ? ' tool-hint' : ''}">${highlightMatch(note.text)}</span>` : ''}</span>`;
    main.addEventListener('click', () => openTool(t.id));
    const pin = document.createElement('button');
    pin.type = 'button';
    const pinned = pinnedIds.includes(t.id);
    pin.className = 'card-pin' + (pinned ? ' active' : '');
    pin.title = pinned ? '取消置顶' : '置顶工具';
    pin.setAttribute('aria-label', (pinned ? '取消置顶 ' : '置顶 ') + t.name);
    pin.setAttribute('aria-pressed', String(pinned));
    pin.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>';
    pin.addEventListener('click', e => { e.stopPropagation(); togglePin(t.id); });
    card.appendChild(main);
    card.appendChild(pin);
    // 保留整卡点击能力，同时避免按钮嵌套带来的键盘误触。
    card.addEventListener('click', e => {
      if (!e.target.closest('.tool-card-main') && !e.target.closest('.card-pin')) openTool(t.id);
    });
    return card;
  }

  function makeGroupHeading(cat, count) {
    const heading = document.createElement('div');
    heading.className = 'tool-group-heading';
    heading.dataset.cat = cat;
    heading.setAttribute('role', 'heading');
    heading.setAttribute('aria-level', '2');
    heading.innerHTML = `<span class="tool-group-title">${escapeHtml(CAT_NAMES[cat] || cat)}</span><span class="tool-group-count">${count} 项</span>`;
    return heading;
  }

  function makeClusterHeading(title, count) {
    const heading = document.createElement('div');
    heading.className = 'tool-cluster-heading';
    heading.setAttribute('role', 'heading');
    heading.setAttribute('aria-level', '3');
    heading.innerHTML = `${escapeHtml(title)}<span class="tool-group-count">${count}</span>`;
    return heading;
  }

  /* 单个分类内按功能簇再分组：标题只在同簇 ≥2 项时出现，
     搜索命中少量结果时退回平铺，避免出现一堆只含 1 张卡的标题。 */
  function renderClusterGroup(list) {
    const byId = new Map(list.map(t => [t.id, t]));
    const used = new Set();
    for (const cluster of TOOL_CLUSTERS) {
      const items = cluster.ids.map(id => byId.get(id)).filter(Boolean);
      if (!items.length) continue;
      items.forEach(t => used.add(t.id));
      if (items.length > 1) toolGrid.appendChild(makeClusterHeading(cluster.title, items.length));
      items.forEach(t => toolGrid.appendChild(makeToolCard(t)));
    }
    const rest = list.filter(t => !used.has(t.id));
    if (rest.length) {
      if (rest.length > 1) toolGrid.appendChild(makeClusterHeading('其他', rest.length));
      rest.forEach(t => toolGrid.appendChild(makeToolCard(t)));
    }
  }

  function renderGrid() {
    const kw = state.keyword.trim().toLowerCase();
    const match = t => !kw || (t.name + ' ' + t.desc + ' ' + (t.keywords || '')).toLowerCase().includes(kw);
    const cats = state.cat === 'all' ? CAT_ORDER : [state.cat];
    const groups = cats
      .map(cat => ({ cat, list: ORDERED_TOOLS.filter(t => t.cat === cat && match(t)) }))
      .filter(g => g.list.length > 0);

    toolGrid.innerHTML = '';
    const total = groups.reduce((n, g) => n + g.list.length, 0);
    noResult.hidden = total > 0;

    // 「全部工具」视图按导航 tab 顺序分区：PDF 在前、图片在后，组间用标题分隔
    const showHeadings = state.cat === 'all';
    const showClusters = !kw && total > 3;
    for (const g of groups) {
      if (showHeadings) toolGrid.appendChild(makeGroupHeading(g.cat, g.list.length));
      if (showClusters) renderClusterGroup(g.list);
      else for (const t of g.list) toolGrid.appendChild(makeToolCard(t));
    }
    updateSearchStatus(total);
    syncActiveTab();
  }

  function setActiveTab(cat) {
    headerNav.querySelectorAll('a[data-cat]').forEach(a => {
      const active = a.dataset.cat === cat;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (catChips) {
      catChips.querySelectorAll('[data-cat]').forEach(btn => {
        const active = btn.dataset.cat === cat;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
    }
  }

  // 滚动到某分组时，让导航栏中对应的 tab 呈现选中态；仅在「全部工具」视图生效
  function syncActiveTab() {
    if (state.cat !== 'all' || homeView.hidden) return;
    const heads = toolGrid.querySelectorAll('.tool-group-heading[data-cat]');
    if (!heads.length) { setActiveTab('all'); return; }
    const headerEl = document.querySelector('.app-header');
    const threshold = (headerEl ? headerEl.offsetHeight : 62) + 24;
    let active = 'all';
    heads.forEach(h => {
      if (h.getBoundingClientRect().top <= threshold) active = h.dataset.cat;
    });
    // 末尾分组过短时标题可能到不了导航栏下沿，滚到页面底部直接高亮它
    const page = document.documentElement;
    if (window.scrollY > 4 && page.scrollHeight - window.scrollY - window.innerHeight <= 8) {
      active = heads[heads.length - 1].dataset.cat;
    }
    setActiveTab(active);
  }

  let scrollSyncQueued = false;
  window.addEventListener('scroll', () => {
    if (scrollSyncQueued) return;
    scrollSyncQueued = true;
    requestAnimationFrame(() => { scrollSyncQueued = false; syncActiveTab(); });
  }, { passive: true });

  function setCategory(cat) {
    state.cat = cat;
    renderGrid();
    renderQuickSections();
    setActiveTab(cat);
  }

  function selectCategory(cat) {
    if (state.busy) {
      showToast('请等待当前任务完成。', 'warn');
      return;
    }
    // 票据工作台是一级模块，其余三项是工具箱内部筛选。
    if (cat === 'bill') { openBillWorkbench(); return; }
    if (!showHome()) return;
    setCategory(cat);
  }

  headerNav.addEventListener('click', e => {
    const a = e.target.closest('a[data-cat]');
    if (!a) return;
    e.preventDefault();
    selectCategory(a.dataset.cat);
  });

  /* 窄屏分类切换：头部导航隐藏后仍可切换分类与进入票据工作台 */
  if (catChips) {
    catChips.addEventListener('click', e => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      selectCategory(btn.dataset.cat);
    });
  }

  function syncSearchBox() {
    if (searchBox) searchBox.classList.toggle('has-keyword', !!toolSearch.value.trim());
  }

  function updateSearchStatus(count) {
    if (!searchResultStatus) return;
    const keyword = state.keyword.trim();
    if (!keyword) {
      searchResultStatus.hidden = true;
      searchResultStatus.textContent = '';
      return;
    }
    searchResultStatus.hidden = false;
    searchResultStatus.textContent = count
      ? `找到 ${count} 个与“${keyword}”相关的工具`
      : `没有找到与“${keyword}”相关的工具`;
  }

  function runSearch(value, focusInput) {
    const searchHadFocus = document.activeElement === toolSearch;
    toolSearch.value = value;
    state.keyword = value;
    syncSearchBox();
    if (!value.trim() || !state.busy) {
      // 搜索属于全局入口：从工具页输入时直接回到搜索结果。
      if (!workspaceView.hidden) {
        if (!showHome()) {
          toolSearch.value = '';
          state.keyword = '';
          syncSearchBox();
          return;
        }
        state.cat = 'all';
        setActiveTab('all');
      }
      renderGrid();
      renderQuickSections();
      const count = toolGrid.querySelectorAll('.tool-card').length;
      updateSearchStatus(count);
    }
    if (focusInput || searchHadFocus) {
      toolSearch.focus();
      const end = toolSearch.value.length;
      try { toolSearch.setSelectionRange(end, end); } catch (e) { /* ignore */ }
    }
  }

  toolSearch.addEventListener('input', () => runSearch(toolSearch.value, false));

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      runSearch('', true);
    });
  }

  /* 空状态里的「试试这些」直接改写搜索词 */
  if (noResult) {
    noResult.addEventListener('click', e => {
      const chip = e.target.closest('[data-suggest]');
      if (chip) runSearch(chip.dataset.suggest, true);
    });
  }

  document.addEventListener('keydown', e => {
    const target = e.target;
    const editing = target && (target.matches('input, textarea, select') || target.isContentEditable);
    if (document.body.classList.contains('bill-app-active')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (!toolSearch.disabled) {
        toolSearch.focus();
        toolSearch.select();
      }
      return;
    }
    if (e.key === 'Escape' && (target === toolSearch || searchBox.contains(target))) {
      if (toolSearch.value) runSearch('', true);
      else toolSearch.blur();
      return;
    }
    // 不在输入控件中时，按 / 也能快速进入搜索。
    if (e.key === '/' && !editing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!toolSearch.disabled) {
        e.preventDefault();
        toolSearch.focus();
        toolSearch.select();
      }
    }
  });

  syncSearchBox();

  /* ============================================================
     8. 工作区：视图切换 / 文件管理 / 选项渲染
     ============================================================ */
  /* 记住进入工具前的首页滚动位置，返回时原位还原 */
  let homeScrollY = 0;

  function currentRouteHash() {
    return String(location.hash || '');
  }

  function routeForState() {
    if (document.body.classList.contains('bill-app-active')) {
      return '#/bill/' + (billState.page || 'bank');
    }
    if (!workspaceView.hidden && state.tool) return '#/tool/' + state.tool.id;
    return '#/home';
  }

  function syncRoute(route, replace) {
    if (!route || currentRouteHash() === route) {
      state.route = route;
      return;
    }
    state.route = route;
    try {
      history[replace ? 'replaceState' : 'pushState']({ route }, '', route);
    } catch (e) {
      // 极少数 file:// 环境禁止 History API 时，保持应用可用，不阻断导航。
    }
  }

  function guardBusyAction() {
    if (!state.busy) return false;
    showToast('请等待当前任务完成。', 'warn');
    return true;
  }

  function focusView(node) {
    if (!node) return;
    try { node.focus({ preventScroll: true }); } catch (e) { try { node.focus(); } catch (err) { /* ignore */ } }
  }

  function showHome(restoreScroll, options) {
    if (state.busy && !(options && options.fromRoute)) {
      guardBusyAction();
      return false;
    }
    // 从票据识别工作台返回时关闭全屏应用视图和可能打开的弹窗。
    if (document.body.classList.contains('bill-app-active')) {
      window.dispatchEvent(new CustomEvent('billapp:close'));
      const billView = $('billAppView');
      if (billView) billView.hidden = true;
      document.body.classList.remove('bill-app-active');
    }
    closeLightbox();
    releaseAllPreviews();
    workspaceView.hidden = true;
    homeView.hidden = false;
    document.title = '办公文件工具箱 - 离线 PDF 与图片处理';
    setActiveTab(state.cat);
    if (!(options && options.fromRoute)) syncRoute('#/home');
    if (restoreScroll) {
      // 等首页重新参与布局后再还原，避免被隐藏瞬间的高度变化截断
      requestAnimationFrame(() => {
        window.scrollTo(0, homeScrollY);
        focusView(homeView);
      });
    } else {
      window.scrollTo({ top: 0 });
      focusView(homeView);
    }
    return true;
  }

  /* 票据识别：没有工具卡片，导航或首页入口点击后直接进入全屏工作台 */
  function openBillWorkbench(options) {
    if (state.busy && !(options && options.fromRoute)) {
      guardBusyAction();
      return false;
    }
    const settings = options || {};
    if (!homeView.hidden) homeScrollY = window.scrollY;
    closeLightbox();
    releaseAllPreviews();
    state.tool = null;
    state.files = [];
    clearResults();
    homeView.hidden = true;
    workspaceView.hidden = true;
    setActiveTab('bill');
    const page = settings.page || 'bank';
    window.dispatchEvent(new CustomEvent('billapp:open', { detail: { page } }));
    if (typeof billShowPage === 'function') billShowPage(page, { fromRoute: true });
    syncRoute('#/bill/' + page);
    focusView($('bill-page-title'));
    return true;
  }

  function restoreRoute() {
    if (state.busy || (document.body.classList.contains('bill-app-active') && billAnyBusy())) {
      showToast('任务处理中，暂不能返回。', 'warn');
      syncRoute(routeForState(), true);
      return;
    }
    const hash = currentRouteHash();
    const toolMatch = hash.match(/^#\/tool\/([^/?#]+)/);
    if (toolMatch) {
      if (!openTool(decodeURIComponent(toolMatch[1]), { fromRoute: true })) syncRoute('#/home', true);
      return;
    }
    const billMatch = hash.match(/^#\/bill\/(bank|acceptance|invoice|settings)/);
    if (billMatch) {
      openBillWorkbench({ fromRoute: true, page: billMatch[1] });
      return;
    }
    showHome(true, { fromRoute: true });
  }

  window.addEventListener('popstate', restoreRoute);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  function openTool(id, options) {
    const tool = TOOLS.find(t => t.id === id);
    if (!tool) return false;
    if (state.busy && !(options && options.fromRoute)) {
      guardBusyAction();
      return false;
    }
    const routeOptions = options || {};
    if (!homeView.hidden) homeScrollY = window.scrollY;
    closeLightbox();
    releaseAllPreviews();
    // 误点返回后重新进入同一工具时保留已选文件，避免白选一场
    const sameTool = state.tool && state.tool.id === tool.id;
    state.tool = tool;
    if (!sameTool) {
      state.files.forEach(f => releasePreview(f));
      state.files = [];
    }
    clearResults();
    homeView.hidden = true;
    workspaceView.hidden = false;

    wsIcon.className = 'ws-icon tool-icon cat-' + tool.cat;
    wsIcon.innerHTML = `<svg class="icon" viewBox="0 0 24 24">${ICONS[tool.icon] || ICONS.doc}</svg>`;
    wsTitle.textContent = tool.name;
    wsDesc.textContent = tool.desc;
    document.title = `${tool.name} · 办公文件工具箱`;
    if (wsCrumbCat) wsCrumbCat.textContent = CAT_NAMES[tool.cat] || '';
    if (wsCrumbName) wsCrumbName.textContent = tool.name;

    const maxFiles = tool.single ? 1 : (Number(tool.maxFiles) || Infinity);
    wsFileInput.multiple = maxFiles > 1;
    wsFileInput.setAttribute('accept', tool.accept || '*');
    const acceptHint = String(tool.accept || '').indexOf('image/*') === 0
      ? IMAGE_FORMAT_LABEL + ' 等常见图片格式'
      : (tool.accept || '任意文件');
    wsDropzoneHint.textContent = `支持：${acceptHint}${tool.minFiles > 1 ? ` · 至少 ${tool.minFiles} 个文件，可调整顺序` : ''}${Number.isFinite(maxFiles) && maxFiles > 1 ? ` · 最多 ${maxFiles} 个文件` : ''}`;

    renderFileList();
    renderOptions(tool.options || []);
    syncTaskLock();
    updateRunState();
    if (!routeOptions.fromRoute) syncRoute('#/tool/' + tool.id);
    window.scrollTo({ top: 0 });
    focusView(wsTitle);
    return true;
  }

  function conditionMatches(rule) {
    if (!rule) return true;
    return Object.keys(rule).every(key => {
      const expected = rule[key];
      const actual = state.options[key];
      return Array.isArray(expected)
        ? expected.map(String).includes(String(actual))
        : String(expected) === String(actual);
    });
  }

  function optionVisible(opt) {
    return conditionMatches(opt && opt.visibleWhen);
  }

  function optionRequired(opt) {
    return !!(opt && (opt.required || (opt.requiredWhen && conditionMatches(opt.requiredWhen))));
  }

  function optionControl(key) {
    return wsOptions.querySelector(`[data-key="${key}"]`);
  }

  function syncOptionVisibility() {
    state.optionSchema.forEach(opt => {
      const group = wsOptions.querySelector(`[data-option-key="${opt.key}"]`);
      if (!group) return;
      const visible = optionVisible(opt);
      group.hidden = !visible;
      group.setAttribute('aria-hidden', String(!visible));
      group.querySelectorAll('[data-key]').forEach(control => {
        control.disabled = state.busy || !visible;
        control.required = optionRequired(opt);
        if (optionRequired(opt)) control.setAttribute('aria-required', 'true');
        else control.removeAttribute('aria-required');
      });
    });
  }

  function optionErrorMessage(opt) {
    if (!optionVisible(opt)) return '';
    const control = optionControl(opt.key);
    if (!control) return '';
    if (optionRequired(opt)) {
      if (control.type === 'file') {
        if (!control.files || !control.files.length) return `请选择「${opt.label}」`;
      } else if (!String(control.value || '').trim()) {
        return `请填写「${opt.label}」`;
      }
    }
    if (control.validity && !control.validity.valid) {
      if (control.validity.valueMissing) return `请填写「${opt.label}」`;
      if (control.validity.rangeOverflow || control.validity.rangeUnderflow) {
        return `「${opt.label}」超出允许范围`;
      }
      return `请检查「${opt.label}」的输入`;
    }
    return '';
  }

  function validateOptions(showErrors) {
    let firstMessage = '';
    let firstControl = null;
    state.optionSchema.forEach(opt => {
      if (!optionVisible(opt)) return;
      const group = wsOptions.querySelector(`[data-option-key="${opt.key}"]`);
      const control = optionControl(opt.key);
      if (!group || !control) return;
      const error = optionErrorMessage(opt);
      const errorEl = group.querySelector('.setting-error');
      if (error) {
        if (!firstMessage) { firstMessage = error; firstControl = control; }
        group.classList.add('has-error');
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-describedby', `${opt.hint ? `wsopt-hint-${opt.key} ` : ''}wsopt-error-${opt.key}`);
        if (errorEl) {
          errorEl.textContent = error;
          errorEl.hidden = !showErrors;
        }
      } else {
        group.classList.remove('has-error');
        control.removeAttribute('aria-invalid');
        if (opt.hint) control.setAttribute('aria-describedby', `wsopt-hint-${opt.key}`);
        else control.removeAttribute('aria-describedby');
        if (errorEl) {
          errorEl.textContent = '';
          errorEl.hidden = true;
        }
      }
    });
    if (showErrors && firstControl) {
      const details = firstControl.closest('details');
      if (details) details.open = true;
      firstControl.focus({ preventScroll: false });
      try { firstControl.scrollIntoView({ block: 'center', behavior: preferredScrollBehavior() }); } catch (e) { /* ignore */ }
    }
    return { valid: !firstMessage, message: firstMessage };
  }

  /* 主按钮可用性 + 一句人话说明还差什么，取代「点了再弹 alert」 */
  function updateRunState() {
    const tool = state.tool;
    if (!tool) return;
    const minFiles = tool.minFiles == null ? 1 : tool.minFiles;
    const maxFiles = tool.single ? 1 : (Number(tool.maxFiles) || Infinity);
    const enough = state.files.length >= minFiles;
    const overLimit = Number.isFinite(maxFiles) && state.files.length > maxFiles;
    const validation = validateOptions(false);
    const customError = typeof tool.validateOptions === 'function'
      ? (tool.validateOptions(state.options, state.files) || '')
      : '';
    const blocked = !enough || overLimit || !validation.valid || !!customError;
    // 文件数量不足是真正不可启动；参数缺失时保留可点击，让点击直接定位并解释错误。
    wsRunBtn.disabled = !enough || overLimit || state.busy;
    wsRunBtn.setAttribute('aria-disabled', String(!enough || overLimit || state.busy));
    wsRunBtn.classList.toggle('is-params-incomplete', !wsRunBtn.disabled && blocked);
    if (!wsRunHint) return;
    if (state.busy) {
      wsRunHint.textContent = '任务处理中…';
      wsRunHint.classList.remove('is-blocked');
      return;
    }
    if (overLimit) {
      wsRunHint.textContent = `最多 ${maxFiles} 个文件`;
      wsRunHint.classList.add('is-blocked');
      return;
    }
    if (!enough) {
      const need = minFiles - state.files.length;
      wsRunHint.textContent = state.files.length === 0
        ? `请先选择文件（至少 ${minFiles} 个）`
        : `还需 ${need} 个文件`;
      wsRunHint.classList.add('is-blocked');
      return;
    }
    if (!validation.valid || customError) {
      wsRunHint.textContent = customError || validation.message;
      wsRunHint.classList.add('is-blocked');
      return;
    }
    wsRunHint.textContent = state.files.length
      ? `已选 ${state.files.length} 个文件`
      : '可以开始处理';
    wsRunHint.classList.remove('is-blocked');
  }

  function syncTaskLock() {
    const busy = state.busy;
    document.body.classList.toggle('is-task-busy', busy);
    [wsBackBtn, wsFileInput, toolSearch, fileViewListBtn, fileViewGridBtn, searchClearBtn].forEach(node => {
      if (node) node.disabled = busy;
    });
    if (wsDropzone) {
      wsDropzone.classList.toggle('is-disabled', busy);
      wsDropzone.setAttribute('aria-disabled', String(busy));
      wsDropzone.tabIndex = busy ? -1 : 0;
    }
    if (headerNav) {
      headerNav.setAttribute('aria-busy', String(busy));
      headerNav.querySelectorAll('a[data-cat]').forEach(link => {
        link.setAttribute('aria-disabled', String(busy));
        if (busy) link.tabIndex = -1;
        else link.removeAttribute('tabindex');
      });
    }
    if (catChips) {
      catChips.querySelectorAll('[data-cat]').forEach(button => {
        button.setAttribute('aria-disabled', String(busy));
        if (busy) button.tabIndex = -1;
        else button.removeAttribute('tabindex');
      });
    }
    syncOptionVisibility();
    updateRunState();
  }

  /* 已有文件时把 dropzone 收成一行按钮，把纵向空间让给文件列表 */
  function updateDropzoneLabel() {
    const tool = state.tool;
    if (!tool) return;
    const hasFiles = state.files.length > 0;
    const maxFiles = tool.single ? 1 : (Number(tool.maxFiles) || Infinity);
    const atLimit = !tool.single && Number.isFinite(maxFiles) && state.files.length >= maxFiles;
    const canReplaceSingle = !!tool.single && hasFiles;
    wsDropzone.classList.toggle('is-compact', hasFiles);
    wsDropzoneText.textContent = atLimit
      ? `已达到 ${maxFiles} 个文件上限`
      : (canReplaceSingle ? '点击替换当前文件' : (hasFiles ? '继续添加文件' : (tool.minFiles > 1 ? '点击选择或拖拽多个文件到此处' : '点击选择或拖拽文件到此处')));
    wsDropzone.setAttribute('aria-label', atLimit
      ? `已达到 ${maxFiles} 个文件上限`
      : (canReplaceSingle ? '替换当前文件' : (hasFiles ? '继续添加文件' : '选择文件')));
    wsDropzone.classList.toggle('is-at-limit', atLimit);
  }

  function updateFileSummary() {
    if (!wsFileSummary) return;
    if (!state.files.length) {
      wsFileSummary.hidden = true;
      wsFileSummary.innerHTML = '';
      return;
    }
    const total = state.files.reduce((n, f) => n + (f.size || 0), 0);
    wsFileSummary.hidden = false;
    wsFileSummary.innerHTML = `<span>已选 <strong>${state.files.length}</strong> 个文件</span><span>合计 ${formatBytes(total)}</span><button type="button" class="file-summary-clear" ${state.busy ? 'disabled' : ''}>全部移除</button>`;
    wsFileSummary.querySelector('.file-summary-clear').addEventListener('click', () => {
      if (state.busy) return;
      state.files.forEach(f => releasePreview(f));
      state.files = [];
      renderFileList();
      clearResults();
    });
  }

  wsBackBtn.addEventListener('click', () => {
    if (guardBusyAction()) return;
    showHome(true);
  });

  function renderFileList() {
    const active = document.activeElement;
    const activeItem = active && active.closest ? active.closest('.file-item') : null;
    const focusState = activeItem && wsFileList.contains(activeItem) && active.dataset.act
      ? { index: Number(activeItem.dataset.index), act: active.dataset.act }
      : null;
    wsFileList.innerHTML = '';
    const isGrid = state.fileView === 'grid';
    wsFileList.classList.toggle('is-grid', isGrid);
    wsCols.classList.toggle('is-empty', state.files.length === 0);
    // 网格卡片按从左到右排列，排序按钮改用「前移/后移」语义与左右箭头
    const upLabel = isGrid ? '前移' : '上移';
    const downLabel = isGrid ? '后移' : '下移';
    const last = state.files.length - 1;
    state.files.forEach((f, idx) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.dataset.index = String(idx);
      item.setAttribute('aria-label', `第 ${idx + 1} 个文件：${f.name}`);
      const entry = getPreview(f, f.name);
      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'file-thumb';
      thumb.dataset.act = 'preview';
      thumb.setAttribute('aria-label', `预览 ${f.name}`);
      paintFileThumb(thumb, entry, f.name);
      item.appendChild(thumb);
      item.insertAdjacentHTML('beforeend', `
        <div class="file-info">
          <span class="file-name" title="${escapeHtml(f.name)}">${idx + 1}. ${escapeHtml(f.name)}</span>
          <span class="file-meta"><span class="file-size">${formatBytes(f.size)}</span><span class="file-pages" hidden></span></span>
        </div>
        <div class="file-actions">
          <button type="button" class="file-btn" data-act="up" title="${upLabel}" aria-label="${upLabel}第 ${idx + 1} 个文件" ${idx === 0 || state.busy ? 'disabled' : ''}><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><polyline points="18 15 12 9 6 15"></polyline></svg><span class="file-btn-label">${upLabel}</span></button>
          <button type="button" class="file-btn" data-act="down" title="${downLabel}" aria-label="${downLabel}第 ${idx + 1} 个文件" ${idx === last || state.busy ? 'disabled' : ''}><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><polyline points="6 9 12 15 18 9"></polyline></svg><span class="file-btn-label">${downLabel}</span></button>
          <button type="button" class="file-btn" data-act="rm" title="移除" aria-label="移除第 ${idx + 1} 个文件" ${state.busy ? 'disabled' : ''}><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg><span class="file-btn-label">移除</span></button>
        </div>`);
      updateFilePreviewMeta(item, entry);
      if (entry.state === 'loading') {
        entry.promise.then(() => {
          if (!item.isConnected || entry.released) return;
          paintFileThumb(thumb, entry, f.name);
          updateFilePreviewMeta(item, entry);
        });
      }
      item.addEventListener('click', e => {
        const act = e.target.closest('[data-act]');
        if (!act || act.disabled || (state.busy && act.dataset.act !== 'preview')) return;
        const a = act.dataset.act;
        if (a === 'preview') {
          const kind = getPreview(f, f.name).kind;
          if (kind === 'text') openDocumentPreview(f, f.name, true);
          else if (kind !== 'other') openPreview(f, f.name);
          return;
        }
        if (a === 'rm') { releasePreview(f); state.files.splice(idx, 1); }
        else if (a === 'up' && idx > 0) [state.files[idx - 1], state.files[idx]] = [state.files[idx], state.files[idx - 1]];
        else if (a === 'down' && idx < state.files.length - 1) [state.files[idx + 1], state.files[idx]] = [state.files[idx], state.files[idx + 1]];
        renderFileList();
      });
      wsFileList.appendChild(item);
    });
    updateDropzoneLabel();
    updateFileSummary();
    updateRunState();
    scheduleEstimate();
    if (focusState && state.files.length) {
      const targetIndex = focusState.act === 'rm'
        ? Math.min(focusState.index, state.files.length - 1)
        : Math.min(focusState.index, state.files.length - 1);
      const target = wsFileList.querySelector(`.file-item[data-index="${targetIndex}"] [data-act="${focusState.act}"]`)
        || wsFileList.querySelector(`.file-item[data-index="${targetIndex}"] [data-act="preview"]`);
      if (target && !target.disabled) focusView(target);
    }
  }

  // 两种文件预览显示方式：紧凑列表 / 放大缩略图（记忆用户选择）
  function updateFileViewButtons() {
    const grid = state.fileView === 'grid';
    if (fileViewGridBtn) {
      fileViewGridBtn.classList.toggle('active', grid);
      fileViewGridBtn.setAttribute('aria-pressed', String(grid));
    }
    if (fileViewListBtn) {
      fileViewListBtn.classList.toggle('active', !grid);
      fileViewListBtn.setAttribute('aria-pressed', String(!grid));
    }
  }

  function setFileViewMode(mode) {
    if (mode !== 'list' && mode !== 'grid') return;
    if (state.busy || state.fileView === mode) return;
    state.fileView = mode;
    try { localStorage.setItem('officetoolbox.fileViewMode', mode); } catch (e) { /* ignore */ }
    updateFileViewButtons();
    renderFileList();
  }

  if (fileViewListBtn) fileViewListBtn.addEventListener('click', () => setFileViewMode('list'));
  if (fileViewGridBtn) fileViewGridBtn.addEventListener('click', () => setFileViewMode('grid'));

  function renderOptions(options) {
    wsOptions.innerHTML = '';
    state.optionSchema = options.slice();
    state.options = {};
    wsCols.classList.toggle('no-options', !options.length);
    if (!options.length) {
      wsOptions.innerHTML = '<p class="setting-hint">无需额外设置。</p>';
      mountEstimateBox();
      scheduleEstimate();
      return;
    }

    let currentSection = '';
    let currentHost = wsOptions;
    let advanced = null;

    function ensureAdvanced() {
      if (advanced) return advanced;
      advanced = document.createElement('details');
      advanced.className = 'settings-advanced';
      advanced.innerHTML = '<summary>高级设置<span>可选参数</span></summary><div class="settings-advanced-body"></div>';
      wsOptions.appendChild(advanced);
      return advanced.querySelector('.settings-advanced-body');
    }

    function makeGroup(opt, host) {
      if (opt.section && opt.section !== currentSection) {
        currentSection = opt.section;
        const heading = document.createElement('div');
        heading.className = 'settings-section-heading';
        heading.innerHTML = `<span>${escapeHtml(opt.section)}</span>`;
        host.appendChild(heading);
      }
      const group = document.createElement('div');
      group.className = 'setting-group';
      group.dataset.optionKey = opt.key;
      const label = document.createElement('label');
      label.className = 'setting-label';
      label.htmlFor = 'wsopt-' + opt.key;
      const requiredMark = opt.required ? '必填' : (opt.requiredWhen ? '按需' : '');
      label.innerHTML = `${escapeHtml(opt.label)}${requiredMark ? `<span class="setting-required" aria-hidden="true">${requiredMark}</span>` : ''}`;
      // 标签与控件显式关联：点文字即可聚焦输入框。
      group.appendChild(label);

      let input;
      let hintText = opt.hint || '';
      if (opt.type === 'select') {
        input = document.createElement('select');
        input.className = 'setting-select';
        for (const [v, t] of opt.choices) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = t;
          if (String(opt.def) === v) o.selected = true;
          input.appendChild(o);
        }
      } else if (opt.type === 'checkbox') {
        const wrap = document.createElement('label');
        wrap.className = 'setting-checkbox-label';
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!opt.def;
        wrap.appendChild(input);
        wrap.appendChild(document.createTextNode(' ' + (opt.label || opt.hint || '启用')));
        group.innerHTML = '';
        group.appendChild(wrap);
        hintText = '';
      } else if (opt.type === 'textarea') {
        input = document.createElement('textarea');
        input.className = 'setting-textarea';
        input.value = opt.def || '';
        input.placeholder = opt.placeholder || '';
      } else if (opt.type === 'file') {
        input = document.createElement('input');
        input.type = 'file';
        input.className = 'setting-input setting-file';
        input.setAttribute('accept', opt.accept || '*');
      } else if (opt.type === 'color') {
        input = document.createElement('input');
        input.type = 'color';
        input.className = 'setting-input';
        input.value = opt.def || '#000000';
      } else {
        input = document.createElement('input');
        input.type = opt.type === 'number' ? 'number' : (opt.type === 'password' ? 'password' : 'text');
        input.className = 'setting-input';
        input.value = (opt.def != null) ? opt.def : '';
        if (opt.placeholder) input.placeholder = opt.placeholder;
        if (opt.min != null) input.min = opt.min;
        if (opt.max != null) input.max = opt.max;
        if (opt.step != null) input.step = opt.step;
        if (opt.autocomplete) input.autocomplete = opt.autocomplete;
      }
      input.dataset.key = opt.key;
      input.id = 'wsopt-' + opt.key;
      if (opt.required) input.required = true;
      if (hintText) {
        input.setAttribute('aria-describedby', `wsopt-hint-${opt.key}`);
      }
      if (opt.type !== 'checkbox') group.appendChild(input);
      if (hintText) {
        const hint = document.createElement('p');
        hint.className = 'setting-hint';
        hint.id = `wsopt-hint-${opt.key}`;
        hint.textContent = hintText;
        group.appendChild(hint);
      }
      const error = document.createElement('p');
      error.className = 'setting-error';
      error.id = `wsopt-error-${opt.key}`;
      error.hidden = true;
      error.setAttribute('role', 'alert');
      group.appendChild(error);
      host.appendChild(group);
    }

    options.filter(opt => !opt.advanced).forEach(opt => makeGroup(opt, currentHost));
    const advancedOptions = options.filter(opt => opt.advanced);
    if (advancedOptions.length) {
      const host = ensureAdvanced();
      currentSection = '';
      advancedOptions.forEach(opt => makeGroup(opt, host));
    }

    // 控件值变化即同步进 store，初始化时写入默认值。
    wsOptions.querySelectorAll('[data-key]').forEach(input => {
      const sync = () => {
        state.options[input.dataset.key] = readOptionValue(input);
        syncOptionVisibility();
        updateRunState();
        scheduleEstimate();
      };
      input.addEventListener('input', sync);
      input.addEventListener('change', sync);
      state.options[input.dataset.key] = readOptionValue(input);
    });
    syncOptionVisibility();
    mountEstimateBox();
    scheduleEstimate();
  }

  wsOptions.addEventListener('submit', e => {
    e.preventDefault();
    if (!wsRunBtn.disabled) wsRunBtn.click();
  });

  wsOptions.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (e.target.matches('input:not([type="file"]):not([type="checkbox"]):not([type="color"])')) {
      e.preventDefault();
      if (!wsRunBtn.disabled) wsRunBtn.click();
    }
  });

  /* ---- 输出大小预估：工具可选实现 estimate(ctx)，返回一句预估文案 ---- */
  let estimateTimer = 0;
  let estimateSeq = 0;

  function mountEstimateBox() {
    if (!state.tool || typeof state.tool.estimate !== 'function') return;
    const box = document.createElement('div');
    box.className = 'option-estimate';
    box.innerHTML = '<span class="option-estimate-label">预计输出</span><span class="option-estimate-text">选择文件后显示预计大小</span>';
    wsOptions.appendChild(box);
  }

  function updateEstimateText(text, busy) {
    const box = wsOptions.querySelector('.option-estimate');
    if (!box) return;
    box.classList.toggle('is-busy', !!busy);
    const label = box.querySelector('.option-estimate-text');
    if (label) label.textContent = text;
  }

  function scheduleEstimate() {
    const tool = state.tool;
    if (!tool || typeof tool.estimate !== 'function') return;
    if (!wsOptions.querySelector('.option-estimate')) return;
    clearTimeout(estimateTimer);
    const seq = ++estimateSeq;
    if (!state.files.length) {
      updateEstimateText('选择文件后显示预计大小', false);
      return;
    }
    updateEstimateText('正在按当前参数预估…', true);
    estimateTimer = setTimeout(() => {
      const opts = collectOptions();
      Promise.resolve()
        .then(() => tool.estimate({ files: state.files.slice(), get: k => opts[k], progress: () => {} }))
        .then(text => {
          if (seq !== estimateSeq) return;
          updateEstimateText(text || '无法预估', false);
        })
        .catch(err => {
          if (seq !== estimateSeq) return;
          updateEstimateText('无法预估：' + (err && err.message ? err.message : '未知错误'), false);
        });
    }, 300);
  }

  function readOptionValue(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'file') return el.files && el.files[0];
    return el.value;
  }

  function collectOptions() {
    const vals = {};
    // 表单定义即 schema；仍从 DOM 读取以兼容直接修改控件值的场景，
    // 读取结果同步进 store，避免 DOM 成为唯一数据源。
    const keys = state.optionSchema.length
      ? state.optionSchema.map(o => o.key)
      : Array.from(wsOptions.querySelectorAll('[data-key]'), el => el.dataset.key);
    for (const key of keys) {
      const el = wsOptions.querySelector(`[data-key="${key}"]`);
      const def = (state.optionSchema.find(o => o.key === key) || {}).def;
      vals[key] = el ? readOptionValue(el) : def;
    }
    state.options = vals;
    return vals;
  }

  /* ============================================================
     9. 拖拽 / 选择文件
     ============================================================ */
  function addFiles(fileList) {
    if (state.busy) {
      showToast('任务处理中，不能修改文件列表。', 'warn');
      return;
    }
    const accept = (state.tool && state.tool.accept) || '';
    const incoming = [];
    for (const f of fileList) {
      const tokens = (accept || '*').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const nameLc = f.name.toLowerCase();
      const ok = tokens.some(tok => {
        if (tok === '*') return true;
        if (tok === 'image/*') return /^image\//.test(f.type) || isImageFileName(nameLc);
        if (tok === '.pdf') return /\.pdf$/.test(nameLc);
        if (tok.charAt(0) === '.') return nameLc.endsWith(tok);
        return true;
      });
      if (!ok) {
        reportError(`文件类型不支持：${f.name}`);
        continue;
      }
      incoming.push(f);
    }
    let added = 0;
    if (state.tool && state.tool.single) {
      if (incoming.length > 1) showToast('仅保留第一个文件。', 'warn');
      if (incoming.length) {
        state.files.forEach(f => releasePreview(f));
        state.files = [incoming[0]];
        added = 1;
      }
    } else if (incoming.length) {
      const maxFiles = Number(state.tool && state.tool.maxFiles) || Infinity;
      const available = Math.max(0, maxFiles - state.files.length);
      if (incoming.length > available && Number.isFinite(maxFiles)) {
        showToast(`最多 ${maxFiles} 个文件，多余已忽略。`, 'warn');
      }
      const accepted = incoming.slice(0, available);
      state.files.push(...accepted);
      added = accepted.length;
    }
    if (added) {
      renderFileList();
      clearResults();
    }
  }

  function canOpenFilePicker() {
    if (state.busy) {
      showToast('任务处理中，不能修改文件列表。', 'warn');
      return false;
    }
    if (state.tool && state.tool.single) return true;
    const maxFiles = Number((state.tool && state.tool.maxFiles) || Infinity);
    if (Number.isFinite(maxFiles) && state.files.length >= maxFiles) {
      showToast(`最多 ${maxFiles} 个文件，请先移除。`, 'warn');
      return false;
    }
    return true;
  }

  wsDropzone.addEventListener('click', () => {
    if (canOpenFilePicker()) wsFileInput.click();
  });
  wsDropzone.addEventListener('keydown', e => {
    if (state.busy) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (canOpenFilePicker()) wsFileInput.click();
    }
  });
  ['dragenter', 'dragover'].forEach(n => wsDropzone.addEventListener(n, e => {
    e.preventDefault(); e.stopPropagation();
    wsDropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(n => wsDropzone.addEventListener(n, e => {
    e.preventDefault(); e.stopPropagation();
    wsDropzone.classList.remove('dragover');
  }));
  wsDropzone.addEventListener('drop', e => {
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  wsFileInput.addEventListener('change', e => {
    if (e.target.files && e.target.files.length) addFiles(e.target.files);
    e.target.value = '';
  });

  /* ============================================================
     10. 执行处理 / 进度 / 结果
     ============================================================ */
  function setProgress(done, total, text) {
    // 60+ 个工具在循环中高频上报进度，合并到一帧写 DOM，避免布局抖动。
    pendingProgress = { done, total, text };
    if (progressRaf) return;
    progressRaf = requestAnimationFrame(() => {
      progressRaf = 0;
      const p = pendingProgress;
      if (!p) return;
      wsProgress.hidden = false;
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
      // 未跑完时清掉上一轮的成功 / 失败外观
      if (pct < 100) wsProgress.classList.remove('is-success', 'is-error');
      wsProgressFill.style.width = pct + '%';
      wsProgressPct.textContent = pct + '%';
      wsProgressText.textContent = p.text || '正在处理...';
      if (wsProgressBar) {
        wsProgressBar.setAttribute('aria-valuenow', String(pct));
        wsProgressBar.setAttribute('aria-valuetext', `${pct}% ${p.text || '正在处理'}`);
      }
    });
  }

  function clearResults() {
    cancelPendingProgress();
    state.results.forEach(r => {
      if (r.url) revokeLater(r.url);
      releasePreview(r.blob);
    });
    state.results = [];
    wsResultsGrid.innerHTML = '';
    wsResultsSection.hidden = true;
    wsResultsCount.textContent = '0';
    if (wsResultsMeta) wsResultsMeta.textContent = '';
    wsZipBtn.disabled = true;
    if (wsViewResultsBtn) wsViewResultsBtn.hidden = true;
    wsProgress.hidden = true;
    wsProgress.classList.remove('is-success', 'is-error', 'is-empty');
    if (wsProgressBar) wsProgressBar.setAttribute('aria-valuenow', '0');
  }

  function renderResults() {
    wsResultsGrid.innerHTML = '';
    wsResultsSection.hidden = state.results.length === 0;
    wsResultsCount.textContent = String(state.results.length);
    if (wsResultsMeta) {
      const totalSize = state.results.reduce((n, r) => n + (r.blob.size || 0), 0);
      wsResultsMeta.textContent = state.results.length ? `合计 ${formatBytes(totalSize)}` : '';
    }
    state.results.forEach((r, ridx) => {
      const card = document.createElement('article');
      card.className = 'preview-card';
      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'preview-thumbnail-box';
      const ext = (r.name.split('.').pop() || '').toUpperCase();
      const kind = previewKind(r.blob, r.name);
      if (kind === 'image' && r.url) {
        const img = document.createElement('img');
        img.loading = 'lazy';        // 数百页 PDF 转图时只解码视口内图片
        img.decoding = 'async';
        img.src = r.url;
        img.alt = r.name;
        thumb.title = `查看大图：${r.name}`;
        thumb.setAttribute('aria-label', `预览 ${r.name}`);
        thumb.appendChild(img);
        thumb.addEventListener('click', () => openLightbox(r.url, r.name));
      } else if (kind === 'pdf') {
        // 自动生成前几张首页缩略图，其余在点击时按需生成，避免大批量任务卡顿
        thumb.classList.add('is-pdf');
        thumb.setAttribute('aria-label', `预览 PDF ${r.name}`);
        const entry = ridx < CONFIG.maxAutoPdfThumbs ? getPreview(r.blob, r.name) : null;
        paintResultThumb(thumb, entry, r.name, ext);
        if (entry && entry.state === 'loading') {
          entry.promise.then(() => {
            if (thumb.isConnected && !entry.released) paintResultThumb(thumb, entry, r.name, ext);
          });
        }
        thumb.addEventListener('click', () => openPreview(r.blob, r.name));
      } else if (kind === 'text') {
        thumb.classList.add('is-text');
        thumb.setAttribute('aria-label', `阅读 ${r.name}`);
        thumb.title = `在应用内阅读：${r.name}`;
        thumb.innerHTML = fileGlyphHtml(ext);
        const glyph = thumb.querySelector('.preview-file-glyph');
        if (glyph) glyph.classList.add('is-readable');
        thumb.addEventListener('click', () => openDocumentPreview(r.blob, r.name));
      } else {
        thumb.disabled = true;
        thumb.classList.add('is-static');
        thumb.setAttribute('aria-label', `${r.name}，暂不支持内容预览`);
        thumb.innerHTML = fileGlyphHtml(ext);
      }
      const body = document.createElement('div');
      body.className = 'preview-card-body';
      const nameEl = document.createElement('p');
      nameEl.className = 'preview-file-name';
      nameEl.title = r.name;
      nameEl.textContent = r.name;
      const meta = document.createElement('p');
      meta.className = 'preview-file-meta';
      const size = formatBytes(r.blob.size);
      meta.innerHTML = `<span>${escapeHtml(r.meta || size)}</span>${r.meta && r.meta !== size ? `<span class="dot">·</span><span>${escapeHtml(size)}</span>` : ''}`;
      const actions = document.createElement('div');
      actions.className = 'preview-card-actions';
      if (kind === 'text') {
        const read = document.createElement('button');
        read.type = 'button';
        read.className = 'btn btn-secondary btn-card-download';
        read.textContent = '阅读';
        read.addEventListener('click', () => openDocumentPreview(r.blob, r.name));
        actions.appendChild(read);
      }
      const dl = document.createElement('button');
      dl.type = 'button';
      dl.className = 'btn btn-ghost btn-card-download';
      dl.textContent = '下载';
      dl.addEventListener('click', () => triggerDownload(r.blob, r.name));
      actions.appendChild(dl);
      body.appendChild(nameEl);
      body.appendChild(meta);
      body.appendChild(actions);
      card.appendChild(thumb);
      card.appendChild(body);
      wsResultsGrid.appendChild(card);
    });
    wsZipBtn.disabled = state.results.length < 2;
    if (wsViewResultsBtn) wsViewResultsBtn.hidden = state.results.length === 0;
  }

  const wsCancelBtn = $('wsCancelBtn');
  let progressRaf = 0;
  let pendingProgress = null;

  function cancelPendingProgress() {
    if (progressRaf) { cancelAnimationFrame(progressRaf); progressRaf = 0; }
    pendingProgress = null;
  }

  function throwIfAborted(signal) {
    if (!signal || !signal.aborted) return;
    const e = new Error('任务已取消');
    e.name = 'AbortError';
    throw e;
  }

  /** 取消当前任务；工具内部每个 ctx.progress 检查点都会响应取消信号。 */
  function cancelCurrentTask() {
    if (!state.controller) return;
    state.controller.abort();
    if (wsCancelBtn) {
      wsCancelBtn.disabled = true;
      wsCancelBtn.textContent = '正在取消…';
    }
    if (wsRunHint) {
      wsRunHint.textContent = '正在取消…';
      wsRunHint.classList.remove('is-blocked');
    }
  }
  if (wsCancelBtn) wsCancelBtn.addEventListener('click', cancelCurrentTask);
  if (wsViewResultsBtn) {
    wsViewResultsBtn.addEventListener('click', () => {
      if (wsResultsSection.hidden) return;
      wsResultsSection.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' });
      focusView(wsResultsSection);
    });
  }

  wsRunBtn.addEventListener('click', async () => {
    if (state.busy || !state.tool) return;
    const tool = state.tool;
    // minFiles: 0 用于「纯文本输入型」工具（如粘贴 Base64 转图片），不能写成 || 1
    const minFiles = tool.minFiles == null ? 1 : tool.minFiles;
    const maxFiles = tool.single ? 1 : (Number(tool.maxFiles) || Infinity);
    // 从 DOM 重新读取，兼容脚本或自动填充直接修改控件而未派发 input 的情况。
    const optionsSnapshot = collectOptions();
    syncOptionVisibility();
    const validation = validateOptions(true);
    const customError = typeof tool.validateOptions === 'function'
      ? (tool.validateOptions(optionsSnapshot, state.files) || '')
      : '';
    if (state.files.length < minFiles) {
      showToast(`至少需要 ${minFiles} 个文件。`, 'warn');
      return;
    }
    if (Number.isFinite(maxFiles) && state.files.length > maxFiles) {
      showToast(`最多 ${maxFiles} 个文件，请移除多余的。`, 'warn');
      return;
    }
    if (!validation.valid) {
      showToast(validation.message, 'warn');
      return;
    }
    if (customError) {
      showToast(customError, 'warn');
      return;
    }
    const taskId = ++state.taskId;
    const controller = new AbortController();
    state.controller = controller;
    state.busy = true;
    syncTaskLock();
    renderFileList();
    wsZipBtn.disabled = true;
    if (wsCancelBtn) {
      wsCancelBtn.hidden = false;
      wsCancelBtn.disabled = false;
      wsCancelBtn.textContent = '取消任务';
    }
    closeLightbox();
    clearResults();
    setProgress(0, 1, '正在准备处理...');
    const ctx = {
      files: state.files.slice(),
      get: k => optionsSnapshot[k],
      signal: controller.signal,
      progress: (done, total, text) => {
        throwIfAborted(controller.signal);
        setProgress(done, total, text);
      },
    };
    try {
      const results = await tool.run(ctx);
      throwIfAborted(controller.signal);
      if (taskId !== state.taskId || !state.tool || state.tool.id !== tool.id) return;
      state.results = (Array.isArray(results) ? results : []).map(r => ({
        ...r,
        url: previewKind(r.blob, r.name) === 'image' ? trackUrl(URL.createObjectURL(r.blob)) : null,
      }));
      const count = state.results.length;
      if (!count) {
        setProgress(1, 1, '未生成文件');
        wsProgress.classList.remove('is-error');
        wsProgress.classList.add('is-success');
        showToast('未生成文件，请检查输入或参数。', 'warn', 6000);
      } else {
        setProgress(1, 1, `处理完成！共生成 ${count} 个文件`);
        wsProgress.classList.remove('is-error');
        wsProgress.classList.add('is-success');
        recordRecent(tool.id);
        renderResults();
        showToast(`处理完成，生成 ${count} 个文件`, 'success');
      }
      wsProgress.classList.remove('is-empty');
      if (!count) wsProgress.classList.add('is-empty');
    } catch (err) {
      cancelPendingProgress();
      if (taskId !== state.taskId || !state.tool || state.tool.id !== tool.id) return;
      if (err && err.name === 'AbortError') {
        wsProgress.hidden = false;
        wsProgress.classList.remove('is-success', 'is-error', 'is-empty');
        wsProgressText.textContent = '任务已取消';
        wsProgressPct.textContent = '';
        if (wsProgressBar) wsProgressBar.setAttribute('aria-valuenow', '0');
      } else {
        const msg = '处理失败：' + (err && err.message ? err.message : err);
        reportError(msg, err);
        wsProgress.hidden = false;
        wsProgress.classList.remove('is-success', 'is-empty');
        wsProgress.classList.add('is-error');
        wsProgressText.textContent = msg;
      }
    } finally {
      if (state.controller === controller) {
        state.busy = false;
        state.controller = null;
        syncTaskLock();
        renderFileList();
      }
      if (wsCancelBtn) {
        wsCancelBtn.hidden = true;
        wsCancelBtn.disabled = false;
        wsCancelBtn.textContent = '取消任务';
      }
    }
  });

  wsZipBtn.addEventListener('click', async () => {
    if (state.busy || state.results.length < 2 || typeof JSZip === 'undefined') return;
    const old = wsZipBtn.innerHTML;
    wsZipBtn.disabled = true;
    wsZipBtn.textContent = '正在打包...';
    try {
      const zip = new JSZip();
      const seen = new Set();
      state.results.forEach(r => {
        let name = r.name || '未命名';
        if (seen.has(name)) {
          const dot = name.lastIndexOf('.');
          const stem = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : '';
          let n = 2;
          while (seen.has(`${stem}(${n})${ext}`)) n++;
          name = `${stem}(${n})${ext}`;
        }
        seen.add(name);
        zip.file(name, r.blob);
      });
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: CONFIG.zipLevel } });
      triggerDownload(blob, '处理结果.zip');
    } catch (err) {
      reportError('打包失败：' + err.message, err);
    } finally {
      wsZipBtn.innerHTML = old;
      wsZipBtn.disabled = state.busy || state.results.length < 2;
    }
  });

  /* ============================================================
     11. 文件内容预览 / Lightbox
     图片直接由本地文件生成缩略图；PDF 用 PDF.js 在本地渲染首页，
     大图预览支持逐页翻页，全程不上传任何文件。
     ============================================================ */
  const lightboxModal = $('lightboxModal');
  const lightboxImg = $('lightboxImg');
  const lightboxCloseBtn = $('lightboxCloseBtn');
  const lightboxToolbar = $('lightboxToolbar');
  const lightboxTitle = $('lightboxTitle');
  const lightboxPager = $('lightboxPager');
  const lightboxPrevBtn = $('lightboxPrevBtn');
  const lightboxNextBtn = $('lightboxNextBtn');
  const lightboxPageInfo = $('lightboxPageInfo');
  const lightboxStatus = $('lightboxStatus');
  const lightboxStage = $('lightboxStage');
  const lightboxDocumentWrap = $('lightboxDocumentWrap');
  const lightboxDocument = $('lightboxDocument');
  const lightboxText = $('lightboxText');
  const inertedElements = [];

  // 以 File / Blob 对象为 key 缓存预览，避免列表重绘时反复渲染
  const previewCache = new Map();
  const lightbox = { kind: null, entry: null, page: 0, pageUrl: null };
  let pdfActive = 0;
  const pdfPending = [];
  let lightboxSeq = 0;
  let pdfRenderSeq = 0;
  let pdfRenderBusy = false;
  let lightboxWheelDelta = 0;
  let lightboxWheelStamp = 0;
  let lightboxWheelLockUntil = 0;
  let lightboxBodyPad = '';

  function previewKind(source, name) {
    const type = (source && source.type) || '';
    const ext = (String(name || (source && source.name) || '').split('.').pop() || '').toLowerCase();
    if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (/^image\//.test(type) || /^(png|jpe?g|webp|gif|bmp|svg|avif|ico|cur|tiff?|heic|heif)$/.test(ext)) return 'image';
    if (/^text\//.test(type) || /^(txt|text|log|csv|tsv|md|markdown|json|xml|html?|css|js|rtf|yaml|yml)$/.test(ext)) return 'text';
    return 'other';
  }

  // 限制 PDF.js 并发，避免一次选择大量文件时抢占 worker / 内存
  function queuePdfPreview(task) {
    return new Promise((resolve, reject) => {
      pdfPending.push({ task, resolve, reject });
      pumpPdfPreview();
    });
  }
  function pumpPdfPreview() {
    while (pdfActive < CONFIG.pdfPreviewConcurrency && pdfPending.length) {
      const job = pdfPending.shift();
      pdfActive++;
      Promise.resolve().then(job.task).then(
        v => job.resolve(v),
        e => job.reject(e)
      ).then(() => {
        pdfActive--;
        pumpPdfPreview();
      });
    }
  }

  async function buildPdfPreview(entry, source) {
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF 预览组件未加载');
    const doc = await loadPdfjsDoc(source);
    if (entry.released) {
      try { await doc.destroy(); } catch (e) { /* ignore */ }
      return entry;
    }
    entry.doc = doc;
    entry.pages = doc.numPages || 0;
    const first = await doc.getPage(1);
    const base = first.getViewport({ scale: 1 });
    // 放大缩略图模式下也要看得清，首页按 720px 宽渲染，两种模式共用一张图
    const scale = Math.min(2.2, Math.max(0.2, 720 / (base.width || 720)));
    const canvas = await renderPageToCanvas(doc, 1, scale);
    const blob = await canvasToBlob(canvas, 'image/png');
    canvas.width = canvas.height = 0; // 显式释放位图内存，不再只等 GC
    if (!blob) throw new Error('PDF 首页渲染失败');
    if (entry.released) return entry;
    entry.url = trackUrl(URL.createObjectURL(blob));
    entry.state = 'ready';
    return entry;
  }

  // 浏览器无法直接显示 TIFF / ICO 等格式，先解码成 PNG 再生成预览地址
  async function buildImagePreview(entry, source) {
    const canvas = await imageFileToCanvas(source);
    const blob = await canvasToBlob(canvas, 'image/png');
    canvas.width = canvas.height = 0;
    if (entry.released) return entry;
    if (!blob) throw new Error('缩略图生成失败');
    entry.url = trackUrl(URL.createObjectURL(blob));
    entry.state = 'ready';
    return entry;
  }

  function getPreview(source, name) {
    let entry = previewCache.get(source);
    if (entry) {
      // LRU：命中项移到队尾，淘汰时优先保留最近使用与当前弹层项
      previewCache.delete(source);
      previewCache.set(source, entry);
      return entry;
    }
    const kind = previewKind(source, name);
    entry = {
      kind,
      name: name || (source && source.name) || '',
      state: 'loading',
      url: null,
      doc: null,
      pages: 0,
      error: '',
      released: false,
      promise: null,
    };
    previewCache.set(source, entry);
    trimPreviewCache();
    if (kind === 'image') {
      const ext = imageExtOf(name || (source && source.name) || '');
      if (/^(tiff?|ico|cur|heic|heif|psd)$/.test(ext)) {
        entry.promise = buildImagePreview(entry, source).catch(err => {
          entry.state = 'error';
          entry.error = err && err.message ? err.message : String(err);
          return entry;
        });
      } else {
        entry.url = trackUrl(URL.createObjectURL(source));
        entry.state = 'ready';
        entry.promise = Promise.resolve(entry);
      }
    } else if (kind === 'pdf') {
      entry.promise = queuePdfPreview(() => buildPdfPreview(entry, source)).catch(err => {
        entry.state = 'error';
        entry.error = err && err.message ? err.message : String(err);
        return entry;
      });
    } else {
      entry.state = 'other';
      entry.promise = Promise.resolve(entry);
    }
    return entry;
  }

  function destroyPdfDoc(doc) {
    if (!doc) return;
    try {
      const p = doc.destroy();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* ignore */ }
  }

  // 延迟到当前任务结束后再释放：撤销时页面上可能还有 <img> 正在加载该 URL，
  // 同步撤销会产生 net::ERR_FILE_NOT_FOUND 并让缩略图闪断。
  function revokeLater(url) {
    if (!url) return;
    setTimeout(() => revokeUrl(url), 0);
  }

  // 预览缓存原先无上限且长期持有 pdfjs 文档，这里按 LRU 淘汰空闲项。
  function trimPreviewCache() {
    if (previewCache.size <= CONFIG.previewCacheMax) return;
    for (const [key, entry] of previewCache) {
      if (previewCache.size <= CONFIG.previewCacheMax) break;
      if (entry === lightbox.entry || entry.state === 'loading') continue;
      releasePreview(key);
    }
  }

  function releasePreview(source) {
    const entry = previewCache.get(source);
    if (!entry) return;
    previewCache.delete(source);
    entry.released = true;
    if (entry.url) {
      revokeLater(entry.url);
      entry.url = null;
    }
    destroyPdfDoc(entry.doc);
    entry.doc = null;
  }

  function releaseAllPreviews() {
    Array.from(previewCache.keys()).forEach(releasePreview);
    previewCache.clear();
  }

  function makeThumbPlaceholder(main, sub, compact) {
    const box = document.createElement('span');
    box.className = 'thumb-placeholder' + (compact ? ' compact' : '');
    const top = document.createElement('span');
    top.className = 'thumb-placeholder-main';
    top.textContent = main;
    box.appendChild(top);
    if (sub) {
      const bottom = document.createElement('span');
      bottom.className = 'thumb-placeholder-sub';
      bottom.textContent = sub;
      box.appendChild(bottom);
    }
    return box;
  }

  function fileGlyphHtml(ext) {
    return `<span class="preview-file-glyph"><svg class="icon icon-lg" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg><span class="ext-tag">${escapeHtml(ext)}</span></span>`;
  }

  // 输入文件列表缩略图（紧凑列表 42px / 放大卡片 210px）
  function paintFileThumb(btn, entry, name) {
    btn.innerHTML = '';
    btn.disabled = entry.kind === 'other';
    const compact = state.fileView !== 'grid';
    if (entry.state === 'ready' && entry.url) {
      const img = document.createElement('img');
      img.src = entry.url;
      img.alt = name;
      btn.appendChild(img);
      btn.title = `预览 ${name}${entry.kind === 'pdf' && entry.pages ? `（共 ${entry.pages} 页，可翻页）` : ''}`;
    } else if (entry.state === 'loading') {
      btn.appendChild(makeThumbPlaceholder('···', '', compact));
      btn.title = `正在生成 ${name} 的内容预览…`;
    } else if (entry.state === 'error') {
      btn.appendChild(makeThumbPlaceholder('!', '', compact));
      btn.title = `预览不可用：${entry.error}`;
    } else {
      btn.appendChild(makeThumbPlaceholder(
        (String(name).split('.').pop() || '?').toUpperCase().slice(0, 4), '', compact
      ));
      btn.title = entry.kind === 'text' ? `阅读 ${name}` : `${name}（暂不支持内容预览）`;
    }
  }

  function updateFilePreviewMeta(item, entry) {
    const badge = item.querySelector('.file-pages');
    if (!badge) return;
    if (entry.kind === 'pdf' && entry.pages) {
      badge.textContent = `${entry.pages} 页`;
      badge.hidden = false;
    } else {
      badge.textContent = '';
      badge.hidden = true;
    }
  }

  // 结果卡片里的 PDF 首页缩略图
  function paintResultThumb(box, entry, name, ext) {
    box.innerHTML = '';
    box.title = `点击查看 ${name}`;
    if (!entry) {
      box.appendChild(makeThumbPlaceholder('PDF', '点击预览'));
      return;
    }
    if (entry.state === 'ready' && entry.url) {
      const img = document.createElement('img');
      img.src = entry.url;
      img.alt = name;
      box.appendChild(img);
      if (entry.kind === 'pdf' && entry.pages) {
        const badge = document.createElement('span');
        badge.className = 'thumb-badge';
        badge.textContent = `${entry.pages} 页`;
        box.appendChild(badge);
      }
    } else if (entry.state === 'loading') {
      box.appendChild(makeThumbPlaceholder('PDF', '生成预览中…'));
    } else {
      box.innerHTML = fileGlyphHtml(ext);
      if (entry.state === 'error') {
        const note = document.createElement('span');
        note.className = 'thumb-note';
        note.textContent = '预览不可用';
        box.appendChild(note);
      }
    }
  }

  function resetLightbox() {
    ++lightboxSeq;
    ++pdfRenderSeq;
    pdfRenderBusy = false;
    if (lightbox.pageUrl) {
      revokeLater(lightbox.pageUrl);
      lightbox.pageUrl = null;
    }
    lightbox.kind = null;
    lightbox.entry = null;
    lightbox.page = 0;
    lightboxImg.removeAttribute('src');
    lightboxImg.hidden = false;
    if (lightboxDocumentWrap) lightboxDocumentWrap.hidden = true;
    if (lightboxDocument) lightboxDocument.srcdoc = '';
    if (lightboxText) {
      lightboxText.textContent = '';
      lightboxText.hidden = true;
    }
    lightboxStatus.hidden = true;
    lightboxStatus.textContent = '';
    lightboxToolbar.hidden = true;
    lightboxPager.hidden = true;
  }

  function lockBackgroundScroll() {
    if (document.body.classList.contains('lightbox-open')) return;
    // 补偿滚动条宽度，避免锁定后页面内容左右跳动
    const gap = window.innerWidth - document.documentElement.clientWidth;
    lightboxBodyPad = document.body.style.paddingRight;
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    document.body.classList.add('lightbox-open');
    document.documentElement.classList.add('lightbox-open');
  }

  function unlockBackgroundScroll() {
    if (!document.body.classList.contains('lightbox-open')) return;
    document.body.classList.remove('lightbox-open');
    document.documentElement.classList.remove('lightbox-open');
    document.body.style.paddingRight = lightboxBodyPad;
  }

  let lightboxReturnFocus = null;

  function setLightboxBackgroundInert(inert) {
    const nodes = [
      document.querySelector('.app-header'),
      document.querySelector('.main-content'),
      document.querySelector('#billAppView'),
    ].filter(Boolean);
    if (inert) {
      inertedElements.length = 0;
      nodes.forEach(node => {
        if (node.inert) return;
        node.inert = true;
        inertedElements.push(node);
      });
    } else {
      inertedElements.forEach(node => { node.inert = false; });
      inertedElements.length = 0;
    }
  }

  function trapFocus(event, container) {
    if (!container || event.key !== 'Tab') return;
    const focusable = Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hidden && el.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function showLightbox(title, paged) {
    lockBackgroundScroll();
    setLightboxBackgroundInert(true);
    lightboxWheelDelta = 0;
    lightboxWheelStamp = 0;
    lightboxWheelLockUntil = 0;
    if (lightboxStage) lightboxStage.scrollTop = 0;
    lightboxToolbar.hidden = false;
    lightboxTitle.textContent = title || '文件内容预览';
    lightboxImg.alt = title || '文件内容预览';
    const isDocument = lightbox.kind === 'text';
    lightboxImg.hidden = isDocument;
    if (lightboxDocumentWrap) lightboxDocumentWrap.hidden = !isDocument;
    lightboxPager.hidden = !paged;
    lightboxPageInfo.textContent = '1 / 1';
    lightboxModal.setAttribute('aria-label', title || '文件内容预览');
    lightboxModal.classList.add('active');
    lightboxModal.setAttribute('aria-hidden', 'false');
    // 焦点移入弹层，关闭后再还给触发元素，键盘用户不会「丢失位置」
    lightboxReturnFocus = document.activeElement;
    if (lightboxCloseBtn) lightboxCloseBtn.focus();
  }

  function openLightbox(url, name) {
    resetLightbox();
    lightbox.kind = 'image';
    lightboxImg.src = url;
    showLightbox(name || '图片预览', false);
  }

  async function renderPdfPage(n) {
    const entry = lightbox.entry;
    if (!entry || !entry.doc || lightbox.kind !== 'pdf') return;
    const total = Math.max(1, entry.pages || 1);
    const page = Math.min(total, Math.max(1, n));
    const seq = ++pdfRenderSeq;
    const session = lightboxSeq;
    pdfRenderBusy = true;
    lightboxPrevBtn.disabled = true;
    lightboxNextBtn.disabled = true;
    lightboxStatus.hidden = false;
    lightboxStatus.textContent = `正在渲染第 ${page} 页…`;
    try {
      const pg = await entry.doc.getPage(page);
      const base = pg.getViewport({ scale: 1 });
      const scale = Math.min(2, Math.max(0.5, 1100 / (base.width || 1100)));
      const canvas = await renderPageToCanvas(entry.doc, page, scale);
      const blob = await canvasToBlob(canvas, 'image/png');
      canvas.width = canvas.height = 0;
      if (!blob) throw new Error('页面渲染失败');
      const url = trackUrl(URL.createObjectURL(blob));
      if (seq !== pdfRenderSeq || session !== lightboxSeq || lightbox.kind !== 'pdf') {
        revokeUrl(url);
        return;
      }
      revokeLater(lightbox.pageUrl);
      lightbox.pageUrl = url;
      lightbox.page = page;
      lightboxImg.src = url;
      if (lightboxStage) lightboxStage.scrollTop = 0;
      lightboxPageInfo.textContent = `${page} / ${total}`;
      lightboxStatus.hidden = true;
    } catch (err) {
      if (seq !== pdfRenderSeq || lightbox.kind !== 'pdf') return;
      lightboxStatus.hidden = false;
      lightboxStatus.textContent = '页面预览失败：' + (err && err.message ? err.message : String(err));
      lightboxImg.removeAttribute('src');
    } finally {
      if (seq === pdfRenderSeq) pdfRenderBusy = false;
      if (seq === pdfRenderSeq && lightbox.kind === 'pdf') {
        lightboxPrevBtn.disabled = lightbox.page <= 1;
        lightboxNextBtn.disabled = lightbox.page >= total;
      }
    }
  }

  async function openDocumentPreview(source, name, forceText) {
    if (!source) return;
    const title = name || source.name || '文档内容';
    const ext = (String(title).split('.').pop() || '').toLowerCase();
    resetLightbox();
    const session = lightboxSeq;
    lightbox.kind = 'text';
    showLightbox(title, false);
    lightboxStatus.hidden = false;
    lightboxStatus.textContent = '正在读取内容…';
    try {
      let text = await source.text();
      if (session !== lightboxSeq || lightbox.kind !== 'text') return;
      const truncated = text.length > 2_000_000;
      if (truncated) text = text.slice(0, 2_000_000);
      if (!forceText && /^(html?|htm)$/.test(ext)) {
        if (lightboxDocument) lightboxDocument.srcdoc = text;
        if (lightboxDocument) lightboxDocument.hidden = false;
        if (lightboxText) lightboxText.hidden = true;
      } else {
        if (lightboxText) {
          lightboxText.textContent = text;
          lightboxText.hidden = false;
        }
        if (lightboxDocument) lightboxDocument.hidden = true;
      }
      lightboxStatus.textContent = truncated ? '内容较大，已只显示前 200 万字符。请下载后查看完整内容。' : '';
      lightboxStatus.hidden = !truncated;
    } catch (err) {
      if (session !== lightboxSeq) return;
      lightboxStatus.hidden = false;
      lightboxStatus.textContent = '无法读取此文档：' + (err && err.message ? err.message : '未知错误');
    }
  }

  async function openPreview(source, name) {
    const entry = getPreview(source, name);
    const title = name || entry.name || '文件内容预览';
    if (entry.kind === 'image') {
      if (entry.state === 'loading') await entry.promise;
      if (entry.state === 'ready' && entry.url) openLightbox(entry.url, title);
      return;
    }
    if (entry.kind === 'text') {
      await openDocumentPreview(source, title);
      return;
    }
    if (entry.kind !== 'pdf') return;
    resetLightbox();
    lightbox.kind = 'pdf';
    const session = lightboxSeq;
    showLightbox(title, true);
    if (entry.state === 'loading') {
      lightboxStatus.hidden = false;
      lightboxStatus.textContent = '正在解析 PDF…';
    }
    await entry.promise;
    if (session !== lightboxSeq || lightbox.kind !== 'pdf') return;
    if (!entry.doc || entry.state === 'error') {
      lightboxStatus.hidden = false;
      lightboxStatus.textContent = '无法预览该 PDF：' + (entry.error || '文件可能已损坏或加密');
      lightboxPager.hidden = true;
      return;
    }
    lightbox.entry = entry;
    await renderPdfPage(1);
  }

  function stepPdfPage(delta) {
    if (pdfRenderBusy) return;
    if (lightbox.kind !== 'pdf' || !lightbox.entry) return;
    const next = (lightbox.page || 1) + delta;
    if (next < 1 || next > (lightbox.entry.pages || 1)) return;
    renderPdfPage(next);
  }

  function closeLightbox() {
    const wasActive = lightboxModal.classList.contains('active');
    unlockBackgroundScroll();
    setLightboxBackgroundInert(false);
    lightboxWheelDelta = 0;
    lightboxWheelStamp = 0;
    lightboxWheelLockUntil = 0;
    resetLightbox();
    lightboxModal.classList.remove('active');
    lightboxModal.setAttribute('aria-hidden', 'true');
    if (wasActive && lightboxReturnFocus && lightboxReturnFocus.isConnected) {
      try { lightboxReturnFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    lightboxReturnFocus = null;
  }

  function wheelDeltaPixels(delta, mode) {
    if (mode === 1) return delta * 16;
    if (mode === 2) return delta * window.innerHeight;
    return delta;
  }

  // 滚轮只作用于预览弹层：内容超高时先上下滚动预览内容，
  // PDF 逐页预览滚动到底/顶则翻页，绝不把滚动传给背后的网页。
  function handleLightboxWheel(e) {
    if (!lightboxModal.classList.contains('active') || e.ctrlKey) return;
    // 文本报告和 iframe 自己负责滚动，父层拦截会吞掉它们的滚轮事件。
    if (lightbox.kind === 'text') return;
    e.preventDefault();
    const dy = wheelDeltaPixels(e.deltaY, e.deltaMode);
    if (!dy) return;
    if (lightboxStage && lightboxStage.scrollHeight - lightboxStage.clientHeight > 1) {
      const before = lightboxStage.scrollTop;
      lightboxStage.scrollTop = before + dy;
      if (lightboxStage.scrollTop !== before) {
        lightboxWheelDelta = 0;
        return;
      }
    }
    if (lightbox.kind !== 'pdf' || !lightbox.entry) return;
    const now = Date.now();
    if (now - lightboxWheelStamp > 350) lightboxWheelDelta = 0;
    lightboxWheelStamp = now;
    if (now < lightboxWheelLockUntil) return;
    lightboxWheelDelta += dy;
    if (Math.abs(lightboxWheelDelta) < 40) return;
    const dir = lightboxWheelDelta > 0 ? 1 : -1;
    lightboxWheelDelta = 0;
    lightboxWheelLockUntil = now + 260;
    stepPdfPage(dir);
  }

  if (lightboxCloseBtn) lightboxCloseBtn.addEventListener('click', closeLightbox);
  if (lightboxPrevBtn) lightboxPrevBtn.addEventListener('click', () => stepPdfPage(-1));
  if (lightboxNextBtn) lightboxNextBtn.addEventListener('click', () => stepPdfPage(1));
  if (lightboxModal) {
    lightboxModal.addEventListener('click', e => {
      if (e.target === lightboxModal) closeLightbox();
    });
    lightboxModal.addEventListener('wheel', handleLightboxWheel, { passive: false });
  }
  window.addEventListener('keydown', e => {
    if (!lightboxModal.classList.contains('active')) return;
    if (e.key === 'Tab') {
      trapFocus(e, lightboxModal);
      return;
    }
    if (e.key === 'Escape') closeLightbox();
    else if (lightbox.kind === 'pdf' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      stepPdfPage(e.key === 'ArrowLeft' ? -1 : 1);
    }
  });

  /* ============================================================
     12.1 票据识别工作台
     按 PyWork2 的银行回单 / 承兑汇票 / 发票管理 / 系统设置四页 UI 迁移。
     所有识别、排序、命名、导出都在浏览器内调用 05b 分区的本地算法完成。
     ============================================================ */
  const BILL_PAGES = {
    bank: { title: '银行回单识别', subtitle: '批量识别，自动汇总金额' },
    acceptance: { title: '承兑汇票识别', subtitle: '批量识别，提取票面信息' },
    invoice: { title: '发票识别与管理', subtitle: '批量排序、重命名与合并' },
    settings: { title: '系统设置', subtitle: '识别与界面设置' },
  };
  const BILL_SUPPORTED = /\.(pdf|ofd|png|jpg|jpeg|bmp|gif|webp|tif|tiff)$/i;
  const billQ = id => document.getElementById('bill-' + id);
  const billView = document.getElementById('billAppView');
  const billState = {
    page: 'bank',
    config: { configured: false, secret_id: '', secret_key: '' },
    bills: {
      bank_slip: { files: [], results: [], running: false, cancel: false, filter: 'all' },
      acceptance: { files: [], results: [], running: false, cancel: false, filter: 'all' },
    },
    invoice: {
      folder: '', includeSub: false, files: [], sourceFiles: [], records: [], preview: [], previewError: '',
      running: false, merging: false, cancel: false, filterText: '', filterStatus: 'all',
      order: { file: null, file_name: '', sheets: [], candidates: [], selected: null },
      sortNotice: { missing: [], unmatched: [], failed: [], matched: 0, total: 0 },
    },
  };
  let billConfirmResolver = null;
  let billModalReturnFocus = null;
  let billPreviewTimer = 0;

  function billAnyBusy() {
    return !!(
      billState.bills.bank_slip.running
      || billState.bills.acceptance.running
      || billState.invoice.running
      || billState.invoice.merging
    );
  }
  let billSortTimer = 0;
  let billTemplateDragIndex = -1;
  let billTemplateDragActive = false;
  let billBound = false;

  function billToast(message, type, timeout) {
    // 与工具箱共用同一套可访问提示，不再维护第二套 Toast 样式与播报规则。
    return showToast(message, type || 'info', timeout);
  }
  function billStatusInfo(status) {
    if (status === '识别成功') return 'bill-status-success';
    if (status === '识别失败') return 'bill-status-failed';
    if (status === '本地解析' || status === '号码已提取' || status === '本地解析中') return 'bill-status-local';
    if (status === '识别中' || status === '本地解析中') return 'bill-status-running';
    return 'bill-status-pending';
  }
  function billSetStatus(prefix, text) {
    const el = billQ(prefix + '-status');
    if (!el) return;
    el.textContent = text;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
  }
  function billSetProgress(prefix, ratio) {
    const fill = billQ(prefix + '-progress-fill');
    if (!fill) return;
    const value = Math.max(0, Math.min(1, Number(ratio) || 0));
    const percent = Math.round(value * 100);
    fill.style.width = percent + '%';
    // 空闲时折起进度条，避免常驻一条空灰线看起来像坏掉
    const bar = fill.parentElement;
    if (!bar) return;
    bar.classList.toggle('has-progress', value > 0);
    bar.classList.toggle('is-done', value >= 1);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(percent));
  }
  function billFileExt(name) {
    const parts = String(name || '').split('.');
    return (parts.length > 1 ? parts.pop() : 'FILE').toUpperCase().slice(0, 4);
  }
  function billOcrList(text) {
    try { return billParseOcrInput(text); } catch (e) { billToast(e.message, 'error'); return []; }
  }
  function billActiveOcrText() {
    // 本页输入优先于系统设置中的全局 JSON，避免局部输入被静默忽略。
    if (billState.page === 'bank' || billState.page === 'acceptance') {
      const local = billQ(billState.page + '-ocr-json');
      if (local && local.value.trim()) return local.value;
    }
    const global = billQ('ocr-json');
    return global && global.value.trim() ? global.value : '';
  }

  function billGlobalOcrAvailable() {
    const global = billQ('ocr-json');
    return !!(global && global.value.trim());
  }

  function billUpdateOcrSourceHints() {
    const globalReady = billGlobalOcrAvailable();
    ['bank', 'acceptance'].forEach(prefix => {
      const hint = billQ(prefix + '-ocr-source');
      if (!hint) return;
      const local = billQ(prefix + '-ocr-json');
      const localReady = !!(local && local.value.trim());
      hint.textContent = localReady
        ? '已导入识别结果'
        : (globalReady ? '已导入识别结果' : '本机识别');
      hint.classList.toggle('is-global', !localReady && globalReady);
    });
    const invoiceHint = billQ('invoice-ocr-source');
    if (invoiceHint) {
      invoiceHint.textContent = globalReady
        ? '已导入识别结果'
        : '本机识别';
      invoiceHint.classList.toggle('is-global', globalReady);
    }
    const invoiceCloud = billQ('invoice-recognize');
    if (invoiceCloud) invoiceCloud.hidden = !globalReady;
  }

  /* ---------------------------------------------------------------- 导航 */
  function billResetContentScroll() {
    const content = billView.querySelector('.bill-content');
    if (content) content.scrollTop = 0;
  }

  function billShowPage(page, options) {
    if (!BILL_PAGES[page]) return;
    billState.page = page;
    billView.querySelectorAll('.bill-nav-item').forEach(btn => {
      const active = btn.dataset.billPage === page;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    billView.querySelectorAll('.bill-page').forEach(section => {
      section.classList.toggle('active', section.id === 'bill-page-' + page);
    });
    billQ('page-title').textContent = BILL_PAGES[page].title;
    billQ('page-subtitle').textContent = BILL_PAGES[page].subtitle;
    document.title = `${BILL_PAGES[page].title} · 票据识别`;
    billUpdateOcrSourceHints();
    billResetContentScroll();
    if (document.body.classList.contains('bill-app-active') && !(options && options.fromRoute)) {
      syncRoute('#/bill/' + page);
    }
  }

  /* ------------------------------------------------------------ 系统设置 */
  function billLoadConfig() {
    try {
      const raw = JSON.parse(localStorage.getItem('officetoolbox.billConfig') || '{}');
      billState.config = {
        configured: !!(raw.secret_id && raw.secret_key),
        secret_id: raw.secret_id || '', secret_key: raw.secret_key || '',
      };
    } catch (e) { /* ignore */ }
    billQ('secret-id').value = billState.config.secret_id;
    billQ('secret-key').value = billState.config.secret_key;
    billUpdateConfigUI();
  }
  function billUpdateConfigUI() {
    const ok = billState.config.configured;
    const chip = billQ('config-chip');
    chip.textContent = ok ? '● 密钥已保存' : '● 本地模式';
    chip.classList.toggle('ok', ok);
    billQ('config-state-text').textContent = ok ? '密钥已保存' : '本地模式';
  }
  function billSaveConfig() {
    const id = billQ('secret-id').value.trim();
    const key = billQ('secret-key').value.trim();
    if (!id || !key) { billToast('请填写完整的 SecretId 和 SecretKey', 'warn'); return; }
    billState.config = { configured: true, secret_id: id, secret_key: key };
    try { localStorage.setItem('officetoolbox.billConfig', JSON.stringify(billState.config)); } catch (e) { /* ignore */ }
    billUpdateConfigUI();
    billToast('密钥已保存到本机', 'success');
  }
  function billClearConfig() {
    billState.config = { configured: false, secret_id: '', secret_key: '' };
    try { localStorage.removeItem('officetoolbox.billConfig'); } catch (e) { /* ignore */ }
    billQ('secret-id').value = '';
    billQ('secret-key').value = '';
    billUpdateConfigUI();
    billToast('本机保存的密钥已清除', 'success');
  }

  /* --------------------------------------------------- 银行回单 / 承兑汇票 */
  function billPrefixOf(mode) { return mode === 'bank_slip' ? 'bank' : 'acceptance'; }
  function billSetBillFiles(mode, files) {
    const bucket = billState.bills[mode];
    if (bucket.running) return;
    const list = Array.from(files || []).filter(f => BILL_SUPPORTED.test(f.name));
    bucket.files = list;
    bucket.results = [];
    bucket.filter = 'all';
    billRenderBillFiles(mode);
    billRenderBillResults(mode);
    billUpdateBillSummary(mode);
    billSetProgress(billPrefixOf(mode), 0);
    billSetStatus(billPrefixOf(mode), list.length ? `已选择 ${list.length} 个文件` : '请选择票据文件');
  }
  function billRenderBillFiles(mode) {
    const bucket = billState.bills[mode];
    const prefix = billPrefixOf(mode);
    billQ(prefix + '-file-list').innerHTML = bucket.files.map((file, i) => `
      <span class="bill-file-chip"><span class="bill-file-chip-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
      <button class="bill-chip-x" type="button" data-remove="${i}" ${bucket.running ? 'disabled' : ''}>×</button></span>`).join('');
    billUpdateBillControls(mode);
  }
  function billPickKeyFields(items) {
    const keys = ['日期', '时间', '收款人', '付款人', 'Number', 'Date', '金额'];
    const picked = [];
    for (const item of items || []) {
      if (!Array.isArray(item)) continue;
      const name = String(item[0] || ''), value = String(item[1] || '');
      if (value && keys.some(k => name.includes(k)) && picked.length < 4) picked.push([name, value]);
    }
    return picked;
  }
  function billCardHtml(result) {
    const name = result.file_name || '未知文件';
    const icon = billFileExt(name);
    if (result.pending) {
      return `<article class="bill-result-card"><div class="bill-result-head"><div class="bill-file-icon">${icon}</div>
        <div class="bill-result-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        <span class="bill-status bill-status-running">识别中</span></div>
        <div class="bill-result-pending"><span class="bill-mini-spinner"></span>正在解析本地票据…</div></article>`;
    }
    if (!result.ok) {
      return `<article class="bill-result-card"><div class="bill-result-head"><div class="bill-file-icon error">${icon}</div>
        <div class="bill-result-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        <span class="bill-status bill-status-failed">识别失败</span></div>
        <div class="bill-result-error">${escapeHtml(result.error || '识别失败')}</div></article>`;
    }
    const fields = billPickKeyFields(result.items);
    const kv = fields.length
      ? fields.map(([k, v]) => `<div class="bill-kv"><div class="bill-kv-name">${escapeHtml(k)}</div>
          <div class="bill-kv-value" title="${escapeHtml(v)}">${escapeHtml(v)}</div></div>`).join('')
      : '<div class="bill-kv"><div class="bill-kv-name">提示</div><div class="bill-kv-value">未提取到关键字段</div></div>';
    const rows = (result.items || []).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')
      || '<tr><td>提示</td><td>没有可显示的字段</td></tr>';
    return `<article class="bill-result-card"><div class="bill-result-head"><div class="bill-file-icon">${icon}</div>
      <div class="bill-result-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="bill-result-amount">¥${billFormatAmount(result.amount)}</div></div>
      <div class="bill-result-body"><div class="bill-kv-grid">${kv}</div>
      <button class="bill-link-btn" type="button" data-details="1" aria-expanded="false">查看详情</button></div>
      <div class="bill-result-details"><table><tbody>${rows}</tbody></table></div></article>`;
  }
  function billRenderBillResults(mode) {
    const bucket = billState.bills[mode];
    const prefix = billPrefixOf(mode);
    const finished = bucket.results.filter(r => r && !r.pending);
    const count = billQ(prefix + '-results-count');
    count.textContent = finished.length + ' 条';
    count.setAttribute('aria-live', 'polite');
    const box = billQ(prefix + '-results');
    const filter = bucket.filter || 'all';
    billQ(prefix + '-filters').querySelectorAll('[data-bill-filter]').forEach(button => {
      const active = button.dataset.billFilter === filter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (!bucket.results.length) {
      box.innerHTML = '<div class="bill-empty-state"><strong>还没有识别结果</strong><span>选择票据文件后点击「开始识别」</span></div>';
      return;
    }
    const visible = bucket.results.filter(result => {
      if (filter === 'success') return !result.pending && result.ok;
      if (filter === 'failed') return !result.pending && !result.ok;
      return true;
    });
    if (!visible.length) {
      box.innerHTML = '<div class="bill-empty-state">当前筛选下没有结果。</div>';
      return;
    }
    box.innerHTML = visible.map(billCardHtml).join('');
  }
  function billUpdateBillControls(mode) {
    const bucket = billState.bills[mode];
    const prefix = billPrefixOf(mode);
    const finished = bucket.results.filter(r => r && !r.pending);
    const recognize = billQ(prefix + '-recognize');
    const stop = billQ(prefix + '-stop');
    const exportBtn = billQ(prefix + '-export');
    const clear = billQ(prefix + '-clear');
    recognize.disabled = bucket.running || !bucket.files.length;
    stop.disabled = !bucket.running;
    stop.hidden = !bucket.running;
    exportBtn.disabled = bucket.running || !finished.length;
    exportBtn.hidden = !finished.length;
    clear.disabled = bucket.running || (!bucket.files.length && !bucket.results.length);
    clear.hidden = !bucket.files.length && !bucket.results.length;
    billQ(prefix + '-dropzone').classList.toggle('disabled', bucket.running);
    billQ(prefix + '-dropzone').setAttribute('aria-disabled', String(bucket.running));
    const actionGrid = recognize.closest('.bill-action-grid');
    if (actionGrid) {
      const visibleCount = Array.from(actionGrid.children).filter(child => !child.hidden).length;
      actionGrid.classList.toggle('single-action', visibleCount <= 1);
    }
  }
  function billUpdateBillSummary(mode) {
    const bucket = billState.bills[mode];
    const prefix = billPrefixOf(mode);
    const finished = bucket.results.filter(r => r && !r.pending);
    const success = finished.filter(r => r.ok);
    const total = success.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    billQ(prefix + '-summary-count').textContent = `${success.length} / ${finished.length || bucket.files.length}`;
    billQ(prefix + '-summary-amount').textContent = '¥' + billFormatAmount(total);
  }
  async function billStartRecognition(mode) {
    const bucket = billState.bills[mode];
    if (bucket.running || !bucket.files.length) return;
    const prefix = billPrefixOf(mode);
    const ocrList = billOcrList(billActiveOcrText());
    bucket.running = true;
    bucket.cancel = false;
    bucket.filter = 'all';
    bucket.results = bucket.files.map(file => ({ pending: true, ok: false, file_name: file.name, items: [], amount: 0, error: '' }));
    billRenderBillFiles(mode);
    billRenderBillResults(mode);
    billUpdateBillSummary(mode);
    billSetProgress(prefix, 0);
    billSetStatus(prefix, '开始识别…');
    billUpdateBillControls(mode);
    for (let i = 0; i < bucket.files.length; i++) {
      if (bucket.cancel) break;
      const file = bucket.files[i];
      billSetStatus(prefix, `正在识别 ${i + 1}/${bucket.files.length}：${file.name}`);
      await new Promise(r => setTimeout(r, 0));
      let data;
      if (ocrList[i]) data = ocrList[i];
      else {
        const analysis = await billAnalyzeFile(file, false);
        data = billLocalBillOcr(analysis, file);
        if (analysis.error) data.Error = analysis.error;
      }
      const parsed = billParseBillResult(data, mode === 'acceptance');
      bucket.results[i] = {
        pending: false, ok: parsed.ok && !parsed.error, file_name: file.name,
        items: parsed.items, amount: parsed.amount, error: parsed.error,
      };
      billRenderBillResults(mode);
      billUpdateBillSummary(mode);
      billSetProgress(prefix, (i + 1) / bucket.files.length);
    }
    const stopped = bucket.cancel;
    bucket.running = false;
    bucket.cancel = false;
    if (stopped) {
      bucket.results = bucket.results.map(result => result && result.pending
        ? { ...result, pending: false, ok: false, error: '任务已停止，此文件尚未识别' }
        : result);
      billRenderBillResults(mode);
      billUpdateBillSummary(mode);
    }
    billRenderBillFiles(mode);
    billUpdateBillControls(mode);
    const success = bucket.results.filter(r => r.ok).length;
    const completed = bucket.results.filter(r => !r.pending).length;
    billSetProgress(prefix, stopped
      ? (bucket.files.length ? completed / bucket.files.length : 0)
      : 1);
    if (stopped) {
      const bar = billQ(prefix + '-progress');
      if (bar) bar.classList.remove('is-done');
    }
    billSetStatus(prefix, stopped ? `已停止，完成 ${success}/${bucket.files.length}` : `识别完成：成功 ${success}/${bucket.files.length}`);
  }
  function billStopRecognition(mode) {
    const bucket = billState.bills[mode];
    if (!bucket.running) return;
    bucket.cancel = true;
    billQ(billPrefixOf(mode) + '-stop').disabled = true;
    billSetStatus(billPrefixOf(mode), '正在停止…');
  }
  function billClearBills(mode) {
    const bucket = billState.bills[mode];
    if (bucket.running) return;
    const prefix = billPrefixOf(mode);
    bucket.files = [];
    bucket.results = [];
    bucket.filter = 'all';
    billRenderBillFiles(mode);
    billRenderBillResults(mode);
    billUpdateBillSummary(mode);
    billSetProgress(prefix, 0);
    billSetStatus(prefix, '请选择票据文件');
  }
  async function billExportBills(mode) {
    const finished = billState.bills[mode].results.filter(r => r && !r.pending);
    if (!finished.length) { billToast('没有可导出的识别结果', 'warn'); return; }
    const blob = await billResultsToXlsx(finished);
    triggerDownload(blob, (mode === 'bank_slip' ? '银行回单' : '承兑汇票') + '识别结果.xlsx');
    billToast(`已导出 ${finished.length} 条记录`, 'success');
  }

  /* ------------------------------------------------------------- 发票管理 */
  function billSetInvoiceFiles(files, label) {
    const inv = billState.invoice;
    if (inv.running || inv.merging) return;
    const source = Array.from(files || []).filter(f => BILL_SUPPORTED.test(f.name));
    inv.sourceFiles = source;
    let list = source;
    if (!inv.includeSub) {
      list = list.filter(f => !f.webkitRelativePath || f.webkitRelativePath.split('/').length <= 2);
    }
    list = list.slice().sort((a, b) => billNaturalCompare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));
    inv.files = list;
    inv.folder = label || '所选文件';
    inv.records = list.map(file => {
      const hit = billCacheGet(file);
      const rec = billEmptyRecord(file);
      return hit ? { ...rec, ...hit, file, path: file.name, file_name: file.name, from_cache: true } : rec;
    });
    inv.preview = [];
    inv.filterText = '';
    inv.filterStatus = 'all';
    if (billQ('invoice-filter')) billQ('invoice-filter').value = '';
    if (billQ('invoice-status-filter')) billQ('invoice-status-filter').value = 'all';
    billQ('invoice-folder-path').textContent = `${inv.folder}（${list.length} 个文件）`;
    billClearSortNotice();
    billSetProgress('invoice', 0);
    billRenderInvoiceTable();
    billUpdateInvoiceSummary();
    billUpdateInvoiceControls();
    billRefreshPreview();
    billApplyInvoiceSort(true);
    const cached = inv.records.filter(r => r.from_cache).length;
    let text = `已扫描 ${list.length} 个文件`;
    if (cached) text += `，${cached} 个从缓存恢复`;
    if (list.length) text += '，请开始本地解析';
    billSetStatus('invoice', text);
    if (!list.length) billToast('没有找到支持的发票文件', 'warn');
    if (cached) billToast(`已从本地缓存恢复 ${cached} 张发票`, 'info', 4800);
  }
  function billInvoiceVisible(rec) {
    const inv = billState.invoice;
    const keyword = inv.filterText.trim().toLowerCase();
    if (keyword) {
      const haystack = [rec.file_name, rec.path, rec.invoice_number, rec.invoice_type, rec.buyer, rec.seller]
        .join(' ').toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    const filter = inv.filterStatus || 'all';
    if (filter === 'success') return rec.status === '识别成功';
    if (filter === 'local') return ['本地解析', '号码已提取'].includes(rec.status);
    if (filter === 'failed') return !['识别成功', '本地解析', '号码已提取'].includes(rec.status);
    return true;
  }

  function billRenderInvoiceTable() {
    const inv = billState.invoice;
    const body = billQ('invoice-table-body');
    const mobile = billQ('invoice-mobile-list');
    const empty = billQ('invoice-empty');
    const tableWrap = body.closest('.bill-table-wrap');
    const hasRecords = inv.records.length > 0;
    const visible = inv.records.map((record, index) => ({ record, index })).filter(item => billInvoiceVisible(item.record));
    empty.hidden = hasRecords && visible.length > 0;
    if (tableWrap) tableWrap.hidden = visible.length === 0;
    empty.textContent = hasRecords
      ? '没有符合条件的发票。'
      : '选择文件夹后，这里会显示发票列表。';
    if (!hasRecords) {
      body.innerHTML = '';
      mobile.innerHTML = '';
      billUpdateInvoiceControls();
      return;
    }
    body.innerHTML = visible.map(({ record: rec, index: i }) => {
      const preview = inv.preview[i] || '—';
      const showAmount = ['识别成功', '本地解析'].includes(rec.status) && !!Number(rec.amount);
      const note = rec.error || (rec.from_qr ? '来自二维码解析' : (rec.from_filename ? '号码来自文件名' : ''));
      const badge = rec.from_cache ? '<span class="bill-cache-badge">缓存</span>' : '';
      const count = (rec.invoices || []).length;
      const type = count > 1 ? `${rec.invoice_type || ''} 等${count}张` : (rec.invoice_type || '—');
      const number = count > 1 && rec.invoice_number ? `${rec.invoice_number} 等${count}张` : (rec.invoice_number || '—');
      return `<tr data-index="${i}" title="${escapeHtml(note)}">
        <td>${i + 1}</td>
        <td class="bill-ellipsis" title="${escapeHtml(rec.file_name)}">${escapeHtml(rec.file_name)}</td>
        <td class="bill-ellipsis bill-preview" title="${escapeHtml(preview)}">${escapeHtml(preview)}</td>
        <td>${escapeHtml(type)}</td><td class="bill-mono">${escapeHtml(number)}</td>
        <td>${escapeHtml(rec.invoice_date || '—')}</td>
        <td class="bill-num">${showAmount ? '¥' + billFormatAmount(rec.amount) : '—'}</td>
        <td class="bill-ellipsis" title="${escapeHtml(rec.buyer || '')}">${escapeHtml(rec.buyer || '—')}</td>
        <td class="bill-ellipsis" title="${escapeHtml(rec.seller || '')}">${escapeHtml(rec.seller || '—')}</td>
        <td><span class="bill-status ${billStatusInfo(rec.status)}">${escapeHtml(rec.status)}</span>${badge}</td>
        <td class="bill-actions-col"><button class="bill-row-detail-btn" type="button" data-detail="${i}" aria-label="查看第 ${i + 1} 个文件详情">详情</button></td>
      </tr>`;
    }).join('');
    mobile.innerHTML = visible.map(({ record: rec, index: i }) => {
      const preview = inv.preview[i] || '—';
      const amount = Number(rec.amount);
      const note = rec.error || '';
      return `<article class="bill-mobile-invoice-card" data-index="${i}">
        <div class="bill-mobile-invoice-head">
          <strong title="${escapeHtml(rec.file_name)}">${escapeHtml(rec.file_name)}</strong>
          <span class="bill-status ${billStatusInfo(rec.status)}">${escapeHtml(rec.status)}</span>
        </div>
        <div class="bill-mobile-invoice-name">新文件名：${escapeHtml(preview)}</div>
        <dl class="bill-mobile-invoice-fields">
          <div><dt>发票号码</dt><dd>${escapeHtml(rec.invoice_number || '—')}</dd></div>
          <div><dt>开票日期</dt><dd>${escapeHtml(rec.invoice_date || '—')}</dd></div>
          <div><dt>金额</dt><dd>${amount ? '¥' + billFormatAmount(amount) : '—'}</dd></div>
        </dl>
        ${note ? `<p class="bill-result-error">${escapeHtml(note)}</p>` : ''}
        <button class="bill-btn bill-btn-ghost bill-btn-sm" type="button" data-detail="${i}">查看详情</button>
      </article>`;
    }).join('');
    billUpdateInvoiceControls();
  }
  function billUpdateInvoiceSummary() {
    const records = billState.invoice.records;
    const success = records.filter(r => r.status === '识别成功');
    const cached = success.filter(r => r.from_cache).length;
    const local = records.filter(r => ['本地解析', '号码已提取'].includes(r.status)).length;
    const total = records.filter(r => r.status === '识别成功' || (r.status === '本地解析' && Number(r.amount)))
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
    billQ('invoice-summary').textContent = `文件 ${records.length} 个 · 已识别 ${success.length}`
      + (cached ? ` · 缓存 ${cached}` : '') + (local ? ` · 本地解析 ${local}` : '')
      + ` · 合计 ¥${billFormatAmount(total)}`;
  }
  function billUpdateInvoiceControls() {
    const inv = billState.invoice;
    const records = inv.records;
    const running = inv.running;
    const busy = inv.running || inv.merging;
    const has = records.length > 0;
    const cloudReady = billGlobalOcrAvailable();
    const hasPendingLocal = records.some(r => ['待识别', '识别失败', '号码已提取'].includes(r.status));
    const hasPendingCloud = records.some(r => r.status !== '识别成功');
    const dis = (id, value) => { const el = billQ(id); if (el) el.disabled = value; };
    const hide = (id, value) => { const el = billQ(id); if (el) el.hidden = value; };
    dis('invoice-pick-folder', busy);
    dis('invoice-pick-files', busy);
    dis('invoice-include-sub', busy);
    dis('invoice-rescan', busy || !inv.sourceFiles.length);
    dis('invoice-clear-cache', busy);
    dis('invoice-local-parse', busy || !has || !hasPendingLocal);
    dis('invoice-recognize', busy || !has || !hasPendingCloud || !cloudReady);
    hide('invoice-recognize', !cloudReady || !has);
    dis('invoice-stop', !running);
    hide('invoice-stop', !running);
    dis('invoice-merge', busy || !has);
    dis('invoice-export', busy || !has);
    ['invoice-sort-mode', 'invoice-prefix', 'invoice-start', 'invoice-digits',
      'invoice-name-template', 'invoice-reset-template', 'invoice-import-order', 'invoice-order-column',
      'invoice-filter', 'invoice-status-filter'].forEach(id => dis(id, busy || !has));
    dis('invoice-rename', busy || !has || !!inv.previewError);
    dis('invoice-custom-order', busy || !has || billQ('invoice-sort-mode').value !== 'custom');
    const output = billQ('invoice-output-panel');
    if (output) output.hidden = !has;
    billQ('invoice-template-fields').querySelectorAll('.bill-template-chip').forEach(b => { b.disabled = busy || !has; });
    const selectedChips = billQ('invoice-template-fields').querySelectorAll('.bill-selected-chip');
    selectedChips.forEach((chip, index) => {
      chip.draggable = !busy && has;
      chip.querySelectorAll('.bill-selected-x').forEach(button => { button.disabled = busy || !has; });
      chip.querySelectorAll('.bill-chip-move').forEach(button => {
        const direction = Number(button.dataset.move);
        button.disabled = busy || !has
          || (direction < 0 && index === 0)
          || (direction > 0 && index === selectedChips.length - 1);
      });
    });
  }
  function billTemplateInput() { return billQ('invoice-name-template'); }
  function billTemplateTokens() { return billTemplateInput().value.match(/\{[^{}]+\}/g) || []; }
  function billRenderTemplateFields() {
    const tokens = billTemplateTokens();
    const selectedSet = new Set(tokens);
    const running = billState.invoice.running;
    const labelOf = token => {
      const entry = BILL_TEMPLATE_FIELDS.find(f => f[0] === token);
      return entry ? entry[1] : token.slice(1, -1);
    };
    const selected = tokens.map((token, i) => `
      <span class="bill-selected-chip" draggable="${!running}" data-token="${escapeHtml(token)}" data-index="${i}" title="拖动调整顺序，点击移除">
        <span class="bill-drag-handle" aria-hidden="true">⋮⋮</span><span>${escapeHtml(labelOf(token))}</span>
        <button class="bill-chip-move" type="button" data-move="-1" data-index="${i}" draggable="false" aria-label="前移字段 ${escapeHtml(labelOf(token))}" title="前移" ${running || i === 0 ? 'disabled' : ''}>←</button>
        <button class="bill-chip-move" type="button" data-move="1" data-index="${i}" draggable="false" aria-label="后移字段 ${escapeHtml(labelOf(token))}" title="后移" ${running || i === tokens.length - 1 ? 'disabled' : ''}>→</button>
        <button class="bill-selected-x" type="button" data-remove="${i}" draggable="false" aria-label="移除字段 ${escapeHtml(labelOf(token))}" ${running ? 'disabled' : ''}>×</button></span>`).join('');
    const palette = BILL_TEMPLATE_FIELDS.filter(([field]) => !selectedSet.has(field))
      .map(([field, label]) => `<button class="bill-template-chip" type="button" data-field="${escapeHtml(field)}" ${running ? 'disabled' : ''}>${escapeHtml(label)}</button>`).join('');
    const divider = selected && palette ? '<span class="bill-field-divider"></span>' : '';
    billQ('invoice-template-fields').innerHTML = selected + divider + palette;
  }
  function billCleanTemplate(value) {
    return String(value || '').replace(/_{2,}/g, '_').replace(/-{2,}/g, '-').replace(/^[_\-]+|[_\-]+$/g, '');
  }
  function billToggleTemplateField(field) {
    const input = billTemplateInput();
    if (input.disabled) return;
    let value = input.value;
    value = value.includes(field) ? billCleanTemplate(value.split(field).join('')) : value + field;
    input.value = value;
    billRenderTemplateFields();
    billRefreshPreview();
  }
  function billRemoveTemplateFieldAt(index) {
    if (billState.invoice.running) return;
    const input = billTemplateInput();
    const parts = input.value.split(/(\{[^{}]+\})/);
    const indices = [];
    parts.forEach((part, i) => { if (/^\{[^{}]+\}$/.test(part)) indices.push(i); });
    if (index < 0 || index >= indices.length) return;
    parts.splice(indices[index], 1);
    input.value = billCleanTemplate(parts.join(''));
    billRenderTemplateFields();
    billRefreshPreview();
  }
  function billReorderTemplateField(from, to) {
    if (billState.invoice.running || from === to) return;
    const input = billTemplateInput();
    const parts = input.value.split(/(\{[^{}]+\})/);
    const indices = [];
    parts.forEach((part, i) => { if (/^\{[^{}]+\}$/.test(part)) indices.push(i); });
    if (from >= indices.length || to >= indices.length || from < 0 || to < 0) return;
    const tokens = indices.map(i => parts[i]);
    const [moved] = tokens.splice(from, 1);
    tokens.splice(to, 0, moved);
    indices.forEach((partIndex, i) => { parts[partIndex] = tokens[i]; });
    input.value = parts.join('');
    billRenderTemplateFields();
    billRefreshPreview();
    requestAnimationFrame(() => {
      const chip = billQ('invoice-template-fields').querySelector(`.bill-selected-chip[data-index="${to}"]`);
      if (!chip) return;
      const direction = from < to ? -1 : 1;
      const target = chip.querySelector(`[data-move="${direction}"]`) || chip.querySelector('[data-move]:not([disabled])');
      if (target) target.focus();
    });
  }
  function billResetTemplate() {
    billTemplateInput().value = '{前缀}{序号}';
    billRenderTemplateFields();
    billRefreshPreview();
  }
  function billUpdateNamePreview() {
    const el = billQ('invoice-name-preview');
    const inv = billState.invoice;
    if (inv.previewError) { el.textContent = inv.previewError; el.classList.add('error'); return; }
    el.classList.remove('error');
    el.textContent = inv.records.length ? (inv.preview[0] || '—') : '扫描发票后显示';
  }
  function billRefreshPreview() {
    const inv = billState.invoice;
    if (!inv.records.length) { inv.preview = []; inv.previewError = ''; billUpdateNamePreview(); return; }
    try {
      const plan = billBuildRenamePlan(inv.records, {
        prefix: billQ('invoice-prefix').value, start: billQ('invoice-start').value,
        digits: billQ('invoice-digits').value, template: billQ('invoice-name-template').value,
      });
      inv.preview = plan.map(p => p.new_name);
      inv.previewError = '';
    } catch (e) {
      inv.preview = [];
      inv.previewError = e.message || '命名模板无效';
    }
    billRenderInvoiceTable();
    billUpdateNamePreview();
  }
  function billScheduleInvoicePreview() {
    clearTimeout(billPreviewTimer);
    billPreviewTimer = setTimeout(billRefreshPreview, 240);
  }
  function billOnSortModeChange() {
    billQ('invoice-custom-order').disabled = billState.invoice.running || billQ('invoice-sort-mode').value !== 'custom';
  }
  function billClearSortNotice() {
    billQ('invoice-sort-notice').hidden = true;
    billState.invoice.sortNotice = { missing: [], unmatched: [], failed: [], matched: 0, total: 0 };
  }
  function billShowSortNotice(stats) {
    const inv = billState.invoice;
    const parts = [`共 ${stats.total} 张，按指定号码匹配 ${stats.matched} 张`];
    if (stats.missing.length) parts.push(`清单中 ${stats.missing.length} 个号码未找到对应发票`);
    if (stats.unmatched.length) parts.push(`${stats.unmatched.length} 张发票不在清单中`);
    if (stats.failed.length) parts.push(`${stats.failed.length} 张未识别`);
    if (!stats.missing.length && !stats.unmatched.length && !stats.failed.length) parts.push('全部发票均已匹配');
    billQ('invoice-sort-notice-text').textContent = parts.join('；') + '。';
    billQ('invoice-sort-notice-detail').hidden = !(stats.missing.length || stats.unmatched.length || stats.failed.length);
    const notice = billQ('invoice-sort-notice');
    notice.className = 'bill-sort-notice ' + ((stats.missing.length || stats.unmatched.length || stats.failed.length) ? 'warn' : 'success');
    notice.hidden = false;
    inv.sortNotice = { missing: stats.missing, unmatched: stats.unmatched, failed: stats.failed, matched: stats.matched, total: stats.total };
  }
  function billShowSortNoticeDetail() {
    const d = billState.invoice.sortNotice;
    const section = (title, items) => items.length
      ? `<h4 class="bill-detail-section-title">${escapeHtml(title)}（${items.length}）</h4><div class="bill-notice-list">${items.map(x => `<span>${escapeHtml(x)}</span>`).join('')}</div>` : '';
    let html = `<div class="bill-detail-meta"><span>共 <strong>${d.total}</strong> 张</span><span>匹配 <strong>${d.matched}</strong> 张</span>
      <span>清单缺失 <strong>${d.missing.length}</strong> 个</span><span>清单外 <strong>${d.unmatched.length}</strong> 张</span>
      <span>未识别 <strong>${d.failed.length}</strong> 张</span></div>`;
    html += section('未匹配的 Excel 号码', d.missing) + section('不在清单中的发票', d.unmatched) + section('未识别文件', d.failed);
    if (!d.missing.length && !d.unmatched.length && !d.failed.length) html += '<div class="bill-empty-state">全部发票均已匹配</div>';
    billQ('detail-title').textContent = '排序核对';
    billQ('detail-body').innerHTML = html;
    billModalReturnFocus = document.activeElement;
    billQ('modal-detail').hidden = false;
    billSetModalBackgroundInert(true);
    const close = billQ('detail-close');
    if (close) close.focus();
  }
  function billApplyInvoiceSort(auto) {
    const inv = billState.invoice;
    if (inv.running || !inv.records.length) {
      if (!auto && !inv.records.length) billToast('请先选择文件夹并扫描发票', 'warn');
      return;
    }
    const mode = billQ('invoice-sort-mode').value;
    const custom = billQ('invoice-custom-order').value;
    if (mode === 'custom' && !custom.trim()) { billClearSortNotice(); return; }
    const ordered = billSortRecords(inv.records, mode, custom);
    const stats = billSortStats(inv.records, ordered, mode, custom);
    inv.records = ordered;
    if (mode === 'custom' && custom.trim()) billShowSortNotice(stats);
    else billClearSortNotice();
    billRefreshPreview();
    billUpdateInvoiceSummary();
    if (!auto) billSetStatus('invoice', `已应用排序：${(BILL_SORT_MODES.find(m => m[0] === mode) || ['', mode])[1]}`);
  }
  function billScheduleAutoSort(delay) {
    if (billState.invoice.running) return;
    clearTimeout(billSortTimer);
    billSortTimer = setTimeout(() => billApplyInvoiceSort(true), Math.max(0, delay || 400));
  }
  function billOrderCandidateLabel(c, sheets) {
    const sheet = sheets.length > 1 ? c.sheet + ' · ' : '';
    return `${sheet}${c.header}（${c.count} 个，${c.length} 位）`;
  }
  async function billAppImportOrder(file) {
    if (!file) return;
    const inv = billState.invoice;
    try {
      const imported = await billImportOrderFile(file, billPreferredLength(inv.records));
      inv.order = {
        file, file_name: file.name, sheets: imported.sheets,
        candidates: imported.candidates, selected: imported.selected,
      };
      const select = billQ('invoice-order-column');
      select.innerHTML = imported.candidates.map((c, i) =>
        `<option value="${i}">${escapeHtml(billOrderCandidateLabel(c, imported.sheets))}</option>`).join('');
      if (imported.selected) {
        const idx = imported.candidates.indexOf(imported.selected);
        select.value = String(Math.max(0, idx));
      }
      select.hidden = imported.candidates.length <= 1;
      if (imported.numbers.length) {
        billQ('invoice-custom-order').value = imported.numbers.join('\n');
        billQ('invoice-sort-mode').value = 'custom';
        billOnSortModeChange();
        billQ('invoice-order-source').textContent = `${file.name} · ${imported.selected.header} · ${imported.numbers.length} 个号码`;
        billApplyInvoiceSort(true);
        billToast(`已从 ${file.name} 读取 ${imported.numbers.length} 个发票号码`, 'success', 4800);
      } else {
        billQ('invoice-order-source').textContent = `${file.name}：请选择发票号码所在列`;
        billToast('未在 Excel 中找到发票号码列，请选择候选列', 'warn');
      }
    } catch (e) {
      billToast(e.message || '读取 Excel 失败', 'error', 6000);
    }
  }
  async function billImportOrderFile(file, preferredLength) {
    const sheets = await billReadOrderSheets(file);
    const scan = billScanOrderCandidates(sheets, preferredLength);
    const selected = scan.suggested >= 0 ? scan.candidates[scan.suggested] : null;
    return {
      file_name: file.name, sheets: sheets.map(s => s.name), candidates: scan.candidates,
      selected, numbers: selected ? billReadOrderNumbers(sheets, selected) : [],
      rawSheets: sheets,
    };
  }
  async function billOnOrderColumnChange() {
    const inv = billState.invoice;
    const idx = Number(billQ('invoice-order-column').value);
    const candidate = inv.order.candidates[idx];
    if (!candidate || !inv.order.file) return;
    const sheets = await billReadOrderSheets(inv.order.file);
    const numbers = billReadOrderNumbers(sheets, candidate);
    inv.order.selected = candidate;
    billQ('invoice-custom-order').value = numbers.join('\n');
    billQ('invoice-order-source').textContent = `${inv.order.file_name} · ${candidate.sheet} · ${candidate.header} · ${numbers.length} 个号码`;
    billApplyInvoiceSort(true);
    billToast(numbers.length ? `已读取 ${numbers.length} 个号码` : '该列没有读取到发票号码', numbers.length ? 'success' : 'warn');
  }
  async function billStartInvoiceParse(cloud) {
    const inv = billState.invoice;
    if (inv.running || inv.merging || !inv.records.length) return;
    const ocrList = billOcrList(billActiveOcrText());
    if (cloud && !ocrList.length) {
      billToast('已使用本机识别结果。', 'warn', 6000);
    }
    const pending = inv.records.map((r, i) => ({ r, i }))
      .filter(({ r }) => cloud ? r.status !== '识别成功' : ['待识别', '识别失败', '号码已提取'].includes(r.status));
    if (!pending.length) { billToast('没有需要解析的文件', 'info'); return; }
    inv.running = true;
    inv.cancel = false;
    inv.filterStatus = 'all';
    inv.filterText = '';
    if (billQ('invoice-status-filter')) billQ('invoice-status-filter').value = 'all';
    if (billQ('invoice-filter')) billQ('invoice-filter').value = '';
    clearTimeout(billSortTimer);
    billClearSortNotice();
    billUpdateInvoiceControls();
    billSetProgress('invoice', 0);
    let success = 0;
    let processed = 0;
    for (let cursor = 0; cursor < pending.length; cursor++) {
      if (inv.cancel) break;
      const { r, i } = pending[cursor];
      inv.records[i].status = cloud ? '识别中' : '本地解析中';
      inv.records[i].error = '';
      billRenderInvoiceTable();
      billSetStatus('invoice', `正在解析 ${cursor + 1}/${pending.length}：${r.file_name}`);
      await new Promise(resolve => setTimeout(resolve, 0));
      const rec = await billBuildRecord(r.file, {
        useQr: true, useCache: true,
        ocrData: cloud ? ocrList[i] : null,
      });
      inv.records[i] = rec;
      processed++;
      if (rec.status === '识别成功' || rec.status === '本地解析') success++;
      billRenderInvoiceTable();
      billUpdateInvoiceSummary();
      billSetProgress('invoice', processed / pending.length);
    }
    const stopped = inv.cancel;
    inv.running = false;
    inv.cancel = false;
    if (stopped) {
      inv.records.forEach(record => {
        if (record.status === '识别中' || record.status === '本地解析中') {
          record.status = '待识别';
          record.error = '任务已停止，尚未解析';
        }
      });
    }
    billRefreshPreview();
    billUpdateInvoiceSummary();
    billUpdateInvoiceControls();
    billSetProgress('invoice', stopped ? processed / pending.length : 1);
    if (stopped) {
      const bar = billQ('invoice-progress');
      if (bar) bar.classList.remove('is-done');
    }
    billApplyInvoiceSort(true);
    billSetStatus('invoice', stopped
      ? `已停止，已处理 ${success}/${pending.length}`
      : `${cloud && ocrList.length ? '导入解析' : '本地解析'}完成：成功 ${success}/${pending.length}`);
    if (!stopped) billToast(`解析完成：${success}/${pending.length} 张`, 'success', 4800);
  }
  function billStopInvoiceParse() {
    if (!billState.invoice.running) return;
    billState.invoice.cancel = true;
    billQ('invoice-stop').disabled = true;
    billSetStatus('invoice', '正在停止…');
  }
  async function billClearInvoiceCache() {
    if (billState.invoice.running || billState.invoice.merging) return;
    const ok = await billConfirmAction('清空识别缓存', '清空识别缓存？下次扫描将重新解析。');
    if (!ok) return;
    billCacheClear();
    billToast('识别缓存已清空', 'success');
  }
  async function billRenameInvoices() {
    const inv = billState.invoice;
    if (inv.running || inv.merging || !inv.records.length) return;
    billRefreshPreview();
    if (inv.previewError) { billToast(inv.previewError, 'error', 6500); return; }
    const plan = billBuildRenamePlan(inv.records, {
      prefix: billQ('invoice-prefix').value, start: billQ('invoice-start').value,
      digits: billQ('invoice-digits').value, template: billQ('invoice-name-template').value,
    });
    const changed = plan.filter(p => p.new_name !== p.old_name).length;
    if (!changed) { billToast('当前文件名已符合命名规则', 'info'); return; }
    inv.merging = true;
    billUpdateInvoiceControls();
    try {
      const lines = plan.slice(0, 8).map(p => `${p.old_name}  →  ${p.new_name}`).join('\n');
      const more = plan.length > 8 ? `\n…… 共 ${plan.length} 个文件` : '';
      const ok = await billConfirmAction('确认重命名',
        `将重命名 ${changed} 个文件：\n\n${lines}${more}\n\n结果以 ZIP 下载。`);
      if (!ok) return;
      const report = ['发票重命名报告', `模板：${billQ('invoice-name-template').value}`,
        `文件数：${plan.length}`, '', '请解压 ZIP 使用重命名副本。', '']
        .concat(plan.map(p => `${p.old_name} → ${p.new_name}`)).join('\r\n');
      const zip = await billRenamedZip(plan, report);
      triggerDownload(zip, '发票重命名副本.zip');
      plan.forEach(p => { p.record.file_name = p.new_name; p.record.path = p.new_name; p.record.from_cache = false; });
      billRefreshPreview();
      billToast(`已生成 ${changed} 个重命名副本（ZIP 下载）`, 'success', 5200);
    } catch (e) {
      billToast('生成重命名副本失败：' + (e.message || '未知错误'), 'error', 6000);
    } finally {
      inv.merging = false;
      billUpdateInvoiceControls();
    }
  }
  async function billMergeInvoices() {
    const inv = billState.invoice;
    if (inv.running || inv.merging) return;
    if (!inv.records.length) { billToast('没有可合并的发票文件', 'warn'); return; }
    inv.merging = true;
    billUpdateInvoiceControls();
    billSetStatus('invoice', '正在按当前顺序合成 PDF…');
    billSetProgress('invoice', 0);
    try {
      const out = await billMergeRecordsToPdf(inv.records, (i, n, name) => {
        billSetStatus('invoice', `正在合成 ${i + 1}/${n}：${name}`);
        billSetProgress('invoice', (i + 1) / n);
      });
      triggerDownload(out.blob, '发票合并.pdf');
      billSetProgress('invoice', 1);
      billSetStatus('invoice', `合成完成：${out.merged.length} 个文件${out.skipped.length ? `，跳过 ${out.skipped.length} 个` : ''}`);
      billToast(`已按当前顺序合成 ${out.merged.length} 个文件`, 'success', 5600);
      if (out.skipped.length) {
        billToast(`跳过 ${out.skipped.length} 个：${out.skipped.slice(0, 3).map(([n, r]) => `${n}（${r}）`).join('；')}`, 'warn', 7000);
      }
    } catch (e) {
      billSetStatus('invoice', '合成失败：' + (e.message || '未知错误'));
      billToast(e.message || '合成失败', 'error', 6000);
    } finally {
      inv.merging = false;
      billUpdateInvoiceControls();
    }
  }
  async function billExportInvoices() {
    const inv = billState.invoice;
    if (inv.running || inv.merging) return;
    if (!inv.records.length) { billToast('没有可导出的发票记录', 'warn'); return; }
    const blob = await billRecordsToXlsx(inv.records);
    triggerDownload(blob, '发票信息.xlsx');
    billToast(`已导出 ${inv.records.length} 个文件记录`, 'success');
  }
  function billShowInvoiceDetail(index) {
    const rec = billState.invoice.records[index];
    if (!rec) return;
    let html = `<div class="bill-detail-meta"><span>状态：<strong>${escapeHtml(rec.status)}</strong></span>
      <span>类型：<strong>${escapeHtml(rec.invoice_type || '-')}</strong></span>
      <span>发票号码：<strong>${escapeHtml(rec.invoice_number || '-')}</strong></span>
      <span>金额：<strong>¥${billFormatAmount(rec.amount)}</strong></span>
      <span>页数：<strong>${rec.page_count || '-'}</strong></span></div>`;
    if (rec.error) html += `<p class="bill-result-error">${escapeHtml(rec.error)}</p>`;
    const invoices = rec.invoices || [];
    if (!invoices.length) {
      const rows = billRecordItems(rec).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('');
      html += `<h4 class="bill-detail-section-title">本地解析字段</h4><table class="bill-detail-table"><tbody>${rows || '<tr><td>提示</td><td>暂无解析结果</td></tr>'}</tbody></table>`;
    } else {
      invoices.forEach((invoice, i) => {
        const page = invoice.page ? `（第 ${escapeHtml(String(invoice.page))} 页）` : '';
        const rows = (invoice.items || []).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('');
        html += `<h4 class="bill-detail-section-title">发票 ${i + 1} · ${escapeHtml(invoice.type || '未知类型')}${page}</h4>
          <table class="bill-detail-table"><tbody>${rows || '<tr><td>提示</td><td>没有可显示的字段</td></tr>'}</tbody></table>`;
      });
    }
    billQ('detail-title').textContent = `识别详情 · ${rec.file_name}`;
    billQ('detail-body').innerHTML = html;
    billModalReturnFocus = document.activeElement;
    billQ('modal-detail').hidden = false;
    billSetModalBackgroundInert(true);
    const close = billQ('detail-close');
    if (close) close.focus();
  }

  /* ----------------------------------------------------------------- 弹窗 */
  function billSetModalBackgroundInert(active) {
    const nodes = [document.querySelector('.bill-sidebar'), document.querySelector('.bill-main')].filter(Boolean);
    nodes.forEach(node => { node.inert = !!active; });
  }

  function billCloseDetail() {
    billQ('modal-detail').hidden = true;
    if (billQ('modal-confirm').hidden) billSetModalBackgroundInert(false);
    if (billModalReturnFocus && billModalReturnFocus.isConnected) {
      try { billModalReturnFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    billModalReturnFocus = null;
  }

  function billConfirmAction(title, message) {
    return new Promise(resolve => {
      billConfirmResolver = resolve;
      billQ('confirm-title').textContent = title;
      billQ('confirm-message').textContent = message;
      billModalReturnFocus = document.activeElement;
      billQ('modal-confirm').hidden = false;
      billSetModalBackgroundInert(true);
      const cancel = billQ('confirm-cancel');
      if (cancel) cancel.focus();
    });
  }
  function billResolveConfirm(value) {
    billQ('modal-confirm').hidden = true;
    if (billQ('modal-detail').hidden) billSetModalBackgroundInert(false);
    if (billModalReturnFocus && billModalReturnFocus.isConnected) {
      try { billModalReturnFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    billModalReturnFocus = null;
    if (billConfirmResolver) { const resolve = billConfirmResolver; billConfirmResolver = null; resolve(value); }
  }

  /* -------------------------------------------------------------- 事件绑定 */
  function billBindAll() {
    if (billBound) return;
    billBound = true;
    billView.querySelectorAll('.bill-nav-item').forEach(btn => {
      btn.addEventListener('click', () => billShowPage(btn.dataset.billPage));
    });
    // 系统设置已统一收敛到侧栏，顶部不再保留重复入口
    const topSettings = billQ('top-settings');
    if (topSettings) topSettings.addEventListener('click', () => billShowPage('settings'));
    billQ('config-chip').addEventListener('click', () => billShowPage('settings'));
    billQ('back-btn').addEventListener('click', () => {
      if (billAnyBusy()) {
        billToast('任务处理中，请先停止或等待完成。', 'warn');
        return;
      }
      showHome(true);
    });
    billQ('save-config').addEventListener('click', billSaveConfig);
    billQ('clear-config').addEventListener('click', billClearConfig);
    billQ('toggle-secret').addEventListener('click', () => {
      const input = billQ('secret-key');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      const button = billQ('toggle-secret');
      button.textContent = show ? '隐藏' : '显示';
      button.setAttribute('aria-pressed', String(show));
    });
    ['ocr-json', 'bank-ocr-json', 'acceptance-ocr-json'].forEach(id => {
      const input = billQ(id);
      if (!input) return;
      input.addEventListener('input', () => {
        billUpdateOcrSourceHints();
        billUpdateInvoiceControls();
      });
    });

    for (const mode of ['bank_slip', 'acceptance']) {
      const prefix = billPrefixOf(mode);
      const zone = billQ(prefix + '-dropzone');
      const input = billQ(prefix + '-file-input');
      zone.addEventListener('click', () => { if (!billState.bills[mode].running) input.click(); });
      zone.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zone.click(); }
      });
      input.addEventListener('change', () => { billSetBillFiles(mode, input.files); input.value = ''; });
      ['dragover', 'drop'].forEach(evt => zone.addEventListener(evt, e => {
        e.preventDefault();
        if (evt === 'drop' && e.dataTransfer) billSetBillFiles(mode, e.dataTransfer.files);
      }));
      billQ(prefix + '-recognize').addEventListener('click', () => billStartRecognition(mode));
      billQ(prefix + '-stop').addEventListener('click', () => billStopRecognition(mode));
      billQ(prefix + '-export').addEventListener('click', () => billExportBills(mode));
      billQ(prefix + '-clear').addEventListener('click', () => billClearBills(mode));
      billQ(prefix + '-file-list').addEventListener('click', e => {
        const btn = e.target.closest('[data-remove]');
        if (!btn || billState.bills[mode].running) return;
        billState.bills[mode].files.splice(Number(btn.dataset.remove), 1);
        billState.bills[mode].results = [];
        billState.bills[mode].filter = 'all';
        billRenderBillFiles(mode);
        billRenderBillResults(mode);
        billUpdateBillSummary(mode);
        billSetProgress(prefix, 0);
        billSetStatus(prefix, billState.bills[mode].files.length
          ? `已选择 ${billState.bills[mode].files.length} 个文件`
          : '请选择票据文件');
      });
      billQ(prefix + '-filters').addEventListener('click', e => {
        const button = e.target.closest('[data-bill-filter]');
        if (!button) return;
        billState.bills[mode].filter = button.dataset.billFilter;
        billRenderBillResults(mode);
      });
      billQ(prefix + '-results').addEventListener('click', e => {
        const btn = e.target.closest('[data-details]');
        if (!btn) return;
        const panel = btn.closest('.bill-result-card').querySelector('.bill-result-details');
        if (!panel) return;
        const open = panel.classList.toggle('open');
        btn.textContent = open ? '收起详情' : '查看详情';
        btn.setAttribute('aria-expanded', String(open));
      });
    }

    const inv = billState.invoice;
    billQ('invoice-pick-folder').addEventListener('click', () => billQ('invoice-folder-input').click());
    billQ('invoice-pick-files').addEventListener('click', () => billQ('invoice-files-input').click());
    billQ('invoice-folder-input').addEventListener('change', e => {
      const files = Array.from(e.target.files || []);
      const folder = files.length && files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : '所选文件夹';
      billSetInvoiceFiles(files, folder);
      e.target.value = '';
    });
    billQ('invoice-files-input').addEventListener('change', e => {
      billSetInvoiceFiles(e.target.files, '所选文件');
      e.target.value = '';
    });
    billQ('invoice-include-sub').addEventListener('change', e => {
      inv.includeSub = e.target.checked;
      if (inv.running || inv.merging) return;
      if (!inv.sourceFiles.length) return;
      billSetInvoiceFiles(inv.sourceFiles, inv.folder);
      billToast(e.target.checked ? '已包含子文件夹中的发票' : '已只保留当前文件夹中的发票', 'info');
    });
    billQ('invoice-rescan').addEventListener('click', () => {
      if (inv.running || inv.merging) return;
      if (!inv.sourceFiles.length) { billQ('invoice-pick-folder').click(); return; }
      billSetInvoiceFiles(inv.sourceFiles, inv.folder);
      billToast('已重新扫描', 'info');
    });
    billQ('invoice-local-parse').addEventListener('click', () => billStartInvoiceParse(false));
    billQ('invoice-recognize').addEventListener('click', () => billStartInvoiceParse(true));
    billQ('invoice-stop').addEventListener('click', billStopInvoiceParse);
    billQ('invoice-merge').addEventListener('click', billMergeInvoices);
    billQ('invoice-export').addEventListener('click', billExportInvoices);
    billQ('invoice-clear-cache').addEventListener('click', billClearInvoiceCache);
    billQ('invoice-rename').addEventListener('click', billRenameInvoices);
    billQ('invoice-sort-mode').addEventListener('change', () => { billOnSortModeChange(); billScheduleAutoSort(0); });
    billQ('invoice-custom-order').addEventListener('input', () => billScheduleAutoSort(500));
    billQ('invoice-custom-order').addEventListener('change', () => billScheduleAutoSort(0));
    billQ('invoice-import-order').addEventListener('click', () => billQ('invoice-order-input').click());
    billQ('invoice-order-input').addEventListener('change', e => {
      billAppImportOrder(e.target.files && e.target.files[0]);
      e.target.value = '';
    });
    billQ('invoice-order-column').addEventListener('change', billOnOrderColumnChange);
    billQ('invoice-filter').addEventListener('input', e => {
      inv.filterText = e.target.value;
      billRenderInvoiceTable();
    });
    billQ('invoice-status-filter').addEventListener('change', e => {
      inv.filterStatus = e.target.value;
      billRenderInvoiceTable();
    });
    const openInvoiceDetail = e => {
      const button = e.target.closest('[data-detail]');
      if (!button) return;
      billShowInvoiceDetail(Number(button.dataset.detail));
    };
    billQ('invoice-table-body').addEventListener('click', openInvoiceDetail);
    billQ('invoice-mobile-list').addEventListener('click', openInvoiceDetail);
    const outputPanel = billQ('invoice-output-panel');
    if (outputPanel) {
      outputPanel.addEventListener('toggle', () => {
        const label = outputPanel.querySelector('.bill-output-toggle');
        if (label) label.textContent = outputPanel.open ? '收起设置' : '展开设置';
      });
    }
    billQ('invoice-reset-template').addEventListener('click', billResetTemplate);
    billQ('invoice-sort-notice-detail').addEventListener('click', billShowSortNoticeDetail);
    ['invoice-prefix', 'invoice-start', 'invoice-digits', 'invoice-name-template'].forEach(id => {
      const el = billQ(id);
      el.addEventListener('input', billScheduleInvoicePreview);
      el.addEventListener('change', billScheduleInvoicePreview);
    });
    billQ('invoice-name-template').addEventListener('input', billRenderTemplateFields);
    billQ('invoice-template-fields').addEventListener('click', e => {
      if (billTemplateDragActive) return;
      const move = e.target.closest('.bill-chip-move[data-move]');
      if (move) {
        e.preventDefault();
        e.stopPropagation();
        const from = Number(move.dataset.index);
        billReorderTemplateField(from, from + Number(move.dataset.move));
        return;
      }
      const remove = e.target.closest('[data-remove]');
      if (remove) { e.preventDefault(); billRemoveTemplateFieldAt(Number(remove.dataset.remove)); return; }
      const selected = e.target.closest('.bill-selected-chip');
      if (selected) { billToggleTemplateField(selected.dataset.token); return; }
      const chip = e.target.closest('.bill-template-chip[data-field]');
      if (chip) billToggleTemplateField(chip.dataset.field);
    });
    const chips = billQ('invoice-template-fields');
    chips.addEventListener('dragstart', e => {
      const chip = e.target.closest('.bill-selected-chip');
      if (!chip || inv.running) { e.preventDefault(); return; }
      billTemplateDragActive = true;
      billTemplateDragIndex = Number(chip.dataset.index);
      chip.classList.add('dragging');
      if (e.dataTransfer) e.dataTransfer.setData('text/plain', String(billTemplateDragIndex));
    });
    chips.addEventListener('dragover', e => {
      const chip = e.target.closest('.bill-selected-chip');
      if (!chip || billTemplateDragIndex < 0) return;
      e.preventDefault();
      chips.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
      chip.classList.add('drag-over');
    });
    chips.addEventListener('drop', e => {
      const chip = e.target.closest('.bill-selected-chip');
      if (!chip || billTemplateDragIndex < 0) return;
      e.preventDefault();
      billReorderTemplateField(billTemplateDragIndex, Number(chip.dataset.index));
      billTemplateDragIndex = -1;
      setTimeout(() => { billTemplateDragActive = false; }, 0);
    });
    chips.addEventListener('dragend', () => {
      billTemplateDragIndex = -1;
      chips.querySelectorAll('.dragging, .drag-over').forEach(x => x.classList.remove('dragging', 'drag-over'));
      setTimeout(() => { billTemplateDragActive = false; }, 0);
    });
    billQ('confirm-ok').addEventListener('click', () => billResolveConfirm(true));
    billQ('confirm-cancel').addEventListener('click', () => billResolveConfirm(false));
    billView.querySelectorAll('[data-bill-confirm-close]').forEach(el => el.addEventListener('click', () => billResolveConfirm(false)));
    billQ('detail-close').addEventListener('click', billCloseDetail);
    billView.querySelectorAll('[data-bill-detail-close]').forEach(el => el.addEventListener('click', billCloseDetail));
    document.addEventListener('keydown', e => {
      if (!document.body.classList.contains('bill-app-active')) return;
      const confirm = billQ('modal-confirm');
      const detail = billQ('modal-detail');
      if (confirm.hidden && detail.hidden) return;
      if (e.key === 'Tab') {
        trapModalFocus(e, confirm.hidden ? detail : confirm);
        return;
      }
      if (e.key !== 'Escape') return;
      if (!confirm.hidden) billResolveConfirm(false);
      if (!detail.hidden) billCloseDetail();
    });
  }

  const billApp = {
    state: billState,
    open(page) {
      billBindAll();
      billView.hidden = false;
      // 上次离开时若残留弹窗 inert，触摸事件会被整体屏蔽，进入时兜底解锁
      billSetModalBackgroundInert(false);
      document.body.classList.add('bill-app-active');
      billShowPage(page || 'bank', { fromRoute: true });
      billRenderBillFiles('bank_slip');
      billRenderBillResults('bank_slip');
      billUpdateBillSummary('bank_slip');
      billRenderBillFiles('acceptance');
      billRenderBillResults('acceptance');
      billUpdateBillSummary('acceptance');
      billRenderTemplateFields();
      billRenderInvoiceTable();
      billUpdateInvoiceSummary();
      billUpdateInvoiceControls();
      billOnSortModeChange();
      billUpdateNamePreview();
      billLoadConfig();
      billUpdateOcrSourceHints();
      window.scrollTo(0, 0);
    },
    close() {
      if (billConfirmResolver) billResolveConfirm(false);
      if (!billQ('modal-detail').hidden) billCloseDetail();
      billSetModalBackgroundInert(false);
      billView.hidden = true;
      document.body.classList.remove('bill-app-active');
    },
    showPage: billShowPage,
    setBillFiles: billSetBillFiles,
    scanFiles: billSetInvoiceFiles,
    parseLocal: () => billStartInvoiceParse(false),
    parseCloud: () => billStartInvoiceParse(true),
    recognizeBills: billStartRecognition,
    sort: () => billApplyInvoiceSort(false),
    rename: billRenameInvoices,
    merge: billMergeInvoices,
    exportInvoices: billExportInvoices,
    exportBills: billExportBills,
    importOrder: billAppImportOrder,
    refreshPreview: billRefreshPreview,
    showDetail: billShowInvoiceDetail,
    confirm: billConfirmAction,
  };
  window.addEventListener('billapp:open', event => {
    const page = event && event.detail && event.detail.page;
    billApp.open(page);
  });
  window.addEventListener('billapp:close', () => billApp.close());
  /* ============================================================
     12. 初始化
     ============================================================ */
  renderGrid();
  renderQuickSections();
  updateFileViewButtons();
  const shortcutHint = document.querySelector('.search-shortcut');
  if (shortcutHint && /Mac|iPhone|iPad/i.test(navigator.platform || '')) {
    shortcutHint.textContent = '⌘ K';
  }
  if (location.hash && location.hash !== '#/home') {
    restoreRoute();
  } else if (location.hash === '#/home') {
    syncRoute('#/home', true);
  }

  /* 测试钩子：仅当宿主页面显式开启时挂载。
     生产页 index.html 与离线单文件版都不会设置该标志，
     因此内部实现不会泄漏到全局作用域；自检页由构建器统一注入开关，
     与生产代码共用同一份 app.js，不再维护副本。 */
  if (window.__ENABLE_TEST_HOOKS__ === true) {
    window.__test = {
      TOOLS, ORDERED_TOOLS, parsePageRanges, parseRangeGroups, bookletOrder,
      diffLines, formatBytes, sanitizeFileName, escapeHtml, state,
      md5Bytes, sha256Bytes, sha512Bytes, rc4Bytes, aesCbcEncrypt,
      bytesToHex, utf8ToBytes, reportError, cancelCurrentTask, CONFIG,
      buildXlsxBlob, billGridSheet, BILL_SORT_MODES, BILL_TEMPLATE_FIELDS,
      billEmptyRecord, billBuildRecord, billBuildRecords, billParseQrText,
      billCrc16, billVerifyQrCrc, billDetectQrKind,
      billExtractFilenameNumber, billNormalizeNumber, billNormalizeDate,
      billParseCustomOrder, billCleanAmount, billCnAmountToFloat,
      billParsePdfInvoiceText, billParseBillResult, billApplyInvoiceResponse,
      billSortRecords, billSortStats, billRenderNameTemplate, billBuildRenamePlan,
      billPreferredLength, billReadOrderSheets, billScanOrderCandidates,
      billReadOrderNumbers, billImportOrder, billRecordsToXlsx, billResultsToXlsx,
      billCacheClear, billCacheStats, billDecodeQrFromCanvas,
      billMergeRecordsToPdf, billRenamedZip, billApp,
    };
  }
})();
