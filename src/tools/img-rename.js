    {
      id: 'img-rename', name: '图片批量重命名', cat: 'img', icon: 'tag', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '按序号、原名、日期等模板批量重命名。',
      keywords: '重命名 批量改名 序号 前缀 归档 整理 rename',
      options: [
        { key: 'pattern', type: 'text', label: '命名模板', def: '{name}_{n}', hint: '占位符：{n} 序号、{name} 原名、{date} 日期、{w} 宽、{h} 高' },
        { key: 'start', type: 'number', label: '起始序号', def: 1, min: 0, max: 999999 },
        { key: 'digits', type: 'number', label: '序号位数（自动补零）', def: 2, min: 1, max: 8 },
        { key: 'extCase', type: 'select', label: '扩展名大小写', def: 'keep', choices: [['keep', '保持原样'], ['lower', '转小写'], ['upper', '转大写']] },
      ],
      async run(ctx) {
        const pattern = String(ctx.get('pattern') || '{name}_{n}');
        const start = Math.max(0, parseInt(ctx.get('start'), 10) || 0);
        const digits = Math.max(1, Math.min(8, parseInt(ctx.get('digits'), 10) || 2));
        const extCase = ctx.get('extCase') || 'keep';
        const now = new Date();
        const two = v => String(v).padStart(2, '0');
        const date = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`;
        const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
        const needSize = /\{w\}|\{h\}/.test(pattern);
        const seen = new Set();
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在命名 ${i + 1}/${ctx.files.length}…`);
          const f = ctx.files[i];
          let w = '', h = '';
          if (needSize) {
            try {
              const cv = await imageFileToCanvas(f);
              w = String(cv.width);
              h = String(cv.height);
            } catch (e) { /* 无法解码时留空 */ }
          }
          const rawExt = imageExtOf(f.name);
          const ext = extCase === 'lower' ? rawExt.toLowerCase() : (extCase === 'upper' ? rawExt.toUpperCase() : rawExt);
          const values = {
            n: String(start + i).padStart(digits, '0'),
            name: baseName(f.name), date, time, w, h, ext,
          };
          let stem = sanitizeFileName(pattern.replace(/\{(\w+)\}/g, (m, key) => values[key] != null ? values[key] : m)) || '图片';
          let name = ext ? `${stem}.${ext}` : stem;
          if (seen.has(name)) {
            let k = 2;
            while (seen.has(`${stem}(${k})${ext ? '.' + ext : ''}`)) k++;
            name = `${stem}(${k})${ext ? '.' + ext : ''}`;
          }
          seen.add(name);
          out.push({ name, blob: f, meta: `${f.name} → ${name}` });
        }
        return out;
      }
    },
