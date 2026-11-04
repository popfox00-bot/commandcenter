// Photo Editor → ➕ Character: a Character (or any transparent image) placed on the photo, moved,
// sized and turned, then painted in as a patch (one undo step, part of every export). Pure helpers.

/** The corners of a placed image (center x, y; width; turn rot, radians; aspect w/h) in picture pixels. */
export function placedCorners({ x, y, width, rot }, aspect) {
  const hw = width / 2; const hh = width / aspect / 2; const c = Math.cos(rot); const s = Math.sin(rot);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]);
}

/** Whether picture point (px, py) is on the placed image's box. */
export function onPlaced(place, aspect, px, py) {
  const c = Math.cos(-place.rot); const s = Math.sin(-place.rot);
  const dx = px - place.x; const dy = py - place.y;
  const u = dx * c - dy * s; const v = dx * s + dy * c;
  return Math.abs(u) <= place.width / 2 && Math.abs(v) <= place.width / aspect / 2;
}

/**
 * The patch pixels ({ x0, y0, pw, ph, rgba }, alpha = coverage) of image `img` (RGBA cw×ch) placed at
 * `place` on a W×H picture: each pixel of the box it covers sampled back from the image (bilinear, alpha
 * premultiplied so its edge stays clean). null when it's all off the picture.
 */
export function placedPatch(img, cw, ch, place, W, H) {
  const cs = placedCorners(place, cw / ch);
  const x0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p[0])))); const x1 = Math.min(W, Math.ceil(Math.max(...cs.map((p) => p[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p[1])))); const y1 = Math.min(H, Math.ceil(Math.max(...cs.map((p) => p[1]))));
  if (x1 <= x0 || y1 <= y0) return null;
  const pw = x1 - x0; const ph = y1 - y0;
  const rgba = new Uint8ClampedArray(pw * ph * 4);
  const k = cw / place.width; const c = Math.cos(-place.rot); const s = Math.sin(-place.rot);
  const px = (X, Y, ch4) => img[(Y * cw + X) * 4 + ch4];
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const dx = x0 + x + 0.5 - place.x; const dy = y0 + y + 0.5 - place.y;
    const u = (dx * c - dy * s) * k + cw / 2 - 0.5; const v = (dx * s + dy * c) * k + ch / 2 - 0.5;
    if (u < -1 || v < -1 || u > cw || v > ch) continue;
    const ua = Math.floor(u); const va = Math.floor(v); const fu = u - ua; const fv = v - va;
    let a = 0; const col = [0, 0, 0];
    for (const [X, Y, wt] of [[ua, va, (1 - fu) * (1 - fv)], [ua + 1, va, fu * (1 - fv)], [ua, va + 1, (1 - fu) * fv], [ua + 1, va + 1, fu * fv]]) {
      if (X < 0 || Y < 0 || X >= cw || Y >= ch || !wt) continue;
      const al = px(X, Y, 3) * wt; a += al;
      for (let q = 0; q < 3; q++) col[q] += px(X, Y, q) * al;
    }
    if (a < 0.5) continue;
    const o = (y * pw + x) * 4;
    rgba[o] = col[0] / a; rgba[o + 1] = col[1] / a; rgba[o + 2] = col[2] / a; rgba[o + 3] = a;
  }
  return { x0, y0, pw, ph, rgba };
}

/** The box of picture pixels a placed image covers, grown by `grow` (a share of its size), clipped to W×H. */
export function placedBox(place, aspect, W, H, grow = 0.2) {
  const cs = placedCorners(place, aspect);
  const xs = cs.map((p) => p[0]); const ys = cs.map((p) => p[1]);
  const gx = (Math.max(...xs) - Math.min(...xs)) * grow; const gy = (Math.max(...ys) - Math.min(...ys)) * grow;
  return { x0: Math.max(0, Math.floor(Math.min(...xs) - gx)), y0: Math.max(0, Math.floor(Math.min(...ys) - gy)), x1: Math.min(W, Math.ceil(Math.max(...xs) + gx)), y1: Math.min(H, Math.ceil(Math.max(...ys) + gy)) };
}
