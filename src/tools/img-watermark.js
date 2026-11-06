    {
      id: 'img-watermark', name: '图片加水印', cat: 'img', icon: 'droplet', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '为图片添加文字或 Logo 水印，支持平铺。',
      keywords: '图片水印 watermark 加水印 logo 标记 版权',
      options: [
        { key: 'wmType', type: 'select', label: '水印类型', def: 'text', choices: [['text', '文字水印'], ['image', '图片水印（Logo / 印章）']] },
        { key: 'text', type: 'text', label: '水印文字', def: '仅供内部使用', requiredWhen: { wmType: 'text' }, visibleWhen: { wmType: 'text' } },
        { key: 'logo', type: 'file', label: 'Logo 图片', accept: IMAGE_ACCEPT, requiredWhen: { wmType: 'image' }, visibleWhen: { wmType: 'image' }, hint: '建议使用透明背景 PNG' },
        { key: 'mode', type: 'select', label: '排列方式', def: 'tile', choices: [['tile', '斜向平铺'], ['corner', '右下角']] },
        { key: 'opacity', type: 'number', label: '文字透明度 (0.05-1)', def: 0.25, min: 0.05, max: 1, step: 0.05, visibleWhen: { wmType: 'text' } },
        { key: 'fontPct', type: 'number', label: '字号占图宽 %', def: 5, min: 1, max: 30, visibleWhen: { wmType: 'text' }, advanced: true },
        { key: 'color', type: 'color', label: '水印颜色', def: '#ffffff', visibleWhen: { wmType: 'text' }, advanced: true },
        { key: 'logoScale', type: 'number', label: 'Logo 占图宽 %', def: 20, min: 3, max: 100, visibleWhen: { wmType: 'image' } },
        { key: 'logoOpacity', type: 'number', label: 'Logo 透明度 (0.05-1)', def: 0.4, min: 0.05, max: 1, step: 0.05, visibleWhen: { wmType: 'image' }, advanced: true },
      ],
      async run(ctx) {
        const wmType = ctx.get('wmType') || 'text';
        const text = ctx.get('text') || '';
        const opacity = Math.min(1, Math.max(0.05, parseFloat(ctx.get('opacity')) || 0.25));
        const fontPct = Math.max(1, parseFloat(ctx.get('fontPct')) || 5) / 100;
        const color = ctx.get('color') || '#ffffff';
        const mode = ctx.get('mode');
        let logo = null;
        let logoScale = 0.2, logoOpacity = 0.4;
        if (wmType === 'image') {
          const logoFile = ctx.get('logo');
          if (!logoFile) throw new Error('请选择作为水印的 Logo 图片');
          logo = await imageFileToCanvas(logoFile);
          logoScale = Math.max(3, Math.min(100, parseFloat(ctx.get('logoScale')) || 20)) / 100;
          logoOpacity = Math.min(1, Math.max(0.05, parseFloat(ctx.get('logoOpacity')) || 0.4));
        } else if (!text.trim()) {
          throw new Error('请输入水印文字');
        }
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在添加水印 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const c = cv.getContext('2d');
          const fontPx = Math.max(12, Math.round(cv.width * fontPct));
          if (logo) {
            const lw = Math.max(8, Math.round(cv.width * logoScale));
            const lh = Math.max(1, Math.round(logo.height * lw / logo.width));
            c.globalAlpha = logoOpacity;
            if (mode === 'corner') {
              c.drawImage(logo, cv.width - lw - fontPx * 0.3, cv.height - lh - fontPx * 0.3, lw, lh);
            } else {
              c.translate(cv.width / 2, cv.height / 2);
              c.rotate(-Math.PI / 9);
              const stepX = lw * 1.7, stepY = lh * 2.2;
              for (let y = -cv.height; y < cv.height * 2; y += stepY)
                for (let x = -cv.width; x < cv.width * 2; x += stepX)
                  c.drawImage(logo, x - lw / 2, y - lh / 2, lw, lh);
            }
          } else {
            c.font = `bold ${fontPx}px "Microsoft YaHei", sans-serif`;
            c.fillStyle = color;
            c.globalAlpha = opacity;
            if (mode === 'corner') {
              c.textAlign = 'right';
              c.textBaseline = 'bottom';
              c.fillText(text, cv.width - fontPx * 0.5, cv.height - fontPx * 0.5);
            } else {
              c.textAlign = 'center';
              c.textBaseline = 'middle';
              c.translate(cv.width / 2, cv.height / 2);
              c.rotate(-Math.PI / 9);
              const stepX = fontPx * text.length * 1.9;
              const stepY = fontPx * 3;
              for (let y = -cv.height; y < cv.height * 2; y += stepY)
                for (let x = -cv.width; x < cv.width * 2; x += stepX)
                  c.fillText(text, x, y);
            }
          }
          c.globalAlpha = 1;
          const blob = await canvasToBlob(cv, 'image/png');
          out.push({ name: `${baseName(ctx.files[i].name)}_水印.png`, blob });
        }
        return out;
      }
    },
