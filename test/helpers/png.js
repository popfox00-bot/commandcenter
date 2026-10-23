// Minimal PNG decoder for tests (8-bit gray, gray+alpha, RGB, RGBA; not interlaced): returns RGBA.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function readPng(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: not a PNG`);
  let w = 0; let h = 0; let type = 0; const idat = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o); const kind = buf.toString('latin1', o + 4, o + 8); const data = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || data[12] !== 0) throw new Error(`${path}: only 8-bit, non-interlaced PNGs are supported`);
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (!ch) throw new Error(`${path}: PNG color type ${type} is not supported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch; const cur = new Uint8Array(stride); const prev = new Uint8Array(stride);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0, p = 0; y < h; y++) {
    const f = raw[p++];
    for (let i = 0; i < stride; i++, p++) {
      const a = i >= ch ? cur[i - ch] : 0; const b = prev[i]; const c = i >= ch ? prev[i - ch] : 0;
      const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      cur[i] = (raw[p] + pred) & 255;
    }
    for (let x = 0; x < w; x++) {
      const s = x * ch; const d = (y * w + x) * 4;
      if (ch <= 2) { out[d] = out[d + 1] = out[d + 2] = cur[s]; out[d + 3] = ch === 2 ? cur[s + 1] : 255; } else { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = ch === 4 ? cur[s + 3] : 255; }
    }
    prev.set(cur);
  }
  return { px: out, w, h };
}
