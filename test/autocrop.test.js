// Auto-Crop: navy (#022157) bars at the top/bottom are found per photo, including JPEG-ish noise,
// text on the bar, thin lines, one-sided bars, and photos without bars (left alone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBars, cropForBars, describeBars, hexToRgb, AUTO_CROP_DEFAULTS } from '../web/tools/editor/autocrop.js';

const NAVY = hexToRgb('#022157');

/** Build an RGBA image: rows painted by fn(y) -> [r,g,b] or fn(x, y). */
function image(w, h, paint) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = paint(x, y);
    const i = (y * w + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  }
  return px;
}
// "Photo" content: varied colors, never close to navy.
const photo = (x, y) => [120 + ((x * 7 + y * 3) % 100), 90 + ((x * 3) % 120), 40 + ((y * 5) % 60)];
const jitter = (c, x, y) => c.map((v, k) => Math.max(0, Math.min(255, v + (((x * 31 + y * 17 + k * 13) % 23) - 11))));

test('hex colors', () => {
  assert.deepEqual(hexToRgb('#022157'), [2, 33, 87]);
  assert.deepEqual(hexToRgb('fff'), [255, 255, 255]);
  assert.throws(() => hexToRgb('navy'));
  assert.deepEqual(AUTO_CROP_DEFAULTS.colors, ['#022157', '#0B1014']);
});

test('top and bottom navy bars (with compression noise) are cropped away, each photo its own rows', () => {
  const w = 60; const h = 200;
  const a = image(w, h, (x, y) => (y < 30 || y >= 170 ? jitter(NAVY, x, y) : photo(x, y)));
  assert.deepEqual(findBars(a, w, h), { top: 30, bottom: 170, foundTop: true, foundBottom: true });
  const b = image(w, h, (x, y) => (y < 12 || y >= 188 ? NAVY : photo(x, y)));
  assert.deepEqual(findBars(b, w, h), { top: 12, bottom: 188, foundTop: true, foundBottom: true });
  const crop = cropForBars(findBars(a, w, h), h);
  assert.deepEqual(crop, { x: 0, w: 1, y: 0.15, h: 0.7 });
  assert.equal(describeBars(findBars(a, w, h), 4000, h), 'Cropped top 600 px, bottom 600 px');
});

test('a bar with a logo/text on it, a blurred edge, and a thin line are all handled', () => {
  const w = 100; const h = 300;
  const img = image(w, h, (x, y) => {
    if (y < 40) return y > 10 && y < 30 && x > 20 && x < 50 ? [255, 255, 255] : NAVY; // text on the bar
    if (y === 40) return x % 2 ? NAVY : [60, 70, 90];                                // blurred edge row
    if (y === 250) return NAVY;                                                       // 1-px line above a footer
    return photo(x, y);
  });
  const bars = findBars(img, w, h);
  assert.equal(bars.top, 41, 'bar, text rows and the blurred edge all go');
  assert.equal(bars.bottom, 250, 'everything from the line down goes');
});

test('only one side, no bars, and navy content in the middle', () => {
  const w = 50; const h = 100;
  const topOnly = findBars(image(w, h, (x, y) => (y < 10 ? NAVY : photo(x, y))), w, h);
  assert.deepEqual(topOnly, { top: 10, bottom: 100, foundTop: true, foundBottom: false });
  const none = findBars(image(w, h, photo), w, h);
  assert.deepEqual(none, { top: 0, bottom: 100, foundTop: false, foundBottom: false });
  assert.equal(cropForBars(none, h), null);
  assert.equal(describeBars(none, 100, h), 'No bars found: left uncropped');
  // A navy stripe in the middle of the picture is content, not a boundary.
  const middle = findBars(image(w, h, (x, y) => (y >= 48 && y < 52 ? NAVY : photo(x, y))), w, h);
  assert.equal(middle.foundTop || middle.foundBottom, false);
  // A bright red bar is not a boundary...
  const red = findBars(image(w, h, (x, y) => (y < 10 ? [220, 30, 30] : photo(x, y))), w, h);
  assert.equal(red.foundTop, false);
  // ...unless that color is chosen.
  assert.equal(findBars(image(w, h, (x, y) => (y < 10 ? [220, 30, 30] : photo(x, y))), w, h, { color: '#dc1e1e' }).top, 10);
  assert.equal(findBars(image(w, h, (x, y) => (y < 10 ? [220, 30, 30] : photo(x, y))), w, h, { colors: ['#dc1e1e'] }).top, 10);
});

test('either boundary color: navy #022157 or near-black #0B1014, even both in one photo', () => {
  const w = 60; const h = 200;
  const DARK = hexToRgb('#0B1014');
  const dark = findBars(image(w, h, (x, y) => (y < 25 || y >= 180 ? jitter(DARK, x, y) : photo(x, y))), w, h);
  assert.deepEqual(dark, { top: 25, bottom: 180, foundTop: true, foundBottom: true });
  const mixed = findBars(image(w, h, (x, y) => (y < 20 ? NAVY : y >= 170 ? DARK : photo(x, y))), w, h);
  assert.deepEqual(mixed, { top: 20, bottom: 170, foundTop: true, foundBottom: true });
  // Each bar is one flat color; either boundary color works on either side.
  const flipped = findBars(image(w, h, (x, y) => (y < 15 ? DARK : y >= 185 ? NAVY : photo(x, y))), w, h);
  assert.deepEqual(flipped, { top: 15, bottom: 185, foundTop: true, foundBottom: true });
});

// ---------- the cases that cut into pictures before ----------

// Deterministic noise, -n..+n per channel.
const noise = (n) => (x, y, k) => (((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % (2 * n + 1) - n;
const tex = (base, n) => (x, y) => base.map((v, k) => Math.max(0, Math.min(255, v + noise(n)(x, y, k))));

test('dark picture content next to the bar is not cropped: the cut is at the bar\'s clean line', () => {
  const w = 120; const h = 400;
  const BLACK = [0, 0, 0];
  // Letterbox: pure black bars (40 rows) around a night photo whose top is dark blue-gray sky.
  const sky = tex([20, 25, 40], 12);
  const img = image(w, h, (x, y) => (y < 40 || y >= 360 ? BLACK : y < 140 ? sky(x, y) : photo(x, y)));
  assert.deepEqual(findBars(img, w, h), { top: 40, bottom: 360, foundTop: true, foundBottom: true });
});

test('a dark band inside the picture (shadow, road) is ignored: the outermost bar is used', () => {
  const w = 120; const h = 400;
  const DARK = hexToRgb('#0B1014');
  // Navy header 30 rows, then picture with a near-black band at rows 110-130 across 80% of the width.
  const img = image(w, h, (x, y) => (y < 30 ? NAVY : y >= 110 && y < 130 && x < 96 ? DARK : photo(x, y)));
  const bars = findBars(img, w, h);
  assert.equal(bars.top, 30, 'cut at the header, not at the dark band in the picture');
  assert.equal(bars.foundBottom, false);
});

test('a textured dark area at the edge of a photo without bars is left alone', () => {
  const w = 120; const h = 400;
  const night = tex([12, 16, 22], 25);
  const img = image(w, h, (x, y) => (y < 100 ? night(x, y) : photo(x, y)));
  assert.deepEqual(findBars(img, w, h), { top: 0, bottom: 400, foundTop: false, foundBottom: false });
});

test('screenshot layouts: light status bar above the bar, a separator line inside it, a tab bar with icons', () => {
  const w = 120; const h = 600;
  const DARK = hexToRgb('#0B1014');
  const img = image(w, h, (x, y) => {
    if (y < 20) return [250, 250, 250];                                        // light status bar
    if (y < 70) return y === 45 ? [90, 110, 140] : NAVY;                       // navy bar with a 1px separator
    if (y >= 520) return y > 540 && y < 560 && x % 30 < 10 ? [200, 200, 200] : DARK; // tab bar with icons
    return photo(x, y);
  });
  assert.deepEqual(findBars(img, w, h), { top: 70, bottom: 520, foundTop: true, foundBottom: true });
});

test('heavy compression and a soft edge: the line is found within a pixel or two, never deep in the picture', () => {
  const w = 120; const h = 400;
  const img = image(w, h, (x, y) => {
    if (y < 50 || y >= 350) return tex(NAVY, 6)(x, y);
    if (y === 50 || y === 349) return NAVY.map((v, k) => Math.round((v + photo(x, y)[k]) / 2)); // blended row
    return photo(x, y);
  });
  const bars = findBars(img, w, h);
  assert.ok(bars.top >= 50 && bars.top <= 52, `top ${bars.top}`);
  assert.ok(bars.bottom <= 350 && bars.bottom >= 348, `bottom ${bars.bottom}`);
});

test('the existing horizontal crop is kept', () => {
  assert.deepEqual(cropForBars({ top: 20, bottom: 80, foundTop: true, foundBottom: true }, 100, { x: 0.1, y: 0, w: 0.8, h: 1 }), { x: 0.1, w: 0.8, y: 0.2, h: 0.6 });
});
