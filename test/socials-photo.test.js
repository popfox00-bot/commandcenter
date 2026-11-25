// Socials' photo-made words: EXIF (when and where), the nearest place, what a photo's labels, faces and light
// say (socials-predict.js), suggested captions, and a post's scene kept made safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readExif } from '../web/lib/exif.js';
import { nearestPlace } from '../web/lib/places.js';
import { sceneWords, toneFromPixels, suggestCaption, generateComments } from '../web/apps/socials/socials-predict.js';
import { cleanScene, emptyState, addAccount, addPost, autoComment, normalize } from '../web/apps/socials/socials-core.js';

/** A small JPEG header with EXIF: DateTimeOriginal and GPS (lat, lon), little-endian. */
function jpegWithExif(date, lat, lon) {
  const b = []; const u16 = (v) => b.push(v & 255, v >> 8); const u32 = (v) => { u16(v & 0xffff); u16(v >>> 16); };
  // TIFF: header, IFD0 (2 entries: Exif ptr, GPS ptr), Exif IFD (1 entry), GPS IFD (4 entries), data.
  b.push(0x49, 0x49); u16(42); u32(8);
  const ifd0 = 8; const exif = ifd0 + 2 + 2 * 12 + 4; const gps = exif + 2 + 12 + 4; const data = gps + 2 + 4 * 12 + 4;
  const dateAt = data; const latAt = dateAt + 20; const lonAt = latAt + 24;
  u16(2); u16(0x8769); u16(4); u32(1); u32(exif); u16(0x8825); u16(4); u32(1); u32(gps); u32(0);
  u16(1); u16(0x9003); u16(2); u32(20); u32(dateAt); u32(0);
  const dms = (v) => { const a = Math.abs(v); const d = Math.floor(a); const m = Math.floor((a - d) * 60); const s = Math.round(((a - d) * 60 - m) * 60 * 100); return [[d, 1], [m, 1], [s, 100]]; };
  u16(4); u16(1); u16(2); u32(2); b.push(lat < 0 ? 83 : 78, 0, 0, 0); u16(2); u16(5); u32(3); u32(latAt); u16(3); u16(2); u32(2); b.push(lon < 0 ? 87 : 69, 0, 0, 0); u16(4); u16(5); u32(3); u32(lonAt); u32(0);
  for (const ch of `${date}\0`) b.push(ch.charCodeAt(0));
  for (const [n, d] of dms(lat)) { u32(n); u32(d); } for (const [n, d] of dms(lon)) { u32(n); u32(d); }
  const exifHead = [0x45, 0x78, 0x69, 0x66, 0, 0]; const len = 2 + exifHead.length + b.length;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...exifHead, ...b, 0xff, 0xda, 0, 2]).buffer;
}

test('EXIF: when a photo was taken and where; the nearest place to it', () => {
  const x = readExif(jpegWithExif('2026:07:04 20:15:09', 40.015, -105.27));
  assert.equal(x.taken, '2026-07-04T20:15:09'); assert.equal(x.hour, 20);
  assert.ok(Math.abs(x.lat - 40.015) < 0.001 && Math.abs(x.lon + 105.27) < 0.001);
  assert.equal(nearestPlace(x.lat, x.lon), 'Boulder'); assert.equal(nearestPlace(-33.9, 151.2), 'Sydney');
  assert.equal(nearestPlace(0, -140), null, 'mid-ocean: nowhere');
  assert.deepEqual(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), {}, 'not a JPEG');
  assert.deepEqual(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer), {}, 'no EXIF');
});

test('what a photo shows, as words: labels to topics and things, faces, light, time', () => {
  const dog = sceneWords({ labels: [['golden retriever', 0.8]], faces: 1, hour: 7 });
  assert.deepEqual(dog.topics, ['pet']); assert.deepEqual(dog.things, ['golden retriever']); assert.equal(dog.faces, 0, 'an animal\'s face isn\'t a person'); assert.ok(dog.morning);
  assert.deepEqual(sceneWords({ labels: [['cheeseburger', 0.96]], tone: 'sunset' }).topics, ['food'], 'warm food isn\'t a sunset');
  assert.deepEqual(sceneWords({ labels: [['seashore', 0.6]], tone: 'sunset' }).topics, ['beach', 'sunset']);
  const two = sceneWords({ faces: 2, hour: 23 }); assert.equal(two.faces, 2); assert.ok(two.night); assert.deepEqual(two.topics, ['friends']);
  assert.deepEqual(sceneWords({ labels: [['jigsaw puzzle', 0.9]] }).topics, [], 'labels it doesn\'t know: nothing');
  assert.deepEqual(sceneWords(null).topics, []);
  const px = (fn, w = 20, h = 20) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { const [r, g, b] = fn(Math.floor(i / w) / h); d.set([r, g, b, 255], i * 4); } return toneFromPixels(d, w, h); };
  assert.equal(px(() => [10, 10, 20]), 'night'); assert.equal(px((y) => (y < 0.5 ? [250, 140, 80] : [60, 50, 50])), 'sunset');
  assert.equal(px(() => [240, 240, 245]), 'snow'); assert.equal(px(() => [60, 120, 220]), 'blue'); assert.equal(px(() => [60, 160, 70]), 'green'); assert.equal(px(() => [128, 128, 128]), null);
});

test('comments and captions made from the photo', () => {
  const all = (photo, cap = '') => { const out = []; for (let i = 0; i < 50; i++) out.push(...generateComments(cap, 3, { photo })); return out.join('\n'); };
  assert.match(all({ labels: [['golden retriever', 0.8]] }), /golden retriever|cutie|cute|adorable/i);
  assert.match(all({ faces: 2 }), /you two|duo/); assert.match(all({ faces: 5 }), /crew|group|faces/);
  assert.match(all({ labels: [['seashore', 0.7]], place: 'Maui' }), /Maui/);
  assert.match(all({ labels: [['sports car', 0.7]] }, 'Saturday'), /ride|car|spin/i);
  const caps = new Set(); for (let i = 0; i < 30; i++) caps.add(suggestCaption({ labels: [['pizza', 0.9]], place: 'Denver' }));
  for (const c of caps) { assert.match(c, /📍 Denver/); assert.match(c, /#/); }
  assert.ok(caps.size > 3, 'varied');
  assert.match(suggestCaption({ faces: 1 }), /\S/); assert.match(suggestCaption({}), /\S/);
  const a = suggestCaption({ labels: [['alp', 0.8]] }); assert.notEqual(suggestCaption({ labels: [['alp', 0.8]] }, { avoid: [a] }), a);
});

test('a post\'s scene kept made safe; new posts\' comments written for them', () => {
  assert.deepEqual(cleanScene({ labels: [['pizza', 0.9], ['x', 'bad']], faces: 2, tone: 'sunset', place: 'Denver', hour: 9, taken: '2026-01-02T03:04:05', evil: '<script>' }), { labels: [['pizza', 0.9]], faces: 2, tone: 'sunset', place: 'Denver', hour: 9, taken: '2026-01-02T03:04:05' });
  assert.equal(cleanScene({ tone: 'purple', hour: 99 }), null); assert.equal(cleanScene('x'), null);
  const s = emptyState(); const o = addAccount(s, { handle: 'own' }); for (const h of ['a', 'b', 'c']) addAccount(s, { handle: h });
  const p = addPost(s, o.id, { image: new Blob(['x']), caption: 'hi', scene: { faces: 2 } });
  assert.deepEqual(p.scene, { faces: 2 });
  assert.equal(addPost(s, o.id, { image: new Blob(['y']) }).scene, undefined, 'not read yet');
  const n = normalize(JSON.parse(JSON.stringify(s))); assert.deepEqual(n.posts[0].scene, { faces: 2 });
  const made = autoComment(s, p.id, { write: (who) => who.map((a) => `nice one from ${a.handle}`) });
  assert.equal(made.length, 3); for (const c of made) assert.match(c.text, /^nice one from [abc]$/);
});
