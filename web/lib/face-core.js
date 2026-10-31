// Faces, the geometry (no DOM): a face's eyes and mouth from its 68 landmark points, the turn that levels
// it (eyes level, above the mouth) as the photo editor's rotate and straighten, and where a mask or a
// Character goes to cover it. Points are in 0..1 of the picture they were found in.

const mean = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

/**
 * A face from its box and its 68 landmarks (iBUG layout: 36–41 one eye, 42–47 the other, 48–67 the
 * mouth, 30 the nose tip), in pixels of a w×h picture: { box, eyes: [a, b] (a on the picture's left
 * when upright), mouth, nose, angle (the eye line's slope, degrees, clockwise), size } in 0..1.
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
  return { box: { x: box.x / w, y: box.y / h, w: box.width / w, h: box.height / h }, eyes: [a, b], mouth, nose, angle, score, size: Math.max(box.width / w, box.height / h) };
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
