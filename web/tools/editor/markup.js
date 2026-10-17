// Markup items, stored in frame coordinates (0..1) so they stay attached to the picture through
// crops, rotations and flips. Sizes are fractions of the frame's shorter side.
//   { type: 'pen' | 'highlighter', points: [[x,y]...], color, width }
//   { type: 'line' | 'arrow' | 'rect' | 'ellipse', x1, y1, x2, y2, color, width }
//   { type: 'text', x, y, text, color, size, box: bool }

export const COLORS = ['#ffffff', '#111111', '#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#af52de'];
export const TEXT_FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

/** Transform helpers for drawing into a target of tw×th pixels showing `crop` of a W×H frame. */
export function viewTransform({ crop, W, H, tw, th }) {
  const k = tw / (crop.w * W); // target px per frame px (same on both axes)
  return {
    toPx: (x, y) => [((x - crop.x) / crop.w) * tw, ((y - crop.y) / crop.h) * th],
    toFrame: (px, py) => [crop.x + (px / tw) * crop.w, crop.y + (py / th) * crop.h],
    unit: Math.min(W, H) * k, // px per "size unit" (fraction of frame short side)
  };
}

function textBoxFrame(item, W, H) {
  // Approximate text extent in frame units (for hit testing without a canvas).
  const s = Math.min(W, H);
  const lines = String(item.text).split('\n');
  const wPx = Math.max(...lines.map((l) => l.length)) * item.size * s * 0.58;
  const hPx = lines.length * item.size * s * 1.25;
  return { x: item.x - wPx / W / 2, y: item.y - hPx / H / 2, w: wPx / W, h: hPx / H };
}

export function drawItem(ctx, item, view) {
  const { toPx, unit } = view;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = Math.max(1, item.width * unit);
  if (item.type === 'pen' || item.type === 'highlighter') {
    if (item.type === 'highlighter') { ctx.globalAlpha = 0.4; ctx.lineCap = 'square'; }
    const pts = item.points.map(([x, y]) => toPx(x, y));
    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2; const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    if (pts.length > 1) ctx.lineTo(...pts[pts.length - 1]);
    ctx.stroke();
  } else if (item.type === 'line' || item.type === 'arrow') {
    const [ax, ay] = toPx(item.x1, item.y1); const [bx, by] = toPx(item.x2, item.y2);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    if (item.type === 'arrow') {
      const ang = Math.atan2(by - ay, bx - ax);
      const len = Math.max(ctx.lineWidth * 3.5, 10);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - len * Math.cos(ang - 0.45), by - len * Math.sin(ang - 0.45));
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - len * Math.cos(ang + 0.45), by - len * Math.sin(ang + 0.45));
      ctx.stroke();
    }
  } else if (item.type === 'rect' || item.type === 'ellipse') {
    const [ax, ay] = toPx(item.x1, item.y1); const [bx, by] = toPx(item.x2, item.y2);
    ctx.beginPath();
    if (item.type === 'rect') ctx.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    else ctx.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (item.type === 'text') {
    const [x, y] = toPx(item.x, item.y);
    const size = Math.max(6, item.size * unit);
    ctx.font = `600 ${size}px ${TEXT_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = String(item.text).split('\n');
    const lh = size * 1.25;
    const top = y - ((lines.length - 1) * lh) / 2;
    if (item.box) {
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 0.8;
      const h = lines.length * lh + size * 0.3;
      ctx.fillStyle = contrastColor(item.color);
      roundRect(ctx, x - w / 2, y - h / 2, w, h, size * 0.25);
      ctx.fill();
      ctx.fillStyle = item.color;
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = size * 0.12;
    }
    lines.forEach((l, i) => ctx.fillText(l, x, top + i * lh));
  }
  ctx.restore();
}

export function drawMarkup(ctx, items, view) {
  for (const it of items) drawItem(ctx, it, view);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Black or white, whichever reads better behind `hex`. */
export function contrastColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return l > 0.6 ? '#111111' : '#ffffff';
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Index of the topmost item near frame point (x, y), or -1. Distances are computed in frame
 * pixels (W×H) so tolerance is uniform; `tol` is in frame pixels.
 */
export function hitTest(items, x, y, W, H, tol) {
  const P = (a, b) => [a * W, b * H];
  const [px, py] = P(x, y);
  const s = Math.min(W, H);
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const t = tol + (it.width ? (it.width * s) / 2 : 0);
    if (it.points) {
      const pts = it.points.map(([a, b]) => P(a, b));
      if (pts.length === 1 && Math.hypot(px - pts[0][0], py - pts[0][1]) <= t) return i;
      for (let j = 1; j < pts.length; j++) if (distToSegment(px, py, ...pts[j - 1], ...pts[j]) <= t) return i;
    } else if (it.type === 'line' || it.type === 'arrow') {
      if (distToSegment(px, py, ...P(it.x1, it.y1), ...P(it.x2, it.y2)) <= t) return i;
    } else if (it.type === 'rect' || it.type === 'ellipse') {
      const [ax, ay] = P(Math.min(it.x1, it.x2), Math.min(it.y1, it.y2));
      const [bx, by] = P(Math.max(it.x1, it.x2), Math.max(it.y1, it.y2));
      if (px >= ax - t && px <= bx + t && py >= ay - t && py <= by + t) return i;
    } else if (it.type === 'text') {
      const b = textBoxFrame(it, W, H);
      const [ax, ay] = P(b.x, b.y);
      if (px >= ax - tol && px <= ax + b.w * W + tol && py >= ay - tol && py <= ay + b.h * H + tol) return i;
    }
  }
  return -1;
}
