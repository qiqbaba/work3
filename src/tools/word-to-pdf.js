    {
      id: 'word-to-pdf', name: 'Word 转 PDF', cat: 'pdf', icon: 'img2pdf', minFiles: 1, accept: '.docx',
      desc: '将 Word 文档转换为 PDF。',
      keywords: 'Word转PDF docx转PDF 文档转PDF',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          if (!/\.docx$/i.test(file.name)) throw new Error('仅支持 .docx 格式（旧版 .doc 请先另存为 .docx）');
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const paras = await parseDocxFile(file);
          out.push(...await renderParasToPdf(paras, `${baseName(file.name)}.pdf`));
        }
        return out;
      }
    },
