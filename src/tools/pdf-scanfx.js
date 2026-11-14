    {
      id: 'pdf-scanfx', name: '扫描件调色 / 反色', cat: 'pdf', icon: 'wand', minFiles: 1, accept: '.pdf',
      desc: '调整亮度、对比度、黑白化或反色，优化扫描件。',
      keywords: '调色 反色 扫描 亮度 对比度 黑白 invert contrast enhance',
      options: [
        { key: 'brightness', type: 'number', label: '亮度 (1 为原样)', def: 1, min: 0.3, max: 2, step: 0.05 },
        { key: 'contrast', type: 'number', label: '对比度 (1 为原样)', def: 1.15, min: 0.3, max: 3, step: 0.05 },
        { key: 'grayscale', type: 'checkbox', label: '黑白化（去彩色）', def: false },
        { key: 'invert', type: 'checkbox', label: '反色（负片效果）', def: false },
        { key: 'dpi', type: 'select', label: '输出分辨率', def: '200', choices: [['150', '150 DPI'], ['200', '200 DPI（推荐）'], ['300', '300 DPI']] },
        { key: 'quality', type: 'number', label: '输出质量 (1-100)', def: 85, min: 30, max: 100 },
      ],
      async run(ctx) {
        const brightness = parseFloat(ctx.get('brightness'));
        const contrast = parseFloat(ctx.get('contrast'));
        const b = Number.isFinite(brightness) ? brightness : 1;
        const c = Number.isFinite(contrast) ? contrast : 1.15;
        const parts = [`brightness(${b})`, `contrast(${c})`];
        if (ctx.get('grayscale')) parts.push('grayscale(1)');
        if (ctx.get('invert')) parts.push('invert(1)');
        const filter = parts.join(' ');
        const out = [];
        for (const file of ctx.files) {
          const blob = await rasterizePdfToBlob(file, {
            scale: (parseInt(ctx.get('dpi'), 10) || 200) / 72,
            quality: (parseInt(ctx.get('quality'), 10) || 85) / 100,
            filter,
          }, (done, total, text) => ctx.progress(done, total, `${file.name}：${text}`));
          out.push({
            name: `${baseName(file.name)}_调色.pdf`, blob,
            meta: `${formatBytes(file.size)} → ${formatBytes(blob.size)}`,
          });
        }
        return out;
      }
    },

    /* ---------- 借鉴 Stirling-PDF：安全清理 ---------- */
