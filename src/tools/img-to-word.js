    {
      id: 'img-to-word', name: '图片插入 Word / Excel', cat: 'img', icon: 'doc', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '把多张图片按顺序插入 Word 或 Excel。',
      keywords: '图片转word docx xlsx excel 图文文档 截图归档 插入图片',
      options: [
        { key: 'target', type: 'select', label: '输出文档', def: 'docx', choices: [['docx', 'Word 文档 (.docx)'], ['xlsx', 'Excel 表格 (.xlsx)']] },
        { key: 'widthCm', type: 'number', label: '图片宽度 (cm)', def: 15, min: 1, max: 25 },
        { key: 'title', type: 'text', label: '文档标题', def: '', placeholder: '留空则不写标题', hint: '仅 Word 生效，写在图片上方' },
        { key: 'caption', type: 'checkbox', label: '标注', def: true, hint: 'Word 写在图片下方，Excel 写在同行首列' },
        { key: 'pageBreak', type: 'checkbox', label: '分页', def: false, hint: '仅 Word 生效，每张图片单独占一页' },
        { key: 'format', type: 'select', label: '嵌入格式', def: 'keep', choices: [['keep', 'JPG / PNG 保持原始字节'], ['png', '统一转 PNG（无损）'], ['jpeg', '统一转 JPG（体积更小）']] },
      ],
      async run(ctx) {
        const format = ctx.get('format') || 'keep';
        const images = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在准备图片 ${i + 1}/${ctx.files.length}…`);
          const f = ctx.files[i];
          const cv = await imageFileToCanvas(f);
          const ext = imageExtOf(f.name).toLowerCase();
          let bytes = null, outExt = '';
          if (format === 'keep' && (ext === 'png' || ext === 'jpg' || ext === 'jpeg')) {
            // 扩展名可能与实际内容不符，按文件头确认后再直接复用原始字节
            const raw = new Uint8Array(await f.arrayBuffer());
            const mime = detectImageMime(raw);
            if (mime === 'image/png' || mime === 'image/jpeg') {
              bytes = raw;
              outExt = mime === 'image/png' ? 'png' : 'jpg';
            }
          }
          if (!bytes) {
            const target = format === 'jpeg' ? 'jpeg' : 'png';
            const src = target === 'jpeg' ? flattenCanvasOnWhite(cv) : cv;
            const blob = await canvasToBlob(src, target === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92);
            bytes = new Uint8Array(await blob.arrayBuffer());
            outExt = imageOutputExt(target);
          }
          images.push({
            name: `image${i + 1}.${outExt}`,
            ext: outExt,
            bytes,
            w: cv.width,
            h: cv.height,
            caption: f.name,
          });
        }
        const xlsx = ctx.get('target') === 'xlsx';
        ctx.progress(1, 1, `正在生成 ${xlsx ? 'Excel' : 'Word'} 文档…`);
        const cfg = {
          widthCm: Math.max(1, Math.min(25, parseFloat(ctx.get('widthCm')) || 15)),
          title: String(ctx.get('title') || ''),
          caption: !!ctx.get('caption'),
          pageBreak: !!ctx.get('pageBreak'),
        };
        const blob = xlsx ? await buildXlsxWithImages(images, cfg) : await buildDocxWithImages(images, cfg);
        return [{
          name: xlsx ? '图片台账.xlsx' : '图片文档.docx',
          blob,
          meta: `共嵌入 ${images.length} 张图片`,
        }];
      }
    },
