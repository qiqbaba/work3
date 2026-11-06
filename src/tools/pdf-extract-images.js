    {
      id: 'pdf-extract-images', name: '提取图片', cat: 'pdf', icon: 'photo', minFiles: 1, accept: '.pdf',
      desc: '无损导出 PDF 中内嵌的全部原始图片，打包为 ZIP。',
      keywords: '提取图片 导出图片 extract images 原图',
      options: [{ key: 'minSize', type: 'number', label: '最小尺寸 (px)', def: 80, min: 0, max: 5000 }],
      async run(ctx) {
        const minSize = parseInt(ctx.get('minSize'), 10) || 0;
        const out = [];
        for (const file of ctx.files) {
          const pdfDoc = await loadPdfjsDoc(file);
          const total = pdfDoc.numPages;
          const seen = new Set();
          let count = 0;
          for (let p = 1; p <= total; p++) {
            ctx.progress(p - 1, total, `正在扫描第 ${p}/${total} 页图片…`);
            const page = await pdfDoc.getPage(p);
            const opList = await page.getOperatorList();
            for (let i = 0; i < opList.fnArray.length; i++) {
              const fn = opList.fnArray[i];
              if (fn !== pdfjsLib.OPS.paintImageXObject &&
                  fn !== pdfjsLib.OPS.paintInlineImageXObject &&
                  fn !== pdfjsLib.OPS.paintImageMaskXObject) continue;
              const objId = opList.argsArray[i] && opList.argsArray[i][0];
              if (objId == null || seen.has(objId)) continue;
              seen.add(objId);
              let imgData = null;
              try { imgData = page.objs.get(objId); } catch (e) {
                try { imgData = await new Promise(r => page.objs.get(objId, r)); } catch (e2) { /* skip */ }
              }
              if (!imgData) continue;
              let canvas = null;
              try {
                if (imgData.bitmap) {
                  canvas = document.createElement('canvas');
                  canvas.width = imgData.bitmap.width;
                  canvas.height = imgData.bitmap.height;
                  canvas.getContext('2d').drawImage(imgData.bitmap, 0, 0);
                } else if (imgData.data && imgData.width && imgData.height) {
                  const w = imgData.width, h = imgData.height, d = imgData.data;
                  let rgba;
                  if (d.length === w * h * 4) rgba = new Uint8ClampedArray(d);
                  else if (d.length === w * h * 3) {
                    rgba = new Uint8ClampedArray(w * h * 4);
                    for (let s = 0, t = 0; s < d.length; s += 3, t += 4) {
                      rgba[t] = d[s]; rgba[t + 1] = d[s + 1]; rgba[t + 2] = d[s + 2]; rgba[t + 3] = 255;
                    }
                  } else if (d.length === w * h) {
                    rgba = new Uint8ClampedArray(w * h * 4);
                    for (let s = 0, t = 0; s < d.length; s++, t += 4) {
                      rgba[t] = rgba[t + 1] = rgba[t + 2] = d[s]; rgba[t + 3] = 255;
                    }
                  }
                  if (rgba) {
                    canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
                  }
                }
              } catch (e) { /* skip broken image */ }
              if (!canvas || canvas.width < minSize || canvas.height < minSize) continue;
              count++;
              const blob = await canvasToBlob(canvas, 'image/png');
              out.push({
                name: `${baseName(file.name)}_p${p}_img${count}.png`,
                blob,
                meta: `${canvas.width} × ${canvas.height} px`,
              });
            }
          }
          if (!count) out.push({ name: `${baseName(file.name)}_无图片.txt`, blob: new Blob(['未检测到可提取的内嵌图片。'], { type: 'text/plain' }) });
        }
        return out;
      }
    },
