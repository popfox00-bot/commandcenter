// Reader → 💽 Drive (a computer's Chrome or Edge: the browser can read and write a folder you pick): a drive's STORAGE
// folder, connected once and remembered. 🔒 New package packs files or a whole folder into one locked file there, a piece
// at a time (lib/ccv2.js: any size, never all in memory), with its progress, speed and Cancel; each package there opens
// to show what's in it, and one file can be looked at, everything taken out to a folder, or added to the library.
// Nothing goes anywhere but the drive: it's all done in this browser, on this computer.
import { el, fill } from '../../lib/dom.js';
import { idb } from '../../lib/idb.js';
import { formatBytes } from '../../lib/files.js';
import { createVaultRaw, unlockRaw, keyFromRaw } from '../../lib/vault.js';
import { writeCCV2, inspectCCV2, listCCV2, extractCCV2, fileFromCCV2, isCCV2 } from '../../lib/ccv2.js';
import { open as openPackage, baseName, kindOf } from './reader-core.js';

const KEY = 'cc.reader.drive'; export const FOLDER = 'STORAGE';
/** Whether this browser can work in a folder on a drive (Chrome or Edge on a computer). */
export const driveSupported = () => typeof globalThis.showDirectoryPicker === 'function';
/** Whether two headers hold the same key (the same password wrap: made from Reader's own). */
const sameKey = (a, b) => !!a?.password?.salt && a.password.salt === b?.password?.salt;
const day = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const rate = (b, ms) => `${formatBytes(Math.round(b / Math.max(0.001, ms / 1000)))}/s`;
const clock = (s) => { s = Math.max(0, Math.round(s)); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; };

/** Every file inside a folder (and its folders), with its path under it: [{ file, path }]. */
async function walk(dir, prefix = '') {
  const out = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'file') out.push({ file: await h.getFile(), path: `${prefix}${name}` });
    else out.push(...await walk(h, `${prefix}${name}/`));
  }
  return out;
}
/** A name free in `dir` ("Photos.ccv", else "Photos (2).ccv"). */
async function freeName(dir, base, ext) {
  for (let i = 1; ; i++) { const n = `${base}${i > 1 ? ` (${i})` : ''}${ext}`; try { await dir.getFileHandle(n); } catch { return n; } }
}

/**
 * The Drive panel in `host`. `session()` → Reader's { key, header }; `view(files, i)` shows files; `addToLibrary(files,
 * name)` (files with their paths as names) puts them in the library; `ask(name)` → a package's password (or null).
 */
export function drivePanel(host, { session, view, addToLibrary, ask }) {
  let dir = null; let rootName = '';
  const say = el('p', { class: 'small rd-status', role: 'status' });
  const note = (t, bad = false) => { say.textContent = t; say.classList.toggle('bad-text', bad); };
  start();
  async function start() {
    const kept = await idb.get(KEY);
    if (kept?.dir) { dir = kept.dir; rootName = kept.root || ''; if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return draw(); return reconnectScreen(); }
    connectScreen();
  }
  function connectScreen() {
    fill(host, el('div', { class: 'card rd-card' }, el('h3', { text: '💽 Connect your drive' }),
      el('p', { text: `Pick the drive (or its ${FOLDER} folder). Reader keeps every locked package in its ${FOLDER} folder, made there if it isn't yet.` }),
      el('p', { class: 'small muted', text: 'Everything is done here, in this browser on this computer: packed, compressed and encrypted straight onto the drive, a piece at a time, however big. Nothing is uploaded.' }),
      el('button', { type: 'button', class: 'btn primary block', text: '💽 Choose the drive…', onclick: connect }), say));
  }
  function reconnectScreen() {
    fill(host, el('div', { class: 'card rd-card' }, el('h3', { text: '💽 Your drive' }),
      el('p', { text: `Chrome needs your OK to use ${rootName ? `${rootName}\\` : ''}${FOLDER} again (once each time it's opened).` }),
      el('button', { type: 'button', class: 'btn primary block', text: `Allow ${FOLDER}`, onclick: async () => { try { if ((await dir.requestPermission({ mode: 'readwrite' })) === 'granted') draw(); else note('Not allowed: plug the drive in, then try again.', true); } catch (e) { note(`The drive isn't there (unplugged?): ${e.message}`, true); } } }),
      el('button', { type: 'button', class: 'btn ghost block', text: 'Choose another drive…', onclick: connect }), say));
  }
  async function connect() {
    try {
      const root = await showDirectoryPicker({ id: 'reader-drive', mode: 'readwrite' });
      dir = root.name.toUpperCase() === FOLDER ? root : await root.getDirectoryHandle(FOLDER, { create: true }); rootName = root.name.toUpperCase() === FOLDER ? '' : root.name;
      await idb.set(KEY, { dir, root: rootName }); draw();
    } catch (e) { if (e?.name !== 'AbortError') note(e.message, true); }
  }

  async function draw(msg = '') {
    let pkgs = [];
    try { for await (const [name, h] of dir.entries()) if (h.kind === 'file' && /\.(ccv|zip)$/i.test(name)) { const f = await h.getFile(); pkgs.push({ name, h, size: f.size, at: f.lastModified }); } }
    catch (e) { note(`The drive isn't there (unplugged?): ${e.message}`, true); return reconnectScreen(); }
    pkgs.sort((a, b) => b.at - a.at);
    const total = pkgs.reduce((n, p) => n + p.size, 0);
    fill(host,
      el('div', { class: 'rd-stats', role: 'group', 'aria-label': `What's in ${FOLDER}` },
        el('div', {}, el('strong', { text: String(pkgs.length) }), el('span', { text: pkgs.length === 1 ? 'package' : 'packages' })),
        el('div', {}, el('strong', { text: formatBytes(total) }), el('span', { text: `in ${FOLDER}` })),
        el('div', {}, el('strong', { text: rootName || '💽' }), el('span', { text: 'drive' }))),
      el('div', { class: 'rd-actions' },
        el('button', { type: 'button', class: 'btn primary', text: '🔒 New package from a folder…', onclick: () => pickSource('folder') }),
        el('button', { type: 'button', class: 'btn', text: '🔒 New package from files…', onclick: () => pickSource('files') }),
        el('button', { type: 'button', class: 'btn ghost', text: '↻', 'aria-label': 'Refresh', onclick: () => draw() }),
        el('button', { type: 'button', class: 'btn ghost', text: 'Change drive', onclick: connect })),
      say,
      el('ul', { class: 'rd-list' }, pkgs.length ? pkgs.map((p) => el('li', { class: 'rd-row' },
        el('button', { type: 'button', class: 'rd-open', 'aria-label': `Open ${p.name}`, onclick: () => openPkg(p) }, el('span', { class: 'rd-ic', text: /\.zip$/i.test(p.name) ? '🗜' : '🔒' }), el('span', { class: 'rd-name' }, el('strong', { text: p.name }), el('span', { class: 'small muted', text: `${formatBytes(p.size)} · ${day(p.at)}` }))),
        el('button', { type: 'button', class: 'icon-btn small-btn', 'aria-label': `Delete ${p.name}`, text: '🗑', onclick: async () => { if (!confirm(`Delete "${p.name}" from the drive? This can't be undone.`)) return; await dir.removeEntry(p.name); draw(`Deleted ${p.name}.`); } })))
        : el('li', { class: 'rd-empty muted', text: `No packages in ${FOLDER} yet: 🔒 New package from a folder or from files.` })));
    if (msg) note(msg);
  }

  // ---- 🔒 A new package, straight onto the drive.
  async function pickSource(kind) {
    let items = []; let name = '';
    try {
      if (kind === 'folder') { const src = await showDirectoryPicker({ id: 'reader-source', mode: 'read' }); name = src.name; note(`Looking through ${src.name}…`); items = (await walk(src)).map((x) => ({ file: x.file, path: `${src.name}/${x.path}` })); }
      else { const hs = await showOpenFilePicker({ multiple: true, id: 'reader-files' }); for (const h of hs) { const f = await h.getFile(); items.push({ file: f, path: f.name }); } name = items.length === 1 ? baseName(items[0].path) : `Files ${new Date().toISOString().slice(0, 10)}`; }
    } catch (e) { if (e?.name !== 'AbortError') note(e.message, true); return; }
    if (!items.length) { note('Nothing to pack there.'); return; }
    makeDialog(items, name);
  }
  function makeDialog(items, name0) {
    const size = items.reduce((n, x) => n + x.file.size, 0);
    const nameIn = el('input', { type: 'text', class: 'so-input', value: name0, 'aria-label': 'Package name' });
    const mode = el('select', { class: 'so-input', 'aria-label': 'Lock it with' }, el('option', { value: 'reader', text: 'Reader\'s password (and recovery key)' }), el('option', { value: 'other', text: 'A different password' }));
    const other = el('input', { type: 'password', class: 'so-input', 'aria-label': 'Package password', placeholder: 'Its password (8 or more)', hidden: true });
    mode.addEventListener('change', () => { other.hidden = mode.value !== 'other'; });
    const bar = el('div', { class: 'progress', hidden: true }, el('div', { class: 'progress-bar' }), el('span', { class: 'small muted progress-label' }));
    const msg = el('p', { class: 'small', role: 'status' }); let ctl = null;
    const go = el('button', { type: 'button', class: 'btn primary block', text: `Lock ${items.length} file${items.length === 1 ? '' : 's'} into ${FOLDER}`, onclick: async () => {
      if (ctl) { ctl.abort(); return; }
      let key; let header; let rk = null;
      try {
        if (mode.value === 'reader') ({ key, header } = session());
        else { if (other.value.length < 8) { msg.textContent = 'Use a password of at least 8 characters.'; return; } msg.textContent = 'Making its key…'; const v = await createVaultRaw(other.value); key = await keyFromRaw(v.raw); header = v.header; rk = v.recoveryKey; }
      } catch (e) { msg.textContent = e.message; return; }
      ctl = new AbortController(); go.textContent = 'Cancel'; bar.hidden = false;
      const fname = await freeName(dir, baseName(nameIn.value, 'Package'), '.ccv');
      const fh = await dir.getFileHandle(fname, { create: true }); const w = await fh.createWritable();
      const t0 = performance.now();
      try {
        await writeCCV2({ files: items.map((x) => ({ name: x.path, size: x.file.size, type: x.file.type, lastModified: x.file.lastModified, slice: (a, b) => x.file.slice(a, b) })), key, header, write: (b) => w.write(b), signal: ctl.signal,
          onProgress: ({ done, total, file }) => { const ms = performance.now() - t0; bar.firstChild.style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`; bar.lastChild.textContent = `${formatBytes(done)} of ${formatBytes(total)} · ${rate(done, ms)} · ${done ? clock(((total - done) * ms) / done / 1000) : '…'} left · ${file.split('/').pop()}`; } });
        await w.close();
        const out = await (await fh.getFile()).size;
        bar.hidden = true; msg.textContent = `✓ ${fname} in ${FOLDER}: ${formatBytes(out)} (from ${formatBytes(size)}) in ${clock((performance.now() - t0) / 1000)}.${rk ? ` Its recovery key: ${rk}` : ''}`;
        go.textContent = 'Done'; go.onclick = () => dlg.close(); draw(`Made ${fname}.`);
      } catch (e) {
        try { await w.abort(); } catch { /* gone */ } try { await dir.removeEntry(fname); } catch { /* none */ }
        bar.hidden = true; msg.textContent = e.canceled ? 'Canceled: nothing was left on the drive.' : `It couldn't be made: ${e.message}`; go.textContent = 'Try again';
      } finally { ctl = null; }
    } });
    const dlg = el('dialog', { class: 'ed-dialog vp-dialog', 'aria-label': 'New package' }, el('div', { class: 'sheet' },
      el('div', { class: 'row space' }, el('h2', { text: '🔒 New package' }), el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', text: '✕', onclick: () => { ctl?.abort(); dlg.close(); } })),
      el('p', { class: 'small muted', text: `${items.length} file${items.length === 1 ? '' : 's'}, ${formatBytes(size)}, into one locked file in ${FOLDER} (folders kept; compressed where it helps; encrypted, AES-256).` }),
      el('label', { class: 'field' }, el('span', { text: 'Name' }), nameIn), el('label', { class: 'field' }, el('span', { text: 'Lock it with' }), mode), other, go, bar, msg));
    dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal();
  }

  // ---- A package on the drive, opened: what's in it; look, take out, or add to the library.
  async function keyFor(blob, info, name) {
    const s = session(); if (s && sameKey(s.header, info.header)) return s.key;
    for (;;) { const pw = await ask(name); if (pw == null) return null; try { return await keyFromRaw(await unlockRaw(info.header, pw)); } catch { note('That password didn\'t open it.', true); } }
  }
  async function openPkg(p) {
    note(`Opening ${p.name}…`);
    const blob = await p.h.getFile(); const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    try {
      if (isCCV2(head)) {
        const info = await inspectCCV2(blob); const key = await keyFor(blob, info, p.name); if (!key) { note(''); return; }
        const list = await listCCV2(blob, key, info); note('');
        contents(p, list.files.map((e) => ({ path: e.n, size: e.s, kind: kindOf(e.n, e.t), get: (o) => fileFromCCV2(blob, key, e, { info, ...o }), out: (write, o) => extractCCV2(blob, key, e, write, { info, ...o }) })), list.size);
      } else {
        // (A package made in Reader's 📤 Export, or a ZIP: opened in memory.)
        let r; let secret = '';
        for (;;) { try { r = await openPackage(blob, { secret, session: session() }); break; } catch (e) { if (!e.needsSecret && !/Wrong password/.test(e.message)) throw e; secret = await ask(p.name); if (secret == null) { note(''); return; } } }
        note(''); contents(p, r.files.map((f) => ({ path: f.name, size: f.size, kind: kindOf(f.name, f.type), get: async () => new File([f], f.name.split('/').pop(), { type: f.type }), out: async (write) => { write(new Uint8Array(await f.arrayBuffer())); } })), r.files.reduce((n, f) => n + f.size, 0));
      }
    } catch (e) { note(`${p.name}: ${e.message}`, true); }
  }
  function contents(p, items, size) {
    const bar = el('div', { class: 'progress', hidden: true }, el('div', { class: 'progress-bar' }), el('span', { class: 'small muted progress-label' }));
    const msg = el('p', { class: 'small', role: 'status' });
    const BIG = 300 * 1024 * 1024;
    const dlg = el('dialog', { class: 'ed-dialog vp-dialog', 'aria-label': 'Package' }, el('div', { class: 'sheet' },
      el('div', { class: 'row space' }, el('h2', { text: `🔒 ${p.name}` }), el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', text: '✕', onclick: () => dlg.close() })),
      el('div', { class: 'rd-stats' }, el('div', {}, el('strong', { text: String(items.length) }), el('span', { text: items.length === 1 ? 'file' : 'files' })), el('div', {}, el('strong', { text: formatBytes(size) }), el('span', { text: 'inside' })), el('div', {}, el('strong', { text: formatBytes(p.size) }), el('span', { text: 'on the drive' }))),
      el('div', { class: 'row wrap' },
        el('button', { type: 'button', class: 'btn primary', text: '📂 Take everything out to a folder…', onclick: async () => {
          let dest; try { dest = await showDirectoryPicker({ id: 'reader-out', mode: 'readwrite' }); } catch (e) { if (e?.name !== 'AbortError') msg.textContent = e.message; return; }
          const into = await dest.getDirectoryHandle(baseName(p.name, 'Package'), { create: true }); bar.hidden = false; const t0 = performance.now(); let done = 0;
          try {
            for (const it of items) {
              const parts = it.path.split('/').filter((x) => x && x !== '..'); const fname = parts.pop() || 'file'; let d = into; for (const part of parts) d = await d.getDirectoryHandle(part, { create: true });
              const w = await (await d.getFileHandle(fname, { create: true })).createWritable();
              await it.out((b) => w.write(b), { onProgress: ({ done: fd }) => { const all = done + fd; bar.firstChild.style.width = `${Math.round((all / Math.max(1, size)) * 100)}%`; bar.lastChild.textContent = `${formatBytes(all)} of ${formatBytes(size)} · ${rate(all, performance.now() - t0)}`; } });
              await w.close(); done += it.size;
            }
            bar.hidden = true; msg.textContent = `✓ ${items.length} file${items.length === 1 ? '' : 's'} taken out to ${dest.name}\\${into.name}.`;
          } catch (e) { bar.hidden = true; msg.textContent = `Stopped: ${e.message}`; }
        } }),
        el('button', { type: 'button', class: 'btn', text: '📚 Add to the library', onclick: async () => {
          if (size > 2 * 1024 ** 3 && !confirm(`That's ${formatBytes(size)}: the library keeps it in this browser's storage. Add it anyway?`)) return;
          try { const files = []; for (const [i, it] of items.entries()) { msg.textContent = `Reading ${i + 1} of ${items.length}…`; const f = await it.get(); files.push(new File([f], it.path, { type: f.type })); } msg.textContent = 'Adding…'; await addToLibrary(files, baseName(p.name)); msg.textContent = `✓ Added ${files.length} to the library.`; } catch (e) { msg.textContent = e.message; }
        } })),
      bar, msg,
      el('ul', { class: 'rd-list rd-pkg-list' }, items.map((it, i) => el('li', { class: 'rd-row' },
        el('button', { type: 'button', class: 'rd-open', 'aria-label': `Look at ${it.path}`, disabled: it.size > BIG, onclick: async () => { msg.textContent = `Opening ${it.path}…`; try { const files = [await it.get()]; msg.textContent = ''; view(files.map((f) => ({ file: f })), 0); } catch (e) { msg.textContent = e.message; } void i; } },
          el('span', { class: 'rd-ic', text: { image: '🖼', video: '🎬', audio: '🎵', pdf: '📄', text: '📝' }[it.kind] ?? '📦' }), el('span', { class: 'rd-name' }, el('strong', { text: it.path }), el('span', { class: 'small muted', text: `${formatBytes(it.size)}${it.size > BIG ? ' · too big to look at here: take it out' : ''}` }))))))));
    dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal();
  }
}
