// Fashion (in Magic): put a piece of clothing from one photo onto the person in another. Two photos: the
// base (the person to dress) and the piece (a photo with the top, jacket, pants, dress, hat or shoes in
// it, worn or not). Pick its kind, then the piece itself: ✨ found by itself (where that kind is worn),
// 👆 a tap on its color (the area of the colors tapped, grown from all the spots together; the magnifier
// shows what's under the finger), ✏️ a loop traced around it, 🧽 colors taken away, 🖌 / 🩹 brushed in or
// out. Then on the base: ➕ Add (as it is, on top), 🧥 Overlay (over what's worn there, fitted to it), or
// 🔁 Replace (what's worn there taken off where the piece doesn't cover it, the piece fitted to its shape:
// its body to the body, each sleeve to its arm, each shoe to its foot). Placed by the body (📏 guides show
// where the chin, waist and ankles were found, and drag to correct them), its light matched to the
// photo, the photo's folds and shadows carried onto it, hair, face and hands kept in front; then
// fine-tuned (drag, pinch, sliders), with undo, kept on the phone between visits, saved at full size.
// All on this phone (the person finder runs here, offline): nothing leaves it.

import { el, fill, about } from '../../lib/dom.js';
import { sniffType, decodeImage, fitSize, drawToCanvas } from '../../lib/image.js';
import { shareFiles, canShareFiles, downloadBlob } from '../../lib/files.js';
import { drawLoupe } from '../../lib/loupe.js';
import { fillPolygon, softenMask } from '../../lib/geometry.js';
import { noteError } from '../../lib/diag.js';
import { idb } from '../../lib/idb.js';
import { handoff } from '../../lib/handoff.js';
import { colorRegion, sampleShade, strokeShape, strokeMask, membrane } from '../../tools/editor/cleanup.js';
import { KINDS, ZONES, isZone, boxOf, resample, peopleAt, bodyLayout, kindZone, kindRegion, bodyRegion, bodyPlace, garmentPlace, solidify, closeMask, mainParts, fillHoles, rowSpans, rigidPlace, splitSleeves, splitPair, scaleLayout, splitPeople } from '../../tools/fashion/fashion-core.js';
import { buildLayer, finish, uncovered, fillUncovered, lay, leftovers, recolor } from './compose.js';

const WORK_MAX = 1024;
const SAVE_MAX = 2560;      // the saved picture's longest side (and no more than ~6 MP: a phone's memory)
const SESSION_KEY = 'fashion.session';
const MODES = [['add', '➕ Add'], ['overlay', '🧥 Overlay'], ['replace', '🔁 Replace']];
// What each way starts with: how far it's fitted to what's worn there, and how much of the photo's form it takes.
// (Replace takes the shape of what was worn there, the way it sits on this body: fitted all the way.)
const MODE_TUNE = { add: { fit: 0, form: 60 }, overlay: { fit: 75, form: 60 }, replace: { fit: 100, form: 60 } };
const newTune = (mode) => ({ scale: 100, wide: 100, long: 100, rot: 0, dx: 0, dy: 0, soft: 1, light: 80, front: true, arms: true, depth: true, ...MODE_TUNE[mode] });
// (Fitted body and sleeves apart: a jacket's or a dress's. A tee or a shirt fits as one: its arms hanging
// over its sides in a photo would make its body look narrower than it is.)
const SLEEVED = ['jacket', 'dress'];
const GUIDES = [['chin', 'Chin', '#3d8bff'], ['waist', 'Waist', '#ffd60a'], ['ankle', 'Ankles', '#34c759']];

export function mount(host) {
  /** @type {any} */ let base = null; /** @type {any} */ let piece = null;
  let kind = 'top'; let mode = 'replace'; let step = 'photos';
  let tool = 'tap';        // the piece: 'tap' | 'erase' | 'trace' | 'brush+' | 'brush-' | 'guides'; the base: 'move' | 'tap' | 'trace' | 'brush+' | 'brush-' | 'guides'
  let tol = 20; let brush = 18; let note = ''; let busy = false;
  let target = null;       // what's worn on the base there: { mask, box, spans, auto, taps, edits, parts }
  let tune = newTune(mode); let place = null;
  const cache = {};        // finishing (form, what's in front), kept between frames
  let fillCache = null;    // what's taken off where the piece doesn't cover it: { key, patch }
  let interacting = false; // a finger or slider moving: the fill under it waits
  let canvas = null; let ctx = null; let panel = null; let raf = 0; let press = null; let shown = null;
  const pointers = new Map(); let pinch = null;
  let comparing = false;
  let moreOpen = false;
  let alive = true;
  const history = { undo: [], redo: [] };
  let resume = null;       // a saved session to continue

  // ---------- photos ----------

  async function load(file) {
    const type = await sniffType(file);
    const bmp = await decodeImage(file, type);
    const fit = fitSize(bmp.width, bmp.height, WORK_MAX);
    const c = drawToCanvas(bmp, fit.width, fit.height, '#fff'); bmp.close?.();
    const img = { file, canvas: c, w: c.width, h: c.height, rgba: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, people: null, layout: null, finding: true };
    // The person in it (where their face, body and clothes are), worked out on the phone. Without it
    // (the model can't load), everything still works by tapping and tracing.
    img.ready = (async () => {
      try {
        const { segmentPeople } = await import('../../lib/face-parts.js');
        const p = await segmentPeople(c);
        if (p) img.allPeople = peopleAt(p, img.w, img.h);
      } catch (e) { noteError('Fashion: finding the person', e); }
      if (img.allPeople) {
        // Their poses (shoulders, elbows, wrists): an arm told from the body beside it, and each person
        // in a group photo told from the next.
        let poses = [];
        try { const { detectPoses } = await import('../../lib/pose.js'); poses = await detectPoses(c); } catch (e) { noteError('Fashion: finding the pose', e); }
        img.poses = poses;
        try {
          const split = splitPeople(img.allPeople, img.rgba, poses);
          if (split.length > 1) img.persons = split.map((q) => ({ ...q, pose: poseIn(q.face, poses), thumb: faceThumb(img, q.face) }));
        } catch (e) { noteError('Fashion: telling the people apart', e); }
        const biggest = img.persons ? img.persons.reduce((a, q, k) => (q.n > img.persons[a].n ? k : a), 0) : 0;
        choose(img, img.savedWho ?? biggest, true);
      }
      img.finding = false;
      if (!alive) return;
      if (img === piece && step === 'pick' && !piece.sel) autoPick(true);
      if (img === base && step === 'put') { if (!target) autoTarget(); if (!place) placeIt(); }
      render();
    })();
    return img;
  }

  /** The pose whose nose is in a face (a little past it; the nearest its middle), or null. */
  function poseIn(face, poses) {
    if (!face) return null;
    const fw = face.x1 - face.x0; const fh = face.y1 - face.y0;
    const cx = (face.x0 + face.x1) / 2; const cy = (face.y0 + face.y1) / 2;
    return poses.filter((q) => q.nose[0] >= face.x0 - fw * 0.15 && q.nose[0] <= face.x1 + fw * 0.15 && q.nose[1] >= face.y0 - fh * 0.15 && q.nose[1] <= face.y1 + fh * 0.15)
      .sort((a, b) => Math.hypot(a.nose[0] - cx, a.nose[1] - cy) - Math.hypot(b.nose[0] - cx, b.nose[1] - cy))[0] ?? null;
  }
  /** A small round picture of a face (its head, a little around it), for choosing who. */
  function faceThumb(img, f) {
    if (!f) return null;
    const side = Math.max(f.x1 - f.x0, f.y1 - f.y0) * 1.5; const cx = (f.x0 + f.x1) / 2; const cy = (f.y0 + f.y1) / 2;
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    c.getContext('2d').drawImage(img.canvas, cx - side / 2, cy - side / 2, side, side, 0, 0, 64, 64);
    return c.toDataURL('image/jpeg', 0.8);
  }
  /**
   * The one person in a photo everything goes by (in a group photo, the one chosen): only their face, body
   * and clothes, their layout and their pose. `first`: as it's found (a saved layout kept).
   */
  function choose(img, k, first = false) {
    const P = img.persons;
    if (!P) {
      img.who = null; img.people = img.allPeople; img.pose = img.poses?.length ? img.poses.reduce((a, b) => (Math.abs(b.shoulders[1][0] - b.shoulders[0][0]) > Math.abs(a.shoulders[1][0] - a.shoulders[0][0]) ? b : a)) : null;
    } else {
      k = Math.max(0, Math.min(P.length - 1, k));
      if (!first && img.who === k) return;
      img.who = k; img.people = P[k].p; img.pose = P[k].pose;
    }
    img.layout = first && img.savedLayout ? img.savedLayout : bodyLayout(img.people, img.rgba);
    img.sil = null;
  }
  /** Someone else in a group photo chosen: what was picked on them, or found on them, starts over. */
  function switchTo(img, k) {
    if (!img?.persons || img.who === k) return;
    choose(img, k);
    if (img === piece) { piece.found = null; piece.parts = null; setSel(new Uint8Array(piece.w * piece.h)); autoPick(true); note = `Person ${k + 1}: ${piece.sel ? 'found ✨ (pink).' : 'tap what to take.'}`; }
    else { target = null; fillCache = null; place = null; autoTarget(); placeIt(); note = `Dressing person ${k + 1}.`; }
    commit(); render();
  }
  /** In a group photo: who (a face to tap for each person, left to right). */
  function whoRow(img, label) {
    if (!img?.persons) return null;
    return el('div', { class: 'fa-who' }, el('span', { class: 'small', text: label }),
      el('div', { class: 'chips' }, ...img.persons.map((q, k) => el('button', {
        type: 'button', class: `fa-who-item${img.who === k ? ' active' : ''}`, 'aria-pressed': String(img.who === k), 'aria-label': `Person ${k + 1}`,
        onclick: () => switchTo(img, k),
      }, q.thumb ? el('img', { src: q.thumb, alt: '' }) : null, el('span', { class: 'small', text: `${k + 1}` })))));
  }
  /** Which person in a group photo is at a point, or -1. */
  function personAt(img, x, y) {
    if (!img?.persons) return -1; const i = y * img.w + x;
    return img.persons.findIndex((q) => Math.max(q.p.body[i], q.p.clothes[i], q.p.face[i], q.p.hair[i], q.p.others[i]) >= 128);
  }

  function photosView() {
    const slot = (which, label, hint) => {
      const img = which === 'base' ? base : piece;
      const input = el('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'visually-hidden', id: `fa-${which}` });
      input.addEventListener('change', async () => { const f = input.files?.[0]; input.value = ''; if (f) await usePhoto(which, f); });
      const thumb = img ? el('img', { class: 'fa-thumb', alt: label, src: img.canvas.toDataURL('image/jpeg', 0.7) }) : el('span', { class: 'fa-thumb fa-empty', text: which === 'base' ? '🧍' : '👕' });
      return el('label', { class: 'card fa-slot', for: `fa-${which}` }, thumb, el('strong', { text: label }), el('span', { class: 'small muted', text: img ? 'Tap to change' : hint }), input);
    };
    return [
      resume ? el('section', { class: 'card resume' },
        el('strong', { text: 'Continue where you left off?' }),
        el('span', { class: 'muted small', text: `Saved on this phone ${new Date(resume.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` }),
        el('div', { class: 'row' },
          el('button', { class: 'btn primary', type: 'button', text: 'Continue', onclick: () => restore(resume) }),
          el('button', { class: 'btn ghost', type: 'button', text: 'Discard', onclick: () => { idb.del(SESSION_KEY); resume = null; render(); } }))) : null,
      el('div', { class: 'fa-slots' },
        slot('base', '1 · Base', 'The person to dress'),
        slot('piece', '2 · Piece', 'A photo with the clothes in it')),
      note ? el('p', { class: 'small muted center', text: note }) : null,
      el('button', { class: 'btn primary block', type: 'button', text: 'Next: pick the piece', disabled: !base || !piece, onclick: () => { step = 'pick'; tool = 'tap'; note = ''; if (!piece.sel) autoPick(true); commit(); render(); } }),
      about('Pick the person to dress, then a photo with the piece in it (worn by someone, or on its own). Both stay on this phone: nothing is uploaded.'),
    ];
  }
  async function usePhoto(which, f) {
    note = 'Opening…'; render();
    try {
      const im = await load(f);
      if (which === 'base') { base = im; target = null; fillCache = null; place = null; } else { piece = im; piece.sel = null; piece.found = null; place = null; }
      resume = null; note = '';
    } catch (e) { note = e.message; }
    render();
  }

  // ---------- undo, and kept on the phone ----------

  /** What can be undone: everything chosen, not the photos. */
  const snap = () => ({
    step, kind, mode, tol, tune: { ...tune },
    sel: piece?.sel ?? null, picks: piece?.picks ? { ...piece.picks, add: [...piece.picks.add], del: [...piece.picks.del], edits: [...(piece.picks.edits ?? [])] } : null,
    target: target && { mask: target.mask, auto: target.auto, body: !!target.body, taps: target.taps ?? [], edits: target.edits ?? [] },
    baseLayout: base?.layout ? { ...base.layout } : null, pieceLayout: piece?.layout ? { ...piece.layout } : null,
    place: place && { ...place },
    who: { base: base?.who ?? null, piece: piece?.who ?? null },
  });
  function apply(sn) {
    ({ step, kind, mode, tol } = sn); tune = { ...sn.tune };
    if (sn.who) { if (piece?.persons && sn.who.piece != null) choose(piece, sn.who.piece); if (base?.persons && sn.who.base != null) choose(base, sn.who.base); }
    if (piece) { piece.picks = sn.picks; setSel(sn.sel ?? new Uint8Array(piece.w * piece.h), true); if (sn.pieceLayout) piece.layout = sn.pieceLayout; }
    if (base && sn.baseLayout) base.layout = sn.baseLayout;
    if (sn.target && base) { setTarget(sn.target.mask, sn.target.auto); target.taps = sn.target.taps; target.edits = sn.target.edits; target.body = sn.target.body; } else target = null;
    place = sn.place; if (step === 'put' && piece?.sel) prepPiece();
    if (step === 'put' && !place) placeIt();
  }
  /** A change made: undoable, and kept. */
  function commit() {
    const s = snap(); const last = history.undo.at(-1);
    if (last && JSON.stringify({ ...last, sel: 0, target: 0, picks: 0 }) === JSON.stringify({ ...s, sel: 0, target: 0, picks: 0 }) && last.sel === s.sel && last.target?.mask === s.target?.mask && last.picks?.add.length === s.picks?.add.length && last.picks?.del.length === s.picks?.del.length && last.picks?.edits.length === s.picks?.edits.length) return;
    history.undo.push(s); if (history.undo.length > 40) history.undo.shift();
    history.redo.length = 0;
    keep();
  }
  function undo() { if (history.undo.length < 2) return; history.redo.push(history.undo.pop()); apply(history.undo.at(-1)); fillCache = null; keep(); render(); }
  function redo() { const s = history.redo.pop(); if (!s) return; history.undo.push(s); apply(s); fillCache = null; keep(); render(); }
  let keepTimer = 0;
  function keep() {
    clearTimeout(keepTimer);
    keepTimer = setTimeout(() => {
      if (!base || !piece) return;
      const s = snap();
      idb.set(SESSION_KEY, { ...s, baseFile: base.file, pieceFile: piece.file, savedAt: Date.now() }).catch(() => {});
    }, 600);
  }
  async function restore(saved) {
    note = 'Opening…'; render();
    try {
      base = await load(saved.baseFile); piece = await load(saved.pieceFile);
      if (saved.baseLayout) base.savedLayout = saved.baseLayout;
      if (saved.pieceLayout) piece.savedLayout = saved.pieceLayout;
      if (saved.who) { base.savedWho = saved.who.base; piece.savedWho = saved.who.piece; }
      resume = null; note = '';
      apply(saved); history.undo = [snap()]; history.redo = [];
      tool = step === 'put' ? 'move' : 'tap';
    } catch (e) { note = `Couldn't open it: ${e.message}`; step = 'photos'; }
    render();
  }

  // ---------- the piece ----------

  /** ✨ The piece found by itself: what's worn where its kind is, on the person in its photo. */
  function autoPick(quiet = false) {
    if (!piece) return;
    if (piece.finding) { if (!quiet) note = 'Still finding the person…'; return; }
    const r = piece.people && piece.layout ? kindRegion(kind, piece.people, piece.layout) : null;
    if (!r) { if (!quiet) note = 'Couldn\'t find one by itself: tap its color, or trace around it.'; return; }
    setSel(r.mask); note = 'Found ✨ (pink). Tap more of it, 🧽 take colors away, 🖌 brush, or ✏️ trace to keep only what\'s inside.';
  }
  function setSel(mask, keepPicks = false) {
    if (!keepPicks) piece.picks = { add: [], del: [], loop: null, base: mask, edits: [] };
    const b = boxOf(mask, piece.w, piece.h);
    piece.sel = b ? mask : null; piece.box = b; piece.alpha = null; piece.draw = null; piece.rebuilt = null; piece.skinMap = null; piece.view = null; piece.parts = null; place = null;
  }
  const newPicks = () => ({ add: [], del: [], loop: null, base: piece.sel, edits: [] });
  /**
   * A tap on the piece: its color picked (👆) or taken away (🧽). The piece is the area of all the colors
   * picked, grown from all the spots tapped together (so stripes or a print, color against color, are one
   * piece), less the areas of the colors taken away, inside a traced loop if there is one, then what was
   * brushed in or out.
   */
  function pickAt(x, y) {
    const { w, h, rgba } = piece;
    const c = { at: [x, y], shade: sampleShade(rgba, w, h, x, y, 2) };
    if (!colorRegion(rgba, w, h, [c.at], [c.shade], tol)) { note = 'Nothing of that color right there: press on it (the magnifier shows what you\'re on).'; return; }
    piece.picks ??= newPicks();
    piece.picks[tool === 'erase' ? 'del' : 'add'].push(c);
    rebuildSel();
    note = tool === 'erase' ? 'Taken away.' : piece.sel && boxShare(piece) > 0.6 ? 'That covers much of the photo: lower Match, or ✏️ trace around just the piece.' : '';
  }
  const boxShare = (im) => { const b = im.box; return b ? ((b.x1 - b.x0) * (b.y1 - b.y0)) / (im.w * im.h) : 0; };
  /** Brushed edits ({ local, box, add }) laid on a mask (in place). */
  function applyEdits(m, w, edits) {
    for (const e of edits ?? []) {
      const bw = e.box.x1 - e.box.x0;
      for (let y = e.box.y0; y < e.box.y1; y++) for (let x = e.box.x0; x < e.box.x1; x++) if (e.local[(y - e.box.y0) * bw + x - e.box.x0]) m[y * w + x] = e.add ? 1 : 0;
    }
  }
  function cropEdit(mask, w, box, add) {
    const bw = box.x1 - box.x0; const local = new Uint8Array(bw * (box.y1 - box.y0));
    for (let y = box.y0; y < box.y1; y++) local.set(mask.subarray(y * w + box.x0, y * w + box.x1), (y - box.y0) * bw);
    return { local, box, add };
  }
  /** The piece from what's been picked (on top of what was found by itself, if it was). */
  function rebuildSel() {
    const { w, h, rgba } = piece; const pk = piece.picks;
    const m = pk.base ? Uint8Array.from(pk.base) : new Uint8Array(w * h);
    if (pk.add.length) {
      const r = colorRegion(rgba, w, h, pk.add.map((c) => c.at), pk.add.map((c) => c.shade), tol);
      if (r) for (let i = 0; i < w * h; i++) if (r.sel[i]) m[i] = 1;
    }
    let b = boxOf(m, w, h); if (b) fillHoles(m, w, h, b, 0.3);
    if (pk.del.length) {
      const r = colorRegion(rgba, w, h, pk.del.map((c) => c.at), pk.del.map((c) => c.shade), tol);
      if (r) for (let i = 0; i < w * h; i++) if (r.sel[i]) m[i] = 0;
    }
    if (pk.loop) for (let i = 0; i < w * h; i++) if (!pk.loop[i]) m[i] = 0;
    // On a person: only what they're wearing (their clothes, what's on them, and a little past it), never the
    // wall or floor behind them, however alike in color.
    if (piece.people && pk.add.length) {
      const p = piece.people; const on = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) if (Math.max(p.clothes[i], p.others[i]) >= 96) on[i] = 1;
      const ob = boxOf(on, w, h);
      if (ob) { closeMask(on, w, h, ob, 3); for (let y = Math.max(0, ob.y0 - 4); y < Math.min(h, ob.y1 + 4); y++) for (let x = Math.max(0, ob.x0 - 4); x < Math.min(w, ob.x1 + 4); x++) { /* grown a few px */ if (!on[y * w + x]) { for (let d = 1; d <= 3; d++) if ((x - d >= 0 && on[y * w + x - d] === 1) || (x + d < w && on[y * w + x + d] === 1) || (y - d >= 0 && on[(y - d) * w + x] === 1) || (y + d < h && on[(y + d) * w + x] === 1)) { on[y * w + x] = 2; break; } } }
        for (let i = 0; i < w * h; i++) if (!on[i] && !pk.base?.[i]) m[i] = 0; }
    }
    applyEdits(m, w, pk.edits);
    b = boxOf(m, w, h);
    const k = b ? mainParts(m, w, h, b, 0.05) : null;
    setSel(k ? k.mask : m, true);
  }
  function traceLoop(pts, w, h) {
    const f = fillPolygon(pts, 0, 0, w, h);
    const m = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) m[i] = f[i] ? 1 : 0;
    return m;
  }
  /** The piece made ready to put on: its soft edge, and its parts (a top's body and sleeves, a pair of shoes). */
  function prepPiece() {
    if (!piece?.sel) return;
    // Solid (cloth isn't see-through: the specks and gaps a pick leaves closed), its edge only softened.
    if (!piece.alpha) {
      piece.solid = solidify(piece.sel, piece.w, piece.h, piece.box);
      // (A body zone has gaps of its own, the background seen through the loop of an arm: not closed.)
      const pp = piece.people;
      if (isZone(kind) && pp) for (let i = 0; i < piece.solid.length; i++) if (piece.solid[i] && !piece.sel[i] && Math.max(pp.body[i], pp.clothes[i], pp.others[i], pp.hair[i]) < 64) piece.solid[i] = 0;
      repairPiece();
      piece.box = boxOf(piece.solid, piece.w, piece.h) ?? piece.box; piece.alpha = softenMask(piece.solid, piece.w, piece.h, 1);
    }
    if (!piece.parts) {
      const soft = (p) => p && { ...p, alpha: partAlpha(piece.alpha, p, piece.w, piece.h) };
      if (SLEEVED.includes(kind)) { const s = splitSleeves(piece.solid, piece.w, piece.h, piece.box); piece.parts = { sleeves: { torso: soft(s.torso), left: soft(s.left), right: soft(s.right) } }; } else if (kind === 'shoes') piece.parts = { pair: splitPair(piece.solid, piece.w, piece.h, piece.box).map(soft) };
      else piece.parts = {};
    }
  }

  /**
   * What was in front of the piece in its photo (long hair over the shirt, a hand across it) rebuilt from
   * the piece itself, so it's whole: the hair and hands within its outline (each row, from its left to its
   * right edge) filled from the cloth around them (never the background), and made part of it. Otherwise
   * the base shows through where the hair was.
   */
  function repairPiece() {
    piece.draw = null;
    const p = piece.people; if (!p) return;
    const { w, h } = piece; const m = piece.solid; const b = boxOf(m, w, h); if (!b) return;
    const L = piece.layout; const hands = L ? L.chin + L.fh * 1.2 : h;
    // (The cloth's usual brightness: r + g + b, its median.)
    const tones = []; for (let i = 0; i < w * h; i += 5) if (m[i] && p.hair[i] < 20) tones.push(piece.rgba[i * 4] + piece.rgba[i * 4 + 1] + piece.rgba[i * 4 + 2]);
    tones.sort((a2, b2) => a2 - b2); const tone = tones[tones.length >> 1] ?? 380;
    // Its top edge (the shoulders, the neckline) column by column, where hair doesn't hide it; across the
    // hair, carried straight from the columns on either side. Nothing above it is rebuilt.
    const top = new Float32Array(w).fill(NaN);
    for (let x = b.x0; x < b.x1; x++) {
      let y = b.y0; while (y < b.y1 && !m[y * w + x]) y++;
      // (Seen only if no hair at all, however faint, is just above it.)
      let hairAbove = false; for (let d = 0; d <= 5 && !hairAbove; d++) if (y - d >= 0 && p.hair[(y - d) * w + x] >= 25) hairAbove = true;
      if (y < b.y1 && !hairAbove) top[x] = y;
    }
    // (The neckline is about the neck's width under the face: within it, its own shape; outside it, the
    // shoulders, carried level from the nearest shoulder seen on that side, not sloped down to the neck.)
    const F = L?.face; const nc = F ? (F.x0 + F.x1) / 2 : -1; const nh = F ? (F.x1 - F.x0) * 0.55 : 0;
    const inNeck = (x) => F && Math.abs(x - nc) < nh;
    const fillGap = (x, ok) => {
      let l = x; while (l >= b.x0 && (Number.isNaN(top[l]) || !ok(l))) l--; let r = x; while (r < b.x1 && (Number.isNaN(top[r]) || !ok(r))) r++;
      const L2 = l >= b.x0 ? top[l] : NaN; const R2 = r < b.x1 ? top[r] : NaN;
      return !Number.isNaN(L2) && !Number.isNaN(R2) ? L2 + ((R2 - L2) * (x - l)) / (r - l) : !Number.isNaN(L2) ? L2 : !Number.isNaN(R2) ? R2 : NaN;
    };
    const filledTop = Float32Array.from(top);
    for (let x = b.x0; x < b.x1; x++) {
      if (!Number.isNaN(top[x])) continue;
      // (A neckline hidden by hair: a gentle U between where it's seen on either side.)
      if (inNeck(x)) { const g = fillGap(x, inNeck); filledTop[x] = Number.isNaN(g) ? g : g + nh * 0.22 * (1 - ((x - nc) / nh) ** 2); continue; }
      // A shoulder: level with the nearest shoulder seen on its own side of the neck.
      // (The nearest seen on each side of it, outside the neck: the higher of the two. A shoulder is high.)
      const side = x < nc ? -1 : 1; let v = NaN;
      for (const dir of [-1, 1]) {
        for (let xx = x + dir; xx >= b.x0 && xx < b.x1; xx += dir) {
          if (inNeck(xx) || (F && Math.sign(xx - nc) !== side)) break;
          if (!Number.isNaN(top[xx])) { v = Number.isNaN(v) ? top[xx] : Math.min(v, top[xx]); break; }
        }
      }
      filledTop[x] = Number.isNaN(v) ? fillGap(x, () => true) : v;
    }
    for (let x = b.x0; x < b.x1; x++) top[x] = Number.isNaN(filledTop[x]) ? b.y0 : filledTop[x];
    const occl = new Uint8Array(w * h); let n = 0;
    // (Each row's ends; and for a hand, the widest the piece is a hand's height around: a hand on a hip
    // reaches past the piece's edge in its own rows.)
    // (A body zone's skin is its own (its arms), but a hand across its cloth isn't: there, the cloth's ends.)
    const zone = isZone(kind);
    const ends = new Int32Array((b.y1 - b.y0) * 2).fill(-1);
    for (let y = b.y0; y < b.y1; y++) { for (let x = b.x0; x < b.x1; x++) if (m[y * w + x] && (!zone || p.clothes[y * w + x] >= 128)) { if (ends[(y - b.y0) * 2] < 0) ends[(y - b.y0) * 2] = x; ends[(y - b.y0) * 2 + 1] = x; } }
    const HR = Math.round((L?.fh ?? 40) * 0.45);
    for (let y = b.y0; y < b.y1; y++) {
      const l = ends[(y - b.y0) * 2]; const r = ends[(y - b.y0) * 2 + 1];
      if (l < 0) continue;
      let lw = l; let rw = r;
      if (y > hands) for (let yy = Math.max(b.y0, y - HR); yy < Math.min(b.y1, y + HR); yy++) { const a = ends[(yy - b.y0) * 2]; if (a >= 0) { lw = Math.min(lw, a); rw = Math.max(rw, ends[(yy - b.y0) * 2 + 1]); } }
      for (let x = lw; x <= rw; x++) {
        // (Hair, picked with it or not: a dark lock caught at its edge goes too.)
        const i = y * w + x; if (y < top[x] - 1) continue;
        if (y > hands && (!m[i] || zone) && p.body[i] >= 128) { occl[i] = 1; n++; continue; }
        if (x < l || x > r) continue;
        if (p.hair[i] >= 70) { occl[i] = 1; n++; continue; }
        // (A dark tip of hair the finder was less sure of: far darker than the cloth, beside some hair.)
        if (p.hair[i] >= 20 && m[i] && piece.rgba[i * 4] + piece.rgba[i * 4 + 1] + piece.rgba[i * 4 + 2] < tone - 150) { occl[i] = 1; n++; }
      }
    }
    if (n < 30) return;
    // (And any gap left inside it: a strand's shadow, a speck between strands.)
    { const all = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) all[i] = m[i] || occl[i] ? 1 : 0;
      const filled = Uint8Array.from(all); fillHoles(filled, w, h, b, 0.5);
      for (let i = 0; i < w * h; i++) if (filled[i] && !all[i]) occl[i] = 1; }
    // Filled smoothly from the cloth all around it (its color and shading carried across: a plain shirt
    // stays plain, no copied patches), with its grain.
    const ob = boxOf(occl, w, h);
    const bx = { x0: Math.max(0, ob.x0 - 2), y0: Math.max(0, ob.y0 - 2), x1: Math.min(w, ob.x1 + 2), y1: Math.min(h, ob.y1 + 2) };
    const bw = bx.x1 - bx.x0; const bh = bx.y1 - bx.y0;
    const val = new Float32Array(bw * bh * 3); const free = new Uint8Array(bw * bh).fill(1);
    // Only clean cloth sets the color: not within 3 px of what's filled (a hair's soft edge), and near the
    // cloth's own typical color (its median).
    // (In a body zone, its cloth only: not its arms' skin.)
    const cloth = (i) => m[i] && !occl[i] && (!zone || p.clothes[i] >= 128);
    const med = [0, 1, 2].map((c) => { const v = []; for (let i = 0; i < w * h; i += 7) if (cloth(i)) v.push(piece.rgba[i * 4 + c]); v.sort((a2, b2) => a2 - b2); return v[v.length >> 1] ?? 128; });
    const near = (i) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = (i % w) + dx; const Y = ((i / w) | 0) + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && occl[Y * w + X]) return true; } return false; };
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = (bx.y0 + y) * w + bx.x0 + x; const k = y * bw + x;
      if (!cloth(i) || near(i)) continue;
      const d = Math.abs(piece.rgba[i * 4] - med[0]) + Math.abs(piece.rgba[i * 4 + 1] - med[1]) + Math.abs(piece.rgba[i * 4 + 2] - med[2]);
      if (d > 90) continue;
      free[k] = 0; for (let c = 0; c < 3; c++) val[k * 3 + c] = piece.rgba[i * 4 + c];
    }
    // (What isn't filled nor clean cloth right beside what's filled, the hair's fringe, is filled too; a fold's
    // shade further off is left as it is, it just doesn't set the color.)
    const fringe = [];
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const i = (bx.y0 + y) * w + bx.x0 + x; if (m[i] && !occl[i] && free[y * bw + x] && near(i) && (!zone || p.clothes[i] >= 128)) fringe.push(i); }
    for (const i of fringe) occl[i] = 1;
    try {
      // (Seeded with the cloth's average, so what nothing reaches isn't black.)
      const avg = [0, 0, 0]; let na = 0; for (let k = 0; k < bw * bh; k++) if (!free[k]) { avg[0] += val[k * 3]; avg[1] += val[k * 3 + 1]; avg[2] += val[k * 3 + 2]; na++; }
      if (!na) return;
      for (let k = 0; k < bw * bh; k++) if (free[k]) for (let c = 0; c < 3; c++) val[k * 3 + c] = avg[c] / na;
      membrane(val, free, bw, bh);
      const draw = Uint8ClampedArray.from(piece.rgba);
      let seed = 7;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const i = (bx.y0 + y) * w + bx.x0 + x; if (!occl[i]) continue;
        seed = (seed * 1103515245 + 12345) >>> 0; const g = ((seed / 4294967296) - 0.5) * 6;
        // (Leaning toward the cloth's usual color: next to hair it's in the hair's shadow, darker than it is.)
        for (let c = 0; c < 3; c++) draw[i * 4 + c] = val[(y * bw + x) * 3 + c] * 0.35 + med[c] * 0.65 + g;
      }
      piece.draw = draw;
      const solid = Uint8Array.from(m); for (let i = 0; i < w * h; i++) if (occl[i]) solid[i] = 1;
      piece.solid = solid; piece.rebuilt = occl;
    } catch (e) { noteError('Fashion: rebuilding the piece', e); }
  }

  /**
   * A part's (a sleeve's, a shoe's) share of the piece's soft edge: the piece's alpha within the part grown
   * by 2 px, so parts overlap a little where they were cut apart (no seam showing through).
   */
  function partAlpha(alpha, p, w, h) {
    const out = new Float32Array(w * h); const b = p.box;
    for (let y = Math.max(0, b.y0 - 3); y < Math.min(h, b.y1 + 3); y++) for (let x = Math.max(0, b.x0 - 3); x < Math.min(w, b.x1 + 3); x++) {
      let on = false;
      for (let dy = -2; dy <= 2 && !on; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx; const Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && p.mask[Y * w + X]) { on = true; break; } }
      if (on) out[y * w + x] = alpha[y * w + x];
    }
    return out;
  }

  const undoBar = () => el('div', { class: 'row fa-undo' },
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Undo', title: 'Undo', text: '↶', disabled: history.undo.length < 2, onclick: undo }),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Redo', title: 'Redo', text: '↷', disabled: !history.redo.length, onclick: redo }));
  const toolChip = (id, label, hint) => el('button', {
    type: 'button', class: `chip${tool === id ? ' active' : ''}`, 'aria-pressed': String(tool === id), text: label,
    onclick: () => { tool = id; note = typeof hint === 'function' ? hint() : hint; render(); },
  });

  /**
   * What's worn in the piece's photo, found by itself (a top, a bottom, a dress, a hat, shoes): each with
   * its mask and a small picture of it, for the list to pick from.
   */
  function foundPieces() {
    if (!piece?.people || !piece.layout) return [];
    if (piece.found) return piece.found;
    const { w, h } = piece; const out = [];
    for (const id of ['top', 'bottom', 'dress', 'hat', 'shoes']) {
      const r = kindRegion(id, piece.people, piece.layout); if (!r) continue;
      const n = r.mask.reduce((a, v) => a + v, 0); if (n < w * h * 0.01) continue;
      // (What can't be there: a bottom only where a top's end was seen (the clothes change color); a dress only
      // where they don't and it runs well past the waist, the photo not cut off there; shoes only with the
      // feet in the photo. And nothing that's mostly something already found.)
      const L = piece.layout; const cut = (L.person?.y1 ?? h) >= h - 3;
      if (id === 'bottom' && !L.split) continue;
      if (id === 'dress' && (L.split || cut || r.box.y1 < L.waist + L.fh * 0.8)) continue;
      if (id === 'shoes' && cut) continue;
      if (out.some((o) => { let both = 0; for (let i = 0; i < w * h; i++) if (o.mask[i] && r.mask[i]) both++; return both > n * 0.6; })) continue;
      // Its picture: the piece on a light background, its box made square.
      const b = r.box; const side = Math.max(b.x1 - b.x0, b.y1 - b.y0); const cx = (b.x0 + b.x1) / 2; const cy = (b.y0 + b.y1) / 2;
      const c = document.createElement('canvas'); c.width = 72; c.height = 72; const x = c.getContext('2d');
      const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h; const tx = tmp.getContext('2d');
      const d = new ImageData(Uint8ClampedArray.from(piece.rgba), w, h);
      for (let i = 0; i < w * h; i++) if (!r.mask[i]) { d.data[i * 4] = 238; d.data[i * 4 + 1] = 238; d.data[i * 4 + 2] = 240; }
      tx.putImageData(d, 0, 0);
      x.fillStyle = '#eeeef0'; x.fillRect(0, 0, 72, 72);
      x.drawImage(tmp, cx - side / 2, cy - side / 2, side, side, 0, 0, 72, 72);
      const k = KINDS.find((q) => q[0] === id);
      out.push({ id, icon: k[1], name: k[2], mask: r.mask, thumb: c.toDataURL('image/jpeg', 0.8) });
    }
    // Body zones: everything worn there at once (the shirt, the vest over it, the necklace on it).
    const L = piece.layout; const cut = (L.person?.y1 ?? h) >= h - 3;
    for (const [id, icon, name] of ZONES) {
      if ((id === 'lower' && !L.split) || (id === 'outfit' && (cut || !L.split))) continue;
      const r = kindRegion(id, piece.people, L); if (!r) continue;
      const b = r.box; const side = Math.max(b.x1 - b.x0, b.y1 - b.y0); const cx = (b.x0 + b.x1) / 2; const cy = (b.y0 + b.y1) / 2;
      const c = document.createElement('canvas'); c.width = 72; c.height = 72; const x = c.getContext('2d');
      const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
      const d = new ImageData(Uint8ClampedArray.from(piece.rgba), w, h);
      for (let i = 0; i < w * h; i++) if (!r.mask[i]) { d.data[i * 4] = 238; d.data[i * 4 + 1] = 238; d.data[i * 4 + 2] = 240; }
      tmp.getContext('2d').putImageData(d, 0, 0);
      x.fillStyle = '#eeeef0'; x.fillRect(0, 0, 72, 72); x.drawImage(tmp, cx - side / 2, cy - side / 2, side, side, 0, 0, 72, 72);
      out.push({ id, icon, name, mask: r.mask, thumb: c.toDataURL('image/jpeg', 0.8), zone: true });
    }
    piece.found = out;
    return out;
  }

  function pickView() {
    // Found in this photo: tap one to take it (and its kind).
    const found = foundPieces();
    const foundRow = found.length ? el('div', { class: 'fa-found' },
      el('p', { class: 'small', text: 'Found in this photo — tap one:' }),
      el('div', { class: 'chips fa-found-row' }, ...found.map((f) => el('button', {
        type: 'button', class: `fa-found-item${kind === f.id && piece.sel && piece.picks?.base === f.mask ? ' active' : ''}`, 'aria-label': `Use the ${f.name.toLowerCase()}`,
        onclick: () => { kind = f.id; target = null; fillCache = null; place = null; setSel(f.mask); note = `The ${f.name.toLowerCase()} (pink). Tap more of it, take colors away, or trace to keep only what's inside.`; commit(); render(); },
      }, el('img', { src: f.thumb, alt: '' }), el('span', { class: 'small', text: `${f.icon} ${f.name}` }), f.zone ? el('span', { class: 'small muted', text: 'clothes + skin' }) : null)))) : null;
    const kinds = el('div', { class: 'chips' }, ...[...KINDS, ...ZONES].map(([id, icon, name]) => el('button', {
      type: 'button', class: `chip${kind === id ? ' active' : ''}`, 'aria-pressed': String(kind === id), text: `${icon} ${name}`,
      onclick: () => { kind = id; target = null; fillCache = null; place = null; if (piece.parts) piece.parts = null; if (piece.people) autoPick(); commit(); render(); },
    })));
    const tools = el('div', { class: 'chips' },
      el('button', { type: 'button', class: 'chip', text: '✨ Find it', disabled: piece.finding || !piece.people, onclick: () => { autoPick(); commit(); render(); } }),
      toolChip('tap', '👆 Tap its color', ''),
      toolChip('erase', '🧽 Take away', 'Tap a color to take it out of the piece.'),
      toolChip('trace', '✏️ Trace', () => (piece.sel ? 'Draw around the piece: only what\'s inside stays.' : 'Draw all the way around the piece.')),
      toolChip('brush+', '🖌 Brush in', 'Brush over more of the piece.'),
      toolChip('brush-', '🩹 Brush out', 'Brush over what isn\'t the piece.'),
      piece.layout ? toolChip('guides', '📏 Guides', 'Where the chin, waist and ankles were found (what ✨ Find it goes by): drag a line to correct it.') : null,
      piece.sel ? el('button', { type: 'button', class: 'chip', text: 'Clear', onclick: () => { piece.picks = { add: [], del: [], loop: null, base: null, edits: [] }; setSel(new Uint8Array(piece.w * piece.h), true); commit(); render(); } }) : null);
    return [
      undoBar(),
      whoRow(piece, 'Whose clothes? (tap a face, or tap them in the photo)'),
      foundRow,
      el('p', { class: 'small', text: found.length ? 'Or say what it is:' : 'What is it?' }), kinds,
      tools,
      tool.startsWith('brush') ? el('div', { class: 'range-row' }, el('span', { class: 'small', text: 'Brush' }), rangeInput(4, 60, brush, 'Brush size', (v) => { brush = v; })) : null,
      el('div', { class: 'range-row' }, el('span', { class: 'small', text: 'Match' }), rangeInput(4, 45, tol, 'Match', (v) => { tol = v; }, () => { if (piece.picks?.add.length || piece.picks?.del.length) { rebuildSel(); commit(); render(); } })),
      el('p', { class: 'small muted', 'aria-live': 'polite', text: note || (piece.finding ? 'Finding the person…' : piece.sel ? 'Pink is the piece.' : 'Press on the piece\'s color (the magnifier shows what you\'re on), or trace around it.') }),
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', type: 'button', text: '‹ Photos', onclick: () => { step = 'photos'; note = ''; render(); } }),
        el('button', { class: 'btn primary', type: 'button', text: 'Next: put it on', disabled: !piece.sel, onclick: () => goPut() })),
    ];
  }

  // ---------- on the base ----------

  function goPut() {
    step = 'put'; tool = 'move'; note = '';
    prepPiece();
    if (!target) autoTarget();
    tune = newTune(mode); placeIt(); fillCache = null;
    commit(); render();
  }
  /** What's worn on the base where the piece goes, found by itself (for Overlay and Replace). */
  /**
   * What it goes on, found by itself: what's worn there (taken off in Replace), or, with nothing worn there
   * (bare shoulders, a product shot of a dress on a person in swimwear), the outline of the body there:
   * the piece is fitted to that, and nothing is taken off.
   */
  function autoTarget() {
    if (!base?.people || !base.layout || kind === 'other') return;
    const r = kind === 'hat' ? null : kindRegion(kind, base.people, base.layout);
    const b = r ? null : bodyRegion(kind, base.people, base.layout);
    if (r) setTarget(r.mask, true); else if (b && kind !== 'hat') { setTarget(b.mask, true); target.body = true; } else target = null;
  }
  /** The head (face and hair) on the base: what a hat sits on. */
  function headBox() {
    const p = base?.people; if (!p) return null;
    const m = new Uint8Array(base.w * base.h); for (let i = 0; i < m.length; i++) m[i] = Math.max(p.face[i], p.hair[i]) >= 128 ? 1 : 0;
    return boxOf(m, base.w, base.h);
  }
  /** The base's body and clothes (what its form is read from), once. */
  function silhouette() {
    if (!base?.people) return null;
    if (!base.sil) { const p = base.people; base.sil = new Uint8Array(base.w * base.h); for (let i = 0; i < base.sil.length; i++) base.sil[i] = Math.max(p.body[i], p.clothes[i]) >= 128 ? 1 : 0; }
    return base.sil;
  }
  function setTarget(mask, auto = false) {
    const { w, h } = base; const b = boxOf(mask, w, h);
    if (!b) { target = null; fillCache = null; return; }
    const withSpans = (p) => p && { ...p, spans: rowSpans(p.mask, w, p.box, 14) };
    let parts = {};
    if (SLEEVED.includes(kind)) { const s = splitSleeves(mask, w, h, b); parts = { sleeves: { torso: withSpans(s.torso), left: withSpans(s.left), right: withSpans(s.right) } }; } else if (kind === 'shoes') parts = { pair: splitPair(mask, w, h, b).map(withSpans) };
    target = { mask, box: b, spans: rowSpans(mask, w, b, 14), auto, taps: [], edits: [], parts }; fillCache = null;
  }
  /**
   * Where the piece goes. By the body: its body as wide as the torso it goes on (sleeves not counted), at
   * its shoulders (a bottom at the waist), centered; a hat as wide as the head, sitting on it. Without a
   * person found: by the faces, or into the middle.
   */
  function placeIt() {
    if (!piece?.box || !base) return;
    prepPiece();
    const pt = piece.parts?.sleeves?.torso?.box ?? piece.box;
    if (kind === 'hat') { const hb = headBox(); if (hb) { place = bodyPlace('hat', piece.box, piece.box, hb, hb, mode); return; } }
    if (target && kind !== 'shoes') {
      const g = garmentPlace(kind, piece.solid ?? piece.sel, piece.w, piece.box, piece.layout, target.mask, base.w, target.box, base.layout, mode, { ph: piece.h, th: base.h });
      if (g) { place = g; return; }
      const tt = target.parts?.sleeves?.torso?.box ?? target.box;
      place = bodyPlace(kind, piece.box, pt, target.box, tt, mode); return;
    }
    const zone = base.layout ? kindZone(kind, base.layout, base.w, base.h) : null;
    place = rigidPlace(kind, piece.box, piece.layout, base.layout, target?.box ?? zone, base.w, base.h);
  }
  function rebuildTarget() {
    const { w, h, rgba } = base; const taps = target?.taps ?? []; const edits = target?.edits ?? [];
    const m = target?.auto && !taps.length ? Uint8Array.from(target.mask) : new Uint8Array(w * h);
    if (taps.length) {
      const r = colorRegion(rgba, w, h, taps.map((t) => t.at), taps.map((t) => t.shade), tol);
      const k = r && mainParts(r.sel, w, h, r.box, 0.05);
      if (k) { fillHoles(k.mask, w, h, k.box, 0.3); m.set(k.mask); }
    } else if (target && !target.auto) m.set(target.base ?? target.mask);
    applyEdits(m, w, edits);
    const keepBase = target && !target.auto && !taps.length ? target.base ?? target.mask : null;
    setTarget(m, false); target.taps = taps; target.edits = edits; if (keepBase) target.base = keepBase;
  }
  function tapTarget(x, y) {
    const { w, h, rgba } = base;
    const c = { at: [x, y], shade: sampleShade(rgba, w, h, x, y, 2) };
    if (!colorRegion(rgba, w, h, [c.at], [c.shade], tol)) { note = 'Nothing of that color right there.'; return; }
    const taps = [...(target && !target.auto ? target.taps ?? [] : []), c];
    const edits = target && !target.auto ? target.edits ?? [] : [];
    target = { ...(target ?? {}), auto: false, taps, edits, base: null };
    rebuildTarget(); placeIt();
    note = 'That\'s what it goes on (yellow). Tap more of it, or ✋ Move to place the piece.';
  }

  /** The scene at the working size. */
  const scene = () => ({ base, piece: extended(), target, place, tune, kind, mode });

  /**
   * A piece cut off at the bottom of its photo (a shirt photographed to the chest), made as long as it needs
   * to be where it goes: carried on down by its bottom rows mirrored (its cloth, its edges and their slant
   * running on). The piece as it is when it isn't cut off or needs no more.
   */
  let ext = null;
  function extended() {
    if (!piece?.alpha || !place || !base) return piece;
    const cut = piece.box.y1 >= piece.h - 2;
    const goal = target ? (target.box.y1 >= base.h - 2 ? base.h : target.box.y1) : null;
    const need = cut && goal ? Math.ceil(((goal - place.y0) / place.s - (piece.box.y1 - piece.box.y0)) * 1.04) : 0;
    if (need < 3) return piece;
    const key = `${need}`;
    if (ext?.src === piece && ext.key === key && ext.alpha0 === piece.alpha) return ext.piece;
    const { w } = piece; const h0 = piece.h; const H = h0 + need; const src = piece.draw ?? piece.rgba;
    const rgba = new Uint8ClampedArray(w * H * 4); rgba.set(src);
    const alpha = new Float32Array(w * H); alpha.set(piece.alpha);
    const solid = new Uint8Array(w * H); solid.set(piece.solid ?? piece.sel);
    // (Only its bottom quarter is mirrored: not up to the neckline.)
    const band = Math.max(4, Math.min(Math.round((piece.box.y1 - piece.box.y0) * 0.25), need));
    for (let k = 0; k < need; k++) {
      // (Mirrored back and forth over the bottom band, as far as it has to go.)
      const t = k % (2 * band); const from = h0 - 1 - (t < band ? t : 2 * band - 1 - t);
      rgba.set(src.subarray(from * w * 4, (from + 1) * w * 4), (h0 + k) * w * 4);
      alpha.set(piece.alpha.subarray(from * w, (from + 1) * w), (h0 + k) * w);
      solid.set((piece.solid ?? piece.sel).subarray(from * w, (from + 1) * w), (h0 + k) * w);
    }
    const box = { ...piece.box, y1: H };
    const soft = (q) => q && { ...q, alpha: partAlpha(alpha, q, w, H) };
    let parts = {};
    if (SLEEVED.includes(kind)) { const sp = splitSleeves(solid, w, H, box); parts = { sleeves: { torso: soft(sp.torso), left: soft(sp.left), right: soft(sp.right) } }; } else if (kind === 'shoes') parts = { pair: splitPair(solid, w, H, box).map(soft) };
    const pz = (m) => { const o = new Uint8Array(w * H); o.set(m); return o; };
    const people = piece.people && { ...piece.people, h: H, face: pz(piece.people.face), hair: pz(piece.people.hair), body: pz(piece.people.body), clothes: pz(piece.people.clothes), others: pz(piece.people.others) };
    const out = { ...piece, h: H, rgba, draw: null, alpha, solid, box, parts, people };
    ext = { src: piece, key, alpha0: piece.alpha, piece: out };
    return out;
  }

  /** The finished picture at the working size, on `out` (the base's size). */
  function compose(out) {
    const S = scene(); const { w, h } = base;
    silhouette();
    out.set(base.rgba);
    let layer = null;
    try { layer = buildLayer(S); } catch (e) { noteError('Fashion: putting it on', e); }
    if (layer) finish(layer, S, cache);
    if (mode === 'replace' && target && !target.body) {
      const key = layer ? `${layer.x0},${layer.y0},${layer.pw},${layer.ph},${JSON.stringify(tune)}` : `none,${tune.front},${tune.arms}`;
      if (fillCache?.target !== target || (fillCache.key !== key && !interacting)) {
        const unc = uncovered(target, layer, w, h, cache.front, base.people);
        let patch = null;
        try { patch = unc ? fillUncovered(base.rgba, w, h, unc, target, base.people) : null; } catch (e) { noteError('Fashion: taking it off', e); }
        fillCache = { target, key, patch };
      }
      if (fillCache.patch) lay(out, w, h, fillCache.patch);
    }
    if (layer) lay(out, w, h, layer);
    // (What's left of the old garment just outside it, its straps, recolored as the piece.)
    if (layer && mode === 'replace' && target && !target.body) {
      if (fillCache && (fillCache.restKey !== fillCache.key || fillCache.restTarget !== target)) {
        try { fillCache.rest = leftovers(S, layer); } catch (e) { fillCache.rest = null; noteError('Fashion: the straps', e); }
        fillCache.restKey = fillCache.key; fillCache.restTarget = target;
      }
      recolor(out, w, fillCache?.rest ?? null, base.rgba);
    }
    return layer;
  }

  function putView() {
    const hasPerson = !!base.layout;
    const modeBar = el('div', { class: 'segmented', role: 'tablist' }, ...MODES.map(([id, label]) => el('button', {
      class: `seg${mode === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(mode === id), text: label,
      onclick: () => { mode = id; Object.assign(tune, MODE_TUNE[id]); fillCache = null; placeIt(); note = ''; commit(); render(); },
    })));
    const row = (label, key, min, max) => el('div', { class: 'fa-tune' }, el('span', { class: 'small', text: label }), rangeInput(min, max, tune[key], label, (v) => { tune[key] = v; }, () => commit()));
    const hold = el('button', { class: 'btn', type: 'button', text: '◑ Before', 'aria-label': 'Hold to see the photo before' });
    hold.addEventListener('pointerdown', (e) => { e.preventDefault(); comparing = true; draw(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) hold.addEventListener(ev, () => { if (comparing) { comparing = false; draw(); } });
    hold.addEventListener('contextmenu', (e) => e.preventDefault());
    const check = (key, text) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: tune[key], onchange: (e) => { tune[key] = e.target.checked; commit(); render(); } }), el('span', { text }));
    // What was worked out by itself, in a line.
    const auto = !hasPerson ? (base.finding ? 'Finding the person…' : 'No person found in the base: drag the piece into place (More edits has the rest).')
      : target?.body ? 'Fitted to the body (nothing found worn there).' : target ? `${mode === 'replace' ? 'Laid into' : 'Fitted to'} the ${[...KINDS, ...ZONES].find((k) => k[0] === kind)?.[2].toLowerCase() ?? 'piece'} ${isZone(kind) ? 'of the base' : 'worn there'}${mode === 'replace' ? ', in its shape and folds' : ''}.` : 'Placed by the body.';
    // Everything else, by hand: behind More edits.
    const more = el('details', { class: 'fa-more', open: moreOpen ? true : null }, el('summary', { text: 'More edits' }),
      el('div', { class: 'chips' },
        toolChip('move', '✋ Move', 'Drag the piece to move it; pinch to size and turn it.'),
        toolChip('tap', '👆 Tap what it goes on', 'Tap what\'s worn there now (its color).'),
        toolChip('trace', '✏️ Trace it', 'Draw around what\'s worn there now.'),
        toolChip('brush+', '🖌 Brush in', 'Brush over more of what it goes on.'),
        toolChip('brush-', '🩹 Brush out', 'Brush over what it doesn\'t go on.'),
        hasPerson ? toolChip('guides', '📏 Guides', 'Where the chin, waist and ankles were found, and where it goes (dashed): drag a line to correct it.') : null,
        target ? el('button', { type: 'button', class: 'chip', text: 'Clear what it goes on', onclick: () => { target = null; fillCache = null; placeIt(); commit(); render(); } }) : null,
        el('button', { type: 'button', class: 'chip', text: '↺ Reset', onclick: () => { tune = newTune(mode); if (target?.auto || !target) autoTarget(); placeIt(); fillCache = null; commit(); render(); } })),
      tool.startsWith('brush') ? el('div', { class: 'range-row' }, el('span', { class: 'small', text: 'Brush' }), rangeInput(4, 60, brush, 'Brush size', (v) => { brush = v; })) : null,
      el('div', { class: 'fa-tunes' },
        row('Size', 'scale', 40, 250), row('Width', 'wide', 50, 160), row('Length', 'long', 50, 160), row('Turn', 'rot', -45, 45),
        mode !== 'add' ? row('Fit to body', 'fit', 0, 100) : null,
        row('Form', 'form', 0, 100), row('Light', 'light', 0, 100), row('Edge', 'soft', 0, 12)),
      check('depth', 'Shade its edges (depth)'),
      kind !== 'shoes' && base.people ? check('front', kind === 'hat' ? 'Keep the face in front' : 'Keep hair and face in front') : null,
      ['top', 'jacket', 'dress', 'bottom', 'upper', 'lower', 'outfit'].includes(kind) && base.people ? check('arms', 'Keep hands and arms in front of the body') : null);
    more.addEventListener('toggle', () => { moreOpen = more.open; if (!more.open && tool !== 'move') { tool = 'move'; draw(); } });
    return [
      undoBar(),
      whoRow(base, 'Who to dress? (tap a face, or tap them in the photo)'),
      modeBar,
      el('p', { class: 'small muted', text: { add: 'Add: on top, as it is (a hat, shoes, something new).', overlay: 'Overlay: over what\'s worn there (a jacket over a shirt).', replace: 'Replace: what\'s worn there is taken off and the piece put in its place.' }[mode] }),
      el('p', { class: 'small', 'aria-live': 'polite', text: note || auto }),
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn ghost', type: 'button', text: '‹ Piece', onclick: () => { step = 'pick'; tool = 'tap'; note = ''; render(); } }),
        hold,
        el('button', { class: 'btn primary', type: 'button', text: busy ? 'Saving…' : '💾 Save', disabled: busy, onclick: save })),
      more,
      about('It\'s fitted for you: placed and sized by the person\'s body outline (its body to their torso, each sleeve to an arm, each shoe to a foot), its light matched to the photo, the body\'s shading carried onto it, hair, face and hands kept in front. Drag it to move it, pinch to size it; More edits has the rest. Saved at full size (up to 2560 px). Everything is worked out on this phone.'),
    ];
  }

  /** 💾 The picture at full size (from the photos as they were opened): the same, worked out again bigger. */
  async function save() {
    busy = true; render();
    try {
      const big = async (img) => {
        const bmp = await decodeImage(img.file, await sniffType(img.file));
        let fit = fitSize(bmp.width, bmp.height, SAVE_MAX);
        if (fit.width * fit.height > 6e6) { const k = Math.sqrt(6e6 / (fit.width * fit.height)); fit = { width: Math.floor(fit.width * k), height: Math.floor(fit.height * k) }; }
        if (fit.width <= img.w) { bmp.close?.(); return null; }
        const c = drawToCanvas(bmp, fit.width, fit.height, '#fff'); bmp.close?.();
        return { w: c.width, h: c.height, rgba: c.getContext('2d').getImageData(0, 0, c.width, c.height).data };
      };
      const B = await big(base);
      let out; let W = base.w; let H = base.h;
      if (!B) { out = new Uint8ClampedArray(base.w * base.h * 4); compose(out); } else {
        // The piece exactly as in the preview (worked out at the working size: its fitting, the design laid
        // in, its neckline), brought up to full size; then finished there (light, the base's folds, hair and
        // hands in front), on the full-size photo, so what's saved is what was shown, sharp where it matters.
        W = B.w; H = B.h; const k = W / base.w;
        // (A 0/1 mask brought up smoothly, then 0/1 again: no stair steps.)
        const up = (m, w, h, W2, H2) => { const r = resample(Uint8Array.from(m, (v) => (v ? 255 : 0)), w, h, W2, H2); for (let i = 0; i < r.length; i++) r[i] = r[i] >= 128 ? 1 : 0; return r; };
        const bBig = { w: W, h: H, rgba: B.rgba, layout: base.layout && scaleLayout(base.layout, k), people: base.people && peopleAt(base.people, W, H), sil: base.sil ? up(base.sil, base.w, base.h, W, H) : null };
        let tBig = null;
        if (target) {
          const tm = up(target.mask, base.w, base.h, W, H); const tb = boxOf(tm, W, H);
          const torso = target.parts?.sleeves?.torso; const sc = (b2) => b2 && { x0: Math.floor(b2.x0 * k), y0: Math.floor(b2.y0 * k), x1: Math.ceil(b2.x1 * k), y1: Math.ceil(b2.y1 * k) };
          tBig = tb && { mask: tm, box: tb, spans: rowSpans(tm, W, tb, Math.round(14 * k)), parts: torso ? { sleeves: { torso: { box: sc(torso.box) } } } : {}, body: target.body };
        }
        const S = { base: bBig, piece: extended(), target: tBig, kind, mode, place, tune: { ...tune, soft: tune.soft * k } };
        const small = buildLayer(scene());
        let layer = null;
        if (small) {
          const c0 = document.createElement('canvas'); c0.width = small.pw; c0.height = small.ph;
          c0.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(small.rgba), small.pw, small.ph), 0, 0);
          const x0 = Math.round(small.x0 * k); const y0 = Math.round(small.y0 * k);
          const c1 = document.createElement('canvas'); c1.width = Math.max(1, Math.min(W - x0, Math.ceil(small.pw * k))); c1.height = Math.max(1, Math.min(H - y0, Math.ceil(small.ph * k)));
          const x1 = c1.getContext('2d'); x1.imageSmoothingQuality = 'high'; x1.drawImage(c0, 0, 0, small.pw * k, small.ph * k);
          layer = { x0, y0, pw: c1.width, ph: c1.height, rgba: x1.getImageData(0, 0, c1.width, c1.height).data };
          finish(layer, S, {});
        }
        out = Uint8ClampedArray.from(B.rgba);
        // What was taken off (worked out at the working size), brought up and laid where the piece doesn't cover.
        if (mode === 'replace' && tBig && !tBig.body && fillCache?.patch) {
          const fp = fillCache.patch; const c = document.createElement('canvas'); c.width = fp.pw; c.height = fp.ph;
          c.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(fp.rgba), fp.pw, fp.ph), 0, 0);
          const c2 = document.createElement('canvas'); c2.width = Math.ceil(fp.pw * k); c2.height = Math.ceil(fp.ph * k);
          const x2 = c2.getContext('2d'); x2.imageSmoothingQuality = 'high'; x2.drawImage(c, 0, 0, c2.width, c2.height);
          lay(out, W, H, { x0: Math.round(fp.x0 * k), y0: Math.round(fp.y0 * k), pw: c2.width, ph: c2.height, rgba: x2.getImageData(0, 0, c2.width, c2.height).data });
        }
        if (layer) lay(out, W, H, layer);
        // (The old garment's straps, recolored: worked out at the working size, brought up.)
        const rest = mode === 'replace' ? fillCache?.rest : null;
        if (layer && rest) {
          const rw = Math.max(1, Math.round(rest.pw * k)); const rh = Math.max(1, Math.round(rest.ph * k));
          const big = resample(Uint8Array.from(rest.wgt, (v) => Math.round(v * 255)), rest.pw, rest.ph, rw, rh);
          const rx = Math.round(rest.x0 * k); const ry = Math.round(rest.y0 * k);
          const cw = Math.min(rw, W - rx); const ch = Math.min(rh, H - ry); const wgt = new Float32Array(cw * ch);
          for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) wgt[y * cw + x] = big[y * rw + x] / 255;
          recolor(out, W, { x0: rx, y0: ry, pw: cw, ph: ch, wgt, gain: rest.gain }, B.rgba);
        }
      }
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
      const name = `fashion-${new Date().toISOString().slice(0, 10)}.jpg`;
      const f = new File([blob], name, { type: 'image/jpeg' });
      if (!(canShareFiles([f]) && await shareFiles([f], name))) downloadBlob(blob, name);
      note = `Saved (${W} × ${H}).`;
    } catch (e) { noteError('Fashion: save', e); note = e.message; }
    busy = false; render();
  }

  // ---------- the picture and the finger ----------

  function rangeInput(min, max, value, label, set, done = null) {
    const out = el('output', { text: String(value) });
    const r = el('input', { type: 'range', min: String(min), max: String(max), value: String(value), 'aria-label': label });
    r.addEventListener('input', () => { interacting = true; out.textContent = r.value; set(Number(r.value)); draw(); });
    r.addEventListener('change', () => { interacting = false; done?.(); draw(); });
    return el('span', { class: 'range-row fa-range' }, r, out);
  }

  /** The canvas pixel under a pointer event. */
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height]; };
  const perPx = () => canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
  const img = () => (step === 'pick' ? piece : base);
  /** The guide line (chin, waist, ankles) near a point, if any. */
  function guideAt(p) {
    const L = img()?.layout; if (!L) return null;
    let best = null; let bd = 28 * perPx();
    for (const [k] of GUIDES) { const d = Math.abs(p[1] - L[k]); if (d < bd) { bd = d; best = k; } }
    return best;
  }
  function onDown(e) {
    if (step === 'photos' || busy) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a pointer it can't capture */ }
    e.preventDefault();
    const p = at(e); pointers.set(e.pointerId, p);
    // Two fingers on the piece (✋ Move): pinch to size it, turn to turn it.
    if (pointers.size === 2 && step === 'put' && tool === 'move') {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(b[0] - a[0], b[1] - a[1]), a: Math.atan2(b[1] - a[1], b[0] - a[0]), scale: tune.scale, rot: tune.rot };
      press = null; interacting = true; return;
    }
    if (pointers.size > 1) return;
    press = { pts: [p], start: p, dx: tune.dx, dy: tune.dy, guide: tool === 'guides' ? guideAt(p) : null };
    interacting = step === 'put' && tool === 'move';
    draw();
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    e.preventDefault();
    const p = at(e); pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]); const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      tune.scale = Math.round(Math.max(40, Math.min(250, (pinch.scale * d) / Math.max(1, pinch.d))));
      tune.rot = Math.round(Math.max(-45, Math.min(45, pinch.rot + ((ang - pinch.a) * 180) / Math.PI)));
      draw(); return;
    }
    if (!press) return;
    press.pts.push(p);
    if (step === 'put' && tool === 'move') { tune.dx = Math.round(press.dx + p[0] - press.start[0]); tune.dy = Math.round(press.dy + p[1] - press.start[1]); }
    if (press.guide) { const L = img().layout; L[press.guide] = Math.max(0, Math.min(img().h, p[1])); }
    draw();
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) { pinch = null; interacting = false; commit(); render(); } return; }
    if (!press) return;
    const pr = press; press = null; interacting = false;
    const im = img();
    const last = pr.pts.at(-1); const k = perPx();
    if (tool === 'guides') {
      if (pr.guide) {
        // The body as corrected: what's found by itself, and where the piece goes, again.
        const L = im.layout; L.split = true; L.waist = Math.max(L.chin + 4, Math.min(L.ankle - 4, L.waist));
        if (im === piece && piece.picks?.base && !piece.picks.add.length) autoPick(true);
        if (im === base) { if (!target || target.auto) autoTarget(); placeIt(); fillCache = null; }
        note = `${GUIDES.find((g) => g[0] === pr.guide)[1]} moved.`; commit();
      } else note = 'Drag one of the lines (chin, waist, ankles) up or down.';
      render(); return;
    }
    if (tool.startsWith('brush')) {
      const m = strokeMask(pr.pts, brush * k, im.w, im.h);
      if (m.box) {
        const ed = cropEdit(m.mask, im.w, m.box, tool === 'brush+');
        if (step === 'pick') { piece.picks ??= newPicks(); (piece.picks.edits ??= []).push(ed); rebuildSel(); } else {
          target = target ?? { auto: false, taps: [], edits: [], mask: new Uint8Array(base.w * base.h) };
          if (target.auto) { target.base = target.mask; target.auto = false; }
          target.edits = [...(target.edits ?? []), ed]; rebuildTarget(); placeIt();
        }
        commit();
      }
      render(); return;
    }
    if (step === 'pick' || tool !== 'move') {
      const shape = strokeShape(pr.pts, 10 * k);
      const isTrace = tool === 'trace' && shape === 'lasso';
      if (tool === 'trace' && !isTrace) note = 'Draw all the way around it.';
      else if (isTrace) {
        const loop = traceLoop(pr.pts, im.w, im.h);
        if (step === 'pick') {
          piece.picks ??= newPicks();
          if (piece.sel) { piece.picks.loop = loop; rebuildSel(); } else setSel(loop);
          note = piece.sel ? '' : 'Nothing inside that loop.';
        } else { setTarget(loop); target.base = loop; placeIt(); note = 'That\'s what it goes on (yellow).'; }
        commit();
      } else if (last[0] >= 0 && last[1] >= 0 && last[0] < im.w && last[1] < im.h) {
        const X = Math.round(last[0]); const Y = Math.round(last[1]);
        // (In a group photo, a tap on someone else: them chosen first.)
        const other = tool === 'tap' ? personAt(im, X, Y) : -1;
        if (other >= 0 && other !== im.who) { switchTo(im, other); if (step === 'pick' && piece.sel) return; }
        if (step === 'pick') pickAt(X, Y); else tapTarget(X, Y);
        commit();
      }
      render(); return;
    }
    commit(); draw();
  }

  /** 📏 The guides: the chin, waist and ankle lines across the person, and (on the base) where the piece goes. */
  function drawGuides(im) {
    const L = im.layout; if (!L) return;
    const k = perPx(); const P = L.person ?? { x0: 0, x1: im.w };
    ctx.save(); ctx.font = `${Math.round(13 * k)}px system-ui, sans-serif`; ctx.textBaseline = 'bottom';
    for (const [key, label, color] of GUIDES) {
      const y = L[key];
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 4 * k; ctx.beginPath(); ctx.moveTo(P.x0, y); ctx.lineTo(P.x1, y); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.moveTo(P.x0, y); ctx.lineTo(P.x1, y); ctx.stroke();
      ctx.fillStyle = color; ctx.fillText(label, P.x0 + 4 * k, y - 3 * k);
    }
    if (im === base) {
      const z = kindZone(kind, L, im.w, im.h);
      ctx.setLineDash([6 * k, 4 * k]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * k; ctx.strokeRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
    }
    ctx.restore();
  }

  /** What's shown: the piece's photo with the piece in pink, or the base with the piece on it. */
  function draw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!canvas || !ctx) return;
      const im = img(); if (!im) return;
      if (canvas.width !== im.w || canvas.height !== im.h) { canvas.width = im.w; canvas.height = im.h; }
      if (step === 'pick') {
        if (piece.view?.sel !== piece.sel) {
          const v = new Uint8ClampedArray(piece.rgba);
          if (piece.sel) for (let i = 0; i < piece.w * piece.h; i++) if (piece.sel[i]) { v[i * 4] = v[i * 4] * 0.45 + 255 * 0.55; v[i * 4 + 1] *= 0.45; v[i * 4 + 2] = v[i * 4 + 2] * 0.45 + 149 * 0.55; }
          piece.view = { sel: piece.sel, data: new ImageData(v, piece.w, piece.h) };
        }
        ctx.putImageData(piece.view.data, 0, 0);
      } else if (comparing) ctx.putImageData(new ImageData(Uint8ClampedArray.from(base.rgba), base.w, base.h), 0, 0);
      else {
        const out = new Uint8ClampedArray(base.w * base.h * 4);
        compose(out);
        if (target && tool !== 'move') for (let y = target.box.y0; y < target.box.y1; y++) for (let x = target.box.x0; x < target.box.x1; x++) {
          const i = y * base.w + x; if (!target.mask[i]) continue;
          const edge = !target.mask[i - 1] || !target.mask[i + 1] || !target.mask[i - base.w] || !target.mask[i + base.w];
          if (edge) out.set([255, 214, 10, 255], i * 4);
        }
        ctx.putImageData(new ImageData(out, base.w, base.h), 0, 0);
      }
      shown = step;
      if (tool === 'guides' && !comparing) drawGuides(im);
      // A loop or brush stroke being drawn, and the magnifier while picking a color.
      if (press && tool !== 'move' && tool !== 'guides') {
        const k = perPx();
        if (tool === 'trace' || tool.startsWith('brush')) {
          ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          if (tool === 'trace') { ctx.lineWidth = 2 * k; ctx.strokeStyle = '#ff2d95'; ctx.setLineDash([6 * k, 4 * k]); } else { ctx.lineWidth = 2 * brush * k; ctx.strokeStyle = tool === 'brush+' ? 'rgba(255,45,149,.45)' : 'rgba(255,255,255,.5)'; }
          ctx.beginPath(); press.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore();
        } else { const [x, y] = press.pts.at(-1); drawLoupe(ctx, im.canvas, x, y, { k }); }
      }
    });
  }

  function render() {
    if (!alive) return;
    if (step === 'photos' || !base || !piece) { step = 'photos'; canvas = null; ctx = null; fill(host, el('div', { class: 'fa' }, ...photosView().filter(Boolean))); return; }
    if (!canvas || shown === 'photos') {
      canvas = el('canvas', { class: 'fa-canvas', 'aria-label': 'Photo' });
      ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); press = null; pinch = null; interacting = false; draw(); });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      panel = el('div', { class: 'fa-panel' });
      fill(host, el('div', { class: 'fa' }, el('div', { class: 'fa-stage' }, canvas), panel));
      shown = null;
    }
    fill(panel, ...(step === 'pick' ? pickView() : putView()).filter(Boolean));
    draw();
  }

  // A photo handed over (from Reverse Fill), else a session to continue.
  const given = { base: handoff.take('fashion:base'), piece: handoff.take('fashion:piece') };
  render();
  (async () => {
    if (given.base) await usePhoto('base', given.base);
    if (given.piece) await usePhoto('piece', given.piece);
    if (given.base || given.piece) { note = given.piece ? 'Your filled photo is the piece: now pick the person to dress (1 · Base).' : 'Your filled photo is the base: now pick a photo with the piece (2 · Piece).'; if (base && piece) note = ''; render(); return; }
    try { const s = await idb.get(SESSION_KEY); if (s?.baseFile && s?.pieceFile && alive && !base && !piece) { resume = s; render(); } } catch { /* no storage here */ }
  })();
  return () => { alive = false; cancelAnimationFrame(raf); clearTimeout(keepTimer); };
}
