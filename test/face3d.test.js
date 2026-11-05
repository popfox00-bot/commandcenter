// FaceMask's 3D turn (web/tools/editor/face3d.js): how a face is posed, found from its landmarks by
// the generic head, and a Character turned to another face's pose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE, fitPose, triangulate, turnFace } from '../web/tools/editor/face3d.js';

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
