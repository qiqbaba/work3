    {
      id: 'pdf-flatten', name: '扁平化', cat: 'pdf', icon: 'shield', minFiles: 1, accept: '.pdf',
      desc: '将批注与表单域固化为页面内容。',
      keywords: '扁平化 flatten 固化 表单 批注定稿',
      options: [
        { key: 'dpi', type: 'select', label: '输出清晰度', def: '200', choices: [['150', '150 DPI（体积小）'], ['200', '200 DPI（推荐）'], ['300', '300 DPI（高清）']] },
        { key: 'quality', type: 'number', label: '输出质量 (1-100)', def: 88, min: 30, max: 100 },
      ],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          const blob = await rasterizePdfToBlob(file, {
            scale: (parseInt(ctx.get('dpi'), 10) || 200) / 72,
            quality: (parseInt(ctx.get('quality'), 10) || 88) / 100,
            filter: '',
            flattenForms: true,
          }, (done, total, text) => ctx.progress(done, total, `${file.name}：${text}`));
          out.push({
            name: `${baseName(file.name)}_扁平化.pdf`, blob,
            meta: `${formatBytes(file.size)} → ${formatBytes(blob.size)}`,
          });
        }
        return out;
      }
    },

    /* ---------- 借鉴 Stirling-PDF：文档工具 ---------- */
