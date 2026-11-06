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

