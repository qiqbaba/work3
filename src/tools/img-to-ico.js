    {
      id: 'img-to-ico', name: '图片转 ICO 图标', cat: 'img', icon: 'grid', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '把 Logo / 头像生成 ICO 图标。',
      keywords: 'ico 图标 favicon 网站图标 快捷方式 多尺寸',
      options: [
        {
          key: 'sizes', type: 'select', label: '尺寸组合', def: 'all',
          choices: [
            ['all', '全尺寸 16/32/48/64/128/256'], ['common', '常用 16/32/48'],
            ['logo', '16/32/64/128'], ['256', '仅 256 × 256'],
          ],
        },
        { key: 'fit', type: 'select', label: '非正方图处理', def: 'crop', choices: [['crop', '居中裁剪为正方形'], ['contain', '完整保留（透明留白）']] },
      ],
      async run(ctx) {
        const groups = {
          all: [16, 32, 48, 64, 128, 256], common: [16, 32, 48],
          logo: [16, 32, 64, 128], '256': [256],
        };
        const sizes = groups[ctx.get('sizes')] || groups.all;
        const fit = ctx.get('fit') || 'crop';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在生成图标 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const blob = await canvasToIcoBlob(cv, sizes, fit);
          out.push({
            name: `${baseName(ctx.files[i].name)}.ico`,
            blob,
            meta: `${sizes.length} 个尺寸：${sizes.join(' / ')} px`,
          });
        }
        return out;
      }
    },
