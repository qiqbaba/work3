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
    // 缺 size / NaN / 负数时不能让 Math.log 产生 "NaN undefined" 显示在界面上。
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // CSV 网格解析：引号字段内允许出现分隔符和换行（Excel 导出的备注、地址常见）。
  // 若先按换行 split 再逐行解析，一条逻辑记录会被拆成多行，导致列数错乱。
  function parseCsvGrid(text, separators) {
    const seps = separators || ',';
    const s = String(text == null ? '' : text).replace(/^\ufeff/, '');
    const rows = [];
    let row = [], cur = '', inQ = false;
    const endRow = () => { row.push(cur); rows.push(row); row = []; cur = ''; };
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQ) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (seps.indexOf(ch) >= 0) { row.push(cur); cur = ''; }
      else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        endRow();
      } else cur += ch;
    }
    if (row.length || cur !== '') endRow();
    return rows;
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
        // 范围形式必须与单页形式一样拒绝越界 / 非法输入；此前 clamp 会静默处理
        // 错误的页面（如 5 页文档输入 "99-100" 会得到第 5 页，"-" 会得到全部页）。
        const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
        const from = m ? Number(m[1]) : NaN;
        const to = m ? Number(m[2]) : NaN;
        if (!m || from < 1 || to > maxPages || from > to) {
          throw new Error(`页面范围无效：${part}（文档共 ${maxPages} 页）`);
        }
        for (let i = from; i <= to; i++) pages.add(i);
      } else {
        // 单页形式也要拒绝非法 / 越界页码：旧实现用 parseInt 静默丢弃，
        // "1,99" 会只处理第 1 页而不提示，"2abc" 会被当成第 2 页。
        const m = part.match(/^(\d+)$/);
        const n = m ? Number(m[1]) : NaN;
        if (!m || n < 1 || n > maxPages) {
          throw new Error(`页面范围无效：${part}（文档共 ${maxPages} 页）`);
        }
        pages.add(n);
      }
    }
    const sorted = Array.from(pages).sort((a, b) => a - b);
    if (!sorted.length) throw new Error(`页面范围无效：${rangeStr}（文档共 ${maxPages} 页）`);
    return sorted;
  }

  // 多组范围解析："1-3; 4-6; 7" -> [[1,2,3],[4,5,6],[7]]
  function parseRangeGroups(rangeStr, maxPages) {
    return String(rangeStr == null ? '' : rangeStr).split(/[;；]/)
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

