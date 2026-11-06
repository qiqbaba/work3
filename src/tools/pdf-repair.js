    {
      id: 'pdf-repair', name: '修复 PDF', cat: 'pdf', icon: 'wand', minFiles: 1, accept: '.pdf',
      desc: '修复无法打开或结构损坏的 PDF。',
      keywords: '修复 修复PDF repair 损坏 打不开 纠错 还原',
      options: [
        { key: 'mode', type: 'select', label: '修复方式', def: 'auto', choices: [['auto', '自动（先修复结构，失败则重建）'], ['resave', '仅重新保存（保留文字）'], ['rebuild', '整页重绘（兼容性最强）']] },
        { key: 'scale', type: 'select', label: '重建质量', def: '2', choices: [['1.5', '标准'], ['2', '清晰（推荐）'], ['3', '高清']], hint: '仅"整页重绘"时生效' },
      ],
      async run(ctx) {
        const out = [];
        const mode = ctx.get('mode') || 'auto';
        const scale = parseFloat(ctx.get('scale')) || 2;
        for (let i = 0; i < ctx.files.length; i++) {
          const file = ctx.files[i];
          ctx.progress(i, ctx.files.length, `正在修复 ${file.name}…`);
          if (mode !== 'rebuild') {
            try {
              const doc = await loadPdfDoc(file);
              const bytes = await doc.save();
              out.push({ name: `${baseName(file.name)}_修复.pdf`, blob: bytesToBlob(bytes, 'application/pdf'), meta: '结构已重新保存' });
              continue;
            } catch (e) {
              if (mode === 'resave') throw new Error(`${file.name} 结构修复失败：${e.message}`);
            }
          }
          const blob = await rasterizePdfToBlob(file, { scale, quality: 0.85 },
            (d, t, text) => ctx.progress(i + d / t, ctx.files.length, text));
          out.push({ name: `${baseName(file.name)}_修复.pdf`, blob, meta: '已整页重绘重建' });
        }
        return out;
      }
    },
