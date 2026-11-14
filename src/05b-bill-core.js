  /* ============================================================
     5.1 票据 / 发票业务核心
     复刻 PyWork2（票据识别工具）的本地解析、二维码、排序、命名、
     序时簿导入与 Excel 导出能力。全部在浏览器内完成，不上传文件。
     ============================================================ */
  const BILL_SORT_MODES = [
    ['custom', '指定发票号码顺序'], ['number_asc', '发票号码 升序'], ['number_desc', '发票号码 降序'],
    ['amount_asc', '发票金额 升序'], ['amount_desc', '发票金额 降序'],
    ['date_asc', '开票日期 升序'], ['date_desc', '开票日期 降序'], ['original', '原文件名顺序'],
  ];
  const BILL_TEMPLATE_FIELDS = [
    ['{前缀}', '前缀'], ['{序号}', '序号'], ['{发票号码}', '发票号码'], ['{发票代码}', '发票代码'],
    ['{开票日期}', '开票日期'], ['{金额}', '价税合计'], ['{税额}', '税额'], ['{发票类型}', '发票类型'],
    ['{购买方}', '购买方'], ['{销售方}', '销售方'], ['{大写金额}', '大写金额'],
    ['{页数}', '页数'], ['{原文件名}', '原文件名'],
  ];
  const BILL_QR_TYPE_LABELS = {
    '01': '增值税专用发票', '04': '增值税普通发票',
    '10': '增值税电子普通发票', '20': '增值税电子专用发票',
    '11': '卷式发票', '14': '通行费发票',
    '31': '电子发票（增值税专用发票）', '32': '电子发票（普通发票）',
    '33': '机动车销售统一发票', '34': '二手车销售统一发票',
  };
  const BILL_TYPE_LABELS = {
    VatSpecialInvoice: '增值税专用发票', VatCommonInvoice: '增值税普通发票',
    VatElectronicCommonInvoice: '增值税电子普通发票', VatElectronicSpecialInvoice: '增值税电子专用发票',
    VatElectronicInvoiceBlockchain: '区块链电子发票', VatElectronicInvoiceToll: '电子通行费发票',
    VatElectronicSpecialInvoiceFull: '全电发票（专用）', VatElectronicInvoiceFull: '全电发票（普通）',
    MachinePrintedInvoice: '通用机打发票', BusInvoice: '汽车票', ShippingInvoice: '轮船票',
    TollInvoice: '过路过桥费发票', OtherInvoice: '其他发票', TaxiTicket: '出租车票',
    QuotaInvoice: '定额发票', AirTransport: '机票行程单', TrainTicket: '火车票',
    BankSlip: '银行回单', ShoppingReceipt: '购物小票', SaleInventory: '销售清单',
  };
  const BILL_FIELD_LABELS = {
    Title: '发票标题', Kind: '发票种类', FormType: '表单类型', FormName: '表单名称',
    Code: '发票代码', CodeConfirm: '发票代码（校验）', Number: '发票号码',
    NumberConfirm: '发票号码（校验）', ElectronicFullNumber: '全电发票号码',
    ElectronicTicketNum: '电子客票号', SerialNumber: '流水号', Date: '开票日期',
    DateGetOn: '乘车日期', Time: '时间', Total: '价税合计', TotalCn: '价税合计（大写）',
    PretaxAmount: '不含税金额', SubTotal: '金额合计', SubTax: '税额合计', Tax: '税额',
    TaxAmount: '税额', TaxRate: '税率', Price: '金额', Fare: '票价', Buyer: '购买方',
    BuyerTaxID: '购买方税号', BuyerAddrTel: '购买方地址电话', BuyerBankAccount: '购买方开户行及账号',
    Seller: '销售方', SellerTaxID: '销售方税号', SellerAddrTel: '销售方地址电话',
    SellerBankAccount: '销售方开户行及账号', MachineCode: '机器编号', CheckCode: '校验码',
    Remark: '备注', Issuer: '开票人', Reviewer: '复核人', Receiptor: '收款人',
    Content: '内容', ServiceName: '服务名称', InvoiceStatus: '发票状态',
  };
  const BILL_HEADER_KEYWORDS = [
    ['数电票号码', 100], ['全电发票号码', 100], ['电子发票号码', 95], ['发票号码', 100],
    ['发票号', 90], ['票据号码', 85], ['税控号', 80], ['号码', 60],
  ];
  const BILL_SKIP_WORDS = new Set([
    '合计', '小计', '总计', '发票号码', '发票号', '数电票号码', '全电发票号码',
    '票据号码', '税控号', '号码', '日期', '金额', '序号', '备注',
  ]);
  const BILL_CACHE_KEY = 'officetoolbox.billCache.v1';
  const BILL_CACHE_MAX = 400;

  function billText(v) {
    return (v == null || typeof v === 'object') ? '' : String(v).trim();
  }
  function billSafeFloat(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  function billCleanAmount(v) {
    const text = billText(v);
    if (!text) return 0;
    const negative = text.includes('-') || text.includes('负');
    const cleaned = text.replace(/[^\d.]/g, '');
    if (!cleaned) return 0;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? (negative ? -n : n) : 0;
  }
  function billCnAmountToFloat(v) {
    let text = billText(v);
    if (!text) return 0;
    const negative = text.includes('负') || text.startsWith('-');
    text = text.replace(/负数|负|整|正/g, '');
    const digits = { 零: 0, 〇: 0, 壹: 1, 一: 1, 贰: 2, 二: 2, 叁: 3, 三: 3, 肆: 4, 四: 4, 伍: 5, 五: 5, 陆: 6, 六: 6, 柒: 7, 七: 7, 捌: 8, 八: 8, 玖: 9, 九: 9 };
    const units = { 拾: 10, 十: 10, 佰: 100, 百: 100, 仟: 1000, 千: 1000, 万: 10000, 亿: 100000000 };
    const parseSection = s => {
      let val = 0, temp = 0;
      for (const ch of s) {
        if (ch in digits) temp = digits[ch];
        else if (ch in units) {
          if (!temp && (ch === '拾' || ch === '十')) temp = 1;
          val += temp * units[ch];
          temp = 0;
        } else break;
      }
      return val + temp;
    };
    let total = 0, remaining = text;
    if (remaining.includes('亿')) {
      const p = remaining.split('亿'); total += parseSection(p[0]) * 1e8; remaining = p[1] || '';
    }
    if (remaining.includes('万')) {
      const p = remaining.split('万'); total += parseSection(p[0]) * 1e4; remaining = p[1] || '';
    }
    let yuan = '';
    if (remaining.includes('元')) { const p = remaining.split('元'); yuan = p[0]; remaining = p[1] || ''; }
    else if (remaining.includes('圆')) { const p = remaining.split('圆'); yuan = p[0]; remaining = p[1] || ''; }
    if (yuan) total += parseSection(yuan);
    else if (remaining && !/角|分/.test(remaining)) { total += parseSection(remaining); remaining = ''; }
    if (remaining.includes('角')) {
      const p = remaining.split('角');
      const m = p[0].match(/([零〇壹一贰二叁三肆四伍五陆六柒七捌八玖九])$/);
      if (m) total += digits[m[1]] * 0.1;
      remaining = p[1] || '';
    }
    if (remaining.includes('分')) {
      const p = remaining.split('分');
      const m = p[0].match(/([零〇壹一贰二叁三肆四伍五陆六柒七捌八玖九])$/);
      if (m) total += digits[m[1]] * 0.01;
    }
    const result = Math.round(total * 100) / 100;
    return negative ? -result : result;
  }
  function billFormatAmount(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v || '');
  }
  function billNormalizeNumber(v) {
    const text = billText(v).replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
    if (/^\d+$/.test(text)) return text.replace(/^0+/, '') || '0';
    return text;
  }
  function billNormalizeDate(v) {
    const text = billText(v);
    const m = text.match(/(\d{4})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/);
    if (m) return m[1] + String(parseInt(m[2], 10)).padStart(2, '0') + String(parseInt(m[3], 10)).padStart(2, '0');
    const digits = text.replace(/\D/g, '');
    if (digits.length === 8) return digits;
    if (digits.length === 6) return '20' + digits;
    return '';
  }
  function billFullwidthDigits(s) {
    return String(s || '').replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  }
  function billExtractFilenameNumber(name) {
    const stem = billFullwidthDigits(String(name || '').replace(/\.[^/.]+$/, ''));
    const patterns = [
      /(?:dzfp|dzfapiao|invoice)[_\- ]*(\d{20})(?!\d)/i,
      /(?:数电|全电|电子)?(?:发票|票)(?:号码)?[_\- ]*(\d{20})(?!\d)/,
      /(?<!\d)(\d{20})(?!\d)/,
    ];
    for (const re of patterns) {
      const m = stem.match(re);
      if (m) return m[1];
    }
    return '';
  }
  function billParseCustomOrder(text) {
    return billText(text).split(/[\s,，;；、|]+/).filter(Boolean);
  }
  function billNaturalCompare(a, b) {
    const pa = String(a || '').split(/(\d+)/).filter(Boolean);
    const pb = String(b || '').split(/(\d+)/).filter(Boolean);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || '', y = pb[i] || '';
      const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) {
        const d = Number(x) - Number(y);
        if (d) return d < 0 ? -1 : 1;
      } else {
        const c = x.toUpperCase().localeCompare(y.toUpperCase());
        if (c) return c < 0 ? -1 : 1;
      }
    }
    return 0;
  }

  /* ---------------- 发票二维码与 PDF 文本层 ---------------- */
  /* 二维码格式（GB/T《电子凭证入账要求 第2部分》附录 D）：
     01 , 发票类型 , 发票代码 , 发票号码 , 合计金额 , 开票日期(YYYYMMDD) , 发票校验码(可空) , CRC(4)
     金额含义随票种变化：20 位数电票为价税合计，老票为不含税金额。
     票种判定与 CRC-16 规则参照 InvoiceClip 的 InvoiceParser（上游 QrToInvoice，MIT）。 */
  function billCrc16(text) {
    let crc = 0;
    for (let i = 0; i < text.length; i++) {
      crc ^= (text.charCodeAt(i) & 0xff) << 8;
      for (let bit = 0; bit < 8; bit++) {
        crc = ((crc & 0x8000) ? ((crc << 1) ^ 0x8005) : (crc << 1)) & 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  /** CRC 覆盖「CRC 字段之前的全部字符」。各开票系统对末尾逗号处理不一致，两种都试；
      不匹配返回 null 表示「未校验」，不返回 false，避免把格式差异误报为内容错误。 */
  function billVerifyQrCrc(normalized, expected) {
    if (!/^[0-9A-Za-z]{4}$/.test(expected)) return null;
    const cut = normalized.lastIndexOf(',');
    if (cut < 0) return null;
    const prefix = normalized.slice(0, cut);
    const want = expected.toUpperCase();
    return billCrc16(prefix) === want || billCrc16(prefix + ',') === want ? true : null;
  }
  function billDetectQrKind(typeCode, code, number) {
    if (/^\d{20}$/.test(number)) {
      if (number[4] === '8') return '航空运输电子客票行程单';
      if (number[4] === '9') return '铁路电子客票';
      // 上游写作 substring(3,6) == "79"，3 字符与 2 字符比较恒为 false；
      // 按「号码第 5-6 位为 79」修正，且避开上面第 5 位 8/9 的客票分支。
      if (typeCode === '32' && number.slice(4, 6) === '79') return '通行费发票';
      if (BILL_QR_TYPE_LABELS[typeCode]) return BILL_QR_TYPE_LABELS[typeCode];
      return '数电票';
    }
    if (BILL_QR_TYPE_LABELS[typeCode]) return BILL_QR_TYPE_LABELS[typeCode];
    if (code.startsWith('CZ')) return '财政票据';
    if (code.length === 12) {
      const tail = code.slice(10, 12);
      if (tail === '11') return '增值税电子普通发票';
      if (tail === '13') return '增值税电子专用发票';
      if (tail === '12') return '通行费发票';
      if (tail === '04' || tail === '05') return '增值税普通发票';
      if (tail === '06' || tail === '07') return '卷式发票';
      if (code[0] === '1' && code.slice(7, 9) === '09' && code.endsWith('0')) return '区块链电子发票';
    }
    if (code.length === 10) {
      const flag = code[7];
      if (flag === '1' || flag === '5' || flag === '2' || flag === '7') return '增值税专用发票';
      if (flag === '3' || flag === '6') return '增值税普通发票';
    }
    return '其他发票';
  }
  function billParseQrText(text) {
    const raw = billText(text);
    const normalized = raw.replace(/,+$/, '');
    const parts = normalized.split(',').map(p => p.trim());
    if (parts.length < 6 || parts[0] !== '01') return null;
    const typeCode = parts[1] || '';
    const code = parts[2] || '';
    const number = parts[3] || '';
    const amount = parts[4] ? (() => {
      const m = parts[4].replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
      return m ? Math.round(parseFloat(m[0]) * 100) / 100 : null;
    })() : null;
    let date = '';
    if (/^\d{8}$/.test(parts[5] || '')) {
      const y = parts[5].slice(0, 4), mo = parts[5].slice(4, 6), d = parts[5].slice(6, 8);
      const dt = new Date(Date.UTC(+y, +mo - 1, +d));
      if (dt.getUTCFullYear() === +y && dt.getUTCMonth() === +mo - 1 && dt.getUTCDate() === +d) {
        date = `${y}年${mo}月${d}日`;
      }
    }
    if (!number && amount == null && !date) return null;
    const crc = parts[7] || '';
    const isDigital = /^\d{20}$/.test(number);
    return {
      version: parts[0], type_code: typeCode, code, number, amount, date,
      // 标准第 7 段为校验码；数电票该段为空时保留历史行为，回退展示第 8 段。
      check_code: parts[6] || crc,
      invoice_check_code: parts[6] || '', crc,
      crc_verified: billVerifyQrCrc(normalized, crc),
      kind: billDetectQrKind(typeCode, code, number),
      is_digital: isDigital,
      amount_is_total: isDigital,
      amount_label: isDigital ? '价税合计' : '金额（不含税）',
      text: raw,
    };
  }
  function billQrTypeLabel(code) {
    return BILL_QR_TYPE_LABELS[billText(code)] || '数电发票';
  }
  function billParsePdfInvoiceText(text) {
    const raw = String(text || '');
    const compact = raw.replace(/[ \t]+/g, ' ');
    const out = {
      invoice_number: '', invoice_date: '', amount: 0, tax_amount: 0, total_cn: '',
      buyer: '', seller: '', invoice_type: '', invoice_code: '', issuer: '', check_code: '',
      items: [],
    };
    const num = compact.match(/(?<!\d)\d{20}(?!\d)/);
    if (num) out.invoice_number = num[0];
    const code = compact.match(/(?<!\d)\d{10,12}(?!\d)/);
    if (code) out.invoice_code = code[0];
    const date = compact.match(/(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/);
    if (date) out.invoice_date = `${date[1]}年${String(+date[2]).padStart(2, '0')}月${String(+date[3]).padStart(2, '0')}日`;
    let money = Array.from(compact.matchAll(/[¥￥]\s*(-?[\d,]+\.\d{2})(?!\d)/g), m => billCleanAmount(m[1]));
    if (!money.length) money = Array.from(compact.matchAll(/(?<![\d.])(-?[\d,]+\.\d{2})(?!\d)/g), m => billCleanAmount(m[1]));
    money = money.filter(Number.isFinite);
    if (money.length) {
      let total = 0;
      for (const m of money) if (Math.abs(m) > Math.abs(total)) total = m;
      out.amount = Math.round(total * 100) / 100;
      // 不含税金额 + 税额 = 价税合计，取该配对中绝对值较小的作为税额
      let tax = 0;
      for (let i = 0; i < money.length; i++) {
        for (let j = i + 1; j < money.length; j++) {
          if (Math.abs(money[i] + money[j] - total) >= 0.005) continue;
          const cand = Math.abs(money[i]) < Math.abs(money[j]) ? money[i] : money[j];
          if (Math.abs(cand) > Math.abs(tax)) tax = cand;
        }
      }
      out.tax_amount = Math.round(tax * 100) / 100;
    }
    const cn = compact.match(/[零〇壹一贰二叁三肆四伍五陆六柒七捌八玖九拾十佰百仟千万亿圆元角分整正负]{4,}/);
    if (cn) {
      out.total_cn = cn[0];
      if (!out.amount) out.amount = billCnAmountToFloat(cn[0]);
    }
    const type = compact.match(/(?:电子发票|数电发票|全电发票|增值税[^，,。；;\n]{0,12}发票)[（(][^）)\n]{0,20}[）)]?/);
    if (type) out.invoice_type = type[0];
    else if (/电子发票/.test(compact)) out.invoice_type = '电子发票';
    const companies = Array.from(compact.matchAll(/[\u4e00-\u9fa5A-Za-z0-9（）()·\-]{2,40}(?:有限责任公司|股份有限公司|有限公司|公司|集团|合作社|药店|医院|商行|中心|厂)/g), m => m[0]);
    const uniq = [];
    for (const c of companies) if (!uniq.includes(c)) uniq.push(c);
    out.buyer = uniq[0] || '';
    out.seller = uniq[1] || '';
    const ids = Array.from(compact.matchAll(/(?<!\d)([0-9A-Z]{15,20})(?!\d)/g), m => m[1])
      .filter(v => v !== out.invoice_number && /\d/.test(v) && /[A-Z]/.test(v));
    if (ids[0]) out.items.push(['购买方税号', ids[0]]);
    if (ids[1]) out.items.push(['销售方税号', ids[1]]);
    return out;
  }
  function billParseOcrInput(text) {
    const raw = billText(text);
    if (!raw) return [];
    let value;
    try { value = JSON.parse(raw); } catch (e) { throw new Error('云端 OCR JSON 格式无效：' + e.message); }
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.results)) return value.results;
    return [value];
  }

  function billCanvasQr(canvas) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, w, h);
    if (typeof jsQR === 'function') {
      const res = jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (res && res.data) return res.data;
    }
    return '';
  }
  function billCropCanvas(src, x, y, w, h) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.min(w, src.width - x));
    cv.height = Math.max(1, Math.min(h, src.height - y));
    cv.getContext('2d').drawImage(src, x, y, cv.width, cv.height, 0, 0, cv.width, cv.height);
    return cv;
  }
  async function billBarcodeDetect(canvas) {
    if (typeof BarcodeDetector === 'undefined') return '';
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const found = await detector.detect(canvas);
      for (const f of found || []) if (f.rawValue) return f.rawValue;
    } catch (e) { /* 浏览器不支持该格式时静默回退 */ }
    return '';
  }
  async function billDecodeQrFromCanvas(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return '';
    let text = '';
    try {
      // 数电发票二维码通常在左上角，先扫描裁剪区可显著加快批量处理
      const crop = billCropCanvas(canvas, 0, 0, Math.ceil(canvas.width * 0.62), Math.ceil(canvas.height * 0.55));
      text = billCanvasQr(crop) || await billBarcodeDetect(crop);
      if (!text) text = billCanvasQr(canvas) || await billBarcodeDetect(canvas);
    } catch (e) { /* 渲染或解码失败按无二维码处理 */ }
    return billText(text);
  }
  async function billPageCanvas(page, scale) {
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.floor(vp.width);
    cv.height = Math.floor(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    return cv;
  }
  async function billAnalyzePdf(file, opts) {
    const out = { text: '', qrText: '', page_count: 0 };
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data }).promise;
    try {
      out.page_count = doc.numPages;
      const pages = Math.min(2, doc.numPages);
      for (let i = 1; i <= pages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        out.text += tc.items.map(it => it.str).join('\n') + '\n';
        if (opts && opts.useQr !== false && !out.qrText) {
          out.qrText = await billDecodeQrFromCanvas(await billPageCanvas(page, 2));
          if (!out.qrText && i === 1 && doc.numPages === 1) {
            out.qrText = await billDecodeQrFromCanvas(await billPageCanvas(page, 3));
          }
        }
      }
    } finally {
      if (typeof doc.destroy === 'function') await doc.destroy();
    }
    return out;
  }
  async function billDecodeQrFromImage(file) {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.floor(bitmap.width * scale));
      cv.height = Math.max(1, Math.floor(bitmap.height * scale));
      cv.getContext('2d').drawImage(bitmap, 0, 0, cv.width, cv.height);
      return await billDecodeQrFromCanvas(cv);
    } finally { bitmap.close(); }
  }
  function billExt(name) {
    const m = String(name || '').toLowerCase().match(/(\.[^.]+)$/);
    return m ? m[1] : '';
  }
  function billIsImage(name) {
    return ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.tif', '.tiff'].includes(billExt(name));
  }
  /** 统一分析 PDF / 图片 / OFD：文本层、二维码文本与页数。 */
  async function billAnalyzeFile(file, useQr) {
    const out = { text: '', qrText: '', page_count: 0, error: '' };
    try {
      if (billExt(file.name) === '.pdf') {
        const a = await billAnalyzePdf(file, { useQr: useQr !== false });
        out.text = a.text; out.qrText = a.qrText; out.page_count = a.page_count;
      } else if (billIsImage(file.name) && useQr !== false) {
        out.qrText = await billDecodeQrFromImage(file);
        out.page_count = 1;
      }
    } catch (e) {
      out.error = '文件解析失败：' + (e && e.message ? e.message : e);
    }
    return out;
  }

  /* ---------------- 云端 OCR 响应解析（与原项目同款字段规则） ---------------- */
  function billParseBillResult(data, isAcceptance) {
    const items = [];
    let numAmount = 0, cnAmount = 0, hasNum = false, hasCn = false;
    const processAmount = (name, val) => {
      if (!/金额|Total|小计|合计|票面/.test(billText(name))) return billText(val);
      if (/大写/.test(billText(name))) {
        const n = billCnAmountToFloat(val);
        if (n > 0) { cnAmount = n; hasCn = true; }
      } else {
        const n = billCleanAmount(val);
        if (n > 0) {
          const corrected = isAcceptance ? n / 100 : n;
          numAmount = corrected; hasNum = true;
          return billFormatAmount(corrected);
        }
      }
      return billText(val);
    };
    const parseItem = item => {
      if (!item || typeof item !== 'object') return;
      if (item.Total) processAmount('Total', item.Total);
      const infos = item.SingleInvoiceInfos;
      if (infos && !Array.isArray(infos) && typeof infos === 'object') {
        const other = infos.OtherInvoice;
        if (other) {
          if (other.Total) processAmount('Total', other.Total);
          for (const row of other.OtherInvoiceListItems || []) {
            items.push([billText(row.Name), processAmount(row.Name, row.Value)]);
          }
        }
      } else if (Array.isArray(infos)) {
        for (const info of infos) {
          if (info && typeof info === 'object') items.push([billText(info.Name), processAmount(info.Name, info.Value)]);
        }
      }
    };
    if (!data || typeof data !== 'object' || data.Error) {
      return { ok: false, items: [], amount: 0, error: billText(data && data.Error) || '识别失败' };
    }
    if (Array.isArray(data.BankSlipInfos)) {
      for (const info of data.BankSlipInfos) {
        items.push([billText(info.Name), processAmount(info.Name, info.Value)]);
      }
    } else if (Array.isArray(data.MixedInvoiceItems)) {
      for (const item of data.MixedInvoiceItems) parseItem(item);
    } else if (Array.isArray(data.OtherInvoiceListItems)) {
      for (const info of data.OtherInvoiceListItems) {
        items.push([billText(info.Name), processAmount(info.Name, info.Value)]);
      }
    }
    if (!items.length) {
      for (const [key, val] of Object.entries(data)) {
        if (val == null || typeof val === 'object') continue;
        if (['Rect', 'Type', 'Code', 'Polygon'].includes(key)) continue;
        items.push([key, processAmount(key, val)]);
      }
    }
    return { ok: true, items, amount: Math.round((hasNum ? numAmount : (hasCn ? cnAmount : 0)) * 100) / 100, error: '' };
  }
  function billLocalBillOcr(analysis, file) {
    const infos = [];
    const seen = new Set();
    const push = (name, value) => {
      const n = billText(name), v = billText(value);
      if (!n || !v || seen.has(n)) return;
      seen.add(n);
      infos.push({ Name: n, Value: v });
    };
    for (const line of String(analysis.text || '').split(/\r?\n/)) {
      const m = line.trim().match(/^(.{2,20}?)[:：]\s*(.{1,80})$/);
      if (m) push(m[1], m[2]);
    }
    const money = Array.from(String(analysis.text || '').matchAll(/[¥￥]\s*(-?[\d,]+\.\d{2})/g), m => m[1]);
    if (money.length) push('金额（小写）', money[money.length - 1]);
    const num = billExtractFilenameNumber(file.name);
    if (num) push('文件号码', num);
    if (!infos.length) push('文件名', file.name);
    return { BankSlipInfos: infos };
  }
  function billParseSingleInvoice(payload, key, typeDescription, page) {
    const items = [];
    for (const [k, v] of Object.entries(payload)) {
      if (v == null || typeof v === 'object') continue;
      const t = billText(v);
      if (t) items.push([BILL_FIELD_LABELS[k] || k, t]);
    }
    let amount = 0;
    for (const k of ['Total', 'Price', 'Fare', 'PretaxAmount']) {
      if (payload[k]) { amount = billCleanAmount(payload[k]); if (amount) break; }
    }
    if (!amount) amount = billCnAmountToFloat(payload.TotalCn);
    const first = keys => {
      for (const k of keys) if (billText(payload[k])) return billText(payload[k]);
      return '';
    };
    return {
      type: typeDescription || BILL_TYPE_LABELS[key] || key,
      code: first(['Code', 'CodeConfirm']),
      number: first(['Number', 'NumberConfirm', 'ElectronicFullNumber', 'ElectronicTicketNum', 'SerialNumber']),
      date: first(['Date', 'DateGetOn', 'DateStart']),
      amount: Math.round(amount * 100) / 100,
      tax: Math.round(billCleanAmount(payload.Tax || payload.TaxAmount) * 100) / 100,
      total_cn: billText(payload.TotalCn),
      buyer: first(['Buyer']), seller: first(['Seller']),
      title: billText(payload.Title), page: page || 0, items,
    };
  }
  function billApplyInvoiceResponse(rec, data) {
    const invoices = [];
    const mixed = data && Array.isArray(data.MixedInvoiceItems) ? data.MixedInvoiceItems : [];
    for (const item of mixed) {
      if (!item || typeof item !== 'object') continue;
      const desc = billText(item.TypeDescription);
      const page = item.Page;
      const single = item.SingleInvoiceInfos;
      let found = false;
      if (single && !Array.isArray(single) && typeof single === 'object') {
        for (const [key, payload] of Object.entries(single)) {
          if (!payload || typeof payload !== 'object') continue;
          if (key === 'OtherInvoice') {
            invoices.push({
              type: desc || '其他发票', code: '', number: '', date: '', amount: billCleanAmount(payload.Value),
              tax: 0, total_cn: '', buyer: '', seller: '', title: '', page: page || 0,
              items: [[billText(payload.Name) || '其他发票', billText(payload.Value)]],
            });
          } else invoices.push(billParseSingleInvoice(payload, key, desc, page));
          found = true;
        }
      } else if (Array.isArray(single)) {
        const pairs = single.filter(x => x && typeof x === 'object')
          .map(x => [billText(x.Name), billText(x.Value)]).filter(p => p[0] || p[1]);
        if (pairs.length) {
          invoices.push({
            type: desc || '其他发票', code: '', number: '', date: '', amount: 0, tax: 0,
            total_cn: '', buyer: '', seller: '', title: '', page: page || 0, items: pairs,
          });
          found = true;
        }
      }
      if (!found) {
        const note = desc || billText(item.Code) || '未识别';
        rec.error = rec.error ? rec.error + '；' + note : note;
      }
    }
    if (!invoices.length && data && Array.isArray(data.OtherInvoiceListItems)) {
      const pairs = data.OtherInvoiceListItems.filter(x => x && typeof x === 'object')
        .map(x => [billText(x.Name), billText(x.Value)]).filter(p => p[0] || p[1]);
      if (pairs.length) {
        invoices.push({
          type: '其他发票', code: '', number: '', date: '', amount: 0, tax: 0,
          total_cn: '', buyer: '', seller: '', title: '', page: 0, items: pairs,
        });
      }
    }
    if (!invoices.length) {
      rec.status = '识别失败';
      rec.error = rec.error || '未识别到发票信息';
      return rec;
    }
    invoices.sort((a, b) => (a.page || 0) - (b.page || 0));
    const primary = invoices[0];
    rec.invoices = invoices;
    rec.invoice_type = primary.type;
    rec.invoice_code = primary.code;
    rec.invoice_number = primary.number;
    rec.invoice_date = primary.date;
    rec.total_cn = primary.total_cn;
    rec.buyer = primary.buyer;
    rec.seller = primary.seller;
    rec.items = primary.items.slice();
    rec.amount = Math.round(invoices.reduce((s, i) => s + billSafeFloat(i.amount), 0) * 100) / 100;
    rec.tax_amount = Math.round(invoices.reduce((s, i) => s + billSafeFloat(i.tax), 0) * 100) / 100;
    rec.page_count = parseInt(data.TotalPDFCount, 10) || Math.max(1, ...invoices.map(i => parseInt(i.page, 10) || 1));
    rec.status = '识别成功';
    rec.error = '';
    return rec;
  }

  /* ---------------- 识别记录与本地缓存 ---------------- */
  function billEmptyRecord(file) {
    return {
      file, path: file.name, file_name: file.name, status: '待识别', error: '',
      invoices: [], invoice_type: '', invoice_code: '', invoice_number: '', invoice_date: '',
      amount: 0, tax_amount: 0, total_cn: '', buyer: '', seller: '', items: [], page_count: 0,
      from_cache: false, from_filename: false, from_qr: false, from_ocr: false,
      qr_check_code: '', qr_type_code: '', qr_text: '', qr_crc: '',
      amount_is_total: true,
    };
  }
  function billIsSuccess(rec) { return rec.status === '识别成功'; }
  function billIsUsable(rec) {
    return rec.status === '识别成功' || rec.status === '本地解析' || rec.status === '号码已提取';
  }
  function billApplyFilenameNumber(rec) {
    const n = billExtractFilenameNumber(rec.file_name);
    if (!n) return '';
    rec.invoice_number = n;
    rec.from_filename = true;
    if (!billIsSuccess(rec)) { rec.status = '本地解析'; rec.error = ''; }
    return n;
  }
  function billCacheRead() {
    try {
      const v = JSON.parse(localStorage.getItem(BILL_CACHE_KEY) || '{}');
      return (v && typeof v === 'object') ? v : {};
    } catch (e) { return {}; }
  }
  function billCacheKey(file) {
    return [file.name, file.size, file.lastModified || 0].join('|');
  }
  function billCacheGet(file) {
    const hit = billCacheRead()[billCacheKey(file)];
    return hit && typeof hit === 'object' ? hit.record : null;
  }
  function billCachePut(file, rec) {
    try {
      const cache = billCacheRead();
      const keys = Object.keys(cache);
      if (keys.length >= BILL_CACHE_MAX) {
        keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
        for (const k of keys.slice(0, keys.length - BILL_CACHE_MAX + 1)) delete cache[k];
      }
      const copy = { ...rec };
      delete copy.file;
      cache[billCacheKey(file)] = { ts: Date.now(), record: copy };
      localStorage.setItem(BILL_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* 隐私模式或容量不足时忽略缓存 */ }
  }
  function billCacheClear() {
    try { localStorage.removeItem(BILL_CACHE_KEY); } catch (e) { /* ignore */ }
  }
  function billCacheStats() {
    const cache = billCacheRead();
    return { files: Object.keys(cache).length, results: Object.keys(cache).length };
  }
  function billMergeTextFields(rec, parsed, onlyMissing) {
    const assign = (key, value) => {
      if (!value) return;
      if (!onlyMissing || !rec[key]) rec[key] = value;
    };
    assign('invoice_number', parsed.invoice_number);
    assign('invoice_date', parsed.invoice_date);
    assign('invoice_code', parsed.invoice_code);
    assign('invoice_type', parsed.invoice_type);
    assign('total_cn', parsed.total_cn);
    assign('buyer', parsed.buyer);
    assign('seller', parsed.seller);
    if (!onlyMissing || !rec.amount) rec.amount = parsed.amount || rec.amount;
    if (!onlyMissing || !rec.tax_amount) rec.tax_amount = parsed.tax_amount || rec.tax_amount;
    for (const pair of parsed.items || []) {
      if (!rec.items.some(x => x[0] === pair[0])) rec.items.push(pair);
    }
  }
  function billRecordItems(rec) {
    const amountLabel = rec.amount_is_total === false ? '金额（不含税）' : '价税合计';
    const pairs = [
      ['发票类型', rec.invoice_type], ['发票代码', rec.invoice_code], ['发票号码', rec.invoice_number],
      ['开票日期', rec.invoice_date], [amountLabel, rec.amount ? rec.amount.toFixed(2) : ''],
      ['税额', rec.tax_amount ? rec.tax_amount.toFixed(2) : ''],
      ['价税合计（大写）', rec.total_cn], ['购买方', rec.buyer], ['销售方', rec.seller],
      ['二维码校验码', rec.qr_check_code], ['二维码CRC', rec.qr_crc], ['二维码类型代码', rec.qr_type_code],
    ];
    const out = [];
    const seen = new Set();
    for (const [k, v] of pairs.concat(rec.items || [])) {
      if (!v || seen.has(k)) continue;
      seen.add(k);
      out.push([k, billText(v)]);
    }
    return out;
  }
  async function billBuildRecord(file, opts) {
    const o = opts || {};
    let rec = billEmptyRecord(file);
    if (o.useCache !== false) {
      const hit = billCacheGet(file);
      if (hit) return { ...rec, ...hit, file, path: file.name, file_name: file.name, from_cache: true };
    }
    const filenameNumber = billApplyFilenameNumber(rec);
    const ext = billExt(file.name);
    const analysis = await billAnalyzeFile(file, o.useQr !== false);
    if (analysis.error) rec.error = analysis.error;
    const parsedText = analysis.text ? billParsePdfInvoiceText(analysis.text) : null;
    let qr = null;
    if (analysis.qrText) {
      qr = billParseQrText(analysis.qrText);
      if (qr) {
        rec.from_qr = true;
        rec.qr_text = analysis.qrText;
        rec.qr_type_code = qr.type_code;
        rec.qr_check_code = qr.check_code;
        rec.qr_crc = qr.crc;
        rec.invoice_type = qr.kind || billQrTypeLabel(qr.type_code);
        if (qr.code) rec.invoice_code = qr.code;
        if (qr.number) {
          if (filenameNumber && billNormalizeNumber(filenameNumber) !== billNormalizeNumber(qr.number)) {
            rec.error = '文件名号码与二维码号码不一致，已采用二维码号码';
          }
          rec.invoice_number = qr.number;
        }
        if (qr.amount != null) {
          rec.amount = qr.amount;
          rec.amount_is_total = qr.amount_is_total;
        }
        if (qr.date) rec.invoice_date = qr.date;
        rec.status = '本地解析';
      }
    }
    // 二维码 / 文件名号码优先，PDF 文本层只补齐缺失字段，避免明细数字误覆盖
    if (parsedText) billMergeTextFields(rec, parsedText, true);
    if (o.ocrData && typeof o.ocrData === 'object') {
      const localItems = billRecordItems(rec);
      const localAmount = rec.amount;
      billApplyInvoiceResponse(rec, o.ocrData);
      rec.from_ocr = true;
      if (!rec.amount) rec.amount = localAmount;
      for (const pair of localItems) if (!rec.items.some(x => x[0] === pair[0])) rec.items.push(pair);
    }
    rec.page_count = rec.page_count || analysis.page_count || 0;
    if (!rec.invoice_number && !rec.invoice_date && !rec.amount) {
      rec.status = '待识别';
      rec.error = rec.error || (ext === '.ofd' ? 'OFD 需先转换为 PDF 或图片' : '未找到二维码，文件名中也未找到 20 位发票号码');
    } else if (!billIsSuccess(rec)) {
      rec.status = '本地解析';
    }
    if (o.useCache !== false && rec.invoice_number && billIsUsable(rec)) billCachePut(file, rec);
    return rec;
  }
  async function billBuildRecords(files, opts, onStep) {
    const o = opts || {};
    const records = [];
    for (let i = 0; i < files.length; i++) {
      if (onStep) onStep(i, files.length, files[i].name);
      records.push(await billBuildRecord(files[i], {
        useQr: o.useQr !== false, useCache: o.useCache !== false,
        ocrData: Array.isArray(o.ocrList) ? o.ocrList[i] : null,
      }));
    }
    return records;
  }

  /* ---------------- 排序 / 命名 ---------------- */
  function billSortRecords(records, mode, customText) {
    const numberMode = ['custom', 'number_asc', 'number_desc'].includes(mode);
    const valid = records.filter(r => numberMode ? !!r.invoice_number : (billIsUsable(r) && (r.amount || r.invoice_date)));
    const invalid = records.filter(r => !valid.includes(r));
    let ordered = valid.slice();
    if (mode === 'custom') {
      const order = billParseCustomOrder(customText);
      const rank = new Map();
      order.forEach((n, i) => {
        const key = billNormalizeNumber(n);
        if (key && !rank.has(key)) rank.set(key, i);
      });
      const decorated = ordered.map((r, i) => {
        const pos = rank.get(billNormalizeNumber(r.invoice_number));
        return [{ has: pos == null ? 1 : 0, pos: pos == null ? i : pos }, r];
      });
      decorated.sort((a, b) => a[0].has - b[0].has || a[0].pos - b[0].pos);
      ordered = decorated.map(d => d[1]);
    } else if (mode === 'number_asc' || mode === 'number_desc') {
      ordered.sort((a, b) => billNaturalCompare(a.invoice_number || a.file_name, b.invoice_number || b.file_name));
      if (mode === 'number_desc') ordered.reverse();
    } else if (mode === 'amount_asc' || mode === 'amount_desc') {
      ordered.sort((a, b) => (a.amount - b.amount) * (mode === 'amount_desc' ? -1 : 1));
    } else if (mode === 'date_asc' || mode === 'date_desc') {
      const dated = ordered.filter(r => billNormalizeDate(r.invoice_date));
      const undated = ordered.filter(r => !billNormalizeDate(r.invoice_date));
      dated.sort((a, b) => billNormalizeDate(a.invoice_date).localeCompare(billNormalizeDate(b.invoice_date)) * (mode === 'date_desc' ? -1 : 1));
      ordered = dated.concat(undated);
    } else {
      ordered.sort((a, b) => billNaturalCompare(a.file_name, b.file_name));
    }
    return ordered.concat(invalid);
  }
  function billSortStats(records, ordered, mode, customText) {
    const stats = { total: records.length, matched: 0, missing: [], missing_count: 0, unmatched: [], failed: [], order: [] };
    const index = new Map(records.map((r, i) => [r, i]));
    stats.order = ordered.map(r => index.get(r));
    if (mode !== 'custom') {
      stats.matched = ordered.filter(r => r.invoice_number).length;
      return stats;
    }
    const numbers = billParseCustomOrder(customText);
    const rank = new Set(numbers.map(billNormalizeNumber).filter(Boolean));
    const known = new Set(records.filter(r => r.invoice_number).map(r => billNormalizeNumber(r.invoice_number)));
    const seen = new Set();
    for (const n of numbers) {
      const k = billNormalizeNumber(n);
      if (k && !known.has(k) && !seen.has(k)) { seen.add(k); stats.missing.push(n); }
    }
    stats.missing_count = stats.missing.length;
    for (const r of ordered) {
      if (!r.invoice_number) stats.failed.push(r.file_name);
      else if (rank.has(billNormalizeNumber(r.invoice_number))) stats.matched++;
      else stats.unmatched.push(r.file_name);
    }
    return stats;
  }
  function billPreferredLength(records) {
    const counts = new Map();
    for (const r of records) {
      if (!r.invoice_number) continue;
      const len = String(r.invoice_number).replace(/\D/g, '').length;
      if (len >= 4) counts.set(len, (counts.get(len) || 0) + 1);
    }
    let best = 20, bestCount = 0;
    for (const [len, count] of counts) if (count > bestCount) { best = len; bestCount = count; }
    return best;
  }
  function billCleanComponent(v, limit) {
    return billText(v).replace(/[\\/:*?"<>|\r\n\t]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit || 60);
  }
  function billTemplateValues(rec, seq, prefix, digits) {
    return {
      '{前缀}': billCleanComponent(prefix, 40),
      '{序号}': String(seq).padStart(Math.max(1, Math.min(8, digits)), '0'),
      '{发票号码}': billCleanComponent(rec.invoice_number, 40),
      '{发票代码}': billCleanComponent(rec.invoice_code, 40),
      '{开票日期}': billNormalizeDate(rec.invoice_date) || billCleanComponent(rec.invoice_date, 20),
      '{金额}': rec.amount ? rec.amount.toFixed(2) : '',
      '{税额}': rec.tax_amount ? rec.tax_amount.toFixed(2) : '',
      '{发票类型}': billCleanComponent(rec.invoice_type, 40),
      '{购买方}': billCleanComponent(rec.buyer, 40),
      '{销售方}': billCleanComponent(rec.seller, 40),
      '{大写金额}': billCleanComponent(rec.total_cn, 60),
      '{页数}': rec.page_count ? String(rec.page_count) : '',
      '{原文件名}': billCleanComponent(baseName(rec.file_name), 60),
    };
  }
  function billRenderNameTemplate(rec, seq, prefix, digits, template) {
    const tpl = billText(template);
    if (!tpl) throw new Error('命名模板不能为空');
    const values = billTemplateValues(rec, seq, prefix, digits);
    let name = tpl.replace(/\{([^{}]+)\}/g, (m, key) => {
      const k = '{' + key + '}';
      if (!(k in values)) throw new Error('模板字段 ' + k + ' 不存在');
      return values[k];
    });
    name = name.replace(/([_\- ])\1+/g, '$1').replace(/^[ _\-.]+|[ _\-.]+$/g, '');
    name = billCleanComponent(name, 120).replace(/^[ _\-.]+|[ _\-.]+$/g, '');
    return name || values['{序号}'];
  }
  function billBuildTargetName(rec, seq, opts) {
    const digits = Math.max(1, Math.min(8, parseInt(opts.digits, 10) || 3));
    return billRenderNameTemplate(rec, seq, opts.prefix || '', digits, opts.template || '{前缀}{序号}');
  }
  function billBuildRenamePlan(records, opts) {
    const used = new Set();
    const start = parseInt(opts.start, 10);
    return records.map((rec, i) => {
      const seq = (Number.isFinite(start) ? start : 1) + i;
      const base = billBuildTargetName(rec, seq, opts);
      const ext = billExt(rec.file_name) || '.pdf';
      let name = base + ext, suffix = 2;
      while (used.has(name.toLowerCase())) name = base + '_' + (suffix++) + ext;
      used.add(name.toLowerCase());
      return { record: rec, old_name: rec.file_name, new_name: name, sequence: seq };
    });
  }

  /* ---------------- Excel / 文本 / ZIP 输出 ---------------- */
  function billGridSheet(name, columns, rows, widths) {
    return {
      name,
      grid: [columns].concat(rows.map(row => row.map(v => (v == null ? '' : String(v))))),
      colWidths: widths || columns.map(c => Math.min(40, Math.max(10, String(c).length * 2 + 6)) * 7),
    };
  }
  function billTextBlob(text) {
    return new Blob(['\uFEFF' + String(text || ''),], { type: 'text/plain;charset=utf-8' });
  }
  async function billRecordsToXlsx(records) {
    const detailColumns = ['文件序号', '源文件', '发票类型', '发票代码', '发票号码', '开票日期', '价税合计', '税额', '价税合计（大写）', '购买方', '销售方', '页码', '识别状态', '错误信息'];
    const fileColumns = ['序号', '文件名', '识别状态', '发票类型', '发票号码', '开票日期', '价税合计', '税额', '发票张数', '错误信息'];
    const detailRows = [], fileRows = [];
    records.forEach((rec, i) => {
      const idx = i + 1;
      fileRows.push([
        idx, rec.file_name, rec.status, rec.invoice_type || '', rec.invoice_number,
        rec.invoice_date, billIsUsable(rec) && rec.amount ? rec.amount.toFixed(2) : '',
        billIsSuccess(rec) && rec.tax_amount ? rec.tax_amount.toFixed(2) : '',
        (rec.invoices || []).length, rec.error,
      ]);
      if (billIsSuccess(rec) && (rec.invoices || []).length) {
        for (const inv of rec.invoices) {
          detailRows.push([
            idx, rec.file_name, inv.type || '', inv.code || '', inv.number || '', inv.date || '',
            billSafeFloat(inv.amount), billSafeFloat(inv.tax), inv.total_cn || '', inv.buyer || '',
            inv.seller || '', inv.page || '', rec.status, '',
          ]);
        }
      } else if (rec.invoice_number || rec.amount || rec.invoice_date) {
        detailRows.push([
          idx, rec.file_name, rec.invoice_type || '', rec.invoice_code || '', rec.invoice_number || '',
          rec.invoice_date || '', rec.amount || 0, rec.tax_amount || 0, rec.total_cn || '',
          rec.buyer || '', rec.seller || '', rec.page_count || '', rec.status, rec.error || '',
        ]);
      } else {
        detailRows.push([idx, rec.file_name, '', '', '', '', '', '', '', '', '', '', rec.status, rec.error]);
      }
    });
    return buildXlsxBlob([
      billGridSheet('发票明细', detailColumns, detailRows),
      billGridSheet('文件清单', fileColumns, fileRows),
    ]);
  }
  async function billResultsToXlsx(results) {
    const columns = ['文件名'];
    const seen = new Set(columns);
    const rows = [];
    for (const r of results) {
      const row = { 文件名: r.file_name };
      if (!r.ok) {
        row.错误原因 = r.error || '';
        if (!seen.has('错误原因')) { columns.push('错误原因'); seen.add('错误原因'); }
      } else {
        for (const pair of r.items || []) {
          const name = billText(pair[0]);
          if (!name) continue;
          row[name] = billText(pair[1]);
          if (!seen.has(name)) { columns.push(name); seen.add(name); }
        }
        row.识别金额 = r.amount ? r.amount.toFixed(2) : '';
        if (!seen.has('识别金额')) { columns.push('识别金额'); seen.add('识别金额'); }
      }
      rows.push(row);
    }
    return buildXlsxBlob([billGridSheet('识别结果', columns, rows.map(r => columns.map(c => r[c] || '')))]);
  }
  function billSummaryText(lines) {
    return billTextBlob(lines.join('\r\n') + '\r\n');
  }
  async function billZipFiles(entries) {
    const zip = new JSZip();
    for (const e of entries) zip.file(e.name, e.blob || e.file);
    return zip.generateAsync({ type: 'blob', compression: 'STORE' });
  }
  /** 按记录顺序合成 PDF（PDF 直接拷贝页面，图片转成一页，OFD 跳过）。 */
  async function billMergeRecordsToPdf(records, onStep) {
    const out = await PDFLib.PDFDocument.create();
    const merged = [], skipped = [];
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (onStep) onStep(i, records.length, rec.file_name);
      const ext = billExt(rec.file_name);
      try {
        if (ext === '.pdf') {
          const src = await loadPdfDoc(rec.file);
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach(p => out.addPage(p));
          merged.push(rec.file_name);
        } else if (billIsImage(rec.file_name)) {
          const bitmap = await createImageBitmap(rec.file);
          const cv = document.createElement('canvas');
          cv.width = bitmap.width; cv.height = bitmap.height;
          cv.getContext('2d').drawImage(bitmap, 0, 0);
          bitmap.close();
          const png = await canvasToBlob(cv, 'image/png');
          const img = await out.embedPng(await png.arrayBuffer());
          const scale = Math.min(555 / cv.width, 802 / cv.height);
          const w = cv.width * scale, h = cv.height * scale;
          const page = out.addPage([595.28, 841.89]);
          page.drawImage(img, { x: (595.28 - w) / 2, y: (841.89 - h) / 2, width: w, height: h });
          merged.push(rec.file_name);
        } else {
          skipped.push([rec.file_name, ext === '.ofd' ? 'OFD 格式暂不支持合成 PDF' : '不支持的文件格式']);
        }
      } catch (e) {
        skipped.push([rec.file_name, e && e.message ? e.message : String(e)]);
      }
    }
    if (!merged.length) throw new Error('没有可合并的文件：' + (skipped[0] ? skipped[0][1] : '请检查输入文件'));
    const bytes = await out.save();
    return { blob: bytesToBlob(bytes, 'application/pdf'), merged, skipped };
  }
  /** 浏览器无法原地改名：把重命名副本与说明打包成 ZIP 供下载。 */
  async function billRenamedZip(plan, report) {
    const entries = [{ name: '00_重命名说明.txt', blob: billTextBlob(report) }];
    for (const p of plan) entries.push({ name: p.new_name, file: p.record.file });
    return billZipFiles(entries);
  }

  /* ---------------- Excel 序时簿号码导入 ---------------- */
  function billCellText(v) {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    return String(v).replace(/^\ufeff/, '').replace(/\u3000/g, ' ').trim();
  }
  function billIsInvoiceLike(text) {
    if (!text || text.length > 40 || BILL_SKIP_WORDS.has(text)) return false;
    if ((text.match(/\d/g) || []).length < 4) return false;
    return /^[0-9A-Za-z\- ]+$/.test(text);
  }
  function billColumnLetter(i) {
    let s = '', n = i + 1;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
    return s;
  }
  async function billReadOrderSheets(file) {
    const name = String(file.name || '').toLowerCase();
    if (/\.(xlsx|xlsm)$/.test(name)) return parseXlsxFile(file);
    if (/\.(csv|txt)$/.test(name)) {
      // Excel 导出的 CSV 常带 UTF-8 BOM，备注字段也可能含逗号/引号；
      // 简单 split 会吞掉首个号码或把一列拆成两列，导致候选列识别错乱。
      const text = (await file.text()).replace(/^\ufeff/, '');
      const grid = text.split(/\r?\n/).map(line => {
        const cells = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (inQ) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') inQ = false;
            else cur += ch;
          } else if (ch === '"') inQ = true;
          else if (/[,;\t，]/.test(ch)) { cells.push(cur.trim()); cur = ''; }
          else cur += ch;
        }
        cells.push(cur.trim());
        return cells;
      });
      return [{ name: baseName(file.name), grid }];
    }
    if (/\.xls$/.test(name)) {
      // BIFF8 的共享字符串常以压缩 Latin-1 保存，直接按首次出现顺序提取长数字串，
      // 与 xlrd 读出的列顺序一致；无需引入额外的 OLE2/BIFF 解析依赖。
      const bytes = new Uint8Array(await file.arrayBuffer());
      const chunks = [];
      for (let i = 0; i < bytes.length; i += 8192) {
        chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
      }
      const latin = chunks.join('');
      let utf16 = '';
      try { utf16 = new TextDecoder('utf-16le').decode(bytes); } catch (e) { /* ignore */ }
      const collect = pattern => {
        const found = [];
        const seen = new Set();
        for (const source of [latin, utf16]) {
          for (const m of source.matchAll(pattern)) {
            const v = m[1];
            if (!seen.has(v)) { seen.add(v); found.push(v); }
          }
        }
        return found;
      };
      // 先严格匹配 20 位数电票号码，避免账号 / 税号混入；没有时再放宽位数
      const found = collect(/(?<!\d)(\d{20})(?!\d)/g);
      const loose = found.length ? found : collect(/(?<!\d)(\d{18,24})(?!\d)/g);
      if (!loose.length) throw new Error('未在该 .xls 文件中找到发票号码（可另存为 .xlsx 后重试）');
      return [{ name: '序时簿（二进制提取）', grid: [['发票号码']].concat(loose.map(v => [v])) }];
    }
    throw new Error('仅支持 .xlsx / .xls / .xlsm / .csv / .txt 序时簿文件');
  }
  function billScanOrderCandidates(sheets, preferredLength) {
    let pref = parseInt(preferredLength, 10);
    if (!Number.isFinite(pref) || pref < 4 || pref > 40) pref = 20;
    const candidates = [];
    for (const sheet of sheets || []) {
      const rows = sheet.grid || [];
      const columnCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
      for (let col = 0; col < Math.min(columnCount, 120); col++) {
        let header = '', headerRow = -1, weight = 0, fallback = '', fallbackRow = -1;
        for (let r = 0; r < Math.min(20, rows.length); r++) {
          const text = billCellText(rows[r][col]);
          if (!text) continue;
          if (fallbackRow < 0 && !billIsInvoiceLike(text) && text.length <= 40) { fallback = text; fallbackRow = r; }
          for (const [kw, w] of BILL_HEADER_KEYWORDS) {
            if (text.includes(kw)) { if (w > weight) { weight = w; header = text; headerRow = r; } break; }
          }
        }
        if (!weight && fallbackRow >= 0) { header = fallback; headerRow = fallbackRow; }
        const values = [];
        const seen = new Set();
        for (let r = Math.max(0, headerRow + 1); r < rows.length; r++) {
          const text = billCellText(rows[r][col]);
          if (!billIsInvoiceLike(text) || seen.has(text)) continue;
          seen.add(text); values.push(text);
        }
        if (!values.length) continue;
        if (headerRow < 0) header = billColumnLetter(col) + ' 列（无表头）';
        const lengths = new Map();
        for (const v of values) {
          const len = (v.match(/\d/g) || []).length;
          lengths.set(len, (lengths.get(len) || 0) + 1);
        }
        let dominant = 0, dominantCount = 0;
        for (const [len, count] of lengths) if (count > dominantCount) { dominant = len; dominantCount = count; }
        const ratio = dominantCount / values.length;
        const lengthMatch = dominant === pref;
        const score = lengthMatch
          ? 1000000 + (weight >= 85 ? 500000 : weight * 10) + Math.min(values.length, 999) * 1000 + Math.round(ratio * 100)
          : weight * 1000 + Math.min(values.length, 999);
        candidates.push({
          sheet: sheet.name, column: col, header, header_row: headerRow, count: values.length,
          keyword: weight > 0, length: dominant, length_ratio: ratio, length_match: lengthMatch, score,
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score || b.count - a.count || a.sheet.localeCompare(b.sheet) || a.column - b.column);
    const list = candidates.slice(0, 40);
    let suggested = -1;
    if (list.some(c => c.length_match)) suggested = 0;
    else {
      const i = list.findIndex(c => c.keyword);
      if (i >= 0) suggested = i;
    }
    return { candidates: list, suggested, preferred_length: pref };
  }
  function billReadOrderNumbers(sheets, candidate) {
    const sheet = (sheets || []).find(s => s.name === candidate.sheet);
    if (!sheet) return [];
    const grid = sheet.grid || [];
    const start = Math.max(0, (candidate.header_row || -1) + 1);
    const numbers = [], seen = new Set();
    for (let r = start; r < grid.length; r++) {
      const text = billCellText(grid[r][candidate.column]);
      if (!billIsInvoiceLike(text) || seen.has(text)) continue;
      seen.add(text); numbers.push(text);
      if (numbers.length >= 5000) break;
    }
    return numbers;
  }
  async function billImportOrder(file, preferredLength) {
    const sheets = await billReadOrderSheets(file);
    const scan = billScanOrderCandidates(sheets, preferredLength);
    const selected = scan.suggested >= 0 ? scan.candidates[scan.suggested] : null;
    const numbers = selected ? billReadOrderNumbers(sheets, selected) : [];
    return {
      file_name: file.name, sheets: sheets.map(s => s.name), candidates: scan.candidates,
      selected, numbers, preferred_length: scan.preferred_length,
    };
  }
  async function billResolveOrder(ctx, records, mode) {
    const file = ctx.get('orderFile');
    if (file && typeof file.arrayBuffer === 'function') {
      const imported = await billImportOrder(file, billPreferredLength(records));
      if (imported.numbers.length) {
        return { text: imported.numbers.join('\n'), mode: 'custom', source: imported, warning: '' };
      }
      return {
        text: ctx.get('customOrder') || '', mode, source: imported,
        warning: '序时簿未找到可用的发票号码列，已忽略该文件并按当前顺序处理',
      };
    }
    return { text: ctx.get('customOrder') || '', mode, source: null, warning: '' };
  }
