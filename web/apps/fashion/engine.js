// Fashion's Replace, done simply: the piece taken from its photo and put on the person in the base as one
// smooth whole. (What was worn there is taken off first, to their own skin: compose.js, eraseGarment.)
//
// 1. Where everything goes: one continuous mapping of the base onto the piece's photo, as a body is rigged:
//    its torso by a gentle warp through the chin, the shoulders and the hips; each arm by its own bones
//    (shoulder → elbow → wrist: how far along, how far to the side), so a sleeve follows an arm however
//    differently it's held; and between them, near the shoulders, the two blended pixel by pixel (each
//    pixel's place a weighted mix by how near it is to the torso and to each arm). One piece, no joins.
// 2. What of the piece is laid on: its cloth only (not its model's skin, hair or face, nor anyone else's):
//    with any small hole in it (a lock of hair over it) filled with the cloth around it, its own neckline open.
//    A part hidden in its photo (behind the person beside them) is taken from its other side, mirrored, where
//    what was worn on the base was.
// 3. Its colors as they are in its photo, without the background it was photographed against at its edges
//    (each edge pixel takes the cloth's own color beside it), its edge as soft as the photo's.
// The light of the base, what's in front (hair, hands), grain and the shadows at its edges are added after,
// as for any layer (compose.js, finish).

import { garmentZone } from './compose.js';
import { boxOf, fillHoles } from '../../tools/fashion/fashion-core.js';
import { membrane } from '../../tools/editor/cleanup.js';
import { rgbToLab } from '../../lib/color-match.js';

const seen = (v) => v && v[2] >= 0.3;

/** The matching points of the two people: [[baseX, baseY], [pieceX, pieceY]] pairs, or null. */
export function matchPoints(base, piece) {
  const qa = base.pose; const qb = piece.pose; const La = base.layout; const Lb = piece.layout;
  if (!qa || !qb || !La || !Lb) return null;
  if (!seen(qa.shoulders?.[0]) || !seen(qa.shoulders?.[1]) || !seen(qb.shoulders?.[0]) || !seen(qb.shoulders?.[1])) return null;
  const pairs = [];
  const add = (a, b) => { if (a && b) pairs.push([[a[0], a[1]], [b[0], b[1]]]); };
  for (const k of [0, 1]) add(qa.shoulders[k], qb.shoulders[k]);
  // (The hips: seen, or a torso's length below the shoulders by the face's size.)
  const hips = (q, L) => [0, 1].map((k) => (seen(q.hips?.[k]) ? q.hips[k] : [q.shoulders[k][0], q.shoulders[k][1] + L.fh * 2.4, 1]));
  const ha = hips(qa, La); const hb = hips(qb, Lb);
  for (const k of [0, 1]) add(ha[k], hb[k]);
  // (The chin's middle: where a neckline sits.)
  const chin = (L) => (L.face ? [(L.face.x0 + L.face.x1) / 2, L.chin] : null);
  add(chin(La), chin(Lb));
  // (Each arm, where both people's are seen: the elbow, then the wrist.)
  for (const k of [0, 1]) {
    if (seen(qa.elbows?.[k]) && seen(qb.elbows?.[k])) {
      add(qa.elbows[k], qb.elbows[k]);
      if (seen(qa.wrists?.[k]) && seen(qb.wrists?.[k])) add(qa.wrists[k], qb.wrists[k]);
    }
  }
  return pairs.length >= 5 ? pairs : null;
}

/**
 * A thin-plate spline through `pairs` ([[from], [to]]), `lambda` relaxing it (bent less, its points met a
 * little less exactly). A function (x, y) → [x, y].
 */
export function thinPlate(pairs, lambda = 0.05) {
  const n = pairs.length;
  // (In units of the points' own spread, for a well-behaved system.)
  const cx = pairs.reduce((a, p) => a + p[0][0], 0) / n; const cy = pairs.reduce((a, p) => a + p[0][1], 0) / n;
  const sc = Math.sqrt(pairs.reduce((a, p) => a + (p[0][0] - cx) ** 2 + (p[0][1] - cy) ** 2, 0) / n) || 1;
  const P = pairs.map((p) => [(p[0][0] - cx) / sc, (p[0][1] - cy) / sc]);
  const U = (r2) => (r2 > 1e-12 ? r2 * Math.log(r2) : 0);
  const N = n + 3; const A = Array.from({ length: N }, () => new Float64Array(N));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = U((P[i][0] - P[j][0]) ** 2 + (P[i][1] - P[j][1]) ** 2);
    A[i][i] += lambda;
    A[i][n] = 1; A[i][n + 1] = P[i][0]; A[i][n + 2] = P[i][1];
    A[n][i] = 1; A[n + 1][i] = P[i][0]; A[n + 2][i] = P[i][1];
  }
  const solve = (rhs) => {
    const M = A.map((r, i) => [...r, rhs[i]]);
    for (let c = 0; c < N; c++) {
      let piv = c; for (let r = c + 1; r < N; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const d = M[c][c]; if (Math.abs(d) < 1e-12) continue;
      for (let r = 0; r < N; r++) { if (r === c) continue; const f = M[r][c] / d; if (!f) continue; for (let k = c; k <= N; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[N] / r[i]));
  };
  const wx = solve([...pairs.map((p) => p[1][0]), 0, 0, 0]); const wy = solve([...pairs.map((p) => p[1][1]), 0, 0, 0]);
  return (x, y) => {
    const u = (x - cx) / sc; const v = (y - cy) / sc;
    let X = wx[n] + wx[n + 1] * u + wx[n + 2] * v; let Y = wy[n] + wy[n + 1] * u + wy[n + 2] * v;
    for (let i = 0; i < n; i++) { const k = U((u - P[i][0]) ** 2 + (v - P[i][1]) ** 2); X += wx[i] * k; Y += wy[i] * k; }
    return [X, Y];
  };
}

/** Whether the simple way applies: Replace on a top, dress or upper body, both people's bodies found. */
export function engineFor(S) {
  return !!S.base?.people && !!S.piece?.people && !!matchPoints(S.base, S.piece);
}

/**
 * The piece's cloth, ready to sample: within a margin around it, its colors (its cloth's own, carried smoothly
 * past its edges and into its holes, so nothing of its photo's background or its model's skin is taken) and
 * how much of it is cloth (0..1). Kept on the piece.
 */
function prepare(piece) {
  const pm = piece.solid ?? piece.sel; if (!pm || !piece.box) return null;
  if (piece.engine?.of === pm && piece.engine.w === piece.w) return piece.engine;
  const { w: PW, h: PH } = piece; const pp = piece.people; const tex = piece.draw ?? piece.rgba;
  const AP = piece.allPeople && piece.allPeople.w === PW && piece.allPeople.h === PH ? piece.allPeople : pp;
  const b = piece.box; const m = Math.round(Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.15);
  const X0 = Math.max(0, b.x0 - m); const Y0 = Math.max(0, b.y0 - m); const X1 = Math.min(PW, b.x1 + m); const Y1 = Math.min(PH, b.y1 + m);
  const bw = X1 - X0; const bh = Y1 - Y0;
  const cloth = new Uint8Array(PW * PH); const skin = new Uint8Array(PW * PH);
  // (What was rebuilt as cloth (under hair, under a hand across their front) is cloth only within their torso
  // or where it isn't their own skin: an arm hanging at their side, taken for something over the garment, is
  // their arm, not more sleeve.)
  const q0 = piece.pose; const ok0 = (v) => v && v[2] >= 0.3;
  let inTorso = () => true;
  if (q0 && ok0(q0.shoulders?.[0]) && ok0(q0.shoulders?.[1])) {
    const fh0 = piece.layout?.fh ?? 60; const S0 = q0.shoulders; const H0 = [ok0(q0.hips?.[0]) ? q0.hips[0] : [S0[0][0], S0[0][1] + fh0 * 2.4], ok0(q0.hips?.[1]) ? q0.hips[1] : [S0[1][0], S0[1][1] + fh0 * 2.4]];
    const quad0 = [S0[0], S0[1], H0[1], H0[0]]; const cx = quad0.reduce((s2, v) => s2 + v[0], 0) / 4; const cy = quad0.reduce((s2, v) => s2 + v[1], 0) / 4;
    const qs = quad0.map(([x, y]) => [cx + (x - cx) * 0.9, cy + (y - cy) * 1.2]);
    inTorso = (x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = qs[i]; const [xj, yj] = qs[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  }
  const rebuiltCloth = (i, x, y) => !!piece.rebuilt?.[i] && (pp.body[i] < 128 || inTorso(x, y));
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const i = y * PW + x;
    const isSkin = (pp.body[i] >= 128 || pp.face[i] >= 128) && !rebuiltCloth(i, x, y);
    if (isSkin) { skin[i] = 1; continue; }
    const other = AP.hair[i] >= 110 || AP.face[i] >= 128 || pp.hair[i] >= 110;
    // (Theirs: what the finder says is this person's clothes, or rebuilt under their hair.)
    if (pm[i] && ((!other && pp.clothes[i] >= 70) || rebuiltCloth(i, x, y))) cloth[i] = 1;
  }
  // (Below its waist, only the cloth that goes on from above it in that column, by its color (a jacket's
  // sides, a dress's skirt), not a belt or the jeans under a short top that the selection reached.)
  const Lw = piece.layout;
  if (Lw?.waist && Lw.waist < Y1 - 2) {
    const from = Math.round(Lw.waist - Lw.fh * 0.3); const ref0 = Math.round(Lw.waist - Lw.fh * 0.45); const band = Math.max(3, Math.round(Lw.fh * 0.12));
    if (ref0 - band > Y0) for (let x = X0; x < X1; x++) {
      const r = [0, 0, 0]; let rn = 0;
      for (let y = ref0 - band; y < ref0; y++) { const i = y * PW + x; if (cloth[i]) { const q = rgbToLab(tex[i * 4], tex[i * 4 + 1], tex[i * 4 + 2]); r[0] += q[0]; r[1] += q[1]; r[2] += q[2]; rn++; } }
      const has = rn >= Math.max(2, band * 0.4); if (has) for (let c = 0; c < 3; c++) r[c] /= rn;
      for (let y = Math.max(Y0, from); y < Y1; y++) {
        const i = y * PW + x; if (!cloth[i]) continue;
        const q = rgbToLab(tex[i * 4], tex[i * 4 + 1], tex[i * 4 + 2]);
        if (!has || Math.hypot((q[0] - r[0]) * 0.6, q[1] - r[1], q[2] - r[2]) > 22) cloth[i] = 0;
      }
    }
  }
  let garmentLab = null; let hemRow = null;
  // (Cut at its real hem: from the bottom up, rows with little of its own cloth's color (its median over its
  // upper two thirds) aren't it (the trousers under a shirt).)
  {
    const L0 = []; const A0 = []; const B0 = [];
    for (let y = b.y0; y < b.y0 + (b.y1 - b.y0) * 0.67; y += 3) for (let x = b.x0; x < b.x1; x += 3) { const i = y * PW + x; if (!cloth[i]) continue; const q = rgbToLab(tex[i * 4], tex[i * 4 + 1], tex[i * 4 + 2]); L0.push(q[0]); A0.push(q[1]); B0.push(q[2]); }
    if (L0.length > 50) {
      const med = (v) => { v.sort((p, q) => p - q); return v[v.length >> 1]; }; const c0 = [med(L0), med(A0), med(B0)]; garmentLab = c0;
      const rows = []; for (let y = b.y0; y < b.y1; y++) { let k = 0; for (let x = b.x0; x < b.x1; x += 2) { const i = y * PW + x; if (!cloth[i]) continue; const q = rgbToLab(tex[i * 4], tex[i * 4 + 1], tex[i * 4 + 2]); if (Math.hypot((q[0] - c0[0]) * 0.5, q[1] - c0[1], q[2] - c0[2]) < 22) k++; } rows.push(k); }
      const usual = [...rows].sort((p, q) => p - q)[Math.floor(rows.length * 0.6)] || 1;
      let hem = b.y1; for (let y = b.y1 - 1; y > b.y0 + (b.y1 - b.y0) * 0.4; y--) if (rows[y - b.y0] >= usual * 0.3) { hem = y + 1; break; }
      for (let y = hem; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) cloth[y * PW + x] = 0;
      hemRow = hem;
    }
  }
  // (Only its own colors: the colors well inside it (its palette: a print's, lace with its light and shade)
  // set what it is; at its edges, what's none of them (its model's arm in the shade under a sleeve, a lock of
  // their hair, the arm of the person beside them) isn't it, and isn't laid on as a dark band at a sleeve's end.
  // What's left out inside it (a deep fold) is filled back just below, as any hole is.)
  const notIt = new Uint8Array(PW * PH);
  {
    const key = (q) => ((Math.max(0, Math.min(31, Math.floor(q[0] / 6))) * 64 + Math.max(0, Math.min(63, Math.floor((q[1] + 128) / 6)))) * 64 + Math.max(0, Math.min(63, Math.floor((q[2] + 128) / 6))));
    const r = 3; const count = new Map(); let total = 0; const labs = new Map();
    const labAt = (i) => { let q = labs.get(i); if (!q) { q = rgbToLab(tex[i * 4], tex[i * 4 + 1], tex[i * 4 + 2]); labs.set(i, q); } return q; };
    for (let y = b.y0 + r; y < b.y1 - r; y += 2) for (let x = b.x0 + r; x < b.x1 - r; x += 2) {
      const i = y * PW + x; if (!cloth[i]) continue;
      if (!cloth[i - r] || !cloth[i + r] || !cloth[i - r * PW] || !cloth[i + r * PW]) continue;
      const k = key(labAt(i)); count.set(k, (count.get(k) ?? 0) + 1); total++;
    }
    if (total > 200) {
      const pal = new Set([...count].filter(([, c]) => c >= total * 0.002).map(([k]) => k));
      const near = (q) => { const L = Math.floor(q[0] / 6); const A = Math.floor((q[1] + 128) / 6); const B = Math.floor((q[2] + 128) / 6); for (let dl = -1; dl <= 1; dl++) for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) if (pal.has(((L + dl) * 64 + A + da) * 64 + B + db)) return true; return false; };
      for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) { const i = y * PW + x; if (cloth[i] && !piece.rebuilt?.[i] && !near(labAt(i))) { cloth[i] = 0; notIt[i] = 1; } }
    }
  }
  // (A sheer cloth (lace) over its model's arm: at a sleeve's end the arm shows through it smooth, where the
  // lace itself is full of fine detail. There, a smooth patch reaching the cloth's edge is the arm, not the
  // cloth (laid on, it would be a flat blue patch past the lace's hem). Only for a cloth that's detailed
  // all over, and only by its arms: a plain cloth is smooth everywhere, and a satin sash isn't an arm.)
  {
    const PWn = PW; const lum = (i) => 0.299 * tex[i * 4] + 0.587 * tex[i * 4 + 1] + 0.114 * tex[i * 4 + 2];
    const r2 = 2; const sd = new Float32Array(PW * PH); const sds = [];
    for (let y = b.y0 + r2; y < b.y1 - r2; y++) for (let x = b.x0 + r2; x < b.x1 - r2; x++) {
      const i = y * PWn + x; if (!cloth[i]) continue; let s1 = 0; let s2 = 0; let n = 0;
      for (let dy = -r2; dy <= r2; dy++) for (let dx = -r2; dx <= r2; dx++) { const v = lum(i + dy * PWn + dx); s1 += v; s2 += v * v; n++; }
      const v = Math.sqrt(Math.max(0, s2 / n - (s1 / n) ** 2)); sd[i] = v; if ((x + y) % 3 === 0) sds.push(v);
    }
    sds.sort((p2, q2) => p2 - q2); const medSd = sds.length > 200 ? sds[sds.length >> 1] : 0;
    const qp = piece.pose; const span = seen(qp?.shoulders?.[0]) && seen(qp?.shoulders?.[1]) ? Math.hypot(qp.shoulders[1][0] - qp.shoulders[0][0], qp.shoulders[1][1] - qp.shoulders[0][1]) : 0;
    const armSegs = [];
    if (span) for (const k of [0, 1]) { if (!seen(qp.elbows?.[k])) continue; const S0 = qp.shoulders[k]; const E0 = qp.elbows[k]; armSegs.push([[S0[0] + (E0[0] - S0[0]) * 0.4, S0[1] + (E0[1] - S0[1]) * 0.4], E0]); if (seen(qp.wrists?.[k])) armSegs.push([E0, qp.wrists[k]]); }
    if (medSd > 7 && armSegs.length) {
      const R = span * 0.16; const byArm = (x, y) => armSegs.some(([A, B]) => onSeg(x, y, A, B).d < R);
      const smoothAt = (i) => cloth[i] && sd[i] < medSd * 0.4;
      const st = []; const mark = new Uint8Array(PW * PH);
      for (let y = b.y0 + 1; y < b.y1 - 1; y++) for (let x = b.x0 + 1; x < b.x1 - 1; x++) { const i = y * PWn + x; if (smoothAt(i) && byArm(x, y) && (!cloth[i - 1] || !cloth[i + 1] || !cloth[i - PWn] || !cloth[i + PWn])) { mark[i] = 1; st.push(i); } }
      for (let a2 = 0; a2 < st.length; a2++) { const i = st[a2]; const x = i % PWn; const y = (i / PWn) | 0; for (const t of [i - 1, i + 1, i - PWn, i + PWn]) { const tx = t % PWn; const ty = (t / PWn) | 0; if (tx < b.x0 || ty < b.y0 || tx >= b.x1 || ty >= b.y1 || mark[t] || !smoothAt(t) || !byArm(tx, ty)) continue; mark[t] = 1; st.push(t); } void x; void y; }
      // (Only a patch of some size: a fold's shadow beside a sleeve's edge, a speck, stays cloth.)
      const minA = Math.max(60, (span * 0.12) ** 2); const lab2 = new Int32Array(PW * PH).fill(-1); let n = 0;
      for (let i0 = 0; i0 < mark.length; i0++) {
        if (!mark[i0] || lab2[i0] >= 0) continue;
        const comp = [i0]; lab2[i0] = i0;
        for (let a3 = 0; a3 < comp.length; a3++) { const i = comp[a3]; for (const t of [i - 1, i + 1, i - PWn, i + PWn]) if (t >= 0 && t < mark.length && mark[t] && lab2[t] < 0) { lab2[t] = i0; comp.push(t); } }
        if (comp.length < minA) continue;
        for (const i of comp) { cloth[i] = 0; notIt[i] = 1; n++; }
      }
    }
  }
  // (Holes in it that aren't its own skin (hair over it, a speck): cloth. Its neckline, its skin, stays open.)
  const both = new Uint8Array(PW * PH); for (let i = 0; i < both.length; i++) both[i] = cloth[i] || skin[i] ? 1 : 0;
  const bb = boxOf(both, PW, PH);
  // (Not what was just found not to be it by its color, enclosed or not: a shaded arm between a sleeve and
  // its side is no hole in the cloth.) Small spots of it well inside (a fold's deepest shade) still are.
  if (bb) { fillHoles(both, PW, PH, bb, 0.06); for (let i = 0; i < both.length; i++) if (both[i] && !skin[i] && !notIt[i]) cloth[i] = 1; }
  { const nb = (i) => cloth[i - 1] + cloth[i + 1] + cloth[i - PW] + cloth[i + PW]; for (let pass = 0; pass < 2; pass++) for (let y = b.y0 + 1; y < b.y1 - 1; y++) for (let x = b.x0 + 1; x < b.x1 - 1; x++) { const i = y * PW + x; if (notIt[i] && !cloth[i] && nb(i) >= 3) cloth[i] = 1; } }
  // (Its colors: the cloth's own where it is, carried smoothly everywhere else in the margin.)
  const val = new Float32Array(bw * bh * 3); const free = new Uint8Array(bw * bh); const a = new Float32Array(bw * bh);
  // (Only the cloth well inside its edge sets the color: its very edge is blended with what's beyond it.)
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x; const i = (Y0 + y) * PW + X0 + x;
    a[k] = cloth[i];
    const inner = cloth[i] && (x === 0 || cloth[i - 1]) && (x === bw - 1 || cloth[i + 1]) && (y === 0 || cloth[i - PW]) && (y === bh - 1 || cloth[i + PW]);
    if (inner) { for (let c = 0; c < 3; c++) val[k * 3 + c] = tex[i * 4 + c]; } else free[k] = 1;
  }
  membrane(val, free, bw, bh);
  // (How much is cloth, softened over a pixel: an edge as soft as the photo's.)
  const a2 = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let s = 0; let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx; const Y = y + dy; if (X >= 0 && Y >= 0 && X < bw && Y < bh) { s += a[Y * bw + X]; n++; } } a2[y * bw + x] = s / n; }
  // (Its body's middle line, shoulders' middle to hips' middle: for mirroring a hidden side.)
  const q = piece.pose; const L = piece.layout;
  const sm = [(q.shoulders[0][0] + q.shoulders[1][0]) / 2, (q.shoulders[0][1] + q.shoulders[1][1]) / 2];
  const hm = seen(q.hips?.[0]) && seen(q.hips?.[1]) ? [(q.hips[0][0] + q.hips[1][0]) / 2, (q.hips[0][1] + q.hips[1][1]) / 2] : [sm[0], sm[1] + (L?.fh ?? 60) * 2.4];
  // (Cut off by its photo's bottom edge (a shirt photographed to the chest): its cloth reaching that edge
  // across a good part of its width; then carried on past it, mirrored.)
  // (Cut off straight across at its bottom (by its photo's edge, or by where its zone was taken to end) rather
  // than at a hem of its own: its cloth across a good part of its width in its last rows.)
  let cutY = null; { const yb = Math.min(PH, b.y1) - 1; let n = 0; let all = 0; for (let x = b.x0; x < b.x1; x++) { all++; if (cloth[yb * PW + x] || cloth[(yb - 1) * PW + x]) n++; } if (n > all * 0.3) cutY = yb; }
  // (Or its photo ending just past its hem (the top of the trousers under it, then the edge): how long it
  // really is isn't seen; carried on from its hem the same way.)
  if (cutY == null && hemRow != null && PH - hemRow < (L?.fh ?? 60) * 0.6) cutY = hemRow - 1;
  piece.engine = { of: pm, w: PW, X0, Y0, bw, bh, val, a: a2, sm, hm, cutY, garmentLab, cloth, skin, tex, quad: [q.shoulders[0], q.shoulders[1], seen(q.hips?.[1]) ? q.hips[1] : [q.shoulders[1][0], q.shoulders[1][1] + (L?.fh ?? 60) * 2.4], seen(q.hips?.[0]) ? q.hips[0] : [q.shoulders[0][0], q.shoulders[0][1] + (L?.fh ?? 60) * 2.4]] };
  return piece.engine;
}

/** A rig of one body: its torso (shoulders, hips, chin) and its arms' bones (each [shoulder, elbow, wrist] or null). */
function rig(q, L) {
  const S0 = q.shoulders.map((v) => [v[0], v[1]]);
  const H = [0, 1].map((k) => (seen(q.hips?.[k]) ? [q.hips[k][0], q.hips[k][1]] : [S0[k][0], S0[k][1] + L.fh * 2.4]));
  const arm = (k) => {
    if (!seen(q.elbows?.[k])) return null;
    const e = [q.elbows[k][0], q.elbows[k][1]];
    const w = seen(q.wrists?.[k]) ? [q.wrists[k][0], q.wrists[k][1]] : [e[0] + (e[0] - S0[k][0]) * 0.9, e[1] + (e[1] - S0[k][1]) * 0.9];
    return [S0[k], e, w];
  };
  const chin = L.face ? [(L.face.x0 + L.face.x1) / 2, L.chin] : null;
  return { S: S0, H, arms: [arm(0), arm(1)], chin, span: Math.hypot(S0[1][0] - S0[0][0], S0[1][1] - S0[0][1]) };
}

/** Distance from a point to a segment, and where along it (0..1) and to which side (signed, in px). */
function onSeg(x, y, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L2 = dx * dx + dy * dy || 1;
  const t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2; const tc = Math.max(0, Math.min(1, t));
  const px = a[0] + dx * tc; const py = a[1] + dy * tc; const L = Math.sqrt(L2);
  return { d: Math.hypot(x - px, y - py), t, side: ((x - a[0]) * -dy + (y - a[1]) * dx) / L, L };
}

/**
 * The piece put on the base: a layer { x0, y0, pw, ph, rgba } (its alpha how much of it covers each pixel,
 * before what's in front), or null when the bodies can't be matched.
 */
export function engineLayer(S) {
  const { base, piece } = S; const { w, h } = base;
  const pairs = matchPoints(base, piece); if (!pairs) return null;
  const E = prepare(piece); if (!E) return null;
  const RB = rig(base.pose, base.layout); const RP = rig(piece.pose, piece.layout);
  // The torso: a gentle warp through the shoulders, hips and chin.
  const tp = [[RB.S[0], RP.S[0]], [RB.S[1], RP.S[1]], [RB.H[0], RP.H[0]], [RB.H[1], RP.H[1]]];
  if (RB.chin && RP.chin) tp.push([RB.chin, RP.chin]);
  const torso = thinPlate(tp, 0.3);
  // (Across an arm, by the bodies' sizes (not the bones' lengths, which a raised or foreshortened arm changes).)
  const across = RP.span / Math.max(1, RB.span);
  // (An arm of the piece not seen in its photo: its other one, mirrored across its body's middle.)
  const pm0 = [(RP.S[0][0] + RP.S[1][0]) / 2, (RP.S[0][1] + RP.S[1][1]) / 2]; const ph0 = [(RP.H[0][0] + RP.H[1][0]) / 2, (RP.H[0][1] + RP.H[1][1]) / 2];
  const ax = ph0[0] - pm0[0]; const ay = ph0[1] - pm0[1]; const al = Math.hypot(ax, ay) || 1;
  const mir = (p) => { const t = ((p[0] - pm0[0]) * ax + (p[1] - pm0[1]) * ay) / (al * al); const qx = pm0[0] + ax * t; const qy = pm0[1] + ay * t; return [2 * qx - p[0], 2 * qy - p[1]]; };
  // (An arm of the piece whose cloth along its upper arm isn't the garment's color (it's hidden behind someone
  // in its photo, the pose guessing where it is): not trusted.)
  const armOk = (A) => {
    if (!A) return false;
    // (A forearm far shorter than the upper arm, folded back on it: a guess at an arm the photo hides.)
    { const up = Math.hypot(A[1][0] - A[0][0], A[1][1] - A[0][1]); const fo = Math.hypot(A[2][0] - A[1][0], A[2][1] - A[1][1]); if (fo < up * 0.45) return false; }
    // (Its bones over this person, not over someone else: else it's hidden behind them.)
    { const pp = piece.people; const AP = piece.allPeople && piece.allPeople.w === piece.w ? piece.allPeople : pp; let mine = 0; let n = 0;
      for (let t = 0.2; t <= 1.6; t += 0.1) { const seg = t <= 1 ? [A[0], A[1], t] : [A[1], A[2], t - 1]; const X = Math.round(seg[0][0] + (seg[1][0] - seg[0][0]) * seg[2]); const Y = Math.round(seg[0][1] + (seg[1][1] - seg[0][1]) * seg[2]); if (X < 0 || Y < 0 || X >= piece.w || Y >= piece.h) continue; const i = Y * piece.w + X; n++; const own = Math.max(pp.body[i], pp.clothes[i]); const any = Math.max(AP.body[i], AP.clothes[i], AP.hair[i]); if (own >= 100 && own >= any - 30) mine++; }
      if (n >= 6 && mine < n * 0.6) return false; }
    if (!E.garmentLab) return true;
    const v = []; const PW = piece.w; const R = RP.span * 0.12;
    for (let t = 0.15; t <= 0.85; t += 0.05) { const cx = A[0][0] + (A[1][0] - A[0][0]) * t; const cy = A[0][1] + (A[1][1] - A[0][1]) * t; for (let dy = -R; dy <= R; dy += 3) for (let dx = -R; dx <= R; dx += 3) { const X = Math.round(cx + dx); const Y = Math.round(cy + dy); if (X < 0 || Y < 0 || X >= PW || Y >= piece.h) continue; const i = Y * PW + X; if (E.cloth[i]) v.push(rgbToLab(E.tex[i * 4], E.tex[i * 4 + 1], E.tex[i * 4 + 2])); } }
    if (v.length < 20) return true; // (bare: its skin, not laid on)
    const med = (c) => { const a2 = v.map((q) => q[c]).sort((p, q) => p - q); return a2[a2.length >> 1]; };
    const g = E.garmentLab; return Math.hypot((med(0) - g[0]) * 0.5, med(1) - g[1], med(2) - g[2]) < 25;
  };
  const okArm = [0, 1].map((k) => (armOk(RP.arms[k]) ? RP.arms[k] : null));
  // (Not seen: its other arm, read from that arm itself, its sides swapped (a mirror image of it).)
  const parm = [0, 1].map((k) => (okArm[k] ? { A: okArm[k], flip: false } : okArm[1 - k] ? { A: okArm[1 - k], flip: true } : null));
  // Each base arm's place on the piece's: along its bone as far, to its side as far (scaled by the bodies).
  const armMap = (k, x, y) => {
    const B = RB.arms[k]; const PA = parm[k]; if (!B || !PA) return null; const P = PA.A; const fl = PA.flip ? -1 : 1;
    const u = onSeg(x, y, B[0], B[1]); const f = onSeg(x, y, B[1], B[2]);
    // (Upper arm or forearm, blended where they meet at the elbow.)
    const wu = 1 / (1e-3 + u.d * u.d); const wf = 1 / (1e-3 + f.d * f.d);
    const go = (seg, a2, b2, r) => { const dx = b2[0] - a2[0]; const dy = b2[1] - a2[1]; const L = Math.hypot(dx, dy) || 1; const side = r.side * across * fl; return [a2[0] + dx * r.t - (dy / L) * side, a2[1] + dy * r.t + (dx / L) * side]; };
    const pu = go(0, P[0], P[1], u); const pf = go(1, P[1], P[2], f);
    // (The shoulder's cap (the first fifth of the upper arm) is the torso's: the arm takes over past it.)
    const cap = u.t < 0.22 ? (0.22 - u.t) * u.L : 0;
    const sum = wu + wf; return { p: [(pu[0] * wu + pf[0] * wf) / sum, (pu[1] * wu + pf[1] * wf) / sum], d: Math.min(u.d + cap, f.d) };
  };
  // (How near a point is to the torso: 0 inside the shape between the shoulders and hips.)
  const quad = [RB.S[0], RB.S[1], RB.H[1], RB.H[0]];
  const inQuad = (x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = quad[i]; const [xj, yj] = quad[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const torsoDist = (x, y) => (inQuad(x, y) ? 0 : Math.min(...[0, 1, 2, 3].map((i) => onSeg(x, y, quad[i], quad[(i + 1) % 4]).d)));
  const sig = RB.span * 0.12;
  // (Past the torso, by a shoulder: not the torso's warp carried on (it stretches unevenly there, by the two
  // bodies' different shapes, ballooning a sleeve's top into a wing), but evenly, as the bodies' sizes are,
  // turned as the bodies are, from that shoulder.)
  const axB = Math.atan2((RB.H[0][1] + RB.H[1][1]) / 2 - (RB.S[0][1] + RB.S[1][1]) / 2, (RB.H[0][0] + RB.H[1][0]) / 2 - (RB.S[0][0] + RB.S[1][0]) / 2);
  const axP = Math.atan2((RP.H[0][1] + RP.H[1][1]) / 2 - (RP.S[0][1] + RP.S[1][1]) / 2, (RP.H[0][0] + RP.H[1][0]) / 2 - (RP.S[0][0] + RP.S[1][0]) / 2);
  const rc = Math.cos(axP - axB); const rs = Math.sin(axP - axB);
  const fromShoulder = (k, x, y) => { const vx = (x - RB.S[k][0]) * across; const vy = (y - RB.S[k][1]) * across; return [RP.S[k][0] + vx * rc - vy * rs, RP.S[k][1] + vx * rs + vy * rc]; };
  // (A side of the piece its photo hides (its arm behind someone): that whole side read from its other, as a
  // mirror image (the base point mirrored across the base's middle, mapped, its sleeve the other's flipped),
  // so its shoulder, side and sleeve go together as one, not patched in pixel by pixel.)
  const bS = [(RB.S[0][0] + RB.S[1][0]) / 2, (RB.S[0][1] + RB.S[1][1]) / 2]; const bH = [(RB.H[0][0] + RB.H[1][0]) / 2, (RB.H[0][1] + RB.H[1][1]) / 2];
  const bax = bH[0] - bS[0]; const bay = bH[1] - bS[1]; const bal = Math.hypot(bax, bay) || 1;
  const sideOf = (x, y) => ((x - bS[0]) * bay - (y - bS[1]) * bax) / bal; // (signed distance from the base's middle line)
  const sideS0 = Math.sign(sideOf(RB.S[0][0], RB.S[0][1])) || -1;
  const mirB = (x, y) => { const d = sideOf(x, y); return [x - (2 * d * bay) / bal, y + (2 * d * bax) / bal]; };
  const hid = [0, 1].map((k) => !okArm[k] && !!okArm[1 - k]);
  const torsoAt = (x, y) => {
    const T0 = torso(x, y); const d = sideOf(x, y) * sideS0; // (+: the side of shoulder 0)
    const k = d >= 0 ? 0 : 1; if (!hid[k]) return T0;
    // (From a third of the way out to that shoulder: its middle stays its own, not a mirror seam down it.)
    const half = Math.hypot(RB.S[1][0] - RB.S[0][0], RB.S[1][1] - RB.S[0][1]) / 2;
    const t = Math.max(0, Math.min(1, (Math.abs(d) - half * 0.35) / Math.max(1, sig * 0.8))); const bl = t * t * (3 - 2 * t);
    if (bl <= 0) return T0; const [mx, my] = mirB(x, y); const Tm = torso(mx, my);
    return [T0[0] + (Tm[0] - T0[0]) * bl, T0[1] + (Tm[1] - T0[1]) * bl];
  };
  const inv = (x, y) => {
    let T = torsoAt(x, y);
    { const dq = torsoDist(x, y); if (dq > 0) {
      const k = Math.hypot(x - RB.S[0][0], y - RB.S[0][1]) < Math.hypot(x - RB.S[1][0], y - RB.S[1][1]) ? 0 : 1;
      // (Only around the shoulders, above the hips: there the torso's warp is right.)
      const nearS = Math.max(0, 1 - Math.hypot(x - RB.S[k][0], y - RB.S[k][1]) / (RB.span * 0.9));
      const b0 = Math.min(1, dq / (sig * 0.8)); const b = b0 * b0 * (3 - 2 * b0) * Math.min(1, nearS * 2);
      if (b > 0) { let F; if (hid[k]) { const [mx, my] = mirB(x, y); F = fromShoulder(1 - k, mx, my); } else F = fromShoulder(k, x, y); T = [T[0] + (F[0] - T[0]) * b, T[1] + (F[1] - T[1]) * b]; }
    } }
    const dt = torsoDist(x, y); let wt = Math.exp(-((dt / sig) ** 2)); let X = T[0] * wt; let Y = T[1] * wt; let W = wt;
    for (const k of [0, 1]) { const m = armMap(k, x, y); if (!m) continue; const wa = Math.exp(-((m.d / sig) ** 2)); X += m.p[0] * wa; Y += m.p[1] * wa; W += wa; }
    if (W < 1e-6) return [T[0], T[1], 0];
    return [X / W, Y / W, (W - wt) / W];
  };
  const fwd = thinPlate(tp.map(([a, b]) => [b, a]), 0.3); // piece → base (for where it can land)
  const z = garmentZone(S);
  // Where it can land: what was worn there, and where the piece's own box goes.
  const pts = []; const pb = piece.box;
  for (let t = 0; t <= 8; t++) { const fx = pb.x0 + ((pb.x1 - pb.x0) * t) / 8; const fy = pb.y0 + ((pb.y1 - pb.y0) * t) / 8; pts.push(fwd(fx, pb.y0), fwd(fx, pb.y1), fwd(pb.x0, fy), fwd(pb.x1, fy)); }
  let x0 = Math.min(...pts.map((p) => p[0])); let x1 = Math.max(...pts.map((p) => p[0])); let y0 = Math.min(...pts.map((p) => p[1])); let y1 = Math.max(...pts.map((p) => p[1]));
  if (z) { x0 = Math.min(x0, z.box.x0); y0 = Math.min(y0, z.box.y0); x1 = Math.max(x1, z.box.x1); y1 = Math.max(y1, z.box.y1); }
  x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2); x1 = Math.min(w, Math.ceil(x1) + 2); y1 = Math.min(h, Math.ceil(y1) + 2);
  const pw = x1 - x0; const ph = y1 - y0; if (pw < 4 || ph < 4) return null;
  // The warp on a grid every 4 px, between them smoothly.
  const G = 4; const gw = Math.ceil(pw / G) + 1; const gh = Math.ceil(ph / G) + 1; const gx = new Float32Array(gw * gh); const gy = new Float32Array(gw * gh); const gs = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const [sx, sy, sh] = inv(x0 + i * G + 0.5, y0 + j * G + 0.5); gx[j * gw + i] = sx; gy[j * gw + i] = sy; gs[j * gw + i] = sh; }
  const { X0, Y0, bw, bh, val, a, sm, hm, cutY } = E;
  const bil = (arr, ch, X, Y0r) => {
    let Y = Y0r; if (cutY != null && Y > cutY) { const per = 2 * Math.max(4, (cutY - Y0) * 0.35); const t = per > 0 ? (Y - cutY) % per : 0; Y = t < per / 2 ? cutY - t : cutY - (per - t); }
    const fx = X - X0 - 0.5; const fy = Y - Y0 - 0.5;
    if (fx < 0 || fy < 0 || fx > bw - 1.001 || fy > bh - 1.001) return ch ? null : 0;
    const xa = Math.floor(fx); const ya = Math.floor(fy); const tx = fx - xa; const ty = fy - ya; const k = ya * bw + xa;
    if (!ch) return arr[k] * (1 - tx) * (1 - ty) + arr[k + 1] * tx * (1 - ty) + arr[k + bw] * (1 - tx) * ty + arr[k + bw + 1] * tx * ty;
    const o = [0, 0, 0]; for (let c = 0; c < 3; c++) o[c] = arr[k * 3 + c] * (1 - tx) * (1 - ty) + arr[(k + 1) * 3 + c] * tx * (1 - ty) + arr[(k + bw) * 3 + c] * (1 - tx) * ty + arr[(k + bw + 1) * 3 + c] * tx * ty;
    return o;
  };
  // (Mirrored across its body's middle line.)
  const dx = hm[0] - sm[0]; const dy = hm[1] - sm[1]; const dl = Math.hypot(dx, dy) || 1; const ux = dx / dl; const uy = dy / dl;
  const mirror = (X, Y) => { const t = (X - sm[0]) * ux + (Y - sm[1]) * uy; const px = sm[0] + ux * t; const py = sm[1] + uy * t; return [2 * px - X, 2 * py - Y]; };
  const pq = E.quad.map((v) => [v[0], v[1]]); const pcx = pq.reduce((a2, v) => a2 + v[0], 0) / 4; const pcy = pq.reduce((a2, v) => a2 + v[1], 0) / 4;
  const pqs = pq.map(([x, y]) => [pcx + (x - pcx) * 0.85, pcy + (y - pcy) * 0.95]);
  const inPieceTorso = (x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = pqs[i]; const [xj, yj] = pqs[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  // (Not where the zone runs to the bottom of the photo: what's cut off there goes on past it.)
  const zEnd = S.kind === 'upper' && z && z.box.y1 < h - 2 ? z.box.y1 : null; const zFade = Math.max(2, (base.layout?.fh ?? 60) * 0.06);
  // (Below the piece's waist, inside the opening of what it is (between an open jacket's fronts, under a
  // short top), what its model wears there (a belt, jeans) is laid on as it is, where the person wore the
  // garment taken off: not their bare skin carried on down past their waist.)
  const PWp = piece.w; const ppp = piece.people; const texP = E.tex;
  const torsoLen = (RP.H[0][1] + RP.H[1][1]) / 2 - (RP.S[0][1] + RP.S[1][1]) / 2;
  const waistP = (RP.H[0][1] + RP.H[1][1]) / 2 - torsoLen * 0.22;
  const lowerAt = (X, Y) => {
    if (Y < waistP) return null;
    const xi = Math.round(X); const yi = Math.round(Y); if (xi < 0 || yi < 0 || xi >= PWp || yi >= piece.h) return null;
    const i = yi * PWp + xi; if (E.skin[i] || ppp.clothes[i] < 150 || ppp.face[i] >= 60 || ppp.hair[i] >= 60) return null;
    return [texP[i * 4], texP[i * 4 + 1], texP[i * 4 + 2]];
  };
  const smooth = (v) => (v <= 0.25 ? 0 : v >= 0.75 ? 1 : (v - 0.25) / 0.5);
  const rgba = new Uint8ClampedArray(pw * ph * 4); let n = 0;
  for (let y = 0; y < ph; y++) {
    const fj = y / G; const j0 = Math.min(gh - 2, Math.floor(fj)); const tj = fj - j0;
    for (let x = 0; x < pw; x++) {
      const fi = x / G; const i0 = Math.min(gw - 2, Math.floor(fi)); const ti = fi - i0; const g = j0 * gw + i0;
      let sx = (gx[g] * (1 - ti) + gx[g + 1] * ti) * (1 - tj) + (gx[g + gw] * (1 - ti) + gx[g + gw + 1] * ti) * tj;
      let sy = (gy[g] * (1 - ti) + gy[g + 1] * ti) * (1 - tj) + (gy[g + gw] * (1 - ti) + gy[g + gw + 1] * ti) * tj;
      let al = bil(a, false, sx, sy);
      // (Following an arm: its sleeve only, never cloth from inside the piece's torso.)
      const share = (gs[g] * (1 - ti) + gs[g + 1] * ti) * (1 - tj) + (gs[g + gw] * (1 - ti) + gs[g + gw + 1] * ti) * tj;
      if (share > 0.6 && inPieceTorso(sx, sy)) al = 0;
      // (Hidden in its photo but worn on the base there: its other side, mirrored.)
      const sx0 = sx; const sy0 = sy; const inZone = !!z?.mask[(y0 + y) * w + x0 + x];
      if (al < 0.5 && inZone) { const [mx, my] = mirror(sx, sy); const am = bil(a, false, mx, my); if (am > al) { al = am; sx = mx; sy = my; } }
      // (An upper body ends where the zone does: the waist line, as found or moved by hand.)
      if (zEnd != null && y0 + y > zEnd - zFade) al *= Math.max(0, (zEnd - (y0 + y)) / zFade);
      const A = smooth(al);
      if (A < 1 && inZone && S.kind === 'upper' && inPieceTorso(sx0, sy0)) {
        const lc = lowerAt(sx0, sy0);
        if (lc) { const o = (y * pw + x) * 4; const c0 = A > 0 ? bil(val, true, sx, sy) : null; for (let ch = 0; ch < 3; ch++) rgba[o + ch] = c0 ? c0[ch] * A + lc[ch] * (1 - A) : lc[ch]; rgba[o + 3] = 255; n++; continue; }
      }
      if (A <= 0) continue;
      const c = bil(val, true, sx, sy); if (!c) continue;
      const o = (y * pw + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = Math.round(255 * A); n++;
    }
  }
  // (Laid under the cloth: the made skin there, shaped by the piece's; faded in at the piece's skin's edge.)
  // (No slivers: a strip of cloth only a pixel or two thick (the back of its collar glimpsed behind its
  // model's neck) laid on as a thin line across theirs: taken out. A strap or a hem is thicker.)
  {
    const fh = base.layout?.fh ?? h / 7; const r = Math.max(1, Math.round(fh / 90));
    const m = new Uint8Array(pw * ph); for (let k = 0; k < pw * ph; k++) m[k] = rgba[k * 4 + 3] >= 128 ? 1 : 0;
    const er = new Uint8Array(pw * ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      let all = 1; for (let d = -r; d <= r && all; d++) { const yy = y + d; const xx = x + d; if (yy < 0 || yy >= ph || !m[yy * pw + x]) all = 0; else if (xx < 0 || xx >= pw || !m[y * pw + xx]) all = 0; }
      er[y * pw + x] = all;
    }
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const k = y * pw + x; if (!m[k]) continue;
      let near = 0; for (let d = -r; d <= r && !near; d++) { const yy = y + d; const xx = x + d; if ((yy >= 0 && yy < ph && er[yy * pw + x]) || (xx >= 0 && xx < pw && er[y * pw + xx])) near = 1; }
      if (!near) { rgba[k * 4 + 3] = 0; n--; }
    }
  }
  // (No stray scraps: a bit of it on its own, far smaller than the rest (a glimpse of a sleeve's inside below
  // its hem), isn't laid on as a blob on their arm.)
  {
    const fh = base.layout?.fh ?? h / 7; const lab = new Int32Array(pw * ph).fill(-1); const sizes = []; const stack = [];
    for (let k0 = 0; k0 < pw * ph; k0++) {
      if (lab[k0] >= 0 || rgba[k0 * 4 + 3] < 128) continue;
      const id = sizes.length; let cnt = 0; lab[k0] = id; stack.push(k0);
      while (stack.length) { const k = stack.pop(); cnt++; const x = k % pw; const y = (k / pw) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx; const Y = y + dy; if (X < 0 || Y < 0 || X >= pw || Y >= ph) continue; const kk = Y * pw + X; if (lab[kk] < 0 && rgba[kk * 4 + 3] >= 128) { lab[kk] = id; stack.push(kk); } } }
      sizes.push(cnt);
    }
    const big = Math.max(0, ...sizes); const minA = Math.max(60, fh * fh * 0.02);
    if (sizes.length > 1) for (let k = 0; k < pw * ph; k++) { const id = lab[k]; if (id >= 0 && sizes[id] < minA && sizes[id] < big * 0.05) rgba[k * 4 + 3] = 0; }
  }
  return n > 50 ? { x0, y0, pw, ph, rgba, engine: true } : null;
}
