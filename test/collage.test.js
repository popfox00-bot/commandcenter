import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUTS, cellRects, coverRect, panBy, layerHit, handlePoint, dragHandle, pinchTransform } from '../web/tools/collage/collage-core.js';

const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

test('every layout tiles the unit square exactly', () => {
  for (const [id, { cells }] of Object.entries(LAYOUTS)) {
    const area = cells.reduce((s, [, , w, h]) => s + w * h, 0);
    close(area, 1, id);
  }
});

test('cell spacing: equal outer margins and inner gaps', () => {
  const r = cellRects('2v', 1000, 500, 20);
  assert.deepEqual(r[0], { x: 20, y: 20, w: 470, h: 460 });
  assert.deepEqual(r[1], { x: 510, y: 20, w: 470, h: 460 });
});

test('cover fit fills the cell; panning moves within the overflow only', () => {
  const cell = { x: 0, y: 0, w: 100, h: 100 };
  const c = coverRect(400, 200, cell); // wide photo in a square cell
  assert.deepEqual([c.dw, c.dh], [200, 100]);
  close(c.dx, -50, 'centered');
  close(coverRect(400, 200, cell, 1, 1, 0).dx, -100, 'panned to show the left... right edge');
  close(coverRect(400, 200, cell, 1, -1, 0).dx, 0, 'panned fully the other way');
  const p = panBy(400, 200, cell, 1, 0, 0, 25, 0);
  close(p.ox, -0.5, 'dragging right reveals the left side');
  assert.equal(panBy(400, 200, cell, 1, 0, 0, 0, 40).oy, 0, 'no vertical overflow, no vertical pan');
});

test('layers: hit test respects rotation, and the corner handle drives size and angle', () => {
  const layer = { x: 0.5, y: 0.5, scale: 0.4, rot: 0 };
  const aspect = 2; // 400x200 on a 1000x1000 canvas
  assert.ok(layerHit(layer, aspect, 1000, 1000, 690, 590));
  assert.ok(!layerHit(layer, aspect, 1000, 1000, 500, 650));
  const rotated = { ...layer, rot: Math.PI / 2 };
  assert.ok(layerHit(rotated, aspect, 1000, 1000, 500, 650), 'now tall');
  const [hx, hy] = handlePoint(layer, aspect, 1000, 1000);
  close(hx, 700, 'handle x'); close(hy, 600, 'handle y');
  const same = dragHandle(layer, aspect, 1000, 1000, hx, hy);
  close(same.scale, 0.4, 'no change in size'); close(same.rot, 0, 'no rotation');
  const bigger = dragHandle(layer, aspect, 1000, 1000, 500 + 400, 500 + 200);
  close(bigger.scale, 0.8, 'double size');
});

test('pinch reports scale and rotation', () => {
  const t = pinchTransform([0, 0], [100, 0], [0, 0], [0, 200]);
  close(t.scale, 2, 'scale'); close(t.rot, Math.PI / 2, 'rotation');
});
