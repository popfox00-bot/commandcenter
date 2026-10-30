// Saved Files: the phone's client (web/lib/saved-files.js) talking to the Apps Script
// (apps-script/saved-files.gs), run here in a sandbox against stand-ins for Drive, Sheets and the
// script's properties: setup, the access key, upload/list/download/delete, the log sheet, folders,
// and only files in the spreadsheet's own folder (and the folders inside it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { savedFiles, checkUrl, getConfig, setConfig, toBase64, fromBase64, size, fileKind } from '../web/lib/saved-files.js';

const SCRIPT = readFileSync(resolve(import.meta.dirname, '../apps-script/saved-files.gs'), 'utf8');

/** A Google stand-in: one folder with the spreadsheet in it, and another folder elsewhere. */
function google() {
  let n = 0; let clock = Date.parse('2026-10-30T12:00:00Z');
  const files = new Map(); const props = new Map(); const logs = [];
  const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  const folder = (id, name, parent = null) => {
    const at = new Date(clock);
    const d = {
      id, parent, trashed: false, getId: () => id, getName: () => name, setName: (v) => { name = v; return d; },
      getLastUpdated: () => at, isTrashed: () => d.trashed, setTrashed: (v) => { d.trashed = v; },
      getParents: () => iter(d.parent ? [folders[d.parent]] : []), moveTo: (to) => { d.parent = to.getId(); return d; },
      getFiles() { return iter([...files.values()].filter((f) => f.parent === id)); },
      getFolders() { return iter(Object.values(folders).filter((k) => k.parent === id)); },
      getFilesByName(n) { return iter([...files.values()].filter((f) => f.parent === id && !f.trashed && f.getName() === n)); },
      getFoldersByName(n) { return iter(Object.values(folders).filter((k) => k.parent === id && k.getName() === n)); },
      createFolder(n) { const k = folder(`D${Object.keys(folders).length}`, n, id); folders[k.id] = k; return k; },
      createFile(blob) { return addFile(blob.name, blob.type, blob.bytes, id); },
    };
    return d;
  };
  const folders = { F: folder('F', 'Command Center'), OTHER: folder('OTHER', 'Elsewhere') };
  function addFile(name, type, bytes, parent) {
    const id = `id${++n}`; const at = new Date(clock += 60_000);
    const f = { id, parent, trashed: false, getId: () => id, getName: () => name, getMimeType: () => type, getSize: () => bytes.length, getLastUpdated: () => at, isTrashed: () => f.trashed, setTrashed: (v) => { f.trashed = v; }, getUrl: () => `https://drive.google.com/file/d/${id}`, getParents: () => iter([folders[f.parent]]), moveTo: (d) => { f.parent = d.getId(); return f; }, getBlob: () => ({ getContentType: () => type, getBytes: () => [...bytes].map((b) => (b > 127 ? b - 256 : b)) }) };
    files.set(id, f); return f;
  }
  const sheet = { rows: [], appendRow(r) { this.rows.push(r); }, setFrozenRows() {}, getDataRange() { return { getValues: () => sheet.rows.map((r) => [...r]) }; }, getRange(r, c) { return { setValue: (v) => { sheet.rows[r - 1][c - 1] = v; } }; } };
  const sheets = new Map();
  const ss = addFile('Saved Files', 'application/vnd.google-apps.spreadsheet', Buffer.alloc(0), 'F');
  const g = {
    console: { log: (s) => logs.push(s) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => b & 255)).toString('base64'),
      base64Decode: (s) => [...Buffer.from(s, 'base64')].map((b) => (b > 127 ? b - 256 : b)),
      newBlob: (data, type, name) => ({ bytes: Buffer.from(data.map((b) => b & 255)), type, name }),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getId: () => ss.getId(), getSheetByName: (k) => sheets.get(k) ?? null, insertSheet: (k) => { sheets.set(k, sheet); return sheet; } }) },
    DriveApp: {
      getFileById: (id) => { const f = files.get(id); if (!f) throw new Error('No item with the given ID could be found'); return f; },
      getFolderById: (id) => { const d = folders[id]; if (!d) throw new Error('No item with the given ID could be found'); return d; },
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (content) => ({ content, setMimeType() { return this; } }) },
  };
  vm.createContext(g);
  vm.runInContext(SCRIPT, g);
  const fetch = async (url, init) => {
    assert.equal(init.method, 'POST'); assert.match(init.headers['content-type'], /^text\/plain/, 'plain text: no CORS preflight');
    const out = g.doPost({ postData: { contents: init.body } });
    return { ok: true, status: 200, json: async () => JSON.parse(out.content) };
  };
  return { g, files, folders, sheet, logs, fetch, addFile, ss };
}

test('setup makes a key; with it the phone saves, lists, opens and deletes files; without it nothing', async () => {
  const G = google();
  const key = G.g.setup();
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.match(G.logs.join('\n'), /Access key for the phone/);
  const api = savedFiles({ url: 'https://script.google.com/macros/s/x/exec', key }, { fetch: G.fetch });
  assert.equal(await api.ping(), 'Command Center');

  const png = new File([new Uint8Array([137, 80, 78, 71, 0, 255, 128, 7])], 'sketch.png', { type: 'image/png' });
  const saved = await api.upload(png, 'Draw');
  assert.deepEqual([saved.name, saved.type, saved.size], ['sketch.png', 'image/png', 8]);
  await api.upload(new File(['hello'], 'a/b\\c.txt', { type: 'text/plain' }));
  const list = await api.list();
  assert.deepEqual(list.map((f) => f.name), ['a-b-c.txt', 'sketch.png'], 'newest first; slashes can\'t make folders; the spreadsheet itself isn\'t listed');

  const back = await api.download(saved.id);
  assert.deepEqual([back.name, back.type], ['sketch.png', 'image/png']);
  assert.deepEqual([...new Uint8Array(await back.arrayBuffer())], [137, 80, 78, 71, 0, 255, 128, 7], 'every byte comes back');

  assert.deepEqual([...G.sheet.rows[0]], ['Saved', 'Name', 'Type', 'Bytes', 'From', 'File ID', 'Link', 'Deleted']);
  assert.deepEqual([...G.sheet.rows[1].slice(1, 6)], ['sketch.png', 'image/png', 8, 'Draw', saved.id]);
  await api.remove(saved.id);
  assert.equal(G.files.get(saved.id).trashed, true, 'to Drive\'s trash, not gone');
  assert.equal(Object.prototype.toString.call(G.sheet.rows[1][7]), '[object Date]', 'the log notes when it was deleted');
  assert.deepEqual((await api.list()).map((f) => f.name), ['a-b-c.txt']);

  const wrong = savedFiles({ url: 'https://script.google.com/macros/s/x/exec', key: 'nope' }, { fetch: G.fetch });
  await assert.rejects(wrong.list(), /Wrong access key/);
  await assert.rejects(wrong.upload(png), /Wrong access key/);
  assert.equal(G.files.size, 3, 'nothing saved without the key');
});

test('only files in the spreadsheet\'s folder can be opened or deleted, never the spreadsheet itself', async () => {
  const G = google();
  const key = G.g.setup();
  const api = savedFiles({ url: 'https://script.google.com/macros/s/x/exec', key }, { fetch: G.fetch });
  const elsewhere = G.addFile('private.pdf', 'application/pdf', Buffer.from('%PDF'), 'OTHER');
  await assert.rejects(api.download(elsewhere.getId()), /No such file/);
  await assert.rejects(api.remove(elsewhere.getId()), /No such file/);
  await assert.rejects(api.remove(G.ss.getId()), /No such file/);
  assert.equal(elsewhere.trashed, false);
  await assert.rejects(api.upload(new File([], 'empty.txt')), /Empty file/);
});

test('client: URL check, settings kept on the phone, base64 both ways, readable errors', async () => {
  assert.equal(checkUrl(' https://script.google.com/macros/s/AKfy/exec?x=1 '), 'https://script.google.com/macros/s/AKfy/exec');
  assert.equal(checkUrl('https://script.google.com/macros/s/AKfy/dev'), null, 'the /exec deployment, not the test one');
  assert.equal(checkUrl('https://evil.example/macros/s/x/exec'), null);
  assert.equal(checkUrl('http://script.google.com/macros/s/x/exec'), null);
  const mem = new Map(); const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.equal(getConfig(storage), null);
  setConfig({ url: 'https://script.google.com/macros/s/x/exec', key: 'k', extra: 'dropped' }, storage);
  assert.deepEqual(getConfig(storage), { url: 'https://script.google.com/macros/s/x/exec', key: 'k' });
  setConfig(null, storage); assert.equal(getConfig(storage), null);
  const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
  const b64 = await toBase64(new Blob([bytes]));
  assert.equal(b64, Buffer.from(bytes).toString('base64'), 'large files encode in chunks');
  assert.deepEqual(new Uint8Array(await fromBase64(b64).arrayBuffer()), bytes);
  const html = savedFiles({ url: 'u', key: 'k' }, { fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('<html>'); } }) });
  await assert.rejects(html.list(), /didn't answer like the Saved Files script/);
  const down = savedFiles({ url: 'u', key: 'k' }, { fetch: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(down.list(), /answered 404/);
  await assert.rejects(savedFiles({ url: 'u', key: 'k' }).upload({ size: 26 * 1024 * 1024, name: 'big.mov' }), /too big/);
  assert.equal(size(1536), '2 KB'); assert.equal(size(1.5 * 1024 * 1024), '1.5 MB');
});

test('the decryption kit goes into a "Decryption" folder (saved again, it replaces itself); the list stays the main folder\'s', async () => {
  const G = google();
  const key = G.g.setup();
  const api = savedFiles({ url: 'https://script.google.com/macros/s/x/exec', key }, { fetch: G.fetch });
  assert.deepEqual(await api.info(), { folder: 'Command Center', version: 4 });
  const kitFiles = { 'decrypt.html': '<!doctype html>', 'decrypt.py': 'print(1)', 'FORMAT.md': '# format' };
  const fakeFetch = async (url) => ({ ok: true, blob: async () => new Blob([kitFiles[String(url).split('/').pop()]]) });
  const { saveDecryptionKit } = await import('../web/lib/saved-files.js');
  for (let i = 0; i < 2; i++) {
    const out = await saveDecryptionKit(api, { fetch: fakeFetch, base: 'https://app.example/decryption/' });
    assert.match(out.where, /"Decryption" folder/);
  }
  const sub = Object.values(G.folders).find((d) => d.getName() === 'Decryption');
  assert.ok(sub && sub.parent === 'F', 'a folder inside the Saved Files folder');
  const inSub = [...G.files.values()].filter((f) => f.parent === sub.id && !f.trashed).map((f) => f.getName()).sort();
  assert.deepEqual(inSub, ['FORMAT.md', 'decrypt.html', 'decrypt.py'], 'saved twice, still one of each');
  assert.deepEqual(await api.list(), [], 'the main folder\'s list doesn\'t show them');
  assert.match(G.sheet.rows.at(-1)[1], /^Decryption\//, 'logged with the folder');
});

test('folders: make, open, upload into, move between, rename and delete; nothing outside the main folder', async () => {
  const G = google();
  const key = G.g.setup();
  const api = savedFiles({ url: 'https://script.google.com/macros/s/x/exec', key }, { fetch: G.fetch });
  const top = await api.upload(new File(['top'], 'top.txt', { type: 'text/plain' }));
  const work = await api.mkdir('Work');
  assert.equal((await api.mkdir(' Work ')).id, work.id, 'the same name again: the same folder');
  const tax = await api.mkdir('Taxes/2026', work.id);
  assert.equal(tax.name, 'Taxes-2026', 'slashes can\'t make paths');
  await api.mkdir('Archive');
  await assert.rejects(api.mkdir('   '), /Give the folder a name/);

  let root = await api.browse();
  assert.deepEqual(root.folders.map((d) => d.name), ['Archive', 'Work'], 'by name');
  assert.deepEqual(root.files.map((f) => f.name), ['top.txt']);
  assert.deepEqual(root.path, []);

  const w2 = await api.upload(new File(['w2'], 'w2.pdf', { type: 'application/pdf' }), 'Files', { id: tax.id });
  assert.equal(w2.folder, tax.id);
  const inTax = await api.browse(tax.id);
  assert.deepEqual(inTax.files.map((f) => f.name), ['w2.pdf']);
  assert.deepEqual(inTax.path.map((p) => p.name), ['Work', 'Taxes-2026'], 'the path down to it');
  assert.match(G.sheet.rows.at(-1)[1], /^Work\/Taxes-2026\/w2\.pdf$/, 'logged with the path');
  assert.equal(await (await api.download(w2.id)).text(), 'w2', 'files in folders open');

  assert.deepEqual((await api.folders()).map((d) => d.path), ['Archive', 'Work', 'Work/Taxes-2026']);
  await api.move(top.id, work.id);
  assert.deepEqual((await api.browse(work.id)).files.map((f) => f.name), ['top.txt']);
  assert.deepEqual((await api.browse()).files, []);
  await api.move(top.id, '');
  assert.deepEqual((await api.browse()).files.map((f) => f.name), ['top.txt'], 'back to the main folder');

  await api.rename(work.id, 'Job');
  assert.deepEqual((await api.browse(tax.id)).path.map((p) => p.name), ['Job', 'Taxes-2026']);
  await api.rmdir(work.id);
  assert.equal(G.folders[work.id].trashed, true, 'to Drive\'s trash');
  assert.deepEqual((await api.browse()).folders.map((d) => d.name), ['Archive']);
  await assert.rejects(api.browse(work.id), /No such folder/);
  await assert.rejects(api.download(w2.id), /No such file/, 'a file in a deleted folder is gone too');

  // Outside the main folder: not listed, not a target, not movable; the main folder stays.
  const away = G.folders.OTHER.createFolder('Away');
  const elsewhere = G.addFile('private.pdf', 'application/pdf', Buffer.from('%PDF'), 'OTHER');
  await assert.rejects(api.browse('OTHER'), /No such folder/);
  await assert.rejects(api.browse(away.getId()), /No such folder/);
  await assert.rejects(api.upload(new File(['x'], 'x.txt'), '', { id: 'OTHER' }), /No such folder/);
  await assert.rejects(api.move(top.id, 'OTHER'), /No such folder/);
  await assert.rejects(api.move(elsewhere.getId(), ''), /No such file/);
  await assert.rejects(api.mkdir('Sneak', 'OTHER'), /No such folder/);
  await assert.rejects(api.rmdir('OTHER'), /No such folder/);
  await assert.rejects(api.rename('OTHER', 'Mine'), /No such folder/);
  await assert.rejects(api.rmdir('F'), /main folder can't be deleted/);
  await assert.rejects(api.rename('F', 'X'), /main folder can't be renamed/);
  assert.equal(elsewhere.parent, 'OTHER'); assert.equal(G.folders.OTHER.getName(), 'Elsewhere');
});

test('folders move into folders (with all in them), never into themselves or out of the main folder', async () => {
  const G = google();
  const key = G.g.setup();
  const api = savedFiles({ url: 'https://script.google.com/macros/s/x/exec', key }, { fetch: G.fetch });
  const a = await api.mkdir('A'); const b = await api.mkdir('B'); const a1 = await api.mkdir('A1', a.id);
  const doc = await api.upload(new File(['x'], 'x.txt', { type: 'text/plain' }), '', { id: a1.id });
  const moved = await api.moveFolder(a.id, b.id);
  assert.equal(moved.parent, b.id);
  assert.deepEqual((await api.folders()).map((d) => d.path), ['B', 'B/A', 'B/A/A1'], 'everything inside comes along');
  assert.deepEqual((await api.browse(a1.id)).path.map((p) => p.name), ['B', 'A', 'A1']);
  assert.equal(await (await api.download(doc.id)).text(), 'x', 'files in it still open');
  await assert.rejects(api.moveFolder(b.id, a1.id), /can't go inside itself/);
  await assert.rejects(api.moveFolder(b.id, b.id), /can't go inside itself/);
  await assert.rejects(api.moveFolder('F', b.id), /main folder can't be moved/);
  await assert.rejects(api.moveFolder(b.id, 'OTHER'), /No such folder/);
  await assert.rejects(api.moveFolder('OTHER', b.id), /No such folder/);
  await api.moveFolder(a.id, '');
  assert.deepEqual((await api.browse()).folders.map((d) => d.name), ['A', 'B'], 'back to the main folder');
});

test('file kinds for colour-coded icons: by type, then by extension', () => {
  const k = (n, t) => { const r = fileKind(n, t); return `${r.kind} ${r.label}`; };
  assert.equal(k('beach.JPG', 'image/jpeg'), 'image JPG');
  assert.equal(k('w2.pdf', 'application/pdf'), 'pdf PDF');
  assert.equal(k('budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'sheet XLSX');
  assert.equal(k('letter.docx', 'application/octet-stream'), 'doc DOCX', 'by extension when the type says nothing');
  assert.equal(k('deck.pptx', ''), 'slides PPTX');
  assert.equal(k('clip.mov', 'video/quicktime'), 'video MOV');
  assert.equal(k('song.m4a', 'audio/mp4'), 'audio M4A');
  assert.equal(k('backup.zip', 'application/zip'), 'archive ZIP');
  assert.equal(k('notes.txt', 'text/plain'), 'text TXT');
  assert.equal(k('data.csv', 'text/csv'), 'sheet CSV', 'CSV is a sheet, not plain text');
  assert.equal(k('mystery', ''), 'other ');
  assert.equal(k('photo', 'image/png'), 'image IMAG', 'no extension: the kind, short');
});

test('the app knows the newest script version', () => {
  const setup = readFileSync(resolve(import.meta.dirname, '../web/lib/saved-files-setup.js'), 'utf8');
  assert.equal(setup.match(/SCRIPT_VERSION = (\d+)/)[1], SCRIPT.match(/const VERSION = (\d+)/)[1]);
});
