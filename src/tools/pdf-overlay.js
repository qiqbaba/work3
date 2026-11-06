    {
      id: 'pdf-overlay', name: 'PDF 叠加合并', cat: 'pdf', icon: 'overlay', minFiles: 1, accept: '.pdf', single: true,
      desc: '将另一个 PDF 逐页叠加到文档上。',
      keywords: '叠加 overlay 套打 信头 底图 merge over',
      options: [
        { key: 'over', type: 'file', label: '叠加文档（PDF）', accept: '.pdf', hint: '该文档的页面将叠加到当前文档每一页之上' },
        { key: 'opacity', type: 'number', label: '叠加透明度 (0.1-1)', def: 1, min: 0.1, max: 1, step: 0.1 },
        { key: 'scale', type: 'select', label: '缩放方式', def: 'fit', choices: [['fit', '等比适配页面'], ['stretch', '拉伸填满'], ['keep', '保持原始尺寸居中']] },
      ],
      async run(ctx) {
        const overFile = ctx.get('over');
        if (!overFile) throw new Error('请先选择叠加文档');
        const opacity = Math.min(1, Math.max(0.1, parseFloat(ctx.get('opacity')) || 1));
        const mode = ctx.get('scale');
        const out = [];
        const over = await loadPdfDoc(overFile);
        const overTotal = over.getPageCount();
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在叠加第 ${i + 1}/${total} 页…`);
            const page = doc.getPage(i);
            const [sp] = await doc.copyPages(over, [Math.min(i, overTotal - 1)]);
            const ep = await doc.embedPage(sp);
            const { width, height } = page.getSize();
            const s = sp.getSize();
            if (mode === 'stretch') {
              page.drawPage(ep, { x: 0, y: 0, width, height, opacity });
            } else {
              const k = mode === 'keep'
                ? 1
                : Math.min(width / s.width, height / s.height);
              page.drawPage(ep, { x: (width - s.width * k) / 2, y: (height - s.height * k) / 2, width: s.width * k, height: s.height * k, opacity });
            }
          }
          out.push({ name: `${baseName(file.name)}_叠加.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
