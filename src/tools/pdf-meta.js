    {
      id: 'pdf-meta', name: '文档信息修改', cat: 'pdf', icon: 'info', minFiles: 1, accept: '.pdf',
      desc: '查看并修改 PDF 的标题、作者、主题等文档属性。',
      keywords: '属性 元数据 标题 作者 meta',
      options: [
        { key: 'title', type: 'text', label: '标题', def: '', placeholder: '留空保持不变' },
        { key: 'author', type: 'text', label: '作者', def: '', placeholder: '留空保持不变' },
        { key: 'subject', type: 'text', label: '主题', def: '', placeholder: '留空保持不变' },
        { key: 'keywords', type: 'text', label: '关键词', def: '', placeholder: '逗号分隔' },
      ],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const title = ctx.get('title'), author = ctx.get('author');
          const subject = ctx.get('subject'), keywords = ctx.get('keywords');
          if (title) doc.setTitle(title);
          if (author) doc.setAuthor(author);
          if (subject) doc.setSubject(subject);
          if (keywords) doc.setKeywords(keywords.split(/[,，]/).map(s => s.trim()).filter(Boolean));
          doc.setModificationDate(new Date());
          out.push({ name: `${baseName(file.name)}_信息修改.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        }
        return out;
      }
    },

    /* ---------- 图片工具 ---------- */
