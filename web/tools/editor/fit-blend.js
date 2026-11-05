// FaceMask's fitting, the blend: the patch's colors blended into the photo seamlessly, both ways at its border
// (blendIn, with its zone, the smooth difference field and the soft edge). Pure; in place on a patch.

import { featherAlpha } from '../cutout/cutout-core.js';
import { fillPolygon } from '../../lib/geometry.js';
import { membrane } from './cleanup.js';
import { rgbToLab } from '../../lib/color-match.js';

/**
 * The patch's colors blended into the photo (`photo`, RGBA W×H) seamlessly, by `strength` (0–1): at
 * its edge, how the photo just outside differs from the patch just inside (averaged over a few pixels,
 * so texture doesn't count; above, below and each side each its own), spread smoothly across it, so
 * it meets every side of what's around it with no seam while keeping its own detail. Its edge is
 * softened by a couple of pixels too. In place; returns the patch.
 */
export function blendIn(patch, photo, W, H, strength = 0.8, { soft = 2, band = 0, region = null, spread = 0, skin = null } = {}) {
  const { x0, y0, pw, ph, rgba } = patch;
  // Colors first (on its edge as it is), then the soft edge: the rim pixels softening adds have no
  // color of their own, so its own edge colors are carried out to them first.
  if (strength > 0) {
    const reg = region ? fillPolygon(region, x0, y0, pw, ph) : null;
    // With `spread`: the blend goes both ways. The photo's own skin around it (inside that face and
    // just past it: the forehead up to the hairline, the cheeks it doesn't reach) takes on its colors
    // too, easing back to the photo as it is further out, so there's no patch of the old face left
    // standing out; the two meet halfway.
    const zone = region && spread > 0 ? skinZone(rgba, x0, y0, pw, ph, photo, W, H, reg, spread, skin) : null;
    // (Not between its lips where it's see-through: the face's own open mouth shows there as it is.)
    if (zone && patch.open) for (const k of patch.open) zone[k] = 0;
    blendColors(rgba, x0, y0, pw, ph, photo, W, H, strength, band, reg, zone, spread);
  }
  // (An opened mouth's see-through middle stays as see-through as it was: softening would close it up.)
  const open = patch.open ? Uint8ClampedArray.from(patch.open, (k) => rgba[k * 4 + 3]) : null;
  if (soft) { bleed(rgba, pw, ph, soft * 3 + 2); featherAlpha(rgba, pw, ph, soft); }
  if (open) patch.open.forEach((k, j) => { rgba[k * 4 + 3] = Math.min(rgba[k * 4 + 3], open[j]); });
  return patch;
}

/**
 * Where the blend reaches past the Character: the face's own outline, and beyond it any skin of that
 * face (a color like its skin inside the outline: a forehead above where its hairline was found, a
 * temple, the side of a cheek), reached from the Character without crossing anything else, as far as
 * 1.5 × `spread`. 1 there.
 */
function skinZone(rgba, x0, y0, pw, ph, photo, W, H, inside, spread, model = null) {
  const zone = new Uint8Array(pw * ph);
  // Skin: by the face's own skin model (skinModel); without one, a color like the skin inside the outline.
  let isSkin = model?.isSkin;
  if (!isSkin) {
    const sum = [0, 0, 0]; const sq = [0, 0, 0]; let n = 0;
    for (let k = 0; k < pw * ph; k++) {
      if (!inside[k]) continue;
      const X = x0 + (k % pw); const Y = y0 + Math.floor(k / pw); if (X >= W || Y >= H) continue;
      const o = (Y * W + X) * 4; const c = rgbToLab(photo[o], photo[o + 1], photo[o + 2]); n++;
      for (let j = 0; j < 3; j++) { sum[j] += c[j]; sq[j] += c[j] * c[j]; }
    }
    if (!n) { for (let k = 0; k < pw * ph; k++) zone[k] = inside[k]; return zone; }
    const mean = sum.map((v) => v / n); const sd = sq.map((v, j) => Math.max(j ? 2.5 : 7, Math.sqrt(Math.max(0, v / n - mean[j] ** 2))));
    isSkin = (r, g, b) => { const c = rgbToLab(r, g, b); let dl = (c[0] - mean[0]) / sd[0]; if (dl > 0) dl *= 0.5; return Math.hypot(dl, (c[1] - mean[1]) / sd[1], (c[2] - mean[2]) / sd[2]) < 3; };
  }
  const skin = (k) => { const X = x0 + (k % pw); const Y = y0 + Math.floor(k / pw); if (X >= W || Y >= H) return false; const o = (Y * W + X) * 4; return isSkin(photo[o], photo[o + 1], photo[o + 2]); };
  const depth = new Float32Array(pw * ph).fill(Infinity); const q = [];
  // From where it's mostly solid (as blendColors counts it), so its faint outer edge is in the zone too.
  for (let k = 0; k < pw * ph; k++) if (rgba[k * 4 + 3] > 128) { depth[k] = 0; q.push(k); }
  const far = 1.5 * spread;
  for (let h = 0; h < q.length; h++) {
    const k = q[h]; const x = k % pw;
    for (const t of [x > 0 ? k - 1 : -1, x < pw - 1 ? k + 1 : -1, k - pw, k + pw]) {
      if (t < 0 || t >= pw * ph || depth[t] <= depth[k] + 1 || depth[k] + 1 > far) continue;
      if (!inside[t] && !skin(t)) continue;
      depth[t] = depth[k] + 1; zone[t] = 1; q.push(t);
    }
  }
  return zone;
}

/**
 * membrane() for a big area: the difference is smooth anyway, so it's worked out on a coarser grid
 * (each cell: the measured edge in it if any, else free if any of it is, else held at nothing) and
 * spread back smoothly; the measured edge itself kept exactly. In place on `diff`.
 */
function smoothField(diff, free, fixed, pw, ph) {
  const f = Math.ceil(Math.sqrt((pw * ph) / 120000));
  if (f <= 1) return membrane(diff, free, pw, ph);
  const cw = Math.ceil(pw / f); const ch = Math.ceil(ph / f);
  const cd = new Float32Array(cw * ch * 3); const cn = new Float32Array(cw * ch); const cfree = new Uint8Array(cw * ch);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const k = y * pw + x; const c = Math.floor(y / f) * cw + Math.floor(x / f);
    if (fixed[k]) { cn[c]++; for (let j = 0; j < 3; j++) cd[c * 3 + j] += diff[k * 3 + j]; } else if (free[k]) cfree[c] = 1;
  }
  for (let c = 0; c < cw * ch; c++) if (cn[c]) { cfree[c] = 0; for (let j = 0; j < 3; j++) cd[c * 3 + j] /= cn[c]; }
  membrane(cd, cfree, cw, ch);
  for (let y = 0; y < ph; y++) {
    const gy = Math.min(ch - 1, Math.max(0, (y + 0.5) / f - 0.5)); const j0 = Math.min(ch - 2, Math.floor(gy)); const ty = ch > 1 ? gy - j0 : 0;
    for (let x = 0; x < pw; x++) {
      const k = y * pw + x; if (!free[k]) continue;
      const gx = Math.min(cw - 1, Math.max(0, (x + 0.5) / f - 0.5)); const i0 = Math.min(cw - 2, Math.floor(gx)); const tx = cw > 1 ? gx - i0 : 0;
      const a = (j0 * cw + Math.max(0, i0)) * 3; const b = a + (cw > 1 ? 3 : 0); const c = a + (ch > 1 ? cw * 3 : 0); const d = c + (cw > 1 ? 3 : 0);
      for (let j = 0; j < 3; j++) diff[k * 3 + j] = (cd[a + j] * (1 - tx) + cd[b + j] * tx) * (1 - ty) + (cd[c + j] * (1 - tx) + cd[d + j] * tx) * ty;
    }
  }
  return diff;
}

/** The colors of the pixels it covers carried out into the clear pixels around it, `rings` deep (alpha left as it is). */
function bleed(rgba, pw, ph, rings) {
  const has = Uint8Array.from({ length: pw * ph }, (_, i) => (rgba[i * 4 + 3] > 24 ? 1 : 0));
  const seen = Uint8Array.from(has);
  const near = (k) => { const x = k % pw; return [x > 0 ? k - 1 : -1, x < pw - 1 ? k + 1 : -1, k >= pw ? k - pw : -1, k + pw < pw * ph ? k + pw : -1]; };
  // Ring by ring, only the clear pixels next to covered ones (not the whole patch each time).
  let front = [];
  for (let k = 0; k < pw * ph; k++) if (!has[k] && near(k).some((t) => t >= 0 && has[t])) { front.push(k); seen[k] = 1; }
  for (let r = 0; r < rings && front.length; r++) {
    const cols = front.map((k) => {
      const sum = [0, 0, 0]; let n = 0;
      for (const t of near(k)) if (t >= 0 && has[t]) { sum[0] += rgba[t * 4]; sum[1] += rgba[t * 4 + 1]; sum[2] += rgba[t * 4 + 2]; n++; }
      return n ? sum.map((v) => v / n) : null;
    });
    const next = [];
    front.forEach((k, j) => {
      if (!cols[j]) return;
      rgba[k * 4] = cols[j][0]; rgba[k * 4 + 1] = cols[j][1]; rgba[k * 4 + 2] = cols[j][2]; has[k] = 1;
    });
    for (const k of front) if (has[k]) for (const t of near(k)) if (t >= 0 && !seen[t]) { seen[t] = 1; next.push(t); }
    front = next;
  }
}

function blendColors(rgba, x0, y0, pw, ph, photo, W, H, strength, band = 0, region = null, zone = null, spread = 0) {
  // Where it counts as the Character: with a zone, only where it's mostly solid (its faint outer edge
  // is laid over the photo instead, so the edge it's matched along is a clean one).
  const ON = zone ? 128 : 24;
  const on = (x, y) => x >= 0 && y >= 0 && x < pw && y < ph && rgba[(y * pw + x) * 4 + 3] > ON;
  const free = new Uint8Array(pw * ph); const diff = new Float32Array(pw * ph * 3);
  // What its edge is matched to: the photo just outside it; or, with a `region` (the face it replaces),
  // that face's own skin under and around its edge (never the hair or background past the outline).
  const R = region ? 5 : 3;
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    if (!on(x, y)) continue;
    const k = y * pw + x;
    const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
    if (!edge) { free[k] = 1; continue; }
    const out = [0, 0, 0]; const inn = [0, 0, 0]; let no = 0; let ni = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const X = x + dx; const Y = y + dy; const PX = x0 + X; const PY = y0 + Y;
      if (PX < 0 || PY < 0 || PX >= W || PY >= H) continue;
      const mine = on(X, Y);
      if (mine) { const o = (Y * pw + X) * 4; inn[0] += rgba[o]; inn[1] += rgba[o + 1]; inn[2] += rgba[o + 2]; ni++; }
      const ref = region ? X >= 0 && Y >= 0 && X < pw && Y < ph && region[Y * pw + X] > 0 : !mine;
      if (ref) { const o = (PY * W + PX) * 4; out[0] += photo[o]; out[1] += photo[o + 1]; out[2] += photo[o + 2]; no++; }
    }
    if (no && ni) for (let c = 0; c < 3; c++) diff[k * 3 + c] = out[c] / no - inn[c] / ni;
    else free[k] = 1;
  }
  // Past its edge, inside the zone: the difference carried out too (to nothing at the zone's edge).
  const fixed = Uint8Array.from(free, (v, k) => (!v && rgba[k * 4 + 3] > ON ? 1 : 0)); // its edge, where the difference was measured
  if (zone) for (let k = 0; k < pw * ph; k++) if (zone[k] && rgba[k * 4 + 3] <= ON) free[k] = 1;
  smoothField(diff, free, fixed, pw, ph);
  // With a `band`: the blend only near the border, eased out to nothing `band` pixels in (inside it,
  // the Character exactly as it is, recolored).
  let depth = null;
  if (band > 0) {
    depth = new Float32Array(pw * ph).fill(Infinity); const q = [];
    for (let k = 0; k < pw * ph; k++) if (rgba[k * 4 + 3] > ON && !free[k]) { depth[k] = 0; q.push(k); }
    for (let h2 = 0; h2 < q.length; h2++) {
      const k = q[h2]; const x = k % pw;
      for (const t of [x > 0 ? k - 1 : -1, x < pw - 1 ? k + 1 : -1, k - pw, k + pw]) {
        if (t < 0 || t >= pw * ph || !free[t] || rgba[t * 4 + 3] <= ON || depth[t] <= depth[k] + 1) continue;
        depth[t] = depth[k] + 1; q.push(t);
      }
    }
  }
  const share = zone ? 0.5 : 0; // how much of the difference the photo takes on (the rest, the Character)
  for (let i = 0; i < pw * ph; i++) {
    if (!rgba[i * 4 + 3]) continue;
    const k = depth ? Math.max(0, 1 - depth[i] / band) ** 2 : 1;
    if (!k) continue;
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] += strength * (1 - share) * k * diff[i * 3 + c];
  }
  if (!zone) return;
  // The photo around it, in the zone: its own pixels shifted toward the Character's colors (eased out
  // over `spread` from its edge), the Character's soft edge laid over them; all of it now in the patch.
  const out = new Float32Array(pw * ph).fill(Infinity); const q = [];
  for (let k = 0; k < pw * ph; k++) if (rgba[k * 4 + 3] > ON) { out[k] = 0; q.push(k); }
  for (let h2 = 0; h2 < q.length; h2++) {
    const k = q[h2]; const x = k % pw;
    for (const t of [x > 0 ? k - 1 : -1, x < pw - 1 ? k + 1 : -1, k - pw, k + pw]) {
      if (t < 0 || t >= pw * ph || !zone[t] || out[t] <= out[k] + 1) continue;
      out[t] = out[k] + 1; q.push(t);
    }
  }
  for (let i = 0; i < pw * ph; i++) {
    if (!zone[i] || !Number.isFinite(out[i])) continue;
    const X = x0 + (i % pw); const Y = y0 + Math.floor(i / pw); if (X >= W || Y >= H) continue;
    const f = Math.max(0, Math.min(1, (1.5 * spread - out[i]) / (0.5 * spread)));
    const a = rgba[i * 4 + 3] / 255; const o = (Y * W + X) * 4;
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = a * rgba[i * 4 + c] + (1 - a) * (photo[o + c] - strength * share * f * diff[i * 3 + c]);
    rgba[i * 4 + 3] = 255;
  }
}
