    {
      id: 'img-rotate', name: '图片旋转 / 翻转', cat: 'img', icon: 'flip', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '旋转或翻转图片。',
      keywords: '旋转 翻转 rotate flip 转方向',
      options: [
        { key: 'angle', type: 'select', label: '旋转角度', def: '90', choices: [['0', '不旋转'], ['90', '顺时针 90°'], ['180', '180°'], ['270', '逆时针 90°']] },
        { key: 'flipH', type: 'checkbox', label: '水平翻转', def: false },
        { key: 'flipV', type: 'checkbox', label: '垂直翻转', def: false },
      ],
      async run(ctx) {
        const angle = parseInt(ctx.get('angle'), 10) || 0;
        const flipH = ctx.get('flipH'), flipV = ctx.get('flipV');
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在处理 ${i + 1}/${ctx.files.length}…`);
          const src = await imageFileToCanvas(ctx.files[i]);
          const swap = angle === 90 || angle === 270;
          const cv = document.createElement('canvas');
          cv.width = swap ? src.height : src.width;
          cv.height = swap ? src.width : src.height;
          const c = cv.getContext('2d');
          c.translate(cv.width / 2, cv.height / 2);
          // 先翻转后旋转：canvas 后调用的变换先作用于绘制坐标，
          // 若先 rotate 再 scale，翻转轴会跟着图片一起转，90°/270° 时水平翻转会变成垂直翻转。
          c.scale(flipH ? -1 : 1, flipV ? -1 : 1);
          c.rotate(angle * Math.PI / 180);
          c.drawImage(src, -src.width / 2, -src.height / 2);
          const blob = await canvasToBlob(cv, 'image/png');
          out.push({ name: `${baseName(ctx.files[i].name)}_旋转.png`, blob });
        }
        return out;
      }
    },
