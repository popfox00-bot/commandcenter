// Saved Files encryption (web/lib/vault.js): a vault made from a password, unlocked with it or the
// recovery key (never with a wrong one), files and their names encrypted and back, a file opened with
// just the password anywhere, a password change that keeps every file openable, and the recovery key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVault, unlock, changePassword, newRecovery, encryptFile, decryptName, decryptFile, openWithSecret, isEncryptedName, cleanRecoveryKey, strength, ITERATIONS } from '../web/lib/vault.js';

const FAST = { iterations: 2000 }; // the real count is slow on purpose; most tests don't need it

test('a vault: unlocked by its password or recovery key, never by a wrong one', async () => {
  const { header, key, recoveryKey } = await createVault('maple river candle orbit', FAST);
  assert.match(recoveryKey, /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
  assert.equal(header.kdf, 'PBKDF2-SHA256');
  assert.ok(!JSON.stringify(header).includes('maple'), 'the password is not in it');
  const file = await encryptFile(key, header, new File(['hi'], 'a.txt', { type: 'text/plain' }));
  for (const secret of ['maple river candle orbit', recoveryKey, recoveryKey.toLowerCase().replace(/-/g, ' ')]) {
    const k = await unlock(header, secret);
    assert.equal((await decryptFile(k, file.blob)).name, 'a.txt', secret);
  }
  await assert.rejects(unlock(header, 'maple river candle orbiT'), /Wrong password/);
  await assert.rejects(unlock(header, newRecoveryLike(recoveryKey)), /Wrong password/);
});
const newRecoveryLike = (rk) => (rk[0] === 'A' ? 'B' : 'A') + rk.slice(1);

test('files: content, name and type encrypted; every byte comes back; a changed file is refused', async () => {
  const { header, key } = await createVault('pw pw pw pw pw', FAST);
  const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7) % 256);
  const original = new File([bytes], 'Tax return 2025.pdf', { type: 'application/pdf' });
  const { name, blob } = await encryptFile(key, header, original);
  assert.ok(isEncryptedName(name) && !name.includes('Tax'), name);
  assert.equal(blob.type, 'application/octet-stream');
  const raw = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(raw.subarray(0, 4)), 'CCV1');
  assert.ok(!new TextDecoder('latin1').decode(raw).includes('Tax return'), 'the name isn\'t in the file either');
  assert.deepEqual(await decryptName(key, name), { name: 'Tax return 2025.pdf', type: 'application/pdf', size: 70_000 });
  // A very long name still fits the 200 characters the Saved Files script keeps; the full name is in the file.
  const long = 'Quarterly statement for the joint brokerage account ending 4421 — October 2026 (final, signed).pdf';
  const lf = await encryptFile(key, header, new File(['x'], long, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  assert.ok(lf.name.length <= 200, `${lf.name.length} characters`);
  assert.ok(long.startsWith((await decryptName(key, lf.name)).name.replace(/…$/, '')));
  assert.equal((await decryptFile(key, lf.blob)).name, long);
  const back = await decryptFile(key, blob);
  assert.deepEqual([back.name, back.type], ['Tax return 2025.pdf', 'application/pdf']);
  assert.deepEqual(new Uint8Array(await back.arrayBuffer()), bytes);
  // Another vault's key can't read its name or content; a changed byte is caught.
  const other = await createVault('other other other', FAST);
  assert.equal(await decryptName(other.key, name), null);
  await assert.rejects(decryptFile(other.key, blob), /couldn't be opened/);
  const bad = Uint8Array.from(raw); bad[bad.length - 5] ^= 1;
  await assert.rejects(decryptFile(key, new Blob([bad])), /couldn't be opened/);
  await assert.rejects(decryptFile(key, new Blob(['plain text'])), /Not a Saved Files encrypted file/);
});

test('anywhere: one file and the password or recovery key open it; a new password keeps old files openable', async () => {
  const v = await createVault('first pass phrase here', FAST);
  const { blob } = await encryptFile(v.key, v.header, new File(['secret'], 'note.txt', { type: 'text/plain' }));
  assert.equal(await (await openWithSecret(blob, 'first pass phrase here')).text(), 'secret');
  assert.equal(await (await openWithSecret(blob, v.recoveryKey)).text(), 'secret');
  // Password changed (with the recovery key): the vault opens with the new one, files are the same.
  const header2 = await changePassword(v.header, v.recoveryKey, 'second pass phrase here');
  await assert.rejects(unlock(header2, 'first pass phrase here'), /Wrong/);
  const k2 = await unlock(header2, 'second pass phrase here');
  assert.equal(await (await decryptFile(k2, blob)).text(), 'secret');
  // A new recovery key: the old one no longer opens the vault.
  const { header: header3, recoveryKey } = await newRecovery(header2, 'second pass phrase here');
  assert.notEqual(recoveryKey, v.recoveryKey);
  await unlock(header3, recoveryKey);
  await assert.rejects(unlock(header3, v.recoveryKey), /Wrong/);
});

test('the real key-making cost, recovery-key typing, password strength', async () => {
  assert.equal(ITERATIONS, 600_000);
  const t = performance.now();
  const v = await createVault('maple river candle orbit');
  assert.equal(v.header.iterations, 600_000);
  assert.ok(performance.now() - t > 50, 'deliberately slow to guess');
  assert.equal(cleanRecoveryKey('abcd-efgh'), null);
  assert.equal(cleanRecoveryKey(v.recoveryKey.toLowerCase()), v.recoveryKey.replace(/-/g, ''));
  assert.equal(strength('short').level, 'weak');
  assert.equal(strength('maple river candle orbit').level, 'strong');
  assert.equal(strength('Correcthorse9').level, 'ok');
});
