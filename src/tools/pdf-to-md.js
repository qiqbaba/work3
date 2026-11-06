    {
      id: 'pdf-to-md', name: 'PDF 转 Markdown', cat: 'pdf', icon: 'text', minFiles: 1, accept: '.pdf',
      desc: '提取 PDF 文字，导出 Markdown 文档。',
      keywords: '转Markdown md markdown 笔记 导出md',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const pages = await pdfStyledLines(file);
          const md = pages.map(rows => {
            const sizes = rows.map(r => r.size).sort((a, b) => a - b);
            const med = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;
            return rows.map(r => {
              const t = r.text;
              if (/^[•·▪◦]\s*/.test(t)) return '- ' + t.replace(/^[•·▪◦]\s*/, '');
              if (r.size >= med * 1.5) return '# ' + t;
              if (r.size >= med * 1.3) return '## ' + t;
              if (r.size >= med * 1.15 && t.length < 40) return '### ' + t;
              return t;
            }).join('\n\n');
          }).join('\n\n---\n\n');
          out.push({ name: `${baseName(file.name)}.md`, blob: new Blob([md], { type: 'text/markdown;charset=utf-8' }), meta: 'Markdown 文档' });
        }
        return out;
      }
    },
