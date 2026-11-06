    {
      id: 'img-meme', name: '表情包生成器', cat: 'img', icon: 'text', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '给图片加配文，快速做表情包。',
      keywords: '表情包 meme 配文 文字 图片加字 上排 下排 梗图',
      options: [
        { key: 'top', type: 'text', label: '上排文字', def: '', placeholder: '例如：当我说要早睡' },
        { key: 'bottom', type: 'text', label: '下排文字', def: '', placeholder: '例如：结果刷到凌晨三点' },
        { key: 'fontPct', type: 'number', label: '字号占图宽 %', def: 9, min: 3, max: 25 },
        { key: 'color', type: 'color', label: '文字颜色', def: '#ffffff' },
        { key: 'strokeColor', type: 'color', label: '描边颜色', def: '#000000' },
        { key: 'strokePct', type: 'number', label: '描边粗细 (% 字号)', def: 7, min: 0, max: 25 },
      ],
      async run(ctx) {
        const top = String(ctx.get('top') || '').trim();
        const bottom = String(ctx.get('bottom') || '').trim();
        if (!top && !bottom) throw new Error('请至少填写上排或下排文字');
        const fontPct = Math.max(3, Math.min(25, parseFloat(ctx.get('fontPct')) || 9)) / 100;
        const color = ctx.get('color') || '#ffffff';
        const strokeColor = ctx.get('strokeColor') || '#000000';
        const strokePct = Math.max(0, Math.min(25, parseFloat(ctx.get('strokePct')) || 0)) / 100;
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在添加文字 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const c = cv.getContext('2d');
          const fontPx = Math.max(12, Math.round(cv.width * fontPct));
          const lineH = fontPx * 1.18;
          const strokeW = fontPx * strokePct;
          c.font = `bold ${fontPx}px "Microsoft YaHei", "PingFang SC", Impact, sans-serif`;
          c.textAlign = 'center';
          c.textBaseline = 'top';
          c.lineJoin = 'round';
          c.miterLimit = 2;
          const maxW = Math.max(fontPx * 2, cv.width - fontPx * 0.6);
          const paint = (lines, startY) => {
            lines.forEach((line, idx) => {
              const y = startY + idx * lineH;
              if (strokeW > 0) {
                c.lineWidth = strokeW;
                c.strokeStyle = strokeColor;
                c.strokeText(line, cv.width / 2, y);
              }
              c.fillStyle = color;
              c.fillText(line, cv.width / 2, y);
            });
          };
          const topLines = top ? wrapTextLines(c, top, maxW) : [];
          const bottomLines = bottom ? wrapTextLines(c, bottom, maxW) : [];
          if (topLines.length) paint(topLines, fontPx * 0.4);
          if (bottomLines.length) {
            paint(bottomLines, cv.height - bottomLines.length * lineH - fontPx * 0.4);
          }
          const blob = await canvasToBlob(cv, 'image/png');
          out.push({
            name: `${baseName(ctx.files[i].name)}_表情包.png`,
            blob,
            meta: `${cv.width} × ${cv.height} px`,
          });
        }
        return out;
      }
    },
