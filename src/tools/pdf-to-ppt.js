    {
      id: 'pdf-to-ppt', name: 'PDF 转 PPT', cat: 'pdf', icon: 'convert', minFiles: 1, accept: '.pdf',
      desc: '将 PDF 每页转为一张 PPT 幻灯片。',
      keywords: '转PPT pptx 幻灯片 PowerPoint 转演示 演示文稿',
      options: [
        { key: 'dpi', type: 'select', label: '渲染分辨率', def: '150', choices: [['96', '96 DPI'], ['150', '150 DPI（推荐）'], ['300', '300 DPI']] },
        { key: 'quality', type: 'number', label: 'JPG 质量 (1-100)', def: 88, min: 10, max: 100 },
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
      ],
      async run(ctx) {
        const out = [];
        const scale = (parseInt(ctx.get('dpi'), 10) || 150) / 72;
        const quality = (parseInt(ctx.get('quality'), 10) || 88) / 100;
        for (const file of ctx.files) {
          const src = await loadPdfjsDoc(file);
          const pages = parsePageRanges(ctx.get('range'), src.numPages);
          const images = [];
          for (let k = 0; k < pages.length; k++) {
            ctx.progress(k, pages.length, `正在渲染 ${file.name} 第 ${pages[k]} 页…`);
            const cv = await renderPageToCanvas(src, pages[k], scale, false);
            const jpg = await canvasToBlob(cv, 'image/jpeg', quality);
            images.push({ bytes: new Uint8Array(await jpg.arrayBuffer()), wPt: cv.width / scale, hPt: cv.height / scale });
          }
          const blob = await buildPptxBlob(images);
          out.push({ name: `${baseName(file.name)}.pptx`, blob, meta: `${images.length} 页幻灯片` });
        }
        return out;
      }
    },
