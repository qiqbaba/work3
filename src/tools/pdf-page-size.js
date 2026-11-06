    {
      id: 'pdf-page-size', name: '调整页面尺寸', cat: 'pdf', icon: 'resize', minFiles: 1, accept: '.pdf',
      desc: '统一页面尺寸，内容等比缩放。',
      keywords: '页面尺寸 A4 统一 缩放 页面调整 scale papersize',
      options: [
        { key: 'size', type: 'select', label: '目标尺寸', def: 'a4', choices: [['a4', 'A4 纵向 (595×842 pt)'], ['landscape-a4', 'A4 横向 (842×595 pt)'], ['a3', 'A3 (842×1191 pt)'], ['letter', 'Letter (612×792 pt)'], ['custom', '自定义']] },
        { key: 'width', type: 'number', label: '自定义宽 (pt)', def: 595, min: 20, max: 5000 },
        { key: 'height', type: 'number', label: '自定义高 (pt)', def: 842, min: 20, max: 5000 },
        { key: 'fit', type: 'select', label: '内容适配', def: 'contain', choices: [['contain', '等比缩放并居中'], ['stretch', '拉伸填满']] },
      ],
      async run(ctx) {
        const presets = {
          'a4': [595.28, 841.89], 'landscape-a4': [841.89, 595.28],
          'a3': [841.89, 1190.55], 'letter': [612, 792],
        };
        const preset = presets[ctx.get('size')];
        const tw = preset ? preset[0] : (parseFloat(ctx.get('width')) || 595);
        const th = preset ? preset[1] : (parseFloat(ctx.get('height')) || 842);
        const stretch = ctx.get('fit') === 'stretch';
        const out = [];
        for (const file of ctx.files) {
          const src = await loadPdfDoc(file);
          const total = src.getPageCount();
          const doc = await PDFLib.PDFDocument.create();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在调整第 ${i + 1}/${total} 页…`);
            const [sp] = await doc.copyPages(src, [i]);
            const ep = await doc.embedPage(sp);
            const s = sp.getSize();
            const page = doc.addPage([tw, th]);
            if (stretch) {
              page.drawPage(ep, { x: 0, y: 0, width: tw, height: th });
            } else {
              const k = Math.min(tw / s.width, th / s.height);
              const w = s.width * k, h = s.height * k;
              page.drawPage(ep, { x: (tw - w) / 2, y: (th - h) / 2, width: w, height: h });
            }
          }
          out.push({ name: `${baseName(file.name)}_统一尺寸.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
