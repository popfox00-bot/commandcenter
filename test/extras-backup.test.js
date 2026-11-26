// The extras backup (web/lib/extras-backup.js): encrypted with the backup password, opened only with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('extras backup: sealed with a password (nothing readable), opened with it (bytes and all), not with another', async () => {
  const { seal, open, countOf, fileName, isBackupName } = await import('../web/lib/extras-backup.js');
  const pw = ['salt', 'marsh', '9'].join('-');
  const data = { v: 1, at: 1, idb: { 'cc.saved.matches': [{ handle: 'amy' }], 'cc.bg.vault': { buf: { $b: 'AQID' }, type: 'image/jpeg' } }, ls: { 'cc.dock.mode': '{"x":1}' } };
  const blob = await seal(data, pw, { rounds: 1000 });
  assert.ok(!/amy|dock/.test(await blob.text()));
  assert.deepEqual(await open(blob, pw), data); assert.equal(countOf(data), 3);
  await assert.rejects(open(blob, 'nope-nope'), /doesn't open/);
  await assert.rejects(open(new Blob(['hello']), pw), /isn't a Command Center/);
  await assert.rejects(seal(data, 'abc'), /at least 6/);
  assert.equal(fileName(new Date(2026, 10, 26)), 'cc-extras-2026-11-26.ccx'); assert.ok(isBackupName('cc-extras-2026-11-26.ccx')); assert.ok(!isBackupName('notes.ccx'));
});
