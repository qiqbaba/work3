    {
      id: 'pdf-pagenum', name: '添加页码', cat: 'pdf', icon: 'hash', minFiles: 1, accept: '.pdf',
      desc: '为 PDF 页面添加页码，支持位置、起始编号与自定义格式。',
      keywords: '页码 编号 pagenumber 打码',
      options: [
        { key: 'position', type: 'select', label: '页码位置', def: 'bottom-center', choices: [['bottom-center', '底部居中'], ['bottom-right', '底部右侧'], ['bottom-left', '底部左侧'], ['top-center', '顶部居中'], ['top-right', '顶部右侧']] },
        { key: 'template', type: 'text', label: '页码格式', def: '第 {n} 页 / 共 {total} 页', placeholder: '{n}=当前页 {total}=总页数' },
        { key: 'start', type: 'number', label: '起始页码', def: 1, min: 0 },
        { key: 'fontPx', type: 'number', label: '字号 (px)', def: 28, min: 10, max: 120 },
        { key: 'color', type: 'color', label: '文字颜色', def: '#333333' },
      ],
      async run(ctx) {
        const out = [];
        const tpl = ctx.get('template') || '{n}';
        const startRaw = parseInt(ctx.get('start'), 10);
        const start = Number.isFinite(startRaw) ? Math.max(0, startRaw) : 1;
        const fontPx = parseInt(ctx.get('fontPx'), 10) || 28;
        const color = ctx.get('color') || '#333333';
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在添加页码 ${i + 1}/${total}…`);
            const page = doc.getPage(i);
            const { width, height } = page.getSize();
            const text = tpl.replace(/\{n\}/g, String(start + i)).replace(/\{total\}/g, String(total));
            const cv = makeTextImage(text, { fontPx, color, bold: false });
            const png = await canvasToBlob(cv, 'image/png');
            const img = await doc.embedPng(await png.arrayBuffer());
            const scale = 0.75; // px -> pt
            const w = cv.width * scale, h = cv.height * scale;
            const margin = 18;
            const pos = ctx.get('position') || 'bottom-center';
            let x = (width - w) / 2, y = margin;
            if (pos.endsWith('right')) x = width - w - margin;
            if (pos.endsWith('left')) x = margin;
            if (pos.startsWith('top')) y = height - h - margin;
            page.drawImage(img, { x, y, width: w, height: h, opacity: 0.9 });
          }
          out.push({ name: `${baseName(file.name)}_页码版.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
