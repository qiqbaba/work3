    {
      id: 'pdf-attachments', name: '附件管理', cat: 'pdf', icon: 'doc', minFiles: 1, accept: '*',
      desc: '提取、删除或添加 PDF 内嵌附件。',
      keywords: '附件 attachment 提取附件 内嵌文件 封装',
      options: [
        { key: 'mode', type: 'select', label: '操作方式', def: 'extract', choices: [['extract', '提取全部附件'], ['remove', '删除全部附件'], ['add', '添加附件（第 1 个是 PDF，其余为附件）']] },
      ],
      validateOptions(opts, files) {
        const mode = opts.mode || 'extract';
        if (!files.some(f => /\.pdf$/i.test(f.name))) return '请至少选择一个 PDF 文件';
        if (mode === 'add') {
          if (!/\.pdf$/i.test((files[0] && files[0].name) || '')) return '添加附件时，请把 PDF 文件放在列表第 1 个';
          if (files.length < 2) return '请再选择至少一个要嵌入的附件文件';
        }
        return '';
      },
      async run(ctx) {
        const mode = ctx.get('mode');
        const out = [];
        if (mode === 'add') {
          const pdfFile = ctx.files[0];
          const attachFiles = ctx.files.slice(1);
          if (!pdfFile || !/\.pdf$/i.test(pdfFile.name)) throw new Error('请把 PDF 文件放在第 1 个，其余文件作为附件');
          if (!attachFiles.length) throw new Error('请再选择要嵌入的附件文件');
          const doc = await loadPdfDoc(pdfFile);
          for (let i = 0; i < attachFiles.length; i++) {
            ctx.progress(i, attachFiles.length, `正在嵌入附件 ${i + 1}/${attachFiles.length}…`);
            const bytes = await attachFiles[i].arrayBuffer();
            await doc.attach(bytes, attachFiles[i].name, { mimeType: attachFiles[i].type || 'application/octet-stream' });
          }
          out.push({ name: `${baseName(pdfFile.name)}_带附件.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: `已嵌入 ${attachFiles.length} 个附件` });
          return out;
        }
        // 多个 PDF 可能内嵌同名附件（如都叫“报价单.xlsx”），必须带来源并去重，
        // 否则结果列表打包下载时会互相覆盖、静默丢文件。
        const usedNames = new Set();
        const uniqueName = (stem, ext) => {
          let name = `${stem}${ext}`;
          let n = 2;
          while (usedNames.has(name.toLowerCase())) name = `${stem}_${n++}${ext}`;
          usedNames.add(name.toLowerCase());
          return name;
        };
        for (const file of ctx.files) {
          if (!/\.pdf$/i.test(file.name)) continue;
          const doc = await loadPdfDoc(file);
          if (mode === 'extract') {
            const files = listEmbeddedFiles(doc);
            if (!files.length) {
              out.push({ name: `${baseName(file.name)}_无附件.txt`, blob: new Blob(['该 PDF 无内嵌附件。'], { type: 'text/plain' }) });
            } else {
              for (const att of files) {
                const rawName = String(att.name || '附件');
                const dot = rawName.lastIndexOf('.');
                const ext = dot > 0 ? rawName.slice(dot) : '';
                const stem = sanitizeFileName(`${baseName(file.name)}_${dot > 0 ? rawName.slice(0, dot) : rawName}`);
                out.push({
                  name: uniqueName(stem, ext),
                  blob: bytesToBlob(att.bytes, 'application/octet-stream'),
                  meta: formatBytes(att.bytes.length),
                });
              }
            }
          } else {
            ctx.progress(0, 1, `正在删除 ${file.name} 的附件…`);
            const names = safeLookup(doc.catalog, 'Names', PDFLib.PDFDict);
            if (names && names.get(PDFLib.PDFName.of('EmbeddedFiles'))) {
              names.delete(PDFLib.PDFName.of('EmbeddedFiles'));
              out.push({ name: `${baseName(file.name)}_去附件.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: '附件已删除' });
            } else {
              out.push({ name: `${baseName(file.name)}_无附件.txt`, blob: new Blob(['该 PDF 无内嵌附件。'], { type: 'text/plain' }) });
            }
          }
        }
        return out;
      }
    },

    /* ---------- 加密解密与格式转换（借鉴 pdf.io） ---------- */
