    {
      id: 'pdf-to-excel', name: 'PDF 转 Excel', cat: 'pdf', icon: 'grid', minFiles: 1, accept: '.pdf',
      desc: '提取 PDF 表格文字，生成 Excel。',
      keywords: '转Excel excel xlsx 表格 提取表格',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在分析 ${file.name}…`);
          const items = await pdfTextItems(file);
          const byPage = {};
          for (const it of items) (byPage[it.page] = byPage[it.page] || []).push(it);
          const sheets = Object.keys(byPage).map(pn => {
            const list = byPage[pn];
            // PDF 坐标原点在左下、y 向上增长；取负号后再聚类，得到自顶向下的行序。
            const rowYs = clusterIdx(list.map(i => -i.y), 4).map(v => -v);
            const colXs = clusterIdx(list.map(i => i.x), 8);
            const grid = rowYs.map(ry => {
              const rowItems = list.filter(i => Math.abs(i.y - ry) <= 4);
              return colXs.map(rx =>
                rowItems.filter(i => Math.abs(i.x - rx) <= 8).sort((a, b) => a.x - b.x).map(i => i.str).join(' ').trim()
              );
            });
            return { name: '第' + pn + '页', grid, colWidths: colXs.map(() => 90) };
          });
          // 无文本层（扫描件）时 sheets 为空，会生成不含任何 worksheet 的非法 xlsx。
          if (!sheets.length) throw new Error(`${file.name} 未提取到可转换的文本，扫描件请先进行文字识别`);
          out.push({ name: `${baseName(file.name)}.xlsx`, blob: await buildXlsxBlob(sheets), meta: sheets.length + ' 个工作表' });
        }
        return out;
      }
    },
