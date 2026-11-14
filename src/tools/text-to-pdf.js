    {
      id: 'text-to-pdf', name: '文本文档转 PDF', cat: 'pdf', icon: 'doc', minFiles: 1, accept: '.txt,.md,.markdown,.csv,.html,.htm',
      desc: '将 TXT / Markdown / CSV / HTML 转为 PDF。',
      keywords: 'TXT转PDF MD转PDF CSV转PDF HTML转PDF 文本转PDF 记事本 转PDF',
      options: [
        { key: 'fontSize', type: 'number', label: '正文字号 (pt)', def: 12, min: 8, max: 36 },
      ],
      async run(ctx) {
        const out = [];
        const fontSize = Math.min(36, Math.max(8, parseFloat(ctx.get('fontSize')) || 12));
        for (const file of ctx.files) {
          ctx.progress(0, 1, `正在转换 ${file.name}…`);
          const text = await file.text();
          const isCsv = /\.csv$/i.test(file.name);
          const isHtml = /\.html?$/i.test(file.name);
          const isMd = /\.(md|markdown)$/i.test(file.name);
          if (isCsv) {
            const grid = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(l => l.trim()).map(line => {
              const cells = [];
              let cur = '', inQ = false;
              for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (inQ) {
                  if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                  else if (ch === '"') inQ = false;
                  else cur += ch;
                } else if (ch === '"') inQ = true;
                else if (ch === ',') { cells.push(cur); cur = ''; }
                else cur += ch;
              }
              cells.push(cur);
              return cells;
            });
            out.push(...await renderGridToPdf(grid, `${baseName(file.name)}.pdf`));
            continue;
          }
          let paras;
          if (isHtml) {
            paras = [];
            const dom = new DOMParser().parseFromString(text, 'text/html');
            const BLOCK_CHILDREN = 'p,div,section,article,header,footer,main,aside,ul,ol,li,table,tr,td,th,blockquote,pre,h1,h2,h3,h4,h5,h6';
            const inlineBuf = [];
            const pushPara = text => {
              const t = (text || '').replace(/\s+/g, ' ').trim();
              if (t) paras.push({ text: t, size: fontSize });
            };
            const flushInline = () => {
              if (!inlineBuf.length) return;
              pushPara(inlineBuf.join(' '));
              inlineBuf.length = 0;
            };
            const walk = el => {
              for (const node of Array.from(el.childNodes || [])) {
                // body 直接包裹的裸文本也是正文，不能只遍历元素子节点。
                if (node.nodeType === 3) { if ((node.nodeValue || '').trim()) inlineBuf.push(node.nodeValue); continue; }
                if (node.nodeType !== 1) continue;
                const tag = (node.tagName || '').toLowerCase();
                if (tag === 'script' || tag === 'style' || tag === 'head') continue;
                const hasBlockChild = node.querySelector && node.querySelector(BLOCK_CHILDREN);
                if (hasBlockChild) { flushInline(); walk(node); continue; }
                const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
                if (!t) continue;
                // 内联元素（<b>/<span>/<a> 等）要和相邻裸文本拼成同一段落。
                if (!node.matches || !node.matches(BLOCK_CHILDREN)) { inlineBuf.push(t); continue; }
                flushInline();
                const h = tag.match(/^h([1-6])$/);
                if (h) { paras.push({ text: t, bold: true, size: Math.max(12, 24 - parseInt(h[1], 10) * 2) }); continue; }
                if (tag === 'li') { paras.push({ text: '• ' + t, size: fontSize }); continue; }
                pushPara(t);
              }
            };
            walk(dom.body || dom.documentElement);
            flushInline();
            if (!paras.length) paras = [{ text: text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), size: fontSize }];
          } else if (isMd) {
            paras = [];
            for (const raw of text.split(/\r?\n/)) {
              const line = raw.trimEnd();
              if (!line.trim()) { paras.push({ text: '', size: fontSize * 0.7 }); continue; }
              const h = line.match(/^(#{1,6})\s+(.*)/);
              if (h) { paras.push({ text: h[2].replace(/\*\*(.+?)\*\*/g, '$1'), bold: true, size: Math.max(12, fontSize + 10 - h[1].length * 2) }); continue; }
              const li = line.match(/^\s*[-*+]\s+(.*)/);
              if (li) { paras.push({ text: '• ' + li[1].replace(/\*\*(.+?)\*\*/g, '$1'), size: fontSize }); continue; }
              paras.push({ text: line.replace(/\*\*(.+?)\*\*/g, '$1'), size: fontSize });
            }
          } else {
            paras = text.split(/\r?\n/).map(l => ({ text: l, size: fontSize }));
          }
          out.push(...await renderParasToPdf(paras, `${baseName(file.name)}.pdf`));
        }
        return out;
      }
    },
