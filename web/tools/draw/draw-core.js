// Drawing: the document model and its rendering, without any UI, so it can be tested on its own.
// A drawing is a page (size, paper) plus a list of items in page pixels, drawn in order:
//   { t: 'stroke', tool: 'pen' | 'marker' | 'highlighter' | 'eraser', color, size, opacity, pts: [x, y, p, ...] }
//     (p: pen pressure 0..1, 0.5 for a finger or mouse)
//   { t: 'shape', kind: 'line' | 'arrow' | 'rect' | 'ellipse', x1, y1, x2, y2, color, size, opacity, fill }
//   { t: 'text', x, y, text, color, size, opacity }
// Ink goes on its own layer over the paper, so the eraser takes ink away and the paper shows again.

export const PAGES = [
  { id: 'square', label: 'Square', w: 2048, h: 2048 },
  { id: 'portrait', label: 'Portrait', w: 1536, h: 2048 },
  { id: 'phone', label: 'Phone', w: 1152, h: 2048 },
  { id: 'landscape', label: 'Landscape', w: 2048, h: 1536 },
];
export const PAPERS = [
  { id: 'plain', label: 'Plain' },
  { id: 'dots', label: 'Dots' },
  { id: 'grid', label: 'Grid' },
  { id: 'lines', label: 'Lines' },
];
export const TOOLS = [
  { id: 'pen', label: 'Pen', icon: '✒️' },
  { id: 'marker', label: 'Marker', icon: '🖍️' },
  { id: 'highlighter', label: 'Highlighter', icon: '🖊️' },
  { id: 'eraser', label: 'Eraser', icon: '🧽' },
  { id: 'line', label: 'Line', icon: '╱' },
  { id: 'arrow', label: 'Arrow', icon: '↗' },
  { id: 'rect', label: 'Box', icon: '▭' },
  { id: 'ellipse', label: 'Circle', icon: '◯' },
  { id: 'text', label: 'Text', icon: 'T' },
];
export const COLORS = ['#111111', '#ffffff', '#8e8e93', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#5856d6', '#af52de', '#a2845e'];
const SHAPES = new Set(['line', 'arrow', 'rect', 'ellipse']);

export const isShapeTool = (tool) => SHAPES.has(tool);

/** A new, empty drawing. */
export function newDrawing({ id, name = 'Untitled', page = 'portrait', paper = 'plain', background = '#ffffff', now = Date.now() } = {}) {
  const p = PAGES.find((x) => x.id === page) ?? PAGES[1];
  return { v: 1, id, name, w: p.w, h: p.h, paper, background, items: [], created: now, updated: now };
}

/** Width of a pen stroke at pressure p: lighter touch, thinner line (a finger or mouse gives 0.5). */
export const penWidth = (size, p) => size * (0.35 + 1.3 * Math.max(0, Math.min(1, p)));

/** Drop points closer than `min` page pixels to the last kept one (pointer events are dense). */
export function addPoint(pts, x, y, p, min = 1.5) {
  const n = pts.length;
  if (n >= 3 && Math.hypot(x - pts[n - 3], y - pts[n - 2]) < min) return false;
  pts.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100);
  return true;
}

/** Bounding box of an item in page pixels (with its line width), for hit testing and dirty areas. */
export function bounds(item) {
  const pad = (item.size ?? 0) * (item.t === 'stroke' && item.tool === 'pen' ? 1 : 0.6) + 2;
  if (item.t === 'stroke') {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (let i = 0; i < item.pts.length; i += 3) { x0 = Math.min(x0, item.pts[i]); x1 = Math.max(x1, item.pts[i]); y0 = Math.min(y0, item.pts[i + 1]); y1 = Math.max(y1, item.pts[i + 1]); }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }
  if (item.t === 'shape') return { x0: Math.min(item.x1, item.x2) - pad, y0: Math.min(item.y1, item.y2) - pad, x1: Math.max(item.x1, item.x2) + pad, y1: Math.max(item.y1, item.y2) + pad };
  const lines = String(item.text).split('\n');
  const w = Math.max(...lines.map((l) => l.length)) * item.size * 0.6; const h = lines.length * item.size * 1.25;
  return { x0: item.x, y0: item.y, x1: item.x + w, y1: item.y + h };
}

// ---------- rendering ----------

/** The paper: background color plus its guide pattern, on a w×h context. */
export function drawPaper(ctx, d) {
  ctx.fillStyle = d.background;
  ctx.fillRect(0, 0, d.w, d.h);
  const step = Math.round(Math.min(d.w, d.h) / 24);
  const dark = luminance(d.background) < 0.5;
  ctx.fillStyle = ctx.strokeStyle = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,40,0.16)';
  ctx.lineWidth = Math.max(1, step / 32);
  if (d.paper === 'dots') {
    const r = Math.max(1.5, step / 18);
    for (let y = step; y < d.h; y += step) for (let x = step; x < d.w; x += step) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  } else if (d.paper === 'grid' || d.paper === 'lines') {
    ctx.beginPath();
    for (let y = step; y < d.h; y += step) { ctx.moveTo(0, y); ctx.lineTo(d.w, y); }
    if (d.paper === 'grid') for (let x = step; x < d.w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, d.h); }
    ctx.stroke();
  }
}

export function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/**
 * Draw one item onto an ink context. Strokes and shapes with opacity < 1 go through `layer` (a
 * scratch canvas context the size of the page) so overlapping parts of one stroke don't darken.
 */
export function drawItem(ctx, item, layer = null) {
  const alpha = item.opacity ?? 1;
  const needsLayer = alpha < 1 && layer && item.t !== 'text';
  const c = needsLayer ? layer : ctx;
  if (needsLayer) { layer.save(); layer.setTransform(1, 0, 0, 1, 0, 0); layer.clearRect(0, 0, layer.canvas.width, layer.canvas.height); layer.restore(); }
  c.save();
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = c.fillStyle = item.color;
  if (!needsLayer) c.globalAlpha = alpha;
  if (item.t === 'stroke') {
    if (item.tool === 'eraser') { c.globalCompositeOperation = 'destination-out'; c.globalAlpha = 1; c.strokeStyle = c.fillStyle = '#000'; }
    if (item.tool === 'highlighter') c.lineCap = 'square';
    strokePath(c, item);
  } else if (item.t === 'shape') {
    c.lineWidth = item.size;
    const { x1, y1, x2, y2 } = item;
    c.beginPath();
    if (item.kind === 'line' || item.kind === 'arrow') {
      c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      if (item.kind === 'arrow') {
        const a = Math.atan2(y2 - y1, x2 - x1); const len = Math.max(item.size * 4, 18);
        c.beginPath();
        c.moveTo(x2 - len * Math.cos(a - 0.45), y2 - len * Math.sin(a - 0.45)); c.lineTo(x2, y2); c.lineTo(x2 - len * Math.cos(a + 0.45), y2 - len * Math.sin(a + 0.45));
        c.stroke();
      }
    } else {
      if (item.kind === 'rect') c.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      else c.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      if (item.fill) c.fill(); else c.stroke();
    }
  } else if (item.t === 'text') {
    c.font = `600 ${item.size}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
    c.textBaseline = 'top';
    String(item.text).split('\n').forEach((line, i) => c.fillText(line, item.x, item.y + i * item.size * 1.25));
  }
  c.restore();
  if (needsLayer) { ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(layer.canvas, 0, 0); ctx.restore(); }
}

/** A freehand stroke: smoothed through the midpoints; a pen's width follows the pressure. */
function strokePath(c, item) {
  const p = item.pts; const n = p.length / 3;
  if (!n) return;
  const width = (i) => (item.tool === 'pen' ? penWidth(item.size, p[i * 3 + 2]) : item.size);
  if (n === 1) { c.beginPath(); c.arc(p[0], p[1], width(0) / 2, 0, Math.PI * 2); c.fill(); return; }
  if (item.tool !== 'pen') {
    c.lineWidth = item.size;
    c.beginPath(); c.moveTo(p[0], p[1]);
    for (let i = 1; i < n - 1; i++) c.quadraticCurveTo(p[i * 3], p[i * 3 + 1], (p[i * 3] + p[i * 3 + 3]) / 2, (p[i * 3 + 1] + p[i * 3 + 4]) / 2);
    c.lineTo(p[(n - 1) * 3], p[(n - 1) * 3 + 1]);
    c.stroke();
    return;
  }
  // Pen: one curve piece per point, each at its own width (round caps join them smoothly).
  let mx = p[0]; let my = p[1];
  for (let i = 1; i < n; i++) {
    const nx = i < n - 1 ? (p[i * 3] + p[i * 3 + 3]) / 2 : p[i * 3]; const ny = i < n - 1 ? (p[i * 3 + 1] + p[i * 3 + 4]) / 2 : p[i * 3 + 1];
    c.lineWidth = (width(i - 1) + width(i)) / 2;
    c.beginPath(); c.moveTo(mx, my); c.quadraticCurveTo(p[i * 3], p[i * 3 + 1], nx, ny); c.stroke();
    mx = nx; my = ny;
  }
}

/** Draw all of a drawing's ink onto `ctx` (a page-sized context), using `layer` for see-through items. */
export function drawInk(ctx, d, layer) {
  ctx.clearRect(0, 0, d.w, d.h);
  for (const item of d.items) drawItem(ctx, item, layer);
}

// ---------- history ----------

/** Undo/redo over item lists (items are never changed in place, so snapshots are cheap). */
export function createHistory(items = [], limit = 200) {
  let past = []; let present = items; let future = [];
  return {
    get items() { return present; },
    push(next) { past.push(present); if (past.length > limit) past.shift(); present = next; future = []; },
    undo() { if (!past.length) return false; future.push(present); present = past.pop(); return true; },
    redo() { if (!future.length) return false; past.push(present); present = future.pop(); return true; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
}

/** A drawing from storage, checked: unknown or broken items are dropped rather than breaking the page. */
export function normalizeDrawing(d) {
  if (!d || typeof d !== 'object' || !(d.w > 0) || !(d.h > 0)) return null;
  const ok = (it) => it && ((it.t === 'stroke' && Array.isArray(it.pts) && it.pts.length % 3 === 0) || (it.t === 'shape' && SHAPES.has(it.kind)) || (it.t === 'text' && typeof it.text === 'string'));
  return { ...newDrawing({ id: d.id, name: d.name, now: d.created }), ...d, items: Array.isArray(d.items) ? d.items.filter(ok) : [] };
}
