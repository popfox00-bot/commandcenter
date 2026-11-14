// Fashion's workings (web/tools/fashion/fashion-core.js) on a drawn person: their layout (face, chin,
// waist from where the clothes change color, ankles), where each kind is worn, the garment found there,
// the piece placed by the body and bent onto a shape, light, form and compositing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxOf, resample, bodyLayout, kindZone, kindRegion, rowSpans, rigidPlace, renderPiece, lightGains, formMap, finishLayer, composite, fillHoles, splitSleeves, splitPair, armsInFront, mergeLayers, scaleLayout, traceTransfer, foldMap, upperParts, bareArm, splitPeople } from '../web/tools/fashion/fashion-core.js';

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
  // (From each photo's whites, brightness at most 0.85 to 1.2: a white piece is lit as the base is, not turned gray.)
  const g = lightGains(a, ref, b, ref); assert.ok(g.every((v) => Math.abs(v - 0.85) < 0.01), String(g));
  // A warm light: only a slight cast (each channel within 4% of the brightness).
  const warm = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) warm.set([220, 190, 160, 255], i * 4);
  const g2 = lightGains(a, ref, warm, ref); assert.ok(g2[0] > g2[2] && g2[0] / g2[2] < 1.09, String(g2));
  // Whatever skin the people have: a dark-skinned person in one photo doesn't darken the piece (it's the whites).
  const w1 = new Uint8ClampedArray(n * 4); const w2 = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { w1.set(i < 80 ? [120, 80, 60, 255] : [240, 240, 240, 255], i * 4); w2.set(i < 80 ? [230, 190, 170, 255] : [240, 240, 240, 255], i * 4); }
  assert.ok(lightGains(w2, null, w1, null).every((v) => Math.abs(v - 1) < 0.03));
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
  // (The body with a few pixels of slack at its edges: a hem that flares a little isn't a sleeve.)
  assert.ok(Math.abs(s.torso.box.x0 - 66) <= 2 && Math.abs(s.torso.box.x1 - 134) <= 2, JSON.stringify(s.torso.box));
  assert.ok(s.left.box.x1 <= 68 && s.left.box.x0 === 30 && s.left.box.y1 === 70, JSON.stringify(s.left.box));
  assert.ok(s.right.box.x0 >= 132 && s.right.box.y1 === 160, JSON.stringify(s.right.box));
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

test('fashion: the design laid into the base\'s outline: its shape is the outline\'s, its look the piece\'s; gaps bridged', () => {
  // The piece: 40×60, red and yellow stripes across, with a gap (its neckline) at the top middle.
  const pw = 40; const ph = 60; const tex = new Uint8ClampedArray(pw * ph * 4); const pm = new Uint8Array(pw * ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    tex.set(Math.floor(y / 10) % 2 ? [240, 220, 40, 255] : [200, 30, 30, 255], (y * pw + x) * 4);
    if (!(y < 8 && x >= 15 && x < 25)) pm[y * pw + x] = 1;
  }
  // The base's outline: a trapezoid, 30 wide at the top to 60 at the bottom, 120 tall (another body, another size).
  const w = 100; const h = 140; const m = new Uint8Array(w * h);
  for (let y = 10; y < 130; y++) { const half = 15 + ((y - 10) / 120) * 15; for (let x = Math.round(50 - half); x < Math.round(50 + half); x++) m[y * w + x] = 1; }
  const box = boxOf(m, w, h); const target = { mask: m, box, spans: rowSpans(m, w, box, 2) };
  const L = traceTransfer(tex, pm, pw, ph, { x0: 0, y0: 0, x1: pw, y1: ph }, target, w, h);
  assert.equal(L.x0, box.x0); assert.equal(L.pw, box.x1 - box.x0); assert.equal(L.ph, box.y1 - box.y0);
  const at = (x, y) => [...L.rgba.slice(((y - L.y0) * L.pw + x - L.x0) * 4, ((y - L.y0) * L.pw + x - L.x0) * 4 + 4)];
  // Everywhere in the outline, nothing outside it.
  let inside = 0; let outside = 0;
  for (let y = L.y0; y < L.y0 + L.ph; y++) for (let x = L.x0; x < L.x0 + L.pw; x++) { const a = at(x, y)[3]; if (m[y * w + x]) inside += a ? 1 : 0; else outside += a ? 1 : 0; }
  assert.ok(inside > 0.97 * m.reduce((a, v) => a + v, 0)); assert.equal(outside, 0);
  // The stripes, stretched to the outline's height (6 stripes over its 120 rows from row 10: 20 each): row 20
  // is in the first (red), row 40 in the second (yellow).
  assert.deepEqual(at(50, 20).slice(0, 3).map((v) => (v > 150 ? 1 : 0)), [1, 0, 0]);
  assert.deepEqual(at(50, 40).slice(0, 3).map((v) => (v > 150 ? 1 : 0)), [1, 1, 0]);
  // The neckline gap: bridged with the cloth on either side (red), not left empty.
  const g = at(50, 12); assert.equal(g[3], 255); assert.ok(g[0] > 150 && g[1] < 80, String(g));
});

test('fashion: the upper-body zone takes all of the body there, clothes and skin (the neckline, the arms), not the face or hair; folds read from the garment', () => {
  const { p, rgba } = person();
  // A V of bare skin in the shirt below the chin (a neckline), and arms beside the shirt.
  for (let y = 70; y < 100; y++) for (let x = 100 - (100 - y) / 2; x < 100 + (100 - y) / 2; x++) { const i = y * 200 + Math.round(x); p.clothes[i] = 0; p.body[i] = 255; }
  for (let y = 100; y < 190; y++) for (let x = 55; x < 64; x++) p.body[y * 200 + x] = 255;
  const L = bodyLayout(p, rgba);
  const r = kindRegion('upper', p, L);
  assert.equal(r.mask[90 * 200 + 100], 1, 'the neckline skin is in it');
  assert.equal(r.mask[150 * 200 + 58], 1, 'the bare arm beside it too (a zone is more than the top)');
  assert.equal(r.mask[40 * 200 + 100], 0, 'not the face');
  const top = kindRegion('top', p, L);
  assert.equal(top.mask[150 * 200 + 58], 0, 'the top alone is only what\'s worn');
  // Folds: a dark crease across the garment reads below 1, its flat cloth at 1.
  const w = 60; const hh = 40; const px = new Uint8ClampedArray(w * hh * 4).fill(150); const gm = new Uint8Array(w * hh).fill(1);
  for (let x = 0; x < w; x++) for (let y = 19; y < 22; y++) px.set([90, 90, 90, 255], (y * w + x) * 4);
  const f = foldMap(px, w, gm, { x0: 0, y0: 0, x1: w, y1: hh }, 1, 8);
  assert.ok(f[20 * w + 30] < 0.95 && Math.abs(f[5 * w + 30] - 1) < 0.03);
});

test('fashion: an upper body in parts by the pose: a tank top\'s bare arms told from its body; a jacket\'s sleeves covered', () => {
  const w = 600; const h = 900;
  const fig = (wear) => {
    const n = w * h; const p = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
    const rect = (x0, y0, x1, y1, m) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { p.body[y * w + x] = 0; p.clothes[y * w + x] = 0; m[y * w + x] = 255; } };
    for (let y = 70; y < 210; y++) for (let x = 245; x < 355; x++) p.face[y * w + x] = 255;
    rect(278, 200, 322, 245, p.body); rect(148, 250, 188, 550, p.body); rect(412, 250, 452, 550, p.body);
    if (wear === 'tank') rect(208, 238, 392, 530, p.clothes);
    else { rect(196, 238, 404, 538, p.clothes); rect(140, 245, 198, 515, p.clothes); rect(402, 245, 460, 515, p.clothes); }
    rect(212, 530, 388, 850, p.clothes);
    return p;
  };
  const P = (x, y) => [x, y, 1];
  const pose = { shoulders: [P(205, 250), P(395, 250)], elbows: [P(168, 390), P(432, 390)], wrists: [P(168, 520), P(432, 520)], hips: [P(245, 525), P(355, 525)] };
  const tank = fig('tank'); const t = upperParts(tank, bodyLayout(tank), w, h, 'upper', pose);
  assert.equal(t.byPose, true);
  assert.equal(t.left.covered, false); assert.equal(t.right.covered, false); assert.equal(t.torso.covered, true);
  assert.ok(t.left.box.x1 <= 190 && t.right.box.x0 >= 410, `arms are the arms: ${JSON.stringify([t.left.box, t.right.box])}`);
  assert.equal(t.torso.mask[350 * w + 215], 1, 'the tank\'s side is its body\'s');
  const jacket = fig('jacket'); const j = upperParts(jacket, bodyLayout(jacket), w, h, 'upper', pose);
  assert.equal(j.left.covered, true); assert.equal(j.right.covered, true);
  assert.equal(j.left.mask[400 * w + 160], 1); assert.equal(j.torso.mask[400 * w + 300], 1);
  // A bare arm where a sleeve was: as wide as the bare arm seen below it, in the skin's color.
  const sleeve = { mask: new Uint8Array(w * h), box: { x0: 140, y0: 245, x1: 198, y1: 515 } };
  for (let y = 245; y < 515; y++) for (let x = 140; x < 198; x++) sleeve.mask[y * w + x] = 1;
  // (The figure's bare forearm below the sleeve: 40 wide, x 148–188.)
  const people = fig('jacket');
  const arm = bareArm(sleeve, w, h, [224, 168, 136], people);
  let on = 0; for (let x = 0; x < arm.pw; x++) if (arm.rgba[((400 - arm.y0) * arm.pw + x) * 4 + 3] > 128) on++;
  assert.ok(Math.abs(on - 40) <= 3, `arm width ${on}`);
});

test('fashion: a group photo told apart: each person their own, parted where one dress meets the next', () => {
  // Two people side by side, touching: faces at x 60 and 140; a red dress (x 30..100) and a green one
  // (x 100..170), the red one's wearer leaning, so halfway between the faces isn't where they part.
  const w = 200; const h = 300; const n = w * h;
  const p = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  const rgba = new Uint8ClampedArray(n * 4).fill(235);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let c = null;
    if (y >= 20 && y < 60 && Math.abs(x - 60) < 16) { p.face[i] = 255; c = [220, 180, 150]; }
    else if (y >= 20 && y < 60 && Math.abs(x - 140) < 16) { p.face[i] = 255; c = [210, 170, 140]; }
    else if (y >= 60 && y < 280 && x >= 30 && x < 120 - (y > 150 ? 20 : 0)) { p.clothes[i] = 255; c = [180, 30, 40]; }
    else if (y >= 60 && y < 280 && x >= 100 - (y > 150 ? 0 : -20) && x < 170) { p.clothes[i] = 255; c = [90, 170, 60]; }
    if (c) rgba.set([...c, 255], i * 4);
  }
  const P = (x, y) => [x, y, 1];
  const pose = (cx) => ({ nose: P(cx, 40), shoulders: [P(cx - 25, 70), P(cx + 25, 70)], elbows: [P(cx - 30, 120), P(cx + 30, 120)], wrists: [P(cx - 30, 160), P(cx + 30, 160)], hips: [P(cx - 15, 160), P(cx + 15, 160)], knees: [P(cx - 12, 220), P(cx + 12, 220)], ankles: [P(cx - 12, 275), P(cx + 12, 275)] });
  const ps = splitPeople(p, rgba, [pose(60), pose(140)]);
  assert.equal(ps.length, 2);
  const mine = (k, x, y) => ps[k].p.clothes[y * w + x] >= 128;
  // Below y 150 the red dress ends at x 100: the green one is all the second person's, its left edge too.
  assert.ok(mine(1, 105, 200) && !mine(0, 105, 200), 'the green dress\'s left edge is the second person\'s');
  assert.ok(mine(0, 95, 200) && !mine(1, 95, 200), 'the red dress\'s right edge is the first person\'s');
  // Above, the red dress reaches x 120: still the first person's.
  assert.ok(mine(0, 115, 100), 'the red dress where it reaches past the middle');
  assert.ok(ps[0].p.face[40 * w + 60] && !ps[0].p.face[40 * w + 140], 'each their own face');
  // One person: the maps as they are.
  assert.equal(splitPeople(p, rgba, []).length >= 1, true);
});
