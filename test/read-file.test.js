// A picked file read in full at once (web/lib/read-file.js): tried again when a read fails or stalls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFully, typeOf, isVideo } from '../web/lib/read-file.js';

test('a file read in full, with its progress, as a new File of the same name and type', async () => {
  const f = new File([new Uint8Array(300000)], 'clip.MOV');
  const seen = []; const out = await readFully(f, { onProgress: (q) => seen.push(q) });
  assert.equal(out.size, 300000); assert.equal(out.name, 'clip.MOV'); assert.equal(out.type, 'video/quicktime');
  assert.equal(seen.at(-1), 1); assert.ok(isVideo(out)); assert.equal(typeOf({ name: 'a.heic' }), 'image/heic');
});

test('a read that fails (iCloud not ready) tried again; one that never reads gives a clear error', async () => {
  const good = new File(['hello'], 'a.jpg', { type: 'image/jpeg' }); let n = 0;
  const flaky = { name: 'a.jpg', type: 'image/jpeg', size: 5, stream: () => { n++; if (n < 3) throw new Error('NotReadableError'); return good.stream(); } };
  const out = await readFully(flaky, { wait: 1 });
  assert.equal(await out.text(), 'hello'); assert.equal(n, 3);
  const short = { name: 'b.mov', type: '', size: 10, stream: () => new File(['abc'], 'x').stream() };
  await assert.rejects(readFully(short, { wait: 1, tries: 2 }), /couldn't be read.*iCloud/);
  const stuck = { name: 'c.mov', type: '', size: 10, stream: () => new ReadableStream({ pull: () => new Promise(() => {}) }) };
  await assert.rejects(readFully(stuck, { wait: 1, tries: 2, stall: 20 }), /stopped loading/);
});
