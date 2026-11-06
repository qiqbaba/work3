    {
      id: 'img-compare', name: '图片对比', cat: 'img', icon: 'compare', minFiles: 2, maxFiles: 2, accept: IMAGE_ACCEPT,
      desc: '并排 / 叠加对比两张图片，标出差异。',
      keywords: '对比 比较 差异 并排 叠加 像素 diff compare',
      options: [
        { key: 'mode', type: 'select', label: '对比方式', def: 'side', choices: [['side', '并排对比'], ['diff', '差异高亮'], ['overlay', '半透明叠加']] },
        { key: 'tolerance', type: 'number', label: '差异容差 (0-255)', def: 12, min: 0, max: 255, hint: '数值越大，越小的颜色变化会被忽略', visibleWhen: { mode: 'diff' } },
        { key: 'labels', type: 'checkbox', label: '并排标注 A / B', def: true, visibleWhen: { mode: 'side' } },
      ],
      async run(ctx) {
        const mode = ctx.get('mode') || 'side';
        const tolerance = Math.max(0, Math.min(255, parseInt(ctx.get('tolerance'), 10) || 0));
        const a = await imageFileToCanvas(ctx.files[0]);
        const b = await imageFileToCanvas(ctx.files[1]);
        ctx.progress(0, 1, '正在生成对比图…');
        const result = compareCanvasPair(a, b, mode, tolerance, !!ctx.get('labels'));
        const blob = await canvasToBlob(result.canvas, 'image/png');
        const lines = [
          `图片 A：${ctx.files[0].name}（${a.width} × ${a.height} px）`,
          `图片 B：${ctx.files[1].name}（${b.width} × ${b.height} px）`,
          `对比方式：${{ side: '并排', diff: '差异高亮', overlay: '半透明叠加' }[mode] || mode}`,
          `差异容差：${tolerance}`,
        ];
        if (mode === 'diff') {
          const pct = result.total ? (result.changed / result.total * 100) : 0;
          lines.push(`差异像素：${result.changed} / ${result.total}（${pct.toFixed(2)}%）`);
          lines.push('红色为差异像素。');
        } else {
          lines.push('尺寸按图 A 统一。');
        }
        if (ctx.files.length > 2) lines.push(`注意：本次仅对比前 2 张图片（共导入 ${ctx.files.length} 张）。`);
        ctx.progress(1, 1, '对比完成');
        return [
          { name: '图片对比结果.png', blob, meta: `${result.canvas.width} × ${result.canvas.height} px` },
          {
            name: '图片对比报告.txt',
            blob: new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' }),
            meta: mode === 'diff' ? `差异 ${((result.changed / (result.total || 1)) * 100).toFixed(2)}%` : '并排 / 叠加报告',
          },
        ];
      }
    },
