    {
      id: 'pdf-booklet', name: '小册子拼版', cat: 'pdf', icon: 'booklet', minFiles: 1, accept: '.pdf', single: true,
      desc: '按小册子顺序重排页面，便于打印。',
      keywords: '小册子 booklet 拼版 装订 骑马订 imposition',
      options: [
        { key: 'layout', type: 'select', label: '输出方式', def: 'reorder', choices: [['reorder', '仅按小册子顺序重排'], ['nup', '每张纸 2 页（双联拼版）']] },
        { key: 'gap', type: 'number', label: '页间距 (pt)', def: 8, min: 0, max: 60 },
      ],
      async run(ctx) {
        const out = [];
        const gap = Math.max(0, parseFloat(ctx.get('gap')) || 0);
        for (const file of ctx.files) {
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const order = bookletOrder(total);
          const size = src.getPage(0).getSize();
          const doc = await PDFLib.PDFDocument.create();
          if (ctx.get('layout') === 'reorder') {
            for (let k = 0; k < order.length; k++) {
              ctx.progress(k, order.length, `正在重排 ${k + 1}/${order.length}…`);
              const idx = order[k];
              if (idx < 0) { doc.addPage([size.width, size.height]); continue; }
              (await doc.copyPages(src, [idx])).forEach(p => doc.addPage(p));
            }
          } else {
            for (let k = 0; k < order.length; k += 2) {
              ctx.progress(k, order.length, `正在拼版 ${k + 1}/${order.length}…`);
              const sheet = doc.addPage([size.width * 2 + gap * 3, size.height + gap * 2]);
              for (let s = 0; s < 2; s++) {
                const idx = order[k + s];
                if (idx == null || idx < 0) continue;
                const [sp] = await doc.copyPages(src, [idx]);
                sheet.drawPage(await doc.embedPage(sp), { x: gap + s * (size.width + gap), y: gap, width: size.width, height: size.height });
              }
            }
          }
          out.push({ name: `${baseName(file.name)}_小册子.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
