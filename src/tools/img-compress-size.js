    {
      id: 'img-compress-size', name: '压缩到指定大小', cat: 'img', icon: 'compress', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按目标体积（KB）自动压缩图片。',
      keywords: '指定大小 压缩 kb 体积 限制 上传 小于',
      options: [
        { key: 'target', type: 'number', label: '目标大小 (KB)', def: 200, min: 5, max: 100000 },
        { key: 'format', type: 'select', label: '输出格式', def: 'jpeg', choices: [['jpeg', 'JPG'], ['webp', 'WebP']] },
      ],
      async run(ctx) {
        const targetKB = Math.max(5, parseInt(ctx.get('target'), 10) || 200);
        const targetBytes = targetKB * 1024;
        const format = ctx.get('format') === 'webp' ? 'webp' : 'jpeg';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在压缩 ${i + 1}/${ctx.files.length} 到 ${targetKB} KB…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const source = flattenCanvasOnWhite(cv);
          const res = await compressCanvasToTarget(source, targetBytes, format);
          const parts = [
            `${formatBytes(ctx.files[i].size)} → ${formatBytes(res.blob.size)}`,
            `质量 ${res.quality}`,
          ];
          if (res.scale < 0.999) {
            parts.push(`缩放至 ${Math.round(res.scale * 100)}%（${Math.round(source.width * res.scale)} × ${Math.round(source.height * res.scale)} px）`);
          }
          if (res.missed) parts.push('已取最小体积，仍未达到目标');
          out.push({
            name: `${baseName(ctx.files[i].name)}_目标${targetKB}KB.${imageOutputExt(format)}`,
            blob: res.blob,
            meta: parts.join(' · '),
          });
        }
        return out;
      }
    },
