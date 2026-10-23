// Auto-Crop: find the post's media in a feed screenshot and drop the app around it. Synthetic
// screenshots are painted here with known coordinates (status bar, banner, header, media, carousel
// dots, action bar, caption, next post, floating tab bar); the reference fixture is a real screenshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AUTO_CROP_DEFAULTS, hexToRgb, findMedia, findBars, cropForBars, describeBars,
  downscale, estimateChrome, chromeMask, rowStats, classifyRows, contentRuns,
} from '../web/tools/editor/autocrop.js';
import { readPng } from './helpers/png.js';

// ---------- a tiny painter ----------

function canvas(w, h, color) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = color[0]; px[i * 4 + 1] = color[1]; px[i * 4 + 2] = color[2]; px[i * 4 + 3] = 255; }
  return { px, w, h };
}
function rect(img, x0, y0, x1, y1, paint) {
  for (let y = Math.max(0, y0); y < Math.min(img.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(img.w, x1); x++) {
    const c = typeof paint === 'function' ? paint(x, y) : paint;
    const i = (y * img.w + x) * 4; img.px[i] = c[0]; img.px[i + 1] = c[1]; img.px[i + 2] = c[2];
  }
}
function circle(img, cx, cy, r, color) { rect(img, cx - r, cy - r, cx + r, cy + r, (x, y) => ((x - cx) ** 2 + (y - cy) ** 2 <= r * r ? color : null) ?? pixel(img, x, y)); }
function roundRect(img, x0, y0, x1, y1, r, paint) {
  rect(img, x0, y0, x1, y1, (x, y) => {
    const cx = x < x0 + r ? x0 + r : x >= x1 - r ? x1 - r - 1 : x; const cy = y < y0 + r ? y0 + r : y >= y1 - r ? y1 - r - 1 : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r ? (typeof paint === 'function' ? paint(x, y) : paint) : pixel(img, x, y);
  });
}
const pixel = (img, x, y) => { const i = (y * img.w + x) * 4; return [img.px[i], img.px[i + 1], img.px[i + 2]]; };
/** A line of "text": glyph-sized blocks with letter and word gaps. */
function text(img, x0, y0, x1, size, color) { for (let x = x0, k = 0; x < x1; k++) { const word = 4 + (k % 4); for (let c = 0; c < word && x < x1; c++, x += Math.round(size * 0.7)) rect(img, x, y0, x + Math.round(size * 0.5), y0 + size, color); x += size; } }
// Deterministic noise and textures.
const noise = (x, y, k) => ((((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % 1000) / 1000;
const textured = (x, y) => [110 + 70 * Math.sin(x / 37) + 30 * noise(x, y, 0), 120 + 60 * Math.cos(y / 53) + 30 * noise(x, y, 1), 90 + 80 * Math.sin((x + y) / 71) + 30 * noise(x, y, 2)];
const gradient = (y0, y1) => (x, y) => { const t = (y - y0) / (y1 - y0); return [60 + 150 * t, 140 - 60 * t, 200 - 120 * t]; };

const DARK = [13, 17, 23]; // #0d1117
const W = 1179; const H = 2556;

/**
 * A feed screenshot, iPhone size. Media at [mx0, mx1) × [my0, my1) painted with `paint`.
 * Everything else is app chrome: status bar, "Try Muse" banner, account header, carousel dots,
 * action bar with counts, caption and timestamp, the next post's header and media, a floating tab bar.
 */
function feed({ chrome = DARK, ink = [235, 235, 235], my0 = 445, my1 = 1918, mx0 = 0, mx1 = W, paint = textured, card = 0, tabBar = true, nextPost = true } = {}) {
  const img = canvas(W, H, chrome);
  text(img, 140, 45, 260, 36, ink); rect(img, 940, 50, 1100, 80, ink);                       // status bar
  roundRect(img, 98, 110, 1082, 210, 30, [79, 91, 230]); text(img, 480, 145, 700, 30, [255, 255, 255]); // "Try Muse"
  circle(img, 80, 370, 48, [200, 170, 90]); text(img, 160, 352, 400, 36, ink);               // header
  for (const y of [358, 370, 382]) rect(img, 1080, y, 1140, y + 6, ink);
  if (card) roundRect(img, mx0, my0, mx1, my1, card, paint); else rect(img, mx0, my0, mx1, my1, paint); // media
  for (const x of [570, 600, 630]) circle(img, x, 1965, 8, x === 570 ? [88, 101, 242] : [90, 90, 90]); // dots
  for (const x of [40, 250, 400, 550]) { roundRect(img, x, 2020, x + 56, 2076, 14, ink); text(img, x + 70, 2032, x + 120, 34, ink); }
  roundRect(img, 1100, 2020, 1148, 2076, 6, ink);                                             // action bar
  text(img, 36, 2130, 900, 34, ink); text(img, 36, 2195, 220, 28, [130, 130, 130]);        // caption, time
  if (nextPost) { circle(img, 80, 2370, 40, [70, 110, 220]); text(img, 150, 2352, 420, 34, ink); rect(img, 30, 2450, 780, H, [242, 242, 242]); rect(img, 800, 2450, W, H, [180, 160, 140]); }
  if (tabBar) { roundRect(img, 150, 2330, 1030, 2470, 70, [36, 38, 46]); for (const x of [230, 400, 570, 740, 910]) roundRect(img, x - 28, 2372, x + 28, 2428, 10, [220, 220, 220]); }
  return img;
}
const box = (m) => ({ x: m.x, y: m.y, width: m.width, height: m.height });

// ---------- row classification and runs ----------

test('rows: chrome (flat or with sparse text) vs content, by distance from the chrome color not by flatness', () => {
  const img = canvas(400, 100, DARK);
  text(img, 10, 10, 200, 8, [230, 230, 230]);          // text on chrome: still chrome
  rect(img, 0, 30, 400, 60, [196, 196, 196]);          // flat gray media: content even though variance is 0
  rect(img, 0, 70, 400, 80, [26, 30, 36]);             // near chrome (distance ~22): content
  const chrome = { palette: [DARK], dist: 10 };
  const stats = rowStats(img, chromeMask(img, chrome));
  const flags = classifyRows(stats);
  const content = [...flags].map((f, y) => (f ? y : -1)).filter((y) => y >= 0);
  assert.deepEqual(content, [...Array.from({ length: 30 }, (_, i) => 30 + i), ...Array.from({ length: 10 }, (_, i) => 70 + i)]);
  assert.equal(stats.variance[40], 0, 'the gray media row is perfectly flat');
  assert.equal(stats.dominant[40], 1);
  assert.ok(stats.chromeShare[15] > 0.5 && stats.chromeShare[15] < 1, 'text row: mostly chrome');
  assert.deepEqual([...stats.mean.slice(40 * 3, 40 * 3 + 3)], [196, 196, 196]);
});

test('runs: gaps under 1% merge, short runs are rejected, the longest wins', () => {
  const f = (s) => Uint8Array.from(s, (c) => (c === '#' ? 1 : 0));
  assert.deepEqual(contentRuns(f('..####.####....##..'), 2, 3), [{ start: 2, end: 11 }]);
  assert.deepEqual(contentRuns(f('..####..####....##..'), 2, 3), [{ start: 2, end: 6 }, { start: 8, end: 12 }]);
  assert.deepEqual(contentRuns(f('##....######'), 1, 3), [{ start: 6, end: 12 }]);
  assert.deepEqual(contentRuns(f('.##.'), 1, 3), []);
});

test('chrome color: the mode of the margins, with its noise setting the match distance', () => {
  const img = feed();
  const A = downscale(img.px, W, H, 400);
  const c = estimateChrome(A);
  assert.ok(c.palette[0].every((v, k) => Math.abs(v - DARK[k]) <= 1), `${c.palette[0]}`);
  assert.equal(c.dist, AUTO_CROP_DEFAULTS.chromeDistMin);
  // A plain photo has no chrome at its top or bottom: nothing to crop.
  const photo = canvas(800, 600, [0, 0, 0]); rect(photo, 0, 0, 800, 600, textured);
  assert.equal(estimateChrome(downscale(photo.px, 800, 600, 400)), null);
});

// ---------- synthetic screenshots: exact bounds ----------

for (const [name, paint, my0, my1] of [
  ['solid gray media (flat, like the coin slab photo)', [196, 196, 196], 445, 1918],
  ['gradient media', gradient(445, 1918), 445, 1918],
  ['noisy photo media', textured, 445, 1918],
  ['landscape media (a short 16:9 band)', textured, 700, 1363],
  ['tall 4:5 media', gradient(420, 1894), 420, 1894],
]) {
  test(`dark mode, ${name}: exact media bounds, no header, banner, dots or action bar`, () => {
    const img = feed({ paint, my0, my1 });
    const m = findMedia(img.px, W, H);
    assert.deepEqual(box(m), { x: 0, y: my0, width: W, height: my1 - my0 });
    assert.equal(m.method, 'chrome-contrast');
    assert.ok(m.confidence >= 0.9, `confidence ${m.confidence}`);
  });
}

test('light mode with a colored photo: same logic, exact bounds', () => {
  const img = feed({ chrome: [255, 255, 255], ink: [20, 20, 20], paint: textured });
  const m = findMedia(img.px, W, H);
  assert.deepEqual(box(m), { x: 0, y: 445, width: W, height: 1918 - 445 });
  assert.equal(m.method, 'chrome-contrast');
});

for (const [label, ox0, ox1] of [['a narrow object', 300, 880], ['a wide object', 180, 1000]]) {
  test(`light mode, white photo with ${label}: falls back to the header above and the action icons below, and asks to check`, () => {
    const white = [255, 255, 255];
    // The media's background is the chrome's white; only the object inside it can be seen.
    const img = feed({ chrome: white, ink: [20, 20, 20], paint: (x, y) => (x >= ox0 && x < ox1 && y >= 745 && y < 1618 ? [40, 120, 200] : white) });
    const m = findMedia(img.px, W, H);
    assert.equal(m.method, 'ui-anchor-fallback');
    assert.ok(m.confidence < AUTO_CROP_DEFAULTS.sure, `confidence ${m.confidence}: the edges can't be seen, so the crop is offered for checking`);
    assert.ok(m.y >= 418 && m.y <= 445 + H * 0.02, `top ${m.y}: below the header, at the media top`);
    const bottom = m.y + m.height;
    assert.ok(bottom >= 1918 - H * 0.01 && bottom <= 2020, `bottom ${bottom}: above the action bar`);
    assert.ok(m.y <= 745 && bottom >= 1618, 'the whole object is kept');
  });
}

test('media almost the chrome color (#151a21 on #0d1117) is still found exactly', () => {
  const img = feed({ paint: (x, y) => [21 + Math.round(2 * noise(x, y, 0)), 26, 33] });
  assert.deepEqual(box(findMedia(img.px, W, H)), { x: 0, y: 445, width: W, height: 1473 });
});

test('media with dark top and bottom edges and a chrome-colored line inside: one media, exact bounds', () => {
  const img = feed({ paint: (x, y) => (y < 525 ? [0, 0, 0] : y >= 1858 ? [4, 4, 6] : y >= 1100 && y < 1103 ? DARK : textured(x, y)) });
  assert.deepEqual(box(findMedia(img.px, W, H)), { x: 0, y: 445, width: W, height: 1473 });
});

test('never cuts the sides: an inset card with rounded corners keeps the full width', () => {
  const img = feed({ mx0: 60, mx1: 1119, my0: 445, my1: 1700, card: 40, paint: textured });
  const m = findMedia(img.px, W, H);
  assert.deepEqual(box(m), { x: 0, y: 445, width: W, height: 1255 });
  assert.ok(m.confidence >= 0.8, `confidence ${m.confidence}`);
});

test('never cuts the sides: a photo whose left part is the app\'s own color keeps the full width', () => {
  // Left 45% of the photo is dark like the app (a night scene, a black backdrop): only rows are cut.
  const img = feed({ paint: (x, y) => (x < 530 ? [13 + Math.round(3 * noise(x, y, 0)), 17, 23] : textured(x, y)) });
  const m = findMedia(img.px, W, H);
  assert.deepEqual([m.x, m.width], [0, W], 'full width');
  assert.deepEqual([m.y, m.y + m.height], [445, 1918]);
});

test('media running under a floating tab bar: cut above the bar, nothing blurred behind it', () => {
  const img = feed({ my0: 900, my1: H, nextPost: false, paint: textured });
  const m = findMedia(img.px, W, H);
  assert.equal(m.y, 900);
  assert.ok(Math.abs(m.y + m.height - 2330) <= 4, `bottom ${m.y + m.height}, tab bar at 2330`);
});

test('no app screen (a plain photo): left alone', () => {
  const photo = canvas(1200, 900, [0, 0, 0]); rect(photo, 0, 0, 1200, 900, textured);
  const m = findMedia(photo.px, 1200, 900);
  assert.equal(m.method, 'none');
  assert.deepEqual(box(m), { x: 0, y: 0, width: 1200, height: 900 });
});

// ---------- the reference screenshot ----------

const FIXTURES = ['test/fixtures', 'tests/fixtures'].map((d) => resolve(import.meta.dirname, '..', d));
const fixture = (name) => FIXTURES.map((d) => join(d, name)).find(existsSync);

test('reference: dark navy feed, flat light-gray coin slab photo (the screenshot as shared, 723×1568)', () => {
  const { px, w, h } = readPng(fixture('feed_dark_gray_media_723.png'));
  const m = findMedia(px, w, h);
  const k = w / 1179; // expected edges at 1179×2556: y 445..1918
  assert.equal(m.method, 'chrome-contrast');
  assert.ok(m.confidence >= 0.9, `confidence ${m.confidence}`);
  assert.deepEqual([m.x, m.width], [0, w], 'full width');
  assert.ok(Math.abs(m.y - 445 * k) <= 4, `top ${m.y} vs ${445 * k}`);
  assert.ok(Math.abs(m.y + m.height - 1918 * k) <= 4, `bottom ${m.y + m.height} vs ${1918 * k}`);
  // Not the pcgscoin header (its avatar ends ~250), the banner or the carousel dots (~1205).
  assert.ok(m.y > 255 && m.y + m.height < 1195);
});

test('reference at full size (1179×2556 original, when supplied as feed_dark_gray_media.png)', { skip: !fixture('feed_dark_gray_media.png') && 'fixture not supplied yet' }, () => {
  const { px, w, h } = readPng(fixture('feed_dark_gray_media.png'));
  assert.deepEqual([w, h], [1179, 2556]);
  const m = findMedia(px, w, h);
  assert.deepEqual([m.x, m.width], [0, 1179]);
  assert.ok(Math.abs(m.y - 445) <= 4, `top ${m.y}`);
  assert.ok(Math.abs(m.y + m.height - 1918) <= 4, `bottom ${m.y + m.height}`);
});

// ---------- determinism, speed, compatibility ----------

test('deterministic: the same input gives the identical result every run', () => {
  const { px, w, h } = readPng(fixture('feed_dark_gray_media_723.png'));
  const img = feed({ mx0: 60, mx1: 1119, my0: 445, my1: 1700, card: 40 });
  const a = [findMedia(px, w, h), findMedia(img.px, W, H)];
  for (let i = 0; i < 3; i++) assert.deepEqual([findMedia(px, w, h), findMedia(img.px, W, H)], a);
});

test('fast enough: a 1179×2556 screenshot in well under 150 ms (pure JS, downscale included)', () => {
  const img = feed();
  findMedia(img.px, W, H); // warm up
  const t = performance.now();
  findMedia(img.px, W, H);
  const ms = performance.now() - t;
  assert.ok(ms < 150, `${ms.toFixed(1)} ms`);
});

test('compatibility: findBars rows, cropForBars, describeBars, hex colors', () => {
  const img = feed();
  const bars = findBars(img.px, W, H);
  assert.deepEqual([bars.top, bars.bottom, bars.foundTop, bars.foundBottom], [445, 1918, true, true]);
  assert.deepEqual(cropForBars(bars, H), { x: 0, w: 1, y: 445 / H, h: 1473 / H });
  assert.equal(describeBars(bars, W, H), `Cropped to the post: top 445 px, bottom ${H - 1918} px (100% sure)`);
  assert.equal(describeBars({ ...bars, confidence: 0.4 }, W, H), 'Not sure where the post is (40% sure): check the crop');
  assert.equal(describeBars(null), 'No app screen found: left uncropped');
  assert.deepEqual(hexToRgb('#022157'), [2, 33, 87]);
  assert.throws(() => hexToRgb('navy'));
});
