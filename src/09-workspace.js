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
        // 输入集合变化后旧结果已失效，必须与「添加文件 / 全部移除」一样清空，
        // 否则仍能下载或打包与当前输入不符的产物。
        let changed = false;
        if (a === 'rm') { releasePreview(f); state.files.splice(idx, 1); changed = true; }
        else if (a === 'up' && idx > 0) { [state.files[idx - 1], state.files[idx]] = [state.files[idx], state.files[idx - 1]]; changed = true; }
        else if (a === 'down' && idx < state.files.length - 1) { [state.files[idx + 1], state.files[idx]] = [state.files[idx], state.files[idx + 1]]; changed = true; }
        renderFileList();
        if (changed) clearResults();
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

