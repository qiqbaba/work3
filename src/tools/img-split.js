    {
      id: 'img-split', name: '图片分割', cat: 'img', icon: 'grid', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按行列或尺寸切分图片，支持长图、九宫格。',
      keywords: '分割 切分 切片 九宫格 网格 split 切开',
      options: [
        { key: 'mode', type: 'select', label: '分割方式', def: 'grid', choices: [['grid', '按行列等分'], ['size', '按固定尺寸切块']] },
        { key: 'rows', type: 'number', label: '纵向等分份数', def: 2, min: 1, max: 20 },
        { key: 'cols', type: 'number', label: '横向等分份数', def: 2, min: 1, max: 20 },
        { key: 'tileW', type: 'number', label: '切块宽度 (px)', def: 1080, min: 10, max: 20000, hint: '仅「按固定尺寸」时生效' },
        { key: 'tileH', type: 'number', label: '切块高度 (px)', def: 1080, min: 10, max: 20000, hint: '仅「按固定尺寸」时生效' },
      ],
      async run(ctx) {
        const mode = ctx.get('mode') || 'grid';
        const rows = Math.max(1, Math.min(20, parseInt(ctx.get('rows'), 10) || 1));
        const cols = Math.max(1, Math.min(20, parseInt(ctx.get('cols'), 10) || 1));
        const tileW = Math.max(10, parseInt(ctx.get('tileW'), 10) || 1080);
        const tileH = Math.max(10, parseInt(ctx.get('tileH'), 10) || 1080);
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在分割 ${i + 1}/${ctx.files.length}…`);
          const cv = await imageFileToCanvas(ctx.files[i]);
          const boxes = [];
          if (mode === 'size') {
            for (let y = 0; y < cv.height; y += tileH) {
              for (let x = 0; x < cv.width; x += tileW) {
                boxes.push({ x, y, w: Math.min(tileW, cv.width - x), h: Math.min(tileH, cv.height - y) });
              }
            }
          } else {
            for (let r = 0; r < rows; r++) {
              const y = Math.round(cv.height * r / rows);
              const h = Math.round(cv.height * (r + 1) / rows) - y;
              for (let c = 0; c < cols; c++) {
                const x = Math.round(cv.width * c / cols);
                const w = Math.round(cv.width * (c + 1) / cols) - x;
                if (w > 0 && h > 0) boxes.push({ x, y, w, h, r: r + 1, c: c + 1 });
              }
            }
          }
          if (!boxes.length) throw new Error('分割份数超出画面尺寸，请调小份数或切块尺寸');
          if (boxes.length > 400) throw new Error(`本次会生成 ${boxes.length} 张图片，超过 400 张上限，请调大等分尺寸`);
          for (let idx = 0; idx < boxes.length; idx++) {
            const box = boxes[idx];
            const part = document.createElement('canvas');
            part.width = box.w;
            part.height = box.h;
            part.getContext('2d').drawImage(cv, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
            const label = box.r ? `_r${box.r}c${box.c}` : `_${String(idx + 1).padStart(2, '0')}`;
            const blob = await canvasToBlob(part, 'image/png');
            out.push({
              name: `${baseName(ctx.files[i].name)}${label}.png`,
              blob,
              meta: `${box.w} × ${box.h} px（${box.x}, ${box.y}）`,
            });
          }
        }
        ctx.progress(1, 1, `分割完成，共 ${out.length} 张`);
        return out;
      }
    },
