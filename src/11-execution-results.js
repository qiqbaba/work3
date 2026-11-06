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

