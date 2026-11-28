// Video Editor → 📱 Socials Frame (web/tools/video/video-frame-core.js): every output 1080 × 1920; each frame's video
// place; crops toward the people (inside the picture, the right shape); the people's point over time, eased; counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUT, STYLES, styleById, cropToward, focusPath, shortCount, callClock, framedName } from '../web/tools/video/video-frame-core.js';

test('one output size; four frames, each video place inside it', () => {
  assert.deepEqual(OUT, { w: 1080, h: 1920 });
  assert.deepEqual(STYLES.map((s) => s.id), ['story', 'post', 'short', 'call']);
  for (const s of STYLES) assert.ok(s.video.x >= 0 && s.video.y >= 0 && s.video.x + s.video.w <= OUT.w && s.video.y + s.video.h <= OUT.h, s.id);
  assert.equal(styleById('post').video.w / styleById('post').video.h, 0.8, 'a 4:5 post');
  assert.equal(styleById('nope').id, 'story');
  // (No other app's name in them.)
  assert.ok(!STYLES.some((s) => /instagram|snapchat|facebook|facetime|tiktok/i.test(`${s.name} ${s.note}`)));
});

test('crops: the frame\'s shape, inside the picture, toward the point asked', () => {
  const c = cropToward(1920, 1080, 9 / 16, 0.9, 0.5);
  assert.equal(c.sh, 1080); assert.equal(c.sw, Math.round(1080 * 9 / 16)); assert.equal(c.sx + c.sw, 1920, 'as far right as fits');
  const l = cropToward(1920, 1080, 9 / 16, 0.1, 0.5); assert.equal(l.sx, 0);
  const tall = cropToward(1080, 1920, 4 / 5, 0.5, 0.2); assert.equal(tall.sw, 1080); assert.equal(tall.sh, 1350); assert.equal(tall.sy, 0);
});

test('the people\'s point over time: faces weighted by size, held through moments with none, eased between', () => {
  const at = focusPath([
    { t: 0, faces: [{ x: 0.1, y: 0.2, w: 0.1, h: 0.1 }] },
    { t: 1, faces: [] },
    { t: 2, faces: [{ x: 0.7, y: 0.2, w: 0.2, h: 0.2 }, { x: 0.1, y: 0.2, w: 0.05, h: 0.05 }] },
  ]);
  const a = at(0); const b = at(2); const mid = at(1.5);
  assert.ok(a.x < 0.4 && b.x > 0.5, `${a.x} ${b.x}`);
  assert.ok(mid.x > a.x && mid.x < b.x);
  assert.deepEqual(focusPath([])(1), { x: 0.5, y: 0.45 });
});

test('counts, call times and names', () => {
  assert.deepEqual([999, 1280, 34500, 1500000].map(shortCount), ['999', '1.3K', '35K', '1.5M']);
  assert.equal(callClock(65), '1:05'); assert.equal(callClock(7), '0:07');
  assert.equal(framedName('Beach day.MOV', 'call'), 'Beach day-call.mp4');
});
