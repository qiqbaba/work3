    {
      id: 'pdf-header-footer', name: '页眉页脚', cat: 'pdf', icon: 'hash', minFiles: 1, accept: '.pdf',
      desc: '批量添加页眉页脚，支持页码变量。',
      keywords: '页眉 页脚 header footer 页眉页脚 批注页码',
      options: [
        { key: 'header', type: 'text', label: '页眉文字', def: '', placeholder: '留空不添加；支持 {n} {total} {file}' },
        { key: 'headerPos', type: 'select', label: '页眉位置', def: 'center', choices: [['left', '左侧'], ['center', '居中'], ['right', '右侧']] },
        { key: 'footer', type: 'text', label: '页脚文字', def: '第 {n} 页 / 共 {total} 页', placeholder: '留空不添加；支持 {n} {total} {file}' },
        { key: 'footerPos', type: 'select', label: '页脚位置', def: 'center', choices: [['left', '左侧'], ['center', '居中'], ['right', '右侧']] },
        { key: 'fontPx', type: 'number', label: '字号 (px)', def: 24, min: 10, max: 120 },
        { key: 'color', type: 'color', label: '文字颜色', def: '#666666' },
        { key: 'margin', type: 'number', label: '边距 (pt)', def: 20, min: 4, max: 100 },
        { key: 'skipFirst', type: 'checkbox', label: '封面（首页）不显示', def: false },
      ],
      async run(ctx) {
        const out = [];
        const fontPx = parseInt(ctx.get('fontPx'), 10) || 24;
        const color = ctx.get('color') || '#666666';
        const margin = Math.max(4, parseFloat(ctx.get('margin')) || 20);
        const skipFirst = !!ctx.get('skipFirst');
        const header = ctx.get('header') || '';
        const footer = ctx.get('footer') || '';
        if (!header && !footer) throw new Error('请至少填写页眉或页脚文字');
        const fmt = (tpl, n, total, name) => tpl.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total)).replace(/\{file\}/g, name);
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在添加页眉页脚 ${i + 1}/${total}…`);
            if (skipFirst && i === 0) continue;
            const page = doc.getPage(i);
            const { width, height } = page.getSize();
            const draw = async (tpl, pos, isTop) => {
              if (!tpl) return;
              const text = fmt(tpl, i + 1, total, baseName(file.name));
              const cv = makeTextImage(text, { fontPx, color, bold: false });
              const img = await doc.embedPng(await (await canvasToBlob(cv, 'image/png')).arrayBuffer());
              const scale = 0.75;
              const w = cv.width * scale, h = cv.height * scale;
              let x = (width - w) / 2;
              if (pos === 'left') x = margin;
              if (pos === 'right') x = width - w - margin;
              const y = isTop ? height - h - margin : margin;
              page.drawImage(img, { x, y, width: w, height: h, opacity: 0.9 });
            };
            await draw(header, ctx.get('headerPos') || 'center', true);
            await draw(footer, ctx.get('footerPos') || 'center', false);
          }
          out.push({ name: `${baseName(file.name)}_页眉页脚.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },
