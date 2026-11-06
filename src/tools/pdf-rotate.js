    {
      id: 'pdf-rotate', name: 'PDF 旋转', cat: 'pdf', icon: 'rotate', minFiles: 1, accept: '.pdf',
      desc: '对全部或指定页面进行旋转，支持 90°/180°/270°。',
      keywords: '旋转 rotate 转向 翻转',
      options: [
        { key: 'angle', type: 'select', label: '旋转角度', def: '90', choices: [['90', '顺时针 90°'], ['180', '180°'], ['270', '逆时针 90°']] },
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
      ],
      async run(ctx) {
        const out = [];
        const angle = parseInt(ctx.get('angle'), 10);
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          const pages = parsePageRanges(ctx.get('range'), total);
          pages.forEach(p => {
            const page = doc.getPage(p - 1);
            const cur = page.getRotation().angle || 0;
            page.setRotation(PDFLib.degrees((cur + angle) % 360));
          });
          out.push({ name: `${baseName(file.name)}_旋转${angle}度.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
