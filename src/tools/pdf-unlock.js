    {
      id: 'pdf-unlock', name: 'PDF 解密', cat: 'pdf', icon: 'eraser', minFiles: 1, accept: '.pdf',
      desc: '移除打开密码与权限限制，导出无密码 PDF。',
      keywords: '解密 unlock 移除密码 去密码 解除密码 破解',
      options: [
        { key: 'password', type: 'password', label: '打开密码', def: '', placeholder: '无密码可留空', autocomplete: 'current-password', hint: '加密文档的打开密码；仅有权限限制的文档可留空' },
      ],
      async run(ctx) {
        const out = [];
        const password = ctx.get('password') || '';
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在解密 ${file.name}…`);
          const buf = await file.arrayBuffer();
          const doc = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
          const enc = pdfReadEncryptInfo(doc);
          if (!enc) throw new Error(`${file.name} 未加密，无需解锁`);
          const fileKey = pdfDeriveFileKey(password, enc);
          if (!fileKey) throw new Error(`密码错误，请检查后重试（${file.name}）`);
          enc.fileKey = fileKey;
          pdfCryptWalk(doc, enc, false);
          delete doc.context.trailerInfo.Encrypt;
          ctx.progress(1, 1, `解密完成 ${file.name}`);
          out.push({ name: `${baseName(file.name)}_已解锁.pdf`, blob: bytesToBlob(await doc.save(), 'application/pdf'), meta: '已移除密码保护' });
        }
        return out;
      }
    },
