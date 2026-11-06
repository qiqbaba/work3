    {
      id: 'pdf-protect', name: 'PDF 加密', cat: 'pdf', icon: 'shield', minFiles: 1, accept: '.pdf',
      desc: '为 PDF 设置打开密码。',
      keywords: '加密 protect 密码保护 设置密码 加锁',
      options: [
        { key: 'password', type: 'password', label: '打开密码', def: '', placeholder: '请输入密码', required: true, autocomplete: 'new-password', hint: '打开文档时需要输入此密码，请妥善保存' },
      ],
      async run(ctx) {
        const password = (ctx.get('password') || '').trim();
        if (!password) throw new Error('请输入打开密码');
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在加密 ${file.name}…`);
          const doc = await loadPdfDoc(file);
          pdfEncryptDoc(doc, latin1ToBytes(password));
          ctx.progress(1, 1, `加密完成 ${file.name}`);
          // 加密文档必须禁用对象流：打包对象的内层字符串不单独加密，与逐对象加密冲突
          out.push({ name: `${baseName(file.name)}_加密.pdf`, blob: bytesToBlob(await doc.save({ useObjectStreams: false }), 'application/pdf'), meta: '已设置打开密码' });
        }
        return out;
      }
    },
