// FaceMask's 3D turn (web/tools/editor/face3d.js): how a face is posed, found from its landmarks by
// the generic head, and a Character turned to another face's pose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE, fitPose, triangulate, turnFace, symmetrize } from '../web/tools/editor/face3d.js';

/** The generic head posed (yaw, pitch, roll) and seen at scale s around (tx, ty): its 68 landmarks in pixels. */
function posed(yaw, pitch, roll, s = 100, tx = 200, ty = 200) {
  const cy = Math.cos(yaw); const sy = Math.sin(yaw); const cx = Math.cos(pitch); const sx = Math.sin(pitch); const cr = Math.cos(roll); const sr = Math.sin(roll);
  return TEMPLATE.map(([x, y, d]) => {
    let X = x; let Y = y; let Z = -d;
    [Y, Z] = [Y * cx - Z * sx, Y * sx + Z * cx]; // pitch (about x)
    [X, Z] = [X * cy + Z * sy, -X * sy + Z * cy]; // yaw (about y)
    [X, Y] = [X * cr - Y * sr, X * sr + Y * cr]; // roll (about z)
    return [tx + s * X, ty + s * Y];
  });
}

test('a face\'s pose from its landmarks: turned, nodded and tilted as far as it was', () => {
  for (const [yaw, pitch, roll] of [[0, 0, 0], [0.4, 0, 0], [-0.5, 0.15, 0.2], [0.25, -0.2, -0.3]]) {
    const p = fitPose(posed(yaw, pitch, roll, 120, 300, 260));
    assert.ok(Math.abs(p.yaw - yaw) < 0.03 && Math.abs(p.pitch - pitch) < 0.03 && Math.abs(p.roll - roll) < 0.03, `${[yaw, pitch, roll]} → ${[p.yaw, p.pitch, p.roll].map((v) => v.toFixed(3))}`);
    assert.ok(Math.abs(p.s - 120) < 2, `its scale: ${p.s}`);
  }
});

test('triangles over points: every point used, none overlapping (areas add up to the hull)', () => {
  const pts = [[0, 0], [10, 0], [10, 10], [0, 10], [5, 5], [2, 7]];
  const t = triangulate(pts);
  assert.equal(t.length, 2 * pts.length - 2 - 4); // 2n − 2 − hull points
  const area = t.reduce((a, [i, j, k]) => a + Math.abs((pts[j][0] - pts[i][0]) * (pts[k][1] - pts[i][1]) - (pts[k][0] - pts[i][0]) * (pts[j][1] - pts[i][1])) / 2, 0);
  assert.ok(Math.abs(area - 100) < 1e-6);
});

test('a Character seen straight on, turned to a face turned away: its landmarks land as that face\'s would (up to size and place), its nose over the far cheek', () => {
  const cw = 400; const ch = 400;
  // The Character: straight on, its pixels a gradient (so where each comes from can be read).
  const cp = posed(0, 0, 0, 100, 200, 170);
  const charFace = { pts: cp.map(([x, y]) => [x / cw, y / ch]), score: 1 };
  const img = new Uint8ClampedArray(cw * ch * 4); for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) img.set([x * 0.6, y * 0.6, 0, 255], (y * cw + x) * 4);
  const tp = posed(0.45, 0, 0, 100, 500, 300);
  const face = { pts: tp.map(([x, y]) => [x / 1000, y / 600]) };
  const r = turnFace(img, cw, ch, charFace, face, 1000, 600, { yawGain: 1 });
  assert.ok(r && Math.abs(r.yaw - 0.45) < 0.05, `turned by ${r?.yaw}`);
  // Its landmarks now as that face's: compared after removing place and size.
  const P = r.face.pts.map(([u, v]) => [u * r.w, v * r.h]);
  const norm = (pts) => { const c = [0, 1].map((k) => pts.reduce((a, p) => a + p[k], 0) / pts.length); const s = Math.sqrt(pts.reduce((a, p) => a + (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2, 0) / pts.length); return pts.map(([x, y]) => [(x - c[0]) / s, (y - c[1]) / s]); };
  const a = norm(P); const b = norm(tp);
  const err = Math.sqrt(a.reduce((t, p, i) => t + (p[0] - b[i][0]) ** 2 + (p[1] - b[i][1]) ** 2, 0) / a.length);
  assert.ok(err < 0.02, `its landmarks where a turned face has them: ${err.toFixed(4)}`);
  // The nose tip shows the Character's own nose tip (read back from the gradient).
  const [nx, ny] = P[30]; const o = (Math.round(ny) * r.w + Math.round(nx)) * 4;
  assert.ok(Math.abs(r.rgba[o] / 0.6 - cp[30][0]) < 4 && Math.abs(r.rgba[o + 1] / 0.6 - cp[30][1]) < 4, `its nose: ${r.rgba[o] / 0.6}, ${r.rgba[o + 1] / 0.6} (was ${cp[30]})`);
  // Posed alike already: left as it is.
  assert.equal(turnFace(img, cw, ch, charFace, { pts: posed(0.02, 0, 0.3, 80, 500, 300).map(([x, y]) => [x / 1000, y / 600]) }, 1000, 600), null);
});

test('made symmetric where it was seen least: the far side taken from the near side, flipped across the middle line; its landmarks moved to match', () => {
  const w = 200; const h = 200;
  const pts = posed(0, 0, 0, 50, 100, 90);
  // Near side (left of the nose) red, far side blue.
  const img = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.set(x < 100 ? [220, 30, 30, 255] : [30, 30, 220, 255], (y * w + x) * 4);
  const far = pts.map((p) => p.slice()); far[45] = [far[45][0] + 8, far[45][1]]; // its far eye corner a little off
  const r = symmetrize(img, w, h, far, true, 0.8);
  const at = (x, y) => [...r.rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];
  assert.ok(at(150, 100)[0] > 150 && at(150, 100)[2] < 90, `the far side now mostly the near side's: ${at(150, 100)}`);
  assert.deepEqual(at(50, 100), [220, 30, 30], 'the near side as it was');
  assert.ok(at(101, 100)[2] > 200, `at the middle line, as it was: ${at(101, 100)}`);
  // The far eye corner moved most of the way to the near one's mirror image.
  const mirror = 2 * 100 - pts[36][0];
  assert.ok(Math.abs(r.pts[45][0] - mirror) < 3, `far eye corner at ${r.pts[45][0].toFixed(1)} (mirror ${mirror})`);
});

test('a Character seen turned, put on a face turned the other way: its barely-seen side drawn from its well-seen side', () => {
  const cw = 400; const ch = 400;
  const cp = posed(0.45, 0, 0, 100, 200, 170);
  const charFace = { pts: cp.map(([x, y]) => [x / cw, y / ch]), score: 1 };
  // Which side it shows more of (the near side): the jaw end farther from its nose tip.
  const nearLeft = Math.hypot(cp[30][0] - cp[0][0], cp[30][1] - cp[0][1]) > Math.hypot(cp[30][0] - cp[16][0], cp[30][1] - cp[16][1]);
  const nose = cp[30][0];
  const img = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) img.set(((x < nose) === nearLeft) ? [220, 30, 30, 255] : [30, 30, 220, 255], (y * cw + x) * 4);
  const face = { pts: posed(-0.35, 0, 0, 100, 500, 300).map(([x, y]) => [x / 1000, y / 600]) };
  const plain = turnFace(img, cw, ch, charFace, face, 1000, 600, { symmetric: false });
  const sym = turnFace(img, cw, ch, charFace, face, 1000, 600);
  // On its far cheek (between its far eye's outer corner and the far side of its jaw): red now, from the near side.
  const farCheek = (r) => { const P = r.face.pts.map(([u, v]) => [u * r.w, v * r.h]); const i = nearLeft ? [45, 13] : [36, 3]; const x = Math.round((P[i[0]][0] + P[i[1]][0]) / 2); const y = Math.round((P[i[0]][1] + P[i[1]][1]) / 2); const o = (y * r.w + x) * 4; return [r.rgba[o], r.rgba[o + 2]]; };
  const [pr, pb] = farCheek(plain); const [sr, sb] = farCheek(sym);
  assert.ok(pb > pr, `without it: the squeezed far side, stretched (${pr},${pb})`);
  assert.ok(sr > sb, `with it: drawn from the near side (${sr},${sb})`);
});
