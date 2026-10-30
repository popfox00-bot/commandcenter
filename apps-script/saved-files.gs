/**
 * Command Center: Saved Files (Google Apps Script).
 *
 * Put this in the Apps Script project of your "Saved Files" spreadsheet (Extensions → Apps Script),
 * in the Drive folder that should hold the files. The Files app on your phone then saves files into
 * that folder, lists them, opens them and deletes them, through this script, and each save is
 * logged in the spreadsheet's "Saved Files" sheet.
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
 */

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
      case 'ping': return json_({ ok: true, folder: folder_().getName() });
      case 'list': return json_({ ok: true, files: list_() });
      case 'upload': return json_({ ok: true, file: upload_(req) });
      case 'download': return json_(Object.assign({ ok: true }, download_(req.id)));
      case 'delete': remove_(req.id); return json_({ ok: true });
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

function list_() {
  const out = [];
  const self = SpreadsheetApp.getActiveSpreadsheet().getId();
  const it = folder_().getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getId() === self || f.isTrashed()) continue;
    out.push(info_(f));
  }
  out.sort(function (a, b) { return b.updated - a.updated; });
  return out;
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
  const f = folder_().createFile(blob);
  logSheet_().appendRow([new Date(), name, f.getMimeType(), f.getSize(), String(req.from || '').slice(0, 40), f.getId(), f.getUrl(), '']);
  return info_(f);
}

/** Only files in the folder (and not the spreadsheet itself) can be read or deleted. */
function inFolder_(id) {
  if (typeof id !== 'string' || !id || id === SpreadsheetApp.getActiveSpreadsheet().getId()) throw new Error('No such file');
  const f = DriveApp.getFileById(id);
  const folderId = folder_().getId();
  const parents = f.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folderId) return f;
  throw new Error('No such file');
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
