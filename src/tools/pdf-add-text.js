    {
      id: 'pdf-add-text', name: '添加文字', cat: 'pdf', icon: 'pen', minFiles: 1, accept: '.pdf',
      desc: '在页面任意位置添加文字。',
      keywords: '添加文字 文字 addtext 盖字 标注文字',
      options: [
        { key: 'text', type: 'text', label: '文字内容', def: '内部资料', placeholder: '输入要添加的文字' },
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
        { key: 'x', type: 'number', label: '水平位置 (%)（左0 右100）', def: 50, min: 0, max: 100 },
        { key: 'y', type: 'number', label: '垂直位置 (%)（下0 上100）', def: 50, min: 0, max: 100 },
        { key: 'fontPx', type: 'number', label: '字号 (px)', def: 36, min: 10, max: 200 },
        { key: 'angle', type: 'number', label: '旋转角度', def: 0, min: -90, max: 90 },
        { key: 'opacity', type: 'number', label: '透明度 (0.05-1)', def: 1, min: 0.05, max: 1, step: 0.05 },
        { key: 'color', type: 'color', label: '文字颜色', def: '#d92020' },
      ],
      async run(ctx) {
        const text = (ctx.get('text') || '').trim();
        if (!text) throw new Error('请输入文字内容');
        const fontPx = parseInt(ctx.get('fontPx'), 10) || 36;
        const angle = parseFloat(ctx.get('angle')) || 0;
        const opacity = Math.min(1, Math.max(0.05, parseFloat(ctx.get('opacity')) || 1));
        const xRaw = parseFloat(ctx.get('x')), yRaw = parseFloat(ctx.get('y'));
        const xPct = Math.min(100, Math.max(0, Number.isFinite(xRaw) ? xRaw : 50));
        const yPct = Math.min(100, Math.max(0, Number.isFinite(yRaw) ? yRaw : 50));
        const cv = makeTextImage(text, { fontPx, angle, color: ctx.get('color') || '#d92020' });
        const png = await canvasToBlob(cv, 'image/png');
        const bytes = await png.arrayBuffer();
        const out = [];
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          const pages = parsePageRanges(ctx.get('range'), total);
          const img = await doc.embedPng(bytes);
          const scale = 0.75;
          const w = cv.width * scale, h = cv.height * scale;
          for (let k = 0; k < pages.length; k++) {
            ctx.progress(k, pages.length, `正在添加文字 ${k + 1}/${pages.length}…`);
            const page = doc.getPage(pages[k] - 1);
            const { width, height } = page.getSize();
            // 选项约定为「下 0 上 100」，而 PDF 原点就在左下，故 y 直接按百分比取值。
            page.drawImage(img, {
              x: width * xPct / 100 - w / 2,
              y: height * yPct / 100 - h / 2,
              width: w, height: h, opacity,
            });
          }
          out.push({ name: `${baseName(file.name)}_加字.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
