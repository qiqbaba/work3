    {
      id: 'img-to-pdf', name: '图片转 PDF', cat: 'img', icon: 'img2pdf', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '将多张图片合并为 PDF，支持 A4 排版。',
      keywords: '图片转PDF JPG转PDF PNG转PDF 合成PDF',
      options: [
        { key: 'size', type: 'select', label: '页面尺寸', def: 'a4', choices: [['a4', 'A4（图片自适应居中）'], ['fit', '与图片同尺寸']] },
        { key: 'margin', type: 'number', label: '页边距 (pt)', def: 24, min: 0, max: 150 },
      ],
      async run(ctx) {
        const doc = await PDFLib.PDFDocument.create();
        const useA4 = ctx.get('size') !== 'fit';
        const margin = Math.max(0, parseFloat(ctx.get('margin')) || 0);
        const A4 = [595.28, 841.89];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在转换 ${i + 1}/${ctx.files.length}…`);
          const file = ctx.files[i];
          const img = await embedImageFile(doc, file);
          const iw = img.width, ih = img.height;
          const pw = useA4 ? A4[0] : iw + margin * 2;
          const ph = useA4 ? A4[1] : ih + margin * 2;
          const page = doc.addPage([pw, ph]);
          const availW = pw - margin * 2, availH = ph - margin * 2;
          const s = Math.min(availW / iw, availH / ih, 1);
          const w = iw * s, h = ih * s;
          page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        }
        return [{ name: '图片转PDF结果.pdf', blob: bytesToBlob(await doc.save(), 'application/pdf') }];
      }
    },
