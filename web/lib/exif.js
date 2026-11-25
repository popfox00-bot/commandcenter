// A JPEG photo's EXIF: when it was taken and where (its GPS), when the camera wrote them. Read from the
// file's own bytes, on the phone. Pure: give it the bytes.

/**
 * { taken: 'YYYY-MM-DDTHH:MM:SS' (the camera's local time), hour (0–23), lat, lon } from a JPEG's bytes,
 * each only when it's there; {} for anything else (not a JPEG, no EXIF).
 */
export function readExif(buf) {
  const out = {};
  try {
    const d = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset ?? 0, buf.byteLength);
    if (d.byteLength < 4 || d.getUint16(0) !== 0xffd8) return out;
    let o = 2;
    while (o + 4 <= d.byteLength) {
      if (d.getUint8(o) !== 0xff) return out;
      const mark = d.getUint8(o + 1); const len = d.getUint16(o + 2);
      if (mark === 0xda || mark === 0xd9) return out; // (the picture itself: no EXIF after)
      if (mark === 0xe1 && d.getUint32(o + 4) === 0x45786966) { tiff(d, o + 10, out); return out; } // 'Exif'
      o += 2 + len;
    }
  } catch { /* a broken file: what was read */ }
  return out;
}

function tiff(d, t, out) {
  const le = d.getUint16(t) === 0x4949;
  const u16 = (p) => d.getUint16(p, le); const u32 = (p) => d.getUint32(p, le);
  const entries = (ifd) => { const n = u16(t + ifd); const list = []; for (let i = 0; i < n; i++) { const e = t + ifd + 2 + i * 12; list.push({ tag: u16(e), type: u16(e + 2), count: u32(e + 4), at: e + 8 }); } return list; };
  const ascii = (e) => { const p = e.count > 4 ? t + u32(e.at) : e.at; let s = ''; for (let i = 0; i < e.count - 1; i++) s += String.fromCharCode(d.getUint8(p + i)); return s; };
  const rationals = (e) => { const p = t + u32(e.at); return Array.from({ length: e.count }, (_, i) => { const a = u32(p + i * 8); const b = u32(p + i * 8 + 4); return b ? a / b : 0; }); };
  const ifd0 = entries(u32(t + 4));
  let date = '';
  const exifPtr = ifd0.find((e) => e.tag === 0x8769); const gpsPtr = ifd0.find((e) => e.tag === 0x8825);
  if (exifPtr) { const dt = entries(u32(exifPtr.at)).find((e) => e.tag === 0x9003 || e.tag === 0x9004); if (dt) date = ascii(dt); }
  if (!date) { const dt = ifd0.find((e) => e.tag === 0x0132); if (dt) date = ascii(dt); }
  const m = date.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m && m[1] !== '0000') { out.taken = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`; out.hour = +m[4]; }
  if (gpsPtr) {
    const g = entries(u32(gpsPtr.at)); const get = (tag) => g.find((e) => e.tag === tag);
    const deg = (e) => { const [a = 0, b = 0, c = 0] = rationals(e); return a + b / 60 + c / 3600; };
    const la = get(2); const lo = get(4);
    if (la && lo) {
      const ref = (e, neg) => (e && String.fromCharCode(d.getUint8(e.at)) === neg ? -1 : 1);
      const lat = deg(la) * ref(get(1), 'S'); const lon = deg(lo) * ref(get(3), 'W');
      if (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { out.lat = lat; out.lon = lon; }
    }
  }
}
