// Locked packages of any size (web/lib/ccv2.js): written a piece at a time, listed without reading the content, each
// file taken out exactly (across many pieces), compressed where it helps; the password or recovery key opens it; a
// changed byte, swapped pieces or a cut-short file are caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeCCV2, inspectCCV2, listCCV2, extractCCV2, fileFromCCV2, CHUNK, isCCV2 } from '../web/lib/ccv2.js';
import { createVaultRaw, unlockRaw, keyFromRaw } from '../web/lib/vault.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
function noise(n, seed = 1) { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; }

async function makePackage() {
  const { header, raw, recoveryKey } = await createVaultRaw('drive password 99');
  const key = await keyFromRaw(raw);
  const big = noise(CHUNK * 2 + 12345); const text = new TextEncoder().encode('a line of text that repeats\n'.repeat(120000));
  const files = [new File([big], 'Videos/clip.mp4', { type: 'video/mp4', lastModified: 1000 }), new File([text], 'Docs/log.txt', { type: 'text/plain' }), new File([], 'empty.dat')];
  const parts = []; let progress = 0;
  const index = await writeCCV2({ files, key, header, write: (b) => { parts.push(b.slice()); }, onProgress: (p) => { progress = p.done; } });
  return { blob: new Blob(parts), index, big, text, recoveryKey, progress };
}

test('written and read back: the list without the content, each file exact, compressed where it helps', async () => {
  const { blob, index, big, text, progress } = await makePackage();
  assert.ok(isCCV2(new Uint8Array(await blob.slice(0, 4).arrayBuffer())));
  assert.equal(progress, big.length + text.length);
  assert.ok(blob.size < big.length + text.length, `smaller: ${blob.size}`);
  const info = await inspectCCV2(blob); assert.equal(info.header.v, 2);
  const key = await keyFromRaw(await unlockRaw(info.header, 'drive password 99'));
  const list = await listCCV2(blob, key, info);
  assert.deepEqual(list.files.map((f) => [f.n, f.s, f.z]), [['Videos/clip.mp4', big.length, false], ['Docs/log.txt', text.length, true], ['empty.dat', 0, false]]);
  assert.equal(list.count, 3); assert.equal(list.size, big.length + text.length);
  // (The text taken out first: from its own piece, without reading the video before it.)
  const t = await fileFromCCV2(blob, key, list.files[1], { info }); assert.equal(sha(new Uint8Array(await t.arrayBuffer())), sha(text)); assert.equal(t.name, 'log.txt');
  const got = []; await extractCCV2(blob, key, list.files[0], (b) => { got.push(Buffer.from(b)); }, { info });
  assert.equal(sha(Buffer.concat(got)), sha(big));
  assert.equal((await fileFromCCV2(blob, key, list.files[2], { info })).size, 0);
});

test('the recovery key opens it; a wrong password doesn\'t', async () => {
  const { blob, recoveryKey } = await makePackage(); const info = await inspectCCV2(blob);
  await assert.rejects(unlockRaw(info.header, 'nope'), /Wrong password/);
  const key = await keyFromRaw(await unlockRaw(info.header, recoveryKey)); assert.equal((await listCCV2(blob, key, info)).count, 3);
});

test('a changed byte, swapped pieces or a cut-short package are caught', async () => {
  const { blob } = await makePackage(); const info = await inspectCCV2(blob);
  const key = await keyFromRaw(await unlockRaw(info.header, 'drive password 99')); const list = await listCCV2(blob, key, info);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const flipped = bytes.slice(); flipped[info.start + 100] ^= 1;
  await assert.rejects(extractCCV2(new Blob([flipped]), key, list.files[0], () => {}, { info }), /couldn't be opened|changed/);
  // (Pieces 0 and 1 of the content swapped.)
  const P = CHUNK + 32; const sw = bytes.slice(); sw.set(bytes.subarray(info.start + P, info.start + 2 * P), info.start); sw.set(bytes.subarray(info.start, info.start + P), info.start + P);
  await assert.rejects(extractCCV2(new Blob([sw]), key, list.files[0], () => {}, { info }), /couldn't be opened|changed/);
  await assert.rejects(inspectCCV2(new Blob([bytes.subarray(0, bytes.length - 100)])), /incomplete/);
});

test('decrypt.py lists and takes out a package (no app needed), folders kept, files exact', async () => {
  const { execFileSync } = await import('node:child_process'); const fs = await import('node:fs'); const path = await import('node:path'); const os = await import('node:os');
  try { execFileSync('python3', ['-c', 'import cryptography'], { stdio: 'pipe' }); } catch { return; }
  const { blob, big, text } = await makePackage();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccv2-')); const p = path.join(dir, 'Backup.ccv'); fs.writeFileSync(p, new Uint8Array(await blob.arrayBuffer()));
  const env = { ...process.env, CCV_SECRET: 'drive password 99' };
  const list = execFileSync('python3', ['-I', 'web/decryption/decrypt.py', '--list', p], { env }).toString();
  assert.match(list, /Videos\/clip\.mp4/); assert.match(list, /3 files/);
  execFileSync('python3', ['-I', 'web/decryption/decrypt.py', p], { env });
  assert.equal(sha(fs.readFileSync(path.join(dir, 'Backup', 'Videos', 'clip.mp4'))), sha(big));
  assert.equal(sha(fs.readFileSync(path.join(dir, 'Backup', 'Docs', 'log.txt'))), sha(text));
  assert.equal(fs.statSync(path.join(dir, 'Backup', 'empty.dat')).size, 0);
});
