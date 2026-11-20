// Fashion's simple engine (web/apps/fashion/engine.js): the warp through matching body points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thinPlate, matchPoints } from '../web/apps/fashion/engine.js';

test('the warp puts each body point on its match and is smooth between: an affine change is reproduced exactly', () => {
  // Points scaled by 1.5 and moved: the warp is that, everywhere.
  const src = [[100, 100], [300, 110], [120, 400], [290, 420], [200, 60], [80, 250], [330, 260]];
  const pairs = src.map(([x, y]) => [[x, y], [x * 1.5 + 20, y * 1.5 - 10]]);
  const f = thinPlate(pairs, 0);
  for (const [x, y] of [[100, 100], [200, 250], [10, 500]]) {
    const [X, Y] = f(x, y);
    assert.ok(Math.abs(X - (x * 1.5 + 20)) < 0.5 && Math.abs(Y - (y * 1.5 - 10)) < 0.5, `at ${x},${y}: ${X.toFixed(1)},${Y.toFixed(1)}`);
  }
  // A bend: one point moved; the warp meets it (nearly: relaxed a little) and changes smoothly around it.
  const bent = pairs.map((p, i) => (i === 4 ? [p[0], [p[1][0] + 30, p[1][1]]] : p));
  const g = thinPlate(bent, 0.01);
  const [bx] = g(200, 60); assert.ok(Math.abs(bx - (200 * 1.5 + 20 + 30)) < 4, `meets the moved point: ${bx.toFixed(1)}`);
  let jump = 0; for (let x = 150; x < 250; x++) jump = Math.max(jump, Math.abs(g(x + 1, 100)[0] - g(x, 100)[0]));
  assert.ok(jump < 3, `smooth: neighbours ${jump.toFixed(2)} px apart at most`);
});

test('the two bodies matched point to point: shoulders, hips, chin, and an arm only where both people\'s are seen', () => {
  const P = (x, y, v = 1) => [x, y, v];
  const base = { pose: { shoulders: [P(100, 200), P(300, 200)], hips: [P(130, 450), P(270, 450)], elbows: [P(80, 320), P(320, 320)], wrists: [P(80, 420), P(320, 420)] }, layout: { fh: 100, chin: 150, face: { x0: 160, x1: 240 } } };
  const piece = { pose: { shoulders: [P(50, 100), P(150, 100)], hips: [P(65, 225), P(135, 225)], elbows: [P(40, 160), P(160, 160, 0.1)], wrists: [P(40, 210), P(160, 210, 0.1)] }, layout: { fh: 50, chin: 75, face: { x0: 80, x1: 120 } } };
  const m = matchPoints(base, piece);
  // 2 shoulders + 2 hips + chin + the left arm's elbow and wrist (the right arm isn't seen on the piece).
  assert.equal(m.length, 7);
  assert.deepEqual(m[4], [[200, 150], [100, 75]], 'the chins');
  assert.equal(matchPoints({ ...base, pose: { ...base.pose, shoulders: [P(1, 1, 0.1), P(2, 2)] } }, piece), null, 'no shoulders: no match');
});
