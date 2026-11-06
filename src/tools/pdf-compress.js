    {
      id: 'pdf-compress', name: 'PDF 压缩', cat: 'pdf', icon: 'compress', minFiles: 1, accept: '.pdf',
      desc: '压缩 PDF 体积，适合扫描件。',
      keywords: '压缩 compress 减小 瘦身',
      options: [
        { key: 'level', type: 'select', label: '压缩强度', def: 'medium', choices: [['light', '轻度（清晰优先）'], ['medium', '中度（均衡）'], ['heavy', '深度（体积优先）']] },
      ],
      async run(ctx) {
        const cfgs = {
          light: { scale: 1.6, quality: 0.82 },
          medium: { scale: 1.2, quality: 0.62 },
          heavy: { scale: 0.85, quality: 0.42 },
        };
        const cfg = cfgs[ctx.get('level')] || cfgs.medium;
        const out = [];
        for (const file of ctx.files) {
          const pdfjsDoc = await loadPdfjsDoc(file);
          const total = pdfjsDoc.numPages;
          const doc = await PDFLib.PDFDocument.create();
          for (let i = 1; i <= total; i++) {
            ctx.progress(i - 1, total, `正在压缩第 ${i}/${total} 页…`);
            const p1 = await pdfjsDoc.getPage(i);
            const pt = p1.getViewport({ scale: 1 });
            const cv = await renderPageToCanvas(pdfjsDoc, i, cfg.scale, false);
            const jpg = await canvasToBlob(cv, 'image/jpeg', cfg.quality);
            const img = await doc.embedJpg(await jpg.arrayBuffer());
            const page = doc.addPage([pt.width, pt.height]);
            page.drawImage(img, { x: 0, y: 0, width: pt.width, height: pt.height });
          }
          const blob = bytesToBlob(await doc.save(), 'application/pdf');
          const changePct = Math.round((1 - blob.size / file.size) * 100);
          out.push({
            name: `${baseName(file.name)}_压缩.pdf`,
            blob,
            meta: `${formatBytes(file.size)} → ${formatBytes(blob.size)}（${changePct >= 0 ? '省' : '增'} ${Math.abs(changePct)}%）`
          });
        }
        return out;
      }
    },
