    {
      id: 'pdf-merge', name: 'PDF 合并', cat: 'pdf', icon: 'merge', minFiles: 2, accept: '.pdf',
      desc: '将多个 PDF 文件按顺序合并为一个文档，可拖拽排序。',
      keywords: '合并 merge 拼接 组合',
      options: [],
      async run(ctx) {
        const out = await PDFLib.PDFDocument.create();
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在合并第 ${i + 1}/${ctx.files.length} 个文件…`);
          const src = await loadPdfDoc(ctx.files[i]);
          if (i === 0) copyDocumentMetadata(out, src);
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach(p => out.addPage(p));
        }
        const bytes = await out.save();
        return [{ name: 'PDF合并结果.pdf', blob: bytesToBlob(bytes, 'application/pdf') }];
      }
    },
