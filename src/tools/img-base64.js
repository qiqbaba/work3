    {
      id: 'img-base64', name: '图片与 Base64 互转', cat: 'img', icon: 'convert',
      minFiles: 0, accept: IMAGE_ACCEPT + ',.txt,.b64',
      desc: '图片与 Base64 / Data URL 互转。',
      keywords: 'base64 dataurl 编码 解码 图片转文本 内嵌图片 html css',
      options: [
        { key: 'mode', type: 'select', label: '转换方向', def: 'to', choices: [['to', '图片 → Base64 文本'], ['from', 'Base64 文本 → 图片']] },
        { key: 'paste', type: 'textarea', label: 'Base64 / Data URL 文本', def: '', visibleWhen: { mode: 'from' }, placeholder: 'data:image/png;base64,iVBORw0KGgo…', hint: '可粘贴文本或选择 .txt 文件' },
        { key: 'dataUrl', type: 'checkbox', label: '输出 Data URL 前缀', def: true, visibleWhen: { mode: 'to' }, hint: '输出可直接用于网页的 Data URL' },
        { key: 'wrap', type: 'number', label: '每行字符数', def: 0, min: 0, max: 1000, visibleWhen: { mode: 'to' }, hint: '0 表示不换行', advanced: true },
        { key: 'format', type: 'select', label: '编码前先转换格式', def: 'keep', visibleWhen: { mode: 'to' }, advanced: true, choices: [['keep', '保持原始字节（不重压缩）'], ['png', '转为 PNG'], ['jpeg', '转为 JPG']] },
      ],
      validateOptions(opts, files) {
        if ((opts.mode || 'to') === 'from') {
          const hasText = String(opts.paste || '').trim() || files.some(f => /\.(txt|b64)$/i.test(f.name));
          return hasText ? '' : '请粘贴 Base64 文本，或选择一个 .txt / .b64 文件';
        }
        return files.length ? '' : '图片 → Base64 需要至少选择一张图片';
      },
      async run(ctx) {
        const mode = ctx.get('mode') || 'to';
        if (mode === 'from') {
          let text = String(ctx.get('paste') || '').trim();
          let source = '粘贴文本';
          if (!text) {
            const f = ctx.files.find(x => /\.(txt|b64)$/i.test(x.name));
            if (!f) throw new Error('请粘贴 Base64 文本，或选择一个保存了 Base64 的 .txt / .b64 文件');
            if (f.size > 30 * 1024 * 1024) throw new Error('文本文件过大（超过 30 MB）');
            text = (await f.text()).trim();
            source = f.name;
          }
          const bytes = base64ToBytes(text);
          const mime = detectImageMime(bytes);
          if (!mime) throw new Error('解码后的数据不是可识别的图片（支持 PNG / JPG / GIF / WebP / BMP / TIFF / ICO）');
          return [{
            name: `Base64解码图片.${imageMimeToExt(mime)}`,
            blob: bytesToBlob(bytes, mime),
            meta: `来源：${source} · ${formatBytes(bytes.length)}`,
          }];
        }
        if (!ctx.files.length) throw new Error('请先选择要编码的图片文件');
        const kind = ctx.get('format') || 'keep';
        const wrap = Math.max(0, parseInt(ctx.get('wrap'), 10) || 0);
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在编码 ${i + 1}/${ctx.files.length}…`);
          const f = ctx.files[i];
          let bytes, mime;
          if (kind === 'png' || kind === 'jpeg') {
            const cv = await imageFileToCanvas(f);
            const src = kind === 'jpeg' ? flattenCanvasOnWhite(cv) : cv;
            const blob = await canvasToBlob(src, kind === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92);
            bytes = new Uint8Array(await blob.arrayBuffer());
            mime = blob.type;
          } else {
            bytes = new Uint8Array(await f.arrayBuffer());
            mime = /^image\//.test(f.type) ? f.type : (detectImageMime(bytes) || 'application/octet-stream');
          }
          let b64 = bytesToBase64(bytes);
          // 用分段切分代替替换，长度为 wrap 整数倍时不会多出一个尾随空行。
          if (wrap > 0) b64 = (b64.match(new RegExp(`.{1,${wrap}}`, 'g')) || []).join('\n');
          const text = (ctx.get('dataUrl') ? `data:${mime};base64,` : '') + b64;
          out.push({
            name: `${baseName(f.name)}_base64.txt`,
            blob: new Blob([text], { type: 'text/plain;charset=utf-8' }),
            meta: `${formatBytes(f.size)} → ${formatBytes(text.length)} 文本`,
          });
        }
        return out;
      }
    },
