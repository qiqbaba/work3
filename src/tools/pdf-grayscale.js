    {
      id: 'pdf-grayscale', name: '灰度 PDF', cat: 'pdf', icon: 'image', minFiles: 1, accept: '.pdf',
      desc: '将 PDF 页面转为灰度。',
      keywords: '灰度 去色 黑白 grayscale 黑白化 变灰',
      options: [
        { key: 'scale', type: 'select', label: '渲染质量', def: '2', choices: [['1.5', '标准'], ['2', '清晰（推荐）'], ['3', '高清']] },
        { key: 'quality', type: 'number', label: '输出质量 (1-100)', def: 85, min: 10, max: 100 },
      ],
      async run(ctx) {
        const out = [];
        const scale = parseFloat(ctx.get('scale')) || 2;
        const quality = (parseInt(ctx.get('quality'), 10) || 85) / 100;
        for (let i = 0; i < ctx.files.length; i++) {
          const file = ctx.files[i];
          const blob = await rasterizePdfToBlob(file, { scale, quality, filter: 'grayscale(1)' },
            (d, t, text) => ctx.progress(i + d / t, ctx.files.length, text));
          out.push({ name: `${baseName(file.name)}_灰度.pdf`, blob, meta: '已转为灰度' });
        }
        return out;
      }
    },
