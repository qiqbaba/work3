    {
      id: 'img-idphoto', name: '证件照排版', cat: 'img', icon: 'photo', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按 1 寸 / 2 寸规格排版证件照并换底色。',
      keywords: '证件照 一寸 二寸 1寸 2寸 排版 相纸 换底色 打印',
      options: [
        { key: 'size', type: 'select', label: '证件照规格', def: '1', choices: [['1', '1 寸 25×35 mm'], ['small1', '小 1 寸 22×32 mm'], ['big1', '大 1 寸 33×48 mm'], ['2', '2 寸 35×49 mm'], ['small2', '小 2 寸 35×45 mm'], ['visa', '签证方照 51×51 mm']] },
        { key: 'paper', type: 'select', label: '相纸 / 纸张', def: '6', choices: [['6', '6 寸相纸 152×102 mm'], ['a5', 'A5 148×210 mm'], ['a4', 'A4 210×297 mm']] },
        { key: 'dpi', type: 'select', label: '输出精度', def: '300', choices: [['300', '300 DPI（打印推荐）'], ['200', '200 DPI'], ['150', '150 DPI（预览）']] },
        { key: 'bg', type: 'select', label: '背景处理', def: 'keep', choices: [['keep', '保留原背景'], ['white', '换白底'], ['red', '换红底'], ['blue', '换蓝底'], ['custom', '自定义底色']], hint: '换底依赖「图片抠图（纯色背景）」，适合背景较纯净的人像' },
        { key: 'customBg', type: 'color', label: '自定义底色', def: '#438EDB' },
        { key: 'tolerance', type: 'number', label: '换底容差 (0-100)', def: 18, min: 0, max: 100 },
        { key: 'gap', type: 'number', label: '照片间距 (mm)', def: 2, min: 0, max: 20 },
        { key: 'count', type: 'number', label: '排版张数', def: 0, min: 0, max: 100, hint: '0 表示排满整张相纸' },
        { key: 'guide', type: 'checkbox', label: '裁切', def: true, hint: '绘制细灰裁切线，方便剪裁' },
      ],
      async run(ctx) {
        const spec = ID_PHOTO_SIZES[ctx.get('size')] || ID_PHOTO_SIZES['1'];
        const paper = ID_PHOTO_PAPERS[ctx.get('paper')] || ID_PHOTO_PAPERS['6'];
        const dpi = Math.max(72, parseInt(ctx.get('dpi'), 10) || 300);
        const mm = v => Math.max(1, Math.round(v / 25.4 * dpi));
        const pw = mm(spec.w), ph = mm(spec.h);
        const PW = mm(paper.w), PH = mm(paper.h);
        const gap = mm(Math.max(0, parseFloat(ctx.get('gap')) || 0));
        if (PW * PH > 40000000) throw new Error('纸张尺寸过大，请降低 DPI 或换小纸张');
        const cols = Math.max(1, Math.floor((PW + gap) / (pw + gap)));
        const rows = Math.max(1, Math.floor((PH + gap) / (ph + gap)));
        const capacity = cols * rows;
        const wanted = Math.max(0, parseInt(ctx.get('count'), 10) || 0);
        const total = wanted ? Math.min(wanted, capacity) : capacity;
        if (!total) throw new Error('当前规格无法在所选纸张上排版，请降低 DPI 或换大纸张');
        const gridW = cols * pw + (cols - 1) * gap;
        const gridH = rows * ph + (rows - 1) * gap;
        const ox = Math.round((PW - gridW) / 2);
        const oy = Math.round((PH - gridH) / 2);
        const bgMode = ctx.get('bg') || 'keep';
        const bgColors = { white: '#ffffff', red: '#d93025', blue: '#438EDB' };
        const fillColor = bgMode === 'custom' ? (ctx.get('customBg') || '#ffffff') : bgColors[bgMode];
        const guide = !!ctx.get('guide');
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在排版 ${i + 1}/${ctx.files.length}…`);
          const src = await imageFileToCanvas(ctx.files[i]);
          let prepared = src;
          let replaced = false;
          if (fillColor) {
            try {
              const cut = removeFlatBackground(src, {
                mode: 'edge', tolerance: ctx.get('tolerance'), feather: 1,
              }).canvas;
              const filled = document.createElement('canvas');
              filled.width = cut.width;
              filled.height = cut.height;
              const fc = filled.getContext('2d');
              fc.fillStyle = fillColor;
              fc.fillRect(0, 0, filled.width, filled.height);
              fc.drawImage(cut, 0, 0);
              prepared = filled;
              replaced = true;
            } catch (e) { /* 背景无法识别时保留原图 */ }
          }
          const targetRatio = pw / ph;
          let sw = prepared.width, sh = prepared.height;
          if (sw / sh > targetRatio) sw = Math.round(sh * targetRatio);
          else sh = Math.round(sw / targetRatio);
          const sx = Math.round((prepared.width - sw) / 2);
          const sy = Math.round((prepared.height - sh) / 2);
          const tile = document.createElement('canvas');
          tile.width = pw;
          tile.height = ph;
          tile.getContext('2d').drawImage(prepared, sx, sy, sw, sh, 0, 0, pw, ph);
          const sheet = document.createElement('canvas');
          sheet.width = PW;
          sheet.height = PH;
          const c = sheet.getContext('2d');
          c.fillStyle = '#ffffff';
          c.fillRect(0, 0, PW, PH);
          for (let k = 0; k < total; k++) {
            const x = ox + (k % cols) * (pw + gap);
            const y = oy + Math.floor(k / cols) * (ph + gap);
            c.drawImage(tile, x, y);
            if (guide) {
              c.strokeStyle = 'rgba(120,120,120,0.55)';
              c.lineWidth = 1;
              c.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1);
            }
          }
          const blob = await canvasToBlob(sheet, 'image/png');
          out.push({
            name: `${baseName(ctx.files[i].name)}_${spec.label}_${dpi}dpi.png`,
            blob,
            meta: `${spec.label} ${spec.w}×${spec.h} mm · ${paper.label} · ${total} 张${replaced ? '（已换底）' : ''}`,
          });
        }
        return out;
      }
    },
