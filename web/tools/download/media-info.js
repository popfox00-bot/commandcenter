// @ts-check
// What's in a downloaded video, read from the file (not decoded): length, picture size, frame rate,
// the video and sound codecs, channels, sample rate, bitrate. MP4 / MOV (mp4.js) and WebM / MKV
// (its header, here). Pure.

import { mp4Details } from './mp4.js';

/** @typedef {import('./mp4.js').Source} Source */
/**
 * @typedef {{ duration: number, width: number, height: number, fps: number, video: string|null, audio: string|null,
 *   channels: number, rate: number, bitrate: number }} Details
 */

/** A file (Blob) as a Source. @param {Blob} blob @returns {Source} */
export const blobSource = (blob) => ({ size: blob.size, read: async (o, n) => new Uint8Array(await blob.slice(o, o + n).arrayBuffer()) });

/**
 * The details of a video of `kind` (download-core's sniffVideo), or null when it can't tell.
 * @param {Source} src @param {string} kind @returns {Promise<Details|null>}
 */
export async function videoDetails(src, kind) {
  try {
    if (kind === 'mp4' || kind === 'mov') return await mp4Details(src);
    if (kind === 'webm' || kind === 'mkv') return webmDetails(await src.read(0, Math.min(src.size, 512 * 1024)), src.size);
  } catch { /* not readable: no details */ }
  return null;
}

const MKV_CODECS = { V_VP8: 'VP8', V_VP9: 'VP9', V_AV1: 'AV1', 'V_MPEG4/ISO/AVC': 'H.264', 'V_MPEGH/ISO/HEVC': 'HEVC (H.265)', V_THEORA: 'Theora', A_OPUS: 'Opus', A_VORBIS: 'Vorbis', A_AAC: 'AAC', A_MPEG_L3: 'MP3', A_AC3: 'Dolby Digital', A_EAC3: 'Dolby Digital Plus', A_FLAC: 'FLAC', A_PCM_INT_LIT: 'PCM' };

/**
 * WebM / MKV details from its first bytes (its Info and Tracks come before the frames).
 * @param {Uint8Array} b @param {number} size the whole file's @returns {Details}
 */
export function webmDetails(b, size) {
  const d = { duration: 0, width: 0, height: 0, fps: 0, video: null, audio: null, channels: 0, rate: 0, bitrate: 0 };
  let scale = 1e6; let dur = 0;
  // An element's ID (its marker bits kept) and size (marker removed; -1: unknown).
  const vint = (o, keep) => {
    const first = b[o]; let len = 1; while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    if (len > 8 || o + len > b.length) return null;
    let v = keep ? first : first & (0xff >> len); let all = (first & (0xff >> len)) === (0xff >> len);
    for (let i = 1; i < len; i++) { v = v * 256 + b[o + i]; if (b[o + i] !== 0xff) all = false; }
    return { v: !keep && all ? -1 : v, len };
  };
  const uint = (o, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[o + i]; return v; };
  const float = (o, n) => { const dv = new DataView(b.buffer, b.byteOffset + o, n); return n === 4 ? dv.getFloat32(0) : dv.getFloat64(0); };
  const text = (o, n) => String.fromCharCode(...b.subarray(o, o + n)).replace(/\0+$/, '');
  const MASTER = new Set([0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0xe1]);
  let entry = null;
  const walk = (from, to) => {
    for (let o = from; o < to;) {
      const id = vint(o, true); if (!id) return; const sz = vint(o + id.len, false); if (!sz) return;
      const s = o + id.len + sz.len; const e = sz.v < 0 ? to : Math.min(to, s + sz.v);
      if (id.v === 0x1f43b675) return; // the first Cluster: frames from here on
      if (id.v === 0xae) { entry = { type: 0, codec: '', w: 0, h: 0, ch: 0, rate: 0, fd: 0 }; walk(s, e); finish(entry); entry = null; }
      else if (MASTER.has(id.v)) walk(s, e);
      else if (id.v === 0x2ad7b1) scale = uint(s, e - s);
      else if (id.v === 0x4489) dur = float(s, e - s);
      else if (entry) {
        if (id.v === 0x83) entry.type = uint(s, e - s);
        else if (id.v === 0x86) entry.codec = text(s, e - s);
        else if (id.v === 0xb0) entry.w = uint(s, e - s);
        else if (id.v === 0xba) entry.h = uint(s, e - s);
        else if (id.v === 0x9f) entry.ch = uint(s, e - s);
        else if (id.v === 0xb5) entry.rate = float(s, e - s);
        else if (id.v === 0x23e383) entry.fd = uint(s, e - s);
      }
      o = e;
    }
  };
  const finish = (t) => {
    const name = MKV_CODECS[t.codec] ?? t.codec.replace(/^[AV]_/, '');
    if (t.type === 1 && !d.video) { d.video = name; d.width = t.w; d.height = t.h; if (t.fd) d.fps = Math.round((1e9 / t.fd) * 100) / 100; }
    if (t.type === 2 && !d.audio) { d.audio = name; d.channels = t.ch || 1; d.rate = Math.round(t.rate); }
  };
  walk(0, b.length);
  d.duration = (dur * scale) / 1e9;
  if (d.duration) d.bitrate = Math.round((size * 8) / d.duration);
  return d;
}

/** "1920×1080 · 29.97 fps · H.264 · AAC stereo 48 kHz · 4.2 Mb/s" (what it knows). @param {Details} d */
export function describe(d) {
  const parts = [];
  if (d.width) parts.push(`${d.width}×${d.height}`);
  if (d.fps) parts.push(`${d.fps} fps`);
  if (d.video) parts.push(d.video);
  parts.push(d.audio ? `${d.audio}${d.channels === 1 ? ' mono' : d.channels === 2 ? ' stereo' : d.channels ? ` ${d.channels} ch` : ''}${d.rate ? ` ${Math.round(d.rate / 100) / 10} kHz` : ''}` : 'no sound');
  if (d.bitrate) parts.push(d.bitrate >= 1e6 ? `${(d.bitrate / 1e6).toFixed(1)} Mb/s` : `${Math.round(d.bitrate / 1e3)} kb/s`);
  return parts.join(' · ');
}
