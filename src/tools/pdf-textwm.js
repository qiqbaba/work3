    {
      id: 'pdf-textwm', name: '文字水印', cat: 'pdf', icon: 'droplet', minFiles: 1, accept: '.pdf',
      desc: '为 PDF 添加文字水印，支持平铺或居中、角度与透明度。',
      keywords: '水印 watermark 文字 标记',
      options: [
        { key: 'text', type: 'text', label: '水印文字', def: '内部资料', placeholder: '输入水印内容' },
        { key: 'mode', type: 'select', label: '排列方式', def: 'tile', choices: [['tile', '斜向平铺'], ['center', '页面居中']] },
        { key: 'angle', type: 'number', label: '倾斜角度', def: 30, min: -90, max: 90 },
        { key: 'fontPx', type: 'number', label: '字号 (px)', def: 48, min: 12, max: 200 },
        { key: 'opacity', type: 'number', label: '透明度 (0.05-1)', def: 0.15, min: 0.05, max: 1, step: 0.05 },
        { key: 'color', type: 'color', label: '水印颜色', def: '#888888' },
      ],
      async run(ctx) {
        const out = [];
        const text = ctx.get('text');
        if (!text || !text.trim()) throw new Error('请输入水印文字');
        const fontPx = parseInt(ctx.get('fontPx'), 10) || 48;
        const angle = parseFloat(ctx.get('angle')) || 0;
        const opacity = Math.min(1, Math.max(0.05, parseFloat(ctx.get('opacity')) || 0.15));
        const color = ctx.get('color') || '#888888';
        const cv = makeTextImage(text, { fontPx, angle, color });
        const png = await canvasToBlob(cv, 'image/png');
        const bytes = await png.arrayBuffer();
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          const img = await doc.embedPng(bytes);
          const scale = 0.75;
          const w = cv.width * scale, h = cv.height * scale;
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在添加水印 ${i + 1}/${total}…`);
            const page = doc.getPage(i);
            const { width, height } = page.getSize();
            if (ctx.get('mode') === 'center') {
              page.drawImage(img, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h, opacity });
            } else {
              const stepX = w * 1.6, stepY = h * 2.2;
              for (let y = -h; y < height + h; y += stepY) {
                for (let x = -w; x < width + w; x += stepX) {
                  page.drawImage(img, { x, y, width: w, height: h, opacity });
                }
              }
            }
          }
          out.push({ name: `${baseName(file.name)}_水印版.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
