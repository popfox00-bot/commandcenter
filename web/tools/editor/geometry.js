// Pure geometry for the photo editor (no DOM). Coordinate spaces:
//   source   s ∈ [0,1]²  the decoded image (EXIF orientation already applied)
//   oriented o ∈ [0,1]²  after quarter turns (rotate, clockwise) and flips
//   frame    f ∈ [0,1]²  oriented image straightened by `straighten` degrees and zoomed just enough
//                        to leave no empty corners (like iPhone Photos). Same pixel size as oriented.
//   output   u ∈ [0,1]²  the crop rectangle of the frame; what gets displayed/exported
// Crop rectangles and markup live in frame coordinates, so they move with rotations and flips.

export const FULL_CROP = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });
const MIN_CROP = 0.05;

/** Pixel size of the oriented image. */
export function orientedSize(srcW, srcH, rotate) {
  return rotate % 2 ? { W: srcH, H: srcW } : { W: srcW, H: srcH };
}

/** Zoom that makes a W×H image rotated by `deg` cover the whole W×H frame. */
export function coverScale(W, H, deg) {
  const t = Math.abs(deg) * Math.PI / 180;
  return Math.cos(t) + Math.sin(t) * Math.max(W / H, H / W);
}

// 3×3 affine matrices, row-major [a b c; d e f; 0 0 1] stored as [a,b,c,d,e,f].
const mul = (A, B) => [
  A[0] * B[0] + A[1] * B[3], A[0] * B[1] + A[1] * B[4], A[0] * B[2] + A[1] * B[5] + A[2],
  A[3] * B[0] + A[4] * B[3], A[3] * B[1] + A[4] * B[4], A[3] * B[2] + A[4] * B[5] + A[5],
];
export const apply = (M, x, y) => [M[0] * x + M[1] * y + M[2], M[3] * x + M[4] * y + M[5]];

/** Oriented → source for `rotate` clockwise quarter turns (undoing them). */
function orientedToSource(rotate) {
  switch (((rotate % 4) + 4) % 4) {
    case 1: return [0, 1, 0, -1, 0, 1];   // s = (oy, 1-ox)
    case 2: return [-1, 0, 1, 0, -1, 1];  // s = (1-ox, 1-oy)
    case 3: return [0, -1, 1, 1, 0, 0];   // s = (1-oy, ox)
    default: return [1, 0, 0, 0, 1, 0];
  }
}

/**
 * Matrix mapping output uv (0..1, origin top-left) to source texture uv for a geometry
 * { rotate, flipH, flipV, straighten, crop } and source pixel size.
 */
export function outputToSource(g, srcW, srcH) {
  const { W, H } = orientedSize(srcW, srcH, g.rotate);
  const c = g.crop ?? FULL_CROP;
  const t = (g.straighten || 0) * Math.PI / 180;
  const s = coverScale(W, H, g.straighten || 0);
  const cos = Math.cos(t) / s;
  const sin = Math.sin(t) / s;
  const uvToFrame = [c.w, 0, c.x, 0, c.h, c.y];
  const frameToPx = [W, 0, 0, 0, H, 0];
  // q = center + R(-θ)(p - center)/s ; R(-θ) = [cos sin; -sin cos]
  const cx = W / 2; const cy = H / 2;
  const unstraighten = [cos, sin, cx - cos * cx - sin * cy, -sin, cos, cy + sin * cx - cos * cy];
  const pxToOriented = [1 / W, 0, 0, 0, 1 / H, 0];
  const unflip = [g.flipH ? -1 : 1, 0, g.flipH ? 1 : 0, 0, g.flipV ? -1 : 1, g.flipV ? 1 : 0];
  return [orientedToSource(g.rotate), unflip, pxToOriented, unstraighten, frameToPx, uvToFrame].reduce(mul);
}

/** Output pixel size for the crop at full resolution (before any max-size limit). */
export function outputPixelSize(g, srcW, srcH) {
  const { W, H } = orientedSize(srcW, srcH, g.rotate);
  const c = g.crop ?? FULL_CROP;
  return { width: Math.max(1, Math.round(c.w * W)), height: Math.max(1, Math.round(c.h * H)) };
}

/** Largest centered crop with pixel aspect `ratio` (w/h) inside a W×H frame. */
export function cropForRatio(ratio, W, H) {
  if (!ratio) return { ...FULL_CROP };
  let w = 1; let h = 1;
  if (W / H > ratio) w = (ratio * H) / W; else h = W / (ratio * H);
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Keep a crop inside the frame and above the minimum size. */
export function clampCrop(c) {
  const w = clamp(c.w, MIN_CROP, 1);
  const h = clamp(c.h, MIN_CROP, 1);
  return { x: clamp(c.x, 0, 1 - w), y: clamp(c.y, 0, 1 - h), w, h };
}

/**
 * Drag a crop handle. handle: 'move' | 'n' 's' 'e' 'w' | 'nw' 'ne' 'sw' 'se'. dx/dy in frame units.
 * With `ratio` (pixel w/h) and frame size, corner drags keep the aspect ratio.
 */
export function dragCrop(start, handle, dx, dy, ratio, W, H) {
  if (handle === 'move') return clampCrop({ ...start, x: start.x + dx, y: start.y + dy });
  let x0 = start.x; let y0 = start.y; let x1 = start.x + start.w; let y1 = start.y + start.h;
  if (handle.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN_CROP);
  if (handle.includes('e')) x1 = clamp(x1 + dx, x0 + MIN_CROP, 1);
  if (handle.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN_CROP);
  if (handle.includes('s')) y1 = clamp(y1 + dy, y0 + MIN_CROP, 1);
  if (ratio) {
    // Normalized aspect: w/h in frame units that gives the pixel ratio.
    const r = (ratio * H) / W;
    let w = x1 - x0; let h = y1 - y0;
    if (handle.length === 1) { if ('ns'.includes(handle)) w = h * r; else h = w / r; }
    else if (w / h > r) w = h * r; else h = w / r;
    // Shrink to fit inside the frame from the anchored side.
    const anchorX = handle.includes('w') ? x1 : handle.includes('e') ? x0 : (x0 + x1) / 2;
    const anchorY = handle.includes('n') ? y1 : handle.includes('s') ? y0 : (y0 + y1) / 2;
    const maxW = handle.includes('w') ? anchorX : handle.includes('e') ? 1 - anchorX : 2 * Math.min(anchorX, 1 - anchorX);
    const maxH = handle.includes('n') ? anchorY : handle.includes('s') ? 1 - anchorY : 2 * Math.min(anchorY, 1 - anchorY);
    const k = Math.min(1, maxW / w, maxH / h);
    w *= k; h *= k;
    x0 = handle.includes('w') ? anchorX - w : handle.includes('e') ? anchorX : anchorX - w / 2;
    y0 = handle.includes('n') ? anchorY - h : handle.includes('s') ? anchorY : anchorY - h / 2;
    return clampCrop({ x: x0, y: y0, w, h });
  }
  return clampCrop({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

// ---- keeping crop and markup attached to the picture when it is rotated or flipped ----

const rotPoint = ([x, y]) => [1 - y, x];               // 90° clockwise in normalized coords
const flipPointH = ([x, y]) => [1 - x, y];
const flipPointV = ([x, y]) => [x, 1 - y];

function mapItem(item, fn) {
  const out = { ...item };
  if (item.points) out.points = item.points.map(fn);
  if ('x1' in item) { [out.x1, out.y1] = fn([item.x1, item.y1]); [out.x2, out.y2] = fn([item.x2, item.y2]); }
  if ('x' in item && !item.points) [out.x, out.y] = fn([item.x, item.y]);
  return out;
}

function mapRect(c, fn) {
  const [ax, ay] = fn([c.x, c.y]);
  const [bx, by] = fn([c.x + c.w, c.y + c.h]);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** State after a quarter turn clockwise: crop, markup and flips follow the picture. */
export function rotateClockwise(state) {
  return {
    ...state,
    rotate: (state.rotate + 1) % 4,
    flipH: state.flipV, flipV: state.flipH, // a turn swaps which flip is horizontal
    crop: mapRect(state.crop, rotPoint),
    markup: state.markup.map((m) => mapItem(m, rotPoint)),
  };
}

export function flipHorizontal(state) {
  return {
    ...state,
    flipH: !state.flipH,
    straighten: -state.straighten,
    crop: mapRect(state.crop, flipPointH),
    markup: state.markup.map((m) => mapItem(m, flipPointH)),
  };
}

export function flipVertical(state) {
  return {
    ...state,
    flipV: !state.flipV,
    straighten: -state.straighten,
    crop: mapRect(state.crop, flipPointV),
    markup: state.markup.map((m) => mapItem(m, flipPointV)),
  };
}
