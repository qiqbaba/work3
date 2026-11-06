    {
      id: 'pdf-sign', name: 'PDF 签名', cat: 'pdf', icon: 'pen', minFiles: 1, accept: '.pdf',
      desc: '在 PDF 上添加图片或文字签名。',
      keywords: '签名 签署 手写签名 电子签名 sign 签字',
      options: [
        { key: 'mode', type: 'select', label: '签名方式', def: 'image', choices: [['image', '上传签名图片'], ['text', '文字签名']] },
        { key: 'sigFile', type: 'file', label: '签名图片', accept: IMAGE_ACCEPT, requiredWhen: { mode: 'image' }, visibleWhen: { mode: 'image' }, hint: `支持 ${IMAGE_FORMAT_LABEL}，建议使用透明背景 PNG` },
        { key: 'sigText', type: 'text', label: '签名文字', def: '手写签名', placeholder: '输入签名文字', requiredWhen: { mode: 'text' }, visibleWhen: { mode: 'text' } },
        { key: 'pages', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面', advanced: true },
        { key: 'position', type: 'select', label: '签名位置', def: 'bottom-right', choices: [['bottom-right', '右下角'], ['bottom-left', '左下角'], ['top-right', '右上角'], ['top-left', '左上角'], ['center', '页面居中']] },
        { key: 'widthPct', type: 'number', label: '宽度（占页宽 %）', def: 25, min: 5, max: 100 },
        { key: 'opacity', type: 'number', label: '不透明度 %', def: 100, min: 10, max: 100 },
      ],
      async run(ctx) {
        const out = [];
        const mode = ctx.get('mode') || 'image';
        const widthPct = Math.min(100, Math.max(5, parseFloat(ctx.get('widthPct')) || 25)) / 100;
        const opacity = Math.min(1, Math.max(0.1, (parseFloat(ctx.get('opacity')) || 100) / 100));
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          const pages = parsePageRanges(ctx.get('pages'), total);
          let img;
          if (mode === 'text') {
            const text = ctx.get('sigText') || '手写签名';
            const cv = makeTextImage(text, { fontPx: 120, color: '#1a3b8c', bold: true, pad: 24 });
            img = await doc.embedPng(await (await canvasToBlob(cv, 'image/png')).arrayBuffer());
          } else {
            const sigFile = ctx.get('sigFile');
            if (!sigFile) throw new Error('请先上传签名图片（或将签名方式切换为"文字签名"）');
            img = await embedImageFile(doc, sigFile);
          }
          for (let k = 0; k < pages.length; k++) {
            ctx.progress(k, pages.length, `正在签名 ${file.name} 第 ${pages[k]} 页…`);
            const page = doc.getPage(pages[k] - 1);
            const { width, height } = page.getSize();
            const w = width * widthPct;
            const h = w * img.height / img.width;
            const margin = 24;
            const pos = ctx.get('position') || 'bottom-right';
            let x = (width - w) / 2, y = (height - h) / 2;
            if (pos === 'bottom-right') { x = width - w - margin; y = margin; }
            else if (pos === 'bottom-left') { x = margin; y = margin; }
            else if (pos === 'top-right') { x = width - w - margin; y = height - h - margin; }
            else if (pos === 'top-left') { x = margin; y = height - h - margin; }
            page.drawImage(img, { x, y, width: w, height: h, opacity });
          }
          out.push({ name: `${baseName(file.name)}_签名.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
