    {
      id: 'ppt-to-pdf', name: 'PPT 转 PDF', cat: 'pdf', icon: 'img2pdf', minFiles: 1, accept: '.pptx',
      desc: '将 PPT 演示文稿按页转为 PDF。',
      keywords: 'PPT转PDF pptx转PDF 演示文稿转PDF 幻灯片',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          if (!/\.pptx$/i.test(file.name)) throw new Error('仅支持 .pptx 格式（旧版 .ppt 请先另存为 .pptx）');
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const { sw, sh, slides } = await parsePptxFile(file);
          if (!slides.length) throw new Error('未在 PPTX 中找到可转换的幻灯片');
          const doc = await PDFLib.PDFDocument.create();
          for (const slide of slides) {
            const { cv, c, scale } = makeOfficeCanvas(sw, sh);
            for (const im of (slide.images || [])) {
              try {
                const bitmap = await createImageBitmap(new Blob([im.bytes]));
                c.drawImage(bitmap, im.x * scale, im.y * scale,
                  Math.max(1, im.w * scale), Math.max(1, im.h * scale));
                if (bitmap.close) bitmap.close();
              } catch (e) { /* 跳过无法解码的图片 */ }
            }
            for (const sp of (slide.shapes || [])) {
              const fs = Math.max(10, Math.min(40, sp.h * 0.45));
              c.fillStyle = '#000';
              c.font = 'bold ' + Math.round(fs * scale) + 'px "Microsoft YaHei", sans-serif';
              c.textAlign = 'left';
              const maxW = Math.max(40, sp.w) * scale;
              let line = '', ty = (sp.y + fs * 1.1) * scale;
              for (const ch of Array.from(sp.text)) {
                if (line && c.measureText(line + ch).width > maxW) {
                  c.fillText(line, sp.x * scale, ty);
                  ty += fs * 1.35 * scale;
                  line = ch;
                } else line += ch;
              }
              if (line) c.fillText(line, sp.x * scale, ty);
            }
            const png = await canvasToBlob(cv, 'image/png');
            const page = doc.addPage([sw, sh]);
            page.drawImage(await doc.embedPng(await png.arrayBuffer()), { x: 0, y: 0, width: sw, height: sh });
          }
          out.push({ name: `${baseName(file.name)}.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },

    /* ---------- 补充工具（对标主流在线 PDF 工具站） ---------- */
