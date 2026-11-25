// A picked file read into memory straight away, all of it, with its progress. On an iPhone a file picked from
// iCloud Drive (or Photos, still downloading) can fail to read, or read short, the first time, or a while
// later once the picker has let it go: so each is read at once, in full, tried again a few times if a read
// fails or stalls, and handed back as a new File made from its bytes, which nothing can take away after.

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** A file's type, from its name when the phone didn't say (iCloud files often come without one). */
export function typeOf(f) {
  if (f?.type) return f.type;
  const ext = String(f?.name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  return { mov: 'video/quicktime', qt: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', '3gp': 'video/3gpp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' }[ext] ?? '';
}

/** Whether a file is a video (by its type, else its name). */
export const isVideo = (f) => /^video\//.test(typeOf(f));

/** A promise, or an error once `ms` pass without it. */
function within(p, ms) {
  let t; return Promise.race([p, new Promise((_, bad) => { t = setTimeout(() => bad(new Error('stalled')), ms); })]).finally(() => clearTimeout(t));
}

/**
 * `file` read in full: a File of the same name and type made from its bytes. `onProgress(0..1)` as it reads;
 * `tries` reads before giving up (each a little later than the last); `stall` ms with no new bytes: tried again.
 */
export async function readFully(file, { onProgress = () => {}, tries = 4, stall = 45000, wait = 900 } = {}) {
  const type = typeOf(file); const size = file.size ?? 0; let last;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(wait * i);
    try {
      let parts;
      if (typeof file.stream === 'function') {
        const r = file.stream().getReader(); parts = []; let got = 0;
        try {
          for (;;) {
            const { done, value } = await within(r.read(), stall);
            if (done) break;
            parts.push(value); got += value.byteLength;
            if (size) onProgress(Math.min(1, got / size));
          }
        } finally { try { r.releaseLock(); } catch { /* already */ } }
        if (size && got < size) throw new Error('short read');
      } else {
        const buf = await within(file.arrayBuffer(), stall * 2);
        if (size && buf.byteLength < size) throw new Error('short read');
        parts = [buf];
      }
      onProgress(1);
      return new File(parts, file.name || 'file', { type, lastModified: file.lastModified });
    } catch (e) { last = e; onProgress(0); }
  }
  throw new Error(`"${file.name || 'That file'}" couldn't be read${/stalled/.test(last?.message ?? '') ? ' (it stopped loading)' : ''}. If it's in iCloud, wait for it to download, then try again.`);
}
