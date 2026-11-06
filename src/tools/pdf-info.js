    {
      id: 'pdf-info', name: '文档详细信息', cat: 'pdf', icon: 'info', minFiles: 1, accept: '.pdf',
      desc: '查看 PDF 信息与元数据，导出报告。',
      keywords: '信息 info 元数据 诊断 查看属性 inspect',
      options: [],
      async run(ctx) {
        const out = [];
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在分析 ${file.name}…`);
          const buf = await file.arrayBuffer();
          const head = String.fromCharCode(...new Uint8Array(buf.slice(0, 10)));
          const verMatch = head.match(/%PDF-(\d\.\d)/);
          const doc = await loadPdfDoc(file);
          const lines = [];
          lines.push(`文件名：${file.name}`);
          lines.push(`文件大小：${formatBytes(file.size)}`);
          lines.push(`PDF 版本：${verMatch ? verMatch[1] : '未知'}`);
          lines.push(`页数：${doc.getPageCount()}`);
          lines.push(`是否加密：${doc.isEncrypted ? '是' : '否'}`);
          lines.push('--- 元数据 ---');
          const meta = [
            ['标题', doc.getTitle()], ['作者', doc.getAuthor()], ['主题', doc.getSubject()],
            ['关键词', doc.getKeywords()], ['生成工具', doc.getProducer()], ['创建程序', doc.getCreator()],
            ['创建时间', doc.getCreationDate()], ['修改时间', doc.getModificationDate()],
          ];
          for (const [k, v] of meta) lines.push(`${k}：${v || '（空）'}`);
          lines.push('--- 页面尺寸（前 5 页）---');
          const show = Math.min(5, doc.getPageCount());
          for (let i = 0; i < show; i++) {
            const s = doc.getPage(i).getSize();
            const r = doc.getPage(i).getRotation().angle || 0;
            lines.push(`第 ${i + 1} 页：${s.width.toFixed(1)} × ${s.height.toFixed(1)} pt${r ? `（旋转 ${r}°）` : ''}`);
          }
          const files = listEmbeddedFiles(doc);
          lines.push('--- 附件 ---');
          lines.push(files.length ? files.map(f => `- ${f.name}（${formatBytes(f.bytes.length)}）`).join('\n') : '无内嵌附件');
          out.push({
            name: `${baseName(file.name)}_信息报告.txt`,
            blob: new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }),
            meta: `${doc.getPageCount()} 页`,
          });
        }
        return out;
      }
    },
