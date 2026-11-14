    {
      id: 'pdf-to-csv', name: 'PDF 转 CSV', cat: 'pdf', icon: 'grid', minFiles: 1, accept: '.pdf',
      desc: '提取 PDF 表格文字，导出 CSV。',
      keywords: '转CSV csv 表格数据 提取表格 数据导出',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在分析 ${file.name}…`);
          const items = await pdfTextItems(file);
          const byPage = {};
          for (const it of items) (byPage[it.page] = byPage[it.page] || []).push(it);
          const esc = v => {
            const s = String(v == null ? '' : v);
            return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          };
          // 无文本层（扫描件）时 parts 为空，只会导出一个仅含 BOM 的空文件，
          // 与 PDF 转 Excel 一致地报错，避免用户误以为转换成功。
          if (!Object.keys(byPage).length) {
            throw new Error(`${file.name} 未提取到可转换的文本，扫描件请先进行文字识别`);
          }
          const parts = [];
          Object.keys(byPage).forEach((pn, idx) => {
            const list = byPage[pn];
            // PDF 坐标原点在左下、y 向上增长；取负号后再聚类，得到自顶向下的行序。
            const rowYs = clusterIdx(list.map(i => -i.y), 4).map(v => -v);
            const colXs = clusterIdx(list.map(i => i.x), 8);
            if (idx > 0) parts.push('');
            rowYs.forEach(ry => {
              const rowItems = list.filter(i => Math.abs(i.y - ry) <= 4);
              const row = colXs.map(rx =>
                rowItems.filter(i => Math.abs(i.x - rx) <= 8).sort((a, b) => a.x - b.x).map(i => i.str).join(' ').trim()
              );
              parts.push(row.map(esc).join(','));
            });
          });
          out.push({ name: `${baseName(file.name)}.csv`, blob: new Blob(['\ufeff' + parts.join('\r\n')], { type: 'text/csv;charset=utf-8' }), meta: 'CSV 表格' });
        }
        return out;
      }
    },
