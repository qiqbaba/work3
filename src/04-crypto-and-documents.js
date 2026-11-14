  /* ============================================================
     4. 加密基础与文档格式（纯 JS）
     MD5 / SHA-2 / RC4 / AES、PDF 标准安全处理器（R2-R6）、
     Office 格式（docx / xlsx / pptx）解析与生成
     ============================================================ */
  function utf8ToBytes(str) { return new TextEncoder().encode(str); }
  function latin1ToBytes(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }
  function bytesToHex(b) {
    let s = '';
    for (let i = 0; i < b.length; i++) s += (b[i] + 0x100).toString(16).slice(1);
    return s;
  }
  function hexToBytes(hex) {
    const clean = String(hex).replace(/[^0-9A-Fa-f]/g, '');
    const out = new Uint8Array(clean.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  function concatBytes(list) {
    let n = 0;
    for (const a of list) n += a.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const a of list) { out.set(a, o); o += a.length; }
    return out;
  }
  function xorKeyBytes(key, x) {
    const out = new Uint8Array(key.length);
    for (let i = 0; i < key.length; i++) out[i] = key[i] ^ x;
    return out;
  }
  function secureRandom(n) {
    const out = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(out);
    else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
  }
  function u32le(n) {
    return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  }
  function bytesEqual(a, b, n) {
    const len = n == null ? a.length : n;
    if (a.length < len || b.length < len) return false;
    for (let i = 0; i < len; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /* ---- MD5 ---- */
  const MD5_S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const MD5_K = [0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391];
  function md5Bytes(input) {
    const msg = input;
    const n = msg.length;
    const total = (((n + 8) >> 6) + 1) * 64;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[n] = 0x80;
    const bitLen = n * 8;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, bitLen >>> 0, true);
    dv.setUint32(total - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const w = new Uint32Array(16);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, true);
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * i) % 16; }
        const tmp = d;
        d = c; c = b;
        const sum = (a + f + MD5_K[i] + w[g]) | 0;
        b = (b + ((sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i])))) | 0;
        a = tmp;
      }
      a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
    }
    const out = new Uint8Array(16);
    const odv = new DataView(out.buffer);
    odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
    odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
    return out;
  }

  /* ---- SHA-256 ---- */
  const SHA256_H0 = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const SHA256_K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
  function sha256Bytes(input) {
    const msg = input;
    const n = msg.length;
    const total = (((n + 8) >> 6) + 1) * 64;
    const buf = new Uint8Array(total);
    buf.set(msg); buf[n] = 0x80;
    const bitLen = n * 8;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);
    dv.setUint32(total - 4, bitLen >>> 0, false);
    const h = Uint32Array.from(SHA256_H0);
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = (rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i++) {
        const S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
        const S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i], false);
    return out;
  }

  /* ---- SHA-512 / SHA-384（BigInt） ---- */
  const M64 = 0xffffffffffffffffn;
  function rotr64(x, n) { return ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64; }
  const SHA512_H0 = [0x6a09e667f3bcc908n,0xbb67ae8584caa73bn,0x3c6ef372fe94f82bn,0xa54ff53a5f1d36f1n,0x510e527fade682d1n,0x9b05688c2b3e6c1fn,0x1f83d9abfb41bd6bn,0x5be0cd19137e2179n];
  const SHA384_H0 = [0xcbbb9d5dc1059ed8n,0x629a292a367cd507n,0x9159015a3070dd17n,0x152fecd8f70e5939n,0x67332667ffc00b31n,0x8eb44a8768581511n,0xdb0c2e0d64f98fa7n,0x47b5481dbefa4fa4n];
  const SHA512_K = [0x428a2f98d728ae22n,0x7137449123ef65cdn,0xb5c0fbcfec4d3b2fn,0xe9b5dba58189dbbcn,0x3956c25bf348b538n,0x59f111f1b605d019n,0x923f82a4af194f9bn,0xab1c5ed5da6d8118n,0xd807aa98a3030242n,0x12835b0145706fben,0x243185be4ee4b28cn,0x550c7dc3d5ffb4e2n,0x72be5d74f27b896fn,0x80deb1fe3b1696b1n,0x9bdc06a725c71235n,0xc19bf174cf692694n,0xe49b69c19ef14ad2n,0xefbe4786384f25e3n,0x0fc19dc68b8cd5b5n,0x240ca1cc77ac9c65n,0x2de92c6f592b0275n,0x4a7484aa6ea6e483n,0x5cb0a9dcbd41fbd4n,0x76f988da831153b5n,0x983e5152ee66dfabn,0xa831c66d2db43210n,0xb00327c898fb213fn,0xbf597fc7beef0ee4n,0xc6e00bf33da88fc2n,0xd5a79147930aa725n,0x06ca6351e003826fn,0x142929670a0e6e70n,0x27b70a8546d22ffcn,0x2e1b21385c26c926n,0x4d2c6dfc5ac42aedn,0x53380d139d95b3dfn,0x650a73548baf63den,0x766a0abb3c77b2a8n,0x81c2c92e47edaee6n,0x92722c851482353bn,0xa2bfe8a14cf10364n,0xa81a664bbc423001n,0xc24b8b70d0f89791n,0xc76c51a30654be30n,0xd192e819d6ef5218n,0xd69906245565a910n,0xf40e35855771202an,0x106aa07032bbd1b8n,0x19a4c116b8d2d0c8n,0x1e376c085141ab53n,0x2748774cdf8eeb99n,0x34b0bcb5e19b48a8n,0x391c0cb3c5c95a63n,0x4ed8aa4ae3418acbn,0x5b9cca4f7763e373n,0x682e6ff3d6b2b8a3n,0x748f82ee5defb2fcn,0x78a5636f43172f60n,0x84c87814a1f0ab72n,0x8cc702081a6439ecn,0x90befffa23631e28n,0xa4506cebde82bde9n,0xbef9a3f7b2c67915n,0xc67178f2e372532bn,0xca273eceea26619cn,0xd186b8c721c0c207n,0xeada7dd6cde0eb1en,0xf57d4f7fee6ed178n,0x06f067aa72176fban,0x0a637dc5a2c898a6n,0x113f9804bef90daen,0x1b710b35131c471bn,0x28db77f523047d84n,0x32caab7b40c72493n,0x3c9ebe0a15c9bebcn,0x431d67c49c100d4cn,0x4cc5d4becb3e42b6n,0x597f299cfc657e2an,0x5fcb6fab3ad6faecn,0x6c44198c4a475817n];
  function sha512Bytes(input, variant) {
    const msg = input;
    const n = msg.length;
    // 填充后总长须为 128 的整数倍且至少容纳 0x80 与 16 字节长度（n+17）。
    const total = (((n + 16) >> 7) + 1) * 128;
    const buf = new Uint8Array(total);
    buf.set(msg); buf[n] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setBigUint64(total - 8, BigInt(n) * 8n, false);
    const h = (variant === 384 ? SHA384_H0 : SHA512_H0).slice();
    const w = new Array(80);
    for (let off = 0; off < total; off += 128) {
      for (let i = 0; i < 16; i++) w[i] = dv.getBigUint64(off + i * 8, false);
      for (let i = 16; i < 80; i++) {
        const s0 = (rotr64(w[i - 15], 1) ^ rotr64(w[i - 15], 8) ^ (w[i - 15] >> 7n)) & M64;
        const s1 = (rotr64(w[i - 2], 19) ^ rotr64(w[i - 2], 61) ^ (w[i - 2] >> 6n)) & M64;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & M64;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 80; i++) {
        const S1 = (rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41)) & M64;
        const ch = ((e & f) ^ ((~e) & g)) & M64;
        const t1 = (hh + S1 + ch + SHA512_K[i] + w[i]) & M64;
        const S0 = (rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39)) & M64;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) & M64;
        const t2 = (S0 + maj) & M64;
        hh = g; g = f; f = e; e = (d + t1) & M64; d = c; c = b; b = a; a = (t1 + t2) & M64;
      }
      h[0] = (h[0] + a) & M64; h[1] = (h[1] + b) & M64; h[2] = (h[2] + c) & M64; h[3] = (h[3] + d) & M64;
      h[4] = (h[4] + e) & M64; h[5] = (h[5] + f) & M64; h[6] = (h[6] + g) & M64; h[7] = (h[7] + hh) & M64;
    }
    const outLen = variant === 384 ? 48 : 64;
    const out = new Uint8Array(outLen);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < outLen / 8; i++) odv.setBigUint64(i * 8, h[i], false);
    return out;
  }

  /* ---- RC4 ---- */
  function rc4Bytes(key, data) {
    const S = new Uint8Array(256);
    for (let i = 0; i < 256; i++) S[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 0xff;
      const t = S[i]; S[i] = S[j]; S[j] = t;
    }
    const out = new Uint8Array(data.length);
    let i = 0; j = 0;
    for (let k = 0; k < data.length; k++) {
      i = (i + 1) & 0xff; j = (j + S[i]) & 0xff;
      const t = S[i]; S[i] = S[j]; S[j] = t;
      out[k] = data[k] ^ S[(S[i] + S[j]) & 0xff];
    }
    return out;
  }

  /* ---- AES ---- */
  const AES_SBOX = new Uint8Array([99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22]);
  const AES_INV_SBOX = new Uint8Array(256);
  for (let i = 0; i < 256; i++) AES_INV_SBOX[AES_SBOX[i]] = i;
  function xtime(a) { return ((a << 1) ^ (a & 0x80 ? 0x11b : 0)) & 0xff; }
  function gfMul(a, b) {
    let r = 0;
    while (b) {
      if (b & 1) r ^= a;
      a = xtime(a);
      b >>>= 1;
    }
    return r & 0xff;
  }
  function aesExpandKey(key) {
    const nk = key.length / 4;
    const nr = nk + 6;
    const w = new Uint8Array(16 * (nr + 1));
    w.set(key);
    let bytes = key.length;
    let rcon = 1;
    while (bytes < w.length) {
      let t = [w[bytes - 4], w[bytes - 3], w[bytes - 2], w[bytes - 1]];
      if (bytes % (4 * nk) === 0) {
        t = [AES_SBOX[t[1]] ^ rcon, AES_SBOX[t[2]], AES_SBOX[t[3]], AES_SBOX[t[0]]];
        rcon = xtime(rcon);
      } else if (nk > 6 && bytes % (4 * nk) === 16) {
        t = [AES_SBOX[t[0]], AES_SBOX[t[1]], AES_SBOX[t[2]], AES_SBOX[t[3]]];
      }
      for (let i = 0; i < 4; i++) w[bytes + i] = w[bytes - 4 * nk + i] ^ t[i];
      bytes += 4;
    }
    return { w, nr };
  }
  function aesAddRoundKey(s, w, round) {
    for (let i = 0; i < 16; i++) s[i] ^= w[round * 16 + i];
  }
  function aesEncryptBlock(rk, block) {
    const s = new Uint8Array(block);
    aesAddRoundKey(s, rk.w, 0);
    for (let round = 1; round <= rk.nr; round++) {
      for (let i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]];
      for (let r = 1; r < 4; r++) {
        const tmp = [s[r], s[r + 4], s[r + 8], s[r + 12]];
        for (let c = 0; c < 4; c++) s[r + 4 * c] = tmp[(c + r) % 4];
      }
      if (round < rk.nr) {
        for (let c = 0; c < 4; c++) {
          const i = 4 * c;
          const v0 = s[i], v1 = s[i + 1], v2 = s[i + 2], v3 = s[i + 3];
          s[i] = xtime(v0) ^ (xtime(v1) ^ v1) ^ v2 ^ v3;
          s[i + 1] = v0 ^ xtime(v1) ^ (xtime(v2) ^ v2) ^ v3;
          s[i + 2] = v0 ^ v1 ^ xtime(v2) ^ (xtime(v3) ^ v3);
          s[i + 3] = (xtime(v0) ^ v0) ^ v1 ^ v2 ^ xtime(v3);
        }
      }
      aesAddRoundKey(s, rk.w, round);
    }
    return s;
  }
  function aesDecryptBlock(rk, block) {
    const s = new Uint8Array(block);
    aesAddRoundKey(s, rk.w, rk.nr);
    for (let round = rk.nr - 1; round >= 0; round--) {
      for (let r = 1; r < 4; r++) {
        const tmp = [s[r], s[r + 4], s[r + 8], s[r + 12]];
        for (let c = 0; c < 4; c++) s[r + 4 * c] = tmp[(c + 4 - r) % 4];
      }
      for (let i = 0; i < 16; i++) s[i] = AES_INV_SBOX[s[i]];
      aesAddRoundKey(s, rk.w, round);
      if (round > 0) {
        for (let c = 0; c < 4; c++) {
          const i = 4 * c;
          const v0 = s[i], v1 = s[i + 1], v2 = s[i + 2], v3 = s[i + 3];
          s[i] = gfMul(v0, 14) ^ gfMul(v1, 11) ^ gfMul(v2, 13) ^ gfMul(v3, 9);
          s[i + 1] = gfMul(v0, 9) ^ gfMul(v1, 14) ^ gfMul(v2, 11) ^ gfMul(v3, 13);
          s[i + 2] = gfMul(v0, 13) ^ gfMul(v1, 9) ^ gfMul(v2, 14) ^ gfMul(v3, 11);
          s[i + 3] = gfMul(v0, 11) ^ gfMul(v1, 13) ^ gfMul(v2, 9) ^ gfMul(v3, 14);
        }
      }
    }
    return s;
  }
  function aesCbcEncrypt(key, iv, data) {
    const rk = aesExpandKey(key);
    const out = new Uint8Array(data.length);
    let prev = iv;
    for (let i = 0; i < data.length; i += 16) {
      const blk = new Uint8Array(16);
      for (let j = 0; j < 16; j++) blk[j] = data[i + j] ^ prev[j];
      const enc = aesEncryptBlock(rk, blk);
      out.set(enc, i);
      prev = enc;
    }
    return out;
  }
  function aesCbcDecrypt(key, iv, data) {
    const rk = aesExpandKey(key);
    const out = new Uint8Array(data.length);
    let prev = iv;
    for (let i = 0; i < data.length; i += 16) {
      const dec = aesDecryptBlock(rk, data.subarray(i, i + 16));
      for (let j = 0; j < 16; j++) out[i + j] = dec[j] ^ prev[j];
      prev = data.subarray(i, i + 16);
    }
    return out;
  }
  function aesPkcs7Pad(data) {
    const pad = 16 - (data.length % 16);
    const out = new Uint8Array(data.length + pad);
    out.set(data);
    out.fill(pad, data.length);
    return out;
  }
  function aesPkcs7Unpad(data) {
    if (!data.length) return data;
    const pad = data[data.length - 1];
    if (pad < 1 || pad > 16) return data;
    return data.subarray(0, data.length - pad);
  }

  /* ---- PDF 标准安全处理器（V1/V2 R2-R3 RC4、V4 R4 AES-128、V5 R5/R6 AES-256） ---- */
  const PDF_PAD = hexToBytes('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A');
  function pdfPadPassword(pwd) {
    const out = new Uint8Array(32);
    const n = Math.min(32, pwd.length);
    out.set(pwd.subarray(0, n));
    out.set(PDF_PAD.subarray(0, 32 - n), n);
    return out;
  }
  function pdfR234FileKey(pwd, O, P, ID1, R, keyLen, metaEnc) {
    const parts = [pdfPadPassword(pwd), O, u32le(P >>> 0), ID1];
    if (R >= 4 && !metaEnc) parts.push(new Uint8Array([255, 255, 255, 255]));
    let h = md5Bytes(concatBytes(parts));
    if (R >= 3) for (let i = 0; i < 50; i++) h = md5Bytes(h.subarray(0, keyLen));
    return h.slice(0, keyLen);
  }
  function pdfOKey(ownerPwd, R, keyLen) {
    let h = md5Bytes(pdfPadPassword(ownerPwd));
    if (R >= 3) for (let i = 0; i < 50; i++) h = md5Bytes(h);
    return h.slice(0, keyLen);
  }
  function pdfOValue(oKey, userPwd, R) {
    let o = rc4Bytes(oKey, pdfPadPassword(userPwd));
    if (R >= 3) for (let i = 1; i < 20; i++) o = rc4Bytes(xorKeyBytes(oKey, i), o);
    return o;
  }
  function pdfUValue(fileKey, R, ID1) {
    if (R <= 2) return rc4Bytes(fileKey, PDF_PAD);
    let u = rc4Bytes(fileKey, md5Bytes(concatBytes([PDF_PAD, ID1])));
    for (let i = 1; i < 20; i++) u = rc4Bytes(xorKeyBytes(fileKey, i), u);
    return concatBytes([u, PDF_PAD.subarray(0, 16)]);
  }
  function pdfVerifyR234(pwd, enc, ID1, keyLen, metaEnc) {
    const key = pdfR234FileKey(pwd, enc.O, enc.P, ID1, enc.R, keyLen, metaEnc);
    const u = pdfUValue(key, enc.R, ID1);
    return bytesEqual(u, enc.U, enc.R >= 3 ? 16 : 32) ? key : null;
  }
  function pdfVerifyOwnerR234(ownerPwd, enc, ID1, keyLen, metaEnc) {
    const oKey = pdfOKey(ownerPwd, enc.R, keyLen);
    let userPad;
    if (enc.R <= 2) userPad = rc4Bytes(oKey, enc.O);
    else {
      userPad = enc.O;
      for (let i = 19; i >= 0; i--) userPad = rc4Bytes(xorKeyBytes(oKey, i), userPad);
    }
    return pdfVerifyR234(userPad, enc, ID1, keyLen, metaEnc);
  }
  function pdfHash56(R, pwd, salt, udata) {
    let k = sha256Bytes(concatBytes([pwd, salt, udata]));
    if (R < 6) return k;
    let count = 0;
    for (;;) {
      count++;
      const k1 = concatBytes([pwd, k, udata]);
      const rep = new Uint8Array(k1.length * 64);
      for (let i = 0; i < 64; i++) rep.set(k1, i * k1.length);
      const e = aesCbcEncrypt(k.subarray(0, 16), k.subarray(16, 32), rep);
      let sum = 0;
      for (let i = 0; i < 16; i++) sum += e[i];
      const fn = [sha256Bytes, d => sha512Bytes(d, 384), d => sha512Bytes(d, 512)][sum % 3];
      k = fn(e);
      if (count >= 64 && e[e.length - 1] <= count - 32) break;
    }
    return k.subarray(0, 32);
  }
  function pdfVerifyR56(pwd, enc, side) {
    const p = pwd.subarray(0, 127);
    const zero = new Uint8Array(0);
    if (side === 'user') {
      const U = enc.U;
      if (!bytesEqual(pdfHash56(enc.R, p, U.subarray(32, 40), zero), U.subarray(0, 32))) return null;
      return aesCbcDecrypt(pdfHash56(enc.R, p, U.subarray(40, 48), zero), new Uint8Array(16), enc.UE);
    }
    const O = enc.O;
    const u48 = enc.U.subarray(0, 48);
    if (!bytesEqual(pdfHash56(enc.R, p, O.subarray(32, 40), u48), O.subarray(0, 32))) return null;
    return aesCbcDecrypt(pdfHash56(enc.R, p, O.subarray(40, 48), u48), new Uint8Array(16), enc.OE);
  }
  function pdfObjectKey(fileKey, V, keyLen, idnum, gen, aes) {
    if (V >= 5) return fileKey;
    const n = V === 1 ? 5 : keyLen;
    const data = concatBytes([
      fileKey.subarray(0, n),
      new Uint8Array([idnum & 0xff, (idnum >>> 8) & 0xff, (idnum >>> 16) & 0xff, gen & 0xff, (gen >>> 8) & 0xff]),
    ]);
    const h = md5Bytes(aes ? concatBytes([data, latin1ToBytes('sAlT')]) : data);
    return h.subarray(0, Math.min(n + 5, 16));
  }
  function pdfCryptRaw(data, info, idnum, gen, encrypt) {
    const cfm = info.cfm;
    if (cfm === 'Identity') return data;
    const aesRoundTrip = (key) => {
      if (encrypt) {
        const iv = secureRandom(16);
        return concatBytes([iv, aesCbcEncrypt(key, iv, aesPkcs7Pad(data))]);
      }
      if (data.length < 16 || (data.length % 16) !== 0) return data;
      return aesPkcs7Unpad(aesCbcDecrypt(key, data.subarray(0, 16), data.subarray(16)));
    };
    if (cfm === 'AESV3') return aesRoundTrip(info.fileKey);
    const useAes = cfm === 'AESV2';
    const key = pdfObjectKey(info.fileKey, info.V, info.keyLen, idnum, gen, useAes);
    return useAes ? aesRoundTrip(key) : rc4Bytes(key, data);
  }
  function pdfReadEncryptInfo(doc) {
    const ti = doc.context.trailerInfo;
    if (!ti.Encrypt) return null;
    const encObj = doc.context.lookup(ti.Encrypt) || ti.Encrypt;
    if (!(encObj instanceof PDFLib.PDFDict)) return null;
    const num = k => {
      try { const v = encObj.lookup(PDFLib.PDFName.of(k)); return v && typeof v.asNumber === 'function' ? v.asNumber() : null; }
      catch (e) { return null; }
    };
    const byt = k => {
      try { const v = encObj.lookup(PDFLib.PDFName.of(k)); return v && v.asBytes ? v.asBytes() : null; }
      catch (e) { return null; }
    };
    const V = num('V') || 0;
    const R = num('R') || 0;
    const keyLen = (num('Length') || (V === 1 ? 40 : V >= 5 ? 256 : 128)) / 8;
    const P = (num('P') || 0) | 0;
    const O = byt('O'), U = byt('U');
    if (!O || !U) throw new Error('无法解析加密字典');
    const OE = byt('OE') || new Uint8Array(0), UE = byt('UE') || new Uint8Array(0);
    let ID1 = new Uint8Array(0);
    try {
      const idArr = ti.ID;
      const first = idArr && idArr.lookup ? idArr.lookup(0) : null;
      if (first && first.asBytes) ID1 = first.asBytes();
    } catch (e) { /* ignore */ }
    const info = { V, R, P, O, U, OE, UE, ID1, keyLen, metaEnc: true, cfm: 'V2', encRef: ti.Encrypt };
    if (V >= 4) {
      try {
        const me = encObj.lookup(PDFLib.PDFName.of('EncryptMetadata'));
        if (me && String(me) === 'false') info.metaEnc = false;
      } catch (e) { /* ignore */ }
      let cfm = 'V2';
      try {
        const cf = encObj.lookupMaybe(PDFLib.PDFName.of('CF'), PDFLib.PDFDict);
        const std = cf && cf.lookupMaybe(PDFLib.PDFName.of('StdCF'), PDFLib.PDFDict);
        const mode = std ? String(std.lookup(PDFLib.PDFName.of('CFM'))) : '';
        if (mode === '/AESV2') cfm = 'AESV2';
        else if (mode === '/AESV3') cfm = 'AESV3';
        else if (mode === '/Identity') cfm = 'Identity';
      } catch (e) { /* ignore */ }
      if (V >= 5) cfm = 'AESV3';
      info.cfm = cfm;
    }
    return info;
  }
  function pdfDeriveFileKey(password, enc) {
    const pwd = enc.R >= 5 ? utf8ToBytes(password || '').subarray(0, 127) : latin1ToBytes(password || '');
    if (enc.R >= 5) {
      return pdfVerifyR56(pwd, enc, 'user') || pdfVerifyR56(pwd, enc, 'owner');
    }
    return pdfVerifyR234(pwd, enc, enc.ID1, enc.keyLen, enc.metaEnc)
      || pdfVerifyOwnerR234(pwd, enc, enc.ID1, enc.keyLen, enc.metaEnc);
  }
  function pdfCryptWalk(doc, enc, encrypt) {
    const info = enc;
    const skipObjs = new Set();
    if (!encrypt && info.encRef) {
      const encObj = doc.context.lookup(info.encRef);
      if (encObj) skipObjs.add(encObj);
    }
    const transform = (obj, idnum, gen, depth) => {
      if (!obj || depth > 25) return obj;
      if (obj instanceof PDFLib.PDFString || obj instanceof PDFLib.PDFHexString) {
        const raw = obj.asBytes();
        if (!raw || !raw.length) return obj;
        return PDFLib.PDFHexString.of(bytesToHex(pdfCryptRaw(raw, info, idnum, gen, encrypt)));
      }
      if (obj.contents instanceof Uint8Array && obj.dict instanceof PDFLib.PDFDict) {
        const type = safeLookup(obj.dict, 'Type', PDFLib.PDFName);
        const isMeta = type && String(type) === '/Metadata';
        if (!(isMeta && !info.metaEnc && !encrypt)) {
          if (obj.contents.length) obj.contents = pdfCryptRaw(obj.contents, info, idnum, gen, encrypt);
          try { obj.dict.set(PDFLib.PDFName.of('Length'), PDFLib.PDFNumber.of(obj.contents.length)); } catch (e) { /* ignore */ }
        }
        for (const key of obj.dict.keys()) {
          const v = obj.dict.get(key);
          obj.dict.set(key, transform(v, idnum, gen, depth + 1));
        }
        return obj;
      }
      if (obj instanceof PDFLib.PDFDict) {
        const isSig = String(safeLookup(obj, 'Type', PDFLib.PDFName) || '') === '/Sig';
        for (const key of obj.keys()) {
          if (isSig && String(key) === '/Contents') continue;
          obj.set(key, transform(obj.get(key), idnum, gen, depth + 1));
        }
        return obj;
      }
      if (obj instanceof PDFLib.PDFArray) {
        for (let i = 0; i < obj.size(); i++) obj.set(i, transform(obj.get(i), idnum, gen, depth + 1));
        return obj;
      }
      return obj;
    };
    for (const entry of doc.context.enumerateIndirectObjects()) {
      const ref = entry[0], obj = entry[1];
      if (skipObjs.has(obj)) continue;
      const idnum = typeof ref.objectNumber === 'number' ? ref.objectNumber : Number(String(ref).split(' ')[0]);
      const gen = typeof ref.generationNumber === 'number' ? ref.generationNumber : Number(String(ref).split(' ')[1]) || 0;
      transform(obj, idnum, gen, 0);
    }
  }
  function pdfEncryptDoc(doc, userPwd) {
    const ownerPwd = userPwd;
    const ti = doc.context.trailerInfo;
    const id1 = secureRandom(16), id2 = secureRandom(16);
    const idArr = PDFLib.PDFArray.withContext(doc.context);
    idArr.push(PDFLib.PDFHexString.of(bytesToHex(id1)));
    idArr.push(PDFLib.PDFHexString.of(bytesToHex(id2)));
    ti.ID = idArr;
    const R = 3, V = 2, keyLen = 16, P = -4;
    const O = pdfOValue(pdfOKey(ownerPwd, R, keyLen), userPwd, R);
    const fileKey = pdfR234FileKey(userPwd, O, P, id1, R, keyLen, true);
    const U = pdfUValue(fileKey, R, id1);
    const info = { V, R, P, O, U, ID1: id1, keyLen, metaEnc: true, cfm: 'V2', fileKey };
    pdfCryptWalk(doc, info, true);
    const enc = PDFLib.PDFDict.withContext(doc.context);
    enc.set(PDFLib.PDFName.of('Filter'), PDFLib.PDFName.of('Standard'));
    enc.set(PDFLib.PDFName.of('V'), PDFLib.PDFNumber.of(V));
    enc.set(PDFLib.PDFName.of('R'), PDFLib.PDFNumber.of(R));
    enc.set(PDFLib.PDFName.of('Length'), PDFLib.PDFNumber.of(128));
    enc.set(PDFLib.PDFName.of('P'), PDFLib.PDFNumber.of(P));
    enc.set(PDFLib.PDFName.of('O'), PDFLib.PDFHexString.of(bytesToHex(O)));
    enc.set(PDFLib.PDFName.of('U'), PDFLib.PDFHexString.of(bytesToHex(U)));
    ti.Encrypt = doc.context.register(enc);
  }

  /* ---- Office 格式：docx / xlsx 生成与解析、pptx 解析 ---- */
  function xmlEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function buildDocxBlob(pages) {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    let body = '';
    pages.forEach((lines, pi) => {
      for (const ln of lines) body += '<w:p><w:r><w:t xml:space="preserve">' + xmlEsc(ln) + '</w:t></w:r></w:p>';
      if (pi < pages.length - 1) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    });
    zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>');
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  }
  function buildXlsxBlob(sheets) {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => '<sheet name="' + xmlEsc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '</Relationships>');
    sheets.forEach((sheet, si) => {
      const colLetter = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
      const rowsXml = sheet.grid.map((row, ri) => {
        // 0 / false 也是有效数据，不能用真假值判断是否输出单元格。
        const cells = row.map((cell, ci) => (cell == null || cell === '')
          ? '' : '<c r="' + colLetter(ci) + (ri + 1) + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(cell) + '</t></is></c>').join('');
        return cells ? '<row r="' + (ri + 1) + '">' + cells + '</row>' : '';
      }).join('');
      const cols = [];
      for (let ci = 0; ci < (sheet.colWidths ? sheet.colWidths.length : 0); ci++) cols.push('<col min="' + (ci + 1) + '" max="' + (ci + 1) + '" width="' + (sheet.colWidths[ci] / 7).toFixed(1) + '" customWidth="1"/>');
      zip.file('xl/worksheets/sheet' + (si + 1) + '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + (cols.length ? '<cols>' + cols.join('') + '</cols>' : '') + '<sheetData>' + rowsXml + '</sheetData></worksheet>');
    });
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  }
  async function parseDocxFile(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entry = zip.file('word/document.xml');
    if (!entry) throw new Error('无法识别的 docx 文件');
    const xml = await entry.async('string');
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    const paras = [];
    for (const p of dom.getElementsByTagName('w:p')) {
      let text = '';
      let bold = false, size = 0, align = '';
      for (const node of p.getElementsByTagName('*')) {
        const tag = node.tagName.split(':').pop();
        if (tag === 't') text += node.textContent;
        else if (tag === 'b') bold = true;
        else if (tag === 'sz') size = parseInt(node.getAttribute('w:val'), 10) || 0;
        else if (tag === 'jc') align = node.getAttribute('w:val') || '';
      }
      paras.push({ text, bold, size: size ? size / 2 : 0, align });
    }
    return paras;
  }
  async function parseXlsxFile(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const shared = [];
    const ssEntry = zip.file('xl/sharedStrings.xml');
    if (ssEntry) {
      const ssDom = new DOMParser().parseFromString(await ssEntry.async('string'), 'application/xml');
      for (const si of ssDom.getElementsByTagName('si')) {
        let t = '';
        for (const n of si.getElementsByTagName('t')) t += n.textContent;
        shared.push(t);
      }
    }
    const wbEntry = zip.file('xl/workbook.xml') || zip.file('xl/Workbook.xml');
    if (!wbEntry) throw new Error('无法识别的 xlsx 文件');
    const wbDom = new DOMParser().parseFromString(await wbEntry.async('string'), 'application/xml');
    const relEntry = zip.file('xl/_rels/workbook.xml.rels');
    const relsDom = relEntry ? new DOMParser().parseFromString(await relEntry.async('string'), 'application/xml') : null;
    const relMap = {};
    // 缺少关系表时按 sheet1、sheet2… 的约定兜底，不阻断转换。
    if (relsDom) for (const rel of relsDom.getElementsByTagName('Relationship')) relMap[rel.getAttribute('Id')] = rel.getAttribute('Target');
    const sheets = [];
    const sheetEls = wbDom.getElementsByTagName('sheet');
    for (let si = 0; si < sheetEls.length; si++) {
      const name = sheetEls[si].getAttribute('name') || ('Sheet' + (si + 1));
      const rid = sheetEls[si].getAttribute('r:id') || sheetEls[si].getAttribute('r:Id');
      const target = relMap[rid] || ('worksheets/sheet' + (si + 1) + '.xml');
      const entry = zip.file('xl/' + target.replace(/^\//, '')) || zip.file('xl/worksheets/sheet' + (si + 1) + '.xml');
      if (!entry) continue;
      const wsDom = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
      const grid = [];
      for (const row of wsDom.getElementsByTagName('row')) {
        const cells = [];
        for (const c of row.getElementsByTagName('c')) {
          const ref = c.getAttribute('r') || '';
          const colStr = ref.replace(/\d+/g, '');
          let ci = 0;
          for (const ch of colStr) ci = ci * 26 + (ch.charCodeAt(0) - 64);
          ci = Math.max(0, ci - 1);
          const type = c.getAttribute('t');
          let val = '';
          if (type === 'inlineStr') {
            for (const t of c.getElementsByTagName('t')) val += t.textContent;
          } else {
            const v = c.getElementsByTagName('v')[0];
            val = v ? v.textContent : '';
            if (type === 's') val = shared[parseInt(val, 10)] || '';
          }
          cells[ci] = val;
        }
        for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
        grid.push(cells);
      }
      sheets.push({ name, grid });
    }
    return sheets;
  }
  async function parsePptxFile(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    let sw = 720, sh = 405;
    const presEntry = zip.file('ppt/presentation.xml');
    if (presEntry) {
      const pDom = new DOMParser().parseFromString(await presEntry.async('string'), 'application/xml');
      const sldSz = pDom.getElementsByTagName('p:sldSz')[0] || pDom.getElementsByTagName('sldSz')[0];
      if (sldSz) {
        sw = (parseInt(sldSz.getAttribute('cx'), 10) || 9144000) / 12700;
        sh = (parseInt(sldSz.getAttribute('cy'), 10) || 5143500) / 12700;
      }
    }
    const slideNames = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => (parseInt(a.match(/\d+/)[0], 10) || 0) - (parseInt(b.match(/\d+/)[0], 10) || 0));
    const slides = [];
    for (const name of slideNames) {
      const dom = new DOMParser().parseFromString(await zip.file(name).async('string'), 'application/xml');
      const shapes = [];
      for (const sp of dom.getElementsByTagName('p:sp')) {
        const off = sp.getElementsByTagName('a:off')[0];
        const ext = sp.getElementsByTagName('a:ext')[0];
        let text = '';
        for (const t of sp.getElementsByTagName('a:t')) text += t.textContent;
        if (!text.trim()) continue;
        shapes.push({
          x: off ? parseInt(off.getAttribute('x'), 10) / 12700 : 0,
          y: off ? parseInt(off.getAttribute('y'), 10) / 12700 : 0,
          w: ext ? parseInt(ext.getAttribute('cx'), 10) / 12700 : 100,
          h: ext ? parseInt(ext.getAttribute('cy'), 10) / 12700 : 30,
          text,
        });
      }

      // 图片型幻灯片（例如由「PDF 转 PPT」生成）在 slide.xml 里是 p:pic，
      // 媒体文件通过同名 .rels 里的 r:embed 指向 ppt/media/*，必须一并解析，
      // 否则这类幻灯片转换后会变成空白页。
      const relsName = 'ppt/slides/_rels/' + name.split('/').pop() + '.rels';
      const relsEntry = zip.file(relsName);
      const relMap = {};
      if (relsEntry) {
        const relsDom = new DOMParser().parseFromString(await relsEntry.async('string'), 'application/xml');
        for (const rel of relsDom.getElementsByTagName('Relationship')) {
          relMap[rel.getAttribute('Id')] = rel.getAttribute('Target');
        }
      }
      const resolveMedia = target => {
        let p = String(target || '').replace(/\\/g, '/');
        if (p.charAt(0) === '/') return p.slice(1);
        if (p.indexOf('../') === 0) return 'ppt/' + p.slice(3);
        if (p.indexOf('./') === 0) p = p.slice(2);
        return 'ppt/slides/' + p;
      };
      const images = [];
      for (const pic of dom.getElementsByTagName('p:pic')) {
        const blip = pic.getElementsByTagName('a:blip')[0] || pic.getElementsByTagName('blip')[0];
        const rid = blip && (blip.getAttribute('r:embed') || blip.getAttribute('embed'));
        const target = rid && relMap[rid];
        const entry = target && zip.file(resolveMedia(target));
        if (!entry) continue;
        try {
          const bytes = await entry.async('uint8array');
          const off = pic.getElementsByTagName('a:off')[0];
          const ext = pic.getElementsByTagName('a:ext')[0];
          images.push({
            bytes: new Uint8Array(bytes),
            x: off ? (parseInt(off.getAttribute('x'), 10) || 0) / 12700 : 0,
            y: off ? (parseInt(off.getAttribute('y'), 10) || 0) / 12700 : 0,
            w: ext ? (parseInt(ext.getAttribute('cx'), 10) || 0) / 12700 : sw,
            h: ext ? (parseInt(ext.getAttribute('cy'), 10) || 0) / 12700 : sh,
          });
        } catch (e) { /* 跳过损坏的媒体文件 */ }
      }
      slides.push({ shapes, images });
    }
    return { sw, sh, slides };
  }
  function makeOfficeCanvas(w, h) {
    const scale = 2;
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * scale);
    cv.height = Math.round(h * scale);
    const c = cv.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, cv.width, cv.height);
    return { cv, c, scale };
  }
  async function pdfPageLines(file) {
    const doc = await loadPdfjsDoc(file);
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      const lines = [];
      let lastY = null, buf = [];
      for (const item of tc.items) {
        const y = item.transform ? item.transform[5] : 0;
        if (lastY !== null && Math.abs(y - lastY) > 2.5) {
          lines.push(buf.join('').replace(/\s+/g, ' ').trim());
          buf = [];
        }
        buf.push(item.str);
        lastY = y;
      }
      if (buf.length) lines.push(buf.join('').replace(/\s+/g, ' ').trim());
      out.push(lines.filter(l => l !== ''));
    }
    return out;
  }
  async function pdfTextItems(file) {
    const doc = await loadPdfjsDoc(file);
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const t = it.transform || [1, 0, 0, 1, 0, 0];
        out.push({ page: p, pageW: vp.width, pageH: vp.height, x: t[4], y: t[5], size: Math.hypot(t[2], t[3]) || 10, str: it.str });
      }
    }
    return out;
  }
  async function renderParasToPdf(paras, outName) {
    const PW = 595, PH = 842, MARGIN = 56, SCALE = 2;
    const pages = [];
    let cur = makeOfficeCanvas(PW, PH);
    let y = MARGIN;
    for (const p of paras) {
      const fs = p.size || 12;
      const lh = fs * 1.55;
      const fontCss = (p.bold ? 'bold ' : '') + Math.round(fs * SCALE) + 'px "Microsoft YaHei", sans-serif';
      const align = p.align === 'center' ? 'center' : p.align === 'right' ? 'right' : 'left';
      const x = align === 'center' ? PW / 2 : align === 'right' ? PW - MARGIN : MARGIN;
      const maxWPx = (PW - MARGIN * 2) * SCALE;
      const setup = () => {
        cur.c.font = fontCss;
        cur.c.fillStyle = '#000000';
        cur.c.textAlign = align;
      };
      setup();
      const drawLine = (line) => {
        if (y > PH - MARGIN) {
          pages.push(cur);
          cur = makeOfficeCanvas(PW, PH);
          y = MARGIN;
          setup();
        }
        cur.c.fillText(line, x * SCALE, y * SCALE);
        y += lh;
      };
      const chars = Array.from(p.text || '');
      if (!chars.length) { y += lh; continue; }
      let line = '';
      for (const ch of chars) {
        if (line && cur.c.measureText(line + ch).width > maxWPx) { drawLine(line); line = ch; }
        else line += ch;
      }
      if (line) drawLine(line);
      y += lh * 0.35;
    }
    pages.push(cur);
    const doc = await PDFLib.PDFDocument.create();
    for (const pg of pages) {
      const png = await canvasToBlob(pg.cv, 'image/png');
      const page = doc.addPage([PW, PH]);
      page.drawImage(await doc.embedPng(await png.arrayBuffer()), { x: 0, y: 0, width: PW, height: PH });
    }
    return [{ name: outName, blob: bytesToBlob(await doc.save(), 'application/pdf') }];
  }
  function clusterIdx(values, tol) {
    const sorted = values.slice().sort((a, b) => a - b);
    const groups = [];
    for (const v of sorted) {
      if (groups.length && v - groups[groups.length - 1].ref <= tol) {
        const g = groups[groups.length - 1];
        g.sum += v; g.n++;
        g.ref = g.sum / g.n;
      } else groups.push({ ref: v, sum: v, n: 1 });
    }
    return groups.map(g => g.ref);
  }

  /* ---- 有序页码列表解析："3,1-2,1" -> [3,1,2,1]（保持顺序、允许重复） ---- */
  function parseOrderList(str, maxPages) {
    const out = [];
    for (let part of String(str || '').split(/[,，]/)) {
      part = part.trim();
      if (!part) continue;
      if (part.includes('-')) {
        const [a, b] = part.split('-');
        const from = parseInt(a, 10), to = parseInt(b, 10);
        if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error(`页面序号无效：${part}`);
        const step = from <= to ? 1 : -1;
        for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
          if (i < 1 || i > maxPages) throw new Error(`页码 ${i} 超出范围（共 ${maxPages} 页）`);
          out.push(i);
        }
      } else {
        const n = parseInt(part, 10);
        if (!Number.isFinite(n) || n < 1 || n > maxPages) throw new Error(`页码 ${part} 超出范围（共 ${maxPages} 页）`);
        out.push(n);
      }
    }
    if (!out.length) throw new Error('页面顺序为空');
    return out;
  }

  /* ---- 提取 PDF 文本行（含字号，用于 Markdown 标题推断） ---- */
  async function pdfStyledLines(file) {
    const doc = await loadPdfjsDoc(file);
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      const rows = [];
      let lastY = null, buf = [], sizes = [];
      const flush = () => {
        const text = buf.join('').replace(/\s+/g, ' ').trim();
        if (text) rows.push({ text, size: sizes.length ? Math.max.apply(null, sizes) : 12 });
        buf = []; sizes = [];
      };
      for (const item of tc.items) {
        const y = item.transform ? item.transform[5] : 0;
        if (lastY !== null && Math.abs(y - lastY) > 2.5) flush();
        buf.push(item.str);
        if (item.transform) sizes.push(Math.hypot(item.transform[2], item.transform[3]) || 12);
        lastY = y;
      }
      flush();
      pages.push(rows);
    }
    return pages;
  }

  /* ---- BMP 编码（24 位无压缩，canvas -> Uint8Array） ---- */
  function canvasToBmpBytes(canvas) {
    const w = canvas.width, h = canvas.height;
    const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const rowSize = Math.floor((24 * w + 31) / 32) * 4;
    const pixelSize = rowSize * h;
    const fileSize = 54 + pixelSize;
    const buf = new Uint8Array(fileSize);
    const dv = new DataView(buf.buffer);
    buf[0] = 0x42; buf[1] = 0x4D;
    dv.setUint32(2, fileSize, true);
    dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true);
    dv.setInt32(22, h, true);
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 24, true);
    dv.setUint32(30, 0, true);
    dv.setUint32(34, pixelSize, true);
    dv.setInt32(38, 2835, true);
    dv.setInt32(42, 2835, true);
    let o = 54;
    for (let y = h - 1; y >= 0; y--) {
      const rowStart = o;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        buf[o++] = px[i + 2];
        buf[o++] = px[i + 1];
        buf[o++] = px[i];
      }
      while (o - rowStart < rowSize) buf[o++] = 0;
    }
    return buf;
  }

  /* ---- TIFF 编码（小端、无压缩 RGB、单条带，canvas -> Uint8Array） ---- */
  function canvasToTiffBytes(canvas) {
    const w = canvas.width, h = canvas.height;
    const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const pixelBytes = w * h * 3;
    const entryCount = 11;
    const ifdSize = 2 + entryCount * 12 + 4;
    const bitsOffset = 8 + ifdSize;
    const dataOffset = bitsOffset + 6;
    const buf = new Uint8Array(dataOffset + pixelBytes);
    const dv = new DataView(buf.buffer);
    buf[0] = 0x49; buf[1] = 0x49;
    dv.setUint16(2, 42, true);
    dv.setUint32(4, 8, true);
    dv.setUint16(8, entryCount, true);
    let e = 10;
    const entry = (tag, type, count, value) => {
      dv.setUint16(e, tag, true);
      dv.setUint16(e + 2, type, true);
      dv.setUint32(e + 4, count, true);
      dv.setUint32(e + 8, value, true);
      e += 12;
    };
    entry(256, 3, 1, w);
    entry(257, 3, 1, h);
    entry(258, 3, 3, bitsOffset);
    entry(259, 3, 1, 1);
    entry(262, 3, 1, 2);
    entry(273, 4, 1, dataOffset);
    entry(277, 3, 1, 3);
    entry(278, 4, 1, h);
    entry(279, 4, 1, pixelBytes);
    entry(284, 3, 1, 1);
    entry(296, 3, 1, 2);
    dv.setUint32(e, 0, true);
    dv.setUint16(bitsOffset, 8, true);
    dv.setUint16(bitsOffset + 2, 8, true);
    dv.setUint16(bitsOffset + 4, 8, true);
    let o = dataOffset;
    for (let i = 0; i < w * h; i++) {
      buf[o++] = px[i * 4];
      buf[o++] = px[i * 4 + 1];
      buf[o++] = px[i * 4 + 2];
    }
    return buf;
  }

  /* ---- 生成 PPTX（每页幻灯片一张整页图片，纯 JSZip 构建 OOXML） ---- */
  function buildPptxBlob(images) {
    const zip = new JSZip();
    const EMU = 12700;
    const sw = Math.round((images[0] ? images[0].wPt : 595) * EMU);
    const sh = Math.round((images[0] ? images[0].hPt : 842) * EMU);
    const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
    const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    const RELS_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' + images.map((im, i) => '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('') + '</Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS_NS + '><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
    zip.file('ppt/presentation.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ' + A + ' ' + R + ' ' + P + '><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' + images.map((im, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>').join('') + '</p:sldIdLst><p:sldSz cx="' + sw + '" cy="' + sh + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>');
    zip.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS_NS + '><Relationship Id="rId1" Type="' + REL + '/slideMaster" Target="slideMasters/slideMaster1.xml"/>' + images.map((im, i) => '<Relationship Id="rId' + (i + 2) + '" Type="' + REL + '/slide" Target="slides/slide' + (i + 1) + '.xml"/>').join('') + '</Relationships>');
    zip.file('ppt/theme/theme1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme ' + A + ' name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>');
    zip.file('ppt/slideMasters/slideMaster1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ' + A + ' ' + R + ' ' + P + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>');
    zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS_NS + '><Relationship Id="rId1" Type="' + REL + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="' + REL + '/theme" Target="../theme/theme1.xml"/></Relationships>');
    zip.file('ppt/slideLayouts/slideLayout1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ' + A + ' ' + R + ' ' + P + ' type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>');
    zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS_NS + '><Relationship Id="rId1" Type="' + REL + '/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>');
    images.forEach((im, i) => {
      const n = i + 1;
      const mediaName = 'image' + n + '.jpg';
      zip.file('ppt/media/' + mediaName, im.bytes);
      // 图片按幻灯片尺寸等比缩放居中
      const s = Math.min(sw / (im.wPt * EMU), sh / (im.hPt * EMU));
      const cw = Math.round(im.wPt * EMU * s), ch = Math.round(im.hPt * EMU * s);
      const cx = Math.round((sw - cw) / 2), cy = Math.round((sh - ch) / 2);
      zip.file('ppt/slides/slide' + n + '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ' + A + ' ' + R + ' ' + P + '><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ' + n + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="' + cx + '" y="' + cy + '"/><a:ext cx="' + cw + '" cy="' + ch + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>');
      zip.file('ppt/slides/_rels/slide' + n + '.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' + RELS_NS + '><Relationship Id="rId1" Type="' + REL + '/image" Target="../media/' + mediaName + '"/><Relationship Id="rId2" Type="' + REL + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');
    });
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
  }

  /* ---- RTF 转义（非 ASCII 用 \uN? 形式，兼容 Word/WPS） ---- */
  function rtfEscape(s) {
    let out = '';
    for (const ch of String(s)) {
      const code = ch.codePointAt(0);
      if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
      else if (ch === '\n') out += '\\par ';
      else if (code < 128) out += ch;
      else if (code <= 0xFFFF) out += '\\u' + (code > 32767 ? code - 65536 : code) + '?';
      else {
        const cp = code - 0x10000;
        const hi = 0xD800 + (cp >> 10), lo = 0xDC00 + (cp & 0x3FF);
        out += '\\u' + (hi - 65536) + '?\\u' + (lo - 65536) + '?';
      }
    }
    return out;
  }

  /* ---- 行列网格渲染为 PDF 表格（供 CSV 转 PDF 使用） ---- */
  async function renderGridToPdf(grid, outName) {
    const PW = 842, PH = 595, colW = 110, rowH = 24, MARGIN = 24;
    const perPage = Math.floor((PH - 70) / rowH);
    // 横向放不下的列必须分页，否则第 8 列起会画到画布外被静默丢弃。
    const colsPerPage = Math.max(1, Math.floor((PW - MARGIN * 2) / colW));
    const cols = grid.reduce((m, r) => Math.max(m, r.length), 1);
    const doc = await PDFLib.PDFDocument.create();
    for (let r0 = 0; r0 < Math.max(1, grid.length); r0 += perPage) {
      for (let c0 = 0; c0 < Math.max(1, cols); c0 += colsPerPage) {
        const { cv, c, scale } = makeOfficeCanvas(PW, PH);
        for (let ri = 0; ri < perPage && r0 + ri < grid.length; ri++) {
          const row = grid[r0 + ri] || [];
          const y = 30 + ri * rowH;
          for (let ci = c0; ci < Math.min(cols, c0 + colsPerPage); ci++) {
            const x = MARGIN + (ci - c0) * colW;
            c.strokeStyle = '#999';
            c.lineWidth = 1;
            c.strokeRect(x * scale, y * scale, colW * scale, rowH * scale);
            const txt = String(row[ci] || '').slice(0, 14);
            if (txt) {
              c.fillStyle = '#000';
              c.font = '20px "Microsoft YaHei", sans-serif';
              c.fillText(txt, (x + 5) * scale, (y + rowH * 0.68) * scale);
            }
          }
        }
        const png = await canvasToBlob(cv, 'image/png');
        const page = doc.addPage([PW, PH]);
        page.drawImage(await doc.embedPng(await png.arrayBuffer()), { x: 0, y: 0, width: PW, height: PH });
      }
    }
    return [{ name: outName, blob: bytesToBlob(await doc.save(), 'application/pdf') }];
  }

