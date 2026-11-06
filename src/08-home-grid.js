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

