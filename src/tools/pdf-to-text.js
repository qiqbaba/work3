    {
      id: 'pdf-to-text', name: 'PDF 提取文字', cat: 'pdf', icon: 'text', minFiles: 1, accept: '.pdf',
      desc: '提取 PDF 文本并导出为 TXT。',
      keywords: '提取文字 文本 txt 复制 抽字',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在提取 ${file.name} 的文字…`);
          const lines = await extractPdfLines(file);
          const text = lines
            .map(l => /^--- 第 \d+ 页 ---$/.test(l) ? '' : l)
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
          ctx.progress(1, 1, `已提取 ${file.name} 的文字`);
          out.push({ name: `${baseName(file.name)}.txt`, blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) });
        }
        return out;
      }
    },
