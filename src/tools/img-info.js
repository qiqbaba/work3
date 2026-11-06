    {
      id: 'img-info', name: '图片信息清单', cat: 'img', icon: 'info', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '查看图片尺寸、格式等信息，导出清单。',
      keywords: '图片信息 属性 尺寸 清单 csv 盘点 宽高 透明度',
      options: [
        { key: 'format', type: 'select', label: '清单格式', def: 'csv', choices: [['csv', 'CSV（Excel 可直接打开）'], ['txt', 'TXT 文本表格'], ['json', 'JSON']] },
      ],
      async run(ctx) {
        const headers = ['序号', '文件名', '格式', '宽(px)', '高(px)', '宽高比', '大小(B)', '大小', '含透明', 'EXIF项数'];
        const rows = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在读取 ${i + 1}/${ctx.files.length}…`);
          const f = ctx.files[i];
          const bytes = new Uint8Array(await f.arrayBuffer());
          let w = '', h = '', ratio = '', alpha = '未知';
          try {
            const cv = await imageFileToCanvas(f);
            w = cv.width;
            h = cv.height;
            ratio = (Math.round(w / h * 1000) / 1000).toFixed(3);
            const data = cv.getContext('2d').getImageData(0, 0, w, h).data;
            const step = Math.max(1, Math.floor(Math.sqrt(w * h) / 200)) * 4;
            let transparent = false;
            for (let p = 3; p < data.length; p += step) {
              if (data[p] < 255) { transparent = true; break; }
            }
            alpha = transparent ? '是' : '否';
          } catch (e) { /* 不支持解码的格式保留空值 */ }
          let exifCount = 0;
          try { exifCount = readExifEntries(bytes).length; } catch (e) { /* ignore */ }
          rows.push([
            i + 1, f.name, imageExtOf(f.name).toUpperCase() || (f.type || '未知'),
            w || '—', h || '—', ratio || '—', f.size, formatBytes(f.size), alpha, exifCount,
          ]);
        }
        const format = ctx.get('format') || 'csv';
        let blob, ext;
        if (format === 'json') {
          const list = rows.map(r => Object.fromEntries(headers.map((k, i) => [k, r[i]])));
          blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json;charset=utf-8' });
          ext = 'json';
        } else if (format === 'txt') {
          const lines = [headers.join(' | '), ...rows.map(r => r.map(String).join(' | '))];
          blob = new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
          ext = 'txt';
        } else {
          const lines = [headers, ...rows].map(r => r.map(csvCell).join(','));
          blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
          ext = 'csv';
        }
        return [{ name: `图片信息清单.${ext}`, blob, meta: `共 ${rows.length} 张图片` }];
      }
    },
