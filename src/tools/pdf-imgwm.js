    {
      id: 'pdf-imgwm', name: '图片水印 / 骑缝章', cat: 'pdf', icon: 'stamp', minFiles: 1, accept: '.pdf',
      desc: '将印章 / Logo 盖到 PDF 页面，支持骑缝章。',
      keywords: '骑缝章 印章 盖章 图片水印 logo',
      options: [
        { key: 'seal', type: 'file', label: '水印图片', accept: IMAGE_ACCEPT, required: true, hint: `支持 ${IMAGE_FORMAT_LABEL}，PNG 透明底印章效果最佳` },
        { key: 'mode', type: 'select', label: '盖章方式', def: 'seal', choices: [['seal', '骑缝章（每页盖一条竖切片）'], ['center', '页面居中'], ['tile', '斜向平铺'], ['corner', '右下角']] },
        { key: 'widthPct', type: 'number', label: '宽度占页宽 %', def: 30, min: 2, max: 100 },
        { key: 'opacity', type: 'number', label: '透明度 (0.1-1)', def: 1, min: 0.1, max: 1, step: 0.1 },
      ],
      async run(ctx) {
        const sealFile = ctx.get('seal');
        if (!sealFile) throw new Error('请先选择水印图片');
        const mode = ctx.get('mode');
        const widthPct = Math.min(100, Math.max(2, parseFloat(ctx.get('widthPct')) || 30)) / 100;
        const opacity = Math.min(1, Math.max(0.1, parseFloat(ctx.get('opacity')) || 1));
        const sealCanvas = await imageFileToCanvas(sealFile);
        const out = [];
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          // 骑缝章：把图片竖切成 total 条
          const slices = [];
          if (mode === 'seal') {
            const sliceW = sealCanvas.width / total;
            for (let i = 0; i < total; i++) {
              const cv = document.createElement('canvas');
              cv.width = Math.ceil(sliceW);
              cv.height = sealCanvas.height;
              cv.getContext('2d').drawImage(sealCanvas, i * sliceW, 0, sliceW, sealCanvas.height, 0, 0, cv.width, cv.height);
              slices.push(cv);
            }
          } else {
            slices.push(sealCanvas);
          }
          const embeds = [];
          for (const cv of slices) {
            const blob = await canvasToBlob(cv, 'image/png');
            embeds.push(await doc.embedPng(await blob.arrayBuffer()));
          }
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在盖章 ${i + 1}/${total}…`);
            const page = doc.getPage(i);
            const { width, height } = page.getSize();
            const draw = (img, iw, ih, x, y) => page.drawImage(img, { x, y, width: iw, height: ih, opacity });
            if (mode === 'seal') {
              const img = embeds[i];
              const iw = width * widthPct * (1 / Math.max(1, total * 0.25));
              const ih = iw * (slices[i].height / slices[i].width);
              // 盖在右边缘，一半压在页面外（骑缝效果）
              draw(img, iw, ih, width - iw * 0.55, (height - ih) / 2);
            } else {
              const img = embeds[0];
              const iw = width * widthPct;
              const ih = iw * (sealCanvas.height / sealCanvas.width);
              if (mode === 'center') draw(img, iw, ih, (width - iw) / 2, (height - ih) / 2);
              else if (mode === 'corner') draw(img, iw, ih, width - iw - 20, 20);
              else {
                const stepX = iw * 2.2, stepY = ih * 2.6;
                for (let y = -ih; y < height + ih; y += stepY)
                  for (let x = -iw; x < width + iw; x += stepX)
                    draw(img, iw, ih, x, y);
              }
            }
          }
          out.push({ name: `${baseName(file.name)}_盖章版.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
