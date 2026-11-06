  /* ============================================================
     3d. 办公图片常用能力
     - 编码：Base64、ICO 容器、JPEG/PNG DPI 元数据、CSV 单元格
     - 文档：图片批量插入 Word（OOXML）
     - 绘制：边框圆角、马赛克打码、证件照尺寸、图片对比
     ============================================================ */

  /* ---- Base64（分块转换，避免大图栈溢出） ---- */
  function bytesToBase64(bytes) {
    let raw = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      raw += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + step, bytes.length)));
    }
    return btoa(raw);
  }

  function base64ToBytes(text) {
    let s = String(text == null ? '' : text)
      .replace(/^\s*data:[^,]*;base64,/i, '')
      .replace(/\s+/g, '')
      .replace(/-/g, '+').replace(/_/g, '/');
    if (!s) throw new Error('Base64 内容为空');
    s = s.slice(0, Math.ceil(s.length / 4) * 4).replace(/=+$/, '');
    while (s.length % 4) s += '=';
    let bin;
    try { bin = atob(s); } catch (e) { throw new Error('Base64 内容无效，无法解码'); }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* 按文件头识别图片格式（Base64 解码 / 打包 Word 时使用） */
  function detectImageMime(bytes) {
    const b = bytes;
    if (!b || b.length < 4) return '';
    const fourCC = String.fromCharCode(b[0], b[1], b[2], b[3]);
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
    if (fourCC === 'GIF8') return 'image/gif';
    if (fourCC.slice(0, 2) === 'BM') return 'image/bmp';
    if (fourCC === 'RIFF' && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP') return 'image/webp';
    if (fourCC === 'II*\u0000' || fourCC === 'MM\u0000*') return 'image/tiff';
    if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 1 || b[2] === 2) && b[3] === 0x00) return 'image/x-icon';
    return '';
  }

  function imageMimeToExt(mime) {
    return {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp',
      'image/webp': 'webp', 'image/tiff': 'tiff', 'image/x-icon': 'ico',
    }[mime] || 'png';
  }

  /* ---- ICO 容器：目录 + 多个内嵌 PNG（Vista+ / 全平台通用） ---- */
  async function canvasToIcoBlob(canvas, sizes, fit) {
    const maxSide = Math.max(canvas.width, canvas.height);
    const minSide = Math.min(canvas.width, canvas.height);
    const square = document.createElement('canvas');
    square.width = square.height = fit === 'contain' ? maxSide : minSide;
    const c = square.getContext('2d');
    if (fit === 'contain') {
      const s = Math.min(square.width / canvas.width, square.height / canvas.height);
      const w = Math.round(canvas.width * s), h = Math.round(canvas.height * s);
      c.drawImage(canvas, (square.width - w) / 2, (square.height - h) / 2, w, h);
    } else {
      c.drawImage(canvas, (canvas.width - minSide) / 2, (canvas.height - minSide) / 2,
        minSide, minSide, 0, 0, minSide, minSide);
    }
    const frames = [];
    for (const size of sizes) {
      const cv = resizedCanvas(square, size, size);
      const blob = await canvasToBlob(cv, 'image/png');
      if (!blob) throw new Error('ICO 内部图像生成失败');
      frames.push({ size, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    const dirSize = 6 + frames.length * 16;
    const out = new Uint8Array(dirSize + frames.reduce((sum, f) => sum + f.bytes.length, 0));
    const dv = new DataView(out.buffer);
    dv.setUint16(0, 0, true);
    dv.setUint16(2, 1, true);
    dv.setUint16(4, frames.length, true);
    let offset = dirSize;
    frames.forEach((frame, i) => {
      const e = 6 + i * 16;
      out[e] = out[e + 1] = frame.size >= 256 ? 0 : frame.size;
      out[e + 2] = 0;
      out[e + 3] = 0;
      dv.setUint16(e + 4, 1, true);
      dv.setUint16(e + 6, 32, true);
      dv.setUint32(e + 8, frame.bytes.length, true);
      dv.setUint32(e + 12, offset, true);
      out.set(frame.bytes, offset);
      offset += frame.bytes.length;
    });
    return bytesToBlob(out, 'image/x-icon');
  }

  /* ---- 打印 DPI：直接改元数据，不重新压缩像素 ---- */
  function setJpegDpi(bytes, dpi) {
    if (!bytes || bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error('不是有效的 JPEG 文件');
    const d = Math.max(1, Math.round(dpi));
    let i = 2;
    while (i + 4 <= bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) break;
      const isJfif = marker === 0xE0 && bytes[i + 4] === 0x4A && bytes[i + 5] === 0x46 &&
        bytes[i + 6] === 0x49 && bytes[i + 7] === 0x46;
      if (isJfif && len >= 16) {
        const out = bytes.slice();
        const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
        out[i + 11] = 1;              // 单位：点/英寸
        dv.setUint16(i + 12, d, false);
        dv.setUint16(i + 14, d, false);
        return out;
      }
      i += 2 + len;
    }
    const app0 = new Uint8Array(18);
    app0.set([0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x01]);
    new DataView(app0.buffer).setUint16(12, d, false);
    new DataView(app0.buffer).setUint16(14, d, false);
    const out = new Uint8Array(bytes.length + app0.length);
    out.set(bytes.subarray(0, 2), 0);
    out.set(app0, 2);
    out.set(bytes.subarray(2), 2 + app0.length);
    return out;
  }

  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32Of(bytes, start, length) {
    let c = 0xFFFFFFFF;
    for (let i = start; i < start + length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function setPngDpi(bytes, dpi) {
    if (!bytes || bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) {
      throw new Error('不是有效的 PNG 文件');
    }
    const ppm = Math.max(1, Math.round(Math.max(1, dpi) / 0.0254));
    const payload = new Uint8Array(9);
    const pdv = new DataView(payload.buffer);
    pdv.setUint32(0, ppm, false);
    pdv.setUint32(4, ppm, false);
    payload[8] = 1; // 单位：米
    const chunk = new Uint8Array(21);
    chunk.set([0x00, 0x00, 0x00, 0x09, 0x70, 0x48, 0x59, 0x73], 0);
    chunk.set(payload, 8);
    new DataView(chunk.buffer).setUint32(17, crc32Of(chunk, 4, 13), false);
    let i = 8;
    while (i + 8 <= bytes.length) {
      const len = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
      const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
      if (type === 'pHYs' && len === 9) {
        const out = bytes.slice();
        out.set(payload, i + 8);
        new DataView(out.buffer, out.byteOffset, out.byteLength)
          .setUint32(i + 17, crc32Of(out, i + 4, 13), false);
        return out;
      }
      if (type === 'IDAT' || type === 'IEND') break;
      i += 12 + len;
    }
    const ihdrLen = ((bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11]) >>> 0;
    const at = 8 + 12 + ihdrLen;
    if (at + 8 > bytes.length) throw new Error('PNG 结构不完整');
    const out = new Uint8Array(bytes.length + chunk.length);
    out.set(bytes.subarray(0, at), 0);
    out.set(chunk, at);
    out.set(bytes.subarray(at), at + chunk.length);
    return out;
  }

  /* ---- CSV 单元格转义 ---- */
  function csvCell(value) {
    const s = String(value == null ? '' : value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* ---- 图片批量插入 Word（最小可用 OOXML，图片为 png/jpg 原始数据） ---- */
  function buildDocxWithImages(images, opts) {
    const cfg = opts || {};
    const zip = new JSZip();
    const EXT_CT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
    const defaults = Array.from(new Set(images.map(im => im.ext)))
      .map(ext => `<Default Extension="${ext}" ContentType="${EXT_CT[ext] || 'image/png'}"/>`).join('');
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + defaults + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      images.map((im, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.name}"/>`).join('') +
      '</Relationships>';
    zip.file('word/_rels/document.xml.rels', rels);
    const EMU_PER_CM = 360000;
    const widthCm = Math.max(1, Math.min(25, cfg.widthCm || 15));
    const cx = Math.round(widthCm * EMU_PER_CM);
    let body = '';
    images.forEach((im, idx) => {
      const cy = Math.max(1, Math.round(cx * im.h / Math.max(1, im.w)));
      const rid = 'rId' + (idx + 1);
      const name = '图片 ' + (idx + 1);
      const inline = `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${idx + 2}" name="${xmlEsc(name)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${idx + 2}" name="${xmlEsc(im.name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
      if (cfg.title) body += `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(cfg.title)}</w:t></w:r></w:p>`;
      body += `<w:p><w:r>${inline}</w:r></w:p>`;
      if (cfg.caption) body += `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(im.caption || '')}</w:t></w:r></w:p>`;
      if (cfg.pageBreak && idx < images.length - 1) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      zip.file('word/media/' + im.name, im.bytes);
    });
    zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>');
    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE',
    });
  }

  /* ---- 图片批量插入 Excel：一个工作表，图片按行锚定（最小 OOXML） ---- */
  function buildXlsxWithImages(images, opts) {
    const cfg = opts || {};
    const zip = new JSZip();
    const EXT_CT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
    const defaults = Array.from(new Set(images.map(im => im.ext)))
      .map(ext => `<Default Extension="${ext}" ContentType="${EXT_CT[ext] || 'image/png'}"/>`).join('');
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + defaults + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS + '><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + REL + '"><sheets><sheet name="图片" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS + '><Relationship Id="rId1" Type="' + REL + '/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    const EMU_PER_PX = 9525;
    const widthPx = Math.round(Math.max(1, Math.min(25, cfg.widthCm || 15)) / 2.54 * 96);
    const rows = images.map((im, i) => {
      const cy = Math.round(widthPx * im.h / Math.max(1, im.w) * EMU_PER_PX);
      const heightPt = Math.round(cy / 12700);
      return `<row r="${i + 1}" ht="${heightPt}" customHeight="1"><c r="A${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(im.caption || '')}</t></is></c></row>`;
    }).join('');
    zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + REL + '"><sheetData>' + rows + '</sheetData><drawing r:id="rId1"/></worksheet>');
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS + '><Relationship Id="rId1" Type="' + REL + '/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
    const anchors = images.map((im, i) => {
      const cx = Math.round(widthPx * EMU_PER_PX);
      const cy = Math.round(widthPx * im.h / Math.max(1, im.w) * EMU_PER_PX);
      return `<xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${i}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="${xmlEsc(im.name)}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
    }).join('');
    zip.file('xl/drawings/drawing1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + REL + '">' + anchors + '</xdr:wsDr>');
    zip.file('xl/drawings/_rels/drawing1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS + '>' + images.map((im, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/image" Target="../media/${im.name}"/>`).join('') + '</Relationships>');
    images.forEach(im => zip.file('xl/media/' + im.name, im.bytes));
    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      compression: 'DEFLATE',
    });
  }

  /* ---- 边框 / 圆角 / 留白 ---- */
  function roundedRectPath(c, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y); c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr); c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h); c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr); c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  function framedCanvas(src, opts) {
    const cfg = opts || {};
    const pad = Math.max(0, Math.round(cfg.pad || 0));
    const shape = cfg.shape || 'none';
    const circle = shape === 'circle';
    const side = Math.min(src.width, src.height);
    const iw = circle ? side : src.width;
    const ih = circle ? side : src.height;
    const out = document.createElement('canvas');
    out.width = iw + pad * 2;
    out.height = ih + pad * 2;
    const c = out.getContext('2d');
    if (!cfg.transparent) {
      c.fillStyle = cfg.bg || '#ffffff';
      c.fillRect(0, 0, out.width, out.height);
    }
    const x = pad, y = pad;
    c.save();
    if (circle) {
      c.beginPath();
      c.arc(out.width / 2, out.height / 2, Math.min(iw, ih) / 2, 0, Math.PI * 2);
      c.clip();
    } else if (shape === 'rounded' && cfg.radius > 0) {
      roundedRectPath(c, x, y, iw, ih, cfg.radius);
      c.clip();
    }
    c.drawImage(src, (src.width - iw) / 2, (src.height - ih) / 2, iw, ih, x, y, iw, ih);
    c.restore();
    if (cfg.border > 0) {
      c.strokeStyle = cfg.borderColor || '#000000';
      c.lineWidth = cfg.border;
      if (circle) {
        c.beginPath();
        c.arc(out.width / 2, out.height / 2, Math.min(iw, ih) / 2 - cfg.border / 2, 0, Math.PI * 2);
        c.stroke();
      } else if (shape === 'rounded' && cfg.radius > 0) {
        roundedRectPath(c, x, y, iw, ih, cfg.radius);
        c.stroke();
      } else {
        c.strokeRect(x, y, iw, ih);
      }
    }
    return out;
  }

  /* ---- 打码区域解析：x,y,宽,高；支持像素与百分比，分号 / 换行分隔 ---- */
  function parseRectList(text, w, h) {
    const rects = [];
    for (const raw of String(text == null ? '' : text).split(/[;；\r\n]+/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(/[,，\s]+/).filter(Boolean);
      if (parts.length !== 4) throw new Error('区域格式应为「x,y,宽,高」，当前：' + line);
      const toPx = (v, base) => {
        const n = parseFloat(v);
        if (!Number.isFinite(n)) throw new Error('区域坐标不是数字：' + line);
        return /%$/.test(String(v)) ? Math.round(n / 100 * base) : Math.round(n);
      };
      let x = toPx(parts[0], w), y = toPx(parts[1], h);
      let rw = toPx(parts[2], w), rh = toPx(parts[3], h);
      if (rw <= 0 || rh <= 0) throw new Error('区域宽高必须大于 0：' + line);
      x = Math.max(0, Math.min(w - 1, x));
      y = Math.max(0, Math.min(h - 1, y));
      rw = Math.min(rw, w - x);
      rh = Math.min(rh, h - y);
      if (rw > 0 && rh > 0) rects.push({ x, y, w: rw, h: rh });
    }
    if (!rects.length) throw new Error('请填写至少一个打码区域，格式为「x,y,宽,高」');
    return rects;
  }

  function applyMosaicRegions(canvas, rects, opts) {
    const cfg = opts || {};
    const mode = cfg.mode || 'mosaic';
    const c = canvas.getContext('2d');
    for (const r of rects) {
      if (mode === 'solid') {
        c.fillStyle = cfg.color || '#000000';
        c.fillRect(r.x, r.y, r.w, r.h);
      } else if (mode === 'blur') {
        const copy = document.createElement('canvas');
        copy.width = r.w;
        copy.height = r.h;
        copy.getContext('2d').drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        c.save();
        c.beginPath();
        c.rect(r.x, r.y, r.w, r.h);
        c.clip();
        c.drawImage(copy, r.x, r.y);
        c.filter = `blur(${Math.max(1, cfg.blur || 8)}px)`;
        c.drawImage(copy, r.x, r.y);
        c.filter = 'none';
        c.restore();
      } else {
        const block = Math.max(2, Math.round(cfg.block || 12));
        const img = c.getImageData(r.x, r.y, r.w, r.h);
        const d = img.data;
        for (let by = 0; by < r.h; by += block) {
          for (let bx = 0; bx < r.w; bx += block) {
            const xe = Math.min(bx + block, r.w), ye = Math.min(by + block, r.h);
            let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
            for (let y = by; y < ye; y++) {
              for (let x = bx; x < xe; x++) {
                const i = (y * r.w + x) * 4;
                sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; sa += d[i + 3]; n++;
              }
            }
            const cr = sr / n, cg = sg / n, cb = sb / n, ca = sa / n;
            for (let y = by; y < ye; y++) {
              for (let x = bx; x < xe; x++) {
                const i = (y * r.w + x) * 4;
                d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = ca;
              }
            }
          }
        }
        c.putImageData(img, r.x, r.y);
      }
    }
    return canvas;
  }

  /* ---- 证件照 / 相纸规格（单位 mm） ---- */
  const ID_PHOTO_SIZES = {
    '1': { label: '1 寸', w: 25, h: 35 },
    'small1': { label: '小 1 寸', w: 22, h: 32 },
    'big1': { label: '大 1 寸', w: 33, h: 48 },
    '2': { label: '2 寸', w: 35, h: 49 },
    'small2': { label: '小 2 寸', w: 35, h: 45 },
    'visa': { label: '签证方照', w: 51, h: 51 },
  };
  const ID_PHOTO_PAPERS = {
    '6': { label: '6 寸相纸', w: 152, h: 102 },
    'a5': { label: 'A5', w: 148, h: 210 },
    'a4': { label: 'A4', w: 210, h: 297 },
  };

  /* ---- 两图对比：并排 / 叠加 / 差异高亮 ---- */
  function compareCanvasPair(a, b, mode, tolerance, labels) {
    const w = a.width, h = a.height;
    const bFit = (b.width === w && b.height === h) ? b : resizedCanvas(b, w, h);
    const out = document.createElement('canvas');
    const c = out.getContext('2d');
    const gap = 16;
    if (mode === 'side') {
      out.width = w * 2 + gap;
      out.height = h + (labels ? 34 : 0);
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, out.width, out.height);
      c.drawImage(a, 0, 0);
      c.drawImage(bFit, w + gap, 0);
      if (labels) {
        c.fillStyle = '#222222';
        c.font = 'bold 22px sans-serif';
        c.textAlign = 'center';
        c.fillText('A', w / 2, h + 24);
        c.fillText('B', w + gap + w / 2, h + 24);
      }
      return { canvas: out, changed: 0, total: 0 };
    }
    out.width = w;
    out.height = h;
    if (mode === 'overlay') {
      c.drawImage(a, 0, 0);
      c.globalAlpha = 0.5;
      c.drawImage(bFit, 0, 0);
      c.globalAlpha = 1;
      return { canvas: out, changed: 0, total: 0 };
    }
    const da = a.getContext('2d').getImageData(0, 0, w, h).data;
    const db = bFit.getContext('2d').getImageData(0, 0, w, h).data;
    const img = c.createImageData(w, h);
    const d = img.data;
    const limit = Math.max(0, tolerance || 0) * 3;
    let changed = 0;
    for (let i = 0; i < d.length; i += 4) {
      const delta = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      if (delta > limit) {
        d[i] = 255; d[i + 1] = 64; d[i + 2] = 64;
        changed++;
      } else {
        const gray = Math.round((da[i] + da[i + 1] + da[i + 2]) / 9);
        d[i] = d[i + 1] = d[i + 2] = gray;
      }
      d[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return { canvas: out, changed, total: w * h };
  }
