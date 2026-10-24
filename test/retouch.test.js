// Overlay icons (Instagram-style round mute / tagged-people buttons) are found in the media's corners
// and filled in from the background around them. Fixtures are the two icons as shared from real
// screenshots; synthetic media has icons at known places, plus look-alikes that must stay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { findIcons, findPills, findSymbols, fillDisc, fillPill, fillRadius, removeIcons, makePatch, patchPixels } from '../web/tools/editor/retouch.js';
import { readPng } from './helpers/png.js';

const lum = (p, i) => 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
const fixture = (name) => readPng(resolve(import.meta.dirname, 'fixtures', name));

/** Paint a fill (fillDisc output) onto a copy of the image. */
function painted(img, fill) {
  const out = Uint8ClampedArray.from(img.px);
  for (let y = 0; y < fill.ph; y++) {
    for (let x = 0; x < fill.pw; x++) {
      const s = (y * fill.pw + x) * 4; const a = fill.rgba[s + 3] / 255; const d = ((fill.y0 + y) * img.w + fill.x0 + x) * 4;
      for (let k = 0; k < 3; k++) out[d + k] = Math.round(out[d + k] * (1 - a) + fill.rgba[s + k] * a);
    }
  }
  return { ...img, px: out };
}
/** Luminance stats of the pixels within radius r of (cx, cy), and of the ring r..r2 around it. */
function stats(img, cx, cy, r, r2) {
  const inner = []; const ring = [];
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) inner.push(lum(img.px, (y * img.w + x) * 4));
      else if (d <= r2) ring.push(lum(img.px, (y * img.w + x) * 4));
    }
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const sd = (a) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
  return { inner: mean(inner), ring: mean(ring), innerSd: sd(inner), min: Math.min(...inner), max: Math.max(...inner) };
}

for (const [name, cx, cy] of [['icon_mute.png', 100.5, 108.5], ['icon_tags.png', 79, 64]]) {
  test(`shared screenshot ${name}: the icon is found and filled to match the background around it`, () => {
    const img = fixture(name);
    const found = findIcons(img.px, img.w, img.h, { rMin: 25, rMax: 55 });
    assert.equal(found.length, 1, JSON.stringify(found));
    const [c] = found;
    assert.ok(Math.hypot(c.cx - cx, c.cy - cy) <= 2 && Math.abs(c.r - 39) <= 2, JSON.stringify(c));
    const disc = stats(img, c.cx, c.cy, c.r * 0.9, c.r * 0.9).inner; // around the rim, inside: the disc color
    const before = stats(img, c.cx, c.cy, c.r - 2, c.r + 12);
    assert.ok(before.min < disc + 10 && before.max > 220, 'a dark disc with a white symbol before');
    const after = stats(painted(img, fillDisc(img.px, img.w, img.h, c.cx, c.cy, fillRadius(c.r))), c.cx, c.cy, c.r + 1, c.r + 12);
    assert.ok(Math.abs(after.inner - after.ring) < 8, `filled ${after.inner.toFixed(1)} vs around ${after.ring.toFixed(1)}`);
    assert.ok(after.max < 225 && after.min > disc + 20, `no white symbol or dark disc left (${after.min.toFixed(0)}..${after.max.toFixed(0)}, disc ${disc.toFixed(0)})`);
    assert.ok(after.innerSd > 1 && after.innerSd < 20, `with the background's grain (sd ${after.innerSd.toFixed(1)})`);
  });
}

test('shared screenshot counter_pill.png: the "11/13" pill is found and filled to match the sky around it', () => {
  const img = fixture('counter_pill.png');
  const found = findPills(img.px, img.w, img.h, { hMin: 30, hMax: 120 });
  assert.equal(found.length, 1, JSON.stringify(found));
  const [p] = found; // measured: x 92..215, y 114..190
  assert.ok(Math.abs(p.x1 - p.rho - 92) <= 3 && Math.abs(p.x2 + p.rho - 215) <= 3 && Math.abs(p.cy - 152) <= 3 && Math.abs(p.rho - 38) <= 3, JSON.stringify(p));
  const R = fillRadius(p.rho);
  const out = painted(img, fillPill(img.px, img.w, img.h, p.x1, p.x2, p.cy, R));
  // Inside the old pill vs just around it, and no white text left.
  const inner = []; const ring = [];
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const d = Math.hypot(x - Math.min(p.x2, Math.max(p.x1, x)), y - p.cy);
    if (d <= R + 1) inner.push(lum(out.px, (y * img.w + x) * 4)); else if (d <= R + 12) ring.push(lum(out.px, (y * img.w + x) * 4));
  }
  const mean = (a) => a.reduce((t, v) => t + v, 0) / a.length;
  assert.ok(Math.abs(mean(inner) - mean(ring)) < 5, `filled ${mean(inner).toFixed(1)} vs around ${mean(ring).toFixed(1)}`);
  assert.ok(Math.max(...inner) < 140, 'no white text left');
});

// ---------- synthetic media ----------

const noise = (x, y, k) => ((((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % 1000) / 1000;
function media(w, h, paint) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = paint(x, y); const i = (y * w + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; }
  return { px, w, h };
}
const backdrop = (x, y) => [150 + 40 * Math.sin(x / 140) + 6 * noise(x, y, 0), 158 + 30 * Math.cos(y / 170) + 6 * noise(x, y, 1), 170 + 6 * noise(x, y, 2)];
/** An Instagram-style button: a 60% black disc with a white symbol (a speaker, or a person). */
function button(cx, cy, r, kind) {
  return (x, y, under) => {
    const d = Math.hypot(x - cx, y - cy);
    if (d > r + 0.5) return under;
    const k = Math.max(0, Math.min(1, r + 0.5 - d));
    const dx = (x - cx) / r; const dy = (y - cy) / r;
    const symbol = kind === 'mute'
      ? (dx > -0.45 && dx < -0.1 && Math.abs(dy) < 0.22) || (dx >= -0.1 && dx < 0.15 && Math.abs(dy) < 0.22 + (dx + 0.1) * 1.4) || Math.abs(dx - dy * 0.9) < 0.06
      : Math.hypot(dx, dy + 0.18) < 0.2 || (dy > 0.1 && dy < 0.4 && Math.abs(dx) < 0.38 - (0.4 - dy) * 0.4);
    const c = symbol ? [255, 255, 255] : under.map((v) => v * 0.4);
    return under.map((v, i) => v * (1 - k) + c[i] * k);
  };
}
const W = 1179; const MH = 1473; // the media of a 1179-wide phone screenshot
const R = 42;
const withButtons = (base, buttons) => (x, y) => buttons.reduce((c, b) => b(x, y, c), base(x, y));

/** Sampler over an image: full-size pixels of a rectangle. */
const sampler = (img) => (x, y, w, h) => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(img.px.subarray(((y + r) * img.w + x) * 4, ((y + r) * img.w + x + w) * 4), r * w * 4);
  return out;
};
function applied(img, patches) {
  let out = img;
  for (const p of patches) out = painted(out, { x0: Math.round(p.x * img.w), y0: Math.round(p.y * img.h), pw: p.pw, ph: p.ph, rgba: patchPixels(p) });
  return out;
}

test('media with the mute and tagged-people buttons in its bottom corners: both are found and filled', () => {
  const buttons = [button(36 + R, MH - 36 - R, R, 'tags'), button(W - 36 - R, MH - 36 - R, R, 'mute')];
  const img = media(W, MH, withButtons(backdrop, buttons));
  const patches = removeIcons(sampler(img), W, MH, { x: 0, y: 0, width: W, height: MH });
  assert.equal(patches.length, 2);
  const out = applied(img, patches);
  for (const cx of [36 + R, W - 36 - R]) {
    const s = stats(out, cx, MH - 36 - R, R + 1, R + 14);
    assert.ok(Math.abs(s.inner - s.ring) < 6, `at x ${cx}: filled ${s.inner.toFixed(1)} vs around ${s.ring.toFixed(1)}`);
    assert.ok(s.max < 215, 'no white symbol left');
  }
  // Nothing else in the picture changed.
  const far = (y, x) => (y * W + x) * 4;
  assert.deepEqual([...out.px.subarray(far(700, 600), far(700, 600) + 4)], [...img.px.subarray(far(700, 600), far(700, 600) + 4)]);
});

/** An Instagram-style counter pill ("2/5") at the top right: 60% black, round ends, white digits. */
const pill = (x0, y0, pw, ph) => (x, y, under) => {
  const r = ph / 2; const cy = y0 + r; const qx = Math.min(x0 + pw - r, Math.max(x0 + r, x)); const d = Math.hypot(x - qx, y - cy);
  if (d > r + 0.5) return under;
  const k = Math.max(0, Math.min(1, r + 0.5 - d));
  const u = (x - x0) / pw; const v = (y - y0) / ph;
  const text = v > 0.3 && v < 0.7 && ((u > 0.3 && u < 0.36) || (u > 0.45 && u < 0.5 && Math.abs(v - 0.5) < 0.2) || (u > 0.6 && u < 0.7 && (v < 0.36 || Math.abs(v - 0.5) < 0.04 || v > 0.64 || u > 0.66)));
  const c = text ? [255, 255, 255] : under.map((t) => t * 0.4);
  return under.map((t, i) => t * (1 - k) + c[i] * k);
};

test('the carousel counter pill in the top-right corner is found and filled', () => {
  const img = media(W, MH, withButtons(backdrop, [pill(W - 36 - 150, 36, 150, 72)]));
  const patches = removeIcons(sampler(img), W, MH, { x: 0, y: 0, width: W, height: MH });
  assert.equal(patches.length, 1);
  const out = applied(img, patches);
  const s = stats(out, W - 36 - 75, 72, 34, 50);
  assert.ok(Math.abs(s.inner - s.ring) < 6 && s.max < 215, `filled ${s.inner.toFixed(1)} vs around ${s.ring.toFixed(1)}, max ${s.max.toFixed(0)}`);
});

test('pill look-alikes stay: a caption band across the picture, a square-cornered dark label', () => {
  // A dark band with white text running off the side of the corner: part of the picture.
  const band = (x, y, under) => (y >= 40 && y < 110 ? ((x >> 4) % 3 === 0 && y > 60 && y < 90 ? [255, 255, 255] : under.map((t) => t * 0.4)) : under);
  const img = media(W, MH, (x, y) => band(x, y, backdrop(x, y)));
  assert.deepEqual(removeIcons(sampler(img), W, MH, { x: 0, y: 0, width: W, height: MH }), []);
  // A square-cornered dark label with text (a sign in the photo).
  const label = (x, y, under) => (x >= W - 190 && x < W - 40 && y >= 40 && y < 112 ? ((x >> 3) % 3 === 0 && y > 62 && y < 90 ? [255, 255, 255] : under.map((t) => t * 0.4)) : under);
  const img2 = media(W, MH, (x, y) => label(x, y, backdrop(x, y)));
  assert.deepEqual(removeIcons(sampler(img2), W, MH, { x: 0, y: 0, width: W, height: MH }), []);
});

/** A button whose gray disc dims the background by `alpha` (Instagram's is about 0.5–0.6). */
function faintButton(cx, cy, r, kind, alpha) {
  const b = button(cx, cy, r, kind);
  return (x, y, under) => {
    const full = b(x, y, under);
    if (full === under) return under;
    const white = full.every((v) => v > 230);
    return white ? full : under.map((v, i) => under[i] - (under[i] - full[i]) * (alpha / 0.6));
  };
}

// The gray disc barely shows on these backgrounds; the white symbol always does.
for (const [name, bg, alpha, r] of [
  ['a dark background', (x, y) => [30 + 10 * noise(x, y, 0), 34, 40], 0.5, 40],
  ['a very dark background', (x, y) => [16 + 6 * noise(x, y, 0), 18, 22], 0.5, 40],
  ['a busy, textured background', (x, y) => [0, 1, 2].map((k) => 90 + 120 * noise(x >> 2, y >> 2, k)), 0.45, 40],
  ['a faint disc on mid gray', (x, y) => [120 + 8 * noise(x, y, 0), 124, 130], 0.3, 40],
  ['small buttons (radius 1.7% of the width)', (x, y) => [150 + 20 * Math.sin(x / 50), 160, 170], 0.55, 20],
]) {
  test(`low contrast: the sound and person buttons are found and filled on ${name}`, () => {
    const at = [[36 + r, MH - 36 - r, 'tags'], [W - 36 - r, MH - 36 - r, 'mute']];
    const img = media(W, MH, withButtons(bg, at.map(([cx, cy, kind]) => faintButton(cx, cy, r, kind, alpha))));
    const patches = removeIcons(sampler(img), W, MH, { x: 0, y: 0, width: W, height: MH });
    assert.equal(patches.length, 2);
    const out = applied(img, patches);
    for (const [cx, cy] of at) {
      const s = stats(out, cx, cy, r + 1, r + 12);
      assert.ok(s.max < 230, `no white symbol left at x ${cx} (max ${s.max.toFixed(0)})`);
      assert.ok(Math.abs(s.inner - s.ring) < 10, `filled ${s.inner.toFixed(1)} vs around ${s.ring.toFixed(1)}`);
    }
  });
}

// ---------- the real symbols, by corner, on any background ----------

/** The white symbol of a shared button screenshot, as offsets from the disc's center in radii. */
function realSymbol(name, cx, cy, r) {
  const img = fixture(name); const pts = [];
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (Math.hypot(x - cx, y - cy) < 0.8 * r && Math.min(...img.px.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 3)) >= 200) pts.push([(x - cx) / r, (y - cy) / r]);
  return pts;
}
const PERSON_PTS = realSymbol('icon_tags.png', 78.6, 64.3, 39);
const SOUND_PTS = realSymbol('icon_mute.png', 100.3, 108.4, 39);
/** A real button: the shared symbol, scaled to radius r, on a disc dimming the background by alpha. */
function realButton(cx, cy, r, pts, alpha) {
  const on = new Set(); const k = r / 39;
  for (const [u, v] of pts) for (let dy = 0; dy < Math.ceil(k); dy++) for (let dx = 0; dx < Math.ceil(k); dx++) on.add(`${Math.round(cx + u * r) + dx},${Math.round(cy + v * r) + dy}`);
  return (x, y, under) => {
    const d = Math.hypot(x - cx, y - cy);
    if (d > r + 0.5) return under;
    if (on.has(`${x},${y}`)) return [255, 255, 255];
    const a = Math.max(0, Math.min(1, r + 0.5 - d)) * alpha;
    return under.map((v) => v * (1 - a));
  };
}

for (const [name, bg] of [
  ['a white background', () => [250, 250, 250]],
  ['pure black (the disc can\'t be seen at all)', () => [0, 0, 0]],
  ['a busy, colorful background', (x, y) => [0, 1, 2].map((k) => 60 + 150 * noise(x >> 3, y >> 3, k))],
]) {
  test(`the person button bottom left and the sound button bottom right are found by their symbol on ${name}`, () => {
    const r = 42;
    const at = [[36 + r, MH - 36 - r, PERSON_PTS], [W - 36 - r, MH - 36 - r, SOUND_PTS]];
    const img = media(W, MH, withButtons(bg, at.map(([cx, cy, pts]) => realButton(cx, cy, r, pts, 0.55))));
    const patches = removeIcons(sampler(img), W, MH, { x: 0, y: 0, width: W, height: MH });
    assert.equal(patches.length, 2);
    const out = applied(img, patches); const clean = media(W, MH, bg);
    for (const [cx, cy] of at) {
      // Every pixel of the old button now within reach of the plain background there.
      let worst = 0;
      for (let y = Math.round(cy - r); y <= cy + r; y++) for (let x = Math.round(cx - r); x <= cx + r; x++) {
        if (Math.hypot(x - cx, y - cy) > r) continue;
        worst = Math.max(worst, Math.abs(lum(out.px, (y * W + x) * 4) - lum(clean.px, (y * W + x) * 4)));
      }
      assert.ok(worst < (name.startsWith('a busy') ? 150 : 25), `button at x ${cx}: worst difference from the background ${worst.toFixed(0)}`);
      const s = stats(out, cx, cy, r, r + 10);
      assert.ok(s.max < 255 || name.startsWith('a white'), 'no white symbol left');
    }
  });
}

test('the symbols are told apart from white words: a person, a speaker, and text', () => {
  const r = 40; const z = 300;
  const paint = (pts) => media(z, z, withButtons(() => [0, 0, 0], [realButton(150, 150, r, pts, 0.55)]));
  const kindOf = (img) => findSymbols(img.px, z, z, { rMin: 15, rMax: 70 }).map((c) => c.kind);
  assert.deepEqual(kindOf(paint(PERSON_PTS)), ['person']);
  assert.deepEqual(kindOf(paint(SOUND_PTS)), ['sound']);
  const words = media(z, z, (x, y) => (y > 130 && y < 165 && x > 90 && x < 210 && (x >> 3) % 3 !== 2 ? [255, 255, 255] : [0, 0, 0]));
  assert.deepEqual(kindOf(words), []);
  const found = findSymbols(paint(PERSON_PTS).px, z, z, { rMin: 15, rMax: 70 })[0];
  assert.ok(Math.hypot(found.cx - 150, found.cy - 150) <= 3 && Math.abs(found.r - r) <= r * 0.1, JSON.stringify(found));
});

test('the counter pill top right is found from its "n/m" text even when its edge can\'t be seen', () => {
  // White "2/5" on a pill exactly as dark as the background around it.
  const glyphs = (x, y) => {
    const u = x - (W - 140); const v = y - 60;
    if (v < 0 || v >= 30) return false;
    return (u >= 0 && u < 5) || (u >= 30 && u < 34 && v >= 0) || (Math.abs((u - 12) - (30 - v) * 0.4) < 2.5 && u >= 10 && u < 26) || (u >= 40 && u < 58 && (v < 4 || v > 26 || (u < 44 && v < 15) || (u > 54 && v > 13) || (v > 13 && v < 17)));
  };
  const img = media(W, MH, (x, y) => (glyphs(x, y) ? [255, 255, 255] : [20, 22, 26]));
  const patches = removeIcons(sampler(img), W, MH, { x: 0, y: 0, width: W, height: MH });
  assert.equal(patches.length, 1);
  const out = applied(img, patches);
  let white = 0;
  for (let y = 50; y < 100; y++) for (let x = W - 150; x < W - 70; x++) if (lum(out.px, (y * W + x) * 4) > 200) white++;
  assert.equal(white, 0, 'no text left');
});

test('the fill copies the background in: stripes continue through, not a blur', () => {
  const stripes = (x) => [x % 16 < 8 ? 200 : 120, 140, 110];
  const r = 42; const cx = W - 36 - r; const cy = MH - 36 - r;
  const img = media(W, MH, withButtons(stripes, [realButton(cx, cy, r, SOUND_PTS, 0.55)]));
  const out = applied(img, removeIcons(sampler(img), W, MH, { x: 0, y: 0, width: W, height: MH }));
  let err = 0; let n = 0;
  for (let y = cy - r + 4; y < cy + r - 4; y++) for (let x = cx - r + 4; x < cx + r - 4; x++) { if (Math.hypot(x - cx, y - cy) > r - 4) continue; err += Math.abs(out.px[(y * W + x) * 4] - stripes(x)[0]); n++; }
  assert.ok(err / n < 12, `mean difference from the true stripes ${(err / n).toFixed(1)} (a blur would be ~40)`);
});

test('white symbols without a disc stay: a white logo and letters on a dark, plain corner', () => {
  const dark = (x, y) => [28 + 6 * noise(x, y, 0), 30, 34];
  const logo = (x, y, under) => (Math.hypot(x - 100, y - (MH - 100)) < 14 || (Math.abs(x - 100) < 22 && y > MH - 84 && y < MH - 72) ? [255, 255, 255] : under);
  const letters = (x, y, under) => (y > MH - 110 && y < MH - 80 && x > W - 260 && x < W - 60 && (x >> 3) % 3 === 0 ? [250, 250, 250] : under);
  const img = media(W, MH, (x, y) => letters(x, y, logo(x, y, dark(x, y))));
  assert.deepEqual(removeIcons(sampler(img), W, MH, { x: 0, y: 0, width: W, height: MH }), []);
});

test('look-alikes stay: a dark round object without a symbol, white text, a plain photo, a top-corner logo', () => {
  const ball = (x, y, under) => (Math.hypot(x - 90, y - (MH - 90)) <= 40 ? [60, 58, 62] : under);         // dark ball, no symbol
  const text = (x, y, under) => (y > MH - 120 && y < MH - 90 && x > W - 300 && x < W - 40 && (x >> 3) % 2 ? [255, 255, 255] : under);
  const img = media(W, MH, (x, y) => text(x, y, ball(x, y, backdrop(x, y))));
  assert.deepEqual(removeIcons(sampler(img), W, MH, { x: 0, y: 0, width: W, height: MH }), []);
  const plain = media(W, MH, backdrop);
  assert.deepEqual(removeIcons(sampler(plain), W, MH, { x: 0, y: 0, width: W, height: MH }), []);
  // An icon in the middle of the picture is content (only the corners hold the app's buttons).
  const middle = media(W, MH, withButtons(backdrop, [button(W / 2, MH / 2, R, 'mute')]));
  assert.deepEqual(removeIcons(sampler(middle), W, MH, { x: 0, y: 0, width: W, height: MH }), []);
});

test('patches: source-relative, round-trip their pixels, and the same input gives the same patches', () => {
  const img = media(W, MH, withButtons(backdrop, [button(W - 36 - R, MH - 36 - R, R, 'mute')]));
  const a = removeIcons(sampler(img), W, MH, { x: 0, y: 0, width: W, height: MH });
  assert.equal(a.length, 1);
  const [p] = a;
  assert.ok(p.x > 0.85 && p.x < 0.95 && p.y > 0.9 && Math.round(p.w * W) === p.pw && Math.round(p.h * MH) === p.ph, JSON.stringify({ ...p, data: '…' }));
  assert.equal(patchPixels(p).length, p.pw * p.ph * 4);
  const fill = { x0: 3, y0: 4, pw: 2, ph: 1, rgba: Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 0]) };
  assert.deepEqual([...patchPixels(makePatch(fill, 10, 10))], [1, 2, 3, 255, 4, 5, 6, 0]);
  assert.deepEqual(removeIcons(sampler(img), W, MH, { x: 0, y: 0, width: W, height: MH }), a);
});

test('fast enough: the four corners of a phone-screenshot media in well under 150 ms', () => {
  const img = media(W, MH, withButtons(backdrop, [button(36 + R, MH - 36 - R, R, 'tags'), button(W - 36 - R, MH - 36 - R, R, 'mute')]));
  const s = sampler(img);
  removeIcons(s, W, MH, { x: 0, y: 0, width: W, height: MH });
  const t = performance.now();
  removeIcons(s, W, MH, { x: 0, y: 0, width: W, height: MH });
  const ms = performance.now() - t;
  assert.ok(ms < 150, `${ms.toFixed(1)} ms`);
});
