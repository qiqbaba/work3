    {
      id: 'pdf-auto-rename', name: '自动重命名', cat: 'pdf', icon: 'tag', minFiles: 1, accept: '.pdf',
      desc: '按标题或首页文字自动重命名。',
      keywords: '重命名 rename 命名 归档 批量命名',
      options: [
        { key: 'source', type: 'select', label: '命名来源', def: 'title', choices: [['title', '文档标题属性'], ['firstline', '首页第一行文字']] },
        { key: 'prefix', type: 'text', label: '文件名前缀', def: '', placeholder: '如：合同_' },
      ],
      async run(ctx) {
        const prefix = ctx.get('prefix') || '';
        const source = ctx.get('source');
        const out = [];
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
          const clean = (name && name.trim()) ? sanitizeFileName(name) : baseName(file.name);
          const bytes = await file.arrayBuffer();
          out.push({ name: `${prefix}${clean}.pdf`, blob: bytesToBlob(bytes, 'application/pdf') });
        }
        return out;
      }
    },
