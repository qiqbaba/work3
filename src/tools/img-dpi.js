    {
      id: 'img-dpi', name: '图片 DPI / 打印尺寸', cat: 'img', icon: 'resize', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '设置 JPG / PNG 的打印 DPI 与尺寸。',
      keywords: 'dpi ppi 分辨率 打印 300dpi 相纸 尺寸 pHYs',
      options: [
        { key: 'dpi', type: 'number', label: '目标 DPI', def: 300, min: 72, max: 1200, hint: '照片打印常用 300 DPI，屏幕用 72–96 DPI' },
        { key: 'format', type: 'select', label: '输出格式', def: 'keep', choices: [['keep', '保持 JPG / PNG 原像素（无损）'], ['jpeg', '统一转 JPG'], ['png', '统一转 PNG']] },
      ],
      async run(ctx) {
        const dpi = Math.max(1, Math.min(1200, parseInt(ctx.get('dpi'), 10) || 300));
        const format = ctx.get('format') || 'keep';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在写入 DPI ${i + 1}/${ctx.files.length}…`);
          const f = ctx.files[i];
          const bytes = new Uint8Array(await f.arrayBuffer());
          const mime = detectImageMime(bytes);
          let data, ext, outMime;
          if (format === 'keep' && mime === 'image/jpeg') {
            data = setJpegDpi(bytes, dpi); ext = 'jpg'; outMime = 'image/jpeg';
          } else if (format === 'keep' && mime === 'image/png') {
            data = setPngDpi(bytes, dpi); ext = 'png'; outMime = 'image/png';
          } else {
            const target = format === 'png' ? 'png' : 'jpeg';
            const cv = await imageFileToCanvas(f);
            const src = target === 'jpeg' ? flattenCanvasOnWhite(cv) : cv;
            const blob = await canvasToBlob(src, target === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92);
            const raw = new Uint8Array(await blob.arrayBuffer());
            data = target === 'png' ? setPngDpi(raw, dpi) : setJpegDpi(raw, dpi);
            ext = imageOutputExt(target);
            outMime = blob.type;
          }
          let dims = '';
          try {
            const cv = await imageFileToCanvas(f);
            dims = `${cv.width} × ${cv.height} px → ${(cv.width / dpi * 2.54).toFixed(1)} × ${(cv.height / dpi * 2.54).toFixed(1)} cm`;
          } catch (e) { dims = `${dpi} DPI`; }
          out.push({
            name: `${baseName(f.name)}_${dpi}dpi.${ext}`,
            blob: bytesToBlob(data, outMime),
            meta: dims,
          });
        }
        return out;
      }
    },
