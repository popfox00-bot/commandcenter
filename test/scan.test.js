import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homography, applyH, warp, quadSize, detectDocument, enhance, otsu } from '../web/tools/scan/scan-core.js';

/** Synthetic photo: dark table, a tilted light-gray sheet with dark "text" bars. */
function photo(W = 320, H = 240, quad = [[60, 30], [270, 50], [250, 220], [40, 200]]) {
  const data = new Uint8ClampedArray(W * H * 4);
  const inside = (x, y) => {
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = quad[i]; const [x2, y2] = quad[(i + 1) % 4];
      s += Math.sign((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1));
    }
    return Math.abs(s) === 4;
  };
  const H2 = homography(quad, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const j = (y * W + x) * 4;
    let v = 40 + (x % 7); // table
    if (inside(x + 0.5, y + 0.5)) {
      const [u, w] = applyH(H2, x + 0.5, y + 0.5);
      const shade = 200 - u * 50; // uneven lighting: darker on the right
      v = w > 0.2 && w < 0.8 && Math.floor(w * 12) % 2 === 0 && u > 0.15 && u < 0.85 ? 50 : shade;
    }
    data[j] = data[j + 1] = data[j + 2] = v; data[j + 3] = 255;
  }
  return { data, width: W, height: H, quad };
}

test('homography maps the four corners exactly', () => {
  const from = [[0, 0], [100, 0], [100, 50], [0, 50]];
  const to = [[10, 20], [110, 5], [120, 70], [5, 60]];
  const H = homography(from, to);
  for (let i = 0; i < 4; i++) {
    const [x, y] = applyH(H, ...from[i]);
    assert.ok(Math.abs(x - to[i][0]) < 1e-6 && Math.abs(y - to[i][1]) < 1e-6);
  }
});

test('finds the sheet of paper on a darker background', () => {
  const img = photo();
  const { corners, confident } = detectDocument(img);
  assert.ok(confident);
  corners.forEach(([u, v], i) => {
    const [x, y] = img.quad[i];
    assert.ok(Math.abs(u * img.width - x) < 6 && Math.abs(v * img.height - y) < 6, `corner ${i}: ${u * img.width},${v * img.height} vs ${x},${y}`);
  });
});

test('no clear sheet: falls back to a near-full-frame guess', () => {
  const W = 100; const H = 80;
  const data = new Uint8ClampedArray(W * H * 4).fill(128);
  const r = detectDocument({ data, width: W, height: H });
  assert.equal(r.confident, false);
});

test('flattening the tilted sheet fills the output with paper, edge to edge', () => {
  const img = photo();
  const { width, height } = quadSize(img.quad);
  const flat = warp(img, img.quad, width, height);
  let dark = 0; // table pixels would be ~40
  for (let y = 0; y < height; y++) for (const x of [1, width - 2]) if (flat.data[(y * width + x) * 4] < 90) dark += 1;
  assert.ok(dark < height * 0.06, `edges are paper, not table (${dark} dark edge pixels)`);
  assert.ok(width > height, 'landscape sheet stays landscape');
});

test('cleanup whitens uneven paper and keeps ink dark; B&W is pure black and white', () => {
  const img = photo();
  const { width, height } = quadSize(img.quad);
  const flat = warp(img, img.quad, width, height);
  const lumAt = (im, fx, fy) => im.data[((Math.floor(fy * im.height) * im.width) + Math.floor(fx * im.width)) * 4];
  const clean = enhance(flat, 'color');
  assert.ok(lumAt(clean, 0.05, 0.1) > 235 && lumAt(clean, 0.95, 0.1) > 235, 'both sides of the paper are white now');
  assert.ok(lumAt(flat, 0.95, 0.1) < 170, 'it was gray before');
  const bw = enhance(flat, 'bw');
  const values = new Set(); for (let i = 0; i < bw.data.length; i += 4) values.add(bw.data[i]);
  assert.deepEqual([...values].sort((a, b) => a - b), [0, 255]);
  const text = Array.from({ length: 40 }, (_, i) => lumAt(bw, 0.5, 0.2 + i * 0.015)).filter((v) => v === 0).length;
  assert.ok(text > 5, 'text lines survive as black');
});

test('otsu splits a bimodal histogram between the modes', () => {
  const L = new Float32Array(1000).map((_, i) => (i % 2 ? 40 : 200));
  const t = otsu(L);
  assert.ok(t >= 40 && t < 200);
});

test('Clean mode neutralizes a yellowish paper tint', () => {
  const W = 120; const H = 90;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 235; data[i * 4 + 1] = 225; data[i * 4 + 2] = 170; data[i * 4 + 3] = 255; }
  const out = enhance({ data, width: W, height: H }, 'color');
  const [r, g, b] = out.data.slice(0, 3);
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 12, `neutral: ${r},${g},${b}`);
});
