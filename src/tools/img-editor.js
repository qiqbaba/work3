    {
      id: 'img-editor', name: '照片编辑器', cat: 'img', icon: 'wand', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '调整亮度、对比度、滤镜与锐化等效果。',
      keywords: '编辑 修图 滤镜 亮度 对比度 饱和度 色相 锐化 暗角 调色',
      options: [
        {
          key: 'preset', type: 'select', label: '预设滤镜', def: 'none',
          choices: [
            ['none', '不使用（仅按下方参数调色）'], ['grayscale', '黑白'], ['sepia', '褐调'],
            ['vintage', '复古'], ['warm', '暖色'], ['cool', '冷色'],
            ['punch', '高对比'], ['fade', '褪色胶片'],
          ],
        },
        { key: 'brightness', type: 'number', label: '亮度 (-100 ~ 100)', def: 0, min: -100, max: 100 },
        { key: 'contrast', type: 'number', label: '对比度 (-100 ~ 100)', def: 0, min: -100, max: 100 },
        { key: 'saturation', type: 'number', label: '饱和度 (-100 ~ 100)', def: 0, min: -100, max: 100 },
        { key: 'hue', type: 'number', label: '色相偏移 (-180 ~ 180°)', def: 0, min: -180, max: 180 },
        { key: 'blur', type: 'number', label: '模糊半径 (px)', def: 0, min: 0, max: 20, step: 0.5 },
        {
          key: 'sharpen', type: 'select', label: '锐化强度', def: '0',
          choices: [['0', '不锐化'], ['45', '轻度'], ['70', '标准'], ['100', '强']],
        },
        { key: 'vignette', type: 'checkbox', label: '暗角', def: false, hint: '四周压暗，突出画面中心' },
        { key: 'format', type: 'select', label: '输出格式', def: 'jpeg', choices: [['jpeg', 'JPG'], ['png', 'PNG（保留透明）'], ['webp', 'WebP']] },
      ],
      async run(ctx) {
        const presets = {
          none: '', grayscale: 'grayscale(1)', sepia: 'sepia(0.85)',
          vintage: 'sepia(0.35) saturate(1.2) contrast(1.05)',
          warm: 'sepia(0.2) saturate(1.25) hue-rotate(-8deg)',
          cool: 'hue-rotate(12deg) saturate(1.1)',
          punch: 'contrast(1.35) saturate(1.15)',
          fade: 'contrast(0.9) brightness(1.08) saturate(0.85)',
        };
        const num = (key, def) => {
          const v = parseFloat(ctx.get(key));
          return Number.isFinite(v) ? v : def;
        };
        const brightness = 100 + num('brightness', 0);
        const contrast = 100 + num('contrast', 0);
        const saturation = 100 + num('saturation', 0);
        const hue = num('hue', 0);
        const blur = Math.max(0, num('blur', 0));
        const sharpen = Math.max(0, Math.min(100, num('sharpen', 0)));
        const vignette = !!ctx.get('vignette');
        const format = ctx.get('format') || 'jpeg';
        const filters = [
          presets[ctx.get('preset')] || '',
          `brightness(${Math.max(0, brightness)}%)`,
          `contrast(${Math.max(0, contrast)}%)`,
          `saturate(${Math.max(0, saturation)}%)`,
        ];
        if (hue) filters.push(`hue-rotate(${hue}deg)`);
        if (blur) filters.push(`blur(${blur}px)`);
        const filterStr = filters.filter(Boolean).join(' ');
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在调色 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const edited = document.createElement('canvas');
          edited.width = cv.width;
          edited.height = cv.height;
          const c = edited.getContext('2d');
          c.filter = filterStr;
          c.drawImage(cv, 0, 0);
          c.filter = 'none';
          if (sharpen > 0) sharpenCanvas(edited, sharpen);
          if (vignette) {
            const grad = c.createRadialGradient(
              edited.width / 2, edited.height / 2, Math.min(edited.width, edited.height) * 0.25,
              edited.width / 2, edited.height / 2, Math.max(edited.width, edited.height) * 0.72
            );
            grad.addColorStop(0, 'rgba(0,0,0,0)');
            grad.addColorStop(1, 'rgba(0,0,0,0.55)');
            c.fillStyle = grad;
            c.fillRect(0, 0, edited.width, edited.height);
          }
          const source = format === 'jpeg' ? flattenCanvasOnWhite(edited) : edited;
          const blob = await canvasToImageBlob(source, format, 0.92);
          out.push({
            name: `${baseName(ctx.files[i].name)}_编辑.${imageOutputExt(format)}`,
            blob,
            meta: `${edited.width} × ${edited.height} px`,
          });
        }
        return out;
      }
    },
