// The page's side of fit-worker.js: a fitted Character worked out off the page's thread. What it works on
// is sent once and kept there by key (the photo as it is now, a Character's pixels, a face, a face-part
// map); each build only names them. A new photo (after an edit) replaces the old one there.

/**
 * A client: { build(photo, W, H, img, charFace, face, parts, opts) → Promise<patch | null>, close() }.
 * build rejects when there's no worker here (or it failed): work it out on the page's thread then.
 */
export function fitClient() {
  let worker = null; let seq = 0; let photoKey = null; let n = 0;
  const waiting = new Map(); const keys = new WeakMap(); const sent = new Set();
  const start = () => {
    try { worker = new Worker(new URL('./fit-worker.js', import.meta.url), { type: 'module' }); } catch { worker = false; return; }
    worker.onmessage = (e) => { const w = waiting.get(e.data.seq); if (!w) return; waiting.delete(e.data.seq); if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data.patch); };
    worker.onerror = (e) => { for (const w of waiting.values()) w.reject(new Error(e.message || 'the fit worker stopped')); waiting.clear(); worker.terminate(); worker = false; };
  };
  return {
    build(photo, W, H, img, charFace, face, parts, opts) {
      if (worker === null) start();
      if (!worker) return Promise.reject(new Error('no worker'));
      const key = (obj, value) => {
        let k = keys.get(obj); if (!k) { k = `k${++n}`; keys.set(obj, k); }
        if (!sent.has(k)) {
          const drop = obj === photo && photoKey && photoKey !== k ? [photoKey] : [];
          for (const d of drop) sent.delete(d);
          sent.add(k); worker.postMessage({ put: k, value: value(), drop });
        }
        return k;
      };
      const pk = key(photo, () => ({ rgba: photo, w: W, h: H })); photoKey = pk;
      // (A face: its plain parts only, its outline with it; the worker works out the rest and keeps it.)
      const fk = key(face, () => ({ box: face.box, eyes: face.eyes, mouth: face.mouth, nose: face.nose, angle: face.angle, score: face.score, size: face.size, pts: face.pts, mesh: face.mesh, outline: face.outline }));
      const msg = { build: ++seq, photo: pk, img: key(img, () => img), charFace: key(charFace, () => charFace), face: fk, parts: parts ? key(parts, () => parts) : null, opts };
      return new Promise((resolve, reject) => { waiting.set(msg.build, { resolve, reject }); worker.postMessage(msg); });
    },
    close() { if (worker) worker.terminate(); worker = null; sent.clear(); photoKey = null; for (const w of waiting.values()) w.reject(new Error('closed')); waiting.clear(); },
  };
}
