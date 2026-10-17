import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outputToSource, apply, coverScale, cropForRatio, dragCrop, outputPixelSize, rotateClockwise, flipHorizontal, FULL_CROP } from '../web/tools/editor/geometry.js';
import { defaultState, effectiveParams, createHistory, autoAdjust, normalizeState } from '../web/tools/editor/state.js';
import { hitTest } from '../web/tools/editor/markup.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const corners = (M) => [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => apply(M, u, v).map((n) => Math.round(n * 1e6) / 1e6 + 0));
const g = (o = {}) => ({ rotate: 0, flipH: false, flipV: false, straighten: 0, crop: FULL_CROP, ...o });

test('identity geometry maps output corners to source corners', () => {
  assert.deepEqual(corners(outputToSource(g(), 400, 300)), [[0, 0], [1, 0], [0, 1], [1, 1]]);
});

test('quarter turns: output top-left shows the right source corner', () => {
  // Rotating 90° clockwise puts the source bottom-left at the top-left.
  assert.deepEqual(corners(outputToSource(g({ rotate: 1 }), 400, 300))[0], [0, 1]);
  assert.deepEqual(corners(outputToSource(g({ rotate: 2 }), 400, 300))[0], [1, 1]);
  assert.deepEqual(corners(outputToSource(g({ rotate: 3 }), 400, 300))[0], [1, 0]);
  assert.deepEqual(outputPixelSize(g({ rotate: 1 }), 400, 300), { width: 300, height: 400 });
});

test('flips mirror the source', () => {
  assert.deepEqual(corners(outputToSource(g({ flipH: true }), 400, 300))[0], [1, 0]);
  assert.deepEqual(corners(outputToSource(g({ flipV: true }), 400, 300))[0], [0, 1]);
});

test('crop selects the matching part of the source', () => {
  const M = outputToSource(g({ crop: { x: 0.25, y: 0.5, w: 0.5, h: 0.5 } }), 400, 300);
  assert.deepEqual(corners(M), [[0.25, 0.5], [0.75, 0.5], [0.25, 1], [0.75, 1]]);
  assert.deepEqual(outputPixelSize(g({ crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }), 400, 300), { width: 200, height: 150 });
});

test('straightening zooms just enough that no corner falls outside the photo', () => {
  for (const deg of [-45, -10, -1, 3, 12.5, 30, 45]) {
    for (const [w, h] of [[400, 300], [300, 400], [1000, 1000]]) {
      for (const [u, v] of corners(outputToSource(g({ straighten: deg }), w, h))) {
        assert.ok(u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9, `deg ${deg} ${w}x${h}: ${u},${v}`);
      }
      // ...and is tight: at least one corner touches the edge.
      const pts = corners(outputToSource(g({ straighten: deg }), w, h)).flat();
      assert.ok(pts.some((n) => Math.abs(n) < 1e-6 || Math.abs(n - 1) < 1e-6), `tight at ${deg}`);
    }
  }
  close(coverScale(400, 300, 0), 1, 'no zoom at 0°');
});

test('aspect-ratio crops are the largest centered rectangle', () => {
  assert.deepEqual(cropForRatio(1, 400, 300), { x: 0.125, y: 0, w: 0.75, h: 1 });
  const c = cropForRatio(16 / 9, 400, 300);
  close(c.w, 1, 'full width'); close((c.w * 400) / (c.h * 300), 16 / 9, 'pixel ratio');
});

test('dragging crop handles stays inside the frame and keeps a locked ratio', () => {
  const start = cropForRatio(1, 400, 300);
  const moved = dragCrop(start, 'move', 0.9, 0.9, 1, 400, 300);
  close(moved.x + moved.w, 1, 'clamped right'); close(moved.y + moved.h, 1, 'clamped bottom');
  const shrunk = dragCrop(start, 'se', -0.2, -0.05, 1, 400, 300);
  close((shrunk.w * 400) / (shrunk.h * 300), 1, 'square kept');
  close(shrunk.x, start.x, 'nw corner anchored'); close(shrunk.y, start.y, 'nw corner anchored');
  const free = dragCrop({ ...FULL_CROP }, 'w', 0.3, 0, null, 400, 300);
  assert.deepEqual(free, { x: 0.3, y: 0, w: 0.7, h: 1 });
  const tiny = dragCrop({ ...FULL_CROP }, 'e', -5, 0, null, 400, 300);
  assert.ok(tiny.w >= 0.05, 'minimum size');
});

test('rotating and flipping keep the crop and markup on the same part of the picture', () => {
  const s = { ...defaultState(), crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, markup: [{ type: 'pen', points: [[0.1, 0.2]], color: '#fff', width: 0.01 }, { type: 'text', x: 0.2, y: 0.3, text: 'hi', color: '#fff', size: 0.05 }] };
  // The source point under the crop's top-left must stay the same after the state change.
  const srcOf = (st, u, v) => apply(outputToSource(st, 400, 300), u, v).map((n) => Math.round(n * 1e6) / 1e6);
  for (const next of [rotateClockwise(s), flipHorizontal(s), rotateClockwise(rotateClockwise(flipHorizontal(s)))]) {
    const after = [srcOf(next, 0, 0), srcOf(next, 1, 0), srcOf(next, 0, 1), srcOf(next, 1, 1)].map(String);
    assert.ok(after.includes(String(srcOf(s, 0, 0))) && after.includes(String(srcOf(s, 1, 1))), 'crop corners map to the same source points');
  }
  const r = rotateClockwise(s);
  assert.deepEqual(r.markup[0].points[0].map((n) => Math.round(n * 1e6) / 1e6), [0.8, 0.1]);
  assert.deepEqual([r.markup[1].x, r.markup[1].y].map((n) => Math.round(n * 1e6) / 1e6), [0.7, 0.2]);
  const four = [1, 2, 3, 4].reduce((acc) => rotateClockwise(acc), s);
  assert.deepEqual(four.crop, s.crop); assert.equal(four.rotate, 0);
});

test('filters blend with intensity; history undo/redo; autosave normalization', () => {
  const s = { ...defaultState(), filter: 'mono', filterIntensity: 0.5 };
  const { matrix } = effectiveParams(s);
  close(matrix[0], 0.5 + 0.5 * 0.2126, 'half mono');
  const h = createHistory(defaultState());
  h.push({ ...h.state, straighten: 5 });
  h.push({ ...h.state, straighten: 9 });
  assert.equal(h.state.straighten, 9);
  h.undo(); assert.equal(h.state.straighten, 5);
  h.redo(); assert.equal(h.state.straighten, 9);
  assert.equal(h.push({ ...h.state }), false, 'no-op changes are not undo steps');
  const n = normalizeState({ rotate: 1, adjust: { exposure: 0.5 }, junk: true });
  assert.equal(n.rotate, 1); assert.equal(n.adjust.exposure, 0.5); assert.equal(n.adjust.contrast, 0); assert.ok(!('junk' in n));
});

test('auto adjust brightens a dark image and leaves a balanced one mostly alone', () => {
  const dark = new Uint8Array(400 * 4).map((_, i) => (i % 4 === 3 ? 255 : 30 + (i % 7)));
  assert.ok(autoAdjust(dark).exposure > 0.3);
  const mid = new Uint8Array(256 * 4).map((_, i) => (i % 4 === 3 ? 255 : Math.floor(i / 4)));
  assert.ok(Math.abs(autoAdjust(mid).exposure) < 0.1);
});

test('markup hit testing finds the topmost item near a tap', () => {
  const items = [
    { type: 'rect', x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.4, color: '#f00', width: 0.01 },
    { type: 'pen', points: [[0.5, 0.5], [0.9, 0.5]], color: '#f00', width: 0.01 },
  ];
  assert.equal(hitTest(items, 0.7, 0.505, 1000, 1000, 10), 1);
  assert.equal(hitTest(items, 0.2, 0.2, 1000, 1000, 10), 0);
  assert.equal(hitTest(items, 0.95, 0.95, 1000, 1000, 10), -1);
});
