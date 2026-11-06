    {
      id: 'pdf-autorotate', name: '自动旋转', cat: 'pdf', icon: 'rotate', minFiles: 1, accept: '.pdf',
      desc: '检测文字方向并自动转正页面。',
      keywords: '自动旋转 autorotate 转正 方向 detect',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          const pdfjsDoc = await loadPdfjsDoc(file);
          const doc = await loadPdfDoc(file);
          const total = pdfjsDoc.numPages;
          let changed = 0;
          for (let i = 1; i <= total; i++) {
            ctx.progress(i - 1, total, `正在检测第 ${i}/${total} 页方向…`);
            const tc = await (await pdfjsDoc.getPage(i)).getTextContent();
            const votes = { 0: 0, 90: 0, 180: 0, 270: 0 };
            for (const item of tc.items) {
              const m = item.transform || [1, 0, 0, 1];
              const ang = ((Math.atan2(m[1], m[0]) * 180 / Math.PI) % 360 + 360) % 360;
              const bucket = Math.round(ang / 90) * 90 % 360;
              votes[bucket] += (item.str || '').length + 1;
            }
            let best = 0, bestW = -1;
            for (const k of [0, 90, 180, 270]) {
              if (votes[k] > bestW) { bestW = votes[k]; best = k; }
            }
            if (bestW <= 0) continue;
            const page = doc.getPage(i - 1);
            const cur = ((page.getRotation().angle % 360) + 360) % 360;
            if (cur !== best) {
              page.setRotation(PDFLib.degrees(best));
              changed++;
            }
          }
          out.push({ name: `${baseName(file.name)}_转正.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: `已调整 ${changed} 页` });
        }
        return out;
      }
    },
