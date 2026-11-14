    {
      id: 'pdf-auto-rename', name: '自动重命名', cat: 'pdf', icon: 'tag', minFiles: 1, accept: '.pdf',
      desc: '按标题或首页文字自动重命名。',
      keywords: '重命名 rename 命名 归档 批量命名',
      options: [
        { key: 'source', type: 'select', label: '命名来源', def: 'title', choices: [['title', '文档标题属性'], ['firstline', '首页第一行文字']] },
        { key: 'prefix', type: 'text', label: '文件名前缀', def: '', placeholder: '如：合同_' },
      ],
      async run(ctx) {
        const rawPrefix = String(ctx.get('prefix') || '').trim();
        const prefix = rawPrefix ? sanitizeFileName(rawPrefix) : '';
        const source = ctx.get('source');
        const out = [];
        const used = new Set();
        for (let i = 0; i < ctx.files.length; i++) {
          const file = ctx.files[i];
          ctx.progress(i, ctx.files.length, `正在命名 ${i + 1}/${ctx.files.length}…`);
          let name = '';
          if (source === 'title') {
            const doc = await loadPdfDoc(file);
            name = doc.getTitle() || '';
          } else {
            const lines = await extractPdfLines(file);
            name = (lines.find(l => !/^---/.test(l) && l.trim()) || '').trim();
          }
          // 标题常自带扩展名（如“合同2024.pdf”），先剥掉再拼 .pdf，避免出现 .pdf.pdf。
          const derived = (name && name.trim())
            ? String(name).trim().replace(/\.(pdf|docx?|xlsx?|pptx?|txt|rtf|md|jpe?g|png|gif|bmp|tiff?)$/i, '')
            : baseName(file.name);
          let stem = sanitizeFileName(prefix + derived);
          // 多份文档标题相同，或两个文件解析出同一名称时追加序号，避免打包下载互相覆盖。
          if (used.has(stem.toLowerCase())) {
            const base = stem;
            let n = 2;
            while (used.has(`${base}_${n}`.toLowerCase())) n++;
            stem = `${base}_${n}`;
          }
          used.add(stem.toLowerCase());
          const bytes = await file.arrayBuffer();
          out.push({ name: `${stem}.pdf`, blob: bytesToBlob(bytes, 'application/pdf') });
        }
        return out;
      }
    },
