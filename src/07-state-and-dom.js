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

