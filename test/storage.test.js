// Storage (Productivity): sizes (GB from 1,000 MB), the pie's slices, Saved Files' Drive folder counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slices, pct, tallyDrive, driveKind, itemName } from '../web/apps/storage/storage-core.js';

test('sizes: KB, MB, and GB from 1,000 MB on', async () => {
  globalThis.localStorage ??= { length: 0, key: () => null, getItem: () => null };
  const { human } = await import('../web/lib/storage-usage.js');
  assert.equal(human(500), '500 B');
  assert.equal(human(12 * 1024), '12 KB');
  assert.equal(human(3.4 * 1024 * 1024), '3.4 MB');
  assert.equal(human(999 * 1024 * 1024), '999 MB');
  assert.equal(human(1000 * 1024 * 1024), '0.98 GB');
  assert.equal(human(9.4 * 1024 ** 3), '9.40 GB');
  assert.equal(human(15 * 1024 ** 3), '15.0 GB');
});

test('pie slices: biggest first, fractions of the circle, tiny ones together as Other', () => {
  const s = slices([{ name: 'a', bytes: 10 }, { name: 'b', bytes: 70 }, { name: 'c', bytes: 20 }, { name: 'z', bytes: 0 }]);
  assert.deepEqual(s.map((x) => x.name), ['b', 'c', 'a']);
  assert.equal(s[0].start, 0); assert.ok(Math.abs(s[2].end - 1) < 1e-9);
  const t = slices([{ name: 'big', bytes: 1000 }, { name: 'x', bytes: 1 }, { name: 'y', bytes: 2 }]);
  assert.deepEqual(t.map((x) => x.name), ['big', 'Other']); assert.deepEqual(t[1].others, ['y', 'x']);
  assert.deepEqual(slices([{ name: 'big', bytes: 1000 }, { name: 'x', bytes: 1 }], { min: 0 }).map((x) => x.name), ['big', 'x']);
  assert.deepEqual(slices([]), []);
  assert.equal(pct(0.42), '42%'); assert.equal(pct(0.004), '0.4%'); assert.equal(pct(0.0001), '<0.1%'); assert.equal(pct(0.998), '99.8%');
});

test('Saved Files\' Drive folder: your files, Socials\' copy, the keys and kit', () => {
  assert.equal(driveKind({ name: 'ccv.abc' }, ''), 'files');
  assert.equal(driveKind({ name: 'socials-m-1.ccs' }, 'Socials'), 'socials');
  assert.equal(driveKind({ name: 'socials-key.json' }, 'Socials'), 'keys');
  assert.equal(driveKind({ name: 'decrypt.py' }, 'Decryption'), 'keys');
  assert.equal(driveKind({ name: 'command-center-vault.json' }, ''), 'keys');
  const t = tallyDrive([{ path: '', files: [{ name: 'ccv.a', size: 100 }, { name: 'plain.txt', size: 5 }] }, { path: 'Socials', files: [{ name: 'socials-m-1.ccs', size: 40 }, { name: 'socials-key.json', size: 2 }] }]);
  assert.deepEqual([t.files.bytes, t.files.n, t.socials.bytes, t.keys.bytes, t.encrypted, t.socialsEncrypted], [105, 2, 40, 2, 1, 1]);
  assert.equal(itemName('cc.socials.m.x1'), 'Socials photo or video');
  assert.equal(itemName('draw.sketch'), 'Drawing (sketch)');
});
