    {
      id: 'pdf-compare', name: '文档对比', cat: 'pdf', icon: 'compare', minFiles: 2, maxFiles: 2, accept: '.pdf',
      desc: '比较两个 PDF 的文字差异，生成对比报告。',
      keywords: '对比 compare 差异 diff 校对 版本比较',
      options: [],
      async run(ctx) {
        if (ctx.files.length < 2) throw new Error('请选择 2 个 PDF 文件进行对比');
        const [fa, fb] = ctx.files;
        const ignored = ctx.files.length - 2;
        const notice = ignored > 0 ? `注意：共选择了 ${ctx.files.length} 个文件，仅对比前 2 个，其余 ${ignored} 个已忽略。` : '';
        ctx.progress(0, 2, '正在提取第一份文档文字…');
        const a = await extractPdfLines(fa);
        ctx.progress(1, 2, '正在提取第二份文档文字…');
        const b = await extractPdfLines(fb);
        const ops = diffLines(a, b);
        if (!ops) throw new Error('文档行数过多（>2500 行），请拆分后再对比');
        let added = 0, removed = 0;
        const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const rows = ops.map(op => {
          if (op.t === '+') { added++; return `<div class="add">＋ ${esc(op.s)}</div>`; }
          if (op.t === '-') { removed++; return `<div class="del">－ ${esc(op.s)}</div>`; }
          return `<div class="same">&nbsp;&nbsp;${esc(op.s)}</div>`;
        }).join('');
        const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>文档对比报告</title>
<style>body{font:14px/1.7 Consolas,"Microsoft YaHei",monospace;background:#f6f8fa;padding:24px;color:#24292f}
h2{font-size:18px}.summary{background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:12px 16px;margin:12px 0}
.add{background:#e6ffec;color:#116329}.del{background:#ffebe9;color:#82071e}.same{color:#57606a}
.legend span{display:inline-block;padding:2px 10px;border-radius:6px;margin-right:8px;font-size:12px}</style></head><body>
<h2>文档对比报告</h2>
<div class="summary">A：${esc(fa.name)}（${a.length} 行）<br>B：${esc(fb.name)}（${b.length} 行）${notice ? `<br>${esc(notice)}` : ''}<br>
<span class="legend"><span class="add">新增 ${added} 行</span><span class="del">删除 ${removed} 行</span></span></div>
${rows}</body></html>`;
        const summary = `文档对比摘要\n${notice ? notice + '\n' : ''}A：${fa.name}（${a.length} 行）\nB：${fb.name}（${b.length} 行）\n新增：${added} 行\n删除：${removed} 行\n`;
        return [
          { name: '文档对比报告.html', blob: new Blob([html], { type: 'text/html;charset=utf-8' }), meta: `＋${added} －${removed}` },
          { name: '文档对比摘要.txt', blob: new Blob([summary], { type: 'text/plain;charset=utf-8' }) },
        ];
      }
    },
