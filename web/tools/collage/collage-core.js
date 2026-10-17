// Collage math (no DOM): grid layouts, cover-fitting photos into cells, and free layers
// (position, size, rotation) with hit testing for touch.

/** Layouts as rects in the unit square. */
export const LAYOUTS = {
  '2v': { label: '2 side by side', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
  '2h': { label: '2 stacked', cells: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
  '3l': { label: '1 big + 2', cells: [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]] },
  '3t': { label: '1 top + 2', cells: [[0, 0, 1, 0.6], [0, 0.6, 0.5, 0.4], [0.5, 0.6, 0.5, 0.4]] },
  '3c': { label: '3 columns', cells: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
  '4': { label: '2×2', cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  '6': { label: '2×3', cells: [0, 1, 2].flatMap((r) => [0, 1].map((c) => [c / 2, r / 3, 1 / 2, 1 / 3])) },
  '9': { label: '3×3', cells: [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => [c / 3, r / 3, 1 / 3, 1 / 3])) },
};

export const ASPECTS = { '1:1': 1, '4:5': 4 / 5, '3:4': 3 / 4, '9:16': 9 / 16, '16:9': 16 / 9, '4:3': 4 / 3 };

/** Cell rectangles in pixels for a W×H canvas with `gap` px of spacing around and between cells. */
export function cellRects(layoutId, W, H, gap = 0) {
  const { cells } = LAYOUTS[layoutId];
  return cells.map(([x, y, w, h]) => {
    // Every cell edge gets half a gap, outer edges a full gap.
    const l = x * W + (x === 0 ? gap : gap / 2);
    const t = y * H + (y === 0 ? gap : gap / 2);
    const r = (x + w) * W - (x + w >= 1 - 1e-9 ? gap : gap / 2);
    const b = (y + h) * H - (y + h >= 1 - 1e-9 ? gap : gap / 2);
    return { x: l, y: t, w: Math.max(1, r - l), h: Math.max(1, b - t) };
  });
}

/**
 * Where to draw an iw×ih image so it covers `cell`, zoomed by `zoom` (≥1) and shifted by ox, oy
 * in -1..1 (fraction of the hidden overflow; 0 = centered).
 */
export function coverRect(iw, ih, cell, zoom = 1, ox = 0, oy = 0) {
  const s = Math.max(cell.w / iw, cell.h / ih) * Math.max(1, zoom);
  const dw = iw * s; const dh = ih * s;
  const exX = (dw - cell.w) / 2; const exY = (dh - cell.h) / 2;
  const cl = (v) => Math.max(-1, Math.min(1, v));
  return { dx: cell.x - exX - cl(ox) * exX, dy: cell.y - exY - cl(oy) * exY, dw, dh };
}

/** Pan offset change for a finger moved by (mx, my) px inside a cell (inverse of coverRect). */
export function panBy(iw, ih, cell, zoom, ox, oy, mx, my) {
  const s = Math.max(cell.w / iw, cell.h / ih) * Math.max(1, zoom);
  const exX = (iw * s - cell.w) / 2; const exY = (ih * s - cell.h) / 2;
  const cl = (v) => Math.max(-1, Math.min(1, v));
  return { ox: exX > 0.5 ? cl(ox - mx / exX) : 0, oy: exY > 0.5 ? cl(oy - my / exY) : 0 };
}

/** Layer size in px: `scale` is the layer width as a fraction of the canvas width. */
export function layerSize(layer, aspect, W) {
  const w = layer.scale * W;
  return { w, h: w / aspect };
}

/** Is canvas point (px, py) on the layer? (rotated rectangle test) */
export function layerHit(layer, aspect, W, H, px, py, pad = 0) {
  const { w, h } = layerSize(layer, aspect, W);
  const dx = px - layer.x * W; const dy = py - layer.y * H;
  const c = Math.cos(-layer.rot); const s = Math.sin(-layer.rot);
  const lx = dx * c - dy * s; const ly = dx * s + dy * c;
  return Math.abs(lx) <= w / 2 + pad && Math.abs(ly) <= h / 2 + pad;
}

/** Canvas position of the layer's resize/rotate handle (bottom-right corner). */
export function handlePoint(layer, aspect, W, H) {
  const { w, h } = layerSize(layer, aspect, W);
  const c = Math.cos(layer.rot); const s = Math.sin(layer.rot);
  return [layer.x * W + (w / 2) * c - (h / 2) * s, layer.y * H + (w / 2) * s + (h / 2) * c];
}

/**
 * New scale/rotation when the corner handle is dragged to (px, py): the distance from the center
 * sets the size, the angle sets the rotation.
 */
export function dragHandle(layer, aspect, W, H, px, py) {
  const cx = layer.x * W; const cy = layer.y * H;
  const half = Math.hypot(px - cx, py - cy);
  const diagAngle = Math.atan2(1 / aspect, 1); // angle of the corner in the layer's own frame
  const w = (2 * half) / Math.hypot(1, 1 / aspect);
  return { scale: Math.max(0.03, w / W), rot: Math.atan2(py - cy, px - cx) - diagAngle };
}

/** Two-finger gesture: scale and rotation relative to the start of the gesture. */
export function pinchTransform(a0, b0, a1, b1) {
  const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]); const d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
  const r0 = Math.atan2(b0[1] - a0[1], b0[0] - a0[0]); const r1 = Math.atan2(b1[1] - a1[1], b1[0] - a1[0]);
  return { scale: d1 / Math.max(1e-6, d0), rot: r1 - r0, mid: [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2], mid0: [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2] };
}
