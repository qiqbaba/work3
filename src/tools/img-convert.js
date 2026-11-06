    {
      id: 'img-convert', name: '图片格式转换', cat: 'img', icon: 'convert', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '在 JPG / PNG / WebP / AVIF 等格式间转换。',
      keywords: '格式转换 png jpg webp avif bmp tiff 转换',
      options: [
        {
          key: 'format', type: 'select', label: '目标格式', def: 'png',
          // AVIF 编码支持依浏览器而定，不支持时不展示该选项
          choices: [['png', 'PNG（无损）'], ['jpeg', 'JPG'], ['webp', 'WebP']]
            .concat(imageExportSupported('avif') ? [['avif', 'AVIF']] : [])
            .concat([['bmp', 'BMP'], ['tiff', 'TIFF']])
        },
        { key: 'quality', type: 'number', label: 'JPG/WebP 质量 (1-100)', def: 92, min: 10, max: 100 },
      ],
      async run(ctx) {
        const format = ctx.get('format') || 'png';
        const quality = (parseInt(ctx.get('quality'), 10) || 92) / 100;
        const needWhiteBg = format === 'jpeg' || format === 'bmp' || format === 'tiff';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在转换 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const source = needWhiteBg ? flattenCanvasOnWhite(cv) : cv;
          const blob = await canvasToImageBlob(source, format, quality);
          out.push({ name: `${baseName(ctx.files[i].name)}.${imageOutputExt(format)}`, blob });
        }
        return out;
      }
    },
