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
    assert.ok(Math.abs(r - SKIN[0]) < 40 && Math.abs(g - SKIN[1]) < 40 && Math.abs(b - SKIN[2]) < 40, `skin at ${x},${y}: ${[r, g, b]}`);
  }
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
