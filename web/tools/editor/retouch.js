// Overlay icons: the buttons apps draw on top of a post's media, each in its own corner: the "tagged
// people" button (a person symbol) bottom left, the sound button (a speaker symbol) bottom right, both
// a see-through gray disc with a white symbol, and the carousel counter pill ("11/13", white text on a
// see-through gray pill) top right. Auto-Crop finds them by their white symbol or text, whatever the
// background, and fills each one in with background copied from just beside it, blended seamlessly.
//
// The fill is a retouch patch kept in the edit state (`state.patches`), in source-image coordinates,
// so the original is never changed: patches are painted onto the source before every other edit
// (preview, export, bulk), and undo removes them. A patch is { x, y, w, h } (0..1 of the source),
// its pixel size { pw, ph } and RGBA pixels as base64 (`data`; transparent outside the disc).
// Detection and filling are pure (RGBA in, circles and pixels out); applyPatches() needs a canvas.

export const ICON_DEFAULTS = Object.freeze({
  rMin: 0.015,     // icon radius, as a share of the image width: from 1.5%...
  rMax: 0.06,      // ...to 6% (Instagram's are ~3.6% on a phone screenshot)
  zone: 0.3,       // icons are looked for in each corner of the media, this share of the width square
  edge: 20,        // the disc is at least this much darker (luminance) than just outside it...
  ring: 0.8,       // ...all the way around: on at least 80% of the circle
  flat: 14,        // the disc itself is flat: 80% of its rim within this luminance of the rim's median
  glyphMin: 0.04,  // the white symbol fills 4%...
  glyphMax: 0.6,   // ...to 60% of the disc's middle
  margin: 0.08,    // the fill covers the disc plus this share of its radius (soft edge), at least 2 px
  pillMin: 0.025,  // counter pill height, as a share of the image width: from 2.5%...
  pillMax: 0.1,    // ...to 10% (Instagram's is ~6% on a phone screenshot)
  pillCorner: 0.09, // ...and at most this share of the width from the media's top and right edges
  pillEdge: 12,    // the pill is see-through, so it's only this much darker than just outside it
  faint: 5,        // from the symbol out, the disc only needs to be this much darker than around it
  match: 0.72,     // a white symbol is the person or speaker when its shape correlates this well
  glyphRatio: 0.835, // the symbol is this share of the disc's radius across (measured on real buttons)
});

// The white symbols, as 16×16 coverage grids (0-f), measured from real screenshots of the buttons.
const PERSON = `000006ffff600000 00007ffffff70000 0002dffffffd2000 0004ffffffff4000 0004ffffffff4000 0002dffffffd2000
00007ffffff70000 0000018ff8100000 0000000000000000 0000288cf8820000 003affffffffa300 03effffffffffe70 4ffffffffffffff4
ffffffffffffffff bffffffffffffffb 078effffffffe870`;
const MUTED = `8700007f40000000 ffa007ff40000000 3efa7fff40003c50 04efffff40115fc1 104effff43ea0df8 8604efff42df35fd
8f604eff407f90ef 8ff604efa15f90ef 8fff604efa6f90ef 8ffff604efdf72ef 8fffff604eff29f9 8ffffff604efaef5 1223dfff304eff90
00002dff4004efb0 000002df40004ef7 00000028200003f8`;
const parseGrid = (t) => Float32Array.from(t.replace(/\s+/g, ''), (c) => parseInt(c, 16) / 15);
/** A speaker with sound waves (sound on): drawn, as no screenshot of it was at hand. */
function soundOnGrid() {
  const g = new Float32Array(256);
  for (let j = 0; j < 16; j++) {
    for (let i = 0; i < 16; i++) {
      let hit = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const x = (i + (sx + 0.5) / 4) / 16; const y = (j + (sy + 0.5) / 4) / 16;
          const box = x < 0.22 && Math.abs(y - 0.5) < 0.17;
          const cone = x >= 0.22 && x < 0.5 && Math.abs(y - 0.5) < 0.17 + (x - 0.22) * 1.2;
          const d = Math.hypot(x - 0.45, y - 0.5);
          const waves = x > 0.58 && (Math.abs(d - 0.28) < 0.05 || Math.abs(d - 0.5) < 0.05) && Math.abs(y - 0.5) < 0.42;
          if (box || cone || waves) hit++;
        }
      }
      g[j * 16 + i] = hit / 16;
    }
  }
  return g;
}
const TEMPLATES = { person: [parseGrid(PERSON)], sound: [parseGrid(MUTED), soundOnGrid()] };

/** Pearson correlation of two grids. */
function correlate(a, b) {
  let ma = 0; let mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= b.length;
  let ab = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma; const y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

/** White, neutral pixels in groups (the parts of one symbol, or the letters of one word). */
function whiteGroups(rgba, w, h, L, maxSize, join, minL = 190) {
  const white = (i) => L[i] >= minL && Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) - Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) <= 45;
  const seen = new Uint8Array(w * h); const parts = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !white(i)) continue;
    let x0 = w; let x1 = 0; let y0 = h; let y1 = 0; let n = 0; let sx = 0; let sy = 0; let sxy = 0; let sxx = 0; let syy = 0;
    const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const j = stack.pop(); const x = j % w; const y = (j - x) / w; n++;
      sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !seen[j - 1] && white(j - 1)) { seen[j - 1] = 1; stack.push(j - 1); }
      if (x < w - 1 && !seen[j + 1] && white(j + 1)) { seen[j + 1] = 1; stack.push(j + 1); }
      if (y > 0 && !seen[j - w] && white(j - w)) { seen[j - w] = 1; stack.push(j - w); }
      if (y < h - 1 && !seen[j + w] && white(j + w)) { seen[j + w] = 1; stack.push(j + w); }
    }
    if (n < 3 || x1 - x0 >= maxSize || y1 - y0 >= maxSize) continue;
    // How diagonal the part is ("/" in "11/13"): the x–y correlation of its pixels.
    const cov = sxy / n - (sx / n) * (sy / n); const vx = sxx / n - (sx / n) ** 2; const vy = syy / n - (sy / n) ** 2;
    parts.push({ x0, x1: x1 + 1, y0, y1: y1 + 1, n, slant: vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0 });
  }
  const groups = parts.map((p) => ({ ...p, parts: [p] }));
  for (let merged = true; merged;) {
    merged = false;
    for (let a = 0; a < groups.length && !merged; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const A = groups[a]; const B = groups[b];
        const gap = join(A, B);
        if (B.x0 <= A.x1 + gap && B.x1 >= A.x0 - gap && B.y0 <= A.y1 + gap && B.y1 >= A.y0 - gap) {
          groups[a] = { x0: Math.min(A.x0, B.x0), x1: Math.max(A.x1, B.x1), y0: Math.min(A.y0, B.y0), y1: Math.max(A.y1, B.y1), n: A.n + B.n, parts: [...A.parts, ...B.parts] };
          groups.splice(b, 1); merged = true; break;
        }
      }
    }
  }
  return groups;
}

/**
 * The person and speaker buttons, found by their white symbol's shape (whatever the background):
 * white groups of a button's size whose 16×16 coverage correlates with a symbol template. The disc is
 * then where the symbol says it is (centered on it, symbol/0.835 in radius), fitted to its edge where
 * that edge shows. `kinds`: which symbols to accept. Returns [{ cx, cy, r, kind }] in pixels.
 */
export function findSymbols(rgba, w, h, { rMin, rMax, kinds = ['person', 'sound'], ...opts }) {
  const cfg = { ...ICON_DEFAULTS, ...opts };
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lum(rgba, i * 4);
  const sMin = rMin * cfg.glyphRatio * 0.8; const sMax = rMax * cfg.glyphRatio * 1.2;
  const out = [];
  // White is looked for twice: from light gray up (a symbol softened by compression), then only
  // near-pure white, which the symbol is and a photo's light parts next to it (a white stripe, a
  // bright window) mostly aren't, so the symbol isn't lumped in with them.
  const join = (A, B) => Math.max(2, 0.25 * Math.max(A.x1 - A.x0, A.y1 - A.y0, B.x1 - B.x0, B.y1 - B.y0));
  const groups = [...whiteGroups(rgba, w, h, L, sMax * 1.2, join), ...whiteGroups(rgba, w, h, L, sMax * 1.2, join, 235)];
  for (const g of groups) {
    const gw = g.x1 - g.x0; const gh = g.y1 - g.y0; const size = Math.max(gw, gh);
    if (size < sMin || size > sMax || gw / gh < 0.7 || gw / gh > 1.45) continue;
    // Coverage grid of the symbol's box (soft: anti-aliased edges count partly).
    const grid = new Float32Array(256);
    for (let j = 0; j < 16; j++) {
      for (let i = 0; i < 16; i++) {
        let s = 0; let n = 0;
        for (let y = Math.floor(g.y0 + (gh * j) / 16); y < Math.max(Math.floor(g.y0 + (gh * j) / 16) + 1, Math.floor(g.y0 + (gh * (j + 1)) / 16)); y++) {
          for (let x = Math.floor(g.x0 + (gw * i) / 16); x < Math.max(Math.floor(g.x0 + (gw * i) / 16) + 1, Math.floor(g.x0 + (gw * (i + 1)) / 16)); x++) {
            s += Math.max(0, Math.min(1, (L[y * w + x] - 110) / 100)); n++;
          }
        }
        grid[j * 16 + i] = s / n;
      }
    }
    let best = null;
    for (const kind of kinds) for (const t of TEMPLATES[kind]) { const c = correlate(grid, t); if (!best || c > best.score) best = { kind, score: c }; }
    if (!best || best.score < cfg.match) continue;
    const cx = (g.x0 + g.x1) / 2; const cy = (g.y0 + g.y1) / 2;
    let r = size / cfg.glyphRatio;
    // Fit the disc's edge where it shows: the radius where the ring just inside is darker than outside.
    const at = (x, y) => { const xi = Math.round(x); const yi = Math.round(y); return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : L[yi * w + xi]; };
    // (Several radii near the edge pass; the strongest step across, right at the line, is the edge.)
    let fit = null;
    for (let rr = Math.floor(r * 0.88); rr <= Math.ceil(r * 1.15); rr += 0.5) {
      let pass = 0; let step = 0; let ok = true;
      for (const [ux, uy] of A64) {
        let a = 0; let b = 0;
        for (let k = 1; k <= 3 && ok; k++) { const ai = at(cx + (rr - k) * ux, cy + (rr - k) * uy); const bi = at(cx + (rr + k) * ux, cy + (rr + k) * uy); if (ai < 0 || bi < 0) ok = false; a += ai; b += bi; }
        if (!ok) break;
        if ((b - a) / 3 >= cfg.faint) pass++;
        step += at(cx + (rr + 1) * ux, cy + (rr + 1) * uy) - at(cx + (rr - 1) * ux, cy + (rr - 1) * uy);
      }
      if (ok && pass / 64 >= 0.6 && (!fit || pass > fit.pass + 2 || (pass >= fit.pass - 2 && step > fit.step))) fit = { rr, pass, step };
    }
    if (fit) r = fit.rr;
    if (out.some((o) => Math.hypot(o.cx - cx, o.cy - cy) < o.r / 2)) continue; // found on the first look
    out.push({ cx: Math.round(cx * 10) / 10, cy: Math.round(cy * 10) / 10, r: Math.round(r * 10) / 10, kind: best.kind, fitted: !!fit });
  }
  return out;
}

const lum = (p, i) => 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];

/** Luminance of an RGBA image, area-averaged down by an integer factor f. */
function lumMap(rgba, w, h, f) {
  const lw = Math.floor(w / f); const lh = Math.floor(h / f);
  const out = new Float32Array(lw * lh);
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += lum(rgba, ((y * f + dy) * w + x * f + dx) * 4);
      out[y * lw + x] = s / (f * f);
    }
  }
  return { L: out, w: lw, h: lh };
}

const ANGLES = (n) => Array.from({ length: n }, (_, i) => [Math.cos((2 * Math.PI * i) / n), Math.sin((2 * Math.PI * i) / n)]);
const A8 = ANGLES(8); const A16 = ANGLES(16); const A32 = ANGLES(32); const A64 = ANGLES(64);

/**
 * Overlay-icon circles in an RGBA image (w×h). `rMin`/`rMax` are radii in pixels. Returns
 * [{ cx, cy, r }] in pixels, strongest first. A circle must be a flat disc clearly darker than its
 * surroundings all the way around, with a white symbol in its middle.
 */
export function findIcons(rgba, w, h, { rMin, rMax, ...opts }) {
  const cfg = { ...ICON_DEFAULTS, ...opts };
  const f = Math.max(1, Math.floor(rMax / 12)); // coarse search scale (small buttons: the symbol-first path)
  const M = lumMap(rgba, w, h, f);
  const at = (x, y) => { const xi = Math.round(x); const yi = Math.round(y); return xi < 0 || yi < 0 || xi >= M.w || yi >= M.h ? -1 : M.L[yi * M.w + xi]; };
  const r0 = Math.max(3, Math.floor(rMin / f)); const r1 = Math.max(r0, Math.ceil(rMax / f));
  // Quick pre-check on 8 directions: darker inside than outside on at least 6.
  const quick = (cx, cy, r) => {
    let pass = 0;
    for (let i = 0; i < 8; i++) {
      const [ux, uy] = A8[i];
      if (at(cx + (r + 1.5) * ux, cy + (r + 1.5) * uy) - at(cx + (r - 1.5) * ux, cy + (r - 1.5) * uy) >= cfg.edge) pass++;
      else if (i - pass >= 2) return false;
    }
    return pass >= 6;
  };
  const ringTest = (cx, cy, r, dirs) => {
    let pass = 0; const inner = [];
    for (const [ux, uy] of dirs) {
      const a = at(cx + (r - 1.5) * ux, cy + (r - 1.5) * uy); const b = at(cx + (r + 1.5) * ux, cy + (r + 1.5) * uy);
      if (a < 0 || b < 0) return null;
      if (b - a >= cfg.edge) pass++;
      inner.push(a);
    }
    // Flat: most of the rim within `flat` of its median (a symbol touching the rim is fine).
    inner.sort((p, q) => p - q);
    const med = inner[inner.length >> 1];
    const flat = inner.filter((v) => Math.abs(v - med) <= cfg.flat).length / inner.length;
    return { share: pass / dirs.length, flat };
  };
  const found = [];
  for (let cy = r0; cy < M.h - r0; cy++) {
    for (let cx = r0; cx < M.w - r0; cx++) {
      for (let r = r0; r <= r1; r++) {
        if (cx - r - 2 < 0 || cy - r - 2 < 0 || cx + r + 2 >= M.w || cy + r + 2 >= M.h) break;
        if (!quick(cx, cy, r)) continue;
        const t = ringTest(cx, cy, r, A32);
        if (t && t.share >= cfg.ring && t.flat >= cfg.ring) found.push({ cx: cx * f, cy: cy * f, r: r * f, score: t.share + t.flat });
      }
    }
  }
  // Strongest first, grouped by spot; refine up to three per spot on the full image, check the
  // symbol, and drop overlaps.
  found.sort((a, b) => b.score - a.score || a.cy - b.cy || a.cx - b.cx);
  const spots = [];
  for (const c of found) {
    const spot = spots.find((g) => Math.hypot(g[0].cx - c.cx, g[0].cy - c.cy) < Math.max(g[0].r, c.r));
    if (!spot) spots.push([c]); else if (spot.length < 3) spot.push(c);
  }
  const out = [];
  // Symbol first: the white sound or person symbol always stands out, even where the gray disc
  // around it barely does (a dark or busy background). Then a faint, even disc around it is enough.
  for (const c of symbolCircles(rgba, w, h, rMin, rMax, cfg)) if (!out.some((o) => Math.hypot(o.cx - c.cx, o.cy - c.cy) < o.r + c.r)) out.push(c);
  for (const spot of spots) {
    for (const c of spot) {
      if (out.some((o) => Math.hypot(o.cx - c.cx, o.cy - c.cy) < o.r + c.r)) break;
      const fine = refine(rgba, w, h, c);
      if (fine && hasSymbol(rgba, w, h, fine, cfg) && !out.some((o) => Math.hypot(o.cx - fine.cx, o.cy - fine.cy) < o.r + fine.r)) { out.push(fine); break; }
    }
  }
  return out;
}

/**
 * Circles found from their symbol: clusters of white, neutral pixels (the symbol's parts: a head and
 * shoulders, a speaker and a slash) of a plausible size; around each, the radius at which the ring
 * just inside is darker than just outside on most of the circle (radially averaged, so a faint step
 * on a noisy background still shows), with an even disc between the symbol and the ring.
 */
function symbolCircles(rgba, w, h, rMin, rMax, cfg) {
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lum(rgba, i * 4);
  const white = (i) => L[i] >= 200 && Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) - Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) <= 40;
  const seen = new Uint8Array(w * h); const parts = [];
  const cap = Math.ceil((rMax * 2) ** 2);
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !white(i)) continue;
    let x0 = w; let x1 = 0; let y0 = h; let y1 = 0; let n = 0; const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const j = stack.pop(); const x = j % w; const y = (j - x) / w; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !seen[j - 1] && white(j - 1)) { seen[j - 1] = 1; stack.push(j - 1); }
      if (x < w - 1 && !seen[j + 1] && white(j + 1)) { seen[j + 1] = 1; stack.push(j + 1); }
      if (y > 0 && !seen[j - w] && white(j - w)) { seen[j - w] = 1; stack.push(j - w); }
      if (y < h - 1 && !seen[j + w] && white(j + w)) { seen[j + w] = 1; stack.push(j + w); }
    }
    if (n >= 4 && n <= cap && x1 - x0 < rMax * 1.6 && y1 - y0 < rMax * 1.6) parts.push({ x0, x1: x1 + 1, y0, y1: y1 + 1 });
  }
  // Group the parts of one symbol (close together), then try a circle around each group.
  const groups = [];
  for (const p of parts) {
    const g = groups.find((q) => p.x0 <= q.x1 + rMin && p.x1 >= q.x0 - rMin && p.y0 <= q.y1 + rMin && p.y1 >= q.y0 - rMin);
    if (g) { g.x0 = Math.min(g.x0, p.x0); g.x1 = Math.max(g.x1, p.x1); g.y0 = Math.min(g.y0, p.y0); g.y1 = Math.max(g.y1, p.y1); } else groups.push({ ...p });
  }
  const at = (x, y) => { const xi = Math.round(x); const yi = Math.round(y); return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : L[yi * w + xi]; };
  const out = [];
  for (const g of groups) {
    const size = Math.max(g.x1 - g.x0, g.y1 - g.y0);
    if (size < rMin * 0.6) continue;
    // The symbol is about 0.8–1.4 of the radius across.
    const rLo = Math.max(rMin, Math.floor(size / 1.5)); const rHi = Math.min(rMax, Math.ceil(size / 0.7));
    // Score a circle: the share of directions where the ring just inside is darker than just
    // outside (each side averaged over 3 px), plus an even disc between the symbol and the edge.
    const ring = (cx, cy, r, dirs) => {
      let pass = 0; let sum = 0;
      for (const [ux, uy] of dirs) {
        let a = 0; let b = 0;
        for (let k = 1; k <= 3; k++) {
          const ai = at(cx + (r - k) * ux, cy + (r - k) * uy); const bi = at(cx + (r + k) * ux, cy + (r + k) * uy);
          if (ai < 0 || bi < 0) return null;
          a += ai; b += bi;
        }
        const d = (b - a) / 3;
        if (d >= cfg.faint) pass++;
        sum += d;
      }
      return { share: pass / dirs.length, mean: sum / dirs.length };
    };
    const even = (cx, cy, r) => {
      const rim = A64.map(([ux, uy]) => at(cx + r * 0.85 * ux, cy + r * 0.85 * uy)).sort((p, q) => p - q);
      const med = rim[32];
      return rim.filter((v) => Math.abs(v - med) <= Math.max(cfg.flat, med * 0.25)).length / 64 >= 0.75;
    };
    // Coarse: centers on a 2 px grid, every other radius, 16 directions. Then fine around the best.
    const gx = (g.x0 + g.x1) / 2; const gy = (g.y0 + g.y1) / 2;
    let coarse = null;
    for (let oy = -2; oy <= 2; oy += 2) {
      for (let ox = -2; ox <= 2; ox += 2) {
        for (let r = rLo; r <= rHi; r += 2) {
          const t = ring(gx + ox, gy + oy, r, A16);
          if (t && t.share >= 0.7 && (!coarse || t.share + t.mean / 100 > coarse.score)) coarse = { cx: gx + ox, cy: gy + oy, r, score: t.share + t.mean / 100 };
        }
      }
    }
    if (!coarse) continue;
    let best = null;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        for (let r = Math.max(rLo, coarse.r - 2); r <= Math.min(rHi, coarse.r + 2); r++) {
          const cx = coarse.cx + ox; const cy = coarse.cy + oy;
          const t = ring(cx, cy, r, A64);
          if (!t || t.share < 0.75 || !even(cx, cy, r)) continue;
          const score = t.share + t.mean / 100;
          if (!best || score > best.score) best = { cx, cy, r, score };
        }
      }
    }
    if (best) out.push({ cx: Math.round(best.cx * 10) / 10, cy: Math.round(best.cy * 10) / 10, r: best.r });
  }
  return out;
}

/** Fit the circle on full-size pixels: the strongest dark→light step along 64 rays, twice. */
function refine(rgba, w, h, c) {
  let { cx, cy, r } = c;
  for (let pass = 0; pass < 2; pass++) {
    const pts = [];
    for (const [ux, uy] of A64) {
      let best = 0; let bestD = -1;
      for (let d = Math.floor(r * 0.7); d <= Math.ceil(r * 1.3); d++) {
        const x0 = Math.round(cx + (d - 1) * ux); const y0 = Math.round(cy + (d - 1) * uy);
        const x1 = Math.round(cx + (d + 1) * ux); const y1 = Math.round(cy + (d + 1) * uy);
        if (x0 < 0 || y0 < 0 || x1 < 0 || y1 < 0 || x0 >= w || x1 >= w || y0 >= h || y1 >= h) break;
        const g = lum(rgba, (y1 * w + x1) * 4) - lum(rgba, (y0 * w + x0) * 4);
        if (g > best) { best = g; bestD = d; }
      }
      if (bestD > 0) pts.push([cx + bestD * ux, cy + bestD * uy, bestD]);
    }
    if (pts.length < 48) return null;
    const ds = pts.map((p) => p[2]).sort((a, b) => a - b);
    const med = ds[Math.floor(ds.length / 2)];
    const good = pts.filter((p) => Math.abs(p[2] - med) <= Math.max(2, med * 0.12));
    if (good.length < 48) return null; // not round
    cx = good.reduce((s, p) => s + p[0], 0) / good.length;
    cy = good.reduce((s, p) => s + p[1], 0) / good.length;
    r = med;
  }
  return { cx: Math.round(cx * 10) / 10, cy: Math.round(cy * 10) / 10, r };
}

/** A white symbol in the middle of a flat dark disc. */
function hasSymbol(rgba, w, h, { cx, cy, r }, cfg) {
  const rim = []; const mid = [];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d >= 0.75 && d <= 0.9) rim.push(lum(rgba, (y * w + x) * 4));
      else if (d <= 0.6) mid.push(lum(rgba, (y * w + x) * 4));
    }
  }
  rim.sort((a, b) => a - b);
  const disc = rim[Math.floor(rim.length / 2)];
  if (rim.filter((v) => Math.abs(v - disc) <= 25).length / rim.length < 0.8) return false;
  const bright = mid.filter((v) => v >= 170 && v - disc >= 80).length / mid.length;
  return bright >= cfg.glyphMin && bright <= cfg.glyphMax;
}

/** Fill a disc (center cx, cy, radius R, in pixels of `rgba`): a pill of zero length, see fillPill. */
export function fillDisc(rgba, w, h, cx, cy, R) {
  return fillPill(rgba, w, h, cx, cx, cy, R);
}

/** Relax (Gauss-Seidel, fixed sweeps): free cells become the average of their neighbours. */
function relax(buf, free, bw, bh, sweeps) {
  for (let it = 0; it < sweeps; it++) {
    for (let j = 1; j < bh - 1; j++) {
      for (let i = 1; i < bw - 1; i++) {
        if (!free[j * bw + i]) continue;
        const k = (j * bw + i) * 3; const l = k - 3; const rr = k + 3; const u = k - bw * 3; const d = k + bw * 3;
        for (let c = 0; c < 3; c++) buf[k + c] = (buf[l + c] + buf[rr + c] + buf[u + c] + buf[d + c]) / 4;
      }
    }
  }
}

/**
 * Exemplar-based inpainting (after Criminisi, Pérez & Toyama): the hole is filled from its edge
 * inward, a small patch at a time, each one copied from the best-matching patch nearby. The edge
 * points where a line or an edge runs into the hole go first (priority: how much of the patch is
 * already known × how strongly an edge points into the hole), so lines are carried straight through
 * from both sides and meet. `unknown(x, y)` says which pixels of the w×h image to fill; only the
 * box [bx0, bx1) × [by0, by1) is touched. Returns the filled RGBA image (a copy).
 */
export function inpaint(rgba, w, h, unknown, bx0, by0, bx1, by1, R) {
  const img = Uint8ClampedArray.from(rgba);
  const hp = Math.max(3, Math.min(5, Math.round(R / 6))); // patch half-size: 7–11 px patches
  const U = new Uint8Array(w * h); let left = 0;
  for (let y = Math.max(0, by0); y < Math.min(h, by1); y++) for (let x = Math.max(0, bx0); x < Math.min(w, bx1); x++) if (unknown(x, y)) { U[y * w + x] = 1; left++; }
  const conf = new Float32Array(w * h).fill(1);
  for (let i = 0; i < w * h; i++) if (U[i]) conf[i] = 0;
  const L = new Float32Array(w * h);
  const lumAt = (i) => 0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2];
  for (let i = 0; i < w * h; i++) L[i] = lumAt(i);
  // Source patches: wholly outside the hole (as it was at the start), anywhere within reach.
  const sat = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += U[y * w + x]; sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row; } }
  const holeIn = (x0, y0, x1, y1) => sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
  const S = Math.max(24, Math.round(R * 1.6)); // search reach around the hole's edge point
  const cx0 = Math.max(hp, bx0 - S); const cx1 = Math.min(w - hp - 1, bx1 + S); const cy0 = Math.max(hp, by0 - S); const cy1 = Math.min(h - hp - 1, by1 + S);
  const isFront = (x, y) => U[y * w + x] && ((x > 0 && !U[y * w + x - 1]) || (x < w - 1 && !U[y * w + x + 1]) || (y > 0 && !U[(y - 1) * w + x]) || (y < h - 1 && !U[(y + 1) * w + x]));
  // Priorities are cached and only recomputed near the last patch filled.
  const pri = new Float32Array(w * h).fill(NaN); const priC = new Float32Array(w * h);
  for (let guard = 0; left > 0 && guard < 20000; guard++) {
    // 1. The edge point to fill next.
    let best = null;
    for (let y = Math.max(0, by0); y < Math.min(h, by1); y++) {
      for (let x = Math.max(0, bx0); x < Math.min(w, bx1); x++) {
        if (!isFront(x, y)) continue;
        const pi = y * w + x;
        if (!Number.isNaN(pri[pi])) { if (!best || pri[pi] > best.P) best = { x, y, P: pri[pi], C: priC[pi] }; continue; }
        let c = 0; let gx = 0; let gy = 0; let gm = 0; let nx = 0; let ny = 0;
        for (let dy = -hp; dy <= hp; dy++) {
          for (let dx = -hp; dx <= hp; dx++) {
            const xx = x + dx; const yy = y + dy;
            if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) continue;
            const i = yy * w + xx;
            c += conf[i];
            nx += U[i] * dx; ny += U[i] * dy; // points into the hole
            if (U[i] || U[i - 1] || U[i + 1] || U[i - w] || U[i + w]) continue;
            const ix = L[i + 1] - L[i - 1]; const iy = L[i + w] - L[i - w]; const m = ix * ix + iy * iy;
            if (m > gm) { gm = m; gx = ix; gy = iy; }
          }
        }
        const nl = Math.hypot(nx, ny) || 1;
        // The isophote (along the edge) is perpendicular to the gradient: (-gy, gx).
        const D = Math.abs((-gy * nx + gx * ny) / nl) / 255 + 0.001;
        const P = (c / ((2 * hp + 1) ** 2)) * D;
        pri[pi] = P; priC[pi] = c / ((2 * hp + 1) ** 2);
        if (!best || P > best.P) best = { x, y, P, C: priC[pi] };
      }
    }
    if (!best) break;
    // 2. The best-matching source patch (on its known pixels; coarse, then fine around the best).
    const { x: px, y: py } = best;
    const known = [];
    for (let dy = -hp; dy <= hp; dy++) for (let dx = -hp; dx <= hp; dx++) {
      const xx = px + dx; const yy = py + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && !U[yy * w + xx]) known.push(dx, dy);
    }
    let src = null;
    // Every 2 px, then a pixel either way around the best (in full color: brightness alone mismatches).
    const tryAt = (qx, qy, color) => {
      if (qx < cx0 || qy < cy0 || qx > cx1 || qy > cy1 || holeIn(qx - hp, qy - hp, qx + hp + 1, qy + hp + 1)) return;
      let ssd = 0;
      for (let k = 0; k < known.length; k += 2) {
        const ia = (py + known[k + 1]) * w + px + known[k]; const ib = (qy + known[k + 1]) * w + qx + known[k];
        if (color) { const a = ia * 4; const b = ib * 4; ssd += (img[a] - img[b]) ** 2 + (img[a + 1] - img[b + 1]) ** 2 + (img[a + 2] - img[b + 2]) ** 2; } else ssd += 3 * (L[ia] - L[ib]) ** 2;
        if (src && ssd >= src.ssd) return;
      }
      // Nearer sources win ties: they're likelier to share the light.
      ssd += ((qx - px) ** 2 + (qy - py) ** 2) * 1e-3;
      if (!src || ssd < src.ssd) src = { qx, qy, ssd };
    };
    for (let qy = Math.max(cy0, py - S); qy <= Math.min(cy1, py + S); qy += 2) for (let qx = Math.max(cx0, px - S); qx <= Math.min(cx1, px + S); qx += 2) tryAt(qx, qy, true);
    if (!src) break;
    const c0 = src; src = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tryAt(c0.qx + dx, c0.qy + dy, true);
    if (!src) break;
    // 3. Copy its pixels into the unknown part of the patch.
    for (let dy = -hp; dy <= hp; dy++) {
      for (let dx = -hp; dx <= hp; dx++) {
        const xx = px + dx; const yy = py + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !U[yy * w + xx]) continue;
        const i = yy * w + xx; const j = (src.qy + dy) * w + src.qx + dx;
        img[i * 4] = img[j * 4]; img[i * 4 + 1] = img[j * 4 + 1]; img[i * 4 + 2] = img[j * 4 + 2];
        U[i] = 0; conf[i] = best.C; L[i] = lumAt(i); left--;
      }
    }
    const reach = 2 * hp + 2;
    for (let y = Math.max(0, py - reach); y <= Math.min(h - 1, py + reach); y++) for (let x = Math.max(0, px - reach); x <= Math.min(w - 1, px + reach); x++) pri[y * w + x] = NaN;
  }
  return img;
}

/**
 * Content-aware completion of a hole (`unknown(x, y)`, inside the box bx0..bx1 × by0..by1 of `rgba`),
 * starting from a first guess `init` (RGBA, same size as `rgba`): the hole is rebuilt from small
 * patches of the picture around it so that every patch over it looks like one from outside, and they
 * agree where they overlap (multi-scale PatchMatch with voting, after Wexler, Shechtman & Irani, and
 * Barnes et al.). Coarse to fine: the layout settles first, then the detail. `maxLevels: 1` keeps the
 * layout of `init` and only refines it at full size; `vote: false` then takes each pixel from the
 * patch that best matches the first guess around it (texture kept, no averaging into a blur).
 * Returns a copy of `rgba` with the hole filled.
 */
export function complete(rgba, w, h, unknown, bx0, by0, bx1, by1, R, init, { maxLevels = 4, iters: finalIters = 2, vote: voting = true, minHole = 6, minSize = 48 } = {}) {
  const P = 3; // patches are 7×7
  const margin = Math.max(24, Math.round(2 * R));
  const rx0 = Math.max(0, bx0 - margin); const ry0 = Math.max(0, by0 - margin);
  const rx1 = Math.min(w, bx1 + margin); const ry1 = Math.min(h, by1 + margin);
  const out = Uint8ClampedArray.from(rgba);
  if (rx1 - rx0 < 4 * P + 4 || ry1 - ry0 < 4 * P + 4) return init ? Uint8ClampedArray.from(init) : out;
  // Level 0: the region at full size; each further level half the size, down to a hole ~8 px across.
  const levels = [];
  {
    const rw = rx1 - rx0; const rh = ry1 - ry0;
    const img = new Float32Array(rw * rh * 3); const hole = new Uint8Array(rw * rh);
    const src = init ?? rgba;
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x; const o = ((y + ry0) * w + x + rx0) * 4;
        hole[i] = unknown(x + rx0, y + ry0) ? 1 : 0;
        const s = hole[i] ? src : rgba;
        img[i * 3] = s[o]; img[i * 3 + 1] = s[o + 1]; img[i * 3 + 2] = s[o + 2];
      }
    }
    levels.push({ w: rw, h: rh, img, hole });
  }
  while (levels.length < maxLevels) {
    const f = levels.at(-1);
    if (R / 2 ** levels.length < minHole || f.w < minSize || f.h < minSize) break;
    const cw = f.w >> 1; const ch = f.h >> 1;
    const img = new Float32Array(cw * ch * 3); const hole = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = y * cw + x;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const j = (2 * y + dy) * f.w + 2 * x + dx;
          if (f.hole[j]) hole[i] = 1;
          for (let c = 0; c < 3; c++) img[i * 3 + c] += f.img[j * 3 + c] / 4;
        }
      }
    }
    // A level with no whole patch outside the hole has nothing to copy from: stop at the one before.
    let free = false;
    for (let y = 3; y < ch - 3 && !free; y++) for (let x = 3; x < cw - 3 && !free; x++) {
      let clear = true;
      for (let dy = -3; dy <= 3 && clear; dy++) for (let dx = -3; dx <= 3; dx++) if (hole[(y + dy) * cw + x + dx]) { clear = false; break; }
      free = clear;
    }
    if (!free) break;
    levels.push({ w: cw, h: ch, img, hole });
  }
  // Deterministic random numbers (the same input always gives the same fill).
  let seed = 0x9e3779b9;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  let nnf = null; let prevW = 0; let prevH = 0; // offsets of the coarser level's matches (x, y per pixel)
  const NONE = -1 << 30;
  if (!init) {
    // No first guess: the coarsest level's hole is filled in from its edge inwards, ring by ring.
    const { w: lw, h: lh, img, hole } = levels.at(-1);
    const known = Uint8Array.from(hole, (v) => 1 - v);
    for (let left = hole.reduce((s, v) => s + v, 0); left > 0;) {
      const next = [];
      for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
        const i = y * lw + x; if (known[i]) continue;
        let n = 0; const sum = [0, 0, 0];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const X = x + dx; const Y = y + dy; if (X < 0 || Y < 0 || X >= lw || Y >= lh || !known[Y * lw + X]) continue;
          const j = (Y * lw + X) * 3; sum[0] += img[j]; sum[1] += img[j + 1]; sum[2] += img[j + 2]; n++;
        }
        if (n) next.push([i, sum.map((v) => v / n)]);
      }
      if (!next.length) break;
      for (const [i, c] of next) { img.set(c, i * 3); known[i] = 1; }
      left -= next.length;
    }
  }
  for (let L = levels.length - 1; L >= 0; L--) {
    const { w: lw, h: lh, img, hole } = levels[L];
    // Source patches: entirely outside the hole. Target patches: any that cover some of it.
    const sat = new Int32Array((lw + 1) * (lh + 1));
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) sat[(y + 1) * (lw + 1) + x + 1] = hole[y * lw + x] + sat[y * (lw + 1) + x + 1] + sat[(y + 1) * (lw + 1) + x] - sat[y * (lw + 1) + x];
    const holeIn = (x, y) => sat[(y + P + 1) * (lw + 1) + x + P + 1] - sat[(y - P) * (lw + 1) + x + P + 1] - sat[(y + P + 1) * (lw + 1) + x - P] + sat[(y - P) * (lw + 1) + x - P];
    const okSrc = (x, y) => x >= P && y >= P && x < lw - P && y < lh - P && holeIn(x, y) === 0;
    const targets = [];
    for (let y = P; y < lh - P; y++) for (let x = P; x < lw - P; x++) if (holeIn(x, y) > 0) targets.push(y * lw + x);
    const T = targets.length;
    const sx = new Int32Array(T); const sy = new Int32Array(T); const sd = new Float32Array(T);
    const tIndex = new Int32Array(lw * lh).fill(-1);
    targets.forEach((t, k) => { tIndex[t] = k; });
    const dist = (tx, ty, qx, qy, cap) => {
      let d = 0;
      for (let dy = -P; dy <= P; dy++) {
        let a = ((ty + dy) * lw + tx - P) * 3; let b = ((qy + dy) * lw + qx - P) * 3;
        for (let n = 0; n < (2 * P + 1) * 3; n++, a++, b++) { const e = img[a] - img[b]; d += e * e; }
        if (d >= cap) return d;
      }
      return d;
    };
    const randomSrc = () => { for (;;) { const x = P + Math.floor(rand() * (lw - 2 * P)); const y = P + Math.floor(rand() * (lh - 2 * P)); if (okSrc(x, y)) return [x, y]; } };
    let anySrc = false;
    for (let y = P; y < lh - P && !anySrc; y += 2) for (let x = P; x < lw - P; x += 2) if (okSrc(x, y)) { anySrc = true; break; }
    if (!anySrc) return init ? Uint8ClampedArray.from(init) : out;
    // Start: from the coarser level's matches (offsets doubled), else at random.
    for (let k = 0; k < T; k++) {
      const tx = targets[k] % lw; const ty = (targets[k] / lw) | 0;
      let q = null;
      if (nnf) {
        const c = Math.min(prevH - 1, ty >> 1) * prevW + Math.min(prevW - 1, tx >> 1);
        if (nnf[c * 2] !== NONE) { const qx = tx + 2 * nnf[c * 2]; const qy = ty + 2 * nnf[c * 2 + 1]; if (okSrc(qx, qy)) q = [qx, qy]; }
      }
      q ??= randomSrc();
      sx[k] = q[0]; sy[k] = q[1]; sd[k] = dist(tx, ty, q[0], q[1], Infinity);
    }
    const vote = () => {
      // Each hole pixel: the weighted mean of what the patches over it say it should be.
      const sorted = Float32Array.from(sd).sort();
      const s2 = Math.max(1, sorted[Math.floor(T * 0.75)]);
      const acc = new Float32Array(lw * lh * 3); const wsum = new Float32Array(lw * lh);
      for (let k = 0; k < T; k++) {
        const tx = targets[k] % lw; const ty = (targets[k] / lw) | 0;
        const wt = Math.exp(-sd[k] / (2 * s2)) + 1e-6;
        for (let dy = -P; dy <= P; dy++) {
          for (let dx = -P; dx <= P; dx++) {
            const i = (ty + dy) * lw + tx + dx;
            if (!hole[i]) continue;
            const j = ((sy[k] + dy) * lw + sx[k] + dx) * 3;
            acc[i * 3] += wt * img[j]; acc[i * 3 + 1] += wt * img[j + 1]; acc[i * 3 + 2] += wt * img[j + 2]; wsum[i] += wt;
          }
        }
      }
      for (let i = 0; i < lw * lh; i++) if (hole[i] && wsum[i] > 0) for (let c = 0; c < 3; c++) img[i * 3 + c] = acc[i * 3 + c] / wsum[i];
    };
    const improve = (pass) => {
      const fwd = pass % 2 === 0;
      for (let n = 0; n < T; n++) {
        const k = fwd ? n : T - 1 - n;
        const t = targets[k]; const tx = t % lw; const ty = (t / lw) | 0;
        const step = fwd ? -1 : 1;
        // Propagation: a neighbour's match, shifted along.
        for (const nb of [t + step, t + step * lw]) {
          const m = nb >= 0 && nb < lw * lh ? tIndex[nb] : -1;
          if (m < 0) continue;
          const qx = sx[m] + (nb === t + step ? -step : 0); const qy = sy[m] + (nb === t + step ? 0 : -step);
          if (!okSrc(qx, qy) || (qx === sx[k] && qy === sy[k])) continue;
          const d = dist(tx, ty, qx, qy, sd[k]);
          if (d < sd[k]) { sd[k] = d; sx[k] = qx; sy[k] = qy; }
        }
        // Random search around the current match, in shrinking windows.
        for (let rad = nnf ? Math.max(4, (Math.max(lw, lh) >> 3)) : Math.max(lw, lh); rad >= 1; rad >>= 1) {
          const qx = sx[k] + Math.round((rand() * 2 - 1) * rad); const qy = sy[k] + Math.round((rand() * 2 - 1) * rad);
          if (!okSrc(qx, qy)) continue;
          const d = dist(tx, ty, qx, qy, sd[k]);
          if (d < sd[k]) { sd[k] = d; sx[k] = qx; sy[k] = qy; }
        }
      }
    };
    const iters = L === levels.length - 1 && L > 0 ? 6 : L === 0 ? finalIters : 3;
    if (nnf && voting) vote(); // the finer detail of the coarser layout, straight away
    for (let it = 0; it < iters; it++) {
      improve(it);
      if (L > 0) improve(it + 1);
      if (!voting) continue; // matched against the first guess as it is (its texture kept)
      // Distances against the updated picture.
      vote();
      for (let k = 0; k < T; k++) { const t = targets[k]; sd[k] = dist(t % lw, (t / lw) | 0, sx[k], sy[k], Infinity); }
    }
    if (L === 0) {
      // Finally, each hole pixel straight from the best-matching patch over it: no averaging, so the
      // grain and detail stay as sharp as the picture around it.
      const best = new Float32Array(lw * lh).fill(Infinity);
      const val = new Float32Array(lw * lh * 3);
      for (let k = 0; k < T; k++) {
        const tx = targets[k] % lw; const ty = (targets[k] / lw) | 0;
        for (let dy = -P; dy <= P; dy++) {
          for (let dx = -P; dx <= P; dx++) {
            const i = (ty + dy) * lw + tx + dx; if (!hole[i] || sd[k] >= best[i]) continue;
            best[i] = sd[k]; const j = ((sy[k] + dy) * lw + sx[k] + dx) * 3;
            val[i * 3] = img[j]; val[i * 3 + 1] = img[j + 1]; val[i * 3 + 2] = img[j + 2];
          }
        }
      }
      // Right at the hole's edge the averaged fill is kept (it agrees with the picture there, so no
      // outline shows), going over to the sharp one within a few pixels.
      const depth = new Uint8Array(lw * lh);
      for (let i = 0; i < lw * lh; i++) depth[i] = hole[i] ? 255 : 0;
      for (let d = 1; d <= 4; d++) {
        for (let y = 0; y < lh; y++) {
          for (let x = 0; x < lw; x++) {
            const i = y * lw + x; if (depth[i] !== 255) continue;
            if ((x > 0 && depth[i - 1] === d - 1) || (x < lw - 1 && depth[i + 1] === d - 1) || (y > 0 && depth[i - lw] === d - 1) || (y < lh - 1 && depth[i + lw] === d - 1)) depth[i] = d;
          }
        }
      }
      for (let i = 0; i < lw * lh; i++) {
        if (!hole[i] || best[i] === Infinity) continue;
        const t = Math.min(1, (depth[i] - 1) / 4);
        for (let c = 0; c < 3; c++) img[i * 3 + c] += t * (val[i * 3 + c] - img[i * 3 + c]);
      }
    }
    // Hand the matches down (as offsets) to the finer level, which starts from this level's picture.
    nnf = new Int32Array(lw * lh * 2).fill(NONE);
    for (let k = 0; k < T; k++) { const t = targets[k]; nnf[t * 2] = sx[k] - (t % lw); nnf[t * 2 + 1] = sy[k] - ((t / lw) | 0); }
    prevW = lw; prevH = lh;
    if (L > 0) {
      const f = levels[L - 1];
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          const i = y * f.w + x; if (!f.hole[i]) continue;
          const j = (Math.min(lh - 1, y >> 1) * lw + Math.min(lw - 1, x >> 1)) * 3;
          for (let c = 0; c < 3; c++) f.img[i * 3 + c] = img[j + c];
        }
      }
    }
  }
  const { w: rw, img, hole } = levels[0];
  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      const i = (y - ry0) * rw + x - rx0; if (!hole[i]) continue;
      const o = (y * w + x) * 4;
      out[o] = img[i * 3]; out[o + 1] = img[i * 3 + 1]; out[o + 2] = img[i * 3 + 2];
    }
  }
  return out;
}

/**
 * Fill a pill (stadium: the points within R of the segment x1..x2 on row cy, in pixels of `rgba`)
 * with background copied from beside it, so its texture continues: of the nearby spots, the few whose
 * surroundings best match the pill's are kept, each part of the hole copies from the one that best
 * lines up with the edges nearest it (so where a ledge meets a post, both carry on), and any difference
 * in color at the edge is spread smoothly over the copy (seamless cloning: the membrane of the edge
 * differences), so no seam shows. Copies may come from anywhere in the picture, so a button tight in a
 * corner still gets one. With no clean spot at all (a tiny picture), a smooth fill with the background's
 * grain instead. Returns the patch pixels { x0, y0, pw, ph, rgba }: alpha 255 inside
 * (1 px soft edge), 0 outside.
 */
export function fillPill(rgba, w, h, x1, x2, cy, R) {
  const first = roughFill(rgba, w, h, x1, x2, cy, R);
  // Then rebuilt patch by patch from the picture around it, starting from that first fill, so it
  // fits in seamlessly: no blur, no seams, edges and texture running on.
  const { x0, y0, pw, ph } = first;
  const init = Uint8ClampedArray.from(rgba);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const s = (y * pw + x) * 4; if (!first.rgba[s + 3]) continue;
    const o = ((y0 + y) * w + x0 + x) * 4; init[o] = first.rgba[s]; init[o + 1] = first.rgba[s + 1]; init[o + 2] = first.rgba[s + 2];
  }
  const near = (x) => Math.min(x2, Math.max(x1, x));
  const in2 = (R + 1) * (R + 1);
  const unknown = (x, y) => (x - near(x)) ** 2 + (y - cy) ** 2 < in2;
  const done = complete(rgba, w, h, unknown, x0, y0, x0 + pw, y0 + ph, R, init);
  const out = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const s = (y * pw + x) * 4; if (!first.rgba[s + 3]) continue;
    const o = ((y0 + y) * w + x0 + x) * 4;
    out[s] = done[o]; out[s + 1] = done[o + 1]; out[s + 2] = done[o + 2]; out[s + 3] = first.rgba[s + 3];
  }
  return { x0, y0, pw, ph, rgba: out };
}

/** The first fill of a pill (see fillPill): copied in from the best-matching spots nearby. */
function roughFill(rgba, w, h, x1, x2, cy, R) {
  const x0 = Math.max(0, Math.floor(x1 - R - 1)); const y0 = Math.max(0, Math.floor(cy - R - 1));
  const xe = Math.min(w, Math.ceil(x2 + R + 2)); const ye = Math.min(h, Math.ceil(cy + R + 2));
  const pw = xe - x0; const ph = ye - y0;
  const near = (x) => Math.min(x2, Math.max(x1, x)); // nearest point of the segment (on row cy)
  const dist2 = (x, y) => { const dx = x - near(x); const dy = y - cy; return dx * dx + dy * dy; };
  const in2 = (R + 1) * (R + 1);
  const inside = (x, y) => dist2(x, y) < in2;
  const px = (x, y) => (Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))) * 4;
  const bw = pw + 2; const bh = ph + 2;
  const free = new Uint8Array(bw * bh);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) if (inside(x0 - 1 + i, y0 - 1 + j)) free[j * bw + i] = 1;

  // 1. Where to copy from: spots whose surrounding band matches this one's, in color and in the
  //    direction of its edges.
  const band = Math.max(4, Math.round(R * 0.35));
  const ext = R + 1 + band;
  const ring = [];
  for (let y = Math.floor(cy - ext); y <= Math.ceil(cy + ext); y += 2) {
    for (let x = Math.floor(x1 - ext); x <= Math.ceil(x2 + ext); x += 2) { const d2 = dist2(x, y); if (d2 >= in2 && d2 < ext * ext && x >= 0 && y >= 0 && x < w && y < h) ring.push(x, y); }
  }
  // The band's extent (it stops at the picture's edges, so a button near an edge still has copies).
  let rx0 = Infinity; let rx1 = -Infinity; let ry0 = Infinity; let ry1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { rx0 = Math.min(rx0, ring[i]); rx1 = Math.max(rx1, ring[i]); ry0 = Math.min(ry0, ring[i + 1]); ry1 = Math.max(ry1, ring[i + 1]); }
  const hx0 = Math.min(rx0, x0); const hx1 = Math.max(rx1, xe - 1); const hy0 = Math.min(ry0, y0); const hy1 = Math.max(ry1, ye - 1);
  // Brightness gradients, worked out once over the area copies may come from.
  const gxs = new Float32Array(w * h); const gys = new Float32Array(w * h);
  {
    const Lm = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) Lm[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; gxs[i] = Lm[i + 1] - Lm[i - 1]; gys[i] = Lm[i + w] - Lm[i - w]; }
  }
  const grad = (x, y) => { const i = Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x)); return [gxs[i], gys[i]]; };
  const score = (ox, oy) => {
    if (!ring.length || hx0 + ox < 0 || hx1 + ox >= w || hy0 + oy < 0 || hy1 + oy >= h) return Infinity;
    // Colors, plus the edges' directions (so a line next to the hole lines up with the copy's).
    let ssd = 0;
    for (let i = 0; i < ring.length; i += 2) {
      const x = ring[i]; const y = ring[i + 1];
      const a = (y * w + x) * 4; const b = ((y + oy) * w + x + ox) * 4;
      ssd += (rgba[a] - rgba[b]) ** 2 + (rgba[a + 1] - rgba[b + 1]) ** 2 + (rgba[a + 2] - rgba[b + 2]) ** 2;
      const ia = y * w + x; const ib = (y + oy) * w + x + ox;
      ssd += 2 * ((gxs[ia] - gxs[ib]) ** 2 + (gys[ia] - gys[ib]) ** 2);
    }
    return ssd;
  };
  const along = (deg, mult) => {
    const ux = Math.cos((deg * Math.PI) / 180); const uy = Math.sin((deg * Math.PI) / 180);
    const len = (2 * ext + Math.abs(ux) * (x2 - x1)) * mult;
    return [Math.round(len * ux), Math.round(len * uy)];
  };
  // Candidate copies every 15° at three distances, then finely around the best few (a line stays
  // straight only when the copy comes from exactly along it). Keep up to six good, different ones.
  const cands = [];
  const add = (deg, mult) => {
    const [ox, oy] = along(deg, mult);
    if (cands.some((c) => c.ox === ox && c.oy === oy)) return;
    const ssd = score(ox, oy);
    if (ssd < Infinity) cands.push({ ox, oy, ssd, deg: ((deg % 360) + 360) % 360, mult });
  };
  for (let k = 0; k < 24; k++) for (const mult of [0.5, 0.7, 1, 1.3, 1.7]) add(k * 15, mult);
  cands.sort((p, q) => p.ssd - q.ssd);
  for (const c of cands.filter((c) => c.mult >= 1).slice(0, 2).concat(cands.slice(0, 2))) for (let d = -7; d <= 7; d++) for (const m of [0.9, 1, 1.1]) add(c.deg + d, c.mult * m);
  cands.sort((p, q) => p.ssd - q.ssd || p.deg - q.deg);
  // Short copies (closer than the hole is wide) can only be used where they come from outside it,
  // so the best long one is always kept.
  const picks = [];
  const long = cands.find((c) => c.mult >= 1);
  if (long) picks.push(long);
  for (const c of long ? cands : []) {
    if (picks.length >= 6) break;
    if (picks.every((p) => Math.min(Math.abs(p.deg - c.deg), 360 - Math.abs(p.deg - c.deg)) >= 20 || (p.mult >= 1) !== (c.mult >= 1) && (p.ox !== c.ox || p.oy !== c.oy))) picks.push(c);
  }

  // How well each pick matches at each point of the band around the hole (color and edges).
  const npts = ring.length / 2;
  const errs = picks.map(({ ox, oy }) => {
    const e = new Float32Array(npts);
    for (let j = 0; j < npts; j++) {
      const x = ring[j * 2]; const y = ring[j * 2 + 1];
      const a = (y * w + x) * 4; const b = ((y + oy) * w + x + ox) * 4; const ia = y * w + x; const ib = (y + oy) * w + x + ox;
      e[j] = (rgba[a] - rgba[b]) ** 2 + (rgba[a + 1] - rgba[b + 1]) ** 2 + (rgba[a + 2] - rgba[b + 2]) ** 2 + 2 * ((gxs[ia] - gxs[ib]) ** 2 + (gys[ia] - gys[ib]) ** 2);
    }
    return e;
  });

  // Lines or edges running into the hole that no copy lines up (a cable in a corner, where the copy
  // along it would come from outside the picture): inpaint patch by patch, so they carry through.
  // (A few strong edges are lines; strong edges everywhere are texture, which copies carry fine.)
  let strong = 0; let unexplained = 0;
  for (let j = 0; j < npts; j++) {
    const ia = ring[j * 2 + 1] * w + ring[j * 2]; const m = Math.hypot(gxs[ia], gys[ia]);
    if (m < 40) continue;
    strong++;
    let fit = Infinity;
    for (const { ox, oy } of picks) { const ib = ia + oy * w + ox; fit = Math.min(fit, Math.hypot(gxs[ia] - gxs[ib], gys[ia] - gys[ib]) / m); }
    if (fit > 0.5) unexplained++;
  }
  if (strong > 0 && strong / npts <= 0.15 && (!picks.length || unexplained / strong >= 0.3)) {
    const filled = inpaint(rgba, w, h, inside, x0, y0, xe, ye, R);
    const out = new Uint8ClampedArray(pw * ph * 4);
    for (let y = y0; y < ye; y++) {
      for (let x = x0; x < xe; x++) {
        const d = Math.sqrt(dist2(x, y));
        const alpha = Math.max(0, Math.min(1, R + 0.5 - d));
        if (alpha <= 0) continue;
        const o = ((y - y0) * pw + (x - x0)) * 4; const s = (y * w + x) * 4;
        out[o] = filled[s]; out[o + 1] = filled[s + 1]; out[o + 2] = filled[s + 2]; out[o + 3] = Math.round(alpha * 255);
      }
    }
    return { x0, y0, pw, ph, rgba: out };
  }

  if (picks.length) {
    // 2. Each part of the hole (and of the band just outside it) copies from the pick that best
    //    matches the band nearest to it, so where two edges meet inside (a ledge across a post), each
    //    one is continued by the copy that lines it up. Worked out on a 3 px grid, blended between
    //    grid points.
    const G = 3; const gx0 = x0 - 3; const gy0 = y0 - 3;
    const gw = Math.ceil((pw + 6) / G) + 2; const gh = Math.ceil((ph + 6) / G) + 2;
    const sigma2 = Math.max(36, (R / 2.5) ** 2);
    const clear2 = (R + 1 + 2 * G) ** 2;
    const label = new Uint8Array(gw * gh);
    for (let gj = 0; gj < gh; gj++) {
      for (let gi = 0; gi < gw; gi++) {
        const x = gx0 + gi * G; const y = gy0 + gj * G;
        if (dist2(x, y) > (R + 1 + 3 * G) ** 2) continue;
        let bestK = 0; let bestS = Infinity;
        for (let k = 0; k < picks.length; k++) {
          const { ox, oy, mult } = picks[k];
          if (mult < 1 && dist2(x + ox, y + oy) < clear2) continue; // would copy the icon itself
          let sum = 0; let wsum = 0;
          for (let j = 0; j < npts; j += 2) {
            const d2 = (ring[j * 2] - x) ** 2 + (ring[j * 2 + 1] - y) ** 2;
            const wt = 1 / (1 + d2 / sigma2) ** 2;
            sum += errs[k][j] * wt; wsum += wt;
          }
          const sc = sum / wsum + picks[k].ssd / npts * 0.05; // a little of the overall match too
          if (sc < bestS) { bestS = sc; bestK = k; }
        }
        label[gj * gw + gi] = bestK;
      }
    }
    const copy = (x, y, val) => {
      const fx = Math.max(0, Math.min(gw - 1.001, (x - gx0) / G)); const fy = Math.max(0, Math.min(gh - 1.001, (y - gy0) / G));
      const gi = Math.floor(fx); const gj = Math.floor(fy); const tx = fx - gi; const ty = fy - gj;
      val[0] = val[1] = val[2] = 0;
      for (const [di, dj, wt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
        if (wt <= 0) continue;
        const { ox, oy } = picks[label[(gj + dj) * gw + gi + di]]; const s = px(x + ox, y + oy);
        for (let c = 0; c < 3; c++) val[c] += wt * rgba[s + c];
      }
      return val;
    };
    // 3. Seamless correction: the membrane of the edge differences between the picture and the
    //    blended copy, of local averages (broad color and light, not grain).
    const buf = new Float32Array(bw * bh * 3);
    const tmp = [0, 0, 0];
    const diff = new Float32Array(3);
    let mean = [0, 0, 0]; let n = 0;
    for (let j = 0; j < bh; j++) {
      for (let i = 0; i < bw; i++) {
        if (free[j * bw + i]) continue;
        const edge = (i > 0 && free[j * bw + i - 1]) || (i < bw - 1 && free[j * bw + i + 1]) || (j > 0 && free[(j - 1) * bw + i]) || (j < bh - 1 && free[(j + 1) * bw + i]);
        if (!edge) continue;
        const x = x0 - 1 + i; const y = y0 - 1 + j;
        diff.fill(0); let m = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (inside(x + dx, y + dy)) continue;
            copy(x + dx, y + dy, tmp); const o = px(x + dx, y + dy);
            for (let c = 0; c < 3; c++) diff[c] += rgba[o + c] - tmp[c];
            m++;
          }
        }
        const kk = (j * bw + i) * 3;
        for (let c = 0; c < 3; c++) { buf[kk + c] = m ? diff[c] / m : 0; mean[c] += buf[kk + c]; }
        n++;
      }
    }
    mean = mean.map((v) => v / Math.max(1, n));
    for (let i = 0; i < bw * bh; i++) if (free[i]) for (let c = 0; c < 3; c++) buf[i * 3 + c] = mean[c];
    relax(buf, free, bw, bh, 80);
    const out = new Uint8ClampedArray(pw * ph * 4);
    const val = [0, 0, 0];
    for (let y = y0; y < ye; y++) {
      for (let x = x0; x < xe; x++) {
        const d = Math.sqrt(dist2(x, y));
        const alpha = Math.max(0, Math.min(1, R + 0.5 - d));
        if (alpha <= 0) continue;
        const kk = ((y - y0 + 1) * bw + (x - x0 + 1)) * 3; const o = ((y - y0) * pw + (x - x0)) * 4;
        copy(x, y, val);
        out[o] = val[0] + buf[kk]; out[o + 1] = val[1] + buf[kk + 1]; out[o + 2] = val[2] + buf[kk + 2];
        out[o + 3] = Math.round(alpha * 255);
      }
    }
    return { x0, y0, pw, ph, rgba: out };
  }

  // Fallback: a smooth membrane fill from the boundary (started from 8 directions), plus grain.
  const buf = new Float32Array(bw * bh * 3);
  const B = R + 2; const B2 = B * B;
  const DX = new Float64Array(8); const DY = new Float64Array(8);
  for (let i = 0; i < 8; i++) { DX[i] = Math.cos((Math.PI * i) / 4); DY[i] = Math.sin((Math.PI * i) / 4); }
  const span = 2 * B + (x2 - x1);
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const x = x0 - 1 + i; const y = y0 - 1 + j; const k = (j * bw + i) * 3;
      if (!free[j * bw + i]) { const o = px(x, y); buf[k] = rgba[o]; buf[k + 1] = rgba[o + 1]; buf[k + 2] = rgba[o + 2]; continue; }
      let sw = 0; let r = 0; let g = 0; let b = 0;
      for (let di = 0; di < 8; di++) {
        const ux = DX[di]; const uy = DY[di];
        let lo = 0; let hi = span;
        for (let it = 0; it < 8; it++) { // to within span/256: under a pixel
          const mid = (lo + hi) / 2; const qx = x + mid * ux; const qy = y + mid * uy;
          const nx = qx < x1 ? x1 : qx > x2 ? x2 : qx;
          if ((qx - nx) * (qx - nx) + (qy - cy) * (qy - cy) < B2) lo = mid; else hi = mid;
        }
        const t = Math.max(1, hi);
        const o = px(x + t * ux, y + t * uy);
        const wgt = 1 / (t * t);
        r += rgba[o] * wgt; g += rgba[o + 1] * wgt; b += rgba[o + 2] * wgt; sw += wgt;
      }
      buf[k] = r / sw; buf[k + 1] = g / sw; buf[k + 2] = b / sw;
    }
  }
  relax(buf, free, bw, bh, 80);
  const grainBand = Math.max(3, Math.min(8, Math.round(R / 4)));
  const detail = (x, y, c) => {
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1 || inside(x, y)) return 0;
    let t = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) t += rgba[((y + dy) * w + x + dx) * 4 + c];
    return Math.max(-8, Math.min(8, rgba[(y * w + x) * 4 + c] - t / 9));
  };
  const out = new Uint8ClampedArray(pw * ph * 4);
  for (let y = y0; y < ye; y++) {
    for (let x = x0; x < xe; x++) {
      const qx = near(x); const d = Math.sqrt((x - qx) * (x - qx) + (y - cy) * (y - cy));
      const alpha = Math.max(0, Math.min(1, R + 0.5 - d));
      if (alpha <= 0) continue;
      const k = ((y - y0 + 1) * bw + (x - x0 + 1)) * 3; const o = ((y - y0) * pw + (x - x0)) * 4;
      const ux = d > 0 ? (x - qx) / d : 0; const uy = d > 0 ? (y - cy) / d : 1;
      const out2 = B + ((B - d) % grainBand);
      const mx = Math.round(qx + ux * out2); const my = Math.round(cy + uy * out2);
      for (let c = 0; c < 3; c++) out[o + c] = buf[k + c] + detail(mx, my, c);
      out[o + 3] = Math.round(alpha * 255);
    }
  }
  return { x0, y0, pw, ph, rgba: out };
}

/**
 * How far a counter pill's inside reaches when it's one even color (Instagram's is a near-opaque dark
 * tint): from the text out along the pill's middle row and down its middle column, while pixels stay
 * close to the color just around the text. Returns { left, right } (its ends' x) or null when the
 * inside isn't even (a see-through pill over a varied background).
 */
function evenReach(rgba, w, h, t, fit) {
  const th = t.y1 - t.y0; const cy = Math.round(fit.cy);
  // The inside's color: pixels just left and right of the text, on its rows.
  const sample = [];
  for (let y = t.y0; y < t.y1; y++) for (const x of [t.x0 - 3, t.x0 - 4, t.x1 + 2, t.x1 + 3]) if (x >= 0 && x < w && y >= 0 && y < h) sample.push(y * w + x);
  if (sample.length < 8) return null;
  const med = [0, 1, 2].map((c) => { const v = sample.map((i) => rgba[i * 4 + c]).sort((a, b) => a - b); return v[v.length >> 1]; });
  const spread = sample.filter((i) => Math.hypot(rgba[i * 4] - med[0], rgba[i * 4 + 1] - med[1], rgba[i * 4 + 2] - med[2]) > 20).length / sample.length;
  if (spread > 0.2) return null;
  const like = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return false; const i = (y * w + x) * 4; return Math.hypot(rgba[i] - med[0], rgba[i + 1] - med[1], rgba[i + 2] - med[2]) <= 26; };
  // Along a few rows near the middle, how far the color runs; the median row (one row may run on
  // into a dark leaf just past the end).
  const ends = (x0, dir, limit) => {
    const all = [];
    for (let dy = -Math.round(th * 0.2); dy <= Math.round(th * 0.2); dy++) {
      let x = x0; let miss = 0; let last = x0;
      while (Math.abs(x - x0) <= limit) { if (like(x, cy + dy)) { last = x; miss = 0; } else if (++miss > 2) break; x += dir; }
      all.push(last);
    }
    return all.sort((a, b) => a - b)[all.length >> 1];
  };
  const left = ends(t.x0 - 3, -1, th * 3); const right = ends(t.x1 + 2, 1, th * 3);
  // Up and down from the text, over columns across it: the median column.
  const vert = (y0, dir) => {
    const all = [];
    for (let x = t.x0; x < t.x1; x += 2) {
      let y = y0; let miss = 0; let last = y0;
      while (Math.abs(y - y0) <= th * 1.5) { if (like(x, y)) { last = y; miss = 0; } else if (++miss > 2) break; y += dir; }
      all.push(last);
    }
    return all.sort((a, b) => a - b)[all.length >> 1];
  };
  const top = vert(t.y0 - 3, -1); const bottom = vert(t.y1 + 2, 1);
  // Ran into a background of the same color: no edge to go by.
  if (right - left > th * 6) return null;
  if (bottom - top > th * 4) return null;
  return { left: left - 0.5, right: right + 0.5, top: top - 0.5, bottom: bottom + 0.5 };
}

/**
 * A pill (center cx, cy, half-length a, radius rho) grown to also cover the even color's reach, each
 * way by at most a quarter: a slightly bigger fill costs nothing, a dark rim left showing does.
 */
function widen(cx, cy, a, rho, reach) {
  let t = cy - rho; let b = cy + rho;
  if (reach.top != null && Math.max(b, reach.bottom) - Math.min(t, reach.top) <= 2 * rho * 1.25) { t = Math.min(t, reach.top); b = Math.max(b, reach.bottom); }
  const r2 = (b - t) / 2;
  let l = cx - a - rho; let r = cx + a + rho;
  if (Math.max(r, reach.right) - Math.min(l, reach.left) <= 2 * (a + rho) * 1.25) { l = Math.min(l, reach.left); r = Math.max(r, reach.right); }
  return { cx: (l + r) / 2, cy: (t + b) / 2, rho: r2, a: Math.max(0, (r - l) / 2 - r2) };
}

/**
 * Counter pills ("11/13") in an RGBA image (w×h): white text on a flat, dark, see-through pill with
 * round ends. `hMin`/`hMax` are pill heights in pixels. Returns [{ x1, x2, cy, rho }] (the pill is the
 * points within rho of the segment x1..x2 on row cy). Found from the text outwards: the text's line,
 * then the pill around it in four directions, then the whole rounded outline must hold.
 */
export function findPills(rgba, w, h, { hMin, hMax, ...opts }) {
  const cfg = { ...ICON_DEFAULTS, ...opts };
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lum(rgba, i * 4);
  const bright = (i) => L[i] >= 150; // small text is anti-aliased: its strokes don't all reach white
  // Bright blobs (4-connected), then lines of them: the text.
  const seen = new Uint8Array(w * h); const blobs = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !bright(i)) continue;
    let x0 = w; let x1 = 0; let y0 = h; let y1 = 0; let n = 0; const stack = [i]; seen[i] = 1;
    let sx = 0; let sy = 0; let sxy = 0; let sxx = 0; let syy = 0; let top = 0;
    while (stack.length && n < 4000) {
      const j = stack.pop(); const x = j % w; const y = (j - x) / w; n++;
      sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y; if (L[j] > top) top = L[j];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) if (k >= 0 && !seen[k] && bright(k)) { seen[k] = 1; stack.push(k); }
    }
    // How diagonal the blob is (the "/" in "11/13"): the x–y correlation of its pixels.
    const cov = sxy / n - (sx / n) * (sy / n); const vx = sxx / n - (sx / n) ** 2; const vy = syy / n - (sy / n) ** 2;
    if (n >= 4000 || y1 - y0 + 1 > hMax * 0.7 || top < 200) continue; // text reaches near-white somewhere
    // ...and stands out from what's right around it (white text on a dark pill, not a bright sky).
    let ring = 0; let rn = 0;
    for (let x = Math.max(0, x0 - 2); x <= Math.min(w - 1, x1 + 2); x++) for (const y of [y0 - 2, y1 + 2]) if (y >= 0 && y < h) { ring += L[y * w + x]; rn++; }
    if (rn && ring / rn > top - 70) continue;
    blobs.push({ x0, x1: x1 + 1, y0, y1: y1 + 1, slant: vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0 });
  }
  // Small text can break apart (a "3" into its top and bottom halves): pieces stacked right on top of
  // each other are one character.
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < blobs.length && !merged; i++) {
      for (let j = i + 1; j < blobs.length; j++) {
        const a = blobs[i]; const b = blobs[j];
        const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const gap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
        if (overlap < 0.5 * Math.min(a.x1 - a.x0, b.x1 - b.x0) || gap > 2 || gap < -1 || (a.y1 - a.y0) + (b.y1 - b.y0) > hMax * 0.7) continue;
        const big = (a.x1 - a.x0) * (a.y1 - a.y0) >= (b.x1 - b.x0) * (b.y1 - b.y0) ? a : b;
        blobs[i] = { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), slant: big.slant };
        blobs.splice(j, 1); merged = true; break;
      }
    }
  }
  blobs.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  // Lines of text: from each blob, the characters beside it that share its top and bottom (within a
  // quarter of its height; the slash may reach a little past) and are about as tall, each close to
  // the last. Bright specks in leaves or a sky around the pill don't line up like that, so they stay
  // out of the counter's line.
  const lines = []; const keys = new Set();
  for (const seed of blobs) {
    const sh = seed.y1 - seed.y0;
    if (sh < 4) continue;
    const fits = (b) => { const bh = b.y1 - b.y0; return bh >= sh * 0.6 && bh <= sh * 1.45 && Math.abs(b.y1 - seed.y1) <= sh * 0.3 + 1 && Math.abs(b.y0 - seed.y0) <= sh * 0.45 + 1; };
    const line = { ...seed, parts: [seed] };
    for (let grew = true; grew;) {
      grew = false;
      for (const b of blobs) {
        if (line.parts.includes(b) || !fits(b)) continue;
        const gap = b.x0 >= line.x1 ? b.x0 - line.x1 : line.x0 >= b.x1 ? line.x0 - b.x1 : 0;
        if (gap > sh * 0.8) continue;
        line.x0 = Math.min(line.x0, b.x0); line.x1 = Math.max(line.x1, b.x1); line.y0 = Math.min(line.y0, b.y0); line.y1 = Math.max(line.y1, b.y1); line.parts.push(b); grew = true;
      }
    }
    const key = line.parts.map((b) => blobs.indexOf(b)).sort((a, b) => a - b).join(',');
    if (!keys.has(key)) { keys.add(key); lines.push(line); }
  }
  const out = [];
  for (const t of lines) {
    const th = t.y1 - t.y0;
    if (th < hMin * 0.25 || th > hMax * 0.7) continue;
    // The pill around the text: of all rounded outlines centered on it (heights from 1.3 to 4 times the
    // text's, lengths from the text's own on), the one that holds all the way round: just inside
    // darker than just outside. A see-through pill darkens whatever is behind it by the same factor,
    // so this holds over gradients and lines behind it too, and only at the pill's true edge.
    const round1 = (v) => Math.round(v * 10) / 10;
    const cx0 = (t.x0 + t.x1) / 2; const cy0 = (t.y0 + t.y1) / 2; const tw = t.x1 - t.x0;
    const at = (x, y) => { const xi = Math.round(x); const yi = Math.round(y); return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : L[yi * w + xi]; };
    const outline = (cx, cy, rho, a) => {
      let pass = 0; let n = 0;
      const test = (ox, oy, ux, uy) => {
        const i = at(ox + ux * (rho - 2.5), oy + uy * (rho - 2.5)); const o = at(ox + ux * (rho + 2.5), oy + uy * (rho + 2.5));
        if (i < 0 || o < 0) return false;
        n++; if (o - i >= cfg.pillEdge * 0.6 && o >= i * 1.25) pass++;
        return true;
      };
      for (let k = 0; k < 16; k++) {
        const ang = Math.PI / 2 + (Math.PI * k) / 15;
        if (!test(cx - a, cy, Math.cos(ang), Math.sin(ang)) || !test(cx + a, cy, -Math.cos(ang), Math.sin(ang))) return 0;
      }
      for (let k = 1; k < 10; k++) { const x = cx - a + (2 * a * k) / 10; if (!test(x, cy, 0, -1) || !test(x, cy, 0, 1)) return 0; }
      return pass / n;
    };
    let fit = null;
    const rLo = Math.max(hMin / 2, th * 0.65); const rHi = Math.min(hMax / 2, th * 2);
    const dyMax = Math.ceil(th * 0.35); // digits sit a little off the pill's middle
    // Straight part's half-length a: the pill is the text plus some padding (0 to 1.5× the text's
    // height) each side, and its round ends take rho of that.
    const aRange = (rho) => [Math.max(0, tw / 2 - rho), Math.max(0, tw / 2 + th * 1.5 - rho)];
    // Coarse (every 2 px, loosely, as the score peaks sharply), then fine around the best.
    for (let rho = rLo; rho <= rHi; rho += 2) {
      const [aLo, aHi] = aRange(rho);
      for (let a = aLo; a <= aHi; a += 2) {
        for (let dy = -dyMax; dy <= dyMax; dy += 2) {
          const score = outline(cx0, cy0 + dy, rho, a);
          if (score >= 0.5 && (!fit || score > fit.score + 1e-9)) fit = { cx: cx0, cy: cy0 + dy, rho, a, score };
        }
      }
    }
    if (fit) {
      const c = fit;
      for (let rho = c.rho - 2; rho <= c.rho + 2; rho++) for (let a = Math.max(0, c.a - 2); a <= c.a + 2; a++) for (let dy = -2; dy <= 2; dy++) {
        const score = outline(c.cx, c.cy + dy, rho, a);
        if (score > fit.score + 1e-9) fit = { cx: c.cx, cy: c.cy + dy, rho, a, score };
      }
      if (fit.score < 0.85) fit = null; // a true pill's outline holds nearly all the way round
    }
    if (fit) {
      // Lock onto the edge exactly: the nearby outline with the strongest step across it, sampled
      // close to the line (the pass rate above is flat within a pixel or two of it).
      const strength = (cy, rho, a) => {
        let sum = 0; let n = 0;
        const add = (ox, oy, ux, uy) => { const i = at(ox + ux * (rho - 1.5), oy + uy * (rho - 1.5)); const o = at(ox + ux * (rho + 1.5), oy + uy * (rho + 1.5)); if (i >= 0 && o >= 0) { sum += o - i; n++; } };
        for (let k = 0; k < 16; k++) { const ang = Math.PI / 2 + (Math.PI * k) / 15; add(fit.cx - a, cy, Math.cos(ang), Math.sin(ang)); add(fit.cx + a, cy, -Math.cos(ang), Math.sin(ang)); }
        for (let k = 1; k < 10; k++) { const x = fit.cx - a + (2 * a * k) / 10; add(x, cy, 0, -1); add(x, cy, 0, 1); }
        return n ? sum / n : -Infinity;
      };
      let sharp = { cy: fit.cy, rho: fit.rho, a: fit.a, s: strength(fit.cy, fit.rho, fit.a) };
      const c = { ...sharp };
      for (let dy = -2; dy <= 2; dy += 0.5) for (let dr = -2; dr <= 2; dr += 0.5) for (let da = -2; da <= 2; da += 1) {
        const v = strength(c.cy + dy, c.rho + dr, Math.max(0, c.a + da));
        if (v > sharp.s + 1e-9) sharp = { cy: c.cy + dy, rho: c.rho + dr, a: Math.max(0, c.a + da), s: v };
      }
      fit = { ...fit, cy: sharp.cy, rho: sharp.rho, a: sharp.a };
    }
    if (fit) {
      // Refine the center by a pixel either way.
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const sc = outline(fit.cx + dx, fit.cy + dy, fit.rho, fit.a); if (sc > fit.score + 1e-9) fit = { ...fit, cx: fit.cx + dx, cy: fit.cy + dy, score: sc }; }
      // Over busy backgrounds (leaves) the outline can lock a little inside the true edge. Where the
      // pill's inside is one even color, how far that color reaches along its middle row and column
      // says where its ends are: the outline is widened to cover it.
      const reach = evenReach(rgba, w, h, t, fit);
      if (reach) fit = { ...fit, ...widen(fit.cx, fit.cy, fit.a, fit.rho, reach) };
      out.push({ x1: round1(fit.cx - fit.a), x2: round1(fit.cx + fit.a), cy: round1(fit.cy), rho: round1(fit.rho), score: fit.score });
      continue;
    }
    // The pill's edge doesn't show (a background as dark as the pill): the "n/m" text still does.
    // Three or more white characters, one of them a slash, as wide as a counter: the pill is where
    // that text says (measured on real ones: 2.4× the text's height, the text plus 0.7× its height
    // on each side).
    const slash = t.parts.some((b) => b.slant <= -0.75 && b.y1 - b.y0 >= th * 0.7 && b.x1 - b.x0 <= th * 0.8);
    if (t.parts.length >= 3 && slash && tw >= th * 1.2 && tw <= th * 5) {
      const rho = th * 1.2; const cy = (t.y0 + t.y1) / 2;
      if (rho * 2 < hMin || rho * 2 > hMax) continue;
      let g = { cx: (t.x0 + t.x1) / 2, cy, a: Math.max(0, tw / 2 + th * 0.7 - rho), rho };
      const reach = evenReach(rgba, w, h, t, { cy });
      if (reach) g = widen(g.cx, g.cy, g.a, g.rho, reach);
      out.push({ x1: round1(g.cx - g.a), x2: round1(g.cx + g.a), cy: round1(g.cy), rho: round1(g.rho), score: 0 });
    }
  }
  // One pill per place: where outlines overlap (found from different lines of the same text), the
  // one that holds best.
  const kept = [];
  for (const p of out.sort((a, b) => b.score - a.score)) {
    if (kept.some((k) => Math.abs(k.cy - p.cy) < k.rho + p.rho && Math.min(k.x2 + k.rho, p.x2 + p.rho) > Math.max(k.x1 - k.rho, p.x1 - p.rho))) continue;
    kept.push(p);
  }
  return kept.map(({ score, ...p }) => p);
}

/** The rounded outline holds all the way around: pill-colored just inside, lighter just outside. */
function pillOutline(L, w, h, x1, x2, cy, rho, P, cfg) {
  const pts = [];
  for (let i = 0; i < 24; i++) { const a = Math.PI / 2 + (Math.PI * i) / 23; pts.push([x1, cy, Math.cos(a), Math.sin(a)]); pts.push([x2, cy, -Math.cos(a), Math.sin(a)]); }
  for (let i = 1; i < 12; i++) { const x = x1 + ((x2 - x1) * i) / 12; pts.push([x, cy, 0, -1]); pts.push([x, cy, 0, 1]); }
  let pass = 0; let flat = 0;
  for (const [ox, oy, ux, uy] of pts) {
    const at = (d) => { const x = Math.round(ox + ux * d); const y = Math.round(oy + uy * d); return x < 0 || y < 0 || x >= w || y >= h ? -1 : L[y * w + x]; };
    const a = at(rho - 3); const b = at(rho + 3);
    if (a < 0 || b < 0) return false;
    if (b - a >= cfg.pillEdge) pass++;
    if (Math.abs(a - P) <= cfg.flat) flat++;
  }
  return pass / pts.length >= cfg.ring && flat / pts.length >= cfg.ring;
}

/** The fill margin around an icon of radius r (its soft, anti-aliased edge). */
export const fillRadius = (r, cfg = ICON_DEFAULTS) => r + Math.max(2, Math.round(r * cfg.margin));

// ---------- patches ----------

const toBase64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (b64) => Uint8ClampedArray.from(atob(b64), (c) => c.charCodeAt(0));

/** A patch for the state, from fillDisc output in an image of W×H pixels. */
export function makePatch(fill, W, H) {
  return { x: fill.x0 / W, y: fill.y0 / H, w: fill.pw / W, h: fill.ph / H, pw: fill.pw, ph: fill.ph, data: toBase64(fill.rgba) };
}

export function patchPixels(p) { return fromBase64(p.data); }

/** The image (canvas/bitmap) with `patches` painted on, as a new canvas; the image itself if none. */
export function applyPatches(image, patches) {
  if (!patches?.length) return image;
  const W = image.width; const H = image.height;
  const canvas = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: W, height: H }) : new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  for (const p of patches) {
    const tile = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: p.pw, height: p.ph }) : new OffscreenCanvas(p.pw, p.ph);
    tile.getContext('2d').putImageData(new ImageData(patchPixels(p), p.pw, p.ph), 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tile, p.x * W, p.y * H, p.w * W, p.h * H);
  }
  return canvas;
}

/** Set a renderer's source to `base` with `patches` painted on (remembering the unpatched base). */
export function setPatchedSource(r, base, patches) {
  r.setSource(applyPatches(base, patches), base);
}

/**
 * Find the overlay buttons in their corners of `box` (the media, in pixels of a W×H frame) and fill
 * them in: the person button bottom left, the sound button bottom right (each by its white symbol,
 * then by its disc as a fallback), the counter pill top right. `sample(x, y, w, h)` returns full-size
 * RGBA pixels of that rectangle. Returns patches.
 */
export function removeIcons(sample, W, H, box, opts = {}) {
  const cfg = { ...ICON_DEFAULTS, ...opts };
  const rMin = Math.max(6, Math.round(W * cfg.rMin)); const rMax = Math.max(rMin, Math.round(W * cfg.rMax));
  const z = Math.min(Math.round(W * cfg.zone), Math.floor(box.height / 2), Math.floor(box.width / 2));
  if (z < rMin * 3) return [];
  const right = box.x + box.width - z; const bottom = box.y + box.height - z;
  const patches = [];
  // Fill a shape found at zone-relative coordinates, copying background from within the media only.
  const fill = (zx, zy, x1, x2, cy, R) => {
    // Room for the farthest copy the fill may try (1.7× the shape and its band, in any direction).
    const ext = R + 1 + Math.max(4, Math.round(R * 0.35));
    const m = Math.ceil(1.7 * (2 * ext + (x2 - x1)) + ext) + 4;
    const gx = Math.max(box.x, Math.round(zx + x1) - m); const gy = Math.max(box.y, Math.round(zy + cy) - m);
    const gw = Math.min(box.x + box.width, Math.round(zx + x2) + m) - gx; const gh = Math.min(box.y + box.height, Math.round(zy + cy) + m) - gy;
    const f = fillPill(sample(gx, gy, gw, gh), gw, gh, zx + x1 - gx, zx + x2 - gx, zy + cy - gy, R);
    patches.push(makePatch({ ...f, x0: f.x0 + gx, y0: f.y0 + gy }, W, H));
  };
  // The counter pill, top right.
  const tr = sample(right, box.y, z, z);
  for (const p of findPills(tr, z, z, { ...cfg, hMin: Math.round(W * cfg.pillMin), hMax: Math.round(W * cfg.pillMax) })) {
    // Instagram draws it tight in the corner: anything pill-like farther in is part of the photo.
    if (p.cy - p.rho > W * cfg.pillCorner || z - (p.x2 + p.rho) > W * cfg.pillCorner) continue;
    fill(right, box.y, p.x1, p.x2, p.cy, fillRadius(p.rho, cfg));
  }
  // The person button bottom left, the sound button bottom right: by symbol first, then by disc.
  for (const [zx, zy, kinds] of [[box.x, bottom, ['person', 'sound']], [right, bottom, ['sound', 'person']]]) {
    const px = sample(zx, zy, z, z);
    const found = findSymbols(px, z, z, { ...cfg, rMin, rMax, kinds });
    for (const c of findIcons(px, z, z, { ...cfg, rMin, rMax })) if (!found.some((o) => Math.hypot(o.cx - c.cx, o.cy - c.cy) < o.r + c.r)) found.push(c);
    // A disc fitted to its edge needs the usual margin; one placed from its symbol alone a little more.
    for (const c of found) fill(zx, zy, c.cx, c.cx, c.cy, fillRadius(c.r, cfg) + (c.fitted === false ? Math.round(c.r * 0.06) : 0));
  }
  return patches;
}
