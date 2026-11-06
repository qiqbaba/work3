    {
      id: 'img-resize', name: '图片缩放', cat: 'img', icon: 'resize', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按百分比或宽度等比缩放图片。',
      keywords: '缩放 resize 尺寸 大小 改尺寸',
      options: [
        { key: 'mode', type: 'select', label: '缩放方式', def: 'percent', choices: [['percent', '按百分比'], ['width', '按目标宽度'], ['height', '按目标高度']] },
        { key: 'value', type: 'number', label: '数值', def: 50, min: 1, max: 10000 },
      ],
      async run(ctx) {
        const mode = ctx.get('mode');
        const value = Math.max(1, parseFloat(ctx.get('value')) || 50);
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在缩放 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          let w, h;
          if (mode === 'percent') { w = cv.width * value / 100; h = cv.height * value / 100; }
          else if (mode === 'width') { w = value; h = cv.height * (value / cv.width); }
          else { h = value; w = cv.width * (value / cv.height); }
          const scaled = document.createElement('canvas');
          scaled.width = Math.max(1, Math.round(w));
          scaled.height = Math.max(1, Math.round(h));
          scaled.getContext('2d').drawImage(cv, 0, 0, scaled.width, scaled.height);
          const blob = await canvasToBlob(scaled, 'image/png');
          out.push({ name: `${baseName(ctx.files[i].name)}_缩放.png`, blob, meta: `${scaled.width} × ${scaled.height} px` });
        }
        return out;
      }
    },
