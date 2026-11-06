    {
      id: 'pdf-longimg', name: 'PDF 转长图', cat: 'pdf', icon: 'scroll', minFiles: 1, accept: '.pdf',
      desc: '将 PDF 多页拼成一张长图。',
      keywords: '长图 拼接 长图导出 合成长图 longimage 转长图',
      options: [
        { key: 'format', type: 'select', label: '输出格式', def: 'jpeg', choices: [['jpeg', 'JPG（体积小）'], ['png', 'PNG（无损）']] },
        { key: 'dpi', type: 'select', label: '渲染分辨率', def: '150', choices: [['72', '72 DPI'], ['150', '150 DPI（推荐）'], ['300', '300 DPI']] },
        { key: 'quality', type: 'number', label: 'JPG 质量 (1-100)', def: 90, min: 10, max: 100 },
        { key: 'direction', type: 'select', label: '拼接方向', def: 'vertical', choices: [['vertical', '纵向拼接'], ['horizontal', '横向拼接']] },
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
      ],
      async run(ctx) {
        const out = [];
        const scale = (parseInt(ctx.get('dpi'), 10) || 150) / 72;
        const format = ctx.get('format') === 'png' ? 'image/png' : 'image/jpeg';
        const quality = (parseInt(ctx.get('quality'), 10) || 90) / 100;
        const vertical = ctx.get('direction') !== 'horizontal';
        for (let fi = 0; fi < ctx.files.length; fi++) {
          const file = ctx.files[fi];
          const src = await loadPdfjsDoc(file);
          const pages = parsePageRanges(ctx.get('range'), src.numPages);
          const canvases = [];
          for (let k = 0; k < pages.length; k++) {
            ctx.progress(fi + (k / pages.length) * 0.8, ctx.files.length, `正在渲染 ${file.name} 第 ${pages[k]} 页…`);
            canvases.push(await renderPageToCanvas(src, pages[k], scale, false));
          }
          const LIMIT = 28000;
          const W = vertical ? Math.max.apply(null, canvases.map(c => c.width)) : canvases.reduce((s, c) => s + c.width, 0);
          const H = vertical ? canvases.reduce((s, c) => s + c.height, 0) : Math.max.apply(null, canvases.map(c => c.height));
          const shrink = Math.min(1, LIMIT / W, LIMIT / H);
          const big = document.createElement('canvas');
          big.width = Math.max(1, Math.round(W * shrink));
          big.height = Math.max(1, Math.round(H * shrink));
          const c = big.getContext('2d');
          c.fillStyle = '#ffffff';
          c.fillRect(0, 0, big.width, big.height);
          let x = 0, y = 0;
          for (const cv of canvases) {
            const dw = cv.width * shrink, dh = cv.height * shrink;
            if (vertical) {
              c.drawImage(cv, 0, y, dw, dh);
              y += dh;
            } else {
              c.drawImage(cv, x, 0, dw, dh);
              x += dw;
            }
          }
          ctx.progress(fi + 0.9, ctx.files.length, `正在编码 ${file.name}…`);
          const blob = await canvasToBlob(big, format, quality);
          out.push({
            name: `${baseName(file.name)}_长图.${format === 'image/png' ? 'png' : 'jpg'}`,
            blob,
            meta: `${big.width} × ${big.height} px` + (shrink < 1 ? '（超限自动缩放）' : '')
          });
        }
        return out;
      }
    },
