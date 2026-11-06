  /* ============================================================
     3c. 图片附加能力：EXIF 读取与保留、锐化、文本换行
     - EXIF：支持 JPEG(APP1) / TIFF / PNG(eXIf) / WebP(EXIF) 读取
     - 保留元数据：压缩 JPG 时把原始 APP1 段搬运到新 JPEG
     - 锐化：分离式 3×3 均值模糊 + 反锐化掩模，O(像素) 且省内存
     ============================================================ */

  const EXIF_TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  const EXIF_TAGS_IFD0 = {
    0x0100: '图像宽度', 0x0101: '图像高度', 0x010E: '图像描述', 0x010F: '制造商',
    0x0110: '相机型号', 0x0112: '方向', 0x011A: '水平分辨率', 0x011B: '垂直分辨率',
    0x0128: '分辨率单位', 0x0131: '软件', 0x0132: '修改时间', 0x013B: '作者',
    0x8298: '版权', 0x0213: 'YCbCr 定位',
  };

  const EXIF_TAGS_EXIF = {
    0x829A: '曝光时间', 0x829D: '光圈值', 0x8822: '曝光程序', 0x8827: 'ISO 感光度',
    0x9000: 'EXIF 版本', 0x9003: '拍摄时间', 0x9004: '数字化时间', 0x9101: '色彩空间配置',
    0x9201: '快门速度', 0x9202: '最大光圈', 0x9204: '曝光补偿', 0x9207: '测光模式',
    0x9209: '闪光灯', 0x920A: '焦距', 0x9290: '秒', 0x9291: '亚秒', 0x9292: '原始亚秒',
    0xA000: 'FlashPix 版本', 0xA001: '色彩空间', 0xA002: '像素宽度', 0xA003: '像素高度',
    0xA402: '曝光模式', 0xA403: '白平衡', 0xA405: '等效焦距', 0xA406: '场景模式',
    0xA408: '对比度', 0xA409: '饱和度', 0xA40A: '锐度', 0xA430: '相机所有者', 0xA434: '镜头型号',
  };

  const EXIF_TAGS_GPS = {
    0x0000: 'GPS 版本', 0x0001: '纬度参考', 0x0002: '纬度', 0x0003: '经度参考',
    0x0004: '经度', 0x0005: '高度参考', 0x0006: '高度', 0x0007: 'GPS 时间',
    0x001D: 'GPS 日期',
  };

  function exifRound(n, digits) {
    const v = Number(n);
    if (!Number.isFinite(v)) return String(n);
    return String(parseFloat(v.toFixed(digits)));
  }

  /* 在字节流里定位 TIFF 头，返回 { base, le }；不含 EXIF 时返回 null */
  function locateExifTiff(bytes) {
    if (!bytes || bytes.length < 8) return null;
    const isTiff = (bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4D && bytes[1] === 0x4D);
    if (isTiff) {
      const le = bytes[0] === 0x49;
      const magic = le ? (bytes[2] | (bytes[3] << 8)) : ((bytes[2] << 8) | bytes[3]);
      return magic === 42 ? { base: 0, le } : null;
    }
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      // JPEG：逐段扫描，命中 APP1 且载荷以 "Exif\0\0" 开头
      let i = 2;
      while (i + 4 <= bytes.length) {
        if (bytes[i] !== 0xFF) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
        if (marker === 0xDA || marker === 0xD9) break;
        const len = (bytes[i + 2] << 8) | bytes[i + 3];
        if (len < 2) break;
        if (marker === 0xE1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 &&
            bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
          const base = i + 10;
          return base + 8 <= bytes.length ? { base, le: bytes[base] === 0x49 } : null;
        }
        i += 2 + len;
      }
      return null;
    }
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      let i = 8;
      while (i + 8 <= bytes.length) {
        const len = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
        const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
        if (type === 'eXIf') return { base: i + 8, le: bytes[i + 8] === 0x49 };
        if (type === 'IEND') break;
        i += 12 + len;
      }
      return null;
    }
    if (bytes.length > 16 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      let i = 12;
      while (i + 8 <= bytes.length) {
        const type = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
        const len = (bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)) >>> 0;
        if (type === 'EXIF') {
          const withHead = bytes[i + 8] === 0x45 && bytes[i + 9] === 0x78;
          const base = i + (withHead ? 14 : 8);
          return base + 8 <= bytes.length ? { base, le: bytes[base] === 0x49 } : null;
        }
        i += 8 + len + (len & 1);
      }
    }
    return null;
  }

  function readExifValue(dv, offset, type, count, le) {
    if (type === 2) {
      let s = '';
      for (let i = 0; i < count; i++) {
        const code = dv.getUint8(offset + i);
        if (code === 0) break;
        s += String.fromCharCode(code);
      }
      return s.trim();
    }
    const out = [];
    for (let i = 0; i < count; i++) {
      const o = offset + i * (EXIF_TYPE_SIZE[type] || 1);
      if (type === 1 || type === 7) out.push(dv.getUint8(o));
      else if (type === 3) out.push(dv.getUint16(o, le));
      else if (type === 4) out.push(dv.getUint32(o, le));
      else if (type === 5) out.push(dv.getUint32(o + 4, le) ? dv.getUint32(o, le) / dv.getUint32(o + 4, le) : 0);
      else if (type === 6) out.push(dv.getInt8(o));
      else if (type === 8) out.push(dv.getInt16(o, le));
      else if (type === 9) out.push(dv.getInt32(o, le));
      else if (type === 10) out.push(dv.getInt32(o + 4, le) ? dv.getInt32(o, le) / dv.getInt32(o + 4, le) : 0);
      else if (type === 11) out.push(dv.getFloat32(o, le));
      else if (type === 12) out.push(dv.getFloat64(o, le));
      else out.push(0);
    }
    return out.length === 1 ? out[0] : out;
  }

  /* 读取全部可识别 EXIF 条目，返回 [{ group, tag, label, value }] */
  function readExifEntries(bytes) {
    const tiff = locateExifTiff(bytes);
    if (!tiff) return [];
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const base = tiff.base;
    const le = tiff.le;
    if (base + 8 > bytes.length) return [];
    const entries = [];
    const visited = new Set();
    const readIfd = (offset, group, depth) => {
      if (depth > 3 || !offset || visited.has(offset)) return;
      visited.add(offset);
      const start = base + offset;
      if (start < 0 || start + 2 > bytes.length) return;
      const count = dv.getUint16(start, le);
      if (count > 500) return;
      for (let i = 0; i < count; i++) {
        const e = start + 2 + i * 12;
        if (e + 12 > bytes.length) break;
        const tag = dv.getUint16(e, le);
        const type = dv.getUint16(e + 2, le);
        const n = dv.getUint32(e + 4, le);
        const unit = EXIF_TYPE_SIZE[type] || 1;
        const size = unit * n;
        if (size <= 0) continue;
        const valueOffset = size <= 4 ? e + 8 : base + dv.getUint32(e + 8, le);
        if (valueOffset < 0 || valueOffset + size > bytes.length) continue;
        if (tag === 0x8769) { readIfd(dv.getUint32(e + 8, le), 'exif', depth + 1); continue; }
        if (tag === 0x8825) { readIfd(dv.getUint32(e + 8, le), 'gps', depth + 1); continue; }
        const names = group === 'gps' ? EXIF_TAGS_GPS : (group === 'exif' ? EXIF_TAGS_EXIF : EXIF_TAGS_IFD0);
        const label = names[tag];
        if (!label) continue;
        entries.push({ group, tag, label, value: readExifValue(dv, valueOffset, type, n, le) });
      }
    };
    readIfd(dv.getUint32(base + 4, le), 'ifd0', 0);
    return entries;
  }

  const EXIF_ORIENTATION_TEXT = {
    1: '正常', 2: '水平镜像', 3: '旋转 180°', 4: '垂直镜像',
    5: '镜像后旋转 90°', 6: '顺时针旋转 90°', 7: '镜像后旋转 270°', 8: '逆时针旋转 90°',
  };

  function exifEntryByTag(entries, tag) {
    for (const e of entries) if (e.tag === tag) return e;
    return null;
  }

  function exifGpsText(entries, valueTag, refTag) {
    const item = exifEntryByTag(entries, valueTag);
    if (!item || !Array.isArray(item.value) || item.value.length < 3) return '';
    const ref = exifEntryByTag(entries, refTag);
    const deg = item.value[0] + item.value[1] / 60 + item.value[2] / 3600;
    const dir = ref && typeof ref.value === 'string' ? ref.value : '';
    return `${exifRound(deg, 6)}° ${dir}`.trim();
  }

  /* 把 EXIF 条目整理成「标签：值」的可读文本行；onlyGroup 用于按段落输出 */
  function exifReportLines(entries, onlyGroup) {
    const lines = [];
    for (const entry of entries) {
      if (onlyGroup && entry.group !== onlyGroup) continue;
      if (entry.tag === 0x0001 || entry.tag === 0x0003) continue; // 经纬度参考并入坐标行
      let text;
      if (entry.tag === 0x0002) text = exifGpsText(entries, 0x0002, 0x0001);
      else if (entry.tag === 0x0004) text = exifGpsText(entries, 0x0004, 0x0003);
      else if (entry.tag === 0x0006) {
        const ref = exifEntryByTag(entries, 0x0005);
        text = exifRound(entry.value, 2) + ' m' + (ref && ref.value === 1 ? '（海平面以下）' : '');
      } else text = exifFormatValue(entry);
      if (text === '') continue;
      lines.push(`${entry.label}：${text}`);
    }
    return lines;
  }

  function exifFormatValue(entry) {
    const v = entry.value;
    const first = Array.isArray(v) ? v[0] : v;
    const num = Number(first);
    switch (entry.tag) {
      case 0x0112: return EXIF_ORIENTATION_TEXT[first] || String(first);
      case 0x011A: case 0x011B: return exifRound(num, 2) + ' dpi';
      case 0x0128: return ({ 1: '无单位', 2: '英寸', 3: '厘米' })[first] || String(first);
      case 0x829A: {
        if (!Number.isFinite(num) || num <= 0) return String(first);
        return num >= 1 ? `${exifRound(num, 2)} 秒` : `1/${Math.round(1 / num)} 秒`;
      }
      case 0x829D: case 0x9202: return 'f/' + exifRound(num, 1);
      case 0x8827: return 'ISO ' + first;
      case 0x9201: return '1/' + Math.round(Math.pow(2, num)) + ' 秒';
      case 0x9204: return (num > 0 ? '+' : '') + exifRound(num, 2) + ' EV';
      case 0x9209: return (first & 1) ? '已闪光' : '未闪光';
      case 0x920A: case 0xA405: return exifRound(num, 1) + ' mm';
      case 0xA403: return first === 0 ? '自动' : '手动';
      case 0xA402: return ({ 0: '自动曝光', 1: '手动曝光', 2: '程序自动', 3: '光圈优先', 4: '快门优先' })[first] || String(first);
      case 0xA001: return first === 1 ? 'sRGB' : String(first);
      default: break;
    }
    if (Array.isArray(v)) {
      return v.map(x => (typeof x === 'number' ? exifRound(x, 4) : x)).join(', ');
    }
    if (typeof v === 'number') return exifRound(v, 4);
    return String(v);
  }

  /* ---- JPEG 元数据（APP1）搬运 ---- */
  function jpegExifSegment(bytes) {
    if (!bytes || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
    let i = 2;
    while (i + 4 <= bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) break;
      if (marker === 0xE1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 &&
          bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
        return bytes.subarray(i, Math.min(bytes.length, i + 2 + len));
      }
      i += 2 + len;
    }
    return null;
  }

  /* 复制 EXIF 段时把方向标记改回 1：像素已在 canvas 里摆正，再转一次会歪 */
  function resetExifOrientation(segment) {
    if (!segment || segment.length < 18) return segment;
    const base = 10;
    const le = segment[base] === 0x49;
    const dv = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
    const ifd = dv.getUint32(base + 4, le);
    const ifdStart = base + ifd;
    if (ifdStart + 2 > segment.length) return segment;
    const count = dv.getUint16(ifdStart, le);
    for (let i = 0; i < count; i++) {
      const e = ifdStart + 2 + i * 12;
      if (e + 12 > segment.length) break;
      if (dv.getUint16(e, le) === 0x0112) {
        dv.setUint16(e + 8, 1, le);
        break;
      }
    }
    return segment;
  }

  function jpegWithExif(jpegBytes, segment) {
    if (!segment || !segment.length) return jpegBytes;
    const out = new Uint8Array(jpegBytes.length + segment.length);
    out.set(jpegBytes.subarray(0, 2), 0);
    out.set(segment, 2);
    out.set(jpegBytes.subarray(2), 2 + segment.length);
    return out;
  }

  /* ---- 锐化：反锐化掩模（先 3×3 均值模糊，再按差值补偿） ---- */
  function sharpenCanvas(canvas, amount) {
    const strength = Math.min(1, Math.max(0, (parseFloat(amount) || 0) / 100)) * 1.8;
    const w = canvas.width, h = canvas.height;
    if (strength <= 0 || w < 3 || h < 3) return canvas;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const src = img.data;
    const out = new Uint8ClampedArray(src.length);
    out.set(src);
    const rowSum = () => new Float32Array(w * 3);
    const rows = [rowSum(), rowSum(), rowSum()];
    const fill = (y, buf) => {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const xl = x > 0 ? x - 1 : 0;
        const xr = x < w - 1 ? x + 1 : w - 1;
        const b = x * 3;
        for (let c = 0; c < 3; c++) {
          buf[b + c] = src[(row + xl) * 4 + c] + src[(row + x) * 4 + c] + src[(row + xr) * 4 + c];
        }
      }
    };
    fill(0, rows[0]);
    fill(0, rows[1]);
    for (let y = 0; y < h; y++) {
      fill(y < h - 1 ? y + 1 : h - 1, rows[2]);
      const [up, mid, down] = rows;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const b = x * 3;
        for (let c = 0; c < 3; c++) {
          const p = src[i + c];
          const blur = (up[b + c] + mid[b + c] + down[b + c]) / 9;
          out[i + c] = p + (p - blur) * strength;
        }
      }
      rows.push(rows.shift());
    }
    ctx.putImageData(new ImageData(out, w, h), 0, 0);
    return canvas;
  }

  /* ---- 文本按宽度折行（逐字符，兼容中文与连续西文） ---- */
  function wrapTextLines(ctx, text, maxWidth) {
    const lines = [];
    for (const para of String(text == null ? '' : text).split(/\r?\n/)) {
      if (!para) { lines.push(''); continue; }
      let line = '';
      for (const ch of para) {
        const test = line + ch;
        if (line && ctx.measureText(test).width > maxWidth) {
          lines.push(line);
          line = ch;
        } else {
          line = test;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /* ---- 等比绘制到新画布（高质量插值） ---- */
  function resizedCanvas(canvas, w, h) {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w));
    out.height = Math.max(1, Math.round(h));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out;
  }

  function hexToRgbTriplet(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex == null ? '' : hex).trim());
    if (!m) return [255, 255, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* ---- 自动去边：从四边逐行/逐列判断是否与角落同色 ---- */
  function trimCanvasBounds(canvas, tolerance, sides) {
    const w = canvas.width, h = canvas.height;
    const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const ref = [0, 0, 0];
    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
    for (const [cx, cy] of corners) {
      const i = (cy * w + cx) * 4;
      ref[0] += data[i] / 4;
      ref[1] += data[i + 1] / 4;
      ref[2] += data[i + 2] / 4;
    }
    const limit = Math.max(0, Math.min(100, parseFloat(tolerance) || 0)) * 4.42;
    const limitSq = limit * limit;
    const match = (i) => {
      const dr = data[i] - ref[0], dg = data[i + 1] - ref[1], db = data[i + 2] - ref[2];
      return dr * dr + dg * dg + db * db <= limitSq;
    };
    const rowMatches = (y) => {
      let hit = 0;
      for (let x = 0; x < w; x++) if (match((y * w + x) * 4)) hit++;
      return hit >= w * 0.98;
    };
    const colMatches = (x) => {
      let hit = 0;
      for (let y = 0; y < h; y++) if (match((y * w + x) * 4)) hit++;
      return hit >= h * 0.98;
    };
    let top = 0, bottom = h - 1, left = 0, right = w - 1;
    if (sides !== 'horizontal') {
      while (top <= bottom && rowMatches(top)) top++;
      while (bottom >= top && rowMatches(bottom)) bottom--;
    }
    if (sides !== 'vertical') {
      while (left <= right && colMatches(left)) left++;
      while (right >= left && colMatches(right)) right--;
    }
    if (right < left || bottom < top) throw new Error('整幅图与边角同色，无法判断可裁剪的范围，请降低容差');
    return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  }

  /* ---- alpha 通道羽化（可分离滑动窗口均值） ---- */
  function featherAlphaChannel(px, w, h, radius) {
    const r = Math.max(0, Math.round(radius));
    if (!r) return;
    const n = w * h;
    const win = r * 2 + 1;
    const src = new Float32Array(n);
    for (let i = 0; i < n; i++) src[i] = px[i * 4 + 3];
    const tmp = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / win;
        sum -= src[row + Math.min(w - 1, Math.max(0, x - r))];
        sum += src[row + Math.min(w - 1, Math.max(0, x + r + 1))];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        px[(y * w + x) * 4 + 3] = Math.round(sum / win);
        sum -= tmp[Math.min(h - 1, Math.max(0, y - r)) * w + x];
        sum += tmp[Math.min(h - 1, Math.max(0, y + r + 1)) * w + x];
      }
    }
  }

  /* ---- 纯色背景去除：默认从四边泛洪，避免误删画面内部的同色区域 ---- */
  function removeFlatBackground(canvas, opts) {
    const cfg = opts || {};
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const px = img.data;
    let target;
    if (cfg.mode === 'color') {
      target = hexToRgbTriplet(cfg.color);
    } else {
      target = [0, 0, 0];
      const probes = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
      for (const [x, y] of probes) {
        const i = (y * w + x) * 4;
        target[0] += px[i] / 4;
        target[1] += px[i + 1] / 4;
        target[2] += px[i + 2] / 4;
      }
    }
    const limit = Math.max(0, Math.min(100, parseFloat(cfg.tolerance) || 0)) * 4.42;
    const limitSq = limit * limit;
    const match = (p) => {
      const i = p * 4;
      const dr = px[i] - target[0], dg = px[i + 1] - target[1], db = px[i + 2] - target[2];
      return dr * dr + dg * dg + db * db <= limitSq;
    };
    const removed = new Uint8Array(w * h);
    let count = 0;
    if (cfg.mode === 'color') {
      for (let p = 0; p < w * h; p++) if (match(p)) { removed[p] = 1; count++; }
    } else {
      const stack = new Int32Array(w * h);
      let sp = 0;
      const push = (p) => {
        if (removed[p] || !match(p)) return;
        removed[p] = 1;
        count++;
        stack[sp++] = p;
      };
      for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
      while (sp) {
        const p = stack[--sp];
        const x = p % w;
        if (x > 0) push(p - 1);
        if (x < w - 1) push(p + 1);
        if (p >= w) push(p - w);
        if (p + w < w * h) push(p + w);
      }
    }
    if (!count) throw new Error('没有像素匹配背景色，可调高容差或改用指定颜色模式');
    for (let p = 0; p < w * h; p++) if (removed[p]) px[p * 4 + 3] = 0;
    featherAlphaChannel(px, w, h, cfg.feather);
    ctx.putImageData(img, 0, 0);
    return { canvas, ratio: count / (w * h) };
  }

  /* ---- 压到指定体积：先在原尺寸上二分质量，仍超标再等比缩小重试 ---- */
  async function compressCanvasToTarget(canvas, targetBytes, format) {
    const mime = format === 'webp' ? 'image/webp' : 'image/jpeg';
    const encode = (cv, q) => canvasToBlob(cv, mime, Math.min(1, Math.max(0.05, q / 100)));
    let scale = 1;
    let fallback = null;
    for (let round = 0; round < 9; round++) {
      const src = scale >= 0.999 ? canvas : resizedCanvas(canvas, canvas.width * scale, canvas.height * scale);
      let lo = 5, hi = 95, fit = null, smallest = null;
      for (let i = 0; i < 7 && lo <= hi; i++) {
        const q = Math.round((lo + hi) / 2);
        const blob = await encode(src, q);
        if (!blob || !blob.size) break;
        if (!smallest || blob.size < smallest.blob.size) smallest = { blob, q };
        if (blob.size <= targetBytes) {
          fit = { blob, q };
          lo = q + 1;
        } else {
          hi = q - 1;
        }
      }
      if (fit) return { blob: fit.blob, quality: fit.q, scale };
      if (!smallest) break;
      fallback = { blob: smallest.blob, quality: smallest.q, scale };
      scale *= 0.85;
      if (scale < 0.08) break;
    }
    if (!fallback) throw new Error('无法生成目标大小的图片，请放宽目标体积');
    return { ...fallback, missed: true };
  }
