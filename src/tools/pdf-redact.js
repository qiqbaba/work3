    {
      id: 'pdf-redact', name: '涂黑遮盖（密文）', cat: 'pdf', icon: 'eraser', minFiles: 1, accept: '.pdf',
      desc: '用色块遮盖敏感内容，可彻底固化。',
      keywords: '涂黑 遮盖 密文 脱敏 涂白 redact 敏感信息 删除文字 去水印',
      options: [
        { key: 'rects', type: 'textarea', label: '遮盖区域', def: '', placeholder: '每行一个：页码:左,上,宽,高（百分比）\n例：1:10,20,40,15\n页码可为 1-3 或 *（全部页面）', hint: '坐标为页面宽高的百分比' },
        { key: 'color', type: 'select', label: '遮盖颜色', def: 'black', choices: [['black', '黑色（涂黑）'], ['white', '白色（涂白）']] },
        { key: 'mode', type: 'select', label: '输出方式', def: 'flatten', choices: [['flatten', '固化（安全，遮盖内容不可恢复）'], ['cover', '仅覆盖（保留文字，文件小）']] },
      ],
      async run(ctx) {
        const out = [];
        const raw = String(ctx.get('rects') || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (!raw.length) throw new Error('请至少输入一个遮盖区域');
        const rects = raw.map((line, idx) => {
          const m = line.match(/^([^:：]+)\s*[:：]\s*([\d.]+)\s*[,，]\s*([\d.]+)\s*[,，]\s*([\d.]+)\s*[,，]\s*([\d.]+)$/);
          if (!m) throw new Error(`第 ${idx + 1} 行格式错误：${line}`);
          return { spec: m[1].trim(), l: parseFloat(m[2]), t: parseFloat(m[3]), w: parseFloat(m[4]), h: parseFloat(m[5]) };
        });
        const isWhite = ctx.get('color') === 'white';
        for (let fi = 0; fi < ctx.files.length; fi++) {
          const file = ctx.files[fi];
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          let drawn = 0;
          for (const r of rects) {
            const pages = r.spec === '*' ? Array.from({ length: total }, (_, i) => i + 1) : parsePageRanges(r.spec, total);
            for (const pn of pages) {
              const page = doc.getPage(pn - 1);
              const { width, height } = page.getSize();
              const x = width * r.l / 100;
              const w = width * r.w / 100;
              const top = height * r.t / 100;
              const h = height * r.h / 100;
              page.drawRectangle({
                x, y: height - top - h, width: w, height: h,
                color: isWhite ? PDFLib.rgb(1, 1, 1) : PDFLib.rgb(0, 0, 0),
              });
              drawn++;
            }
          }
          ctx.progress(fi, ctx.files.length, `正在输出 ${file.name}…`);
          let blob = bytesToBlob(await doc.save(), 'application/pdf');
          let meta = `已遮盖 ${drawn} 处`;
          if (ctx.get('mode') === 'flatten') {
            blob = await rasterizePdfToBlob(blob, { scale: 2, quality: 0.9 });
            meta += '（已固化）';
          }
          out.push({ name: `${baseName(file.name)}_遮盖.pdf`, blob, meta });
        }
        return out;
      }
    },
