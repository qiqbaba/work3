    {
      id: 'pdf-to-rtf', name: 'PDF 转 RTF', cat: 'pdf', icon: 'doc', minFiles: 1, accept: '.pdf',
      desc: '提取 PDF 文字生成 RTF 富文本。',
      keywords: '转RTF rtf 富文本 word打开',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const pages = await pdfPageLines(file);
          const body = pages.map(lines =>
            lines.map(l => rtfEscape(l) + '\\par ').join('')
          ).join('\\page ');
          const rtf = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 Microsoft YaHei;}}\\viewkind4\\uc1\\f0\\fs22 ' + body + '}';
          out.push({ name: `${baseName(file.name)}.rtf`, blob: new Blob([rtf], { type: 'application/rtf' }), meta: 'RTF 富文本' });
        }
        return out;
      }
    },
