// FaceMask → a Character turned in 3D to the pose of the face it goes on. A generic head (the 68
// landmarks of an average face, each with its depth: the nose forward, the eye corners and jaw back)
// is fitted to each face's landmarks to find how it's posed (turned left/right, up/down, tilted); the
// Character's own face, given that depth, is then turned by the difference (left/right and up/down;
// tilt is left to the placement) and drawn again triangle by triangle over a mesh of its landmarks,
// nearest last, so its nose covers the far cheek as it would. Pure: RGBA in, RGBA out.

import { faceFrom } from '../../lib/face-core.js';
import { rgbToLab } from '../../lib/color-match.js';
import { MESH68 } from '../../lib/face-mesh.js';
import { inPolygon, edgeDistance } from '../../lib/geometry.js';

/** The generic face, frontal: [x, y, depth] (x right, y down, depth toward the camera; the jaw 2 wide). */
export const TEMPLATE = (() => {
  const p = [];
  const jawDepth = [-1.1, -1.0, -0.84, -0.66, -0.48, -0.3, -0.14, 0, 0.06, 0, -0.14, -0.3, -0.48, -0.66, -0.84, -1.0, -1.1];
  for (let i = 0; i <= 16; i++) { const t = (Math.PI * i) / 16; p.push([-Math.cos(t), 0.1 + 1.15 * Math.sin(t), jawDepth[i]]); }
  const browD = [-0.24, -0.1, 0, 0.04, 0.06];
  for (let i = 0; i < 5; i++) { const t = i / 4; p.push([-0.78 + 0.6 * t, -0.28 - 0.08 * Math.sin(Math.PI * (0.3 + 0.7 * t)), browD[i]]); }
  for (let i = 0; i < 5; i++) { const t = i / 4; p.push([0.18 + 0.6 * t, -0.28 - 0.08 * Math.sin(Math.PI * (1 - 0.7 * t)), browD[4 - i]]); }
  p.push([0, -0.12, 0.1], [0, 0.08, 0.2], [0, 0.28, 0.32], [0, 0.48, 0.5]);
  p.push([-0.2, 0.56, 0.24], [-0.1, 0.59, 0.32], [0, 0.61, 0.36], [0.1, 0.59, 0.32], [0.2, 0.56, 0.24]);
  p.push([-0.6, 0, -0.2], [-0.48, -0.06, -0.08], [-0.36, -0.06, -0.04], [-0.24, 0, 0], [-0.36, 0.05, -0.04], [-0.48, 0.05, -0.08]);
  p.push([0.24, 0, 0], [0.36, -0.06, -0.04], [0.48, -0.06, -0.08], [0.6, 0, -0.2], [0.48, 0.05, -0.08], [0.36, 0.05, -0.04]);
  p.push([-0.4, 0.85, 0.04], [-0.25, 0.79, 0.14], [-0.1, 0.76, 0.2], [0, 0.77, 0.22], [0.1, 0.76, 0.2], [0.25, 0.79, 0.14], [0.4, 0.85, 0.04],
    [0.25, 0.93, 0.14], [0.1, 0.97, 0.18], [0, 0.98, 0.2], [-0.1, 0.97, 0.18], [-0.25, 0.93, 0.14]);
  p.push([-0.33, 0.85, 0.06], [-0.1, 0.82, 0.16], [0, 0.82, 0.16], [0.1, 0.82, 0.16], [0.33, 0.85, 0.06], [0.1, 0.88, 0.16], [0, 0.89, 0.16], [-0.1, 0.88, 0.16]);
  return p;
})();

/** More of the head (for the mesh, not the fit): the forehead in two rows, then a ring around the head. */
const EXTRA = (() => {
  const p = [];
  for (const [y, d0] of [[-0.62, 0.02], [-1.0, -0.12]]) for (let i = 0; i < 5; i++) { const x = -0.8 + 0.4 * i; p.push([x, y, d0 - 0.6 * x * x]); }
  for (let i = 0; i < 14; i++) { const a = (2 * Math.PI * i) / 14; p.push([1.55 * Math.cos(a), 0.3 + 1.7 * Math.sin(a), -1.2]); }
  return p;
})();

/** The landmarks the pose is fitted by: brows, nose, eyes, mouth and the chin (not the jaw's sides, which a turned head shows as its outline). */
const POSE = [8, ...Array.from({ length: 10 }, (_, i) => 17 + i), ...Array.from({ length: 41 }, (_, i) => 27 + i)];

/**
 * How a face is posed: the generic face fitted to its landmarks `pts` (pixels) by a scaled orthographic
 * camera. { R (3×3, the generic face's frame into the picture's: x right, y down, z into the picture),
 * s, t: [x, y], yaw, pitch, roll } (radians; yaw > 0: turned toward the picture's right).
 */
export function fitPose(pts) {
  const M = POSE.map((i) => [TEMPLATE[i][0], TEMPLATE[i][1], -TEMPLATE[i][2]]); const P = POSE.map((i) => pts[i]);
  const n = M.length; const mm = [0, 1, 2].map((k) => M.reduce((a, p) => a + p[k], 0) / n); const pm = [0, 1].map((k) => P.reduce((a, p) => a + p[k], 0) / n);
  // The 2×3 camera A (least squares): A = (ΣpMᵀ)(ΣMMᵀ)⁻¹.
  const MM = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; const PM = [[0, 0, 0], [0, 0, 0]];
  for (let j = 0; j < n; j++) {
    const m = [0, 1, 2].map((k) => M[j][k] - mm[k]); const q = [P[j][0] - pm[0], P[j][1] - pm[1]];
    for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) MM[a][b] += m[a] * m[b]; PM[0][a] += q[0] * m[a]; PM[1][a] += q[1] * m[a]; }
  }
  const inv = inv3(MM); if (!inv) return null;
  const A = [0, 1].map((r) => [0, 1, 2].map((c) => PM[r][0] * inv[0][c] + PM[r][1] * inv[1][c] + PM[r][2] * inv[2][c]));
  // Made a rotation: its two rows evened out and squared up, the third their cross.
  const n1 = Math.hypot(...A[0]); const n2 = Math.hypot(...A[1]); if (!(n1 > 0 && n2 > 0)) return null;
  let r1 = A[0].map((v) => v / n1); let r2 = A[1].map((v) => v / n2);
  const d = r1[0] * r2[0] + r1[1] * r2[1] + r1[2] * r2[2];
  const a1 = r1.map((v, k) => v - (d / 2) * r2[k]); const a2 = r2.map((v, k) => v - (d / 2) * r1[k]);
  r1 = a1.map((v) => v / Math.hypot(...a1)); r2 = a2.map((v) => v / Math.hypot(...a2));
  const r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  const R = [r1, r2, r3]; const s = (n1 + n2) / 2;
  const t = [pm[0] - s * (r1[0] * mm[0] + r1[1] * mm[1] + r1[2] * mm[2]), pm[1] - s * (r2[0] * mm[0] + r2[1] * mm[1] + r2[2] * mm[2])];
  // R = Rz(roll)·Ry(yaw)·Rx(pitch).
  const yaw = Math.asin(Math.max(-1, Math.min(1, -R[2][0]))); const pitch = Math.atan2(R[2][1], R[2][2]); const roll = Math.atan2(R[1][0], R[0][0]);
  return { R, s, t, yaw, pitch, roll };
}

function inv3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h; const B = -(d * i - f * g); const C = d * h - e * g;
  const det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return null;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}

/** Triangles (index triples) over points (Bowyer–Watson). */
export function triangulate(pts) {
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs); const y0 = Math.min(...ys); const span = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) || 1;
  const all = [...pts, [x0 - 20 * span, y0 - span], [x0 + span / 2, y0 + 20 * span], [x0 + 21 * span, y0 - span]];
  const n = pts.length;
  const circ = ([a, b, c]) => {
    const [ax, ay] = all[a]; const [bx, by] = all[b]; const [cx, cy] = all[c];
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)); if (Math.abs(D) < 1e-12) return { x: 0, y: 0, r: Infinity };
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
    return { x: ux, y: uy, r: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris = [{ v: [n, n + 1, n + 2] }]; tris[0].c = circ(tris[0].v);
  for (let i = 0; i < n; i++) {
    const [px, py] = all[i]; const bad = []; const keep = [];
    for (const t of tris) ((px - t.c.x) ** 2 + (py - t.c.y) ** 2 < t.c.r ? bad : keep).push(t);
    const edges = new Map();
    for (const t of bad) for (const [a, b] of [[t.v[0], t.v[1]], [t.v[1], t.v[2]], [t.v[2], t.v[0]]]) { const k = a < b ? `${a},${b}` : `${b},${a}`; edges.set(k, edges.has(k) ? null : [a, b]); }
    tris = keep;
    for (const e of edges.values()) if (e) { const t = { v: [e[0], e[1], i] }; t.c = circ(t.v); tris.push(t); }
  }
  return tris.filter((t) => t.v.every((k) => k < n)).map((t) => t.v);
}

/** Each of the 68 landmarks' mirror image (left ↔ right). */
export const MIRROR = (() => {
  const m = Array.from({ length: 68 }, (_, i) => i);
  const pair = (a, b) => { m[a] = b; m[b] = a; };
  for (let i = 0; i < 8; i++) pair(i, 16 - i);
  for (let i = 0; i < 5; i++) pair(17 + i, 26 - i);
  for (const [a, b] of [[31, 35], [32, 34], [36, 45], [37, 44], [38, 43], [39, 42], [40, 47], [41, 46], [48, 54], [49, 53], [50, 52], [55, 59], [56, 58], [60, 64], [61, 63], [65, 67]]) pair(a, b);
  return m;
})();

/**
 * A picture (RGBA cw×ch) with a face at `cp` (68 points, pixels) posed `pc` (fitPose), turned in 3D by
 * `dyaw` and `dpitch` (radians): drawn again over a mesh of its landmarks (and more of the head, and the
 * picture's corners), nearest last. { rgba, w, h, pts } (its landmarks where they went).
 */
function warpTurn(img, cw, ch, cp, pc, dyaw, dpitch, mesh = null) {
  // The mesh: its landmarks where they are, more of its head where the fitted pose puts them, the picture's corners.
  const cam = (m) => { const q = [m[0], m[1], -m[2]]; return [0, 1, 2].map((r) => pc.R[r][0] * q[0] + pc.R[r][1] * q[1] + pc.R[r][2] * q[2]); };
  const src = []; const depth = [];
  const tdepth = cp.map((_, i) => cam(TEMPLATE[i])[2] * pc.s);
  if (mesh?.length === 478) {
    // Its own face's shape (the dense mesh, pixels, depth into the picture): each landmark's depth its
    // own, and all its other points too, the whole put at the generic head's depth (so the head around
    // it fits). Not inside its mouth (a mouth just closed would open again), nor on top of a landmark.
    const md = MESH68.map((i) => mesh[i][2]);
    const shift = tdepth.reduce((t, v) => t + v, 0) / 68 - md.reduce((t, v) => t + v, 0) / 68;
    cp.forEach((p, i) => { src.push(p); depth.push(md[i] + shift); });
    const lips = cp.slice(48, 60); const lc = [lips.reduce((t, p) => t + p[0], 0) / 12, lips.reduce((t, p) => t + p[1], 0) / 12];
    const mouth = lips.map(([x, y]) => [lc[0] + (x - lc[0]) * 1.4, lc[1] + (y - lc[1]) * 1.4]);
    const inMouth = (x, y) => inPolygon(mouth, x, y);
    const used = new Set(MESH68);
    mesh.forEach(([x, y, z], i) => {
      if (used.has(i) || inMouth(x, y)) return;
      if (src.some((q) => Math.abs(q[0] - x) < 1.5 && Math.abs(q[1] - y) < 1.5)) return;
      src.push([x, y]); depth.push(z + shift);
    });
  } else cp.forEach((p, i) => { src.push(p); depth.push(tdepth[i]); });
  for (const m of EXTRA) { const c = cam(m); src.push([pc.t[0] + pc.s * c[0], pc.t[1] + pc.s * c[1]]); depth.push(c[2] * pc.s); }
  const far = Math.max(...depth);
  for (const p of [[0, 0], [cw / 2, 0], [cw, 0], [cw, ch / 2], [cw, ch], [cw / 2, ch], [0, ch], [0, ch / 2]]) { src.push(p); depth.push(far); }
  // Each point turned: about the head's middle (its fitted center, at depth 0), its tilt taken out first and put back after.
  const cr = Math.cos(pc.roll); const sr = Math.sin(pc.roll); const cy = Math.cos(dyaw); const sy = Math.sin(dyaw); const cx = Math.cos(dpitch); const sx = Math.sin(dpitch);
  const center = [pc.t[0], pc.t[1]];
  const turn = ([x, y], z) => {
    let u = x - center[0]; let v = y - center[1];
    [u, v] = [u * cr + v * sr, -u * sr + v * cr];
    // Up/down (about x), then left/right (about y); z into the picture.
    let w = z; [v, w] = [v * cx - w * sx, v * sx + w * cx];
    [u, w] = [u * cy + w * sy, -u * sy + w * cy];
    [u, v] = [u * cr - v * sr, u * sr + v * cr];
    return [[center[0] + u, center[1] + v], w];
  };
  const moved = src.map((p, i) => turn(p, depth[i]));
  const dst = moved.map((m) => m[0]); const dz = moved.map((m) => m[1]);
  // Its new picture: room for where it goes.
  const minX = Math.min(0, ...dst.map((p) => p[0])); const minY = Math.min(0, ...dst.map((p) => p[1]));
  const w = Math.ceil(Math.max(cw, ...dst.map((p) => p[0])) - minX); const h = Math.ceil(Math.max(ch, ...dst.map((p) => p[1])) - minY);
  const D = dst.map(([x, y]) => [x - minX, y - minY]);
  const tris = triangulate(src).map((t) => ({ t, z: (dz[t[0]] + dz[t[1]] + dz[t[2]]) / 3 })).sort((a, b) => b.z - a.z); // far first
  const out = new Uint8ClampedArray(w * h * 4);
  for (const { t: [a, b, c] } of tris) {
    const [ax, ay] = D[a]; const [bx, by] = D[b]; const [qx, qy] = D[c];
    const det = (bx - ax) * (qy - ay) - (qx - ax) * (by - ay); if (Math.abs(det) < 1e-6) continue;
    const [sa, sb, sc] = [src[a], src[b], src[c]];
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, qx))); const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, qx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, qy))); const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, qy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5; const py = y + 0.5;
      const l1 = ((bx - px) * (qy - py) - (qx - px) * (by - py)) / det; const l2 = ((qx - px) * (ay - py) - (ax - px) * (qy - py)) / det; const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const u = l1 * sa[0] + l2 * sb[0] + l3 * sc[0] - 0.5; const v = l1 * sa[1] + l2 * sb[1] + l3 * sc[1] - 0.5;
      const o = (y * w + x) * 4; const c = sample(img, cw, ch, u, v);
      if (c[3] < 0.5) { out[o + 3] = 0; continue; }
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
    }
  }
  return { rgba: out, w, h, pts: D.slice(0, 68) };
}

/** A picture's color at (u, v) (pixel centers at integers), bilinear, alpha-weighted: [r, g, b, a]. */
function sample(img, cw, ch, u, v) {
  const uf = Math.floor(u); const vf = Math.floor(v); const fu = u - uf; const fv = v - vf;
  let al = 0; let r = 0; let g = 0; let b = 0;
  for (const [X, Y, wt] of [[uf, vf, (1 - fu) * (1 - fv)], [uf + 1, vf, fu * (1 - fv)], [uf, vf + 1, (1 - fu) * fv], [uf + 1, vf + 1, fu * fv]]) {
    if (X < 0 || Y < 0 || X >= cw || Y >= ch || !wt) continue;
    const o = (Y * cw + X) * 4; const aw = img[o + 3] * wt; al += aw; r += img[o] * aw; g += img[o + 1] * aw; b += img[o + 2] * aw;
  }
  return al < 0.5 ? [0, 0, 0, 0] : [r / al, g / al, b / al, al];
}

/**
 * A face seen straight on (RGBA w×h, landmarks `pts`) made symmetric where it was seen least: its far
 * side (the one a turned head showed squeezed) taken from its near side flipped across its middle line,
 * `amount` of the way (0..1), easing in from the middle; its far-side landmarks moved to match. In place
 * on a copy: { rgba, pts }.
 */
export function symmetrize(rgba, w, h, pts, nearLeft, amount) {
  if (!(amount > 0)) return { rgba, pts };
  // Its middle line, x = m·y + c, through the nose, mouth and chin.
  const mid = [27, 28, 29, 30, 33, 51, 57, 62, 66, 8].map((i) => pts[i]);
  const my = mid.reduce((t, p) => t + p[1], 0) / mid.length; const mx = mid.reduce((t, p) => t + p[0], 0) / mid.length;
  let num = 0; let den = 0; for (const [x, y] of mid) { num += (y - my) * (x - mx); den += (y - my) ** 2; }
  const m = den > 0 ? num / den : 0; const c = mx - m * my;
  const lineX = (y) => m * y + c;
  const faceW = Math.hypot(pts[16][0] - pts[0][0], pts[16][1] - pts[0][1]) || w;
  const ease = 0.12 * faceW;
  const out = Uint8ClampedArray.from(rgba);
  for (let y = 0; y < h; y++) {
    const lx = lineX(y + 0.5);
    for (let x = 0; x < w; x++) {
      const d = x + 0.5 - lx; // > 0: right of the middle
      const far = nearLeft ? d > 0 : d < 0; if (!far) continue;
      const t = Math.min(1, Math.abs(d) / ease); const k = amount * t * t * (3 - 2 * t);
      if (k <= 0) continue;
      const src = sample(rgba, w, h, lx - d - 0.5, y);
      if (src[3] < 0.5) continue;
      const o = (y * w + x) * 4;
      for (let j = 0; j < 3; j++) out[o + j] = out[o + j] * (1 - k) + src[j] * k;
      out[o + 3] = Math.max(out[o + 3], out[o + 3] * (1 - k) + src[3] * k);
    }
  }
  // Its far-side landmarks: toward its near side's, flipped across the middle line.
  const P = pts.map((p) => p.slice());
  for (let i = 0; i < 68; i++) {
    const j = MIRROR[i]; if (j === i) continue;
    const [x, y] = pts[i]; const d = x - lineX(y); const far = nearLeft ? d > 0 : d < 0; if (!far) continue;
    const [qx, qy] = pts[j]; const fx = 2 * lineX(qy) - qx;
    P[i] = [x + amount * (fx - x), y + amount * (qy - y)];
  }
  return { rgba: out, pts: P };
}

/**
 * The Character (RGBA cw×ch, its face `charFace`, 0..1 points) turned to the pose of `face` (in a W×H
 * picture): left/right by most of the difference between their poses (up to about 30°), up/down by a
 * little of it (up to about 6°). A Character seen turned is first turned to face straight on and made
 * symmetric where it was seen least (its far side from its near side, flipped: `symmetric`), then
 * turned to that pose, so a side it barely showed isn't stretched thin. { rgba, w, h, face } (its face
 * moved with it), or null when they're posed alike already (within about 7°) or the landmarks aren't there.
 */
export function turnFace(img, cw, ch, charFace, face, W, H, { maxYaw = 0.5, maxPitch = 0.1, yawGain = 0.7, pitchGain = 0.25, min = 0.12, symmetric = true } = {}) {
  if (charFace.pts?.length !== 68 || face.pts?.length !== 68) return null;
  const cp = charFace.pts.map(([u, v]) => [u * cw, v * ch]);
  // Its own face's dense mesh, when it has one (pixels; depth in pixels too).
  const mesh = charFace.mesh?.length === 478 ? charFace.mesh.map(([u, v, z]) => [u * cw, v * ch, z * cw]) : null;
  const pc = fitPose(cp); const pb = fitPose(face.pts.map(([u, v]) => [u * W, v * H]));
  if (!pc || !pb) return null;
  // Left/right by most of the difference (the landmarks show it well); up/down only a little (faces
  // differ in their up/down proportions, and a smile changes them, so it's less sure).
  const clampY = (v) => Math.max(-maxYaw, Math.min(maxYaw, v)); const clampP = (v) => Math.max(-maxPitch, Math.min(maxPitch, v));
  const dyaw = clampY(yawGain * (pb.yaw - pc.yaw)); const dpitch = clampP(pitchGain * (pb.pitch - pc.pitch));
  if (Math.abs(dyaw) < min && Math.abs(dpitch) < min) return null;
  // Seen turned, and turned toward its far side (that side shown more than the photo has it): straight
  // on first, its far side from its near side flipped (more of it the more it was turned), then turned.
  const amount = Math.max(0, Math.min(0.85, (Math.abs(pc.yaw) - 0.1) / 0.35));
  const revealing = Math.sign(dyaw) !== 0 && Math.sign(dyaw) === -Math.sign(pc.yaw);
  let res;
  if (symmetric && amount > 0 && revealing) {
    const front = warpTurn(img, cw, ch, cp, pc, clampY(-pc.yaw), 0, mesh);
    const nearLeft = Math.hypot(cp[30][0] - cp[0][0], cp[30][1] - cp[0][1]) > Math.hypot(cp[30][0] - cp[16][0], cp[30][1] - cp[16][1]);
    const sym = symmetrize(front.rgba, front.w, front.h, front.pts, nearLeft, amount);
    const pf = fitPose(sym.pts);
    res = pf ? warpTurn(sym.rgba, front.w, front.h, sym.pts, pf, clampY(yawGain * pb.yaw - pf.yaw), dpitch) : warpTurn(img, cw, ch, cp, pc, dyaw, dpitch, mesh);
  } else res = warpTurn(img, cw, ch, cp, pc, dyaw, dpitch, mesh);
  const { rgba: out, w, h, pts } = res;
  // Its face, moved with it (0..1 of the new picture).
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  const nf = faceFrom(box, pts, w, h, charFace.score ?? 1);
  return { rgba: out, w, h, face: nf, yaw: dyaw, pitch: dpitch };
}

/** How open a mouth is: the gap between its lips (inside) for its width. */
export const mouthOpen = (pts) => Math.hypot(pts[66][0] - pts[62][0], pts[66][1] - pts[62][1]) / (Math.hypot(pts[54][0] - pts[48][0], pts[54][1] - pts[48][1]) || 1);

/**
 * A picture (RGBA cw×ch) redrawn over a mesh of its 68 landmarks `src` (pixels), each moved to `dst`,
 * the rest of it (a ring around them and the picture's edges) staying put. { rgba } the same size.
 */
export function meshWarp(img, cw, ch, src, dst) {
  const xs = src.map((p) => p[0]); const ys = src.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2; const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const rx = (Math.max(...xs) - Math.min(...xs)) * 0.8; const ry = (Math.max(...ys) - Math.min(...ys)) * 0.8;
  const S = src.map((p) => p.slice()); const D = dst.map((p) => p.slice());
  for (let i = 0; i < 16; i++) { const a = (2 * Math.PI * i) / 16; const p = [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; S.push(p); D.push(p); }
  for (const p of [[0, 0], [cw / 2, 0], [cw, 0], [cw, ch / 2], [cw, ch], [cw / 2, ch], [0, ch], [0, ch / 2]]) { S.push(p); D.push(p); }
  const out = Uint8ClampedArray.from(img);
  // Triangles over where the points went (so the new picture has no gaps or folds), each drawn from where
  // its corners came from; only those with a moved corner (the rest is as it was).
  const moved = S.map((p, i) => Math.hypot(p[0] - D[i][0], p[1] - D[i][1]) > 0.01);
  for (const [a, b, c] of triangulate(D)) {
    if (!moved[a] && !moved[b] && !moved[c]) continue;
    const [ax, ay] = D[a]; const [bx, by] = D[b]; const [qx, qy] = D[c];
    const det = (bx - ax) * (qy - ay) - (qx - ax) * (by - ay); if (Math.abs(det) < 1e-6) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, qx))); const x1 = Math.min(cw - 1, Math.ceil(Math.max(ax, bx, qx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, qy))); const y1 = Math.min(ch - 1, Math.ceil(Math.max(ay, by, qy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5; const py = y + 0.5;
      const l1 = ((bx - px) * (qy - py) - (qx - px) * (by - py)) / det; const l2 = ((qx - px) * (ay - py) - (ax - px) * (qy - py)) / det; const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const u = l1 * S[a][0] + l2 * S[b][0] + l3 * S[c][0] - 0.5; const v = l1 * S[a][1] + l2 * S[b][1] + l3 * S[c][1] - 0.5;
      const col = sample(img, cw, ch, u, v); const o = (y * cw + x) * 4;
      out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = col[3];
    }
  }
  return { rgba: out };
}

/**
 * A Character's mouth closed to match a face's (`to`: that face's mouthOpen; 0: shut): its lips brought
 * together just enough, each by half of what's taken off the gap (so they keep their own fullness), the
 * gap (teeth, tongue) narrowed with them. { rgba, pts } (its landmarks moved with it), or null when its
 * mouth is no more open than that already.
 */
export function closeMouth(img, cw, ch, pts, to = 0) {
  const open = mouthOpen(pts);
  if (open - to < 0.05) return null;
  const f = Math.min(0.96, 1 - Math.max(0, to) / open); // how much of the gap goes (a hair left, so no two points meet)
  const P = pts.map((p) => p.slice());
  // Inner lips, upper (61, 62, 63) and lower (67, 66, 65), to where each pair meets.
  for (const [u, l, ou, ol] of [[61, 67, [49, 50], [59, 58]], [62, 66, [51], [57]], [63, 65, [52, 53], [56, 55]]]) {
    const m = [(pts[u][0] + pts[l][0]) / 2, (pts[u][1] + pts[l][1]) / 2];
    const du = [(m[0] - pts[u][0]) * f, (m[1] - pts[u][1]) * f]; const dl = [(m[0] - pts[l][0]) * f, (m[1] - pts[l][1]) * f];
    P[u] = [pts[u][0] + du[0], pts[u][1] + du[1]]; P[l] = [pts[l][0] + dl[0], pts[l][1] + dl[1]];
    // The outer lips with them, so each lip keeps its own thickness.
    for (const i of ou) P[i] = [pts[i][0] + du[0], pts[i][1] + du[1]];
    for (const i of ol) P[i] = [pts[i][0] + dl[0], pts[i][1] + dl[1]];
  }
  const out = meshWarp(img, cw, ch, pts, P).rgba;
  // Shut all the way: any teeth still showing between the lips (at the corners) take the lips' color.
  if (to <= 0) hideTeeth(out, cw, ch, P);
  return { rgba: out, pts: P };
}

/**
 * A Character's closed (or nearly closed) mouth opened to match a face's open one (`to`: that face's
 * mouthOpen): its lips parted (the upper up, the lower down, each keeping its thickness, its corners
 * where they are) and its chin dropped a little with them, and between its lips nothing: see-through (a
 * soft edge), so the open mouth of the face it goes on (its teeth, the dark inside) shows there instead
 * of lips stretched across it. { rgba, pts } (a copy), or null when it's already about as open.
 */
export function openMouth(img, cw, ch, pts, to) {
  const wid = Math.hypot(pts[54][0] - pts[48][0], pts[54][1] - pts[48][1]); if (!wid) return null;
  const need = (to - mouthOpen(pts)) * wid; if (need < 0.05 * wid) return null;
  // Down the face: across the mouth, turned a quarter (toward its chin).
  let n = [-(pts[54][1] - pts[48][1]) / wid, (pts[54][0] - pts[48][0]) / wid];
  if ((pts[8][0] - pts[51][0]) * n[0] + (pts[8][1] - pts[51][1]) * n[1] < 0) n = [-n[0], -n[1]];
  const P = pts.map((p) => p.slice()); const move = (i, k) => { P[i] = [pts[i][0] + n[0] * k, pts[i][1] + n[1] * k]; };
  const half = need / 2;
  // Upper lip up (the middle most), lower lip down; the outer line with the inner so each keeps its thickness.
  for (const [i, k] of [[61, 0.75], [62, 1], [63, 0.75], [49, 0.55], [50, 0.8], [51, 1], [52, 0.8], [53, 0.55]]) move(i, -half * k);
  for (const [i, k] of [[67, 0.75], [66, 1], [65, 0.75], [59, 0.55], [58, 0.8], [57, 1], [56, 0.8], [55, 0.55]]) move(i, half * k);
  for (const [i, k] of [[6, 0.25], [7, 0.4], [8, 0.5], [9, 0.4], [10, 0.25]]) move(i, half * k);
  const out = meshWarp(img, cw, ch, pts, P).rgba;
  // Between its lips: see-through, with a soft edge (a pixel or so inside the inner lip line).
  const poly = P.slice(60, 68);
  const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
  const bx = Math.max(0, Math.floor(Math.min(...xs)) - 1); const by = Math.max(0, Math.floor(Math.min(...ys)) - 1);
  const ex = Math.min(cw, Math.ceil(Math.max(...xs)) + 1); const ey = Math.min(ch, Math.ceil(Math.max(...ys)) + 1);
  const soft = Math.max(1, wid * 0.03);
  for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
    const px = x + 0.5; const py = y + 0.5;
    if (!inPolygon(poly, px, py)) continue;
    const o = (y * cw + x) * 4; out[o + 3] = Math.round(out[o + 3] * Math.max(0, 1 - edgeDistance(poly, px, py) / soft));
  }
  return { rgba: out, pts: P };
}

/**
 * A picture (RGBA cw×ch) bent smoothly so each landmark `src[i]` goes to `dst[i]` (pixels): every pixel
 * near the ones that move follows them by how near it is to each (inverse square distance; the landmarks
 * that stay, and a ring around them, hold the rest in place). No triangles, so no straight seams. A copy.
 */
function smoothWarp(img, cw, ch, src, dst) {
  const out = Uint8ClampedArray.from(img);
  const moved = src.map((p, i) => Math.hypot(p[0] - dst[i][0], p[1] - dst[i][1]) > 0.01);
  if (!moved.some(Boolean)) return out;
  const mx = src.filter((_, i) => moved[i]); const span = Math.hypot(src[54][0] - src[48][0], src[54][1] - src[48][1]) || 20;
  const x0 = Math.max(0, Math.floor(Math.min(...mx.map((p) => p[0])) - span)); const x1 = Math.min(cw, Math.ceil(Math.max(...mx.map((p) => p[0])) + span));
  const y0 = Math.max(0, Math.floor(Math.min(...mx.map((p) => p[1])) - span)); const y1 = Math.min(ch, Math.ceil(Math.max(...mx.map((p) => p[1])) + span));
  // Controls (in the new picture): where each landmark went, and how to get back to where it came from;
  // and a ring of still points around the area, so it ends where it began.
  const C = src.map((p, i) => [dst[i][0], dst[i][1], p[0] - dst[i][0], p[1] - dst[i][1]]);
  for (let k = 0; k < 24; k++) {
    const a = (2 * Math.PI * k) / 24; const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
    C.push([cx + ((x1 - x0) / 2) * Math.cos(a), cy + ((y1 - y0) / 2) * Math.sin(a), 0, 0]);
  }
  const eps = (span * 0.04) ** 2;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    let sw = 0; let dx = 0; let dy = 0;
    for (const [qx, qy, ux, uy] of C) { const w = 1 / ((x + 0.5 - qx) ** 2 + (y + 0.5 - qy) ** 2 + eps); sw += w; dx += w * ux; dy += w * uy; }
    dx /= sw; dy /= sw;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) continue;
    const c = sample(img, cw, ch, x + dx, y + dy); const o = (y * cw + x) * 4;
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
  }
  return out;
}

/** Teeth showing within a mouth's lips (`P`: its landmarks), colored like the lips around them, keeping their shading. In place. */
function hideTeeth(rgba, w, h, P) {
  const poly = P.slice(48, 60);
  const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
  const bx = Math.max(0, Math.floor(Math.min(...xs))); const by = Math.max(0, Math.floor(Math.min(...ys)));
  const ex = Math.min(w, Math.ceil(Math.max(...xs))); const ey = Math.min(h, Math.ceil(Math.max(...ys)));
  const inside = (x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i]; const [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const px = []; for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) if (inside(x + 0.5, y + 0.5)) px.push((y * w + x) * 4);
  if (px.length < 10) return;
  const labs = px.map((o) => rgbToLab(rgba[o], rgba[o + 1], rgba[o + 2]));
  // The lips: the redder half of what's inside.
  const byRed = labs.map((c, i) => [c[1], i]).sort((a, b) => b[0] - a[0]).slice(0, Math.ceil(labs.length / 2)).map(([, i]) => i);
  const lip = [0, 1, 2].map((k) => byRed.reduce((t, i) => t + rgba[px[i] + k], 0) / byRed.length);
  const lipLab = rgbToLab(...lip);
  // Teeth (within the lips but much less red than them, and not dark), one pixel roomier, then toward the lips' color and smoothed.
  const mask = new Uint8Array(w * h);
  labs.forEach((c, i) => { if (c[0] > lipLab[0] - 4 && c[1] < lipLab[1] - 7) mask[px[i] / 4] = 1; });
  const grown = Uint8Array.from(mask);
  for (let k = 0; k < w * h; k++) if (mask[k]) for (const t of [k - 1, k + 1, k - w, k + w]) if (t >= 0 && t < w * h) grown[t] = 1;
  for (let k = 0; k < w * h; k++) if (grown[k]) for (let j = 0; j < 3; j++) rgba[k * 4 + j] = rgba[k * 4 + j] * 0.35 + lip[j] * 0.85 * 0.65;
  for (let pass = 0; pass < 2; pass++) {
    const copy = Uint8ClampedArray.from(rgba);
    for (let k = 0; k < w * h; k++) {
      if (!grown[k]) continue;
      for (let j = 0; j < 3; j++) { let t = 0; let n = 0; for (const q of [k, k - 1, k + 1, k - w, k + w, k - w - 1, k - w + 1, k + w - 1, k + w + 1]) if (q >= 0 && q < w * h) { t += copy[q * 4 + j]; n++; } rgba[k * 4 + j] = t / n; }
    }
  }
  // Where the lips meet: a soft dark crease along them (60, 61–63 to 64).
  const line = [60, 61, 62, 63, 64].map((i) => P[i]);
  const lipH = Math.hypot(P[57][0] - P[51][0], P[57][1] - P[51][1]); const wid = Math.max(1, lipH * 0.05);
  for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
    let d = Infinity;
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = line[i]; const [qx, qy] = line[i + 1]; const vx = qx - ax; const vy = qy - ay; const L2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * vx + (y + 0.5 - ay) * vy) / L2));
      d = Math.min(d, Math.hypot(x + 0.5 - ax - t * vx, y + 0.5 - ay - t * vy));
    }
    if (d > 2 * wid) continue;
    const k = 1 - 0.3 * Math.exp(-(d * d) / (2 * wid * wid)); const o = (y * w + x) * 4;
    for (let j = 0; j < 3; j++) rgba[o + j] *= k;
  }
}
