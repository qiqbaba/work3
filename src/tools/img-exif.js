    {
      id: 'img-exif', name: '图片 EXIF 信息', cat: 'img', icon: 'info', minFiles: 1, accept: IMAGE_ACCEPT,
      desc: '查看照片 EXIF 信息，或一键清除元数据。',
      keywords: 'exif 元数据 拍摄参数 gps 定位 清除信息 隐私',
      options: [
        { key: 'mode', type: 'select', label: '操作', def: 'report', choices: [['report', '查看 EXIF 信息'], ['strip', '清除元数据并另存']] },
        { key: 'format', type: 'select', label: '清除后的格式', def: 'jpeg', choices: [['jpeg', 'JPG'], ['png', 'PNG']], hint: '仅在「清除元数据」时生效' },
      ],
      async run(ctx) {
        const mode = ctx.get('mode') || 'report';
        const format = ctx.get('format') === 'png' ? 'png' : 'jpeg';
        const out = [];
        for (let i = 0; i < ctx.files.length; i++) {
          ctx.progress(i, ctx.files.length, `正在解析 ${i + 1}/${ctx.files.length}…`);
          const file = ctx.files[i];
          const bytes = new Uint8Array(await file.arrayBuffer());
          const entries = readExifEntries(bytes);
          let cv = null;
          try { cv = await imageFileToCanvas(file); } catch (e) { cv = null; }
          if (mode === 'strip') {
            if (!cv) throw new Error('无法解码该图片，无法清除元数据：' + file.name);
            const source = format === 'jpeg' ? flattenCanvasOnWhite(cv) : cv;
            const blob = await canvasToImageBlob(source, format, 0.92);
            out.push({
              name: `${baseName(file.name)}_已清除元数据.${imageOutputExt(format)}`,
              blob,
              meta: '已重新编码，EXIF / GPS / 设备信息全部移除',
            });
            continue;
          }
          const lines = [];
          lines.push(`文件名：${file.name}`);
          lines.push(`文件大小：${formatBytes(file.size)}`);
          lines.push(`文件类型：${file.type || '未知'}`);
          lines.push(`图像尺寸：${cv ? `${cv.width} × ${cv.height} px` : '无法解码（格式不受支持）'}`);
          lines.push(`EXIF 信息：${entries.length ? `共 ${entries.length} 项` : '未检测到（可能已被清除或非拍摄原图）'}`);
          const sections = [['ifd0', '--- 图像信息 ---'], ['exif', '--- 拍摄参数 ---'], ['gps', '--- GPS 位置 ---']];
          for (const [group, title] of sections) {
            const list = exifReportLines(entries, group);
            if (list.length) {
              lines.push(title);
              for (const line of list) lines.push(line);
            }
          }
          out.push({
            name: `${baseName(file.name)}_EXIF.txt`,
            blob: new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }),
            meta: entries.length ? `${entries.length} 项 EXIF` : '无 EXIF',
          });
        }
        return out;
      }
    },
