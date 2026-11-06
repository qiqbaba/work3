    {
      id: 'pdf-sanitize', name: '安全净化', cat: 'pdf', icon: 'broom', minFiles: 1, accept: '.pdf',
      desc: '移除脚本、动作与内嵌附件等风险内容。',
      keywords: '净化 sanitize 安全 移除javascript 消毒 清理',
      options: [
        { key: 'rmAttach', type: 'checkbox', label: '同时移除内嵌附件', def: true },
      ],
      async run(ctx) {
        const out = [];
        const rmAttach = ctx.get('rmAttach');
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const removed = [];
          if (doc.catalog.get(PDFLib.PDFName.of('OpenAction'))) { doc.catalog.delete(PDFLib.PDFName.of('OpenAction')); removed.push('自动打开动作'); }
          if (doc.catalog.get(PDFLib.PDFName.of('AA'))) { doc.catalog.delete(PDFLib.PDFName.of('AA')); removed.push('文档级附加动作'); }
          const names = safeLookup(doc.catalog, 'Names', PDFLib.PDFDict);
          if (names) {
            if (names.get(PDFLib.PDFName.of('JavaScript'))) {
              names.delete(PDFLib.PDFName.of('JavaScript'));
              removed.push('JavaScript');
            }
            if (rmAttach && names.get(PDFLib.PDFName.of('EmbeddedFiles'))) {
              names.delete(PDFLib.PDFName.of('EmbeddedFiles'));
              removed.push('内嵌附件');
            }
          }
          const total = doc.getPageCount();
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在净化第 ${i + 1}/${total} 页…`);
            const node = doc.getPage(i).node;
            if (node.get(PDFLib.PDFName.of('AA'))) {
              node.delete(PDFLib.PDFName.of('AA'));
              if (!removed.includes('页面级附加动作')) removed.push('页面级附加动作');
            }
          }
          const riskCount = stripRiskyActions(doc);
          if (riskCount) removed.push(`风险动作 ${riskCount} 处`);
          out.push({
            name: `${baseName(file.name)}_净化.pdf`,
            blob: bytesToBlob(await doc.save(), 'application/pdf'),
            meta: removed.length ? `已移除：${removed.join('、')}` : '未发现风险内容',
          });
        }
        return out;
      }
    },
