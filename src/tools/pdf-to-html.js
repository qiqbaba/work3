    {
      id: 'pdf-to-html', name: 'PDF 转 HTML', cat: 'pdf', icon: 'text', minFiles: 1, accept: '.pdf',
      desc: '将 PDF 每页转换为保留文字位置排版的 HTML 网页。',
      keywords: '转HTML html 网页 导出网页',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const doc = await loadPdfjsDoc(file);
          let body = '';
          for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const vp = page.getViewport({ scale: 1 });
            const tc = await page.getTextContent();
            let inner = '';
            for (const it of tc.items) {
              if (!it.str) continue;
              const t = it.transform || [1, 0, 0, 1, 0, 0];
              const size = Math.hypot(t[2], t[3]) || 10;
              inner += `<div class="t" style="left:${t[4].toFixed(1)}px;top:${(vp.height - t[5] - size).toFixed(1)}px;font-size:${size.toFixed(1)}px">${escapeHtml(it.str)}</div>`;
            }
            body += `<div class="page" style="width:${vp.width.toFixed(0)}px;height:${vp.height.toFixed(0)}px">${inner}</div>`;
          }
          const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escapeHtml(baseName(file.name))}</title><style>body{margin:0;background:#7c8290;font-family:"Microsoft YaHei",sans-serif}.page{position:relative;background:#fff;margin:14px auto;box-shadow:0 2px 12px rgba(0,0,0,.35);overflow:hidden}.t{position:absolute;white-space:pre;color:#000}</style></head><body>${body}</body></html>`;
          out.push({ name: `${baseName(file.name)}.html`, blob: new Blob([html], { type: 'text/html;charset=utf-8' }), meta: 'HTML 网页' });
        }
        return out;
      }
    },
