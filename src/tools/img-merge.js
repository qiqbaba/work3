    {
      id: 'img-merge', name: '图片拼接', cat: 'img', icon: 'layers', minFiles: 2, accept: IMAGE_ACCEPT,
      desc: '将多张图片拼成长图或九宫格。',
      keywords: '拼接 长图 合并图片 宫格 九宫格 拼图 stitch',
      options: [
        { key: 'direction', type: 'select', label: '拼接方向', def: 'vertical', choices: [['vertical', '纵向（上下）'], ['horizontal', '横向（左右）'], ['grid', '宫格拼图']] },
        { key: 'gap', type: 'number', label: '间距 (px)', def: 0, min: 0, max: 200 },
        { key: 'bg', type: 'color', label: '背景颜色', def: '#ffffff' },
        { key: 'cols', type: 'number', label: '宫格列数', def: 2, min: 1, max: 20, hint: '仅「宫格拼图」时生效' },
        { key: 'cellFit', type: 'select', label: '单元格适配', def: 'contain', choices: [['contain', '完整显示（留白）'], ['cover', '填满裁剪']], hint: '仅「宫格拼图」时生效' },
      ],
      async run(ctx) {
        const direction = ctx.get('direction') || 'vertical';
        const vertical = direction !== 'horizontal';
        const gap = Math.max(0, parseInt(ctx.get('gap'), 10) || 0);
        const bg = ctx.get('bg') || '#ffffff';
        const canvases = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在加载 ${i + 1}/${ctx.files.length}…`);
          canvases.push(await imageFileToCanvas(ctx.files[i]));
        }
        const cv = document.createElement('canvas');
        if (direction === 'grid') {
          const cols = Math.max(1, Math.min(20, parseInt(ctx.get('cols'), 10) || 2));
          const rows = Math.ceil(canvases.length / cols);
          const cellW = Math.max(...canvases.map(c => c.width));
          const cellH = Math.max(...canvases.map(c => c.height));
          cv.width = cols * cellW + gap * (cols - 1);
          cv.height = rows * cellH + gap * (rows - 1);
          const c = cv.getContext('2d');
          c.fillStyle = bg;
          c.fillRect(0, 0, cv.width, cv.height);
          const cover = ctx.get('cellFit') === 'cover';
          canvases.forEach((item, idx) => {
            const scale = cover
              ? Math.max(cellW / item.width, cellH / item.height)
              : Math.min(cellW / item.width, cellH / item.height);
            const w = item.width * scale, h = item.height * scale;
            const left = (idx % cols) * (cellW + gap);
            const top = Math.floor(idx / cols) * (cellH + gap);
            // cover 时绘制区域大于单元格，必须裁剪，否则会溢到间距和相邻单元格上。
            c.save();
            c.beginPath();
            c.rect(left, top, cellW, cellH);
            c.clip();
            c.drawImage(item, left + (cellW - w) / 2, top + (cellH - h) / 2, w, h);
            c.restore();
          });
        } else if (vertical) {
          cv.width = Math.max(...canvases.map(c => c.width));
          cv.height = canvases.reduce((s, c) => s + c.height, 0) + gap * (canvases.length - 1);
        } else {
          cv.height = Math.max(...canvases.map(c => c.height));
          cv.width = canvases.reduce((s, c) => s + c.width, 0) + gap * (canvases.length - 1);
        }
        if (direction !== 'grid') {
          const c = cv.getContext('2d');
          c.fillStyle = bg;
          c.fillRect(0, 0, cv.width, cv.height);
          let pos = 0;
          for (const item of canvases) {
            const x = vertical ? (cv.width - item.width) / 2 : pos;
            const y = vertical ? pos : (cv.height - item.height) / 2;
            c.drawImage(item, x, y);
            pos += (vertical ? item.height : item.width) + gap;
          }
        }
        ctx.progress(1, 1, '拼接完成');
        const blob = await canvasToBlob(cv, 'image/png');
        return [{ name: '图片拼接结果.png', blob, meta: `${cv.width} × ${cv.height} px` }];
      }
    },

    /* ---------- 借鉴 Stirling-PDF：页面排版 ---------- */
