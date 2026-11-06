    {
      id: 'pdf-pages', name: '页面提取 / 删除', cat: 'pdf', icon: 'pages', minFiles: 1, accept: '.pdf',
      desc: '按页面范围提取指定页面，或删除指定页面生成新 PDF。',
      keywords: '页面 提取 删除 抽取 裁页',
      options: [
        { key: 'mode', type: 'select', label: '操作方式', def: 'extract', choices: [['extract', '提取选中页面'], ['delete', '删除选中页面']] },
        { key: 'range', type: 'text', label: '页面范围', def: '1-3', placeholder: '如：1-3, 5, 8' },
      ],
      async run(ctx) {
        const out = [];
        const mode = ctx.get('mode');
        for (let fi = 0; fi < ctx.files.length; fi++) {
          const file = ctx.files[fi];
          ctx.progress(fi, ctx.files.length, `正在处理 ${file.name}…`);
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const selected = parsePageRanges(ctx.get('range'), total);
          const indices = (mode === 'extract')
            ? selected.map(p => p - 1)
            : Array.from({ length: total }, (_, i) => i).filter(i => !selected.includes(i + 1));
          if (!indices.length) throw new Error(`结果为空，请检查页面范围（共 ${total} 页）`);
          const doc = await PDFLib.PDFDocument.create();
          const pages = await doc.copyPages(src, indices);
          pages.forEach(p => doc.addPage(p));
          const suffix = mode === 'extract' ? '提取' : '删除后';
          out.push({ name: `${baseName(file.name)}_${suffix}.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
