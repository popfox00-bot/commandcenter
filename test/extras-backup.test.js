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

test('Saved Files search: words in any order (name or folder), kind, person, date', async () => {
  const { searchFiles } = await import('../web/tools/saved/search.js');
  const now = Date.parse('2026-11-26T12:00:00Z'); const day = 864e5;
  const files = [
    { id: 'a', name: 'beach_day.png', type: 'image/png', updated: now - day, path: 'Trips' },
    { id: 'b', name: 'beach-sunset.mp4', type: 'video/mp4', updated: now - 400 * day, path: 'Trips' },
    { id: 'c', name: 'budget.pdf', type: 'application/pdf', updated: now - 20 * day, path: 'Work' },
    { id: 'd', name: 'song.mp3', type: 'audio/mpeg', updated: now, path: '' },
  ];
  const ids = (o) => searchFiles(files, { now, ...o }).map((f) => f.id);
  assert.deepEqual(ids({ q: 'day beach' }), ['a']); assert.deepEqual(ids({ q: 'work' }), ['c'], 'by folder');
  assert.deepEqual(ids({ kind: 'image' }), ['a']); assert.deepEqual(ids({ kind: 'docs' }), ['c']); assert.deepEqual(ids({ kind: 'other' }), ['d']);
  assert.deepEqual(ids({ person: 'amy', matches: [{ fileId: 'b', handle: 'amy' }] }), ['b']);
  assert.deepEqual(ids({ when: 'week' }), ['d', 'a']); assert.deepEqual(ids({ when: 'month' }), ['d', 'a', 'c']); assert.deepEqual(ids({ when: 'older' }), ['b']);
});
