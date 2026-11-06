    {
      id: 'img-crop', name: '图片裁剪', cat: 'img', icon: 'crop', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按比例、像素区域或去除白边裁剪图片。',
      keywords: '裁剪 crop 剪切 比例 方形 1:1 去白边 切边',
      options: [
        { key: 'mode', type: 'select', label: '裁剪方式', def: 'ratio', section: '裁剪范围', choices: [['ratio', '按固定比例'], ['rect', '自定义像素区域'], ['trim', '自动去除纯色边距']] },
        { key: 'ratio', type: 'select', label: '目标比例', def: '1:1', visibleWhen: { mode: 'ratio' }, choices: [['1:1', '1:1 正方形'], ['4:3', '4:3 横向'], ['3:4', '3:4 竖向'], ['16:9', '16:9 宽屏'], ['9:16', '9:16 竖屏'], ['3:2', '3:2 横向'], ['2:3', '2:3 竖向'], ['5:4', '5:4']] },
        { key: 'anchor', type: 'select', label: '裁剪位置', def: 'center', visibleWhen: { mode: 'ratio' }, choices: [['center', '居中'], ['top', '靠上'], ['bottom', '靠下'], ['left', '靠左'], ['right', '靠右'], ['top-left', '左上角'], ['top-right', '右上角'], ['bottom-left', '左下角'], ['bottom-right', '右下角']] },
        { key: 'rect', type: 'text', label: '像素区域', def: '', requiredWhen: { mode: 'rect' }, visibleWhen: { mode: 'rect' }, placeholder: '例如 100,50,800,600', hint: '格式：x,y,宽,高（px）' },
        { key: 'tolerance', type: 'number', label: '去边容差 (0-100)', def: 10, min: 0, max: 100, visibleWhen: { mode: 'trim' }, hint: '判断「与边角同色」的宽松程度' },
        { key: 'sides', type: 'select', label: '去边方向', def: 'all', visibleWhen: { mode: 'trim' }, choices: [['all', '四边'], ['vertical', '仅上下'], ['horizontal', '仅左右']] },
        { key: 'format', type: 'select', label: '输出格式', def: 'png', section: '输出', choices: [['png', 'PNG（保留透明）'], ['jpeg', 'JPG'], ['webp', 'WebP']] },
      ],
      async run(ctx) {
        const mode = ctx.get('mode') || 'ratio';
        const anchor = ctx.get('anchor') || 'center';
        const format = ctx.get('format') || 'png';
        const quality = 0.92;
        let rect = null;
        if (mode === 'rect') {
          const nums = String(ctx.get('rect') || '').split(/[,，\s]+/).map(v => parseInt(v, 10));
          if (nums.length !== 4 || nums.some(n => !Number.isFinite(n))) {
            throw new Error('自定义裁剪需要填写「x,y,宽,高」四个数字，例如 100,50,800,600');
          }
          rect = { x: nums[0], y: nums[1], w: nums[2], h: nums[3] };
          if (rect.w <= 0 || rect.h <= 0) throw new Error('裁剪区域的宽高必须大于 0');
        }
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在裁剪 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          let box;
          if (mode === 'trim') {
            box = trimCanvasBounds(cv, ctx.get('tolerance'), ctx.get('sides'));
          } else if (mode === 'rect') {
            const x = Math.max(0, Math.min(cv.width - 1, rect.x));
            const y = Math.max(0, Math.min(cv.height - 1, rect.y));
            box = {
              x, y,
              w: Math.min(rect.w, cv.width - x),
              h: Math.min(rect.h, cv.height - y),
            };
          } else {
            const parts = String(ctx.get('ratio') || '1:1').split(':').map(v => parseFloat(v) || 1);
            const ratio = parts[0] / (parts[1] || 1);
            let cw = cv.width, ch = Math.round(cv.width / ratio);
            if (ch > cv.height) { ch = cv.height; cw = Math.round(cv.height * ratio); }
            cw = Math.max(1, Math.min(cv.width, cw));
            ch = Math.max(1, Math.min(cv.height, ch));
            const dx = cv.width - cw, dy = cv.height - ch;
            const x = anchor.indexOf('left') >= 0 ? 0 : (anchor.indexOf('right') >= 0 ? dx : dx / 2);
            const y = anchor.indexOf('top') >= 0 ? 0 : (anchor.indexOf('bottom') >= 0 ? dy : dy / 2);
            box = { x: Math.round(x), y: Math.round(y), w: cw, h: ch };
          }
          const cvOut = document.createElement('canvas');
          cvOut.width = box.w;
          cvOut.height = box.h;
          cvOut.getContext('2d').drawImage(cv, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
          const source = format === 'jpeg' ? flattenCanvasOnWhite(cvOut) : cvOut;
          const blob = await canvasToImageBlob(source, format, quality);
          out.push({
            name: `${baseName(ctx.files[i].name)}_裁剪.${imageOutputExt(format)}`,
            blob,
            meta: `${cv.width} × ${cv.height} → ${box.w} × ${box.h} px`,
          });
        }
        return out;
      }
    },
