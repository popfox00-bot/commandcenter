// WorldAtlas Tutorials: designs and what's needed to build them, with no page (so it can be tested).
//
// A design: { id, name, category, desc, links: [{ title, url }], images: [Blob], extras: [{ name, count }]
// (what isn't a block: villagers, a zombie, buckets), w (blocks across, x), l (blocks deep, z), h (layers,
// y, from the bottom), layers: h arrays of w × l block ids ('' is air), at z * w + x, preset, upd }.

import { BLOCK } from './blocks.js';

export const MAX_SIZE = 64;
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const clampN = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || lo)));

/** An empty design of a size. */
export function blankDesign(name = 'New design', w = 7, l = 7, h = 4) {
  w = clampN(w, 1, MAX_SIZE); l = clampN(l, 1, MAX_SIZE); h = clampN(h, 1, MAX_SIZE);
  return { id: newId(), name, category: 'My designs', desc: '', links: [], images: [], extras: [], w, l, h, layers: Array.from({ length: h }, () => Array(w * l).fill('')), preset: false, upd: Date.now() };
}

/** The block at x, y (layer), z, or '' (air, or outside it). */
export const blockAt = (d, x, y, z) => (x < 0 || z < 0 || y < 0 || x >= d.w || z >= d.l || y >= d.h ? '' : d.layers[y][z * d.w + x] || '');

/** Set a block ('' for air). */
export function setBlock(d, x, y, z, id) { if (x < 0 || z < 0 || y < 0 || x >= d.w || z >= d.l || y >= d.h) return; d.layers[y][z * d.w + x] = id || ''; d.upd = Date.now(); }

/** A whole layer filled with one block ('' empties it). */
export function fillLayer(d, y, id) { if (y < 0 || y >= d.h) return; d.layers[y] = Array(d.w * d.l).fill(id || ''); d.upd = Date.now(); }

/** A layer made the same as the one below it. */
export function copyLayerBelow(d, y) { if (y <= 0 || y >= d.h) return; d.layers[y] = [...d.layers[y - 1]]; d.upd = Date.now(); }

/** Insert an empty layer above `y`, or remove layer `y`. */
export function addLayer(d, y = d.h - 1) { if (d.h >= MAX_SIZE) return; d.layers.splice(y + 1, 0, Array(d.w * d.l).fill('')); d.h++; d.upd = Date.now(); }
export function removeLayer(d, y) { if (d.h <= 1) return; d.layers.splice(y, 1); d.h--; d.upd = Date.now(); }

/** Change its size: what's inside the new size is kept (from the front-left corner), the rest dropped. */
export function resize(d, w, l, h) {
  w = clampN(w, 1, MAX_SIZE); l = clampN(l, 1, MAX_SIZE); h = clampN(h, 1, MAX_SIZE);
  const layers = Array.from({ length: h }, (_, y) => { const out = Array(w * l).fill(''); if (y < d.h) for (let z = 0; z < Math.min(l, d.l); z++) for (let x = 0; x < Math.min(w, d.w); x++) out[z * w + x] = d.layers[y][z * d.w + x] || ''; return out; });
  Object.assign(d, { w, l, h, layers, upd: Date.now() });
}

/** How much space it takes, in blocks: across × deep × high, of what's actually built (air around it left out). */
export function footprint(d) {
  let x0 = Infinity; let x1 = -1; let z0 = Infinity; let z1 = -1; let y0 = Infinity; let y1 = -1;
  for (let y = 0; y < d.h; y++) for (let z = 0; z < d.l; z++) for (let x = 0; x < d.w; x++) if (d.layers[y][z * d.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x1 < 0 ? { w: 0, l: 0, h: 0 } : { w: x1 - x0 + 1, l: z1 - z0 + 1, h: y1 - y0 + 1 };
}

/**
 * The supply list: each block it uses and how many, most first; then the plants (shown grown), the water and lava
 * (source blocks to place, a bucket each), and the extras (what isn't a block).
 * [{ id, name, count, stacks, kind: 'block' | 'plant' | 'liquid' | 'extra' }]
 */
export function supplyList(d) {
  const n = new Map();
  for (const layer of d.layers) for (const id of layer) if (id) n.set(id, (n.get(id) ?? 0) + 1);
  // (Plants are drawn grown (a cane three tall, a pumpkin beside its stem): listed apart, as what grows there,
  // not what to gather; what to plant is in the extras.)
  const kindOf = (id) => (BLOCK[id]?.cat === 'Liquids' ? 'liquid' : BLOCK[id]?.cat === 'Plants' ? 'plant' : 'block');
  const order = { block: 0, plant: 1, liquid: 2 };
  const rows = [...n].map(([id, count]) => ({ id, name: BLOCK[id]?.name ?? id, count, kind: kindOf(id) }));
  rows.sort((a, b) => order[a.kind] - order[b.kind] || b.count - a.count || a.name.localeCompare(b.name));
  for (const e of d.extras ?? []) if (e?.name && e.count > 0) rows.push({ id: '', name: e.name, count: e.count, kind: 'extra' });
  return rows.map((r) => ({ ...r, stacks: stacksOf(r.count) }));
}

/** A count as stacks: "3 stacks + 12", "40", "1 stack". */
export function stacksOf(n) {
  const s = Math.floor(n / 64); const r = n % 64;
  if (!s) return String(n);
  return `${s} stack${s === 1 ? '' : 's'}${r ? ` + ${r}` : ''}`;
}

/** A video link: its YouTube id (for a thumbnail and the app), or null. */
export function youtubeId(url) {
  const m = String(url ?? '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/** A link cleaned up, or null if it isn't one (http/https only). */
export function cleanUrl(u) {
  try { const x = new URL(String(u ?? '').trim()); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; }
}

/** A design read back from storage made safe (sizes in range, layers the right length, unknown blocks kept). */
export function normalizeDesign(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const w = clampN(raw.w, 1, MAX_SIZE); const l = clampN(raw.l, 1, MAX_SIZE); const h = clampN(raw.h, 1, MAX_SIZE);
  const layers = Array.from({ length: h }, (_, y) => { const src = Array.isArray(raw.layers?.[y]) ? raw.layers[y] : []; return Array.from({ length: w * l }, (_, k) => (typeof src[k] === 'string' ? src[k] : '')); });
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(), name: String(raw.name ?? 'Design').slice(0, 80), category: String(raw.category ?? 'My designs').slice(0, 40), desc: String(raw.desc ?? '').slice(0, 4000),
    links: (Array.isArray(raw.links) ? raw.links : []).map((x) => ({ title: String(x?.title ?? '').slice(0, 120), url: cleanUrl(x?.url) })).filter((x) => x.url),
    images: Array.isArray(raw.images) ? raw.images.filter(Boolean) : [], extras: (Array.isArray(raw.extras) ? raw.extras : []).filter((e) => e?.name).map((e) => ({ name: String(e.name).slice(0, 60), count: clampN(e.count, 1, 99999) })),
    w, l, h, layers, preset: !!raw.preset, upd: Number(raw.upd) || 0,
  };
}

/**
 * A design from a little drawing: `rows` is its layers bottom first, each a list of strings (z rows, one
 * character per x), and `key` says what each character is ('.' and ' ' are air).
 */
export function fromPlan(base, key, rows) {
  const h = rows.length; const l = Math.max(...rows.map((r) => r.length)); const w = Math.max(...rows.flat().map((s) => s.length));
  const layers = rows.map((r) => { const out = Array(w * l).fill(''); r.forEach((line, z) => { [...line].forEach((ch, x) => { if (ch !== '.' && ch !== ' ') { if (!key[ch]) throw new Error(`No block for "${ch}" in ${base.name}`); out[z * w + x] = key[ch]; } }); }); return out; });
  return { images: [], extras: [], links: [], desc: '', category: 'Farms', ...base, w, l, h, layers, preset: true, upd: 0 };
}
