// Fashion's Replace, on a black top with dark brown hair lying over it (web/apps/fashion/compose.js:
// leftovers and recolor): what's left of the old top past the hair (its side by the armhole, which the
// person finder read as skin) takes the piece's color; the hair itself is never recolored (multiplied up
// from black to the piece's cream, dark brown hair came out pink); a lighter piece keeps its own color.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leftovers, recolor } from '../web/apps/fashion/compose.js';

const BLACK = [22, 20, 24]; const HAIR = [62, 36, 30]; const SKIN = [225, 180, 150]; const CREAM = [236, 226, 204];

function scene() {
  const w = 200; const h = 300; const n = w * h;
  const people = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  const rgba = new Uint8ClampedArray(n * 4).fill(235);
  const target = { mask: new Uint8Array(n), box: { x0: 80, y0: 100, x1: 140, y1: 260 } };
  const put = (x, y, c) => { const i = (y * w + x) * 4; rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (y >= 20 && y < 80 && x >= 80 && x < 120) { people.face[i] = 255; put(x, y, SKIN); continue; }
    if (y >= 80 && y < 100 && x >= 92 && x < 108) { people.body[i] = 255; put(x, y, SKIN); continue; }
    // The top: found as clothes from x = 80 to 140.
    if (y >= 100 && y < 260 && x >= 80 && x < 140) { people.clothes[i] = 255; target.mask[i] = 1; put(x, y, BLACK); continue; }
    // A lock of dark brown hair over the top's left side (x 66..80), and the top's side past it (x 58..66),
    // which the finder took for skin.
    if (y >= 60 && y < 240 && x >= 66 && x < 80) { people.hair[i] = 255; put(x, y, HAIR); continue; }
    if (y >= 110 && y < 240 && x >= 58 && x < 66) { people.body[i] = 230; put(x, y, BLACK); continue; }
    // Their arm beyond it.
    if (y >= 105 && y < 250 && x >= 40 && x < 58) { people.body[i] = 255; put(x, y, SKIN); continue; }
  }
  const base = { w, h, rgba, people, layout: { fw: 40, fh: 60, chin: 80, face: { x0: 80, y0: 20, x1: 120, y1: 80 } } };
  // The new piece laid in over the top's outline: plain cream.
  const b = target.box; const pw = b.x1 - b.x0; const ph = b.y1 - b.y0; const L = new Uint8ClampedArray(pw * ph * 4);
  for (let k = 0; k < pw * ph; k++) { L[k * 4] = CREAM[0]; L[k * 4 + 1] = CREAM[1]; L[k * 4 + 2] = CREAM[2]; L[k * 4 + 3] = 255; }
  const layer = { x0: b.x0, y0: b.y0, pw, ph, rgba: L };
  return { S: { base, piece: {}, target, kind: 'top', mode: 'replace', tune: {} }, layer };
}

test('Replace a black top under dark hair: its side past the hair takes the piece\'s cream; the hair is never recolored (no pink); the cream keeps its color', () => {
  const { S, layer } = scene(); const { w, rgba } = S.base;
  const rest = leftovers(S, layer);
  assert.ok(rest, 'something of the old top left to recolor');
  const out = Uint8ClampedArray.from(rgba);
  recolor(out, w, rest, rgba);
  const px = (x, y) => Array.from(out.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
  // The top's side past the lock of hair: cream now (light, without a tint), not black.
  for (const [x, y] of [[60, 150], [63, 200], [61, 130]]) {
    const [r, g, b] = px(x, y);
    assert.ok(r > 140 && g > 130 && b > 115, `the top's side recolored at ${x},${y}: ${[r, g, b]}`);
    assert.ok(r - b < 45 && Math.abs(r - g) < 25, `cream, not pink, at ${x},${y}: ${[r, g, b]}`);
  }
  // The hair: exactly as it was.
  for (const [x, y] of [[70, 150], [75, 200], [68, 120], [78, 230]]) assert.deepEqual(px(x, y), HAIR, `hair untouched at ${x},${y}`);
  // Their skin and face: untouched.
  assert.deepEqual(px(48, 150), SKIN); assert.deepEqual(px(100, 50), SKIN);
});

test('a piece laid in at one scale (rigid) keeps its proportions in a narrow outline; past its hem its bottom rows are mirrored on, not one row repeated', async () => {
  const { traceTransfer, rowSpans } = await import('../web/tools/fashion/fashion-core.js');
  // The piece: 100 × 100, columns striped every 10 px (dark, light), and its rows shaded top to bottom.
  const pw = 100; const ph = 100; const tex = new Uint8ClampedArray(pw * ph * 4); const pm = new Uint8Array(pw * ph).fill(1);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = (y * pw + x) * 4; const v = Math.floor(x / 10) % 2 ? 220 : 40; tex[i] = v; tex[i + 1] = v; tex[i + 2] = 100 + y; tex[i + 3] = 255; }
  const pb = { x0: 0, y0: 0, x1: pw, y1: ph };
  // The outline: only 20 px wide (the rest hidden), 160 tall, in a 200 × 200 picture.
  const w = 200; const h = 200; const mask = new Uint8Array(w * h); const box = { x0: 90, y0: 20, x1: 110, y1: 180 };
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) mask[y * w + x] = 1;
  const target = { mask, box, spans: rowSpans(mask, w, box, 4) };
  const centers = { t: () => 100, p: () => 50 };
  const L = traceTransfer(tex, pm, pw, ph, pb, target, w, h, { centers, rigid: { s: 1 }, prints: false, rows: null, open: true, s: 1 });
  const at = (x, y) => L.rgba[((y - L.y0) * L.pw + x - L.x0) * 4];
  // At one scale: the stripes keep their 10 px width (stretched to the outline, 100 px would be squeezed into 20).
  let changes = 0; for (let x = 91; x < 109; x++) if (Math.abs(at(x, 60) - at(x - 1, 60)) > 100) changes++;
  assert.ok(changes <= 2, `stripes kept their width: ${changes} edges in 18 px`);
  // Rows: the outline is taller than the piece; its last rows aren't all the piece's last row.
  const blue = (y) => L.rgba[((y - L.y0) * L.pw + 100 - L.x0) * 4 + 2];
  const last = new Set(); for (let y = 170; y < 180; y++) last.add(blue(y));
  assert.ok(last.size > 3 && blue(179) < 199, `not one row repeated at the bottom: ${[...last]}`);
});

test('taken off first: the whole garment in the zone is found (its side past a lock of hair, a strip the finder called skin, between strands), not hair or a patch beside them; erased to their own skin', async () => {
  const { garmentZone, eraseGarment, erasing } = await import('../web/apps/fashion/compose.js');
  const { S } = scene(); const { w, rgba, people: p } = S.base;
  // Between two strands of the lock (x 72..73), the top shows through, the finder unsure of hair there.
  for (let y = 120; y < 230; y++) for (const x of [72, 73]) { const i = y * w + x; p.hair[i] = 120; rgba.set([...BLACK, 255], i * 4); }
  // A patch of the same black off on its own beside them, in the background.
  for (let y = 150; y < 165; y++) for (let x = 180; x < 192; x++) { const i = y * w + x; p.clothes[i] = 255; rgba.set([...BLACK, 255], i * 4); }
  // Their layout: the person and where their waist is.
  Object.assign(S.base.layout, { person: { x0: 30, y0: 10, x1: 196, y1: 290 }, waist: 255, ankle: 290, split: true });
  assert.equal(erasing(S), true);
  const z = garmentZone(S);
  const on = (x, y) => !!z.mask[y * w + x];
  assert.ok(on(100, 150) && on(130, 240), 'the top itself');
  assert.ok(on(60, 150) && on(63, 200), 'its side past the lock of hair, which the finder called skin');
  assert.ok(on(72, 150) && on(73, 200), 'between the strands');
  assert.ok(!on(70, 150) && !on(78, 200), 'not the hair');
  assert.ok(!on(185, 158), 'not the patch beside them');
  assert.ok(!on(48, 150) && !on(100, 50), 'not their arm or face');
  // Erased: their own skin there, lit as it is around it.
  const e = eraseGarment(S, z);
  const at = (x, y) => Array.from(e.rgba.slice(((y - e.y0) * e.pw + x - e.x0) * 4, ((y - e.y0) * e.pw + x - e.x0) * 4 + 4));
  for (const [x, y] of [[100, 150], [60, 150], [72, 150]]) {
    const [r, g, b, a] = at(x, y);
    assert.equal(a, 255);
    // (Their skin's color; beside hair, in its shade: as warm, a little darker.)
    const k = r / SKIN[0];
    assert.ok(k > 0.6 && k < 1.15 && Math.abs(g / r - SKIN[1] / SKIN[0]) < 0.08 && Math.abs(b / r - SKIN[2] / SKIN[0]) < 0.08, `skin at ${x},${y}: ${[r, g, b]}`);
  }
  // (Shaded where it meets hair: the pixel between two strands darker than the open middle of it.)
  assert.ok(at(72, 150)[0] < at(100, 150)[0], 'shaded beside the hair');
});

test('an upper body matched body to body: each arm of the piece (raised or hanging) is what of its selection lies along that arm, outside its torso', async () => {
  const { pieceArms } = await import('../web/apps/fashion/compose.js');
  // A piece 200 × 300: its torso x 70..130, y 80..220; its left arm raised (shoulder 70,85 → elbow 30,40 →
  // wrist 60,10), its right arm hanging (shoulder 130,85 → elbow 150,160 → wrist 155,230).
  const W = 200; const H = 300; const sel = new Uint8Array(W * H);
  const band = (a, b, r) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = b[0] - a[0]; const dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy))); if (Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < r) sel[y * W + x] = 1; } };
  for (let y = 80; y < 220; y++) for (let x = 70; x < 130; x++) sel[y * W + x] = 1;
  band([70, 85], [30, 40], 9); band([30, 40], [60, 10], 8); band([130, 85], [150, 160], 9); band([150, 160], [155, 230], 8);
  const pose = { shoulders: [[70, 85, 1], [130, 85, 1]], elbows: [[30, 40, 1], [150, 160, 1]], wrists: [[60, 10, 1], [155, 230, 1]], hips: [[75, 215, 1], [125, 215, 1]] };
  const piece = { w: W, h: H, sel, solid: sel, box: { x0: 0, y0: 0, x1: W, y1: H }, pose };
  const arms = pieceArms({ piece, base: { pose } });
  assert.ok(arms[0] && arms[1], 'both arms found');
  const on = (k, x, y) => !!arms[k][y * W + x];
  assert.ok(on(0, 45, 55) && on(0, 50, 22), 'the raised arm, upper and fore');
  assert.ok(on(1, 142, 125) && on(1, 153, 200), 'the hanging arm, upper and fore');
  assert.ok(!on(0, 100, 150) && !on(1, 100, 150) && !on(1, 125, 150), 'not the torso');
  assert.ok(!on(1, 45, 55) && !on(0, 142, 125), 'each arm only its own');
});

test('skin made where the garment was meets their real skin it touches with no seam: by the border its color, fading to the made-up skin further in', async () => {
  const { eraseGarment } = await import('../web/apps/fashion/compose.js');
  // A neck in shadow (darker than their usual skin) right above the garment zone.
  const w = 120; const h = 200; const n = w * h;
  const people = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  const rgba = new Uint8ClampedArray(n * 4).fill(240); const zm = new Uint8Array(n);
  const NECK = [150, 105, 85]; const ARM = [225, 180, 150];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const put = (c) => rgba.set([...c, 255], i * 4);
    if (y >= 40 && y < 80 && x >= 45 && x < 75) { people.body[i] = 255; put(NECK); }
    else if (y >= 80 && y < 190 && x >= 30 && x < 90) { people.clothes[i] = 255; zm[i] = 1; put([20, 20, 24]); }
    else if (y >= 80 && y < 190 && (x >= 10 && x < 30)) { people.body[i] = 255; put(ARM); }
  }
  const z = { mask: zm, box: { x0: 30, y0: 80, x1: 90, y1: 190 } };
  const S = { base: { w, h, rgba, people, layout: { fw: 30, fh: 60, chin: 40, face: { x0: 45, y0: 0, x1: 75, y1: 40 } } }, target: {}, kind: 'top', mode: 'replace' };
  const e = eraseGarment(S, z);
  const at = (x, y) => Array.from(e.rgba.slice(((y - e.y0) * e.pw + x - e.x0) * 4, ((y - e.y0) * e.pw + x - e.x0) * 4 + 3));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // Just under the neck: its shaded color, not the usual skin's.
  assert.ok(dist(at(60, 81), NECK) < 30, `meets the neck: ${at(60, 81)} vs ${NECK}`);
  // Further in (well past a third of a face's height): the made-up skin (their usual skin, lit).
  assert.ok(dist(at(60, 170), NECK) > dist(at(60, 81), NECK) + 20, `fades further in: ${at(60, 170)}`);
  // Smooth: no step down its middle column.
  let step = 0; for (let y = 82; y < 185; y++) step = Math.max(step, dist(at(60, y), at(60, y - 1)));
  assert.ok(step < 12, `no seam: largest step ${step.toFixed(1)}`);
});

test('no dark line between the jaw and the new neck: a black collar\'s pure-black top edge just under the jaw (called hair by the finder) is taken off', async () => {
  const { garmentZone } = await import('../web/apps/fashion/compose.js');
  const w = 160; const h = 240; const n = w * h;
  const people = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  const rgba = new Uint8ClampedArray(n * 4).fill(240); const tm = new Uint8Array(n);
  const put = (i, c) => rgba.set([...c, 255], i * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (y >= 10 && y < 73 && x >= 55 && x < 105) { people.face[i] = 255; put(i, [225, 180, 150]); }            // the face; its chin line found a little lower (76), as on a real photo
    else if (y >= 73 && y < 76 && x >= 60 && x < 100) { people.hair[i] = 220; put(i, [0, 0, 0]); }            // the collar's top edge (a few pixels, as wide as for a face this size), called hair
    else if (y >= 76 && y < 200 && x >= 40 && x < 120) { people.clothes[i] = 255; tm[i] = 1; put(i, [20, 18, 22]); } // the top
    else if (y >= 30 && y < 200 && (x < 40 || x >= 120) && x >= 20 && x < 140) { people.hair[i] = 255; put(i, [60, 35, 28]); } // their hair, beside
  }
  const target = { mask: tm, box: { x0: 40, y0: 76, x1: 120, y1: 200 } };
  const S = { base: { w, h, rgba, people, layout: { fw: 50, fh: 60, chin: 76, waist: 195, ankle: 238, split: true, person: { x0: 20, y0: 10, x1: 140, y1: 238 }, face: { x0: 55, y0: 10, x1: 105, y1: 70 } } }, target, kind: 'upper', mode: 'replace', piece: {} };
  const z = garmentZone(S);
  const on = (x, y) => !!z.mask[y * w + x];
  for (const y of [73, 74, 75]) assert.ok(on(80, y), `the collar's black edge under the jaw, row ${y}`);
  assert.ok(!on(80, 65) && !on(30, 100), 'not the face, not their hair beside it');
});

test('made skin starting right under the jaw: no line where it meets it (its exact shade there); the chin\'s shadow comes in gradually below, never a step', async () => {
  const { eraseGarment } = await import('../web/apps/fashion/compose.js');
  const w = 120; const h = 200; const n = w * h;
  const people = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  const rgba = new Uint8ClampedArray(n * 4).fill(240); const zm = new Uint8Array(n);
  const JAW = [205, 160, 132];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const put = (c) => rgba.set([...c, 255], i * 4);
    if (y >= 10 && y < 60 && x >= 35 && x < 85) { people.face[i] = 255; put(JAW); }          // the face down to the chin (60)
    else if (y >= 60 && y < 190 && x >= 25 && x < 95) { people.clothes[i] = 255; zm[i] = 1; put([20, 20, 24]); } // the top, right under it
    else if (y >= 60 && y < 190 && x >= 8 && x < 25) { people.body[i] = 255; put([225, 180, 150]); }   // an arm
  }
  const z = { mask: zm, box: { x0: 25, y0: 60, x1: 95, y1: 190 } };
  const S = { base: { w, h, rgba, people, layout: { fw: 50, fh: 60, chin: 60, face: { x0: 35, y0: 10, x1: 85, y1: 60 } } }, target: {}, kind: 'top', mode: 'replace' };
  const e = eraseGarment(S, z);
  const lum = (x, y) => { const o = ((y - e.y0) * e.pw + x - e.x0) * 4; return 0.299 * e.rgba[o] + 0.587 * e.rgba[o + 1] + 0.114 * e.rgba[o + 2]; };
  const jaw = 0.299 * JAW[0] + 0.587 * JAW[1] + 0.114 * JAW[2];
  assert.ok(Math.abs(lum(60, 60) - jaw) < 14, `right under the jaw, its shade: ${lum(60, 60).toFixed(0)} vs ${jaw.toFixed(0)}`);
  let step = 0; for (let y = 61; y < 100; y++) step = Math.max(step, Math.abs(lum(60, y) - lum(60, y - 1)));
  assert.ok(step < 6, `no step going down: largest ${step.toFixed(1)}`);
  // (Darker just under the chin than further down the neck, where it's lit as their skin is.)
  assert.ok(lum(60, 70) < lum(60, 100) - 10, `in the chin's shadow just below it: ${lum(60, 70).toFixed(0)} vs ${lum(60, 100).toFixed(0)} lower down`);
});

test('made skin keeps their skin\'s color by a deep shade: not washed out to a grey-brown, and the shade doesn\'t darken all of it', async () => {
  const { eraseGarment } = await import('../web/apps/fashion/compose.js');
  const w = 120; const h = 220; const n = w * h;
  const people = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  const rgba = new Uint8ClampedArray(n * 4).fill(240); const zm = new Uint8Array(n);
  const SHADE = [110, 68, 48]; const SKIN = [225, 175, 145];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const put = (c) => rgba.set([...c, 255], i * 4);
    if (y >= 10 && y < 52 && x >= 35 && x < 85) { people.face[i] = 255; put(SKIN); }
    else if (y >= 52 && y < 60 && x >= 35 && x < 85) { people.face[i] = 255; put(SHADE); }       // the underside of the jaw, in deep shade
    else if (y >= 60 && y < 210 && x >= 25 && x < 95) { people.clothes[i] = 255; zm[i] = 1; put([20, 20, 24]); }
    else if (y >= 60 && y < 210 && x >= 6 && x < 25) { people.body[i] = 255; put(SKIN); }
  }
  const z = { mask: zm, box: { x0: 25, y0: 60, x1: 95, y1: 210 } };
  const e = eraseGarment({ base: { w, h, rgba, people, layout: { fw: 50, fh: 60, chin: 60, face: { x0: 35, y0: 10, x1: 85, y1: 60 } } }, target: {}, kind: 'top', mode: 'replace' }, z);
  const at = (x, y) => Array.from(e.rgba.slice(((y - e.y0) * e.pw + x - e.x0) * 4, ((y - e.y0) * e.pw + x - e.x0) * 4 + 3));
  // (Warmth: red over blue, as their skin's (1.55); a wash toward grey would bring it toward 1.)
  for (const y of [62, 80, 120]) { const [r, , b] = at(60, y); assert.ok(r / b > 1.4, `warm as their skin at row ${y}: ${at(60, y)}`); }
  const L = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  // (Right by the shade it's near it (no light line under the jaw)...)
  assert.ok(L(at(60, 61)) - L(SHADE) < 45, `near the shade by the jaw: ${at(60, 61)}`);
  // (...and that shade only a little way in (a fifth of a face's height): past it, lit as their skin is.)
  assert.ok(L(at(60, 72)) > L(SKIN) * 0.8, `lit as their skin past the jaw's shade: ${at(60, 72)}`);
});

test('a made neck beside hair: the skin ends on a smooth neck line and what\'s behind it (dark, as under the hair) is past it, so the hair\'s ragged edge lies on dark, not skin', async () => {
  const { eraseGarment } = await import('../web/apps/fashion/compose.js');
  const w = 200; const h = 240; const n = w * h;
  const people = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  const rgba = new Uint8ClampedArray(n * 4).fill(240); const zm = new Uint8Array(n);
  const SKIN = [220, 170, 140]; const HAIR = [50, 30, 25];
  let seed = 3; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const put = (c) => rgba.set([...c, 255], i * 4);
    // (Hair down both sides, its inner edge ragged.)
    const edgeL = 40 + Math.floor(rnd() * 10); const edgeR = 160 - Math.floor(rnd() * 10);
    if (y >= 10 && y < 70 && x >= 75 && x < 125) { people.face[i] = 255; put(SKIN); }
    else if (y >= 20 && y < 230 && (x < edgeL || x >= edgeR)) { people.hair[i] = 255; put(HAIR); }
    else if (y >= 70 && y < 230) { people.clothes[i] = 255; zm[i] = 1; put([20, 20, 24]); }   // the top, out to the hair
  }
  const P = (x, y) => [x, y, 1];
  const S = { base: { w, h, rgba, people, pose: { shoulders: [P(55, 140), P(145, 140)], elbows: [P(45, 200), P(155, 200)], wrists: [P(45, 240), P(155, 240)], hips: [P(70, 260), P(130, 260)] }, layout: { fw: 250, fh: 60, chin: 70, face: { x0: 75, y0: 10, x1: 125, y1: 70 } } }, target: {}, kind: 'upper', mode: 'replace' };
  // (A face as wide as this one would have a neck wider than the gap between the locks: the hair decides.)
  const e = eraseGarment(S, { mask: zm, box: { x0: 30, y0: 70, x1: 170, y1: 230 } });
  const L = (x, y) => { const o = ((y - e.y0) * e.pw + x - e.x0) * 4; return 0.299 * e.rgba[o] + 0.587 * e.rgba[o + 1] + 0.114 * e.rgba[o + 2]; };
  // (By the hair, past the neck's side: dark, as the hair is.)
  assert.ok(L(47, 100) < L(100, 100) * 0.55, `dark beside the hair: ${L(47, 100).toFixed(0)} vs neck ${L(100, 100).toFixed(0)}`);
  // (The neck's side a smooth line: from row to row it moves little, though the hair's edge jumps.)
  const side = (y) => { let x = 100; while (x > 50 && L(x, y) > L(100, y) * 0.75) x--; return x; };
  let jump = 0; for (let y = 86; y < 125; y++) jump = Math.max(jump, Math.abs(side(y) - side(y - 1)));
  assert.ok(jump <= 3, `a smooth neck line: it moves at most ${jump} px from row to row`);
});

test('sizing a piece from a turned (three-quarter) photo: by the middle of several measures (face, shoulders to hips, shoulders), not the foreshortened shoulders alone; and known to be turned', async () => {
  const { rigidZone } = await import('../web/apps/fashion/compose.js');
  const P = (x, y) => [x, y, 1];
  // The base faces the camera: shoulders 400 apart, face 200 tall, shoulders to hips 520.
  const base = { pose: { nose: P(500, 300), shoulders: [P(300, 500), P(700, 500)], hips: [P(400, 1020), P(600, 1020)] }, layout: { fh: 200 } };
  // The piece is the same build at two thirds the size, turned: its shoulders look only 150 apart (facing the
  // camera, at 2/3 of 400, they would be 267), its nose well off their middle.
  const piece = { pose: { nose: P(250, 260), shoulders: [P(275, 400), P(425, 400)], hips: [P(310, 747), P(400, 747)] }, layout: { fh: 133 } };
  const r = rigidZone({ base, piece });
  assert.ok(Math.abs(r.s - 1.5) < 0.08, `sized by the face and torso (1.5), not the shoulders (2.67): ${r.s.toFixed(2)}`);
  assert.equal(r.own, true, 'known to be turned');
  // (Both facing the camera: not turned.)
  const front = { pose: { nose: P(350, 260), shoulders: [P(217, 400), P(483, 400)], hips: [P(283, 747), P(417, 747)] }, layout: { fh: 133 } };
  assert.equal(rigidZone({ base, piece: front }).own, false);
});

test('made skin is shaped as a body, not a flat fill: darker toward the figure\'s outline than its middle, with no hard steps where the zone\'s width jumps', async () => {
  const { eraseGarment } = await import('../web/apps/fashion/compose.js');
  const w = 200; const h = 240; const n = w * h;
  const people = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  const rgba = new Uint8ClampedArray(n * 4).fill(240); const zm = new Uint8Array(n);
  const SKIN = [222, 172, 142];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const put = (c) => rgba.set([...c, 255], i * 4);
    if (y >= 10 && y < 70 && x >= 75 && x < 125) { people.face[i] = 255; put(SKIN); }
    // (The top: a torso, and from row 120 its sleeves out to the sides too, so each row's width jumps there.)
    else if (y >= 70 && y < 230 && ((x >= 50 && x < 150) || (y >= 120 && y < 170 && x >= 20 && x < 180))) { people.clothes[i] = 255; zm[i] = 1; put([20, 20, 24]); }
  }
  const P = (x, y) => [x, y, 1];
  const S = { base: { w, h, rgba, people, pose: { shoulders: [P(60, 100), P(140, 100)] }, layout: { fw: 50, fh: 60, chin: 70, face: { x0: 75, y0: 10, x1: 125, y1: 70 } } }, target: {}, kind: 'upper', mode: 'replace' };
  const e = eraseGarment(S, { mask: zm, box: { x0: 20, y0: 70, x1: 180, y1: 230 } });
  const L = (x, y) => { const o = ((y - e.y0) * e.pw + x - e.x0) * 4; return 0.299 * e.rgba[o] + 0.587 * e.rgba[o + 1] + 0.114 * e.rgba[o + 2]; };
  // (Round: by its outline (where the body turns from the light) darker than down its middle.)
  assert.ok(L(52, 200) < L(100, 200) - 8, `darker by the outline: ${L(52, 200).toFixed(0)} vs ${L(100, 200).toFixed(0)} in the middle`);
  // (Smooth: going down the torso past where the sleeves start and end, no step; the light changes gradually.)
  for (const x of [60, 80, 100]) { let step = 0; for (let y = 140; y < 225; y++) step = Math.max(step, Math.abs(L(x, y) - L(x, y - 1))); assert.ok(step < 2.5, `no step down column ${x}: largest ${step.toFixed(1)}`); }
});

test('made skin\'s color from their face when what was called their body\'s skin is far from it (a darker, oranger lock of hair or a warm wall): not a tan they don\'t have', async () => {
  const { eraseGarment } = await import('../web/apps/fashion/compose.js');
  const w = 160; const h = 240; const n = w * h;
  const people = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  const rgba = new Uint8ClampedArray(n * 4).fill(240); const zm = new Uint8Array(n);
  const FACE = [215, 165, 138]; const ORANGE = [137, 78, 44];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const put = (c) => rgba.set([...c, 255], i * 4);
    if (y >= 10 && y < 70 && x >= 55 && x < 105) { people.face[i] = 255; put(FACE); }
    else if (y >= 70 && y < 230 && x >= 40 && x < 120) { people.clothes[i] = 255; zm[i] = 1; put([240, 240, 240]); }
    else if (y >= 30 && y < 230 && x >= 6 && x < 30) { people.body[i] = 255; put(ORANGE); }        // "body skin", far from the face's color
  }
  const e = eraseGarment({ base: { w, h, rgba, people, layout: { fw: 50, fh: 60, chin: 70, face: { x0: 55, y0: 10, x1: 105, y1: 70 } } }, target: {}, kind: 'top', mode: 'replace' }, { mask: zm, box: { x0: 40, y0: 70, x1: 120, y1: 230 } });
  const at = (x, y) => Array.from(e.rgba.slice(((y - e.y0) * e.pw + x - e.x0) * 4, ((y - e.y0) * e.pw + x - e.x0) * 4 + 3));
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const c = at(80, 180);
  assert.ok(d(c, FACE) < d(c, ORANGE) * 0.5, `as their face, not the orange: ${c}`);
});

test('where their real neck meets the made one: the old collar\'s light edge just outside it (half collar, half skin) is made again, not left as a line; and the made neck goes on with the real neck\'s warmth below it, easing (no greyer band)', async () => {
  const { eraseGarment } = await import('../web/apps/fashion/compose.js');
  const w = 120; const h = 220; const n = w * h;
  const people = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  const rgba = new Uint8ClampedArray(n * 4).fill(240); const zm = new Uint8Array(n);
  const FACE = [215, 190, 175]; const NECK = [190, 132, 100]; const LINE = [222, 206, 190]; const WHITE = [238, 236, 230];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const put = (c) => rgba.set([...c, 255], i * 4);
    if (y >= 10 && y < 55 && x >= 35 && x < 85) { people.face[i] = 255; put(FACE); }                  // a pale face
    else if (y >= 55 && y < 80 && x >= 45 && x < 75) { people.body[i] = 255; put(NECK); }             // their real neck, warmer, above the collar
    else if (y >= 80 && y < 82 && x >= 40 && x < 80) { people.body[i] = 200; put(LINE); }            // the collar's light top edge, called skin
    else if (y >= 82 && y < 210 && x >= 25 && x < 95) { people.clothes[i] = 255; zm[i] = 1; put(WHITE); } // a white turtleneck
  }
  const z = { mask: zm, box: { x0: 25, y0: 82, x1: 95, y1: 210 } };
  const e = eraseGarment({ base: { w, h, rgba, people, layout: { fw: 50, fh: 60, chin: 55, face: { x0: 35, y0: 10, x1: 85, y1: 55 } } }, target: {}, kind: 'top', mode: 'replace' }, z);
  const at = (x, y) => { const o = ((y - e.y0) * e.pw + x - e.x0) * 4; return [e.rgba[o], e.rgba[o + 1], e.rgba[o + 2], e.rgba[o + 3]]; };
  // (The light edge made again: covered, near the neck's color, not the line's.)
  const edge = at(60, 81); const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  assert.ok(edge[3] >= 200 && d(edge, NECK) < d(LINE, NECK) - 30, `the collar's edge made again: ${edge}`);
  // (Below the collar it goes on with their neck's warmth (red over blue: the neck's 1.9, the pale face's 1.23),
  // easing toward the made skin's own further down, not dropping straight to it: no greyer band.)
  const r = (y) => { const c = at(60, y); return c[0] / c[2]; };
  assert.ok(r(88) > FACE[0] / FACE[2] + 0.15, `warmer than the face just below the collar: ${r(88).toFixed(2)}`);
  assert.ok(r(84) >= r(92) && r(92) >= r(120) - 0.02, `easing: ${[84, 92, 120].map((y) => r(y).toFixed(2))}`);
});

test('the tips of their hair over a colorful part of the garment (a red stole) are cleaned of its color when it is taken off, their lightness kept', async () => {
  const { eraseGarment } = await import('../web/apps/fashion/compose.js');
  const { rgbToLab } = await import('../web/lib/color-match.js');
  const w = 200; const h = 240; const n = w * h;
  const people = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  const rgba = new Uint8ClampedArray(n * 4).fill(240); const zm = new Uint8Array(n);
  const FACE = [222, 176, 150]; const HAIR = [170, 130, 80]; const RED = [180, 30, 45];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const put = (c) => rgba.set([...c, 255], i * 4);
    if (y >= 10 && y < 70 && x >= 75 && x < 125) { people.face[i] = 255; put(FACE); }
    // (A lock of hair down the left side, its last rows over the stole: a mix of hair and red.)
    else if (x >= 30 && x < 70 && y >= 20 && y < 104) { people.hair[i] = 255; const t = y >= 90 ? (y - 90) / 14 * 0.7 : 0; put(HAIR.map((c, k) => Math.round(c * (1 - t) + RED[k] * t))); }
    else if (y >= 104 && y < 230 && x >= 20 && x < 180) { people.clothes[i] = 255; zm[i] = 1; put(x < 80 ? RED : [235, 235, 232]); }
  }
  const S = { base: { w, h, rgba, people, layout: { fw: 50, fh: 60, chin: 70, face: { x0: 75, y0: 10, x1: 125, y1: 70 } } }, target: {}, kind: 'upper', mode: 'replace' };
  const z = { mask: zm, box: { x0: 20, y0: 104, x1: 180, y1: 230 }, vivid: [rgbToLab(...RED)] };
  const e = eraseGarment(S, z);
  const at = (x, y) => { const o = ((y - e.y0) * e.pw + x - e.x0) * 4; return Array.from(e.rgba.slice(o, o + 4)); };
  const hueGap = (c, ref) => { const a = rgbToLab(c[0], c[1], c[2]); const b = rgbToLab(...ref); return Math.hypot(a[1] - b[1], a[2] - b[2]); };
  const tip = at(50, 101);
  assert.ok(tip[3] > 150, `the tip is covered: alpha ${tip[3]}`);
  assert.ok(hueGap(tip, HAIR) < hueGap(tip, RED) * 0.5, `as their hair, not the stole: ${tip}`);
  const before = rgbToLab(...rgba.slice((101 * w + 50) * 4, (101 * w + 50) * 4 + 3)); const after = rgbToLab(tip[0], tip[1], tip[2]);
  assert.ok(Math.abs(before[0] - after[0]) < 8, `its lightness kept: ${before[0].toFixed(0)} → ${after[0].toFixed(0)}`);
});

test('the piece\'s edge over made skin (a short top\'s hem over a bare midriff) casts a soft shadow just next to it, on made skin only', async () => {
  const { shadeUnder } = await import('../web/apps/fashion/compose.js');
  const w = 60; const h = 60; const out = new Uint8ClampedArray(w * h * 4).fill(200);
  // (The piece: its top half; the made skin: everywhere but the left quarter.)
  const layer = { x0: 0, y0: 0, pw: w, ph: 30, rgba: new Uint8ClampedArray(w * 30 * 4).fill(255) };
  const prgba = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 15; x < w; x++) prgba[(y * w + x) * 4 + 3] = 255;
  shadeUnder(out, w, h, layer, { x0: 0, y0: 0, pw: w, ph: h, rgba: prgba }, 60);
  const v = (x, y) => out[(y * w + x) * 4];
  assert.ok(v(40, 30) < 150, `darker right under the hem: ${v(40, 30)}`);
  assert.ok(v(40, 33) > v(40, 30) && v(40, 33) < 200, 'lighter going away from it');
  assert.equal(v(40, 45), 200, 'none further down');
  assert.equal(v(5, 30), 200, 'not on what isn\'t made skin');
  assert.equal(v(40, 10), 200, 'not under the piece itself');
});

test('where the real neck meets the made skin below an old collar, the collar\'s shadow on the neck right above it leaves no dark line', async () => {
  const { eraseGarment } = await import('../web/apps/fashion/compose.js');
  const w = 200; const h = 240; const n = w * h;
  const people = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  const rgba = new Uint8ClampedArray(n * 4).fill(240); const zm = new Uint8Array(n);
  const FACE = [222, 172, 142]; const NECK = [205, 150, 120]; const SHADE = [150, 118, 92];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const put = (c) => rgba.set([...c, 255], i * 4);
    if (y >= 10 && y < 70 && x >= 75 && x < 125) { people.face[i] = 255; put(FACE); }
    else if (y >= 70 && y < 100 && x >= 82 && x < 118) { people.body[i] = 255; put(y >= 97 ? SHADE : NECK); }
    else if (y >= 100 && y < 230 && x >= 40 && x < 160) { people.clothes[i] = 255; zm[i] = 1; put([235, 235, 230]); }
  }
  const S = { base: { w, h, rgba, people, layout: { fw: 50, fh: 60, chin: 70, face: { x0: 75, y0: 10, x1: 125, y1: 70 } } }, target: {}, kind: 'top', mode: 'replace' };
  const e = eraseGarment(S, { mask: zm, box: { x0: 40, y0: 100, x1: 160, y1: 230 } });
  // (What shows: the patch over the photo.)
  const shown = (x, y) => { const inP = x >= e.x0 && y >= e.y0 && x < e.x0 + e.pw && y < e.y0 + e.ph; const o = inP ? ((y - e.y0) * e.pw + x - e.x0) * 4 : 0; const a = inP ? e.rgba[o + 3] / 255 : 0; const i = (y * w + x) * 4; return 0.299 * (e.rgba[o] * a + rgba[i] * (1 - a)) + 0.587 * (e.rgba[o + 1] * a + rgba[i + 1] * (1 - a)) + 0.114 * (e.rgba[o + 2] * a + rgba[i + 2] * (1 - a)); };
  const lo = Math.min(shown(100, 92), shown(100, 106));
  for (let y = 95; y <= 103; y++) assert.ok(shown(100, y) > lo - 8, `no dark line at row ${y}: ${shown(100, y).toFixed(0)} vs ${lo.toFixed(0)}`);
});
