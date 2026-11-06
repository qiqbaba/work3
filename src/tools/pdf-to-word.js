    {
      id: 'pdf-to-word', name: 'PDF 转 Word', cat: 'pdf', icon: 'doc', minFiles: 1, accept: '.pdf',
      desc: '提取 PDF 文字内容生成可编辑的 Word 文档（.docx）。',
      keywords: '转Word word docx 导出word 文档转换',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const pages = await pdfPageLines(file);
          out.push({ name: `${baseName(file.name)}.docx`, blob: await buildDocxBlob(pages), meta: 'Word 文档' });
        }
        return out;
      }
    },
