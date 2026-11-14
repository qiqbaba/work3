  /* ============================================================
     3b. 图片编解码：常见格式统一入口
     - 输入：浏览器原生可解码的格式直接解码；TIFF / ICO 用内置解码器兜底，
             HEIC / PSD 等无法解码的格式给出明确提示
     - 输出：PNG / JPG / WebP / AVIF（浏览器支持时）/ BMP / TIFF
     ============================================================ */

  /* 图片工具统一接受的文件扩展名：accept 属性与拖拽校验共用 */
  const IMAGE_EXTS = [
    'jpg', 'jpeg', 'jpe', 'jfif', 'png', 'apng', 'webp', 'gif', 'bmp', 'dib',
    'tif', 'tiff', 'svg', 'ico', 'cur', 'avif', 'heic', 'heif'
  ];
  const IMAGE_ACCEPT = ['image/*'].concat(IMAGE_EXTS.map(ext => '.' + ext)).join(',');
  const IMAGE_FORMAT_LABEL = 'JPG / PNG / WebP / GIF / BMP / TIFF / SVG / ICO / AVIF';

  function imageExtOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function isImageFileName(name) {
    return IMAGE_EXTS.indexOf(imageExtOf(name)) >= 0;
  }

  function canvasFromDrawable(src, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(src, 0, 0, w, h);
    return canvas;
  }

  /* 浏览器原生解码（含 EXIF 方向）：失败时由调用方回退到内置解码器 */
  function imageBlobToCanvas(blob) {
    return new Promise((resolve, reject) => {
      const url = trackUrl(URL.createObjectURL(blob));
      const el = new Image();
      el.onload = () => {
        try {
          const w = el.naturalWidth || el.width;
          const h = el.naturalHeight || el.height;
          if (!w || !h) throw new Error('图片尺寸为空');
          resolve(canvasFromDrawable(el, w, h));
        } catch (e) {
          reject(e);
        } finally {
          revokeUrl(url);
        }
      };
      el.onerror = () => {
        revokeUrl(url);
        reject(new Error('图片解码失败'));
      };
      el.src = url;
    });
  }

  /* 通过文件头识别浏览器普遍无法解码的格式 */
  function sniffImageKind(bytes) {
    const b = bytes;
    if (!b || b.length < 4) return '';
    if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) return 'tiff';
    if (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a) return 'tiff';
    if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02) && b[3] === 0x00) return 'ico';
    if (b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53) return 'psd';
    if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
      if (/^(hei[cxms]|hevc|hevx|mif1|msf1)$/.test(brand)) return 'heic';
    }
    return '';
  }

  async function imageFileToCanvas(file) {
    try {
      return await imageBlobToCanvas(file);
    } catch (nativeErr) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = sniffImageKind(bytes);
      if (kind === 'tiff') {
        try {
          return await tiffToCanvas(bytes);
        } catch (e) {
          throw new Error('TIFF 解码失败：' + (e && e.message ? e.message : '文件可能已损坏') + '（' + file.name + '）');
        }
      }
      if (kind === 'ico') {
        try {
          return await icoToCanvas(bytes);
        } catch (e) {
          throw new Error('ICO 解码失败：' + (e && e.message ? e.message : '文件可能已损坏') + '（' + file.name + '）');
        }
      }
      if (kind === 'heic') throw new Error('浏览器无法解码 HEIC / HEIF，请先在系统相册中导出为 JPG 再处理：' + file.name);
      if (kind === 'psd') throw new Error('暂不支持 PSD，请先导出为 PNG / JPG：' + file.name);
      throw new Error('图片加载失败，格式可能不受支持：' + file.name);
    }
  }

  function createByteSink(initial) {
    let buf = new Uint8Array(Math.max(256, initial || 1024));
    let len = 0;
    return {
      push(byte) {
        if (len === buf.length) {
          const next = new Uint8Array(buf.length * 2);
          next.set(buf);
          buf = next;
        }
        buf[len++] = byte;
      },
      bytes() { return buf.subarray(0, len); }
    };
  }

  /* ---- PackBits 解压（TIFF 压缩方式 32773） ---- */
  function packBitsDecompress(data) {
    const sink = createByteSink(data.length * 2);
    for (let i = 0; i < data.length;) {
      const n = data[i++];
      if (n < 128) {
        const end = Math.min(data.length, i + n + 1);
        while (i < end) sink.push(data[i++]);
      } else if (n > 128) {
        if (i >= data.length) break;
        const val = data[i++];
        for (let k = 0; k < 257 - n; k++) sink.push(val);
      }
    }
    return sink.bytes();
  }

  /* ---- LZW 解压（TIFF 压缩方式 5，MSB 优先、提前一位换宽） ---- */
  function lzwDecompress(data) {
    const sink = createByteSink(data.length * 4);
    let dict = [];
    let codeLen = 9;
    let bitPos = 0;
    const totalBits = data.length * 8;
    const readCode = () => {
      if (bitPos + codeLen > totalBits) return -1;
      let code = 0;
      for (let i = 0; i < codeLen; i++) {
        code = (code << 1) | ((data[bitPos >> 3] >> (7 - (bitPos & 7))) & 1);
        bitPos++;
      }
      return code;
    };
    const resetDict = () => {
      dict = new Array(258);
      for (let i = 0; i < 256; i++) dict[i] = [i];
      codeLen = 9;
    };
    resetDict();
    let prev = null;
    while (bitPos < totalBits) {
      const code = readCode();
      if (code < 0 || code === 257) break;
      if (code === 256) { resetDict(); prev = null; continue; }
      let entry = dict[code];
      if (!entry) {
        if (!prev) throw new Error('LZW 数据损坏');
        entry = prev.concat(prev[0]);
      }
      for (let i = 0; i < entry.length; i++) sink.push(entry[i]);
      if (prev && dict.length < 4096) dict.push(prev.concat(entry[0]));
      prev = entry;
      if (codeLen < 12 && dict.length === (1 << codeLen) - 1) codeLen++;
    }
    return sink.bytes();
  }

  async function tiffDecompress(data, compression) {
    if (compression === 1) return data;
    if (compression === 32773) return packBitsDecompress(data);
    if (compression === 5) return lzwDecompress(data);
    if (compression === 8 || compression === 32946) {
      if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解压 Deflate 压缩的 TIFF');
      try {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) {
        throw new Error('Deflate 像素数据解压失败');
      }
    }
    if (compression === 2 || compression === 3 || compression === 4) {
      throw new Error('暂不支持传真压缩（CCITT G3 / G4）的 TIFF，请先转为 PDF 或 PNG');
    }
    throw new Error('暂不支持该 TIFF 压缩方式（' + compression + '）');
  }

  const TIFF_TYPE_BYTES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  function tiffFirst(arr, def) {
    return arr && arr.length ? arr[0] : def;
  }

  /* 解析 TIFF 结构（经典 32 位 TIFF，支持条带与分块存储） */
  function tiffParse(bytes) {
    if (bytes.length < 8) throw new Error('文件不完整');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const le = bytes[0] === 0x49 && bytes[1] === 0x49;
    if (!le && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) throw new Error('不是有效的 TIFF 文件');
    const u16 = o => dv.getUint16(o, le);
    const u32 = o => dv.getUint32(o, le);
    const magic = u16(2);
    if (magic === 43) throw new Error('暂不支持 BigTIFF，请另存为普通 TIFF');
    if (magic !== 42) throw new Error('不是有效的 TIFF 文件');
    const ifdOffset = u32(4);
    if (ifdOffset + 2 > bytes.length) throw new Error('文件结构不完整');
    const tags = {};
    const count = u16(ifdOffset);
    for (let i = 0; i < count; i++) {
      const e = ifdOffset + 2 + i * 12;
      if (e + 12 > bytes.length) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const n = u32(e + 4);
      const unit = TIFF_TYPE_BYTES[type] || 1;
      const size = unit * n;
      const offset = size <= 4 ? e + 8 : u32(e + 8);
      if (offset < 0 || offset + size > bytes.length) continue;
      tags[tag] = { type, count: n, offset, unit };
    }
    const values = (tag) => {
      const t = tags[tag];
      if (!t) return null;
      const out = new Array(t.count);
      for (let i = 0; i < t.count; i++) {
        const o = t.offset + i * t.unit;
        if (t.type === 3) out[i] = dv.getUint16(o, le);
        else if (t.type === 4) out[i] = dv.getUint32(o, le);
        else if (t.type === 1 || t.type === 7) out[i] = dv.getUint8(o);
        else if (t.type === 6) out[i] = dv.getInt8(o);
        else if (t.type === 8) out[i] = dv.getInt16(o, le);
        else if (t.type === 9) out[i] = dv.getInt32(o, le);
        else if (t.type === 5) out[i] = dv.getUint32(o, le) / (dv.getUint32(o + 4, le) || 1);
        else if (t.type === 10) out[i] = dv.getInt32(o, le) / (dv.getInt32(o + 4, le) || 1);
        else if (t.type === 11) out[i] = dv.getFloat32(o, le);
        else if (t.type === 12) out[i] = dv.getFloat64(o, le);
        else out[i] = 0;
      }
      return out;
    };

    const width = tiffFirst(values(256), 0);
    const height = tiffFirst(values(257), 0);
    if (!width || !height) throw new Error('缺少图片尺寸信息');
    const bitsArr = values(258) || [1];
    const samples = tiffFirst(values(277), 0) || bitsArr.length;
    const bits = bitsArr.length === 1 && samples > 1 ? new Array(samples).fill(bitsArr[0]) : bitsArr;
    const compression = tiffFirst(values(259), 1);
    const photo = tiffFirst(values(262), samples >= 3 ? 2 : 1);
    const predictor = tiffFirst(values(317), 1);
    const planar = tiffFirst(values(284), 1);
    const orientation = tiffFirst(values(274), 1);
    const colorMap = values(320);

    const chunks = [];
    if (tags[324] && tags[325]) {
      const tw = tiffFirst(values(322), 0) || width;
      const th = tiffFirst(values(323), 0) || height;
      const offs = values(324) || [];
      const sizes = values(325) || [];
      const across = Math.max(1, Math.ceil(width / tw));
      for (let i = 0; i < offs.length; i++) {
        const x = (i % across) * tw;
        const y = Math.floor(i / across) * th;
        if (y >= height) break;
        // 分块 TIFF 的每个 tile 在文件里都是完整的 tw×th（边缘用填充像素补齐），
        // 因此行跨距恒为 tw，不能用裁剪后的 chunk.w，否则右/下边缘块会整体错位。
        chunks.push({ x, y, w: Math.min(tw, width - x), h: Math.min(th, height - y), stride: tw, offset: offs[i], byteCount: sizes[i] || 0 });
      }
    } else {
      const offs = values(273) || [];
      const sizes = values(279) || [];
      const rowsPerStrip = tiffFirst(values(278), 0) || height;
      for (let i = 0; i < offs.length; i++) {
        const y = i * rowsPerStrip;
        if (y >= height) break;
        const next = i + 1 < offs.length ? offs[i + 1] : bytes.length;
        chunks.push({
          x: 0, y, w: width, h: Math.min(rowsPerStrip, height - y),
          stride: width, offset: offs[i], byteCount: sizes[i] || Math.max(0, next - offs[i])
        });
      }
    }
    if (!chunks.length) throw new Error('缺少像素数据');

    return { width, height, samples, bits, compression, photo, predictor, planar, orientation, colorMap, le, chunks };
  }

  /* 水平差分预测（Predictor = 2）还原 */
  function tiffUndoPredictor(raw, rowSamples, samples, bps, le) {
    if (bps === 8) {
      for (let base = 0; base + rowSamples <= raw.length; base += rowSamples) {
        for (let i = samples; i < rowSamples; i++) raw[base + i] = (raw[base + i] + raw[base + i - samples]) & 0xFF;
      }
      return;
    }
    if (bps === 16) {
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const rowBytes = rowSamples * 2;
      for (let base = 0; base + rowBytes <= raw.length; base += rowBytes) {
        for (let i = samples; i < rowSamples; i++) {
          const o = base + i * 2;
          dv.setUint16(o, (dv.getUint16(o, le) + dv.getUint16(o - samples * 2, le)) & 0xFFFF, le);
        }
      }
      return;
    }
    throw new Error('暂不支持 ' + bps + ' 位色深的水平差分预测');
  }

  async function tiffPixels(info, bytes) {
    const bps = info.bits[0];
    if (info.planar === 2) throw new Error('暂不支持分通道（Planar）存储的 TIFF');
    if (info.photo === 6) throw new Error('暂不支持 YCbCr 色彩空间的 TIFF，请先转为 JPG / PNG');
    if ([1, 2, 4, 8, 16].indexOf(bps) < 0) throw new Error('暂不支持 ' + bps + ' 位色深的 TIFF');
    if (info.photo === 3 && !info.colorMap) throw new Error('调色板数据缺失');

    const to8 = bps === 16 ? (v => v >> 8) : bps === 8 ? (v => v) : (v => Math.round(v * 255 / ((1 << bps) - 1)));
    const maxSample = (1 << bps) - 1;
    let read;
    if (bps === 8) read = (raw, i) => raw[i] || 0;
    else if (bps === 16) read = info.le
      ? (raw, i) => (raw[i * 2] || 0) | ((raw[i * 2 + 1] || 0) << 8)
      : (raw, i) => ((raw[i * 2] || 0) << 8) | (raw[i * 2 + 1] || 0);
    else read = (raw, i) => {
      const bit = i * bps;
      const byte = raw[bit >> 3] || 0;
      return (byte >> (8 - bps - (bit & 7))) & maxSample;
    };

    const colorMap = info.colorMap;
    const paletteSize = colorMap ? Math.floor(colorMap.length / 3) : 0;
    const rgba = new Uint8ClampedArray(info.width * info.height * 4);

    for (const chunk of info.chunks) {
      if (chunk.offset < 0 || chunk.offset + chunk.byteCount > bytes.length || chunk.byteCount <= 0) {
        throw new Error('像素数据超出文件末尾');
      }
      let raw = bytes.subarray(chunk.offset, chunk.offset + chunk.byteCount);
      raw = await tiffDecompress(raw, info.compression);
      const rowSamples = (chunk.stride || chunk.w) * info.samples;
      if (info.predictor === 2) tiffUndoPredictor(raw, rowSamples, info.samples, bps, info.le);
      const samples = info.samples;
      for (let y = 0; y < chunk.h; y++) {
        const base = y * rowSamples;
        let di = ((chunk.y + y) * info.width + chunk.x) * 4;
        for (let x = 0; x < chunk.w; x++) {
          const si = base + x * samples;
          if (info.photo === 2) {
            rgba[di] = to8(read(raw, si));
            rgba[di + 1] = to8(read(raw, si + 1));
            rgba[di + 2] = to8(read(raw, si + 2));
            rgba[di + 3] = samples > 3 ? to8(read(raw, si + 3)) : 255;
          } else if (info.photo === 3) {
            const idx = Math.min(read(raw, si), Math.max(0, paletteSize - 1));
            rgba[di] = colorMap[idx] >> 8;
            rgba[di + 1] = colorMap[paletteSize + idx] >> 8;
            rgba[di + 2] = colorMap[paletteSize * 2 + idx] >> 8;
            rgba[di + 3] = 255;
          } else if (info.photo === 5) {
            const c = to8(read(raw, si));
            const m = to8(read(raw, si + 1));
            const yv = to8(read(raw, si + 2));
            const k = samples > 3 ? to8(read(raw, si + 3)) : 0;
            rgba[di] = Math.round((255 - c) * (255 - k) / 255);
            rgba[di + 1] = Math.round((255 - m) * (255 - k) / 255);
            rgba[di + 2] = Math.round((255 - yv) * (255 - k) / 255);
            rgba[di + 3] = 255;
          } else {
            const v = to8(read(raw, si));
            const gray = info.photo === 0 ? 255 - v : v;
            rgba[di] = gray;
            rgba[di + 1] = gray;
            rgba[di + 2] = gray;
            rgba[di + 3] = samples > 1 ? to8(read(raw, si + 1)) : 255;
          }
          di += 4;
        }
      }
    }
    return rgba;
  }

  /* 应用 TIFF / EXIF 方向（1-8） */
  function applyImageOrientation(canvas, orientation) {
    const o = orientation | 0;
    if (o <= 1 || o > 8) return canvas;
    const w = canvas.width, h = canvas.height;
    const swap = o >= 5;
    const out = document.createElement('canvas');
    out.width = swap ? h : w;
    out.height = swap ? w : h;
    const ctx = out.getContext('2d');
    switch (o) {
      case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, h, w); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
    }
    ctx.drawImage(canvas, 0, 0);
    return out;
  }

  async function tiffJpegToCanvas(info, bytes) {
    const canvas = document.createElement('canvas');
    canvas.width = info.width;
    canvas.height = info.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, info.width, info.height);
    for (const chunk of info.chunks) {
      const slice = bytes.subarray(chunk.offset, chunk.offset + chunk.byteCount);
      if (!slice.length) continue;
      const part = await imageBlobToCanvas(new Blob([slice], { type: 'image/jpeg' }));
      // 边缘 tile 解码后仍是完整 tw×th，按源区域裁剪后放置，避免被缩放变形。
      ctx.drawImage(part, 0, 0, chunk.w, chunk.h, chunk.x, chunk.y, chunk.w, chunk.h);
    }
    return canvas;
  }

  async function tiffToCanvas(bytes) {
    const info = tiffParse(bytes);
    let canvas;
    if (info.compression === 7) {
      canvas = await tiffJpegToCanvas(info, bytes);
    } else {
      const data = await tiffPixels(info, bytes);
      canvas = document.createElement('canvas');
      canvas.width = info.width;
      canvas.height = info.height;
      canvas.getContext('2d').putImageData(new ImageData(data, info.width, info.height), 0, 0);
    }
    return applyImageOrientation(canvas, info.orientation);
  }

  /* ---- ICO / CUR 解码（取最大尺寸图像，支持 PNG 内嵌与 BMP 位图） ---- */
  async function icoToCanvas(bytes) {
    if (bytes.length < 6) throw new Error('文件不完整');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = dv.getUint16(4, true);
    if (!count) throw new Error('不包含图像');
    let best = null;
    for (let i = 0; i < count; i++) {
      const e = 6 + i * 16;
      if (e + 16 > bytes.length) break;
      const w = dv.getUint8(e) || 256;
      const h = dv.getUint8(e + 1) || 256;
      const size = dv.getUint32(e + 8, true);
      const off = dv.getUint32(e + 12, true);
      if (!size || off + size > bytes.length) continue;
      if (!best || w * h > best.w * best.h) best = { w, h, size, off };
    }
    if (!best) throw new Error('图像数据损坏');
    const data = bytes.subarray(best.off, best.off + best.size);
    if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
      return imageBlobToCanvas(new Blob([data], { type: 'image/png' }));
    }
    return icoDibToCanvas(data);
  }

  function icoDibToCanvas(data) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const headerSize = dv.getUint32(0, true);
    const width = dv.getInt32(4, true);
    const fullHeight = Math.abs(dv.getInt32(8, true));
    const height = fullHeight >> 1;
    const bpp = dv.getUint16(14, true);
    const compression = dv.getUint32(16, true);
    const clrUsed = dv.getUint32(32, true);
    if (!width || !height) throw new Error('尺寸无效');
    if (compression !== 0 && compression !== 3) throw new Error('暂不支持该压缩方式');
    if ([1, 4, 8, 24, 32].indexOf(bpp) < 0) throw new Error('暂不支持 ' + bpp + ' 位色深');

    const paletteCount = bpp <= 8 ? (clrUsed || (1 << bpp)) : 0;
    const paletteOffset = headerSize;
    const xorOffset = paletteOffset + paletteCount * 4;
    const xorRow = Math.floor((bpp * width + 31) / 32) * 4;
    const maskRow = Math.floor((width + 31) / 32) * 4;
    const maskOffset = xorOffset + xorRow * height;
    if (xorOffset + xorRow * height > data.length) throw new Error('像素数据不完整');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    const px = image.data;

    let hasAlpha = false;
    if (bpp === 32) {
      for (let y = 0; y < height && !hasAlpha; y++) {
        const row = xorOffset + (height - 1 - y) * xorRow;
        for (let x = 0; x < width; x++) {
          if (data[row + x * 4 + 3]) { hasAlpha = true; break; }
        }
      }
    }

    for (let y = 0; y < height; y++) {
      const row = xorOffset + (height - 1 - y) * xorRow;
      let di = y * width * 4;
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, a = 255;
        if (bpp === 32) {
          const o = row + x * 4;
          b = data[o]; g = data[o + 1]; r = data[o + 2];
          a = hasAlpha ? data[o + 3] : 255;
        } else if (bpp === 24) {
          const o = row + x * 3;
          b = data[o]; g = data[o + 1]; r = data[o + 2];
        } else {
          const bit = x * bpp;
          let idx;
          if (bpp === 8) idx = data[row + x];
          else if (bpp === 4) idx = (data[row + (bit >> 3)] >> (4 - (bit & 7))) & 0xF;
          else idx = (data[row + (bit >> 3)] >> (7 - (bit & 7))) & 1;
          const po = paletteOffset + idx * 4;
          b = data[po] || 0; g = data[po + 1] || 0; r = data[po + 2] || 0;
        }
        if (bpp !== 32) {
          const mo = maskOffset + (height - 1 - y) * maskRow + (x >> 3);
          if (mo < data.length && ((data[mo] >> (7 - (x & 7))) & 1)) a = 0;
        }
        px[di] = r; px[di + 1] = g; px[di + 2] = b; px[di + 3] = a;
        di += 4;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  /* ---- 输出格式 ---- */
  const imageExportCache = {};

  function imageExportSupported(format) {
    const fmt = String(format || '').toLowerCase();
    if (fmt === 'bmp' || fmt === 'tiff') return true;
    const mime = fmt === 'jpg' || fmt === 'jpeg' ? 'image/jpeg' : 'image/' + fmt;
    if (imageExportCache[mime] != null) return imageExportCache[mime];
    let ok = false;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      ok = canvas.toDataURL(mime).indexOf('data:' + mime) === 0;
    } catch (e) { ok = false; }
    imageExportCache[mime] = ok;
    return ok;
  }

  function imageOutputExt(format) {
    const fmt = String(format || 'png').toLowerCase();
    return fmt === 'jpeg' ? 'jpg' : fmt;
  }

  /* 透明背景压到白底，供 JPG / BMP / TIFF 等不支持透明的格式使用 */
  function flattenCanvasOnWhite(canvas) {
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    return out;
  }

  async function canvasToImageBlob(canvas, format, quality) {
    const fmt = String(format || 'png').toLowerCase();
    if (fmt === 'bmp') return bytesToBlob(canvasToBmpBytes(canvas), 'image/bmp');
    if (fmt === 'tiff') return bytesToBlob(canvasToTiffBytes(canvas), 'image/tiff');
    if (!imageExportSupported(fmt)) {
      throw new Error('当前浏览器不支持导出 ' + fmt.toUpperCase() + '，请改用 PNG / JPG / WebP / BMP / TIFF');
    }
    const mime = fmt === 'jpg' || fmt === 'jpeg' ? 'image/jpeg' : 'image/' + fmt;
    const blob = await canvasToBlob(canvas, mime, quality);
    if (!blob) throw new Error('导出 ' + fmt.toUpperCase() + ' 失败');
    return blob;
  }
