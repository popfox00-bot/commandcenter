// Who's in a photo: each face found and described (face-api's face recognition, 128 numbers a face, on the
// phone: vendor/face), compared with the accounts' profile photos. A face close enough to one is that account
// (so a new post can make them collaborators by itself). The descriptions of profile photos are kept with
// their accounts (made once a photo). Nothing leaves the phone.

import { trackLoad } from '../../lib/diag.js';

let apiP = null;
function faceApi() {
  apiP ??= trackLoad('Face recognition (face-api)', (async () => {
    // (By its URL: the vendored bundle isn't ours to type-check.)
    const api = await import(new URL('../../vendor/face/face-api.esm.js', import.meta.url).href);
    const base = new URL('../../vendor/face/model/', import.meta.url).href;
    if (!api.tf.getBackend()) { try { await api.tf.setBackend('webgl'); } catch { await api.tf.setBackend('cpu'); } }
    await api.tf.ready();
    if (!api.nets.tinyFaceDetector.isLoaded) await api.nets.tinyFaceDetector.loadFromUri(base);
    if (!api.nets.faceLandmark68Net.isLoaded) await api.nets.faceLandmark68Net.loadFromUri(base);
    if (!api.nets.faceRecognitionNet.isLoaded) await api.nets.faceRecognitionNet.loadFromUri(base);
    return api;
  })());
  apiP.catch(() => { apiP = null; });
  return apiP;
}

/** A Blob (a photo) on a canvas at most `max` px across. */
async function canvasOf(blob, max = 720) {
  const bmp = await createImageBitmap(blob); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.(); return c;
}

/** The faces in a photo, each described: [{ box: [x, y, w, h] (0..1), size (0..1 of its width), d: number[128] }]. */
export async function facesIn(blob, { max = 720, minScore = 0.45 } = {}) {
  const api = await faceApi(); const c = await canvasOf(blob, max);
  const found = await api.detectAllFaces(c, new api.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: minScore })).withFaceLandmarks().withFaceDescriptors();
  return found.map((f) => { const b = f.detection.box; return { box: [b.x / c.width, b.y / c.height, b.width / c.width, b.height / c.height], size: b.width / c.width, d: Array.from(f.descriptor, (v) => Math.round(v * 10000) / 10000) }; });
}

/** A profile photo's face description (its biggest face), or null with none found. */
export async function faceOfAvatar(blob) {
  const faces = await facesIn(blob, { max: 480, minScore: 0.4 });
  return faces.length ? faces.reduce((a, b) => (b.size > a.size ? b : a)).d : null;
}

/** How far apart two face descriptions are (face-api's measure: under ~0.5, the same person). */
export function faceDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s);
}

/**
 * The accounts in a photo: for each face its closest account (by `known`: [{ id, d }]) if close enough
 * (`limit`), each account once, the closest first: [{ id, distance, face (its index in `faces`) }].
 */
export function matchFaces(faces, known, limit = 0.5, { not = [] } = {}) {
  const hits = new Map();
  // (`not`: [{ id, d }], faces you said aren't that account: a face closer to one of those than to the account isn't it.)
  const notOf = (id, d) => not.reduce((m, x) => (x.id === id ? Math.min(m, faceDistance(d, x.d)) : m), Infinity);
  for (const [i, f] of (faces ?? []).entries()) {
    let best = null; for (const k of known ?? []) { const dist = faceDistance(f.d, k.d); if (dist < limit && (!best || dist < best.distance) && !(notOf(k.id, f.d) < Math.max(0.12, dist))) best = { id: k.id, distance: dist, face: i }; }
    if (best && (!hits.has(best.id) || hits.get(best.id).distance > best.distance)) hits.set(best.id, best);
  }
  return [...hits.values()].sort((a, b) => a.distance - b.distance);
}

// ---- Each account's faces: its profile photo's, and its posts' (a post's faces read once and kept with it,
// `p.faces`). A post with one face, posted alone (no collaborators), is that account; a post with several is
// shared out among who's in it (the poster, those tagged, collaborators): each face to the one it's clearly
// closest to. More of someone's faces, from more angles: matched better.

const closest = (d, set) => set.reduce((m, x) => Math.min(m, faceDistance(d, x)), Infinity);

/**
 * The faces to match against, from the state: [{ id, d }] (several for an account: its profile photo's, and
 * from its posts, the latest `perAccount`).
 */
export function faceSetsFrom(state, { perAccount = 12 } = {}) {
  const sets = new Map();
  for (const a of state.accounts ?? []) if (a.face && a.faceOf === a.avatarId) sets.set(a.id, [a.face]);
  // (Then the faces you confirmed as it (✓ It's them), the newest first.)
  for (const a of state.accounts ?? []) for (const d of [...(a.learned ?? [])].reverse()) { const s = sets.get(a.id) ?? []; s.push(d); sets.set(a.id, s); }
  const add = (id, d) => { const s = sets.get(id) ?? []; s.push(d); sets.set(id, s); };
  const posts = [...(state.posts ?? [])].filter((p) => !p.trashed && Array.isArray(p.faces) && p.faces.length).sort((a, b) => b.at - a.at);
  // (Alone in it first: those are sure.)
  for (const p of posts) {
    const collab = (p.collab ?? []).some((c) => c.status === 'accepted');
    if (p.faces.length === 1 && !collab) add(p.by, p.faces[0]);
  }
  // (Then the posts with several in them: each face to who it's closest to, of who's in it, when it's clearly them.)
  for (const p of posts) {
    if (p.faces.length < 2) continue;
    const who = [...new Set([p.by, ...(p.tags ?? []), ...(p.collab ?? []).filter((c) => c.status === 'accepted').map((c) => c.id)])];
    if (p.faces.length > who.length) continue;
    const taken = new Set();
    for (const d of p.faces) {
      const ranked = who.filter((id) => !taken.has(id) && sets.get(id)?.length).map((id) => ({ id, dist: closest(d, sets.get(id)) })).sort((x, y) => x.dist - y.dist);
      if (ranked[0] && ranked[0].dist < 0.45 && (!ranked[1] || ranked[1].dist - ranked[0].dist > 0.08)) { add(ranked[0].id, d); taken.add(ranked[0].id); }
    }
  }
  const out = [];
  for (const [id, s] of sets) for (const d of s.slice(0, 1 + perAccount + (state.accounts?.find((a) => a.id === id)?.learned?.length ?? 0))) out.push({ id, d });
  return out;
}

/** The faces you said aren't each account (✕ Not them): [{ id, d }], for matchFaces' `not`. */
export const notFacesFrom = (state) => (state.accounts ?? []).flatMap((a) => (a.notFaces ?? []).map((d) => ({ id: a.id, d })));

/** Posts' faces read where they haven't been (their first photo), at most `limit` this time: how many were read. */
export async function fillPostFaces(state, { limit = 12 } = {}) {
  let n = 0;
  for (const p of [...(state.posts ?? [])].sort((a, b) => b.at - a.at)) {
    if (n >= limit) break;
    if (p.trashed || p.draft || Array.isArray(p.faces) || !p.image) continue;
    try { p.faces = (await facesIn(p.image)).slice(0, 8).map((f) => f.d); } catch { p.faces = []; }
    n++;
  }
  return n;
}
