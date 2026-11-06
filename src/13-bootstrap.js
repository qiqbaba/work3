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
