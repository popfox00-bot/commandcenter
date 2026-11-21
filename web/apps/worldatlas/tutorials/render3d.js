// WorldAtlas Tutorials: a design drawn in 3D (isometric: each block a small cube, its top lit, its sides
// shaded), turned a quarter at a time, up to a chosen layer (so it can be seen built up layer by layer). Slabs,
// carpets and the like are drawn as tall as they are, glass and water see-through. Plain canvas: it works
// offline and needs nothing loaded.

import { BLOCK } from './blocks.js';
import { blockAt } from './tutorials-core.js';

const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
};

/**
 * Draw design `d` on `canvas`: layers 0..`upTo` (the rest left off), turned `rot` quarters, `zoom` times its
 * fitted size; `focus` (a layer) drawn with the layers under it a little dimmed, so it's clear what's being
 * built. Returns the scale used.
 */
export function drawDesign(canvas, d, { upTo = d.h - 1, rot = 0, zoom = 1, focus = null, bg = null } = {}) {
  const ctx = canvas.getContext('2d'); const W = canvas.width; const H = canvas.height;
  ctx.clearRect(0, 0, W, H); if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
  const r = ((rot % 4) + 4) % 4; const sw = r % 2 ? d.l : d.w; const sl = r % 2 ? d.w : d.l;
  // (Turned: a cell of the turned grid → the design's x, z.)
  const src = (X, Z) => (r === 0 ? [X, Z] : r === 1 ? [Z, d.l - 1 - X] : r === 2 ? [d.w - 1 - X, d.l - 1 - Z] : [d.w - 1 - Z, X]);
  const top = Math.max(0, Math.min(d.h - 1, upTo));
  // (Fitted: the whole footprint and height inside the canvas, with a margin.)
  const k = 1.2; // a block's side, over half its top's width
  const spanX = sw + sl; const spanY = (sw + sl) / 2 + (top + 1) * k;
  const s = Math.max(1, Math.min((W * 0.9) / spanX, (H * 0.9) / spanY) * zoom);
  const ox = W / 2 - ((sw - sl) * s) / 2; const oy = H / 2 - (((sw + sl) / 2) * s - (top + 1) * k * s) / 2;
  const P = (X, Z, Y) => [ox + (X - Z) * s, oy + ((X + Z) / 2) * s - Y * k * s];
  const solidAt = (X, Z, Y) => { if (Y > top || X < 0 || Z < 0 || X >= sw || Z >= sl) return false; const [x, z] = src(X, Z); const b = BLOCK[blockAt(d, x, Y, z)]; return !!b && b.h >= 1 && b.alpha >= 1; };
  // (Back to front: by X + Z, then up.)
  for (let sum = 0; sum <= sw + sl - 2; sum++) for (let Y = 0; Y <= top; Y++) for (let X = Math.max(0, sum - sl + 1); X <= Math.min(sw - 1, sum); X++) {
    const Z = sum - X; const [x, z] = src(X, Z); const id = blockAt(d, x, Y, z); if (!id) continue;
    const b = BLOCK[id] ?? { color: '#ff00ff', h: 1, alpha: 1 };
    const dim = focus != null && Y < focus ? 0.62 : 1;
    const hgt = b.h ?? 1; ctx.globalAlpha = b.alpha ?? 1;
    const [ax, ay] = P(X, Z, Y + hgt); const [bx, by] = P(X + 1, Z, Y + hgt); const [cx, cy] = P(X + 1, Z + 1, Y + hgt); const [dx, dy] = P(X, Z + 1, Y + hgt);
    const drop = hgt * k * s;
    // (Its two front sides, unless a solid block hides them; then its top.)
    if (!solidAt(X, Z + 1, Y) || hgt < 1) { ctx.fillStyle = shade(b.color, 0.72 * dim); ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + drop); ctx.lineTo(dx, dy + drop); ctx.closePath(); ctx.fill(); }
    if (!solidAt(X + 1, Z, Y) || hgt < 1) { ctx.fillStyle = shade(b.color, 0.55 * dim); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + drop); ctx.lineTo(bx, by + drop); ctx.closePath(); ctx.fill(); }
    if (!solidAt(X, Z, Y + 1) || hgt < 1) { ctx.fillStyle = shade(b.color, 1 * dim); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy); ctx.closePath(); ctx.fill(); }
    if (s >= 7) { ctx.globalAlpha = 0.18; ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy); ctx.closePath(); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  return s;
}
