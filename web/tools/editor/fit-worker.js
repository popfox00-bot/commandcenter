// The fitted Character (fit-pipeline.js) worked out off the page's thread, so the screen never freezes
// while it's lined up, turned and blended. What it works on is sent once and kept by key: { put: key,
// value } (the photo, a Character's pixels, a face, a face-part map); then { build: seq, photo, img,
// charFace, face, parts, opts } (each a key) → { seq, patch } (or { seq, error }).
import { buildFitted } from './fit-pipeline.js';

const kept = new Map();
self.onmessage = (e) => {
  const m = e.data;
  if (m.put) { kept.set(m.put, m.value); if (m.drop) for (const k of m.drop) kept.delete(k); return; }
  if (m.build === undefined) return;
  try {
    const photo = kept.get(m.photo); const img = kept.get(m.img); const charFace = kept.get(m.charFace); const face = kept.get(m.face);
    if (!photo || !img || !charFace || !face) throw new Error('missing');
    const patch = buildFitted(photo.rgba, photo.w, photo.h, img, charFace, face, { ...m.opts, parts: m.parts ? kept.get(m.parts) : null });
    if (!patch) { self.postMessage({ seq: m.build, patch: null }); return; }
    const { x0, y0, pw, ph, rgba } = patch;
    self.postMessage({ seq: m.build, patch: { x0, y0, pw, ph, rgba } }, [rgba.buffer]);
  } catch (err) { self.postMessage({ seq: m.build, error: err.message || String(err) }); }
};
