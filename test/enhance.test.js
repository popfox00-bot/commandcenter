// Auto-Enhance: slight but meaningful, per photo. Each case checks the settings and, through the
// renderer's color math (simulate), what they do to that photo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoAdjust, simulate, ENHANCE } from '../web/tools/editor/enhance.js';

const W = 240; const H = 180;
const noise = (x, y, k) => ((((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % 1000) / 1000;
/** A W×H RGBA "photo" painted by f(x, y) -> [r, g, b] in 0..255. */
function photo(f) {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = f(x, y); const i = (y * W + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; }
  return px;
}
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Brightness percentiles of a photo before and after settings `a`. */
function look(px, a = {}) {
  const L = [];
  for (let i = 0; i < px.length; i += 4 * 7) L.push(luma(...simulate(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, a)));
  L.sort((x, y) => x - y);
  const p = (q) => L[Math.floor(q * (L.length - 1))];
  return { p01: p(0.01), p05: p(0.05), p50: p(0.5), p95: p(0.95), clip: L.filter((v) => v >= 0.995).length / L.length };
}
// A scene: sky with a bright cloud, grass, a red object, dark tree shadows, a little grain.
const scene = (gain = 1, offset = 0, cast = [0, 0, 0]) => photo((x, y) => {
  const sky = y < H * 0.45; const obj = (x - 160) ** 2 + (y - 120) ** 2 < 900;
  const cloud = sky && (x - 60) ** 2 + (y - 30) ** 2 < 260; const shade = !sky && x < 40;
  const base = cloud ? [236, 238, 240] : sky ? [120 + y * 0.6, 160 + y * 0.3, 210] : obj ? [190, 70, 50] : shade ? [10, 13, 11] : [70 + (x % 40), 110, 60 + (y % 30)];
  return base.map((v, k) => v * gain + offset + cast[k] + 8 * noise(x, y, k));
});
const slight = (a) => Object.entries(a).every(([k, v]) => Math.abs(v) <= ({ blackPoint: 0.4, warmth: 0.5, tint: 0.4, exposure: 0.5 }[k] ?? 0.35));

test('a well exposed, colorful photo gets only light touches', () => {
  const px = scene();
  const a = autoAdjust(px, W, H);
  assert.ok(slight(a), JSON.stringify(a));
  assert.ok(Math.abs(a.exposure) <= 0.12 && a.highlights === 0 && a.blackPoint === 0, JSON.stringify(a));
  assert.ok(a.sharpness > 0 && a.definition > 0 && a.vibrance > 0, 'a little crispness and color');
  const before = look(px); const after = look(px, a);
  assert.ok(Math.abs(after.p50 - before.p50) < 0.05, `middle tone ${before.p50.toFixed(2)} → ${after.p50.toFixed(2)}`);
});

test('a dark photo is brightened part of the way, with shadows opened and no extra clipping', () => {
  const px = scene(0.35);
  const a = autoAdjust(px, W, H);
  assert.ok(a.exposure > 0.25 && a.exposure <= ENHANCE.maxExposure, JSON.stringify(a));
  assert.ok(a.shadows > 0, 'shadows lifted');
  const before = look(px); const after = look(px, a);
  assert.ok(after.p50 > before.p50 + 0.08 && after.p50 < ENHANCE.midTarget, `middle tone ${before.p50.toFixed(2)} → ${after.p50.toFixed(2)}: brighter, still a dark photo`);
  assert.ok(after.clip <= before.clip + ENHANCE.clipSlack + 0.002);
});

test('a hazy, flat photo gets its black point back and some contrast', () => {
  const px = scene(0.45, 95);
  const a = autoAdjust(px, W, H);
  assert.ok(a.blackPoint > 0.1 && a.contrast > 0, JSON.stringify(a));
  const before = look(px); const after = look(px, a);
  assert.ok(after.p01 < before.p01 - 0.05, `darkest ${before.p01.toFixed(2)} → ${after.p01.toFixed(2)}`);
  assert.ok(after.p95 - after.p05 > (before.p95 - before.p05) * 1.25, 'more spread');
});

test('a bright photo with blown highlights is brought down, not brightened', () => {
  const px = photo((x, y) => (y < H * 0.4 ? [252, 252, 250] : [200 + (x % 40), 190, 170 + 10 * noise(x, y, 0)]));
  const a = autoAdjust(px, W, H);
  assert.ok(a.highlights < 0 && a.exposure <= 0, JSON.stringify(a));
});

test('a color cast in neutral areas is corrected partly: blue gets warmer, green gets magenta tint', () => {
  // Gray things across the whole tonal range (a street, a building), with a cast.
  const gray = (cast) => photo((x, y) => { const v = 20 + x * 0.9; return [v, v, v].map((c, k) => c + cast[k] + 6 * noise(x, y, k)); });
  const blue = autoAdjust(gray([-14, 0, 14]), W, H);
  assert.ok(blue.warmth > 0.1 && blue.warmth <= 0.5, JSON.stringify(blue));
  const green = autoAdjust(gray([-6, 12, -6]), W, H);
  assert.ok(green.tint > 0.1 && green.tint <= 0.4, JSON.stringify(green));
  // Corrected by about half (not neutralized: a golden hour stays golden).
  const px = gray([-14, 0, 14]);
  const [r, , b] = simulate(px[0] / 255, px[1] / 255, px[2] / 255, blue);
  const before = (px[0] - px[2]) / 255; const after = r - b;
  assert.ok(after > before && after < before * 0.4, `blue cast ${before.toFixed(3)} → ${after.toFixed(3)}`);
  const neutral = autoAdjust(gray([0, 0, 0]), W, H);
  assert.equal(neutral.warmth, 0); assert.equal(neutral.tint, 0);
});

test('a muted photo gets more vibrance than a colorful one; a soft photo more sharpening', () => {
  const muted = autoAdjust(photo((x, y) => { const v = 90 + (x % 80) + 8 * noise(x, y, 0); return [v, v + 4, v + 2]; }), W, H);
  const vivid = autoAdjust(photo((x) => (x % 60 < 30 ? [220, 40, 40] : [30, 90, 220])), W, H);
  assert.ok(muted.vibrance > vivid.vibrance, `${muted.vibrance} vs ${vivid.vibrance}`);
  const soft = autoAdjust(photo((x, y) => [100 + x * 0.3, 120 + y * 0.3, 140]), W, H);
  const crisp = autoAdjust(photo((x, y) => [0, 1, 2].map((k) => 60 + 140 * noise(x >> 1, y >> 1, k))), W, H); // fine texture
  assert.ok(soft.sharpness > crisp.sharpness && soft.definition > crisp.definition);
});

test('each photo gets its own settings; the same photo always the same', () => {
  const photos = [scene(), scene(0.35), scene(0.45, 95), scene(1, 0, [-14, 0, 14])];
  const results = photos.map((px) => JSON.stringify(autoAdjust(px, W, H)));
  assert.equal(new Set(results).size, photos.length, 'all different');
  for (let i = 0; i < 2; i++) assert.deepEqual(photos.map((px) => JSON.stringify(autoAdjust(px, W, H))), results);
  for (const r of results) assert.ok(slight(JSON.parse(r)), r);
});

test('simulate matches the renderer math for the default (no change) and clamps', () => {
  assert.deepEqual(simulate(0.25, 0.5, 0.75, {}).map((v) => Math.round(v * 1000) / 1000), [0.25, 0.5, 0.75]);
  assert.deepEqual(simulate(0.9, 0.9, 0.9, { exposure: 1 }), [1, 1, 1]);
});
