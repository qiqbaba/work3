    {
      id: 'pdf-to-img', name: 'PDF 转图片', cat: 'pdf', icon: 'pdf2img', minFiles: 1, accept: '.pdf',
      desc: '将 PDF 页面导出为 PNG / JPG 等图片。',
      keywords: 'PDF转图片 转PNG 转JPG 转BMP 转TIFF 导出图片',
      options: [
        { key: 'format', type: 'select', label: '输出格式', def: 'png', choices: [['png', 'PNG（无损）'], ['jpeg', 'JPG（体积小）'], ['webp', 'WebP'], ['bmp', 'BMP'], ['tiff', 'TIFF']] },
        { key: 'dpi', type: 'select', label: '渲染分辨率', def: '150', choices: [['72', '72 DPI（快速预览）'], ['150', '150 DPI（推荐）'], ['300', '300 DPI（高清打印）']] },
        { key: 'quality', type: 'number', label: 'JPG/WebP 质量 (1-100)', def: 90, min: 10, max: 100 },
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
        { key: 'transparent', type: 'checkbox', label: 'PNG 保留透明背景', def: false },
      ],
      async run(ctx) {
        const out = [];
        const scale = (parseInt(ctx.get('dpi'), 10) || 150) / 72;
        const format = ctx.get('format') || 'png';
        const quality = (parseInt(ctx.get('quality'), 10) || 90) / 100;
        const transparent = format === 'png' && ctx.get('transparent');
        for (const file of ctx.files) {
          const pdfDoc = await loadPdfjsDoc(file);
          const pages = parsePageRanges(ctx.get('range'), pdfDoc.numPages);
          for (let k = 0; k < pages.length; k++) {
            ctx.progress(k, pages.length, `正在渲染 ${file.name} 第 ${pages[k]} 页…`);
            const cv = await renderPageToCanvas(pdfDoc, pages[k], scale, transparent);
            let blob, ext;
            if (format === 'bmp') {
              blob = bytesToBlob(canvasToBmpBytes(cv), 'image/bmp');
              ext = 'bmp';
            } else if (format === 'tiff') {
              blob = bytesToBlob(canvasToTiffBytes(cv), 'image/tiff');
              ext = 'tiff';
            } else {
              const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
              blob = await canvasToBlob(cv, mime, quality);
              ext = format === 'jpeg' ? 'jpg' : format;
            }
            out.push({
              name: `${baseName(file.name)}_第${pages[k]}页.${ext}`,
              blob,
              meta: `${cv.width} × ${cv.height} px`
            });
          }
        }
        return out;
      }
    },
