    {
      id: 'pdf-form-fill', name: 'PDF 表单填写', cat: 'pdf', icon: 'tag', minFiles: 1, accept: '.pdf',
      desc: '填写 PDF 表单，或导出字段清单。',
      keywords: '表单 填写 form 填表 AcroForm 字段 申请表',
      options: [
        { key: 'mode', type: 'select', label: '操作方式', def: 'fill', choices: [['fill', '按映射填写表单'], ['list', '导出字段清单']] },
        { key: 'mapping', type: 'textarea', label: '字段映射', def: '', placeholder: '每行一条：字段名=值', hint: '复选框可填 true/false' },
        { key: 'flatten', type: 'checkbox', label: '填写后扁平化（不可再编辑）', def: false },
      ],
      async run(ctx) {
        const out = [];
        const mode = ctx.get('mode') || 'fill';
        for (const file of ctx.files) {
          const doc = await loadPdfDoc(file);
          const form = doc.getForm();
          const fields = form.getFields();
          if (mode === 'list') {
            const typeName = f => {
              if (f instanceof PDFLib.PDFTextField) return '文本框';
              if (f instanceof PDFLib.PDFCheckBox) return '复选框';
              if (f instanceof PDFLib.PDFRadioGroup) return '单选组';
              if (f instanceof PDFLib.PDFDropdown) return '下拉框';
              return '按钮/其他';
            };
            const text = fields.length
              ? fields.map(f => `${f.getName()}\t${typeName(f)}`).join('\n')
              : '（该 PDF 不含交互表单字段）';
            out.push({ name: `${baseName(file.name)}_字段清单.txt`, blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), meta: `${fields.length} 个字段` });
            continue;
          }
          const lines = String(ctx.get('mapping') || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          if (!lines.length) throw new Error('请填写字段映射（每行一条：字段名=值）');
          let filled = 0;
          const missing = [];
          for (const line of lines) {
            const eq = line.indexOf('=');
            if (eq <= 0) continue;
            const name = line.slice(0, eq).trim();
            const value = line.slice(eq + 1).trim();
            let f = null;
            try { f = form.getField(name); } catch (e) { missing.push(name); continue; }
            try {
              if (f instanceof PDFLib.PDFCheckBox) {
                if (/^(true|1|y|yes|on|是)$/i.test(value)) f.check(); else f.uncheck();
              } else if (f instanceof PDFLib.PDFTextField) {
                f.setText(value);
              } else if (f instanceof PDFLib.PDFDropdown || f instanceof PDFLib.PDFRadioGroup) {
                f.select(value);
              } else {
                missing.push(name + '（类型不支持）');
                continue;
              }
              filled++;
            } catch (e) {
              missing.push(name + '（' + e.message + '）');
            }
          }
          if (!filled) throw new Error('没有成功填写任何字段：' + (missing.join('；') || '请检查映射格式'));
          if (ctx.get('flatten')) form.flatten();
          out.push({
            name: `${baseName(file.name)}_表单填写.pdf`,
            blob: bytesToBlob(await doc.save(), 'application/pdf'),
            meta: `已填写 ${filled} 项` + (missing.length ? `，${missing.length} 项未匹配` : '')
          });
        }
        return out;
      }
    },
