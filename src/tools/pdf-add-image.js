    {
      id: 'pdf-add-image', name: '添加图片', cat: 'pdf', icon: 'photo', minFiles: 1, accept: '.pdf',
      desc: '在页面指定位置放置图片。',
      keywords: '添加图片 图片 addimage logo 印章 签名图片',
      options: [
        { key: 'img', type: 'file', label: '图片文件', accept: IMAGE_ACCEPT, required: true, hint: `支持 ${IMAGE_FORMAT_LABEL}（PNG 透明底效果最佳）` },
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
        { key: 'x', type: 'number', label: '水平位置 (%)（左0 右100）', def: 50, min: 0, max: 100 },
        { key: 'y', type: 'number', label: '垂直位置 (%)（下0 上100）', def: 50, min: 0, max: 100 },
        { key: 'widthPct', type: 'number', label: '宽度占页宽 %', def: 30, min: 1, max: 150 },
        { key: 'opacity', type: 'number', label: '透明度 (0.1-1)', def: 1, min: 0.1, max: 1, step: 0.1 },
      ],
      async run(ctx) {
        const imgFile = ctx.get('img');
        if (!imgFile) throw new Error('请先选择图片文件');
        const widthPct = Math.min(150, Math.max(1, parseFloat(ctx.get('widthPct')) || 30)) / 100;
        const opacity = Math.min(1, Math.max(0.1, parseFloat(ctx.get('opacity')) || 1));
        const xPct = Math.min(100, Math.max(0, parseFloat(ctx.get('x')) || 0));
        const yPct = Math.min(100, Math.max(0, parseFloat(ctx.get('y')) || 0));
        const out = [];
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          const pages = parsePageRanges(ctx.get('range'), total);
          const img = await embedImageFile(doc, imgFile);
          for (let k = 0; k < pages.length; k++) {
            ctx.progress(k, pages.length, `正在添加图片 ${k + 1}/${pages.length}…`);
            const page = doc.getPage(pages[k] - 1);
            const { width, height } = page.getSize();
            const w = width * widthPct;
            const h = w * (img.height / img.width);
            // 选项约定为「下 0 上 100」，而 PDF 原点就在左下，故 y 直接按百分比取值。
            page.drawImage(img, {
              x: width * xPct / 100 - w / 2,
              y: height * yPct / 100 - h / 2,
              width: w, height: h, opacity,
            });
          }
          out.push({ name: `${baseName(file.name)}_加图.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },

    /* ---------- 借鉴 Stirling-PDF：转换提取 ---------- */
