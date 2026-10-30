// Saved Files: the phone's client (web/lib/saved-files.js) talking to the Apps Script
// (apps-script/saved-files.gs), run here in a sandbox against stand-ins for Drive, Sheets and the
// script's properties: setup, the access key, upload/list/download/delete, the log sheet, and only
// files in the spreadsheet's own folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { savedFiles, checkUrl, getConfig, setConfig, toBase64, fromBase64, size } from '../web/lib/saved-files.js';

const SCRIPT = readFileSync(resolve(import.meta.dirname, '../apps-script/saved-files.gs'), 'utf8');

/** A Google stand-in: one folder with the spreadsheet in it, and another folder elsewhere. */
function google() {
  let n = 0; let clock = Date.parse('2026-10-30T12:00:00Z');
  const files = new Map(); const props = new Map(); const logs = [];
  const folder = (id, name) => ({ getId: () => id, getName: () => name, getFiles() { const list = [...files.values()].filter((f) => f.parent === id); let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }, createFile(blob) { return addFile(blob.name, blob.type, blob.bytes, id); } });
  const folders = { F: folder('F', 'Command Center'), OTHER: folder('OTHER', 'Elsewhere') };
  function addFile(name, type, bytes, parent) {
    const id = `id${++n}`; const at = new Date(clock += 60_000);
    const f = { id, parent, trashed: false, getId: () => id, getName: () => name, getMimeType: () => type, getSize: () => bytes.length, getLastUpdated: () => at, isTrashed: () => f.trashed, setTrashed: (v) => { f.trashed = v; }, getUrl: () => `https://drive.google.com/file/d/${id}`, getParents() { let done = false; return { hasNext: () => !done, next: () => { done = true; return folders[parent]; } }; }, getBlob: () => ({ getContentType: () => type, getBytes: () => [...bytes].map((b) => (b > 127 ? b - 256 : b)) }) };
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
    DriveApp: { getFileById: (id) => { const f = files.get(id); if (!f) throw new Error('No item with the given ID could be found'); return f; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (content) => ({ content, setMimeType() { return this; } }) },
  };
  vm.createContext(g);
  vm.runInContext(SCRIPT, g);
  const fetch = async (url, init) => {
    assert.equal(init.method, 'POST'); assert.match(init.headers['content-type'], /^text\/plain/, 'plain text: no CORS preflight');
    const out = g.doPost({ postData: { contents: init.body } });
    return { ok: true, status: 200, json: async () => JSON.parse(out.content) };
  };
  return { g, files, sheet, logs, fetch, addFile, ss };
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
