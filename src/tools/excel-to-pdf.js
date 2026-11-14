    {
      id: 'excel-to-pdf', name: 'Excel 转 PDF', cat: 'pdf', icon: 'img2pdf', minFiles: 1, accept: '.xlsx',
      desc: '将 Excel 表格按工作表转为 PDF。',
      keywords: 'Excel转PDF xlsx转PDF 表格转PDF',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          if (!/\.xlsx$/i.test(file.name)) throw new Error('仅支持 .xlsx 格式（旧版 .xls 请先另存为 .xlsx）');
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const sheets = await parseXlsxFile(file);
          const doc = await PDFLib.PDFDocument.create();
          const PW = 842, PH = 595, colW = 110, rowH = 24, MARGIN = 24;
          const perPage = Math.floor((PH - 70) / rowH);
          // 列数超出纸张宽度时必须横向分页，否则第 8 列起被画布裁掉、数据静默丢失。
          const colsPerPage = Math.max(1, Math.floor((PW - MARGIN * 2) / colW));
          for (const sheet of sheets) {
            const cols = sheet.grid.reduce((m, r) => Math.max(m, r.length), 1);
            for (let r0 = 0; r0 < Math.max(1, sheet.grid.length); r0 += perPage) {
              for (let c0 = 0; c0 < Math.max(1, cols); c0 += colsPerPage) {
                const { cv, c, scale } = makeOfficeCanvas(PW, PH);
                c.fillStyle = '#000';
                c.font = 'bold 22px "Microsoft YaHei", sans-serif';
                c.fillText(sheet.name, MARGIN * scale, 36 * scale);
                for (let ri = 0; ri < perPage && r0 + ri < sheet.grid.length; ri++) {
                  const row = sheet.grid[r0 + ri] || [];
                  const y = 56 + ri * rowH;
                  for (let ci = c0; ci < Math.min(cols, c0 + colsPerPage); ci++) {
                    const x = MARGIN + (ci - c0) * colW;
                    c.strokeStyle = '#999';
                    c.lineWidth = 1;
                    c.strokeRect(x * scale, y * scale, colW * scale, rowH * scale);
                    const txt = String(row[ci] || '').slice(0, 14);
                    if (txt) {
                      c.fillStyle = '#000';
                      c.font = '20px "Microsoft YaHei", sans-serif';
                      c.fillText(txt, (x + 5) * scale, (y + rowH * 0.68) * scale);
                    }
                  }
                }
                const png = await canvasToBlob(cv, 'image/png');
                const page = doc.addPage([PW, PH]);
                page.drawImage(await doc.embedPng(await png.arrayBuffer()), { x: 0, y: 0, width: PW, height: PH });
              }
            }
          }
          out.push({ name: `${baseName(file.name)}.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
