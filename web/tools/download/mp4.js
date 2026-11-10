// @ts-check
// MP4 / MOV files, read without decoding them: what's in one (length, size, codecs, frame rate,
// sound) and a part of one (from a minute to another) written as an MP4 of its own, frames copied as
// they are (no re-encoding: quick, no loss). The part starts at the key frame at or before the time
// asked (the frame a video can start from), so it may begin a second or two early.
// It reads through `src.read(offset, length)`, so the file can be one on the phone or one still on
// its site (read a range at a time: only the index and the frames of the part are downloaded).
// Not for fragmented MP4 (the kind streamed in pieces). Pure.

/** @typedef {{ size: number, read: (offset: number, length: number) => Promise<Uint8Array> }} Source */
/** @typedef {{ type: string, start: number, size: number, hdr: number }} Box  start/size: the whole box; hdr: its header's length */

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex']);
const str4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u64 = (b, o) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const i32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];

/** The boxes in `b` from `from` to `to`. @param {Uint8Array} b @returns {Box[]} */
export function boxesIn(b, from = 0, to = b.length) {
  const out = [];
  for (let o = from; o + 8 <= to;) {
    let size = u32(b, o); let hdr = 8;
    if (size === 1) { size = u64(b, o + 8); hdr = 16; } else if (size === 0) size = to - o;
    if (size < hdr || o + size > to) break;
    out.push({ type: str4(b, o + 4), start: o, size, hdr });
    o += size;
  }
  return out;
}

/** The file's top-level boxes, reading only their headers. @param {Source} src @returns {Promise<Box[]>} */
export async function topBoxes(src) {
  const out = [];
  for (let o = 0; o + 8 <= src.size && out.length < 1000;) {
    const h = await src.read(o, 16);
    let size = u32(h, 0); let hdr = 8;
    if (size === 1) { size = u64(h, 8); hdr = 16; } else if (size === 0) size = src.size - o;
    if (size < hdr) break;
    out.push({ type: str4(h, 4), start: o, size, hdr });
    o += size;
  }
  return out;
}

/** A box's children, or the first child of a type. @param {Uint8Array} b @param {Box} box */
const kids = (b, box) => boxesIn(b, box.start + box.hdr, box.start + box.size);
const kid = (b, box, type) => kids(b, box).find((k) => k.type === type);
/** A full box's version and where its fields start. */
const full = (b, box) => ({ v: b[box.start + box.hdr], o: box.start + box.hdr + 4 });

/** timescale and duration of an mvhd / mdhd box, and where the duration is. */
function timing(b, box) {
  const { v, o } = full(b, box);
  return v === 1 ? { scale: u32(b, o + 16), dur: u64(b, o + 20), at: o + 20, wide: true } : { scale: u32(b, o + 8), dur: u32(b, o + 12), at: o + 12, wide: false };
}

/**
 * The movie (its moov box read into memory) and its tracks' sample tables.
 * @param {Source} src
 */
export async function readMovie(src) {
  const top = await topBoxes(src);
  const m = top.find((t) => t.type === 'moov');
  if (!m) throw new Error('No index (moov) found: not an MP4 or MOV file, or not a whole one.');
  if (m.size > 200 * 1024 ** 2) throw new Error('Its index is too large to read.');
  const b = await src.read(m.start, m.size);
  const moov = { type: 'moov', start: 0, size: m.size, hdr: m.hdr };
  const mvhd = kid(b, moov, 'mvhd');
  if (!mvhd) throw new Error('Its index has no movie header.');
  const mt = timing(b, mvhd);
  const tracks = kids(b, moov).filter((k) => k.type === 'trak').map((t) => track(b, t)).filter(Boolean);
  return { b, moov, mvhd, scale: mt.scale, duration: mt.dur / (mt.scale || 1), tracks, fragmented: !!kid(b, moov, 'mvex'), top, ftyp: top.find((t) => t.type === 'ftyp') };
}

/** One track: its boxes, kind, codec and samples (decode time, length, size, where, key frame, display offset). */
function track(b, trak) {
  const mdia = kid(b, trak, 'mdia'); const tkhd = kid(b, trak, 'tkhd'); if (!mdia || !tkhd) return null;
  const mdhd = kid(b, mdia, 'mdhd'); const hdlr = kid(b, mdia, 'hdlr'); const minf = kid(b, mdia, 'minf');
  const stbl = minf && kid(b, minf, 'stbl'); if (!mdhd || !hdlr || !stbl) return null;
  const kind = str4(b, hdlr.start + hdlr.hdr + 8);
  const t = timing(b, mdhd);
  const box = (n) => kid(b, stbl, n);
  const stsd = box('stsd');
  const entry = stsd ? boxesIn(b, stsd.start + stsd.hdr + 8, stsd.start + stsd.size)[0] : null;
  const codec = entry?.type ?? '?';
  let width = 0; let height = 0; let channels = 0; let rate = 0;
  if (entry && kind === 'vide') { width = u16(b, entry.start + 32); height = u16(b, entry.start + 34); }
  if (entry && kind === 'soun') { channels = u16(b, entry.start + 24); rate = u16(b, entry.start + 32); }
  const elst = (() => { const e = kid(b, trak, 'edts'); const l = e && kid(b, e, 'elst'); if (!l) return null; const { v, o } = full(b, l); if (u32(b, o) < 1) return null; return v === 1 ? Number(u64(b, o + 4 + 8)) : i32(b, o + 4 + 4); })();
  // Samples.
  const stts = box('stts'); const stsz = box('stsz'); const stsc = box('stsc'); const co = box('stco') ?? box('co64'); const stss = box('stss'); const ctts = box('ctts');
  if (!stts || !stsz || !stsc || !co) return { trak, tkhd, mdia, mdhd, hdlr, minf, stbl, kind, codec, scale: t.scale, mediaDur: t.dur, width, height, channels, rate, elst, n: 0, samples: null };
  let o = stsz.start + stsz.hdr + 4; const fixed = u32(b, o); const n = u32(b, o + 4); o += 8;
  const size = new Uint32Array(n); for (let i = 0; i < n; i++) size[i] = fixed || u32(b, o + i * 4);
  const dts = new Float64Array(n); const dur = new Uint32Array(n);
  { let p = stts.start + stts.hdr + 4; const c = u32(b, p); p += 4; let i = 0; let tm = 0; for (let e = 0; e < c && i < n; e++, p += 8) { const k = u32(b, p); const d = u32(b, p + 4); for (let j = 0; j < k && i < n; j++, i++) { dts[i] = tm; dur[i] = d; tm += d; } } }
  const cto = new Int32Array(n);
  if (ctts) { let p = ctts.start + ctts.hdr + 4; const c = u32(b, p); p += 4; let i = 0; for (let e = 0; e < c && i < n; e++, p += 8) { const k = u32(b, p); const v = i32(b, p + 4); for (let j = 0; j < k && i < n; j++, i++) cto[i] = v; } }
  const sync = new Uint8Array(n);
  if (stss) { let p = stss.start + stss.hdr + 4; const c = u32(b, p); p += 4; for (let e = 0; e < c; e++, p += 4) { const s = u32(b, p) - 1; if (s < n) sync[s] = 1; } } else sync.fill(1);
  const chunks = []; { let p = co.start + co.hdr + 4; const c = u32(b, p); p += 4; const wide = co.type === 'co64'; for (let e = 0; e < c; e++) chunks.push(wide ? u64(b, p + e * 8) : u32(b, p + e * 4)); }
  const off = new Float64Array(n); const sdi = new Uint32Array(n);
  {
    let p = stsc.start + stsc.hdr + 4; const c = u32(b, p); p += 4;
    const ent = []; for (let e = 0; e < c; e++, p += 12) ent.push([u32(b, p), u32(b, p + 4), u32(b, p + 8)]);
    let i = 0;
    for (let e = 0; e < ent.length; e++) {
      const last = e + 1 < ent.length ? ent[e + 1][0] - 1 : chunks.length;
      for (let ch = ent[e][0]; ch <= last && i < n; ch++) { let at = chunks[ch - 1]; for (let j = 0; j < ent[e][1] && i < n; j++, i++) { off[i] = at; sdi[i] = ent[e][2]; at += size[i]; } }
    }
  }
  return { trak, tkhd, mdia, mdhd, hdlr, minf, stbl, kind, codec, scale: t.scale, mediaDur: t.dur, width, height, channels, rate, elst, n, samples: { dts, dur, size, off, sync, cto, sdi, ctts: !!ctts, stss: !!stss } };
}

const CODECS = { avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC (H.265)', hev1: 'HEVC (H.265)', av01: 'AV1', vp09: 'VP9', vp08: 'VP8', mp4v: 'MPEG-4', 'apcn': 'ProRes', 'apch': 'ProRes', 'apcs': 'ProRes', 'ap4h': 'ProRes', jpeg: 'Motion JPEG', mp4a: 'AAC', '.mp3': 'MP3', Opus: 'Opus', 'ac-3': 'Dolby Digital', 'ec-3': 'Dolby Digital Plus', alac: 'Apple Lossless', fLaC: 'FLAC', lpcm: 'PCM', sowt: 'PCM', twos: 'PCM' };
const codecName = (c) => CODECS[c] ?? c.trim();

/**
 * What's in an MP4 / MOV: { duration, width, height, fps, video, audio, channels, rate, bitrate, fragmented }.
 * @param {Source} src
 */
export async function mp4Details(src) {
  const m = await readMovie(src);
  const v = m.tracks.find((t) => t.kind === 'vide'); const a = m.tracks.find((t) => t.kind === 'soun');
  const fps = v?.n && v.mediaDur ? v.n / (v.mediaDur / v.scale) : 0;
  return {
    duration: m.duration, width: v?.width ?? 0, height: v?.height ?? 0, fps: Math.round(fps * 100) / 100,
    video: v ? codecName(v.codec) : null, audio: a ? codecName(a.codec) : null, channels: a?.channels ?? 0, rate: a?.rate ?? 0,
    bitrate: m.duration ? Math.round((src.size * 8) / m.duration) : 0, fragmented: m.fragmented,
  };
}

// ---------- writing ----------

/** A box from its type and contents. @param {string} type @param {...(Uint8Array|number[])} parts */
function mk(type, ...parts) {
  const len = parts.reduce((s, p) => s + p.length, 8); const out = new Uint8Array(len);
  put32(out, 0, len); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let o = 8; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const put32 = (b, o, v) => { b[o] = v >>> 24; b[o + 1] = v >>> 16; b[o + 2] = v >>> 8; b[o + 3] = v; };
const put64 = (b, o, v) => { put32(b, o, Math.floor(v / 2 ** 32)); put32(b, o + 4, v >>> 0); };
/** A list of 32-bit numbers as bytes. @param {ArrayLike<number>} a */
const words = (a) => { const b = new Uint8Array(a.length * 4); for (let i = 0; i < a.length; i++) put32(b, i * 4, a[i]); return b; };
/** A copy of a box as it is. */
const copy = (b, box) => b.slice(box.start, box.start + box.size);
/** A copy of a box with its duration (mvhd, mdhd, tkhd) changed. */
function withDur(b, box, dur, tkhd = false) {
  const c = copy(b, box); const v = c[box.hdr];
  const at = tkhd ? box.hdr + 4 + (v === 1 ? 24 : 16) : box.hdr + 4 + (v === 1 ? 20 : 12);
  if (v === 1) put64(c, at, dur); else put32(c, at, Math.min(dur, 0xffffffff));
  return c;
}
/** Runs of equal values as [count, value] pairs. @param {ArrayLike<number>} a */
function runs(a) { const out = []; for (let i = 0; i < a.length; i++) { if (out.length && out[out.length - 2 + 1] === a[i]) out[out.length - 2]++; else out.push(1, a[i]); } return out; }

/**
 * A part of an MP4 / MOV (from `from` to `to` seconds) as a new MP4: its header (bytes) and the
 * ranges of the source to copy after it, in order. { head, ranges: [{ offset, length }], start, end, size }
 * (start / end: the times it really covers). Video and sound tracks only.
 * @param {Source} src @param {number} from @param {number} to
 */
export async function planPart(src, from, to) {
  const m = await readMovie(src);
  if (m.fragmented) throw new Error('This MP4 is streamed in pieces (fragmented): a part of it can\'t be cut here.');
  const tracks = m.tracks.filter((t) => (t.kind === 'vide' || t.kind === 'soun') && t.samples && t.n);
  if (!tracks.length) throw new Error('No video or sound in it.');
  const ref = tracks.find((t) => t.kind === 'vide') ?? tracks[0];
  // Where the reference track starts (its key frame at or before `from`) and ends.
  const rs = ref.samples;
  const want = Math.max(0, from) * ref.scale; let first = 0;
  for (let i = 0; i < ref.n; i++) { if (rs.dts[i] > want) break; if (rs.sync[i]) first = i; }
  const t0 = rs.dts[first] / ref.scale; const t1 = Math.min(to, m.duration + 1);
  if (!(t1 > t0)) throw new Error('That part is empty.');

  // Each track's samples in the part, in chunks of about a second.
  const picked = tracks.map((t) => {
    const s = t.samples; let a = 0; let z = t.n;
    if (t === ref) a = first; else { while (a < t.n && s.dts[a] + s.dur[a] <= t0 * t.scale) a++; }
    while (z > a && s.dts[z - 1] >= t1 * t.scale) z--;
    const chunks = []; let cur = null;
    for (let i = a; i < z; i++) {
      if (!cur || s.dts[i] - s.dts[cur.a] >= t.scale || s.sdi[i] !== s.sdi[cur.a]) { cur = { a: i, z: i + 1, t: s.dts[i] / t.scale, bytes: s.size[i] }; chunks.push(cur); } else { cur.z = i + 1; cur.bytes += s.size[i]; }
    }
    return { t, a, z, chunks };
  }).filter((p) => p.z > p.a);

  // Chunks in time order, all tracks together (so the file plays smoothly from the start).
  const order = picked.flatMap((p) => p.chunks.map((c) => ({ p, c }))).sort((x, y) => x.c.t - y.c.t);
  const bytes = order.reduce((s, x) => s + x.c.bytes, 0);

  // The header, with each chunk's place: ftyp, moov (sized first, with dummy places), then mdat.
  const ftyp = m.ftyp ? await src.read(m.ftyp.start, m.ftyp.size) : mk('ftyp', [...'isom'].map((c) => c.charCodeAt(0)), [0, 0, 2, 0], [...'isomiso2avc1mp41'].map((c) => c.charCodeAt(0)));
  const build = (places) => moovFor(m, picked, places);
  const moov0 = build(null);
  const big = ftyp.length + moov0.length + 16 + bytes > 0xffffffff;
  const mdatHdr = big ? 16 : 8;
  let at = ftyp.length + moov0.length + mdatHdr;
  const places = new Map();
  for (const x of order) { places.set(x.c, at); at += x.c.bytes; }
  const moov = build(places);
  const mdat = new Uint8Array(mdatHdr);
  if (big) { put32(mdat, 0, 1); mdat.set([109, 100, 97, 116], 4); put64(mdat, 8, bytes + 16); } else { put32(mdat, 0, bytes + 8); mdat.set([109, 100, 97, 116], 4); }
  const head = new Uint8Array(ftyp.length + moov.length + mdat.length); head.set(ftyp, 0); head.set(moov, ftyp.length); head.set(mdat, ftyp.length + moov.length);

  // What to copy from the source: each chunk's samples, neighbouring ones joined.
  const ranges = [];
  for (const { p, c } of order) {
    const s = p.t.samples;
    for (let i = c.a; i < c.z; i++) {
      const last = ranges[ranges.length - 1];
      if (last && last.offset + last.length === s.off[i]) last.length += s.size[i]; else ranges.push({ offset: s.off[i], length: s.size[i] });
    }
  }
  const end = Math.max(...picked.map((p) => (p.t.samples.dts[p.z - 1] + p.t.samples.dur[p.z - 1]) / p.t.scale));
  return { head, ranges, start: t0, end, size: head.length + bytes };
}

/** The new moov for the picked samples (chunk places: null while it's being sized). */
function moovFor(m, picked, places) {
  const b = m.b; const traks = [];
  let movieDur = 0;
  for (const p of picked) {
    const t = p.t; const s = t.samples; const n = p.z - p.a;
    let mediaDur = 0; for (let i = p.a; i < p.z; i++) mediaDur += s.dur[i];
    const tkDur = Math.round((mediaDur / t.scale) * m.scale); movieDur = Math.max(movieDur, tkDur);
    const sub = (arr) => Array.prototype.slice.call(arr, p.a, p.z);
    const stts = mk('stts', [0, 0, 0, 0], (() => { const r = runs(sub(s.dur)); return [...words([r.length / 2]), ...words(r)]; })());
    const parts = [copy(b, kid(b, t.stbl, 'stsd')), stts];
    if (s.ctts) { const r = runs(sub(s.cto)); parts.push(mk('ctts', [1, 0, 0, 0], words([r.length / 2]), words(r))); }
    if (s.stss) { const k = []; for (let i = p.a; i < p.z; i++) if (s.sync[i]) k.push(i - p.a + 1); parts.push(mk('stss', [0, 0, 0, 0], words([k.length]), words(k))); }
    // stsc: where the samples-per-chunk (or description) changes.
    const sc = []; p.chunks.forEach((c, i) => { const per = c.z - c.a; const d = s.sdi[c.a]; if (!sc.length || sc[sc.length - 2] !== per || sc[sc.length - 1] !== d) sc.push(i + 1, per, d); });
    parts.push(mk('stsc', [0, 0, 0, 0], words([sc.length / 3]), words(sc)));
    parts.push(mk('stsz', [0, 0, 0, 0], words([0, n]), words(sub(s.size))));
    const co = new Uint8Array(4 + p.chunks.length * 8); put32(co, 0, p.chunks.length);
    p.chunks.forEach((c, i) => put64(co, 4 + i * 8, places ? places.get(c) : 0));
    parts.push(mk('co64', [0, 0, 0, 0], co));
    const stbl = mk('stbl', ...parts);
    const minf = mk('minf', ...kids(b, t.minf).filter((k) => k.type !== 'stbl').map((k) => copy(b, k)), stbl);
    const mdia = mk('mdia', withDur(b, t.mdhd, mediaDur), copy(b, t.hdlr), minf);
    const trakParts = [withDur(b, t.tkhd, tkDur, true)];
    if (t.elst != null && t.elst >= 0) {
      const e = new Uint8Array(4 + 12); put32(e, 0, 1); put32(e, 4, tkDur); put32(e, 8, t.elst); put32(e, 12, 0x00010000);
      trakParts.push(mk('edts', mk('elst', [0, 0, 0, 0], e)));
    }
    traks.push(mk('trak', ...trakParts, mdia));
  }
  return mk('moov', withDur(b, m.mvhd, movieDur), ...traks);
}
