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
      const number = count > 1 && rec.invoice_number ? `${rec.invoice_number} 等${count}张` : (rec.invoice_number || '—');
      return `<tr data-index="${i}" title="${escapeHtml(note)}">
        <td>${i + 1}</td>
        <td class="bill-ellipsis" title="${escapeHtml(rec.file_name)}">${escapeHtml(rec.file_name)}</td>
        <td class="bill-ellipsis bill-preview" title="${escapeHtml(preview)}">${escapeHtml(preview)}</td>
        <td class="bill-mono">${escapeHtml(number)}</td>
        <td>${escapeHtml(rec.invoice_date || '—')}</td>
        <td class="bill-num">${showAmount ? '¥' + billFormatAmount(rec.amount) : '—'}</td>
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
        // OCR 列表按「本次待识别文件」顺序对应；records 下标会因排序/过滤变化，
        // 用 i 取会错配，或让只覆盖部分文件的 OCR 结果全部落空。
        ocrData: cloud ? ocrList[cursor] : null,
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
      <span>开票日期：<strong>${escapeHtml(rec.invoice_date || '-')}</strong></span>
      <span>金额：<strong>¥${billFormatAmount(rec.amount)}</strong></span>
      <span>购买方：<strong>${escapeHtml(rec.buyer || '-')}</strong></span>
      <span>销售方：<strong>${escapeHtml(rec.seller || '-')}</strong></span>
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
