    {
      id: 'img-compress', name: '图片压缩', cat: 'img', icon: 'compress', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '压缩图片体积，可调质量与尺寸。',
      keywords: '图片压缩 减小 压缩 quality 尺寸 宽高',
      options: [
        { key: 'quality', type: 'number', label: '输出质量 (1-100)', def: 75, min: 10, max: 100 },
        { key: 'maxWidth', type: 'number', label: '最大宽度 (px)', def: 1920, min: 0, max: 10000, hint: '0 表示不限制宽度' },
        { key: 'maxHeight', type: 'number', label: '最大高度 (px)', def: 0, min: 0, max: 10000, hint: '0 表示不限制高度；宽高同时限制时等比缩小到两者之内' },
        { key: 'format', type: 'select', label: '输出格式', def: 'jpeg', choices: [['jpeg', 'JPG'], ['webp', 'WebP'], ['png', 'PNG']] },
        { key: 'keepExif', type: 'checkbox', label: '保留 EXIF', def: false, hint: '保留拍摄时间等元数据' },
      ],
      async run(ctx) {
        const quality = (parseInt(ctx.get('quality'), 10) || 75) / 100;
        const readLimit = (v, def) => {
          const n = parseInt(v, 10);
          return Number.isFinite(n) && n >= 0 ? n : def;
        };
        const maxWidth = readLimit(ctx.get('maxWidth'), 1920);
        const maxHeight = readLimit(ctx.get('maxHeight'), 0);
        const format = ctx.get('format');
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在压缩 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const scaleW = maxWidth > 0 ? maxWidth / cv.width : 1;
          const scaleH = maxHeight > 0 ? maxHeight / cv.height : 1;
          const scale = Math.min(1, scaleW, scaleH);
          let source = cv;
          if (scale < 1) {
            const scaled = document.createElement('canvas');
            scaled.width = Math.max(1, Math.round(cv.width * scale));
            scaled.height = Math.max(1, Math.round(cv.height * scale));
            scaled.getContext('2d').drawImage(cv, 0, 0, scaled.width, scaled.height);
            source = scaled;
          }
          // JPG 不支持透明，统一压到白底
          if (format === 'jpeg') source = flattenCanvasOnWhite(source);
          let blob = await canvasToImageBlob(source, format, quality);
          let note = '';
          // 保留 EXIF：把原始 JPEG 的 APP1 段原样搬到新文件，方向标记重置为 1
          if (ctx.get('keepExif') && format === 'jpeg') {
            try {
              const original = new Uint8Array(await ctx.files[i].arrayBuffer());
              const seg = jpegExifSegment(original);
              if (seg) {
                const merged = jpegWithExif(new Uint8Array(await blob.arrayBuffer()), resetExifOrientation(seg));
                blob = new Blob([merged], { type: 'image/jpeg' });
                note = ' · 已保留 EXIF';
              }
            } catch (e) { /* 元数据搬运失败时保持无元数据输出 */ }
          }
          const ext = format === 'jpeg' ? 'jpg' : format;
          out.push({
            name: `${baseName(ctx.files[i].name)}_压缩.${ext}`,
            blob,
            meta: `${formatBytes(ctx.files[i].size)} → ${formatBytes(blob.size)} · ${source.width} × ${source.height} px${note}`
          });
        }
        return out;
      },
      /* 按当前参数真实跑一遍首个文件，给出与正式输出一致的体积预估 */
      async estimate(ctx) {
        if (!ctx.files.length) return '选择文件后显示预计大小';
        const file = ctx.files[0];
        const results = await this.run({ files: [file], get: ctx.get, progress: () => {} });
        const blob = results && results[0] && results[0].blob;
        if (!blob || !blob.size) return '无法预估';
        const pct = file.size ? Math.round((blob.size - file.size) / file.size * 100) : 0;
        const trend = Math.abs(pct) < 1
          ? '体积基本不变'
          : (pct > 0 ? `体积增加约 ${pct}%` : `体积减少约 ${-pct}%`);
        const note = ctx.files.length > 1 ? '，按第 1 个文件估算' : '';
        return `${formatBytes(file.size)} → 约 ${formatBytes(blob.size)}（${trend}${note}）`;
      }
    },
