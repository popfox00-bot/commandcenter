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
  for (const c of caps) { assert.match(c, /Denver/); assert.match(c, /#/); }
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

test('videos: several frames read as one; a phone video\'s own record of when and where', async () => {
  const { mergeScenes } = await import('../web/apps/socials/socials-vision.js');
  const { readVideoMeta } = await import('../web/lib/exif.js');
  const m = mergeScenes([{ labels: [['seashore', 0.5]], faces: 0, tone: 'sunset' }, { labels: [['seashore', 0.7], ['dock', 0.2]], faces: 2, tone: 'sunset' }, { labels: [['dock', 0.3]], faces: 1, tone: 'blue' }, null]);
  assert.equal(m.labels[0][0], 'seashore', 'seen most and surest first'); assert.equal(m.faces, 2); assert.equal(m.tone, 'sunset');
  assert.deepEqual(mergeScenes([]), {});
  const enc = (t) => new TextEncoder().encode(t).buffer;
  const x = readVideoMeta(enc('....moov...com.apple.quicktime.location.ISO6709\0\0data+39.7392-104.9903+1609.000/...com.apple.quicktime.creationdate\0\0data2026-11-25T18:34:55-0700'));
  assert.equal(x.taken, '2026-11-25T18:34:55'); assert.equal(x.hour, 18); assert.equal(x.lat, 39.7392); assert.equal(x.lon, -104.9903);
  assert.equal(readVideoMeta(enc('udta ©xyz +48.8577+002.2950/')).lat, 48.8577);
  assert.deepEqual(readVideoMeta(enc('nothing here')), {});
});

test('the scene from pixels: colours named, the background apart from people, the outfit, poses, brands', async () => {
  const { colorName, backgroundOf, outfitOf, posesOf, brandIn } = await import('../web/apps/socials/socials-scene.js');
  assert.equal(colorName(10, 10, 12), 'black'); assert.equal(colorName(245, 245, 245), 'white'); assert.equal(colorName(200, 30, 30), 'red'); assert.equal(colorName(20, 40, 110), 'navy');
  assert.equal(colorName(40, 90, 200), 'blue'); assert.equal(colorName(230, 210, 175), 'beige'); assert.equal(colorName(128, 128, 128), 'gray'); assert.equal(colorName(30, 140, 50), 'green');
  const img = (w, h, fn) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { const [r, g, b] = fn(i % w / w, Math.floor(i / w) / h); d.set([r, g, b, 255], i * 4); } return d; };
  const W = 40; const H = 40;
  // A blue sky over grass: sky and green, not a beach.
  assert.deepEqual(backgroundOf(img(W, H, (x, y) => (y < 0.5 ? [90, 150, 230] : [60, 150, 60])), W, H).sort(), ['green', 'sky']);
  // Sky over sand and water.
  const beach = backgroundOf(img(W, H, (x, y) => (y < 0.4 ? [100, 160, 235] : y < 0.7 ? [40, 110, 170] : [225, 200, 160])), W, H);
  assert.ok(beach.includes('sky') && beach.includes('water') && beach.includes('sand'), beach.join());
  assert.ok(backgroundOf(img(W, H, (x, y) => (y < 0.5 ? [250, 140, 70] : [40, 30, 30])), W, H).includes('sunset'));
  assert.ok(backgroundOf(img(W, H, () => [8, 8, 15]), W, H).includes('night'));
  // A person (the middle) in red, over a blue sky: only the sky is the background.
  const person = new Uint8Array(W * H); const clothes = new Uint8Array(W * H); const skin = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { const x = i % W; const y = Math.floor(i / W); if (x > 12 && x < 28 && y > 8) { person[i] = 255; if (y > 16) clothes[i] = 255; else skin[i] = 255; } }
  const px = img(W, H, (x, y) => (x > 0.3 && x < 0.7 && y > 0.4 ? [200, 30, 40] : [90, 150, 230]));
  assert.deepEqual(backgroundOf(px, W, H, person), ['sky']);
  const o = outfitOf(px, W, H, clothes, skin); assert.equal(o.color, 'red'); assert.ok(o.skin > 0.1 && o.skin < 0.5); assert.ok(o.area > 0.1);
  assert.equal(outfitOf(px, W, H, new Uint8Array(W * H), skin), null);
  // Poses: arms up; hands on hips; sitting; head to toe; a group with arms up.
  const P = (o = {}) => ({ shoulders: [[40, 40, 1], [60, 40, 1]], elbows: [[35, 55, 1], [65, 55, 1]], wrists: [[35, 70, 1], [65, 70, 1]], hips: [[43, 75, 1], [57, 75, 1]], knees: [[43, 100, 1], [57, 100, 1]], ankles: [[43, 125, 1], [57, 125, 1]], nose: [50, 30, 1], ...o });
  assert.ok(posesOf([P({ wrists: [[35, 15, 1], [65, 15, 1]] })], 100, 130).includes('armsup'));
  assert.ok(posesOf([P({ wrists: [[35, 15, 1], [65, 70, 1]] })], 100, 130).includes('wave'));
  assert.ok(posesOf([P({ wrists: [[44, 73, 1], [56, 73, 1]], elbows: [[25, 58, 1], [75, 58, 1]] })], 100, 130).includes('hips'));
  assert.ok(posesOf([P({ knees: [[43, 80, 1], [57, 80, 1]] })], 100, 130).includes('sitting'));
  assert.ok(posesOf([P()], 100, 130).includes('full'));
  assert.ok(posesOf([0, 1, 2].map(() => P({ wrists: [[35, 15, 1], [65, 15, 1]] })), 100, 130).includes('allarmsup'));
  assert.deepEqual(posesOf([], 100, 130), []);
  assert.equal(brandIn('JUST DO IT  nike'), 'Nike'); assert.equal(brandIn('the NORTH FACE'), 'The North Face'); assert.equal(brandIn('DENVER BRONCOS'), 'Broncos'); assert.equal(brandIn('nikeland pumas'), null);
});

test('photo facts checked against each other: a blue sky isn\'t a beach; clothes, seasons, graduation, brands, poses and counts', () => {
  const sky = { labels: [['seashore', 0.35]], people: 1, faces: 1, bg: ['sky', 'green'] };
  const all = (photo, n = 40) => { const out = []; for (let i = 0; i < n; i++) out.push(...generateComments('', 3, { photo })); return out.join('\n'); };
  assert.doesNotMatch(all(sky), /beach|waves|water/i, 'no sand or water: no beach'); assert.match(all(sky), /sky|day|weather|green|nature/i);
  assert.match(all({ labels: [['seashore', 0.5]], bg: ['sky', 'sand', 'water'] }), /beach|waves|water/i);
  assert.doesNotMatch(all({ faces: 1, people: 1, poses: ['close'] }), /fit|ootd|outfit/i, 'nothing worn named: no fit talk');
  assert.match(suggestCaption({ labels: [['academic gown', 0.6]], people: 1, taken: '2026-05-20T10:00:00' }), /grad|gown|Class of 2026|did it/i);
  assert.match(suggestCaption({ labels: [['academic gown', 0.6]], people: 1, taken: '2026-05-20T10:00:00' }), /#classof2026|#graduation/);
  assert.match(all({ labels: [['parka', 0.4]], people: 1, bg: ['snow'], outfit: { color: 'black', skin: 0.03 } }), /layers|bundled|winter|warm|snow|coat/i);
  assert.match(all({ people: 1, outfit: { color: 'blue', skin: 0.5 }, bg: ['sand', 'water'] }), /summer|sunshine|warm/i);
  assert.match(all({ people: 1, brand: 'Nike' }), /Nike/); assert.match(suggestCaption({ people: 1, brand: 'Nike' }), /Nike.*#nike/);
  assert.match(all({ people: 4, poses: ['allarmsup'] }), /crew|group|faces|arms|energy|joy/i);
  assert.match(all({ people: 1, outfit: { color: 'red' }, labels: [['gown', 0.5]] }), /red dress/);
  // The most specific first: graduation over the sky and the group; the brand over the colour.
  assert.match(suggestCaption({ labels: [['mortarboard', 0.5]], people: 3, bg: ['sky'] }), /🎓/);
  assert.match(suggestCaption({ people: 1, brand: 'Adidas', outfit: { color: 'black' } }), /Adidas/);
});

test('a batch of comments: each about something different, worded differently, with different emojis', () => {
  const photo = { labels: [['golden retriever', 0.8]], place: 'Boulder', bg: ['green', 'sky'], hour: 8 };
  for (let k = 0; k < 30; k++) {
    const b = generateComments('Saturday walk 🥰', 5, { photo });
    assert.equal(new Set(b).size, 5);
    const openings = b.map((c) => c.toLowerCase().split(/\s+/).slice(0, 2).join(' ')); assert.ok(new Set(openings).size >= 4, `openings: ${b.join(' | ')}`);
    const emojis = b.flatMap((c) => c.match(/\p{Extended_Pictographic}/gu) ?? []); assert.ok(new Set(emojis).size >= Math.min(emojis.length, 5) - 1, `emojis: ${b.join(' | ')}`);
  }
  const b = generateComments('', 3, { photo: { labels: [['golden retriever', 0.8]], place: 'Boulder', people: 0 } });
  assert.ok(b.some((c) => /retriever|cutest|face|hug|good one/i.test(c)) && b.some((c) => /Boulder/.test(c)), b.join(' | '));
});
