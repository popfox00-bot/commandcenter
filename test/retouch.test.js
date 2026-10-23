// Overlay icons (Instagram-style round mute / tagged-people buttons) are found in the media's corners
// and filled in from the background around them. Fixtures are the two icons as shared from real
// screenshots; synthetic media has icons at known places, plus look-alikes that must stay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { findIcons, fillDisc, fillRadius, removeIcons, makePatch, patchPixels } from '../web/tools/editor/retouch.js';
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
  assert.ok(p.x > 0.85 && p.x < 0.95 && p.y > 0.9 && p.w * W === p.pw && p.h * MH === p.ph, JSON.stringify({ ...p, data: '…' }));
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
