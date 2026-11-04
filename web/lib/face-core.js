// Faces, the geometry (no DOM): a face's eyes and mouth from its 68 landmark points, the turn that levels
// it (eyes level, above the mouth) as the photo editor's rotate and straighten, and where a mask or a
// Character goes to cover it. Points are in 0..1 of the picture they were found in.

const mean = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

/**
 * A face from its box and its 68 landmarks (iBUG layout: 36–41 one eye, 42–47 the other, 48–67 the
 * mouth, 30 the nose tip), in pixels of a w×h picture: { box, eyes: [a, b] (a on the picture's left
 * when upright), mouth, nose, angle (the eye line's slope, degrees, clockwise), size, pts (all 68) } in 0..1.
 */
export function faceFrom(box, landmarks, w, h, score = 1) {
  const n = (p) => [p[0] / w, p[1] / h];
  let a = n(mean(landmarks.slice(36, 42))); let b = n(mean(landmarks.slice(42, 48)));
  const mouth = n(mean(landmarks.slice(48, 68))); const nose = n(landmarks[30]);
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // Order the eyes so that going a→b, the mouth is on the right-hand side (below, when upright).
  const cross = (b[0] - a[0]) * ((mouth[1] - mid[1]) * h) - (b[1] - a[1]) * ((mouth[0] - mid[0]) * w);
  if (cross < 0) [a, b] = [b, a];
  const angle = (Math.atan2((b[1] - a[1]) * h, (b[0] - a[0]) * w) * 180) / Math.PI;
  return { box: { x: box.x / w, y: box.y / h, w: box.width / w, h: box.height / h }, eyes: [a, b], mouth, nose, angle, score, size: Math.max(box.width / w, box.height / h), pts: landmarks.map(n) };
}

/**
 * Faces found in the same place twice (from tries at different turns): the one found most upright kept
 * (its eyes and mouth placed best), then the surer one.
 */
export function dedupe(faces) {
  const out = [];
  for (const f of [...faces].sort((x, y) => (x.tilt ?? 0) - (y.tilt ?? 0) || y.score - x.score)) {
    const c = [f.box.x + f.box.w / 2, f.box.y + f.box.h / 2];
    if (!out.some((g) => Math.hypot(g.box.x + g.box.w / 2 - c[0], g.box.y + g.box.h / 2 - c[1]) < Math.max(g.box.w, g.box.h) * 0.8)) out.push(f);
  }
  return out;
}

/** The biggest face (the one a photo is usually of). */
export const mainFace = (faces) => faces.reduce((best, f) => (!best || f.box.w * f.box.h > best.box.w * best.box.h ? f : best), null);

/** A point in 0..1 of the picture turned by `deg` clockwise (w×h before turning) back to the unturned picture. */
export function unturn([u, v], deg, w, h) {
  const t = (deg * Math.PI) / 180; const c = Math.cos(t); const s = Math.sin(t);
  // The turned canvas is big enough for the whole picture: (W, H).
  const W = Math.abs(w * c) + Math.abs(h * s); const H = Math.abs(w * s) + Math.abs(h * c);
  const x = u * W - W / 2; const y = v * H - H / 2;
  // Undo a clockwise turn (y down): rotate by -t.
  const ox = x * c + y * s; const oy = -x * s + y * c;
  return [(ox + w / 2) / w, (oy + h / 2) / h];
}

/**
 * Rotate and straighten (the photo editor's: quarter turns clockwise, and degrees) that level a face
 * found in the source photo: its eyes level, above its mouth. `map(state, [u, v])` takes a source
 * point to where it shows (in pixels of the output) for a state; the turn is found through it, so flips and
 * the editor's own conventions are taken as they are. Returns { rotate, straighten } or null.
 */
export function levelTurn(face, state, map) {
  let best = null;
  for (let k = 0; k < 4; k++) {
    const base = { ...state, rotate: k, straighten: 0, crop: { x: 0, y: 0, w: 1, h: 1 } };
    // The eye line's slope, as a line (either way along it: a mirrored photo swaps the eyes), -90..90.
    const line = (d) => (d > 90 ? d - 180 : d < -90 ? d + 180 : d);
    const slope = (st) => { const a = map(st, face.eyes[0]); const b = map(st, face.eyes[1]); return line((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI); };
    const a0 = slope(base);
    // Straightening by s turns the eye line by ±s: try both, keep the one that levels it.
    for (const s of [-a0, a0]) {
      if (Math.abs(s) > 45) continue;
      const st = { ...base, straighten: s };
      const a = map(st, face.eyes[0]); const b = map(st, face.eyes[1]); const m = map(st, face.mouth);
      const level = Math.abs(line(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI));
      const upright = m[1] > (a[1] + b[1]) / 2;
      if (level < 1.5 && upright && (!best || Math.abs(s) < Math.abs(best.straighten))) best = { rotate: k, straighten: Math.round(s * 10) / 10 };
    }
  }
  return best;
}

/**
 * Where a mask or a Character goes to cover a face, as a collage layer on that picture: { x, y }
 * (its center, 0..1), `scale` (its width as a share of the picture's width) and `rot` (radians), for
 * an image of aspect `aspect` (width/height); `fill` how much bigger than the face it is.
 */
export function maskLayer(face, aspect, picAspect, fill = 1.35) {
  const mid = [(face.eyes[0][0] + face.eyes[1][0]) / 2, (face.eyes[0][1] + face.eyes[1][1]) / 2];
  // The face's middle: between the eyes and the mouth, a little toward the eyes (the forehead counts).
  const c = [mid[0] + (face.mouth[0] - mid[0]) * 0.35, mid[1] + (face.mouth[1] - mid[1]) * 0.35];
  const rot = (face.angle * Math.PI) / 180;
  // The face's width and height in picture widths; the mask covers both.
  const fw = face.box.w * fill; const fh = (face.box.h / picAspect) * fill;
  const scale = Math.max(fw, fh * aspect);
  return { x: c[0], y: c[1], scale, rot };
}

/**
 * An outline around a face's head for a w×h picture: an oval turned with the face, centred a little
 * above the middle of the face (the forehead and some hair count) and wide enough for the cheeks and
 * ears, as `n` points in 0..1 of the picture. A starting trace for a cutout: smart edges then bring it
 * in to the head's own edge.
 */
export function faceOutline(face, w, h, n = 48) {
  const bw = face.box.w * w; const bh = face.box.h * h;
  const t = (face.angle * Math.PI) / 180; const c = Math.cos(t); const s = Math.sin(t);
  const mid = [((face.eyes[0][0] + face.eyes[1][0]) / 2) * w, ((face.eyes[0][1] + face.eyes[1][1]) / 2) * h];
  const mouth = [face.mouth[0] * w, face.mouth[1] * h];
  // Eyes to mouth is about a third of the head's height; the head's middle is a little above the eyes.
  const em = Math.hypot(mouth[0] - mid[0], mouth[1] - mid[1]) || bh * 0.35;
  const ry = Math.max(bh * 0.72, em * 2.1); const rx = Math.max(bw * 0.62, ry * 0.74);
  const down = [-s, c]; // the face's "down", in the picture
  const cx = mid[0] + down[0] * em * 0.25; const cy = mid[1] + down[1] * em * 0.25;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI; const x = rx * Math.cos(a); const y = ry * Math.sin(a);
    return [Math.min(1, Math.max(0, (cx + x * c - y * s) / w)), Math.min(1, Math.max(0, (cy + x * s + y * c) / h))];
  });
}

/**
 * The least-squares similarity (scale, turn and shift; no stretch or mirror) taking the points `from`
 * onto `to` (in pairs, two or more; each counted by its `weights`): { s, rot, tx, ty }, so
 * p → s·R(rot)·p + t.
 */
export function similarityFit(from, to, weights = from.map(() => 1)) {
  const n = from.length; const W = weights.reduce((a, w) => a + w, 0);
  const fm = [0, 1].map((k) => from.reduce((a, p, i) => a + p[k] * weights[i], 0) / W);
  const tm = [0, 1].map((k) => to.reduce((a, p, i) => a + p[k] * weights[i], 0) / W);
  let a = 0; let b = 0; let den = 0;
  for (let i = 0; i < n; i++) {
    const fx = from[i][0] - fm[0]; const fy = from[i][1] - fm[1]; const tx = to[i][0] - tm[0]; const ty = to[i][1] - tm[1];
    const w = weights[i];
    a += w * (fx * tx + fy * ty); b += w * (fx * ty - fy * tx); den += w * (fx * fx + fy * fy);
  }
  const s = den ? Math.hypot(a, b) / den : 1; const rot = Math.atan2(b, a);
  const c = Math.cos(rot) * s; const si = Math.sin(rot) * s;
  return { s, rot, tx: tm[0] - (c * fm[0] - si * fm[1]), ty: tm[1] - (si * fm[0] + c * fm[1]) };
}
/** A point through a similarity from similarityFit. */
export const throughFit = (m, [x, y]) => [m.s * (Math.cos(m.rot) * x - Math.sin(m.rot) * y) + m.tx, m.s * (Math.sin(m.rot) * x + Math.cos(m.rot) * y) + m.ty];

/**
 * Where a Character that has a face in it (`charFace`, found in its cw×ch image) goes to cover `face`
 * in a W×H picture: the middle of its eyes on the middle of the face's eyes, turned so its eye line
 * lies along the face's, and sized mostly by the eyes' spacing (and a little by the eyes-to-mouth
 * length, so a face seen from the side isn't made tiny). { x, y (its center), width, rot (radians) }
 * in the picture's pixels.
 */
export function alignOnFace(charFace, cw, ch, face, W, H) {
  const px = (f, w, h) => ({ a: [f.eyes[0][0] * w, f.eyes[0][1] * h], b: [f.eyes[1][0] * w, f.eyes[1][1] * h], m: [f.mouth[0] * w, f.mouth[1] * h] });
  const c = px(charFace, cw, ch); const t = px(face, W, H);
  const mid = (p) => [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2];
  const cm = mid(c); const tm = mid(t);
  const eyes = (p) => Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
  const drop = (p, m) => Math.hypot(p.m[0] - m[0], p.m[1] - m[1]);
  const kEyes = eyes(t) / (eyes(c) || 1); const kMouth = drop(t, tm) / (drop(c, cm) || 1);
  const s = Math.exp(0.7 * Math.log(kEyes) + 0.3 * Math.log(kMouth));
  const rot = Math.atan2(t.b[1] - t.a[1], t.b[0] - t.a[0]) - Math.atan2(c.b[1] - c.a[1], c.b[0] - c.a[0]);
  // The Character's center, from its eye middle, turned and scaled onto the face's eye middle.
  const dx = cw / 2 - cm[0]; const dy = ch / 2 - cm[1]; const co = Math.cos(rot); const si = Math.sin(rot);
  return { x: tm[0] + s * (dx * co - dy * si), y: tm[1] + s * (dx * si + dy * co), width: s * cw, rot };
}
