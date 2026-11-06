    {
      id: 'img-upscale', name: '图片放大增强', cat: 'img', icon: 'resize', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按 1.5–4 倍放大图片并锐化。',
      keywords: '放大 无损放大 提升清晰度 upscale 变大 2倍 4倍 增强',
      options: [
        { key: 'scale', type: 'select', label: '放大倍数', def: '2', choices: [['1.5', '1.5 倍'], ['2', '2 倍'], ['3', '3 倍'], ['4', '4 倍']] },
        {
          key: 'sharpen', type: 'select', label: '锐化强度', def: '80',
          choices: [['0', '不锐化（仅放大）'], ['50', '轻度'], ['80', '标准'], ['100', '强']],
        },
        { key: 'format', type: 'select', label: '输出格式', def: 'png', choices: [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']] },
      ],
      async run(ctx) {
        const scale = Math.max(1, parseFloat(ctx.get('scale')) || 2);
        const sharpen = Math.max(0, Math.min(100, parseFloat(ctx.get('sharpen')) || 0));
        const format = ctx.get('format') || 'png';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在放大 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const targetW = Math.round(cv.width * scale);
          const targetH = Math.round(cv.height * scale);
          if (targetW * targetH > 80000000) {
            throw new Error(`放大后为 ${targetW} × ${targetH} px，超过 8000 万像素上限，请降低倍数或先缩小原图`);
          }
          const up = resizedCanvas(cv, targetW, targetH);
          if (sharpen > 0) sharpenCanvas(up, sharpen);
          const source = format === 'jpeg' ? flattenCanvasOnWhite(up) : up;
          const blob = await canvasToImageBlob(source, format, 0.92);
          const tag = Number.isInteger(scale) ? String(scale) : String(scale).replace('.', 'x');
          out.push({
            name: `${baseName(ctx.files[i].name)}_放大${tag}倍.${imageOutputExt(format)}`,
            blob,
            meta: `${cv.width} × ${cv.height} → ${targetW} × ${targetH} px`,
          });
        }
        return out;
      }
    },
