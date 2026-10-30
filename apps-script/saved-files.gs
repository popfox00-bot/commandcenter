/**
 * Command Center: Saved Files (Google Apps Script).
 *
 * Put this in the Apps Script project of your "Saved Files" spreadsheet (Extensions → Apps Script),
 * in the Drive folder that should hold the files. The Files app on your phone then saves files into
 * that folder (or folders inside it), lists them, opens, moves and deletes them, through this script,
 * and each save is logged in the spreadsheet's "Saved Files" sheet. Folders inside it can be made,
 * renamed and deleted from the phone; nothing outside that folder is ever touched.
 *
 * Setup (once):
 *   1. Paste this file in as Code.gs and save.
 *   2. Run `setup` (choose it in the toolbar, then Run) and allow access when asked. It makes an
 *      access key and shows it in the execution log: copy it.
 *   3. Deploy → New deployment → type "Web app": Execute as "Me", Who has access "Anyone".
 *      Copy the web app URL (it ends in /exec).
 *   4. On the phone: Files → Saved Files → paste the URL and the access key → Connect.
 *
 * "Anyone" is needed because the phone calls the web app without a Google sign-in; the access key
 * is what keeps everyone else out: without it, every request is refused. Your folder and files stay
 * private in your Drive (nothing is shared). To lock the phone out, run `setup` again (a new key).
 *
 * Updating this script later: paste the new version over the old, save, then Deploy → Manage
 * deployments → ✎ (edit) → Version: New version → Deploy. The web app URL and the key stay the same.
 */

const VERSION = 3; // 2: uploads can go into a subfolder (the Decryption kit). 3: folders (list, make, rename, delete, move files)

const KEY_PROPERTY = 'SAVED_FILES_KEY';
const LOG_SHEET = 'Saved Files';
const MAX_BYTES = 25 * 1024 * 1024; // Apps Script handles requests up to ~50 MB; base64 adds a third

/** Run once from the editor: makes the access key (and the log sheet). */
function setup() {
  const key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty(KEY_PROPERTY, key);
  logSheet_();
  console.log('Access key for the phone (keep it private): ' + key);
  console.log('Files go to the folder: ' + folder_().getName());
  return key;
}

/** A plain check that the web app is deployed (no files, no key needed). */
function doGet() {
  return json_({ ok: true, app: 'command-center-saved-files' });
}

/** Every request from the phone: { key, action, ... } as text/plain JSON (no CORS preflight). */
function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  const expected = PropertiesService.getScriptProperties().getProperty(KEY_PROPERTY);
  if (!expected || typeof req.key !== 'string' || !same_(req.key, expected)) return json_({ ok: false, error: 'Wrong access key' });
  try {
    switch (req.action) {
      case 'ping': return json_({ ok: true, folder: folder_().getName(), version: VERSION });
      case 'list': return json_(Object.assign({ ok: true }, list_(req.folder)));
      case 'folders': return json_({ ok: true, folders: allFolders_() });
      case 'upload': return json_({ ok: true, file: upload_(req) });
      case 'download': return json_(Object.assign({ ok: true }, download_(req.id)));
      case 'delete': remove_(req.id); return json_({ ok: true });
      case 'mkdir': return json_({ ok: true, folder: mkdir_(req.name, req.parent) });
      case 'rename': return json_({ ok: true, folder: renameFolder_(req.id, req.name) });
      case 'rmdir': rmdir_(req.id); return json_({ ok: true });
      case 'move': return json_({ ok: true, file: move_(req.id, req.to) });
      default: return json_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/** The folder this spreadsheet is in. */
function folder_() {
  const parents = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
  if (!parents.hasNext()) throw new Error('Put the spreadsheet in a Drive folder first');
  return parents.next();
}

/** One folder's files (newest first) and folders (by name), and the path down to it. */
function list_(folderId) {
  const main = folder_();
  const here = folderId ? folderIn_(folderId) : main;
  const self = SpreadsheetApp.getActiveSpreadsheet().getId();
  const files = [];
  const it = here.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getId() === self || f.isTrashed()) continue;
    files.push(info_(f));
  }
  files.sort(function (a, b) { return b.updated - a.updated; });
  const folders = [];
  const fit = here.getFolders();
  while (fit.hasNext()) {
    const d = fit.next();
    if (!d.isTrashed()) folders.push(folderInfo_(d));
  }
  folders.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { files: files, folders: folders, path: path_(here) };
}

function folderInfo_(d) {
  return { id: d.getId(), name: d.getName(), updated: d.getLastUpdated().getTime() };
}

/** Every folder inside the main one, as { id, name, path: 'A/B' }, sorted by path (for "Move to"). */
function allFolders_() {
  const out = [];
  (function walk(d, prefix, depth) {
    if (depth > 10 || out.length >= 500) return;
    const it = d.getFolders();
    const kids = [];
    while (it.hasNext()) { const k = it.next(); if (!k.isTrashed()) kids.push(k); }
    kids.sort(function (a, b) { return a.getName().localeCompare(b.getName()); });
    kids.forEach(function (k) {
      const p = prefix ? prefix + '/' + k.getName() : k.getName();
      out.push({ id: k.getId(), name: k.getName(), path: p });
      walk(k, p, depth + 1);
    });
  })(folder_(), '', 0);
  return out;
}

/** The folders from the main one (not included) down to this one: [{ id, name }]. */
function path_(d) {
  const mainId = folder_().getId();
  const out = [];
  let cur = d;
  for (let i = 0; i < 20 && cur.getId() !== mainId; i++) {
    out.unshift({ id: cur.getId(), name: cur.getName() });
    const ps = cur.getParents();
    if (!ps.hasNext()) break;
    cur = ps.next();
  }
  return out;
}

/** Whether a file or folder is somewhere inside the main folder (not trashed on the way). */
function under_(item) {
  const mainId = folder_().getId();
  let level = [item];
  for (let depth = 0; depth < 20 && level.length; depth++) {
    const next = [];
    for (let i = 0; i < level.length; i++) {
      const ps = level[i].getParents();
      while (ps.hasNext()) {
        const p = ps.next();
        if (p.getId() === mainId) return true;
        if (!p.isTrashed()) next.push(p);
      }
    }
    level = next;
  }
  return false;
}

/** A folder inside the main one by its ID ('' or the main folder's own ID: the main folder). */
function folderIn_(id) {
  const main = folder_();
  if (!id || id === main.getId()) return main;
  let d;
  try { d = DriveApp.getFolderById(String(id)); } catch (err) { throw new Error('No such folder'); }
  if (d.isTrashed() || !under_(d)) throw new Error('No such folder');
  return d;
}

/** A tidy folder name: no slashes, at most 60 characters. */
function folderName_(name) {
  const n = String(name || '').replace(/[\\/]+/g, '-').trim().slice(0, 60);
  if (!n) throw new Error('Give the folder a name');
  return n;
}

/** Make a folder (inside `parentId`, or the main folder); if one of that name is there, that one. */
function mkdir_(name, parentId) {
  const n = folderName_(name);
  const parent = folderIn_(parentId);
  const found = parent.getFoldersByName(n);
  while (found.hasNext()) { const d = found.next(); if (!d.isTrashed()) return folderInfo_(d); }
  return folderInfo_(parent.createFolder(n));
}

function renameFolder_(id, name) {
  const d = folderIn_(id);
  if (d.getId() === folder_().getId()) throw new Error('The main folder can\'t be renamed here');
  d.setName(folderName_(name));
  return folderInfo_(d);
}

/** A folder and everything in it to Drive's trash (30 days). */
function rmdir_(id) {
  const d = folderIn_(id);
  if (d.getId() === folder_().getId()) throw new Error('The main folder can\'t be deleted');
  d.setTrashed(true);
}

/** Move a file into another folder ('' : the main folder). */
function move_(id, to) {
  const f = inFolder_(id);
  const target = folderIn_(to);
  f.moveTo(target);
  return Object.assign(info_(f), { folder: target.getId() === folder_().getId() ? '' : target.getId() });
}

function info_(f) {
  return { id: f.getId(), name: f.getName(), type: f.getMimeType(), size: f.getSize(), updated: f.getLastUpdated().getTime() };
}

function upload_(req) {
  const name = String(req.name || '').replace(/[\\/]+/g, '-').trim().slice(0, 200) || 'file';
  const data = Utilities.base64Decode(String(req.data || ''));
  if (!data.length) throw new Error('Empty file');
  if (data.length > MAX_BYTES) throw new Error('Too big (25 MB at most)');
  const blob = Utilities.newBlob(data, String(req.type || 'application/octet-stream'), name);
  // folderId: a folder's ID (version 3). folder: a folder name in the main one, made if needed, where
  // a file of the same name is replaced (version 2, for the Decryption kit).
  const sub = req.folderId ? '' : String(req.folder || '').replace(/[\\/]+/g, '-').trim().slice(0, 60);
  const target = req.folderId ? folderIn_(req.folderId) : sub ? subfolder_(sub) : folder_();
  if (sub) { const same = target.getFilesByName(name); while (same.hasNext()) same.next().setTrashed(true); } // replaced, not doubled
  const f = target.createFile(blob);
  const where = target.getId() === folder_().getId() ? '' : path_(target).map(function (p) { return p.name; }).join('/');
  logSheet_().appendRow([new Date(), where ? where + '/' + name : name, f.getMimeType(), f.getSize(), String(req.from || '').slice(0, 40), f.getId(), f.getUrl(), '']);
  return Object.assign(info_(f), { folder: sub || (where ? target.getId() : '') });
}

/** A folder inside this one, made the first time it's needed. */
function subfolder_(name) {
  const parent = folder_();
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

/** Only files in the folder or the folders inside it (and not the spreadsheet itself) can be read, moved or deleted. */
function inFolder_(id) {
  if (typeof id !== 'string' || !id || id === SpreadsheetApp.getActiveSpreadsheet().getId()) throw new Error('No such file');
  let f;
  try { f = DriveApp.getFileById(id); } catch (err) { throw new Error('No such file'); }
  if (f.isTrashed() || !under_(f)) throw new Error('No such file');
  return f;
}

function download_(id) {
  const f = inFolder_(id);
  if (f.getSize() > MAX_BYTES) throw new Error('Too big to open here (25 MB at most)');
  const blob = f.getBlob();
  return { name: f.getName(), type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function remove_(id) {
  const f = inFolder_(id);
  f.setTrashed(true); // in Drive's trash for 30 days, in case it was a mistake
  const sheet = logSheet_();
  const rows = sheet.getDataRange().getValues();
  for (let r = 1; r < rows.length; r++) if (rows[r][5] === id) sheet.getRange(r + 1, 8).setValue(new Date());
}

function logSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET);
    sheet.appendRow(['Saved', 'Name', 'Type', 'Bytes', 'From', 'File ID', 'Link', 'Deleted']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Compares in the same time whatever the input (no timing hints about the key). */
function same_(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
