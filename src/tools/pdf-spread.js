    {
      id: 'pdf-spread', name: '对开页拆分', cat: 'pdf', icon: 'spread', minFiles: 1, accept: '.pdf',
      desc: '将横向对开的扫描页一分为二，还原为单页 PDF。',
      keywords: '对开 拆页 跨页 spread 扫描',
      options: [
        { key: 'direction', type: 'select', label: '拆分方向', def: 'auto', choices: [['auto', '自动（按横竖判断）'], ['lr', '左右拆分'], ['tb', '上下拆分']] },
      ],
      async run(ctx) {
        const out = [];
        const dir = ctx.get('direction');
        for (const file of ctx.files) {
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const doc = await PDFLib.PDFDocument.create();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在拆分第 ${i + 1}/${total} 页…`);
            const [sp] = await doc.copyPages(src, [i]);
            const { width, height } = sp.getSize();
            const isLandscape = width > height;
            const doLR = dir === 'lr' || (dir === 'auto' && isLandscape);
            if (doLR) {
              const half = width / 2;
              doc.addPage([half, height]).drawPage(await doc.embedPage(sp, { left: 0, bottom: 0, right: half, top: height }), { x: 0, y: 0, width: half, height });
              doc.addPage([half, height]).drawPage(await doc.embedPage(sp, { left: half, bottom: 0, right: width, top: height }), { x: 0, y: 0, width: half, height });
            } else {
              const half = height / 2;
              doc.addPage([width, half]).drawPage(await doc.embedPage(sp, { left: 0, bottom: half, right: width, top: height }), { x: 0, y: 0, width, height: half });
              doc.addPage([width, half]).drawPage(await doc.embedPage(sp, { left: 0, bottom: 0, right: width, top: half }), { x: 0, y: 0, width, height: half });
            }
          }
          out.push({ name: `${baseName(file.name)}_对开拆分.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
