    {
      id: 'img-remove-bg', name: '图片抠图（纯色背景）', cat: 'img', icon: 'eraser', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '去除纯色背景，输出透明 PNG，适合证件照。',
      keywords: '抠图 去背景 透明 去白底 remove background 去底色',
      options: [
        { key: 'mode', type: 'select', label: '取色方式', def: 'edge', choices: [['edge', '取四角背景色（推荐）'], ['color', '指定颜色']] },
        { key: 'color', type: 'color', label: '要移除的颜色', def: '#ffffff', hint: '仅在「指定颜色」时生效' },
        { key: 'tolerance', type: 'number', label: '容差 (0-100)', def: 18, min: 0, max: 100, hint: '数值越大，判定为背景的范围越宽松' },
        { key: 'feather', type: 'number', label: '边缘羽化 (px)', def: 1, min: 0, max: 5, hint: '让抠图边缘过渡自然，避免出现硬锯齿' },
      ],
      async run(ctx) {
        const mode = ctx.get('mode') || 'edge';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在抠图 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          let result;
          try {
            result = removeFlatBackground(cv, {
              mode,
              color: ctx.get('color'),
              tolerance: ctx.get('tolerance'),
              feather: ctx.get('feather'),
            });
          } catch (e) {
            throw new Error(`${ctx.files[i].name}：${e && e.message ? e.message : '抠图失败'}`);
          }
          const blob = await canvasToBlob(result.canvas, 'image/png');
          out.push({
            name: `${baseName(ctx.files[i].name)}_透明背景.png`,
            blob,
            meta: `去除 ${Math.round(result.ratio * 100)}% 像素 · ${result.canvas.width} × ${result.canvas.height} px`,
          });
        }
        return out;
      }
    },
