    {
      id: 'pdf-clean-meta', name: '清除元数据', cat: 'pdf', icon: 'broom', minFiles: 1, accept: '.pdf',
      desc: '删除标题、作者等文档属性与元数据。',
      keywords: '清除元数据 删除属性 隐私 metadata 清理信息 去属性',
      options: [
        { key: 'resetId', type: 'checkbox', label: '同时重置文档 ID', def: true },
      ],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在清理 ${file.name}…`);
          const doc = await loadPdfDoc(file);
          let cleared = 0;
          try {
            const info = doc.context.trailerInfo.Info;
            const infoDict = info instanceof PDFLib.PDFDict ? info : (info ? doc.context.lookup(info, PDFLib.PDFDict) : null);
            if (infoDict) {
              const keys = infoDict.keys();
              for (const k of keys) infoDict.delete(k);
              cleared += keys.length;
            }
          } catch (e) { /* ignore */ }
          try {
            if (doc.catalog.get(PDFLib.PDFName.of('Metadata'))) {
              doc.catalog.delete(PDFLib.PDFName.of('Metadata'));
              cleared++;
            }
          } catch (e) { /* ignore */ }
          if (ctx.get('resetId')) {
            try {
              const idArr = PDFLib.PDFArray.withContext(doc.context);
              idArr.push(PDFLib.PDFHexString.of(bytesToHex(secureRandom(16))));
              idArr.push(PDFLib.PDFHexString.of(bytesToHex(secureRandom(16))));
              doc.context.trailerInfo.ID = idArr;
              cleared++;
            } catch (e) { /* ignore */ }
          }
          out.push({ name: `${baseName(file.name)}_去元数据.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: `已清除 ${cleared} 项信息` });
        }
        return out;
      }
    },
