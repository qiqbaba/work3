    {
      id: 'pdf-crop', name: '页面裁剪', cat: 'pdf', icon: 'crop', minFiles: 1, accept: '.pdf',
      desc: '按统一边距裁剪页面可视区域，去除白边或页眉页脚。',
      keywords: '裁剪 crop 去白边 页边距 trim',
      options: [
        { key: 'mode', type: 'select', label: '边距单位', def: 'pt', choices: [['pt', '绝对值 (pt)'], ['pct', '百分比 (%)']] },
        { key: 'top', type: 'number', label: '上边距', def: 20, min: 0 },
        { key: 'right', type: 'number', label: '右边距', def: 20, min: 0 },
        { key: 'bottom', type: 'number', label: '下边距', def: 20, min: 0 },
        { key: 'left', type: 'number', label: '左边距', def: 20, min: 0 },
      ],
      async run(ctx) {
        const out = [];
        const pct = ctx.get('mode') === 'pct';
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在裁剪第 ${i + 1}/${total} 页…`);
            const page = doc.getPage(i);
            const { width, height } = page.getSize();
            const t = (parseFloat(ctx.get('top')) || 0) * (pct ? height / 100 : 1);
            const r = (parseFloat(ctx.get('right')) || 0) * (pct ? width / 100 : 1);
            const b = (parseFloat(ctx.get('bottom')) || 0) * (pct ? height / 100 : 1);
            const l = (parseFloat(ctx.get('left')) || 0) * (pct ? width / 100 : 1);
            const w = width - l - r, h = height - t - b;
            if (w <= 10 || h <= 10) throw new Error(`第 ${i + 1} 页裁剪后尺寸过小，请检查边距`);
            page.setMediaBox(l, b, w, h);
            page.setCropBox(l, b, w, h);
          }
          out.push({ name: `${baseName(file.name)}_裁剪.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
