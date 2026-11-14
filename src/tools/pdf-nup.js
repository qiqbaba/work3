    {
      id: 'pdf-nup', name: '多页拼版', cat: 'pdf', icon: 'grid', minFiles: 1, accept: '.pdf',
      desc: '将多页缩印拼合到一页。',
      keywords: '拼版 缩印 nup 合并页 打印',
      options: [
        { key: 'layout', type: 'select', label: '版式', def: '2', choices: [['2', '每张 2 页（上下）'], ['4', '每张 4 页（2×2）']] },
        { key: 'gap', type: 'number', label: '页间距 (pt)', def: 8, min: 0, max: 60 }],
      async run(ctx) {
        const out = [];
        const per = parseInt(ctx.get('layout'), 10) === 4 ? 4 : 2;
        const gap = Math.max(0, parseFloat(ctx.get('gap')) || 0);
        for (const file of ctx.files) {
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const doc = await PDFLib.PDFDocument.create();
          const srcSize = src.getPage(0).getSize();
          const cols = per === 4 ? 2 : 1;
          const rows = per === 4 ? 2 : 2;
          for (let i = 0; i < total; i += per) {
            ctx.progress(i, total, `正在拼版 ${Math.min(i + per, total)}/${total}…`);
            const page = doc.addPage([srcSize.width, srcSize.height]);
            const cellW = Math.max(1, (srcSize.width - gap * (cols + 1)) / cols);
            const cellH = Math.max(1, (srcSize.height - gap * (rows + 1)) / rows);
            for (let k = 0; k < per && i + k < total; k++) {
              const [sp] = await doc.copyPages(src, [i + k]);
              const ep = await doc.embedPage(sp);
              const c = k % cols, r = Math.floor(k / cols);
              // 2 合 1 的格子是整页宽、半页高；同时传 width/height 会把内容纵向压扁，
              // 必须按同一比例缩放并在格子内居中。
              const k2 = Math.min(cellW / ep.width, cellH / ep.height);
              const dw = ep.width * k2, dh = ep.height * k2;
              const cellX = gap + c * (cellW + gap);
              const cellY = srcSize.height - gap - (r + 1) * cellH - r * gap;
              page.drawPage(ep, {
                x: cellX + (cellW - dw) / 2,
                y: cellY + (cellH - dh) / 2,
                width: dw, height: dh,
              });
            }
          }
          out.push({ name: `${baseName(file.name)}_${per}合1.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },

    /* ---------- PDF 转换 ---------- */
