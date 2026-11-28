// Locked packages of any size (CCV2): files and folders, compressed where it helps, encrypted in 4 MiB pieces, so a
// package is made and opened a piece at a time (never all in memory: gigabytes are fine), and one file can be taken out
// without reading the rest. The key is kept as Saved Files' is (lib/vault.js: AES-256-GCM, wrapped by the password and
// a recovery key, PBKDF2-SHA256): Reader's own key, or a password of its own. Byte by byte in decryption/FORMAT.md.
//
// The file:  "CCV2" | u32 H | header JSON (H bytes: { v: 2, iterations, password, recovery, chunk }) | content pieces
//            | contents-list pieces | trailer (16 bytes: u32 high, u32 low of where the list's pieces start, u32 0, "CCVE").
// A piece:   u32 L | 12-byte IV | AES-256-GCM ciphertext of L bytes (its 16-byte tag at the end); the additional data
//            is the stream ("C" content, "M" list), the piece's number (u64) and whether it's the last (1 byte), so
//            pieces can't be reordered, swapped between streams or cut off unnoticed. Every content piece but the last
//            holds exactly `chunk` bytes, so piece k starts at a known place.
// Content:   for each file: "F" u32 J json { n (path), s (size), t (type), m (modified), z (compressed) }, then "D" u32 K
//            and K bytes (a block of up to 1 MiB of the file, deflate-raw on its own when z), …, then "E". Then "X".
// The list:  JSON { v: 2, files: [{ n, s, t, m, z, c (the piece its "F" is in), o (where in it) }], count, size, at }.

const subtle = globalThis.crypto.subtle;
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const enc = new TextEncoder(); const dec = new TextDecoder();
export const CHUNK = 4 * 1024 * 1024;
const BLOCK = 1024 * 1024;
const PIECE = CHUNK + 32; // (a full content piece on disk: length, IV, data, tag)
// (Already compressed: not tried again.)
const PACKED = /\.(jpe?g|png|gif|webp|heic|heif|avif|mp4|mov|m4v|mkv|webm|avi|mp3|m4a|aac|ogg|opus|flac|zip|7z|rar|gz|tgz|bz2|xz|zst|ccv|docx|xlsx|pptx|apk|ipa|dmg|iso)$/i;

const aad = (stream, index, last) => { const a = new Uint8Array(10); a[0] = stream.charCodeAt(0); const dv = new DataView(a.buffer); dv.setUint32(1, Math.floor(index / 2 ** 32)); dv.setUint32(5, index >>> 0); a[9] = last ? 1 : 0; return a; };
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const deflate = async (b) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
const inflate = async (b) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());

/** Whether bytes start a CCV2 package. */
export const isCCV2 = (b) => b.length >= 4 && dec.decode(b.subarray(0, 4)) === 'CCV2';

/** Plain bytes → encrypted pieces of one stream, written to `sink(bytes)` as they fill. */
class Pieces {
  constructor(key, stream, sink) { this.key = key; this.stream = stream; this.sink = sink; this.buf = new Uint8Array(CHUNK); this.fill = 0; this.index = 0; this.out = 0; }
  where() { return { c: this.index, o: this.fill }; }
  async push(bytes) {
    let i = 0;
    while (i < bytes.length) { const n = Math.min(CHUNK - this.fill, bytes.length - i); this.buf.set(bytes.subarray(i, i + n), this.fill); this.fill += n; i += n; if (this.fill === CHUNK) await this.flush(false); }
  }
  async flush(last) {
    const iv = rand(12); const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(this.stream, this.index, last) }, this.key, this.buf.subarray(0, this.fill)));
    const rec = new Uint8Array(16 + ct.length); rec.set(u32(ct.length - 16)); rec.set(iv, 4); rec.set(ct, 16);
    await this.sink(rec); this.out += rec.length; this.index++; this.fill = 0;
  }
  end() { return this.flush(true); }
}

/**
 * A package written: `files` [{ name (a path: "Trips/a.jpg"), size, type, lastModified, slice(start, end) → Blob }] (Files
 * do), locked with `key` (CryptoKey) and `header` (its wraps), each piece to `write(bytes)` in order. `onProgress({ done,
 * total, file })` (bytes read); `signal` stops it (throws { canceled }). Resolves to the contents list.
 */
export async function writeCCV2({ files, key, header, write, onProgress = () => {}, signal } = {}) {
  const head = enc.encode(JSON.stringify({ v: 2, iterations: header.iterations, password: header.password, recovery: header.recovery, chunk: CHUNK }));
  await write(new Uint8Array([...enc.encode('CCV2'), ...u32(head.length)])); await write(head);
  let at = 8 + head.length; const sink = async (b) => { await write(b); at += b.length; };
  const content = new Pieces(key, 'C', sink); const list = [];
  const total = files.reduce((n, f) => n + f.size, 0); let done = 0;
  for (const f of files) {
    if (signal?.aborted) throw Object.assign(new Error('Canceled.'), { canceled: true });
    // (Compressed when it's not a kind that's compressed already and its first block shrinks.)
    let z = false;
    if (!PACKED.test(f.name) && f.size > 512 && typeof CompressionStream !== 'undefined') { const first = new Uint8Array(await f.slice(0, Math.min(BLOCK, f.size)).arrayBuffer()); z = (await deflate(first)).length < first.length * 0.9; }
    const meta = { n: String(f.name), s: f.size, t: f.type || '', m: f.lastModified || 0, z };
    list.push({ ...meta, ...content.where() });
    const mj = enc.encode(JSON.stringify(meta)); await content.push(new Uint8Array([70])); await content.push(u32(mj.length)); await content.push(mj);
    for (let p = 0; p < f.size; p += BLOCK) {
      if (signal?.aborted) throw Object.assign(new Error('Canceled.'), { canceled: true });
      const raw = new Uint8Array(await f.slice(p, Math.min(f.size, p + BLOCK)).arrayBuffer());
      const body = z ? await deflate(raw) : raw;
      await content.push(new Uint8Array([68])); await content.push(u32(body.length)); await content.push(body);
      done += raw.length; onProgress({ done, total, file: f.name });
    }
    await content.push(new Uint8Array([69]));
  }
  await content.push(new Uint8Array([88])); await content.end();
  const listAt = at; const index = { v: 2, files: list, count: list.length, size: total, at: Date.now() };
  const m = new Pieces(key, 'M', sink); await m.push(enc.encode(JSON.stringify(index))); await m.end();
  const tail = new Uint8Array(16); const dv = new DataView(tail.buffer); dv.setUint32(0, Math.floor(listAt / 2 ** 32)); dv.setUint32(4, listAt >>> 0); tail.set(enc.encode('CCVE'), 12);
  await write(tail);
  return index;
}

/** A package's outside (no key needed): { header, start (where its pieces start), listAt }. Throws if it isn't one. */
export async function inspectCCV2(blob) {
  const first = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (!isCCV2(first)) throw new Error('That isn\'t a Reader package (CCV2).');
  const hl = new DataView(first.buffer).getUint32(4); const header = JSON.parse(dec.decode(new Uint8Array(await blob.slice(8, 8 + hl).arrayBuffer())));
  const tail = new Uint8Array(await blob.slice(blob.size - 16).arrayBuffer());
  if (dec.decode(tail.subarray(12)) !== 'CCVE') throw new Error('This package is incomplete (its end is missing: copied only partly?).');
  const dv = new DataView(tail.buffer); const listAt = dv.getUint32(0) * 2 ** 32 + dv.getUint32(4);
  return { header, start: 8 + hl, listAt };
}

/** The pieces of one stream from `pos` (piece number `index`), each decrypted, in order, until its last. */
async function* piecesFrom(blob, key, stream, pos, index) {
  for (;;) {
    const L = new DataView(await blob.slice(pos, pos + 4).arrayBuffer()).getUint32(0);
    const rec = new Uint8Array(await blob.slice(pos + 4, pos + 32 + L).arrayBuffer());
    if (rec.length < 28 + L) throw new Error('This package is cut short (copied only partly?).');
    const iv = rec.subarray(0, 12); const ct = rec.subarray(12);
    let plain = null; let last = false;
    for (const l of [false, true]) { try { plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(stream, index, l) }, key, ct)); last = l; break; } catch { /* the other */ } }
    if (!plain) throw new Error('This package couldn\'t be opened with that key (or it was changed).');
    yield plain; if (last) return;
    pos += 32 + L; index++;
  }
}

/** The contents list ({ files, count, size, at }), with the key. */
export async function listCCV2(blob, key, info = null) {
  const i = info ?? await inspectCCV2(blob); const parts = [];
  for await (const p of piecesFrom(blob, key, 'M', i.listAt, 0)) parts.push(p);
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return JSON.parse(dec.decode(all));
}

/** A reader of the content stream's bytes, from a piece on: need(n) → the next n bytes. */
function byteReader(gen, skip) {
  let cur = new Uint8Array(0); let pos = 0; let first = true;
  return async function need(n) {
    const out = new Uint8Array(n); let o = 0;
    while (o < n) {
      if (pos >= cur.length) { const r = await gen.next(); if (r.done) throw new Error('This package ends too soon.'); cur = r.value; pos = first ? skip : 0; first = false; continue; }
      const k = Math.min(n - o, cur.length - pos); out.set(cur.subarray(pos, pos + k), o); o += k; pos += k;
    }
    return out;
  };
}

/** One file of a package taken out, a block at a time to `write(bytes)`: `entry` from the list. */
export async function extractCCV2(blob, key, entry, write, { info = null, onProgress = () => {}, signal } = {}) {
  const i = info ?? await inspectCCV2(blob);
  const need = byteReader(piecesFrom(blob, key, 'C', i.start + entry.c * PIECE, entry.c), entry.o);
  const tag = (await need(1))[0]; if (tag !== 70) throw new Error('This package is damaged.');
  const jl = new DataView((await need(4)).buffer).getUint32(0); await need(jl);
  let done = 0;
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error('Canceled.'), { canceled: true });
    const t = (await need(1))[0];
    if (t === 69) return;
    if (t !== 68) throw new Error('This package is damaged.');
    const kl = new DataView((await need(4)).buffer).getUint32(0); const body = await need(kl);
    const raw = entry.z ? await inflate(body) : body; await write(raw); done += raw.length; onProgress({ done, total: entry.s });
  }
}
/** One file of a package as a File (for a look at it: in memory, so for ones that fit). */
export async function fileFromCCV2(blob, key, entry, opts = {}) {
  const parts = []; await extractCCV2(blob, key, entry, (b) => { parts.push(b); }, opts);
  return new File(parts, entry.n.split('/').pop(), { type: entry.t || '', lastModified: entry.m || 0 });
}
