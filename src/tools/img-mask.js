    {
      id: 'img-mask', name: '图片打码 / 马赛克', cat: 'img', icon: 'shield', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '对指定区域打码，遮盖敏感信息。',
      keywords: '打码 马赛克 遮挡 隐私 脱敏 模糊 涂黑 mosaic',
      options: [
        { key: 'rects', type: 'textarea', label: '打码区域', def: '0,0,100%,20%', placeholder: '每行一个区域：x,y,宽,高', hint: '支持像素或百分比，如 20,10,300,40' },
        { key: 'mode', type: 'select', label: '遮盖方式', def: 'mosaic', choices: [['mosaic', '马赛克'], ['blur', '高斯模糊'], ['solid', '纯色涂黑']] },
        { key: 'block', type: 'number', label: '马赛克块大小 (px)', def: 12, min: 2, max: 200, visibleWhen: { mode: 'mosaic' } },
        { key: 'blur', type: 'number', label: '模糊半径 (px)', def: 8, min: 1, max: 60, visibleWhen: { mode: 'blur' } },
        { key: 'color', type: 'color', label: '遮盖颜色', def: '#000000', visibleWhen: { mode: 'solid' } },
      ],
      async run(ctx) {
        const mode = ctx.get('mode') || 'mosaic';
        const opts = {
          mode,
          block: Math.max(2, parseInt(ctx.get('block'), 10) || 12),
          blur: Math.max(1, parseInt(ctx.get('blur'), 10) || 8),
          color: ctx.get('color') || '#000000',
        };
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在打码 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          let rects;
          try {
            rects = parseRectList(ctx.get('rects'), cv.width, cv.height);
          } catch (e) {
            throw new Error(`${ctx.files[i].name}：${e && e.message ? e.message : '区域格式错误'}`);
          }
          applyMosaicRegions(cv, rects, opts);
          const blob = await canvasToBlob(cv, 'image/png');
          out.push({
            name: `${baseName(ctx.files[i].name)}_打码.png`,
            blob,
            meta: `${rects.length} 个区域 · ${cv.width} × ${cv.height} px`,
          });
        }
        return out;
      }
    },
