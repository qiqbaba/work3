    {
      id: 'pdf-del-images', name: '删除图片', cat: 'pdf', icon: 'trash', minFiles: 1, accept: '.pdf',
      desc: '删除 PDF 页面中的内嵌图片。',
      keywords: '删除图片 移除图片 去图 清除图片 del-images',
      options: [
        { key: 'range', type: 'text', label: '页面范围', def: '', placeholder: '留空为全部页面' },
      ],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const total = doc.getPageCount();
          const pages = parsePageRanges(ctx.get('range'), total);
          let removed = 0;
          // 用一张 1×1 全透明图片替换被删除的 XObject，而不是直接删掉资源键：
          // 页面内容流里仍有 /ImN Do 指令，直接删除会留下悬空引用，部分阅读器会报错。
          let blankRef = null;
          const getBlankRef = async () => {
            if (blankRef) return blankRef;
            const cv = document.createElement('canvas');
            cv.width = 1; cv.height = 1;
            cv.getContext('2d').clearRect(0, 0, 1, 1);
            const blob = await canvasToBlob(cv, 'image/png');
            blankRef = blob ? (await doc.embedPng(await blob.arrayBuffer())).ref : null;
            return blankRef;
          };
          const getPageXObject = page => {
            let res = null;
            try { res = page.node.Resources(); } catch (e) { res = null; }
            if (!res && typeof page.node.InheritableResources === 'function') {
              try { res = page.node.InheritableResources(); } catch (e) { /* ignore */ }
            }
            return res ? safeLookup(res, 'XObject', PDFLib.PDFDict) : null;
          };
          const seenDicts = new Set();
          const orphanRefs = new Map();
          for (const pn of pages) {
            ctx.progress(pn - 1, total, `正在处理 ${file.name} 第 ${pn} 页…`);
            const xobj = getPageXObject(doc.getPage(pn - 1));
            if (!xobj || seenDicts.has(xobj)) continue;
            seenDicts.add(xobj);
            const keys = xobj.keys();
            for (const key of keys) {
              let sub = '', st = null;
              try {
                st = xobj.get(key);
                // XObject 字典的值通常是间接引用（PDFRef），必须先解析成流对象
                // 才能读取 /Subtype；否则会漏掉所有图片。
                const obj = st && st.dict instanceof PDFLib.PDFDict ? st : doc.context.lookup(st);
                const dict = obj && obj.dict instanceof PDFLib.PDFDict ? obj.dict
                  : (obj instanceof PDFLib.PDFDict ? obj : null);
                if (dict) {
                  const s = dict.get(PDFLib.PDFName.of('Subtype'));
                  sub = s ? String(s).replace(/^\//, '') : '';
                }
              } catch (e) { /* ignore */ }
              if (sub !== 'Image') continue;
              const blank = await getBlankRef();
              if (blank) xobj.set(key, blank);
              else xobj.delete(key);
              if (st instanceof PDFLib.PDFRef) orphanRefs.set(String(st), st);
              removed++;
            }
          }
          // 真正移除不再被任何页面引用的原始图片对象，否则图片数据仍留在文件里，体积不减。
          if (orphanRefs.size) {
            const stillUsed = new Set();
            for (let i = 0; i < total; i++) {
              const xobj = getPageXObject(doc.getPage(i));
              if (!xobj) continue;
              for (const key of xobj.keys()) {
                const v = xobj.get(key);
                if (v instanceof PDFLib.PDFRef) stillUsed.add(String(v));
              }
            }
            for (const [key, ref] of orphanRefs) {
              if (stillUsed.has(key)) continue;
              try { doc.context.delete(ref); } catch (e) { /* ignore */ }
            }
          }
          out.push({
            name: `${baseName(file.name)}_删图.pdf`,
            blob: bytesToBlob(await doc.save(), 'application/pdf'),
            meta: `已删除 ${removed} 张图片`
          });
        }
        return out;
      }
    },
