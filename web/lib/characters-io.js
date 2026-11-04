// Characters as a folder: all of them saved together (a "Characters" folder of PNGs with a
// characters.json listing their names, as a ZIP, into a folder on a computer, or into Saved Files),
// and installed again from such a folder (the ZIP, the folder's files, or the Saved Files folder) on
// this phone or another. Ones already here (same name, same image) are skipped.

import { listCharacters, addCharacter, getCharacterBlob } from './characters.js';
import { createZip, readZip } from './zip.js';

export const FOLDER = 'Characters';
export const MANIFEST = 'characters.json';
const EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif' };
const TYPE = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };

/** A name safe as a file name on any computer. */
export const safeName = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^\.+/, '').trim().slice(0, 80) || 'Character';

/**
 * Every Character as files for a folder: [{ name, blob }] (the images, then characters.json), names
 * unique. `list`/`get` are for tests (default: this phone's Characters).
 */
export async function characterFiles({ list = listCharacters, get = getCharacterBlob } = {}) {
  const chars = await list();
  const used = new Set(); const files = []; const entries = [];
  for (const c of chars) {
    const blob = await get(c.id); if (!blob) continue;
    const ext = EXT[blob.type] ?? 'png';
    let base = safeName(c.name);
    for (let i = 2; used.has(`${base}.${ext}`.toLowerCase()); i++) base = `${safeName(c.name)} (${i})`;
    const file = `${base}.${ext}`; used.add(file.toLowerCase());
    files.push({ name: file, blob });
    entries.push({ file, name: c.name, width: c.width, height: c.height, createdAt: c.createdAt, ...(c.face ? { face: c.face } : {}) });
  }
  const manifest = { app: 'Command Center', kind: 'characters', version: 1, savedAt: new Date().toISOString(), characters: entries };
  files.push({ name: MANIFEST, blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }) });
  return { files, count: entries.length };
}

/** Every Character as one ZIP (a "Characters" folder inside): { blob, count }. */
export async function charactersZip(opts) {
  const { files, count } = await characterFiles(opts);
  const zipped = createZip(await Promise.all(files.map(async (f) => ({ name: `${FOLDER}/${f.name}`, bytes: new Uint8Array(await f.blob.arrayBuffer()) }))));
  return { blob: new Blob([zipped], { type: 'application/zip' }), count };
}

/** Every Character written into a folder picked on a computer (File System Access): the count. */
export async function saveToDirectory(dir, opts) {
  const { files, count } = await characterFiles(opts);
  const sub = await dir.getDirectoryHandle(FOLDER, { create: true });
  for (const f of files) {
    const w = await (await sub.getFileHandle(f.name, { create: true })).createWritable();
    await w.write(f.blob); await w.close();
  }
  return count;
}

/** Every Character into a "Characters" folder in Saved Files (same names replaced): the count. */
export async function saveToSavedFiles(api, opts) {
  const { files, count } = await characterFiles(opts);
  for (const f of files) await api.upload(new File([f.blob], f.name, { type: f.blob.type }), 'Characters', FOLDER);
  return count;
}

/** Files as { name, blob } from what was picked: ZIPs opened, images and characters.json kept. */
async function unpack(picked) {
  const out = [];
  for (const f of picked) {
    const name = String(f.name ?? f.webkitRelativePath ?? '');
    // A ZIP by its name, its type, or (a file handed over with neither) its first bytes: "PK\3\4".
    const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
    const isZip = /\.zip$/i.test(name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed' || (head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4);
    if (isZip) {
      for (const z of await readZip(f)) {
        const base = z.name.split('/').pop();
        if (base.startsWith('.') || z.name.includes('__MACOSX/')) continue;
        const ext = base.split('.').pop().toLowerCase();
        out.push({ name: base, blob: new Blob([z.bytes], { type: base === MANIFEST ? 'application/json' : TYPE[ext] ?? '' }) });
      }
    } else out.push({ name: name.split('/').pop(), blob: f });
  }
  return out;
}

/** The size of an image (for the Character's entry), or null when it can't be read. */
async function sizeOf(blob) {
  try { const b = await createImageBitmap(blob); const s = { width: b.width, height: b.height }; b.close?.(); return s; } catch { return null; }
}

/**
 * Install Characters from what was picked (a ZIP, a folder's files, or images): the names in
 * characters.json when it's there, else the file names. { added, skipped, names }. `list`/`add`/`get`/
 * `measure` are for tests.
 */
export async function installCharacters(picked, { list = listCharacters, add = addCharacter, get = getCharacterBlob, measure = sizeOf } = {}) {
  const files = await unpack(picked);
  const manifestFile = files.find((f) => f.name === MANIFEST);
  let manifest = null;
  if (manifestFile) { try { manifest = JSON.parse(await manifestFile.blob.text()); } catch { manifest = null; } }
  const byFile = new Map((manifest?.characters ?? []).map((c) => [c.file, c]));
  const images = files.filter((f) => f.name !== MANIFEST && (/^image\//.test(f.blob.type) || /\.(png|webp|jpe?g|gif)$/i.test(f.name)));
  // In the order they were saved (the manifest's), the first of them ending up first.
  const order = manifest ? [...images].sort((a, b) => indexIn(manifest, a.name) - indexIn(manifest, b.name)) : images;
  const have = await list();
  const sizes = new Map();
  for (const c of have) { const b = await get(c.id); if (b) sizes.set(`${c.name}|${b.size}`, true); }
  let added = 0; let skipped = 0; const names = [];
  for (const f of [...order].reverse()) {
    const meta = byFile.get(f.name);
    const name = (meta?.name ?? f.name.replace(/\.[^.]+$/, '')).slice(0, 80);
    if (sizes.has(`${name}|${f.blob.size}`)) { skipped++; continue; }
    const blob = f.blob.type ? f.blob : new Blob([f.blob], { type: TYPE[f.name.split('.').pop().toLowerCase()] ?? 'image/png' });
    const dims = meta?.width ? { width: meta.width, height: meta.height } : (await measure(blob)) ?? { width: 0, height: 0 };
    await add(blob, { name, ...dims, ...(meta?.face ? { face: meta.face } : {}) });
    sizes.set(`${name}|${blob.size}`, true);
    added++; names.unshift(name);
  }
  return { added, skipped, names };
}
const indexIn = (m, file) => { const i = m.characters.findIndex((c) => c.file === file); return i < 0 ? 1e9 : i; };

/** Install from the "Characters" folder in Saved Files: as installCharacters. */
export async function installFromSavedFiles(api, opts) {
  const folders = await api.folders();
  const folder = folders.find((f) => f.path === FOLDER) ?? folders.find((f) => f.name === FOLDER);
  if (!folder) throw new Error('There\'s no "Characters" folder in Saved Files yet: save your Characters there first.');
  const { files } = await api.browse(folder.id);
  const wanted = files.filter((f) => f.name === MANIFEST || /\.(png|webp|jpe?g|gif)$/i.test(f.name));
  if (!wanted.length) throw new Error('The "Characters" folder in Saved Files has no images.');
  const got = [];
  for (const f of wanted) got.push(await api.download(f.id));
  return installCharacters(got, opts);
}
