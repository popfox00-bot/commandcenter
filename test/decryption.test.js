// The decryption kit (web/decryption/): decrypt.py opens files made by the app, with the password,
// the recovery key, and (with the vault file) after a password change; a wrong password opens nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createVault, encryptFile, changePassword } from '../web/lib/vault.js';

const PY = resolve(import.meta.dirname, '../web/decryption/decrypt.py');
const hasPython = (() => { try { execFileSync('python3', ['-c', 'import cryptography'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('decrypt.py opens the app\'s files with the password or recovery key', { skip: !hasPython && 'python3 with "cryptography" not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccv-'));
  const v = await createVault('maple river candle orbit', { iterations: 600_000 });
  const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 13) % 256);
  const one = await encryptFile(v.key, v.header, new File([bytes], 'Scan 2026.pdf', { type: 'application/pdf' }));
  writeFileSync(join(dir, one.name), Buffer.from(await one.blob.arrayBuffer()));
  const run = (secret, ...args) => spawnSync('python3', [PY, ...args], { env: { ...process.env, CCV_SECRET: secret }, encoding: 'utf8' });

  let r = run('maple river candle orbit', join(dir, one.name));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'Scan 2026.pdf'))), bytes, 'byte for byte, under its own name');
  r = run(v.recoveryKey.toLowerCase(), join(dir, one.name));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, 'Scan 2026 (2).pdf')), 'never over an existing file');
  r = run('wrong wrong wrong', join(dir, one.name));
  assert.equal(r.status, 1); assert.match(r.stderr, /Wrong password or recovery key/);

  // After a password change: the new password opens old files with the vault file.
  const h2 = await changePassword(v.header, 'maple river candle orbit', 'new pass phrase words');
  writeFileSync(join(dir, 'command-center-vault.json'), JSON.stringify(h2));
  assert.equal(run('new pass phrase words', join(dir, one.name)).status, 1, 'not without the vault file');
  r = run('new pass phrase words', '--vault', join(dir, 'command-center-vault.json'), join(dir, one.name));
  assert.equal(r.status, 0, r.stderr);
});
