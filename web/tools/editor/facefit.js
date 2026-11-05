// FaceMask → 🎭 Insert Character, fitted: a Character that has a face of its own is bent onto the
// face in the photo, not just laid on it. Starting from the eyes, about thirty of its landmarks (jaw
// and chin, brows, nose, eye corners, mouth) are pulled onto the face's own (moving least squares, so
// it bends smoothly and stays itself away from the face); then it's trimmed, softly, to that head's
// outline (so a different hairline, ears or neck don't stick out); and its colors are blended into
// the photo seamlessly: at its edge it takes on what's next to it there (above, below, each side, each
// differently), eased smoothly inward. Pure: RGBA in, patch pixels out.
//
// The steps live in their own modules (fit-place, fit-skin, fit-light, fit-texture, fit-parts, fit-blend);
// this one fits it (fitPatch, with the mouth and 3D turn first: turnedFor) and hands them all on.

import { CONTROL, bestPlacement, mlsMap, realPlacement, rigidPlacement } from './fit-place.js';
import { closeMouth, mouthOpen, openMouth, turnFace } from './face3d.js';
import { convexHull as hull, fillPolygon, scalePolygon as grow, softenMask as soften } from '../../lib/geometry.js';
import { faceContour, faceFrom, faceOutline } from '../../lib/face-core.js';
import { ownMask, ownOutline } from './fit-skin.js';
import { rgbToLab } from '../../lib/color-match.js';

export * from './fit-place.js';
export * from './fit-skin.js';
export * from './fit-light.js';
export * from './fit-texture.js';
export * from './fit-parts.js';
export * from './fit-blend.js';

/**
 * Whether a face's mouth (in the photo, RGBA W×H) is shut: its lips' landmarks close together, and
 * between them nothing that isn't lip (no teeth, no dark open mouth): the inside of the mouth colored like
 * the lips around it.
 */
export function mouthShut(photo, W, H, face) {
  const P = face.pts.map(([u, v]) => [u * W, v * H]);
  if (mouthOpen(P) > 0.14) return false;
  const lab = (x, y) => { const X = Math.round(x); const Y = Math.round(y); if (X < 0 || Y < 0 || X >= W || Y >= H) return null; const o = (Y * W + X) * 4; return rgbToLab(photo[o], photo[o + 1], photo[o + 2]); };
  // The lips' own color: on them, just above and below where they meet.
  const lips = [];
  for (const [u, l, ou, ol] of [[61, 67, 50, 58], [62, 66, 51, 57], [63, 65, 52, 56]]) for (const [a, b] of [[u, ou], [l, ol]]) { const q = lab((P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2); if (q) lips.push(q); }
  if (lips.length < 3) return mouthOpen(P) < 0.05;
  const L = lips.reduce((t, c) => t + c[0], 0) / lips.length; const A = lips.reduce((t, c) => t + c[1], 0) / lips.length;
  // Between the lips (inside 60–67, a little roomier): any teeth (much lighter than the lips, and less red)?
  const inner = grow(P.slice(60, 68), 1.3);
  const xs = inner.map((p) => p[0]); const ys = inner.map((p) => p[1]);
  const bx = Math.floor(Math.min(...xs)); const by = Math.floor(Math.min(...ys));
  const bw = Math.max(1, Math.ceil(Math.max(...xs)) - bx); const bh = Math.max(1, Math.ceil(Math.max(...ys)) - by);
  const m = fillPolygon(inner, bx, by, bw, bh);
  let n = 0; let teeth = 0; let dark = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    if (!m[y * bw + x]) continue; const c = lab(bx + x + 0.5, by + y + 0.5); if (!c) continue; n++;
    if (c[0] > L + 12 && c[1] < A - 6) teeth++;
    if (c[0] < L - 35) dark++;
  }
  if (!n) return mouthOpen(P) < 0.05;
  return teeth / n < 0.08 && !(mouthOpen(P) > 0.09 && dark / n > 0.4);
}

/** The Character made ready for `face`: its mouth closed or opened to match that face's (closeMouth, openMouth), turned in 3D to its pose (turnFace); worked out once per picture and face. */
const turnCache = new WeakMap();
export function turnedFor(img, cw, ch, charFace, face, W, H, photo = null, { turn = true, mouth = true } = {}) {
  let m = turnCache.get(img); if (!m) { m = new WeakMap(); turnCache.set(img, m); }
  const hit = m.get(face); if (hit && hit.charFace === charFace && hit.W === W && hit.H === H && hit.turn === turn && hit.mouth === mouth) return hit.t;
  // Its mouth closed first when that face's is closed (an open smile pasted on a closed mouth gives the
  // game away); opened when that face's is open and its own isn't.
  let src = { rgba: img, w: cw, h: ch, face: charFace }; let changed = false; let opened = false;
  if (mouth && charFace.pts?.length === 68 && face.pts?.length === 68 && photo) {
    const pts = charFace.pts.map(([u, v]) => [u * cw, v * ch]);
    // Or opened, when that face's mouth is open (its teeth showing, or open wide) and the Character's isn't:
    // that face's own open mouth shows between the Character's parted lips.
    const shut = mouthShut(photo, W, H, face); const theirs = mouthOpen(face.pts.map(([u, v]) => [u * W, v * H]));
    const c = shut ? closeMouth(img, cw, ch, pts, 0) : theirs > 0.1 && mouthOpen(pts) < theirs * 0.6 ? openMouth(img, cw, ch, pts, theirs) : null;
    opened = !!c && !shut;
    if (c) {
      const xs = c.pts.map((p) => p[0]); const ys = c.pts.map((p) => p[1]);
      src = { rgba: c.rgba, w: cw, h: ch, face: faceFrom({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }, c.pts, cw, ch, charFace.score ?? 1) };
      changed = true;
    }
  }
  let t = (turn ? turnFace(src.rgba, src.w, src.h, src.face, face, W, H) : null) ?? (changed ? src : null);
  // (Opened: its lips are to go right onto that face's, so that face's open mouth shows between them.)
  if (t && opened) t = { ...t, opened: true };
  m.set(face, { charFace, W, H, t, turn, mouth });
  return t;
}

/**
 * The Character (RGBA cw×ch, with its own face `charFace`) fitted onto `face` in a W×H picture:
 * placed by its eyes first (alignOnFace), then bent so its landmarks meet the face's, and (with
 * `trim`) faded out softly beyond that head's outline. Returns the patch { x0, y0, pw, ph, rgba } in
 * the picture's pixels (alpha = coverage), or null when it's off the picture.
 */
export function fitPatch(img, cw, ch, charFace, face, W, H, { trim = true, outline = null, bend = 0.35, own = true, real = true, turn = real, turn3d = true, mouth = true, photo = null, tune = null, paint = null, keepShape = false } = {}) {
  // Turned in 3D first (face3d.js) to the pose of the face it goes on, when they're posed differently.
  let turned = false; let opened = false;
  // (`turn3d`: in 3D to its pose; `mouth`: its mouth closed or opened to match. Either can be left out.)
  if (turn && (turn3d || mouth)) { const t = turnedFor(img, cw, ch, charFace, face, W, H, photo, { turn: turn3d, mouth }); if (t) { ({ rgba: img, w: cw, h: ch, face: charFace } = t); turned = true; opened = !!t.opened; } }
  // Realistic (the default): placed by its inner features and sized for a natural face (realPlacement),
  // and bent only along its jaw (toward that face's), its eyes, nose and mouth left as they are.
  const usePts = charFace.pts?.length === 68 && face.pts?.length === 68;
  const real2 = real && usePts;
  // (`keepShape`: its own shape kept: placed as one piece by its features (eyes, nose, mouth as they are,
  // never bent, narrowed or stretched); still trimmed softly along that face's outline.)
  const base = keepShape && usePts ? rigidPlacement(charFace, cw, ch, face, W, H)
    : real2 ? realPlacement(charFace, cw, ch, face, W, H, { outline, own: ownOutline(img, cw, ch, charFace), turned }) : bestPlacement(charFace, cw, ch, face, W, H);
  if (keepShape) bend = 0;
  // Where the Character's edges go when just placed by the eyes: anchors that keep it steady far from the face.
  const anchorsSrc = [[0, 0], [cw / 2, 0], [cw, 0], [cw, ch / 2], [cw, ch], [cw / 2, ch], [0, ch], [0, ch / 2]];
  // (squash: narrowed across, for a face turned away.)
  const k = base.width / cw; const co = Math.cos(base.rot); const si = Math.sin(base.rot);
  // (Realistic placement gives its whole map, `affine`: narrowed and slanted for a turned head.)
  let A = base.affine ?? (() => { const kx = k * (base.squash ?? 1); return [kx * co, -k * si, base.x - (cw / 2) * kx * co + (ch / 2) * k * si, kx * si, k * co, base.y - (cw / 2) * kx * si - (ch / 2) * k * co]; })();
  // Fine-tuned by hand after the fit (`tune`: { scale, rot, dx, dy } about the face's middle, in photo
  // pixels; soft, the edge's softness 0..100): on top of the fit, which stays.
  if (tune && (tune.scale !== 1 || tune.rot || tune.dx || tune.dy)) {
    const c = [(face.box.x + face.box.w / 2) * W, (face.box.y + face.box.h / 2) * H];
    const sc = tune.scale ?? 1; const tc = Math.cos(tune.rot ?? 0) * sc; const ts = Math.sin(tune.rot ?? 0) * sc;
    const M = [tc, -ts, c[0] + (tune.dx ?? 0) - tc * c[0] + ts * c[1], ts, tc, c[1] + (tune.dy ?? 0) - ts * c[0] - tc * c[1]];
    A = [M[0] * A[0] + M[1] * A[3], M[0] * A[1] + M[1] * A[4], M[0] * A[2] + M[1] * A[5] + M[2], M[3] * A[0] + M[4] * A[3], M[3] * A[1] + M[4] * A[4], M[3] * A[2] + M[4] * A[5] + M[5]];
  }
  const det = A[0] * A[4] - A[1] * A[3];
  const place = ([x, y]) => [A[0] * x + A[1] * y + A[2], A[3] * x + A[4] * y + A[5]];
  // (Realistic: each jaw point pulled toward that face's only a little way, never far: a turned head's
  // near-side jaw would otherwise squeeze its cheek and eye against its pinned features.)
  const jawW = usePts ? Math.hypot((face.pts[16][0] - face.pts[0][0]) * W, (face.pts[16][1] - face.pts[0][1]) * H) : 0;
  const near = (p, q, r) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); return d <= r ? q : [p[0] + ((q[0] - p[0]) * r) / d, p[1] + ((q[1] - p[1]) * r) / d]; };
  const tgt = real2 ? CONTROL.map((i) => { const own2 = place([charFace.pts[i][0] * cw, charFace.pts[i][1] * ch]); return i <= 16 ? near(own2, [face.pts[i][0] * W, face.pts[i][1] * H], 0.06 * jawW) : own2; })
    : usePts ? CONTROL.map((i) => [face.pts[i][0] * W, face.pts[i][1] * H]) : [face.eyes[0], face.eyes[1], face.mouth].map(([u, v]) => [u * W, v * H]);
  const src = usePts ? CONTROL.map((i) => [charFace.pts[i][0] * cw, charFace.pts[i][1] * ch]) : [charFace.eyes[0], charFace.eyes[1], charFace.mouth].map(([u, v]) => [u * cw, v * ch]);
  // Its mouth opened for that face's open one: its lips right onto that face's lips (all of the way there,
  // easing back to the light bend around it), so that face's teeth show between them.
  let mouthAt = null;
  if (opened && real2 && !keepShape) {
    const LIPS = [48, 51, 54, 57, 60, 62, 64, 66];
    CONTROL.forEach((i, j) => { if (i >= 48) tgt[j] = [face.pts[i][0] * W, face.pts[i][1] * H]; });
    for (const i of LIPS) if (!CONTROL.includes(i)) { tgt.push([face.pts[i][0] * W, face.pts[i][1] * H]); src.push([charFace.pts[i][0] * cw, charFace.pts[i][1] * ch]); }
    const m = face.pts.slice(48, 60).map(([u, v]) => [u * W, v * H]);
    mouthAt = { c: [m.reduce((t, p) => t + p[0], 0) / 12, m.reduce((t, p) => t + p[1], 0) / 12], r: 1.1 * Math.hypot(m[6][0] - m[0][0], m[6][1] - m[0][1]) };
  }
  // Picture point → Character point (the inverse direction, for sampling): mostly the plain placement
  // (its face kept as it is: eyes, nose and mouth in their own proportions), bent only by `bend` of
  // the way toward meeting the face's landmarks (so its outline follows the new face's jaw).
  const mls = mlsMap([...tgt, ...anchorsSrc.map(place)], [...src, ...anchorsSrc]);
  const unplace = (x, y) => { const dx = x - A[2]; const dy = y - A[5]; return [(A[4] * dx - A[1] * dy) / det, (-A[3] * dx + A[0] * dy) / det]; };
  const bendAt = (x, y) => { if (!mouthAt) return bend; const d = Math.hypot(x - mouthAt.c[0], y - mouthAt.c[1]) / mouthAt.r; return bend + (1 - bend) * Math.max(0, 1 - d) ** 2; };
  const map = (x, y) => { const r = unplace(x, y); const b = bendAt(x, y); if (b <= 0) return r; const q = mls(x, y); return [r[0] + b * (q[0] - r[0]), r[1] + b * (q[1] - r[1])]; };
  const cs = [[0, 0], [cw, 0], [cw, ch], [0, ch]].map(place);
  const pad = base.width * 0.06;
  // Room for the whole face it goes on too (its outline and a little past it), so the blend can reach
  // the parts of it the Character doesn't cover.
  const pts = outline ? [...cs, ...outline] : cs;
  const ow = outline ? Math.max(...outline.map((p) => p[0])) - Math.min(...outline.map((p) => p[0])) : 0;
  const pad2 = Math.max(pad, ow * 0.4);
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])) - pad2)); const x1 = Math.min(W, Math.ceil(Math.max(...pts.map((p) => p[0])) + pad2));
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])) - pad2)); const y1 = Math.min(H, Math.ceil(Math.max(...pts.map((p) => p[1])) + pad2));
  if (x1 <= x0 || y1 <= y0) return null;
  const pw = x1 - x0; const ph = y1 - y0;
  // The map on a coarse grid (every 4 px), smoothly in between: quick, and it bends gently anyway.
  const G = 4; const gw = Math.ceil(pw / G) + 1; const gh = Math.ceil(ph / G) + 1;
  const grid = new Float32Array(gw * gh * 2);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const q = map(x0 + i * G + 0.5, y0 + j * G + 0.5); grid[(j * gw + i) * 2] = q[0]; grid[(j * gw + i) * 2 + 1] = q[1]; }
  // Only the Character's own face (its jaw and up to its own hairline), not the border of hair or
  // background kept around it: that never lands inside the face it goes on.
  const keep = own && charFace.pts?.length === 68 ? ownMask(img, cw, ch, charFace) : null;
  const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < ph; y++) {
    const gy = y / G; const j0 = Math.min(gh - 2, Math.floor(gy)); const ty = gy - j0;
    for (let x = 0; x < pw; x++) {
      const gx = x / G; const i0 = Math.min(gw - 2, Math.floor(gx)); const tx = gx - i0;
      const g = (ii, jj, c) => grid[((j0 + jj) * gw + i0 + ii) * 2 + c];
      const u = (g(0, 0, 0) * (1 - tx) + g(1, 0, 0) * tx) * (1 - ty) + (g(0, 1, 0) * (1 - tx) + g(1, 1, 0) * tx) * ty - 0.5;
      const v = (g(0, 0, 1) * (1 - tx) + g(1, 0, 1) * tx) * (1 - ty) + (g(0, 1, 1) * (1 - tx) + g(1, 1, 1) * tx) * ty - 0.5;
      if (u < -1 || v < -1 || u > cw || v > ch) continue;
      const ua = Math.floor(u); const va = Math.floor(v); const fu = u - ua; const fv = v - va;
      let a = 0; const col = [0, 0, 0];
      for (const [X, Y, wt] of [[ua, va, (1 - fu) * (1 - fv)], [ua + 1, va, fu * (1 - fv)], [ua, va + 1, (1 - fu) * fv], [ua + 1, va + 1, fu * fv]]) {
        if (X < 0 || Y < 0 || X >= cw || Y >= ch || !wt) continue;
        const o = (Y * cw + X) * 4; const al = img[o + 3] * wt * (keep ? keep[Y * cw + X] : 1); a += al;
        col[0] += img[o] * al; col[1] += img[o + 1] * al; col[2] += img[o + 2] * al;
      }
      if (a < 0.5) continue;
      const o = (y * pw + x) * 4;
      rgba[o] = col[0] / a; rgba[o + 1] = col[1] / a; rgba[o + 2] = col[2] / a; rgba[o + 3] = a;
    }
  }
  // (Before the trim, how much of it there is everywhere: what the brush can bring back.)
  const reach = paint?.length ? Uint8ClampedArray.from({ length: pw * ph }, (_, k) => rgba[k * 4 + 3]) : null;
  if (trim) {
    // The face's own outline in the photo (jaw and forehead; or the head's oval when its landmarks
    // don't make one), a touch roomier, its edge a soft ramp: nothing of the Character beyond it.
    const contour = outline ?? faceContour(face, W, H);
    const out = contour ?? faceOutline(face, W, H, 64).map(([u, v]) => [u * W, v * H]);
    const roomy = grow(out, outline ? 1 : contour ? 1.03 : 1.12);
    const headH = Math.max(...out.map((p) => p[1])) - Math.min(...out.map((p) => p[1]));
    // The soft edge kept inside the outline (it fades to nothing at it, not past it onto what's around).
    // A wide one, so it fades into the face rather than ending at a line.
    const r = Math.max(2, Math.round(headH * 0.055 * (0.4 + 1.2 * ((tune?.soft ?? 50) / 100))));
    const m = soften(fillPolygon(roomy, x0, y0, pw, ph), pw, ph, r);
    // Never thin over that face's own features (its eyes, brows, nose and mouth, with room around them):
    // on a turned head they come close to its outline, and they'd show through the soft edge.
    if (face.pts?.length === 68) {
      const feat = grow(hull(face.pts.slice(17).map(([u, v]) => [u * W, v * H])), 1.18);
      // (Inside the outline, just: never out past that face's edge onto what's around it.)
      const inside = soften(fillPolygon(roomy, x0, y0, pw, ph), pw, ph, Math.max(2, Math.round(r * 1.5)));
      // (Its edge as soft as the trim's own, so the Character doesn't step from thin to solid along it.)
      const f = soften(fillPolygon(feat, x0, y0, pw, ph), pw, ph, Math.max(2, Math.round(r * 1.5)));
      for (let i = 0; i < m.length; i++) m[i] = Math.max(m[i], f[i] * Math.min(1, inside[i] * 1.4));
    }
    for (let i = 0; i < pw * ph; i++) rgba[i * 4 + 3] *= Math.max(0, Math.min(1, (m[i] - 0.5) * 2.2));
  }
  // Painted by hand (`paint`: strokes { pts: [[x, y]…] photo px, r, add }): more of it where it was
  // trimmed away (as much as there is of it there), or less of it (the photo showing), soft-edged.
  if (reach) for (const st of paint) paintStroke(rgba, reach, x0, y0, pw, ph, st);
  // (Where its landmarks went, for relight: as placed, before the light bend.)
  const charPts = charFace.pts?.length === 68 ? charFace.pts.map(([u, v]) => place([u * cw, v * ch])) : null;
  // (Its mouth opened: where it's see-through between its lips, now on that face's open mouth: `open`, kept so by the blend.)
  let open = null;
  if (mouthAt) {
    const lips = fillPolygon(grow(face.pts.slice(60, 68).map(([u, v]) => [u * W, v * H]), 1.3), x0, y0, pw, ph);
    open = []; for (let k = 0; k < pw * ph; k++) if (lips[k] && rgba[k * 4 + 3] < 230) open.push(k);
  }
  return { x0, y0, pw, ph, rgba, charPts, open };
}

/** One brush stroke on the patch's alpha (see fitPatch's `paint`): within r of its line, eased out over the outer half. */
function paintStroke(rgba, reach, x0, y0, pw, ph, { pts, r, add }) {
  if (!pts?.length || !(r > 0)) return;
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const bx0 = Math.max(0, Math.floor(Math.min(...xs) - r - x0)); const bx1 = Math.min(pw, Math.ceil(Math.max(...xs) + r - x0));
  const by0 = Math.max(0, Math.floor(Math.min(...ys) - r - y0)); const by1 = Math.min(ph, Math.ceil(Math.max(...ys) + r - y0));
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
    const px = x0 + x + 0.5; const py = y0 + y + 0.5; let d = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]; const b = pts[Math.min(pts.length - 1, i + 1)];
      const vx = b[0] - a[0]; const vy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy || 1)));
      d = Math.min(d, Math.hypot(px - a[0] - t * vx, py - a[1] - t * vy));
    }
    const cov = Math.max(0, Math.min(1, (r - d) / (r * 0.5)));
    if (!cov) continue;
    const k = y * pw + x;
    rgba[k * 4 + 3] = add ? Math.max(rgba[k * 4 + 3], cov * reach[k]) : rgba[k * 4 + 3] * (1 - cov);
  }
}
