    {
      id: 'pdf-remove-annots', name: '删除批注', cat: 'pdf', icon: 'eraser', minFiles: 1, accept: '.pdf',
      desc: '移除文档中全部批注、高亮、书签标记与注释内容。',
      keywords: '删除批注 批注 remove annotations 注释 高亮',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          let removed = 0;
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在清理第 ${i + 1}/${total} 页批注…`);
            const node = doc.getPage(i).node;
            const annots = node.lookupMaybe(PDFLib.PDFName.of('Annots'), PDFLib.PDFArray);
            if (annots && annots.size() > 0) removed += annots.size();
            node.delete(PDFLib.PDFName.of('Annots'));
          }
          let removedOutline = false;
          if (doc.catalog.get(PDFLib.PDFName.of('Outlines'))) {
            doc.catalog.delete(PDFLib.PDFName.of('Outlines'));
            removedOutline = true;
          }
          out.push({ name: `${baseName(file.name)}_去批注.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: `已移除 ${removed} 条批注${removedOutline ? '及书签' : ''}` });
        }
        return out;
      }
    },
