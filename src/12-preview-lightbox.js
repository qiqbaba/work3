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

