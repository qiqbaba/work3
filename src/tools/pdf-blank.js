    {
      id: 'pdf-blank', name: '空白页检测', cat: 'pdf', icon: 'scan', minFiles: 1, accept: '.pdf',
      desc: '检测并移除扫描件中的空白页。',
      keywords: '空白页 检测 扫描 去空白',
      options: [
        { key: 'threshold', type: 'number', label: '判定阈值（墨迹占比 %）', def: 0.15, min: 0.02, max: 5, step: 0.05 },
        { key: 'mode', type: 'select', label: '输出方式', def: 'remove', choices: [['remove', '生成移除空白页的 PDF'], ['report', '仅输出检测报告']] },
      ],
      async run(ctx) {
        const threshold = Math.max(0.02, parseFloat(ctx.get('threshold')) || 0.15) / 100;
        const out = [];
        for (const file of ctx.files) {
          const pdfjsDoc = await loadPdfjsDoc(file);
          const total = pdfjsDoc.numPages;
          const blankPages = [];
          for (let i = 1; i <= total; i++) {
            ctx.progress(i - 1, total, `正在检测第 ${i}/${total} 页…`);
            const cv = await renderPageToCanvas(pdfjsDoc, i, 0.25, false);
            const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            let ink = 0;
            const pixels = cv.width * cv.height;
            for (let p = 0; p < data.length; p += 16) { // 抽样
              if (data[p] < 235 || data[p + 1] < 235 || data[p + 2] < 235) ink++;
            }
            const ratio = (ink * 4) / pixels;
            if (ratio < threshold) blankPages.push(i);
          }
          const report = `《${file.name}》空白页检测报告\n总页数：${total}\n阈值：${(threshold * 100).toFixed(2)}%\n空白页：${blankPages.length ? blankPages.join(', ') : '无'}\n`;
          out.push({ name: `${baseName(file.name)}_空白页报告.txt`, blob: new Blob([report], { type: 'text/plain' }) });
          if (ctx.get('mode') === 'remove' && blankPages.length) {
            const src = await loadPdfDoc(file);
            const keep = Array.from({ length: total }, (_, i) => i).filter(i => !blankPages.includes(i + 1));
            if (keep.length) {
              const doc = await PDFLib.PDFDocument.create();
              const pages = await doc.copyPages(src, keep);
              pages.forEach(p => doc.addPage(p));
              out.push({ name: `${baseName(file.name)}_去空白页.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
            }
          }
        }
        return out;
      }
    },
