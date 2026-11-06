    {
      id: 'pdf-split', name: 'PDF 拆分', cat: 'pdf', icon: 'split', minFiles: 1, single: true, accept: '.pdf',
      desc: '按页面范围、每一页或奇偶页将 PDF 拆分为多个文件。',
      keywords: '拆分 split 分割 分开',
      options: [
        { key: 'mode', type: 'select', label: '拆分方式', def: 'each', choices: [['each', '每一页生成一个 PDF'], ['ranges', '按多组范围拆分'], ['oddeven', '奇偶页分成两个 PDF']] },
        { key: 'groups', type: 'text', label: '范围分组', def: '1-3; 4-6', placeholder: '用分号分隔，如：1-3; 4-6; 7', hint: '如 1-3; 4-6', requiredWhen: { mode: 'ranges' }, visibleWhen: { mode: 'ranges' } },
      ],
      async run(ctx) {
        const file = ctx.files[0];
        const out = [];
        const src = await loadPdfDoc(file);
        const total = src.getPageCount();
        const base = baseName(file.name);
        const mode = ctx.get('mode');

        const copyRange = async (indices, name) => {
          const doc = await PDFLib.PDFDocument.create();
          const pages = await doc.copyPages(src, indices);
          pages.forEach(p => doc.addPage(p));
          out.push({ name, blob: bytesToBlob(await doc.save(), 'application/pdf') });
        };

        if (mode === 'each') {
          for (let i = 0; i < total; i++) {
            ctx.progress(i, total, `正在拆分第 ${i + 1}/${total} 页…`);
            await copyRange([i], `${base}_第${i + 1}页.pdf`);
          }
        } else if (mode === 'oddeven') {
          const odd = [], even = [];
          for (let i = 0; i < total; i++) (i % 2 === 0 ? odd : even).push(i);
          ctx.progress(1, 2, '正在提取奇数页…');
          if (odd.length) await copyRange(odd, `${base}_奇数页.pdf`);
          ctx.progress(2, 2, '正在提取偶数页…');
          if (even.length) await copyRange(even, `${base}_偶数页.pdf`);
        } else {
          const groups = parseRangeGroups(ctx.get('groups'), total);
          if (!groups.length) throw new Error('请输入有效的范围分组');
          for (let i = 0; i < groups.length; i++) {
            ctx.progress(i, groups.length, `正在拆分第 ${i + 1}/${groups.length} 组…`);
            await copyRange(groups[i].map(p => p - 1), `${base}_第${i + 1}部分.pdf`);
          }
        }
        return out;
      }
    },
