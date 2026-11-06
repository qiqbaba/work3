    {
      id: 'pdf-longpage', name: '合并为单长页', cat: 'pdf', icon: 'scroll', minFiles: 1, accept: '.pdf', single: true,
      desc: '将所有页面纵向拼成一张长页。',
      keywords: '长页 长图 单页 continuous 联页 纵向拼接',
      options: [{ key: 'gap', type: 'number', label: '页间距 (pt)', def: 0, min: 0, max: 100 }],
      async run(ctx) {
        const out = [];
        const gap = Math.max(0, parseFloat(ctx.get('gap')) || 0);
        for (const file of ctx.files) {
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const sizes = [];
          for (let i = 0; i < total; i++) sizes.push(src.getPage(i).getSize());
          const width = Math.max(...sizes.map(s => s.width));
          const height = sizes.reduce((a, s) => a + s.height, 0) + gap * Math.max(0, total - 1);
          const doc = await PDFLib.PDFDocument.create();
          const page = doc.addPage([width, height]);
          let y = height;
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在拼接第 ${i + 1}/${total} 页…`);
            const [sp] = await doc.copyPages(src, [i]);
            const ep = await doc.embedPage(sp);
            const s = sizes[i];
            y -= s.height;
            page.drawPage(ep, { x: (width - s.width) / 2, y, width: s.width, height: s.height });
            y -= gap;
          }
          out.push({ name: `${baseName(file.name)}_单长页.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: `${Math.round(width)} × ${Math.round(height)} pt` });
        }
        return out;
      }
    },
