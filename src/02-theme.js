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
