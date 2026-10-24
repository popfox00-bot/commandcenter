// Draw: the document model (pages, strokes with pressure, shapes, text), undo/redo, and how items
// are drawn (checked against a recording canvas context).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, newDrawing, penWidth, addPoint, bounds, createHistory, normalizeDrawing, drawItem, drawPaper, luminance, isShapeTool } from '../web/tools/draw/draw-core.js';

/** A canvas 2D context that records what it's asked to do. */
function recorder() {
  const calls = []; const state = { globalCompositeOperation: 'source-over', globalAlpha: 1, lineWidth: 1, strokeStyle: '', fillStyle: '' };
  const ctx = new Proxy(state, {
    get(t, k) { if (k in t) return t[k]; if (k === 'canvas') return { width: 100, height: 100 }; return (...args) => calls.push([k, ...args, { op: t.globalCompositeOperation, alpha: t.globalAlpha, width: t.lineWidth, stroke: t.strokeStyle, fill: t.fillStyle }]); },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, calls };
}

test('a new drawing: page sizes, paper, an empty list of items', () => {
  const d = newDrawing({ id: 'a', page: 'landscape', paper: 'grid', now: 5 });
  assert.deepEqual([d.w, d.h, d.paper, d.items.length, d.created], [2048, 1536, 'grid', 0, 5]);
  assert.deepEqual(PAGES.map((p) => p.id), ['square', 'portrait', 'phone', 'landscape']);
  assert.equal(newDrawing({ page: 'nope' }).w, 1536, 'unknown page: portrait');
});

test('pen width follows pressure; points closer than the minimum are dropped', () => {
  assert.ok(penWidth(10, 0.1) < penWidth(10, 0.5) && penWidth(10, 0.5) < penWidth(10, 1));
  assert.equal(penWidth(10, 0.5), 10, 'a finger or mouse (0.5) gives the chosen size');
  const pts = [];
  assert.equal(addPoint(pts, 0, 0, 0.5), true);
  assert.equal(addPoint(pts, 0.5, 0.5, 0.5), false, 'too close');
  assert.equal(addPoint(pts, 10, 0, 0.7), true);
  assert.deepEqual(pts, [0, 0, 0.5, 10, 0, 0.7]);
});

test('bounds of strokes, shapes and text include the line width', () => {
  assert.deepEqual(bounds({ t: 'stroke', tool: 'marker', size: 10, pts: [10, 20, 0.5, 30, 40, 0.5] }), { x0: 2, y0: 12, x1: 38, y1: 48 });
  assert.deepEqual(bounds({ t: 'shape', kind: 'rect', size: 10, x1: 50, y1: 60, x2: 10, y2: 20 }), { x0: 2, y0: 12, x1: 58, y1: 68 });
  const t = bounds({ t: 'text', x: 5, y: 5, text: 'ab\ncd', size: 10 });
  assert.ok(t.x1 > t.x0 && t.y1 - t.y0 === 25);
});

test('undo and redo over item lists', () => {
  const h = createHistory([]);
  h.push([1]); h.push([1, 2]);
  assert.deepEqual(h.items, [1, 2]);
  assert.equal(h.undo(), true); assert.deepEqual(h.items, [1]);
  assert.equal(h.redo(), true); assert.deepEqual(h.items, [1, 2]);
  h.undo(); h.push([1, 3]);
  assert.equal(h.canRedo, false, 'a new change drops the redo steps');
  assert.equal(h.undo() && h.undo() && !h.undo(), true);
});

test('a stored drawing is checked: broken items are dropped, the rest kept', () => {
  const d = normalizeDrawing({ id: 'x', w: 100, h: 100, items: [{ t: 'stroke', pts: [1, 2, 0.5] }, { t: 'stroke', pts: [1, 2] }, { t: 'shape', kind: 'star' }, { t: 'text', text: 'hi' }, null] });
  assert.deepEqual(d.items.map((i) => i.t), ['stroke', 'text']);
  assert.equal(normalizeDrawing({ w: 0, h: 10 }), null);
  assert.equal(normalizeDrawing('nope'), null);
});

test('drawing: the eraser takes ink away; see-through items go through the layer; pen widths vary', () => {
  const { ctx, calls } = recorder();
  drawItem(ctx, { t: 'stroke', tool: 'eraser', color: '#ff0000', size: 20, opacity: 1, pts: [0, 0, 0.5, 10, 10, 0.5, 20, 0, 0.5] });
  assert.ok(calls.some(([k, , , , , , s]) => k === 'stroke' || (s && s.op)), 'stroked');
  assert.equal(calls.find(([k]) => k === 'stroke').at(-1).op, 'destination-out');

  const a = recorder(); const layer = recorder();
  drawItem(a.ctx, { t: 'stroke', tool: 'highlighter', color: '#ffcc00', size: 30, opacity: 0.4, pts: [0, 0, 0.5, 50, 0, 0.5] }, layer.ctx);
  assert.ok(layer.calls.some(([k]) => k === 'stroke'), 'drawn on the layer');
  const put = a.calls.find(([k]) => k === 'drawImage');
  assert.equal(put.at(-1).alpha, 0.4, 'then put down at the item\'s opacity');

  const p = recorder();
  drawItem(p.ctx, { t: 'stroke', tool: 'pen', color: '#111111', size: 10, opacity: 1, pts: [0, 0, 0.1, 10, 0, 0.5, 20, 0, 1, 30, 0, 1] });
  const widths = p.calls.filter(([k]) => k === 'stroke').map((c) => c.at(-1).width);
  assert.ok(widths[0] < widths.at(-1), `pressure: ${widths.join(', ')}`);

  const s = recorder();
  drawItem(s.ctx, { t: 'shape', kind: 'rect', color: '#0a84ff', size: 6, opacity: 1, fill: true, x1: 0, y1: 0, x2: 10, y2: 10 });
  assert.ok(s.calls.some(([k]) => k === 'fill') && !s.calls.some(([k]) => k === 'stroke'), 'a filled box');
  assert.equal(isShapeTool('arrow'), true); assert.equal(isShapeTool('pen'), false);
});

test('paper: guides contrast with the background', () => {
  const { ctx, calls } = recorder();
  drawPaper(ctx, newDrawing({ page: 'square', paper: 'grid', background: '#111111' }));
  assert.equal(calls[0][0], 'fillRect');
  assert.match(calls.find(([k]) => k === 'stroke').at(-1).stroke, /255,255,255/, 'light lines on dark paper');
  assert.ok(luminance('#ffffff') > 0.99 && luminance('#000000') === 0);
});
