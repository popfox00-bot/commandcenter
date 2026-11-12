// Fashion's workings (web/tools/fashion/fashion-core.js) on a drawn person: their layout (face, chin,
// waist from where the clothes change color, ankles), where each kind is worn, the garment found there,
// the piece placed by the body and bent onto a shape, light, form and compositing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxOf, resample, bodyLayout, kindZone, kindRegion, rowSpans, rigidPlace, renderPiece, lightGains, formMap, finishLayer, composite, fillHoles, splitSleeves, splitPair, armsInFront, mergeLayers, scaleLayout } from '../web/tools/fashion/fashion-core.js';

/**
 * A person w×h: a face (40 wide, 50 tall at the top), a red shirt from the chin to y = 200, blue pants to
 * y = 330, shoes below. The segmentation maps (0/255) and the pixels.
 */
function person(w = 200, h = 360, { shirt = [200, 30, 30], pants = [30, 40, 180], shirtW = 70 } = {}) {
  const n = w * h; const p = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  const rgba = new Uint8ClampedArray(n * 4).fill(235);
  const cx = w / 2; const k = w / 200;
  for (let Y = 0; Y < h; Y++) for (let X = 0; X < w; X++) {
    const i = Y * w + X; let c = null; const y = Y / k; const x = X / k;
    if (y >= 20 && y < 70 && Math.abs(x - 100) < 20) { p.face[i] = 255; c = [220, 180, 150]; }
    else if (y >= 10 && y < 20 && Math.abs(x - 100) < 22) { p.hair[i] = 255; c = [60, 40, 20]; }
    else if (y >= 70 && y < 200 && Math.abs(x - 100) < shirtW / 2) { p.clothes[i] = 255; c = shirt; }
    else if (y >= 200 && y < 330 && Math.abs(x - 100) < 30 && Math.abs(x - 100) > 3) { p.clothes[i] = 255; c = pants; }
    else if (y >= 330 && y < 345 && Math.abs(x - 100) < 32 && Math.abs(x - 100) > 3) { p.others[i] = 255; c = [20, 20, 20]; }
    if (c) rgba.set([...c, 255], i * 4); else rgba[i * 4 + 3] = 255;
  }
  return { p, rgba };
}

test('fashion: a person\'s layout: face, chin, the waist where the clothes change color, ankles', () => {
  const { p, rgba } = person();
  const L = bodyLayout(p, rgba);
  assert.deepEqual(L.face, { x0: 81, y0: 20, x1: 120, y1: 70 });
  assert.equal(L.chin, 70);
  // Shirt to y = 200, pants after: found within a few rows (not the face-size guess, 70 + 2.6×50 = 200 here too,
  // so shift the shirt to check it's the color that decides).
  assert.ok(Math.abs(L.waist - 200) <= 3, `waist ${L.waist}`);
  const { p: p2, rgba: r2 } = person();
  for (let y = 170; y < 200; y++) for (let x = 0; x < 200; x++) { const i = y * 200 + x; if (p2.clothes[i]) r2.set([30, 40, 180, 255], i * 4); }
  assert.ok(Math.abs(bodyLayout(p2, r2).waist - 170) <= 3, 'the color change moves the waist');
  assert.equal(bodyLayout({ ...p, body: new Uint8Array(p.w * p.h), clothes: new Uint8Array(p.w * p.h), face: new Uint8Array(p.w * p.h), hair: new Uint8Array(p.w * p.h), others: new Uint8Array(p.w * p.h) }), null);
});

test('fashion: each kind is found where it\'s worn (top, bottom, hat zone, shoes)', () => {
  const { p, rgba } = person();
  const L = bodyLayout(p, rgba);
  const top = kindRegion('top', p, L); const bottom = kindRegion('bottom', p, L); const shoes = kindRegion('shoes', p, L);
  assert.ok(top.box.y0 >= 68 && top.box.y1 <= 215, JSON.stringify(top.box));
  assert.ok(top.box.x1 - top.box.x0 >= 68);
  assert.ok(bottom.box.y0 >= 190 && bottom.box.y1 <= 335, JSON.stringify(bottom.box));
  assert.ok(shoes.box.y0 >= 300 && shoes.box.y1 <= 346, JSON.stringify(shoes.box));
  const hat = kindZone('hat', L, p.w, p.h);
  assert.ok(hat.y1 <= 40 && hat.x0 < 81 && hat.x1 > 120, JSON.stringify(hat));
  // Nothing worn on the head here.
  assert.equal(kindRegion('hat', p, L), null);
});

test('fashion: holes in a selection (its print) are closed; the open background isn\'t', () => {
  const w = 40; const h = 40; const m = new Uint8Array(w * h);
  for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) m[y * w + x] = 1;
  for (let y = 15; y < 20; y++) for (let x = 15; x < 20; x++) m[y * w + x] = 0;
  fillHoles(m, w, h, { x0: 0, y0: 0, x1: w, y1: h }, 0.3);
  assert.equal(m[17 * w + 17], 1);
  assert.equal(m[1 * w + 1], 0);
});

test('fashion: the piece is placed by the body: as big as the person, at the same place on them', () => {
  const a = person(); const b = person(400, 720);
  const La = bodyLayout(a.p, a.rgba); const Lb = bodyLayout(b.p, b.rgba);
  const shirt = kindRegion('top', a.p, La);
  const pl = rigidPlace('top', shirt.box, La, Lb, null, 400, 720);
  assert.ok(Math.abs(pl.s - 2) < 0.06, `scale ${pl.s}`);
  const want = kindRegion('top', b.p, Lb).box;
  assert.ok(Math.abs(pl.x0 - want.x0) <= 4 && Math.abs(pl.y0 - want.y0) <= 4, `${JSON.stringify(pl)} vs ${JSON.stringify(want)}`);
  // No person in the piece's photo: into the zone, as wide as it.
  const pz = rigidPlace('top', { x0: 0, y0: 0, x1: 50, y1: 60 }, null, Lb, want, 400, 720);
  assert.ok(Math.abs(pz.x0 - want.x0) < 1 && Math.abs(50 * pz.s - (want.x1 - want.x0)) < 1);
});

test('fashion: Fit bends the piece onto the shape of what\'s worn there; 0 leaves it as it is', () => {
  // A narrow green shirt (40 wide) in its photo; on the base, a wide one (70) to fit to.
  const src = person(200, 360, { shirt: [30, 200, 60], shirtW: 40 });
  const L = bodyLayout(src.p, src.rgba); const sel = kindRegion('top', src.p, L);
  const alpha = Float32Array.from(sel.mask);
  const dst = person(); const Ld = bodyLayout(dst.p, dst.rgba); const reg = kindRegion('top', dst.p, Ld);
  const region = { box: reg.box, spans: rowSpans(reg.mask, 200, reg.box) };
  const pl = rigidPlace('top', sel.box, L, Ld, null, 200, 360);
  const rigid = renderPiece(src.rgba, alpha, 200, 360, sel.box, pl, region, 0, 200, 360);
  const fitted = renderPiece(src.rgba, alpha, 200, 360, sel.box, pl, region, 1, 200, 360);
  assert.ok(Math.abs(rigid.pw - 40) <= 2, `rigid width ${rigid.pw}`);
  assert.ok(Math.abs(fitted.pw - 70) <= 2, `fitted width ${fitted.pw}`);
  // Its pixels are the shirt's green, solid in the middle.
  const mid = ((fitted.ph >> 1) * fitted.pw + (fitted.pw >> 1)) * 4;
  assert.deepEqual([...fitted.rgba.slice(mid, mid + 4)], [30, 200, 60, 255]);
  // Laid on the base: the red shirt there is now green.
  const out = Uint8ClampedArray.from(dst.rgba); composite(out, 200, 360, fitted);
  const i = (130 * 200 + 100) * 4; assert.deepEqual([...out.slice(i, i + 3)], [30, 200, 60]);
});

test('fashion: light, form and what\'s kept in front', () => {
  // Light: the base's faces are darker (half as bright) → the piece is darkened.
  const n = 100; const a = new Uint8ClampedArray(n * 4).fill(200); const b = new Uint8ClampedArray(n * 4).fill(100);
  const ref = new Uint8Array(n).fill(255);
  const g = lightGains(a, ref, b, ref); assert.ok(g.every((v) => Math.abs(v - 104 / 204) < 0.1 || v === 0.6));
  // Form: a dark fold across a flat area shows up below 1, the flat area at 1.
  const w = 40; const h = 40; const px = new Uint8ClampedArray(w * h * 4).fill(180);
  for (let x = 0; x < w; x++) for (let y = 19; y < 21; y++) px.set([90, 90, 90, 255], (y * w + x) * 4);
  const f = formMap(px, w, { x0: 0, y0: 0, x1: w, y1: h }, 1, 8);
  assert.ok(f[20 * w + 20] < 0.85 && Math.abs(f[5 * w + 20] - 1) < 0.05);
  // Finished: the fold darkens the layer there; a front mask hides it.
  const layer = { x0: 0, y0: 0, pw: w, ph: h, rgba: new Uint8ClampedArray(w * h * 4).fill(200) };
  const front = new Uint8Array(w * h); front[5 * w + 5] = 255;
  finishLayer(layer, w, { form: f, fbox: { x0: 0, y0: 0, x1: w, y1: h }, formAmt: 1, front });
  assert.ok(layer.rgba[(20 * w + 20) * 4] < 175);
  assert.equal(layer.rgba[(5 * w + 5) * 4 + 3], 0);
});

test('fashion: maps sampled to the photo\'s size; boxes', () => {
  const m = new Uint8Array([0, 255, 0, 255]);
  const r = resample(m, 2, 2, 4, 4);
  assert.equal(r.length, 16); assert.equal(r[0], 0); assert.equal(r[3], 255);
  assert.deepEqual(boxOf(r, 4, 4, 128), { x0: 2, y0: 0, x1: 4, y1: 4 });
});

test('fashion: a top\'s body and sleeves are told apart (arms hanging beside it, or out to the side)', () => {
  const w = 200; const h = 200; const m = new Uint8Array(w * h);
  // Body x 70–130, y 40–180; sleeves out to the side at the top (x 30–70, y 40–70) and down beside it (x 140–160, y 40–160, a gap at 130–140 below y 70).
  for (let y = 40; y < 180; y++) for (let x = 70; x < 130; x++) m[y * w + x] = 1;
  for (let y = 40; y < 70; y++) for (let x = 30; x < 70; x++) m[y * w + x] = 1;
  for (let y = 40; y < 70; y++) for (let x = 130; x < 160; x++) m[y * w + x] = 1;
  for (let y = 70; y < 160; y++) for (let x = 140; x < 160; x++) m[y * w + x] = 1;
  for (let y = 40; y < 180; y++) for (let x = 96; x < 104; x++) m[y * w + x] = 0; // a zip down the middle, not part of it
  const s = splitSleeves(m, w, h, boxOf(m, w, h));
  assert.ok(Math.abs(s.torso.box.x0 - 69) <= 2 && Math.abs(s.torso.box.x1 - 131) <= 2, JSON.stringify(s.torso.box));
  assert.ok(s.left.box.x1 <= 70 && s.left.box.x0 === 30, JSON.stringify(s.left.box));
  assert.ok(s.right.box.x0 >= 130 && s.right.box.y1 === 160, JSON.stringify(s.right.box));
  // A plain body (no sleeves): no sleeves.
  const t = new Uint8Array(w * h); for (let y = 40; y < 180; y++) for (let x = 70; x < 130; x++) t[y * w + x] = 1;
  const s2 = splitSleeves(t, w, h, boxOf(t, w, h)); assert.equal(s2.left, null); assert.equal(s2.right, null);
});

test('fashion: a pair of shoes is two, left first; one shoe mirrored makes the other', () => {
  const w = 100; const h = 40; const m = new Uint8Array(w * h);
  for (let y = 10; y < 30; y++) { for (let x = 60; x < 90; x++) m[y * w + x] = 1; for (let x = 10; x < 35; x++) m[y * w + x] = 1; }
  const pair = splitPair(m, w, h, boxOf(m, w, h));
  assert.equal(pair.length, 2); assert.equal(pair[0].box.x0, 10); assert.equal(pair[1].box.x0, 60);
  // A shoe: dark heel on the left, red toe on the right; mirrored, the toe is on the left.
  const src = new Uint8ClampedArray(w * h * 4); const a = new Float32Array(w * h);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) { src.set(x < 10 ? [20, 20, 20, 255] : [220, 30, 30, 255], (y * w + x) * 4); a[y * w + x] = 1; }
  const box = { x0: 0, y0: 0, x1: 20, y1: 10 };
  const one = renderPiece(src, a, w, h, box, { x0: 50, y0: 10, s: 1 }, null, 0, w, h);
  const mir = renderPiece(src, a, w, h, box, { x0: 50, y0: 10, s: 1 }, null, 0, w, h, true);
  const px = (l, x) => [...l.rgba.slice(((5) * l.pw + x) * 4, ((5) * l.pw + x) * 4 + 3)];
  assert.deepEqual(px(one, 2), [20, 20, 20]); assert.deepEqual(px(mir, 2), [220, 30, 30]);
  assert.deepEqual(px(mir, 17), [20, 20, 20]);
});

test('fashion: hands in front of the body; layers merged; a layout scaled', () => {
  const { p } = person();
  for (let y = 150; y < 165; y++) for (let x = 80; x < 120; x++) p.body[y * 200 + x] = 255; // a forearm across the shirt
  for (let y = 100; y < 160; y++) for (let x = 20; x < 30; x++) p.body[y * 200 + x] = 255; // an arm out beside it
  const L = bodyLayout(p);
  const a = armsInFront(p, L, 65, 135);
  assert.equal(a[155 * 200 + 100], 255); assert.equal(a[120 * 200 + 25], 0); assert.equal(a[40 * 200 + 100], 0);
  const l1 = { x0: 0, y0: 0, pw: 2, ph: 1, rgba: new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]) };
  const l2 = { x0: 1, y0: 0, pw: 2, ph: 1, rgba: new Uint8ClampedArray([0, 0, 255, 255, 0, 0, 255, 255]) };
  const m = mergeLayers([l1, l2]);
  assert.equal(m.pw, 3); assert.deepEqual([...m.rgba.slice(4, 8)], [0, 0, 255, 255]); assert.deepEqual([...m.rgba.slice(0, 4)], [255, 0, 0, 255]);
  const s = scaleLayout(L, 2); assert.equal(s.chin, L.chin * 2); assert.equal(s.face.x1, L.face.x1 * 2);
});
