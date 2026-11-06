    {
      id: 'img-frame', name: '图片加边框 / 圆角', cat: 'img', icon: 'image', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '为图片加留白、边框、圆角或裁成头像。',
      keywords: '边框 圆角 留白 圆形头像 相框 描边 frame',
      options: [
        { key: 'pad', type: 'number', label: '四周留白 (px)', def: 24, min: 0, max: 2000 },
        { key: 'shape', type: 'select', label: '形状', def: 'none', choices: [['none', '矩形'], ['rounded', '圆角'], ['circle', '圆形（居中裁剪）']] },
        { key: 'radius', type: 'number', label: '圆角半径 (px)', def: 24, min: 1, max: 2000 },
        { key: 'border', type: 'number', label: '描边粗细 (px)', def: 0, min: 0, max: 200, hint: '0 表示不描边' },
        { key: 'borderColor', type: 'color', label: '描边颜色', def: '#333333' },
        { key: 'bg', type: 'color', label: '留白颜色', def: '#ffffff' },
        { key: 'transparentBg', type: 'checkbox', label: '透明', def: false, hint: '留白区域透明（仅 PNG / WebP 输出有效）' },
        { key: 'format', type: 'select', label: '输出格式', def: 'png', choices: [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']] },
      ],
      async run(ctx) {
        const opts = {
          pad: Math.max(0, parseInt(ctx.get('pad'), 10) || 0),
          shape: ctx.get('shape') || 'none',
          radius: Math.max(1, parseInt(ctx.get('radius'), 10) || 24),
          border: Math.max(0, parseInt(ctx.get('border'), 10) || 0),
          borderColor: ctx.get('borderColor') || '#333333',
          bg: ctx.get('bg') || '#ffffff',
          transparent: !!ctx.get('transparentBg'),
        };
        const format = ctx.get('format') || 'png';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在排版 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const framed = framedCanvas(cv, opts);
          const source = format === 'jpeg' ? flattenCanvasOnWhite(framed) : framed;
          const blob = await canvasToImageBlob(source, format, 0.92);
          out.push({
            name: `${baseName(ctx.files[i].name)}_加框.${imageOutputExt(format)}`,
            blob,
            meta: `${cv.width} × ${cv.height} → ${framed.width} × ${framed.height} px`,
          });
        }
        return out;
      }
    },
