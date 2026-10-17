// Document scanning math, independent of the DOM (images are { data: RGBA bytes, width, height }):
// find the paper, flatten its perspective, and clean it up like a scanner would.

/** Solve A x = b (n×n) by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error('Degenerate corners');
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Homography H (row-major, 9 values, h33 = 1) mapping each from[i] to to[i] (4 points). */
export function homography(from, to) {
  const A = []; const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]; const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...solve(A, b), 1];
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Output size for a quad [tl, tr, br, bl] (pixels): the longer of each pair of opposite edges. */
export function quadSize(q, maxEdge = 2400, maxPixels = 16e6) {
  let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, maxEdge / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
  w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
  return { width: w, height: h };
}

/** Flatten the quad [tl, tr, br, bl] (source pixels) into an outW×outH image (bilinear). */
export function warp(src, quad, outW, outH) {
  const H = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quad);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const { data, width: W, height: Hh } = src;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let [sx, sy] = applyH(H, x + 0.5, y + 0.5);
      sx = Math.min(W - 1.001, Math.max(0, sx - 0.5)); sy = Math.min(Hh - 1.001, Math.max(0, sy - 0.5));
      const x0 = sx | 0; const y0 = sy | 0; const fx = sx - x0; const fy = sy - y0;
      const i00 = (y0 * W + x0) * 4; const i10 = i00 + 4; const i01 = i00 + W * 4; const i11 = i01 + 4;
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * fx;
        const bot = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * fx;
        out[o + c] = top + (bot - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

function luminance(data, n) {
  const L = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = 0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2];
  return L;
}

/** Otsu threshold of a luminance array (0..255). */
export function otsu(L) {
  const hist = new Float64Array(256);
  for (const v of L) hist[Math.min(255, v | 0)] += 1;
  const total = L.length;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0; let wB = 0; let best = 0; let t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB; const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

/**
 * Guess the paper's corners in a (small) image: the largest bright region (paper is usually
 * lighter than what it lies on), then its extreme points along the diagonals. Returns corners
 * normalized 0..1 as [tl, tr, br, bl] and whether it is a confident detection.
 */
export function detectDocument(img) {
  const { width: W, height: H, data } = img;
  const n = W * H;
  const L = luminance(data, n);
  const t = otsu(L);
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = L[i] > t ? 1 : 0;
  // Largest 4-connected bright component.
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let bestId = -1; let bestSize = 0; let id = 0;
  for (let s = 0; s < n; s++) {
    if (!fg[s] || label[s] >= 0) continue;
    let top = 0; stack[top++] = s; label[s] = id; let size = 0;
    while (top) {
      const p = stack[--top]; size += 1;
      const x = p % W; const y = (p / W) | 0;
      if (x > 0 && fg[p - 1] && label[p - 1] < 0) { label[p - 1] = id; stack[top++] = p - 1; }
      if (x < W - 1 && fg[p + 1] && label[p + 1] < 0) { label[p + 1] = id; stack[top++] = p + 1; }
      if (y > 0 && fg[p - W] && label[p - W] < 0) { label[p - W] = id; stack[top++] = p - W; }
      if (y < H - 1 && fg[p + W] && label[p + W] < 0) { label[p + W] = id; stack[top++] = p + W; }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
    id += 1;
  }
  const fallback = { corners: [[0.04, 0.04], [0.96, 0.04], [0.96, 0.96], [0.04, 0.96]], confident: false };
  if (bestId < 0 || bestSize < n * 0.12 || bestSize > n * 0.985) return fallback;
  let tl = [0, 0]; let tr = [0, 0]; let br = [0, 0]; let bl = [0, 0];
  let minS = Infinity; let maxS = -Infinity; let minD = Infinity; let maxD = -Infinity;
  for (let p = 0; p < n; p++) {
    if (label[p] !== bestId) continue;
    const x = p % W; const y = (p / W) | 0;
    const s = x + y; const d = x - y;
    if (s < minS) { minS = s; tl = [x, y]; }
    if (s > maxS) { maxS = s; br = [x, y]; }
    if (d > maxD) { maxD = d; tr = [x, y]; }
    if (d < minD) { minD = d; bl = [x, y]; }
  }
  const corners = [tl, tr, br, bl].map(([x, y]) => [(x + 0.5) / W, (y + 0.5) / H]);
  // Region area with its holes (text, pictures) filled: everything not reachable from the border.
  const outside = new Uint8Array(n);
  let top = 0; let outsideCount = 0;
  const push = (p) => { if (!outside[p] && label[p] !== bestId) { outside[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (top) {
    const p = stack[--top]; outsideCount += 1;
    const x = p % W; const y = (p / W) | 0;
    if (x > 0) push(p - 1); if (x < W - 1) push(p + 1); if (y > 0) push(p - W); if (y < H - 1) push(p + W);
  }
  const filled = n - outsideCount;
  // The quad must match the filled region; otherwise the shape isn't a sheet of paper.
  const quadArea = Math.abs(shoelace(corners.map(([x, y]) => [x * W, y * H])));
  if (quadArea < filled * 0.85 || quadArea > filled * 1.2) return { ...fallback, corners };
  return { corners, confident: true };
}

function shoelace(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i]; const [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; }
  return a / 2;
}

/**
 * Scanner-style cleanup. Estimates the (uneven) paper brightness at low resolution, then divides it
 * out so the paper turns white and shadows disappear while ink stays dark.
 *   'color' whitened background, colors kept · 'gray' · 'bw' black & white · 'original'
 */
export function enhance(img, mode = 'color') {
  if (mode === 'original') return img;
  const { width: W, height: H, data } = img;
  const n = W * H;
  const L = luminance(data, n);
  // Background: brightest-ish level per block (paper, not ink), then smoothed and upsampled.
  const bs = Math.max(8, Math.round(Math.max(W, H) / 48));
  const bw = Math.ceil(W / bs); const bh = Math.ceil(H / bs);
  const bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const vals = [];
      for (let y = by * bs; y < Math.min(H, (by + 1) * bs); y += 2) for (let x = bx * bs; x < Math.min(W, (bx + 1) * bs); x += 2) vals.push(L[y * W + x]);
      vals.sort((a, b) => a - b);
      bg[by * bw + bx] = vals[Math.floor(vals.length * 0.9)] ?? 255;
    }
  }
  const sm = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let s = 0; let c = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = bx + dx; const y = by + dy;
        if (x >= 0 && y >= 0 && x < bw && y < bh) { s += bg[y * bw + x]; c += 1; }
      }
      sm[by * bw + bx] = Math.max(s / c, 24);
    }
  }
  const out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < H; y++) {
    const gy = Math.min(bh - 1.001, Math.max(0, y / bs - 0.5)); const y0 = gy | 0; const fy = gy - y0;
    for (let x = 0; x < W; x++) {
      const gx = Math.min(bw - 1.001, Math.max(0, x / bs - 0.5)); const x0 = gx | 0; const fx = gx - x0;
      const a = sm[y0 * bw + x0]; const b = sm[y0 * bw + Math.min(bw - 1, x0 + 1)];
      const c = sm[Math.min(bh - 1, y0 + 1) * bw + x0]; const d = sm[Math.min(bh - 1, y0 + 1) * bw + Math.min(bw - 1, x0 + 1)];
      const back = (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
      const i = y * W + x; const j = i * 4;
      const k = 255 / back;
      // Normalized lightness with a gentle S-curve to deepen ink.
      const g = Math.min(1, (L[i] * k) / 255);
      const curve = g < 0.9 ? Math.pow(g / 0.9, 1.35) * 0.9 : g;
      if (mode === 'bw') {
        const v = g < 0.72 ? 0 : 255;
        out[j] = out[j + 1] = out[j + 2] = v;
      } else if (mode === 'gray') {
        out[j] = out[j + 1] = out[j + 2] = curve * 255;
      } else {
        const ratio = L[i] > 0 ? (curve * 255) / L[i] : 0;
        out[j] = data[j] * ratio; out[j + 1] = data[j + 1] * ratio; out[j + 2] = data[j + 2] * ratio;
      }
      out[j + 3] = 255;
    }
  }
  if (mode === 'color') whiteBalance(out, n);
  return { data: out, width: W, height: H };
}

/** Make the paper neutral white: scale channels so the average of bright pixels is gray. */
function whiteBalance(out, n) {
  let r = 0; let g = 0; let b = 0; let c = 0;
  for (let i = 0; i < n * 4; i += 16) {
    const l = 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
    if (l > 200) { r += out[i]; g += out[i + 1]; b += out[i + 2]; c += 1; }
  }
  if (c < 50) return;
  const target = Math.max(r, g, b) / c;
  const gain = [r, g, b].map((v) => Math.min(1.35, Math.max(0.8, target / (v / c))));
  for (let i = 0; i < n * 4; i += 4) {
    out[i] *= gain[0]; out[i + 1] *= gain[1]; out[i + 2] *= gain[2];
  }
}
