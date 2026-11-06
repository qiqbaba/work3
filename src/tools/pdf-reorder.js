    {
      id: 'pdf-reorder', name: '页面重排', cat: 'pdf', icon: 'layers', minFiles: 1, accept: '.pdf',
      desc: '按自定义顺序重新排列 PDF 页面，支持逆序、重复页与范围展开。',
      keywords: '重排 排序 排列 页面顺序 reorder 调整顺序',
      options: [
        { key: 'mode', type: 'select', label: '重排方式', def: 'custom', choices: [['custom', '自定义顺序'], ['reverse', '整份倒序']] },
        { key: 'order', type: 'text', label: '页面顺序', def: '', placeholder: '如：3,1,2 或 2-4,1', hint: '仅"自定义顺序"时生效；按输入顺序输出，可重复页码' },
      ],
      async run(ctx) {
        const out = [];
        const mode = ctx.get('mode');
        for (let fi = 0; fi < ctx.files.length; fi++) {
          const file = ctx.files[fi];
          ctx.progress(fi, ctx.files.length, `正在重排 ${file.name}…`);
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const order = mode === 'reverse'
            ? Array.from({ length: total }, (_, i) => total - i)
            : parseOrderList(ctx.get('order'), total);
          const doc = await PDFLib.PDFDocument.create();
          const pages = await doc.copyPages(src, order.map(p => p - 1));
          pages.forEach(p => doc.addPage(p));
          copyDocumentMetadata(doc, src);
          out.push({ name: `${baseName(file.name)}_重排.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
