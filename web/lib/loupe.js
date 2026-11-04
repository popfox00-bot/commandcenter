// A magnifier that follows the finger: while a finger is down on a photo (tracing, patching, the
// wand, cleaning up), what's under it is shown enlarged in a circle just above it (below it near the
// top edge), with a crosshair at the exact spot and, for a brush or patch, its size. So the spot can
// be seen while the finger covers it; the edit happens when the finger lifts.

/**
 * Draw it on `ctx` (canvas pixels), magnifying `src` (a canvas or image in the same pixels as ctx,
 * often the same canvas) around (x, y). `k`: canvas pixels per screen pixel (so it's the same size on
 * screen at any zoom); `ring`: a brush radius in canvas pixels to show; `color`: the crosshair's.
 */
export function drawLoupe(ctx, src, x, y, { k = 1, radius = 58, zoom = 2.6, ring = 0, color = '#ffd60a', w = ctx.canvas.width, h = ctx.canvas.height } = {}) {
  const R = radius * k; const gap = 34 * k;
  // Above the finger; below it when there's no room above; always on the canvas.
  let cy = y - gap - R;
  if (cy - R < 0) cy = y + gap + R;
  const cx = Math.min(w - R - 2 * k, Math.max(R + 2 * k, x));
  cy = Math.min(h - R - 2 * k, Math.max(R + 2 * k, cy));
  const s = R / zoom;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath();
  ctx.fillStyle = '#000'; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.imageSmoothingEnabled = false;
  try { ctx.drawImage(src, x - s, y - s, s * 2, s * 2, cx - R, cy - R, R * 2, R * 2); } catch { /* nothing to show yet */ }
  ctx.restore();
  // The ring and a shadow, so it stands out on any photo.
  ctx.lineWidth = 3 * k; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(cx, cy, R + 1.5 * k, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2.5 * k; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.5 * k; ctx.strokeStyle = color;
  const c = 9 * k;
  ctx.beginPath(); ctx.moveTo(cx - c, cy); ctx.lineTo(cx - 3 * k, cy); ctx.moveTo(cx + 3 * k, cy); ctx.lineTo(cx + c, cy);
  ctx.moveTo(cx, cy - c); ctx.lineTo(cx, cy - 3 * k); ctx.moveTo(cx, cy + 3 * k); ctx.lineTo(cx, cy + c); ctx.stroke();
  if (ring > 0) { ctx.beginPath(); ctx.arc(cx, cy, Math.min(R - 2 * k, ring * zoom), 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
  return { cx, cy, R };
}
