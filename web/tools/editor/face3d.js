// FaceMask → a Character turned in 3D to the pose of the face it goes on. A generic head (the 68
// landmarks of an average face, each with its depth: the nose forward, the eye corners and jaw back)
// is fitted to each face's landmarks to find how it's posed (turned left/right, up/down, tilted); the
// Character's own face, given that depth, is then turned by the difference (left/right and up/down;
// tilt is left to the placement) and drawn again triangle by triangle over a mesh of its landmarks,
// nearest last, so its nose covers the far cheek as it would. Pure: RGBA in, RGBA out.

import { faceFrom } from '../../lib/face-core.js';

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

/**
 * The Character (RGBA cw×ch, its face `charFace`, 0..1 points) turned to the pose of `face` (in a W×H
 * picture): left/right by most of the difference between their poses (up to 40°), up/down by a little
 * of it (up to about 9°). { rgba, w, h, face } (its face moved with it), or null when they're posed
 * alike already (within about 6°) or the landmarks aren't there.
 */
export function turnFace(img, cw, ch, charFace, face, W, H, { maxYaw = 0.7, maxPitch = 0.15, yawGain = 0.85, pitchGain = 0.3, min = 0.1 } = {}) {
  if (charFace.pts?.length !== 68 || face.pts?.length !== 68) return null;
  const cp = charFace.pts.map(([u, v]) => [u * cw, v * ch]);
  const pc = fitPose(cp); const pb = fitPose(face.pts.map(([u, v]) => [u * W, v * H]));
  if (!pc || !pb) return null;
  // Left/right by most of the difference (the landmarks show it well); up/down only a little (faces
  // differ in their up/down proportions, and a smile changes them, so it's less sure).
  const dyaw = Math.max(-maxYaw, Math.min(maxYaw, yawGain * (pb.yaw - pc.yaw))); const dpitch = Math.max(-maxPitch, Math.min(maxPitch, pitchGain * (pb.pitch - pc.pitch)));
  if (Math.abs(dyaw) < min && Math.abs(dpitch) < min) return null;
  // The mesh: its landmarks where they are, more of its head where the fitted pose puts them, the cut-out's corners.
  const cam = (m) => { const q = [m[0], m[1], -m[2]]; return [0, 1, 2].map((r) => pc.R[r][0] * q[0] + pc.R[r][1] * q[1] + pc.R[r][2] * q[2]); };
  const src = []; const depth = [];
  cp.forEach((p, i) => { src.push(p); depth.push(cam(TEMPLATE[i])[2] * pc.s); });
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
      const uf = Math.floor(u); const vf = Math.floor(v); const fu = u - uf; const fv = v - vf;
      let al = 0; let r = 0; let g = 0; let bb = 0;
      for (const [X, Y, wt] of [[uf, vf, (1 - fu) * (1 - fv)], [uf + 1, vf, fu * (1 - fv)], [uf, vf + 1, (1 - fu) * fv], [uf + 1, vf + 1, fu * fv]]) {
        if (X < 0 || Y < 0 || X >= cw || Y >= ch || !wt) continue;
        const o = (Y * cw + X) * 4; const aw = img[o + 3] * wt; al += aw; r += img[o] * aw; g += img[o + 1] * aw; bb += img[o + 2] * aw;
      }
      const o = (y * w + x) * 4;
      if (al < 0.5) { out[o + 3] = 0; continue; }
      out[o] = r / al; out[o + 1] = g / al; out[o + 2] = bb / al; out[o + 3] = al;
    }
  }
  // Its face, moved with it (0..1 of the new picture).
  const pts = D.slice(0, 68);
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  const nf = faceFrom(box, pts, w, h, charFace.score ?? 1);
  return { rgba: out, w, h, face: nf, yaw: dyaw, pitch: dpitch };
}
