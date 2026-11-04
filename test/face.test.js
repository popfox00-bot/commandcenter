// Faces, the geometry (web/lib/face-core.js): eyes and mouth from landmarks, turning back from a turned
// picture, the photo editor's rotate + straighten that level a face (checked through the editor's own
// mapping), and where a mask goes to cover a face.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faceFrom, unturn, levelTurn, maskLayer, mainFace, dedupe } from '../web/lib/face-core.js';
import { outputToSource, orientedSize } from '../web/tools/editor/geometry.js';

/** 68 landmarks (pixels) for a face with these eyes and mouth (the rest at the nose). */
function landmarks(eyeA, eyeB, mouth, nose) {
  const pts = Array.from({ length: 68 }, () => nose);
  for (let i = 36; i < 42; i++) pts[i] = eyeA;
  for (let i = 42; i < 48; i++) pts[i] = eyeB;
  for (let i = 48; i < 68; i++) pts[i] = mouth;
  return pts;
}
const W = 1000; const H = 800;
/** A face whose eyes are `d` px apart, turned `deg` clockwise about (cx, cy). */
function face(cx, cy, deg, d = 120) {
  const t = (deg * Math.PI) / 180; const rot = ([x, y]) => [cx + x * Math.cos(t) - y * Math.sin(t), cy + x * Math.sin(t) + y * Math.cos(t)];
  const lm = landmarks(rot([-d / 2, 0]), rot([d / 2, 0]), rot([0, d * 0.9]), rot([0, d * 0.45]));
  return faceFrom({ x: cx - d, y: cy - d, width: 2 * d, height: 2.2 * d }, lm, W, H, 0.9);
}
// Where a source point shows for an editor state (inverse of the renderer's mapping).
const map = (st, [u, v]) => {
  const M = outputToSource(st, W, H); const det = M[0] * M[4] - M[1] * M[3];
  const su = u - M[2]; const sv = v - M[5];
  const o = orientedSize(W, H, st.rotate);
  return [((M[4] * su - M[1] * sv) / det) * o.W, ((-M[3] * su + M[0] * sv) / det) * o.H];
};
const base = { rotate: 0, flipH: false, flipV: false, straighten: 0, crop: { x: 0, y: 0, w: 1, h: 1 } };
const levelAfter = (f, st) => {
  const a = map(st, f.eyes[0]); const b = map(st, f.eyes[1]); const m = map(st, f.mouth);
  const d = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return { slope: d > 90 ? d - 180 : d < -90 ? d + 180 : d, upright: m[1] > (a[1] + b[1]) / 2 };
};

test('a face: its eyes in order (the mouth below the line between them), its tilt', () => {
  const f = face(500, 400, 20);
  assert.ok(Math.abs(f.angle - 20) < 0.01);
  assert.ok(f.eyes[0][0] < f.eyes[1][0], 'left eye first');
  const upsideDown = face(500, 400, 180);
  assert.ok(Math.abs(Math.abs(upsideDown.angle) - 180) < 0.01, `upside down: ${upsideDown.angle}`);
  assert.ok(upsideDown.mouth[1] < upsideDown.eyes[0][1], 'its mouth above its eyes');
});

test('points found in a turned picture come back to the unturned one', () => {
  // A point turned 30° about the middle, then unturned, lands where it was.
  const w = 400; const h = 300; const t = Math.PI / 6;
  const Wt = w * Math.cos(t) + h * Math.sin(t); const Ht = w * Math.sin(t) + h * Math.cos(t);
  const p = [0.8, 0.25]; const x = p[0] * w - w / 2; const y = p[1] * h - h / 2;
  const q = [(x * Math.cos(t) - y * Math.sin(t) + Wt / 2) / Wt, (x * Math.sin(t) + y * Math.cos(t) + Ht / 2) / Ht];
  const back = unturn(q, 30, w, h);
  assert.ok(Math.abs(back[0] - p[0]) < 1e-9 && Math.abs(back[1] - p[1]) < 1e-9, `${back}`);
});

test('level face: the turn that puts the eyes level and above the mouth, through the editor geometry', () => {
  for (const deg of [20, -33, 70, 160, -110, 0]) {
    const f = face(500, 400, deg);
    const turn = levelTurn(f, base, map);
    assert.ok(turn, `a turn for ${deg}°`);
    assert.ok(Math.abs(turn.straighten) <= 45);
    const after = levelAfter(f, { ...base, ...turn });
    assert.ok(Math.abs(after.slope) < 2 && after.upright, `${deg}°: ${JSON.stringify(turn)} leaves the eyes at ${after.slope.toFixed(1)}°, upright ${after.upright}`);
  }
  // A flipped photo: still level.
  const f = face(500, 400, 25);
  const turn = levelTurn(f, { ...base, flipH: true }, map);
  const after = levelAfter(f, { ...base, flipH: true, ...turn });
  assert.ok(Math.abs(after.slope) < 2 && after.upright);
});

test('a mask covers the face: centered between the eyes and mouth, turned with it, a bit bigger', () => {
  const f = face(500, 400, 15);
  const L = maskLayer(f, 1, W / H);
  assert.ok(Math.abs(L.rot - (15 * Math.PI) / 180) < 1e-6);
  assert.ok(L.x > 0.45 && L.x < 0.55 && L.y > 0.5 && L.y < 0.6, `center ${L.x}, ${L.y}`);
  assert.ok(L.scale >= f.box.w * 1.3, 'bigger than the face');
  // The biggest of several faces; the same face twice counts once.
  const small = face(150, 150, 0, 40);
  assert.equal(mainFace([small, f]), f);
  assert.equal(dedupe([f, { ...f, score: 0.5 }, small]).length, 2);
});
