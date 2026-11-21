// WorldAtlas Tutorials: farm designs and other builds, kept on this device. Each has its video links and photos,
// a supply list (every block and how many, in stacks, and what isn't a block), how much space it takes in
// blocks, and a 3D view of it built, layer by layer. Its layers are drawn here: pick a layer, paint it with
// blocks (from a palette, or any block by search) or air, and build up the layers to the finished design.
// It starts with a few popular farms (designs.js); add your own, and change or delete any.

import { el, fill } from '../../../lib/dom.js';
import { idb } from '../../../lib/idb.js';
import { BLOCK, PRESET_PALETTE, searchBlocks } from './blocks.js';
import { PRESETS } from './designs.js';
import { drawDesign } from './render3d.js';
import {
  blankDesign, normalizeDesign, supplyList, footprint, setBlock, blockAt, fillLayer, copyLayerBelow, addLayer, removeLayer,
  resize, youtubeId, cleanUrl, newId, MAX_SIZE,
} from './tutorials-core.js';

const KEY = 'cc.atlas.tutorials';
const host = document.getElementById('tt');
let designs = []; let seeded = [];
let view = { name: 'list', cat: 'All', q: '' };
const urls = new Map(); const urlOf = (b) => { if (!b) return null; let u = urls.get(b); if (!u) { u = URL.createObjectURL(b); urls.set(b, u); } return u; };

// ---- Keeping them: on this device (IndexedDB), photos as their bytes (Safari can lose Blobs kept there).
async function load() {
  const raw = await idb.get(KEY);
  seeded = Array.isArray(raw?.seeded) ? raw.seeded : [];
  designs = (Array.isArray(raw?.designs) ? raw.designs : []).map((d) => normalizeDesign({ ...d, images: (d.images ?? []).map((im) => (im?.buf ? new Blob([im.buf], { type: im.type || 'image/jpeg' }) : null)).filter(Boolean) })).filter(Boolean);
  // (The designs it comes with, each once: one deleted stays deleted; new ones in later versions are added.)
  let added = false;
  for (const p of PRESETS) if (!seeded.includes(p.id)) { designs.push(normalizeDesign(structuredClone(p))); seeded.push(p.id); added = true; }
  if (added) await save();
}
let saving = Promise.resolve();
function save() {
  const snap = designs.map((d) => ({ ...d }));
  saving = saving.then(async () => {
    const out = [];
    for (const d of snap) out.push({ ...d, images: await Promise.all((d.images ?? []).map(async (b) => ({ type: b.type, buf: await b.arrayBuffer() }))) });
    await idb.set(KEY, { v: 1, designs: out, seeded });
  }).catch(() => {});
  return saving;
}
const byId = (id) => designs.find((d) => d.id === id) ?? null;
function toast(text) { const t = el('div', { class: 'toast', role: 'status', text }); document.body.append(t); setTimeout(() => t.remove(), 2200); }
const go = (v) => { view = v; draw(); window.scrollTo(0, 0); };
const swatch = (id) => el('span', { class: 'sw', style: { background: BLOCK[id]?.color ?? '#f0f', opacity: String(Math.max(0.35, BLOCK[id]?.alpha ?? 1)) } });

// ---- The list.
function list() {
  const cats = ['All', ...new Set(designs.map((d) => d.category))];
  const q = el('input', { class: 'input', type: 'search', placeholder: 'Search designs', 'aria-label': 'Search designs', value: view.q });
  const grid = el('div', { class: 'tt-grid' });
  const show = () => {
    view.q = q.value; const s = q.value.trim().toLowerCase();
    const items = designs.filter((d) => (view.cat === 'All' || d.category === view.cat) && (!s || `${d.name} ${d.category} ${d.desc}`.toLowerCase().includes(s))).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    fill(grid, items.length ? items.map(card) : el('p', { class: 'muted', text: 'No designs found.' }));
  };
  q.addEventListener('input', show); show();
  return el('div', {},
    el('div', { class: 'tt-top' }, el('a', { class: 'tt-link', href: '../index.html', text: '‹ WorldAtlas' }), el('h1', { text: 'Tutorials' }), el('button', { type: 'button', class: 'btn primary', text: '+ New', onclick: () => { const d = blankDesign(); designs.push(d); save(); go({ name: 'edit', id: d.id }); } })),
    el('p', { class: 'muted small', text: 'Farm designs and builds: videos, photos, what to gather, the space it takes, and a 3D view, layer by layer.' }),
    q, el('div', { class: 'tt-cats', role: 'tablist' }, cats.map((c) => el('button', { type: 'button', class: `chip${view.cat === c ? ' on' : ''}`, role: 'tab', 'aria-selected': String(view.cat === c), text: c, onclick: () => { view.cat = c; draw(); } }))),
    grid);
}

function card(d) {
  const f = footprint(d); const img = d.images[0];
  const pic = img ? el('img', { src: urlOf(img), alt: '' }) : el('canvas', { width: '320', height: '240' });
  if (!img) requestAnimationFrame(() => drawDesign(pic, d, { rot: 0 }));
  return el('button', { type: 'button', class: 'card', 'aria-label': `${d.name}, ${d.category}`, onclick: () => go({ name: 'design', id: d.id, rot: 0, upTo: d.h - 1 }) },
    pic, el('strong', { text: d.name }), el('span', { class: 'muted small', text: `${d.category} · ${f.w}×${f.l}×${f.h} blocks` }));
}

// ---- A design.
function viewer(d, opts) {
  const c = el('canvas', { 'aria-label': `3D view of ${d.name}` });
  const redraw = () => { const r = c.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1); c.width = Math.max(200, Math.round(r.width * dpr)); c.height = Math.max(200, Math.round(r.height * dpr)); drawDesign(c, d, { upTo: opts.upTo, rot: opts.rot, zoom: opts.zoom ?? 1, focus: opts.focus ?? null }); };
  requestAnimationFrame(redraw);
  // (Drag sideways to turn it a quarter; pinch or the buttons to zoom.)
  let x0 = null; c.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  c.addEventListener('pointerup', (e) => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 40) { opts.rot = (opts.rot + (dx > 0 ? 1 : 3)) % 4; redraw(); } });
  const box = el('div', { class: 'view3d' }, c, el('div', { class: 'row' },
    el('button', { type: 'button', class: 'btn small', 'aria-label': 'Turn left', text: '⟲', onclick: () => { opts.rot = (opts.rot + 3) % 4; redraw(); } }),
    el('button', { type: 'button', class: 'btn small', 'aria-label': 'Turn right', text: '⟳', onclick: () => { opts.rot = (opts.rot + 1) % 4; redraw(); } }),
    el('button', { type: 'button', class: 'btn small', 'aria-label': 'Zoom out', text: '−', onclick: () => { opts.zoom = Math.max(0.5, (opts.zoom ?? 1) / 1.25); redraw(); } }),
    el('button', { type: 'button', class: 'btn small', 'aria-label': 'Zoom in', text: '+', onclick: () => { opts.zoom = Math.min(4, (opts.zoom ?? 1) * 1.25); redraw(); } })));
  box.redraw = redraw; return box;
}

function designView(id) {
  const d = byId(id); if (!d) return list();
  const opts = { rot: view.rot ?? 0, upTo: Math.min(view.upTo ?? d.h - 1, d.h - 1), zoom: 1 };
  const v3 = viewer(d, opts);
  const layerLabel = el('span', { class: 'small muted' });
  const slider = el('input', { type: 'range', min: '1', max: String(d.h), value: String(opts.upTo + 1), 'aria-label': 'Layers shown' });
  const setL = () => { opts.upTo = Number(slider.value) - 1; view.upTo = opts.upTo; layerLabel.textContent = opts.upTo === d.h - 1 ? `All ${d.h} layers` : `Layers 1–${opts.upTo + 1} of ${d.h}`; v3.redraw(); };
  slider.addEventListener('input', setL); setL();
  const f = footprint(d); const rows = supplyList(d);
  const groups = [['block', 'Blocks'], ['plant', 'Plants (shown grown)'], ['liquid', 'Water and lava (source blocks)'], ['extra', 'Also needed']];
  const supplyText = () => [`${d.name}: ${f.w}×${f.l}×${f.h} blocks`, ...rows.map((r) => `${r.name}: ${r.count}${r.count >= 64 ? ` (${r.stacks})` : ''}`)].join('\n');
  return el('div', {},
    el('div', { class: 'tt-top' }, el('button', { type: 'button', class: 'tt-link', text: '‹ Tutorials', onclick: () => go({ name: 'list', cat: 'All', q: '' }) }), el('h1', { text: d.name }), el('button', { type: 'button', class: 'btn', text: 'Edit', onclick: () => go({ name: 'edit', id: d.id }) })),
    el('p', { class: 'muted small', text: d.category }),
    v3,
    el('div', { class: 'layerbar' }, el('span', { class: 'small', text: 'Build up' }), slider, layerLabel),
    el('h2', { text: 'Space needed' }),
    el('div', { class: 'dims' }, [['w', 'wide'], ['l', 'deep'], ['h', 'tall']].map(([k, label]) => el('div', { class: 'dim' }, el('strong', { text: String(f[k]) }), el('span', { class: 'muted small', text: `blocks ${label}` })))),
    el('h2', {}, 'Supply list ', el('button', { type: 'button', class: 'btn small', text: 'Copy', onclick: () => navigator.clipboard?.writeText(supplyText()).then(() => toast('Copied'), () => toast('Couldn\'t copy')) })),
    rows.length ? el('table', { class: 'supply' }, el('tbody', {}, groups.flatMap(([k, label]) => { const g = rows.filter((r) => r.kind === k); return g.length ? [el('tr', { class: 'group' }, el('td', { colspan: '2', text: label })), ...g.map((r) => el('tr', {}, el('td', {}, r.id ? swatch(r.id) : null, r.name), el('td', { class: 'n', text: r.count >= 64 ? `${r.count}  (${r.stacks})` : String(r.count) })))] : []; }))) : el('p', { class: 'muted', text: 'Nothing built yet: Edit to draw its layers.' }),
    d.desc ? el('div', {}, el('h2', { text: 'How it works' }), el('p', { class: 'desc', text: d.desc })) : null,
    el('h2', { text: 'Videos and guides' }),
    d.links.length ? el('div', { class: 'links' }, d.links.map((l) => el('div', { class: 'lrow' }, el('span', { 'aria-hidden': 'true', text: youtubeId(l.url) || /youtube\.com\/results/.test(l.url) ? '▶' : '🔗' }), el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', text: l.title || l.url })))) : el('p', { class: 'muted small', text: 'None yet: Edit to add a video link.' }),
    d.images.length ? el('div', {}, el('h2', { text: 'Photos' }), el('div', { class: 'gallery' }, d.images.map((b) => el('figure', {}, el('img', { src: urlOf(b), alt: `${d.name} photo` }))))) : null);
}

// ---- Editing: its details, links, photos, extras, size, and its layers.
function edit(id) {
  const d = byId(id); if (!d) return list();
  const name = el('input', { class: 'input', 'aria-label': 'Name', value: d.name, maxlength: '80' });
  const cat = el('input', { class: 'input', 'aria-label': 'Category', value: d.category, maxlength: '40', list: 'tt-cats' });
  const cats = el('datalist', { id: 'tt-cats' }, [...new Set(['Farms', 'Crops', 'Automatic farms', 'Animals', 'Resources', 'Builds', ...designs.map((x) => x.category)])].map((c) => el('option', { value: c })));
  const desc = el('textarea', { class: 'input', rows: '4', 'aria-label': 'Notes', placeholder: 'How it works, tips' }); desc.value = d.desc;
  const keep = () => { d.name = name.value.trim() || 'Untitled'; d.category = cat.value.trim() || 'My designs'; d.desc = desc.value; d.upd = Date.now(); save(); };
  for (const x of [name, cat, desc]) x.addEventListener('change', keep);
  // (Links.)
  const lt = el('input', { class: 'input', placeholder: 'Title (optional)', 'aria-label': 'Link title' }); const lu = el('input', { class: 'input', type: 'url', placeholder: 'https://youtube.com/…', 'aria-label': 'Link' });
  const links = el('div', { class: 'links' });
  const drawLinks = () => fill(links, d.links.map((l, i) => el('div', { class: 'lrow' }, el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', text: l.title || l.url }), el('button', { type: 'button', class: 'btn small danger', 'aria-label': `Remove ${l.title || l.url}`, text: '✕', onclick: () => { d.links.splice(i, 1); save(); drawLinks(); } }))));
  drawLinks();
  // (Photos.)
  const gal = el('div', { class: 'gallery' });
  const drawGal = () => fill(gal, d.images.map((b, i) => el('figure', {}, el('img', { src: urlOf(b), alt: 'Photo' }), el('button', { type: 'button', class: 'x', 'aria-label': 'Remove photo', text: '✕', onclick: () => { d.images.splice(i, 1); save(); drawGal(); } }))));
  drawGal();
  const pic = el('input', { type: 'file', accept: 'image/*', multiple: true, 'aria-label': 'Add photos', hidden: true });
  pic.addEventListener('change', async () => { for (const f of pic.files ?? []) d.images.push(await shrink(f)); pic.value = ''; save(); drawGal(); });
  // (Extras: what isn't a block.)
  const extras = el('div', { class: 'extras' });
  const drawEx = () => fill(extras, d.extras.map((e, i) => { const n = el('input', { class: 'input', value: e.name, 'aria-label': 'Item' }); const c = el('input', { class: 'input', type: 'number', min: '1', value: String(e.count), 'aria-label': 'How many' }); const up = () => { e.name = n.value; e.count = Math.max(1, Number(c.value) || 1); save(); }; n.addEventListener('change', up); c.addEventListener('change', up); return el('div', { class: 'erow' }, n, c, el('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Remove item', text: '✕', onclick: () => { d.extras.splice(i, 1); save(); drawEx(); } })); }),
    el('button', { type: 'button', class: 'btn small', text: '+ Add item', onclick: () => { d.extras.push({ name: 'Villager', count: 1 }); save(); drawEx(); } }));
  drawEx();
  // (Size.)
  const sz = ['w', 'l', 'h'].map((k) => el('input', { class: 'input', type: 'number', min: '1', max: String(MAX_SIZE), value: String(d[k]), 'aria-label': { w: 'Width', l: 'Depth', h: 'Layers' }[k] }));
  return el('div', {},
    el('div', { class: 'tt-top' }, el('button', { type: 'button', class: 'tt-link', text: '‹ Back', onclick: () => { keep(); go({ name: 'design', id: d.id }); } }), el('h1', { text: 'Edit design' }), el('button', { type: 'button', class: 'btn primary', text: 'Layers', onclick: () => { keep(); go({ name: 'layers', id: d.id, y: 0 }); } })),
    el('h2', { text: 'Details' }), el('div', { class: 'row' }, name, cat, cats), el('div', { style: { marginTop: '8px' } }, desc),
    el('h2', { text: 'Size (blocks)' }), el('div', { class: 'row' }, ...sz, el('button', { type: 'button', class: 'btn', text: 'Apply', onclick: () => { resize(d, ...sz.map((x) => x.value)); save(); toast(`Now ${d.w}×${d.l}×${d.h}`); } })),
    el('p', { class: 'muted small', text: 'Width × depth × layers. Making it smaller drops what\'s outside the new size.' }),
    el('h2', { text: 'Videos and guides' }), links, el('div', { class: 'row', style: { marginTop: '8px' } }, lt, lu,
      el('button', { type: 'button', class: 'btn', text: 'Add link', onclick: () => { const u = cleanUrl(lu.value); if (!u) { toast('That isn\'t a link'); return; } d.links.push({ title: lt.value.trim(), url: u }); lt.value = lu.value = ''; save(); drawLinks(); } })),
    el('h2', { text: 'Photos' }), gal, el('div', { class: 'row', style: { marginTop: '8px' } }, el('label', { class: 'btn' }, '+ Add photos', pic)),
    el('h2', { text: 'Also needed (not blocks)' }), extras,
    el('h2', { text: 'More' }), el('div', { class: 'row' },
      el('button', { type: 'button', class: 'btn', text: 'Duplicate', onclick: () => { keep(); const c2 = normalizeDesign({ ...structuredClone({ ...d, images: [] }), id: newId(), name: `${d.name} (copy)`, preset: false }); c2.images = [...d.images]; designs.push(c2); save(); go({ name: 'edit', id: c2.id }); } }),
      el('button', { type: 'button', class: 'btn danger', text: 'Delete design', onclick: () => { if (!confirm(`Delete "${d.name}"?`)) return; designs = designs.filter((x) => x.id !== d.id); save(); go({ name: 'list', cat: 'All', q: '' }); } })));
}

/** A photo kept at most 1600 px on its long side, as JPEG. */
async function shrink(f) {
  try {
    const bmp = await createImageBitmap(f); const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    return await new Promise((r) => c.toBlob((b) => r(b ?? f), 'image/jpeg', 0.88));
  } catch { return f; }
}

// ---- The layer editor: one layer at a time, from above; tap or drag to paint.
let brush = 'stone'; let tool = 'paint'; let recent = [];
function layers(id) {
  const d = byId(id); if (!d) return list();
  let y = Math.max(0, Math.min(d.h - 1, view.y ?? 0)); view.y = y;
  const opts = { rot: 0, upTo: y, zoom: 1, focus: y };
  const v3 = viewer(d, opts);
  const grid = el('canvas', { class: 'ed-grid', 'aria-label': 'This layer, from above: tap or drag to place blocks' });
  const cellOf = (e) => { const r = grid.getBoundingClientRect(); const x = Math.floor(((e.clientX - r.left) / r.width) * d.w); const z = Math.floor(((e.clientY - r.top) / r.height) * d.l); return x >= 0 && z >= 0 && x < d.w && z < d.l ? [x, z] : null; };
  const drawGrid = () => {
    const r = grid.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1); const cw = Math.max(240, r.width); const cs = cw / d.w;
    grid.style.height = `${Math.min(560, cs * d.l)}px`; const ch = Math.min(560, cs * d.l); const cz = ch / d.l;
    grid.width = Math.round(cw * dpr); grid.height = Math.round(ch * dpr); const g = grid.getContext('2d'); g.scale(dpr, dpr);
    g.fillStyle = '#0b0e12'; g.fillRect(0, 0, cw, ch);
    for (let z = 0; z < d.l; z++) for (let x = 0; x < d.w; x++) {
      const id2 = blockAt(d, x, y, z); const below = y > 0 ? blockAt(d, x, y - 1, z) : '';
      if (id2) { g.globalAlpha = Math.max(0.5, BLOCK[id2]?.alpha ?? 1); g.fillStyle = BLOCK[id2]?.color ?? '#f0f'; g.fillRect(x * cs + 1, z * cz + 1, cs - 2, cz - 2); g.globalAlpha = 1; } else if (below) { g.globalAlpha = 0.22; g.fillStyle = BLOCK[below]?.color ?? '#888'; g.fillRect(x * cs + 1, z * cz + 1, cs - 2, cz - 2); g.globalAlpha = 1; }
    }
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
    for (let x = 0; x <= d.w; x++) { g.beginPath(); g.moveTo(x * cs, 0); g.lineTo(x * cs, ch); g.stroke(); }
    for (let z = 0; z <= d.l; z++) { g.beginPath(); g.moveTo(0, z * cz); g.lineTo(cw, z * cz); g.stroke(); }
  };
  let painting = false;
  const paint = (e) => { const c = cellOf(e); if (!c) return; setBlock(d, c[0], y, c[1], tool === 'erase' ? '' : brush); drawGrid(); };
  grid.addEventListener('pointerdown', (e) => { painting = true; grid.setPointerCapture(e.pointerId); paint(e); });
  grid.addEventListener('pointermove', (e) => { if (painting) paint(e); });
  const stop = () => { if (!painting) return; painting = false; save(); v3.redraw(); drawSupply(); };
  grid.addEventListener('pointerup', stop); grid.addEventListener('pointercancel', stop);
  requestAnimationFrame(drawGrid);
  // (The block to paint with: the palette, recent ones, or any block by search.)
  const blkBtn = (bid) => el('button', { type: 'button', class: `blk${bid === brush && tool === 'paint' ? ' on' : ''}`, 'aria-pressed': String(bid === brush && tool === 'paint'), 'aria-label': BLOCK[bid]?.name ?? bid, onclick: () => { brush = bid; tool = 'paint'; recent = [bid, ...recent.filter((x) => x !== bid)].slice(0, 8); drawPal(); } }, swatch(bid), BLOCK[bid]?.name ?? bid);
  const pal = el('div', {}); const q = el('input', { class: 'input', type: 'search', placeholder: 'Search all blocks…', 'aria-label': 'Search all blocks' }); const res = el('div', { class: 'results' });
  const fillBtn = el('button', { type: 'button', class: 'btn small', onclick: () => { fillLayer(d, y, brush); save(); draw(); } });
  const drawPal = () => {
    fillBtn.textContent = `Fill layer with ${BLOCK[brush]?.name ?? brush}`;
    fill(pal, el('div', { class: 'row' },
      el('button', { type: 'button', class: `btn small${tool === 'erase' ? ' on' : ''}`, 'aria-pressed': String(tool === 'erase'), text: '⬚ Air (erase)', onclick: () => { tool = tool === 'erase' ? 'paint' : 'erase'; drawPal(); } }),
      el('span', { class: 'small muted', text: tool === 'erase' ? 'Tap blocks to clear them' : `Painting: ${BLOCK[brush]?.name ?? brush}` })),
      recent.length ? el('div', {}, el('p', { class: 'small muted', text: 'Recent' }), el('div', { class: 'palette' }, recent.map(blkBtn))) : null,
      el('p', { class: 'small muted', text: 'Common' }), el('div', { class: 'palette' }, PRESET_PALETTE.map(blkBtn)));
    fill(res, q.value.trim() ? searchBlocks(q.value).map((b) => blkBtn(b.id)) : null);
  };
  q.addEventListener('input', drawPal); drawPal();
  const supply = el('p', { class: 'small muted' });
  const drawSupply = () => { const f = footprint(d); const n = d.layers[y].filter(Boolean).length; supply.textContent = `This layer: ${n} block${n === 1 ? '' : 's'} · whole design ${f.w}×${f.l}×${f.h}`; };
  drawSupply();
  const setY = (ny) => { view.y = Math.max(0, Math.min(d.h - 1, ny)); draw(); };
  return el('div', {},
    el('div', { class: 'tt-top' }, el('button', { type: 'button', class: 'tt-link', text: '‹ Done', onclick: () => { save(); go({ name: 'design', id: d.id }); } }), el('h1', { text: d.name })),
    el('div', { class: 'row', style: { margin: '10px 0' } },
      el('button', { type: 'button', class: 'btn', 'aria-label': 'Layer below', text: '‹', disabled: y === 0, onclick: () => setY(y - 1) }),
      el('strong', { text: `Layer ${y + 1} of ${d.h}` }),
      el('button', { type: 'button', class: 'btn', 'aria-label': 'Layer above', text: '›', disabled: y >= d.h - 1, onclick: () => setY(y + 1) }),
      el('button', { type: 'button', class: 'btn small', text: '+ Layer above', onclick: () => { addLayer(d, y); save(); setY(y + 1); } }),
      el('button', { type: 'button', class: 'btn small danger', text: 'Delete layer', disabled: d.h <= 1, onclick: () => { if (confirm(`Delete layer ${y + 1}?`)) { removeLayer(d, y); save(); setY(Math.min(y, d.h - 1)); } } })),
    grid, supply,
    el('div', { class: 'row', style: { margin: '8px 0' } },
      fillBtn,
      el('button', { type: 'button', class: 'btn small', text: 'Copy layer below', disabled: y === 0, onclick: () => { copyLayerBelow(d, y); save(); draw(); } }),
      el('button', { type: 'button', class: 'btn small danger', text: 'Clear layer', onclick: () => { fillLayer(d, y, ''); save(); draw(); } })),
    pal, el('div', { style: { marginTop: '8px' } }, q), res,
    el('h2', { text: 'Built up to this layer' }), v3);
}

function draw() {
  fill(host, el('div', { class: 'tt' }, view.name === 'design' ? designView(view.id) : view.name === 'edit' ? edit(view.id) : view.name === 'layers' ? layers(view.id) : list()));
}

load().then(draw, () => { designs = PRESETS.map((p) => normalizeDesign(structuredClone(p))); draw(); });
