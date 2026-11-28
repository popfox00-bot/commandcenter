// Reader (web/apps/reader/reader-core.js): files packed into one ZIP (compressed where it helps), locked into the same
// encrypted file Saved Files makes (CCV1), and opened again (by password, recovery key, or the library's own key), the
// files and their folders as they were. A wrong password doesn't open it; a ZIP or a plain file opens as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pack, lock, open, kindOf, typeOf, baseName, isLockedBytes, isZipBytes } from '../web/apps/reader/reader-core.js';
import { createVaultRaw, keyFromRaw } from '../web/lib/vault.js';

const files = () => [new File(['hello '.repeat(5000)], 'notes.txt', { type: 'text/plain' }), new File([new Uint8Array(300).map((_, i) => (i * 37) % 251)], 'Trips/beach.png', { type: 'image/png' })];

test('pack: one ZIP, smaller than the files, folders kept', async () => {
  const p = await pack(files(), 'My stuff');
  assert.equal(p.file.name, 'My stuff.zip'); assert.ok(p.after < p.before);
  assert.ok(isZipBytes(new Uint8Array(await p.file.slice(0, 4).arrayBuffer())));
  const back = await open(p.file);
  assert.equal(back.from, 'zip'); assert.deepEqual(back.files.map((f) => [f.name, f.size, f.type]), [['notes.txt', 30000, 'text/plain'], ['Trips/beach.png', 300, 'image/png']]);
});

test('lock and open: by password, by recovery key, not by a wrong one; a locked file is CCV1', async () => {
  const p = await pack(files(), 'Pack');
  const { file, recoveryKey } = await lock(p.file, { password: 'correct horse battery' });
  assert.equal(file.name, 'Pack.ccv'); assert.ok(isLockedBytes(new Uint8Array(await file.slice(0, 4).arrayBuffer())));
  await assert.rejects(open(file), (e) => e.needsSecret);
  await assert.rejects(open(file, { secret: 'nope nope nope' }), /Wrong password/);
  const a = await open(file, { secret: 'correct horse battery' });
  assert.equal(a.from, 'locked'); assert.equal(a.inner, 'Pack.zip'); assert.equal(a.files.length, 2);
  assert.equal(await a.files[0].text(), 'hello '.repeat(5000));
  const b = await open(file, { secret: recoveryKey.toLowerCase() }); assert.equal(b.files[1].name, 'Trips/beach.png');
  await assert.rejects(lock(p.file, { password: '123' }), /at least 6/);
});

test('the library\'s own key opens its packages with no question; a plain file opens as it is', async () => {
  const { header, raw } = await createVaultRaw('library password 1'); const session = { key: await keyFromRaw(raw), header };
  const { file, recoveryKey } = await lock(new File(['just one'], 'one.txt', { type: 'text/plain' }), { session });
  assert.equal(recoveryKey, null);
  const r = await open(file, { session }); assert.equal(r.files[0].name, 'one.txt'); assert.equal(await r.files[0].text(), 'just one');
  const plain = await open(new File(['x'], 'x.bin')); assert.equal(plain.from, 'file');
});

test('a Reader package opens with decrypt.py too (no app needed)', async () => {
  const { file } = await lock(new File(['secret words'], 'note.txt', { type: 'text/plain' }), { password: 'open me anywhere' });
  const dir = mkdtempSync(join(tmpdir(), 'rd-')); const p = join(dir, 'note.ccv'); writeFileSync(p, new Uint8Array(await file.arrayBuffer()));
  // (Its password from CCV_SECRET, as decrypt.py takes it without asking; it writes the file next to the package.)
  try { execFileSync('python3', ['-c', 'import cryptography'], { stdio: 'pipe' }); } catch { return; } // (no "cryptography" here: decrypt.py can't run)
  execFileSync('python3', ['-I', 'web/decryption/decrypt.py', p], { stdio: 'pipe', env: { ...process.env, CCV_SECRET: 'open me anywhere' } });
  assert.equal(readFileSync(join(dir, 'note.txt'), 'utf8'), 'secret words');
});

test('kinds, types, names', () => {
  assert.deepEqual(['a.ccv', 'b.zip', 'c.JPG', 'd.mov', 'e.m4a', 'f.pdf', 'g.md', 'h.bin'].map((n) => kindOf(n)), ['locked', 'zip', 'image', 'video', 'audio', 'pdf', 'text', 'other']);
  assert.equal(typeOf('x.png'), 'image/png'); assert.equal(typeOf('x.weird'), 'application/octet-stream');
  assert.equal(baseName('My: trip.zip'), 'My_ trip'); assert.equal(baseName(''), 'files');
});

test('📥 Import opens a 💽 Drive package (CCV2): by the library\'s own key with no question, else by its password; folders kept', async () => {
  const { writeCCV2 } = await import('../web/lib/ccv2.js');
  const { header, raw } = await createVaultRaw('library password 2'); const session = { key: await keyFromRaw(raw), header };
  const parts = [];
  await writeCCV2({ files: [new File(['one'], 'Trip/a.txt', { type: 'text/plain' }), new File(['two two'], 'Trip/sub/b.txt', { type: 'text/plain' })], key: session.key, header, write: (b) => { parts.push(b.slice()); } });
  const pkg = new File(parts, 'Trip.ccv');
  const r = await open(pkg, { session }); assert.deepEqual(r.files.map((f) => [f.name, f.size]), [['Trip/a.txt', 3], ['Trip/sub/b.txt', 7]]);
  await assert.rejects(open(pkg), (e) => e.needsSecret);
  const r2 = await open(pkg, { secret: 'library password 2' }); assert.equal(await r2.files[1].text(), 'two two');
});
