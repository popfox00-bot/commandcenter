// Saved Files → 🔎 Scan for characters: a batch of files read for faces (a photo once; a video at many stills
// from all through it), each face compared with the Socials accounts' profile photos (socials-faces.js), and
// who it might be suggested, with how sure. Nothing is done with it: you say yes ("It's them") or no to each,
// and the yeses are kept in Character matches (in Saved Files, inside the Vault). All on this phone: each file
// is downloaded from your Drive as when it's opened, and read here; nothing else leaves the phone.

import { idb } from '../../lib/idb.js';
import { el, fill } from '../../lib/dom.js';

const MATCHES = 'cc.saved.matches';
const FACES = 'cc.saved.scanfaces'; // (accounts' faces, by their photo's id: made once)

/** How sure a match is, from its distance (under 0.5 counts): 0.25 or closer ~100%, 0.5 ~50%. */
export const sureOf = (d) => Math.max(1, Math.min(99, Math.round(100 - Math.max(0, d - 0.25) * 200)));

/** The kept matches: [{ fileId, name, accountId, handle, sure, at }], newest first. */
export async function listMatches() { const v = await idb.get(MATCHES); return Array.isArray(v) ? v : []; }
/** A match kept (once per file and account). */
export async function keepMatch(m) {
  const list = (await listMatches()).filter((x) => !(x.fileId === m.fileId && x.accountId === m.accountId));
  const next = [{ ...m, at: Date.now() }, ...list]; await idb.set(MATCHES, next); return next;
}
export async function dropMatch(fileId, accountId) { const next = (await listMatches()).filter((x) => !(x.fileId === fileId && x.accountId === accountId)); await idb.set(MATCHES, next); return next; }

/** Whether a listed file can be scanned (a photo or a video). */
export const scannable = (f) => !f.folder && !f.locked && (/^(image|video)\//.test(f.type ?? '') || /\.(jpe?g|png|heic|webp|gif|mov|mp4|m4v|webm)$/i.test(f.name ?? ''));
const isVideo = (f) => /^video\//.test(f.type ?? '') || /\.(mov|mp4|m4v|webm)$/i.test(f.name ?? '');

/** The Socials accounts with a face to match (their profile photos'): [{ id, handle, avatar, d }]. */
export async function knownAccounts() {
  const { loadState } = await import('../../apps/socials/socials-store.js');
  const { faceOfAvatar } = await import('../../apps/socials/socials-faces.js');
  const { state } = await loadState();
  const cache = (await idb.get(FACES)) ?? {}; let changed = false; const out = [];
  for (const a of state.accounts ?? []) {
    if (!a.avatar) continue;
    let d = a.face && a.faceOf === a.avatarId ? a.face : cache[a.avatarId];
    if (d === undefined) { try { d = await faceOfAvatar(a.avatar); } catch { d = null; } cache[a.avatarId] = d; changed = true; }
    if (d) out.push({ id: a.id, handle: a.handle, avatar: a.avatar, d });
  }
  if (changed) await idb.set(FACES, cache);
  return out;
}

/**
 * Files scanned: each downloaded (`download(id)` → its file), its faces found (a video's at `stills` stills)
 * and matched with `known`. `onProgress({ i, n, name, still, stills })`. Resolves to [{ f, faces, hits:
 * [{ id, handle, distance, sure }] }] (in the files' order); `cancelled()` stops between files.
 */
export async function scanFiles(files, { download, known, stills = 12, onProgress = () => {}, cancelled = () => false }) {
  const { facesIn, matchFaces } = await import('../../apps/socials/socials-faces.js');
  const out = [];
  for (const [i, f] of files.entries()) {
    if (cancelled()) break;
    onProgress({ i, n: files.length, name: f.name, still: 0, stills: isVideo(f) ? stills : 1 });
    let faces = []; let error = '';
    try {
      const file = await download(f.id);
      let shots = [file];
      if (isVideo(f)) { const { videoFrames } = await import('../../apps/socials/socials-editor.js'); shots = await videoFrames(file, { n: stills, edge: 720, wait: 5000 }); }
      for (const [k, s] of shots.entries()) { onProgress({ i, n: files.length, name: f.name, still: k + 1, stills: shots.length }); try { faces.push(...await facesIn(s)); } catch { /* that still */ } }
    } catch (e) { error = e.message; faces = []; }
    const hits = matchFaces(faces, known).map((h) => ({ ...h, handle: known.find((k) => k.id === h.id)?.handle ?? '?', sure: sureOf(h.distance) }));
    out.push({ f, faces: faces.length, hits, error });
  }
  return out;
}

/**
 * The scanner, as a dialog over Saved Files: `files` (the folder's), `download(id)`. Pick which, scan, then a
 * yes or no on each suggestion (yeses kept in Character matches).
 */
export function openScanner(files, { download }) {
  const list = files.filter(scannable);
  const picked = new Set(list.map((f) => f.id));
  const body = el('div', { class: 'sc-body' });
  const dlg = el('dialog', { class: 'ed-dialog sc-dialog', 'aria-label': 'Scan for characters' }, el('div', { class: 'sheet' },
    el('div', { class: 'row space' }, el('h2', { text: '🔎 Scan for characters' }), el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', text: '✕', onclick: () => dlg.close() })), body));
  let stop = false;
  dlg.addEventListener('close', () => { stop = true; dlg.remove(); });
  const avatars = []; const av = (b) => { const u = URL.createObjectURL(b); avatars.push(u); return u; };
  dlg.addEventListener('close', () => { for (const u of avatars) URL.revokeObjectURL(u); });

  function choose() {
    if (!list.length) { fill(body, el('p', { class: 'muted', text: 'No photos or videos in this folder to scan.' })); return; }
    const count = el('span', {});
    const go = el('button', { type: 'button', class: 'btn primary block', onclick: run }, 'Scan ', count);
    const paint = () => { count.textContent = `${picked.size} file${picked.size === 1 ? '' : 's'}`; go.disabled = !picked.size; };
    fill(body,
      el('p', { class: 'small muted', text: 'Each file is downloaded and read on this phone: a photo once, a video at 12 stills from all through it. Faces are compared with your Socials accounts\' profile photos and who they might be is suggested. Nothing is changed.' }),
      el('div', { class: 'row wrap' }, el('button', { type: 'button', class: 'btn small-btn ghost', text: 'All', onclick: () => { list.forEach((f) => picked.add(f.id)); choose(); } }), el('button', { type: 'button', class: 'btn small-btn ghost', text: 'None', onclick: () => { picked.clear(); choose(); } })),
      el('ul', { class: 'sc-pick' }, list.map((f) => { const c = el('input', { type: 'checkbox', checked: picked.has(f.id) }); c.addEventListener('change', () => { if (c.checked) picked.add(f.id); else picked.delete(f.id); paint(); }); return el('li', {}, el('label', {}, c, ` ${isVideo(f) ? '🎬' : '🖼️'} ${f.name}`)); })),
      go);
    paint();
  }

  async function run() {
    const todo = list.filter((f) => picked.has(f.id));
    const status = el('p', { class: 'small', 'aria-live': 'polite', text: 'Getting your Socials accounts\' faces…' });
    const bar = el('div', { class: 'so-upbar-track', role: 'progressbar', 'aria-label': 'Scan progress', 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('span', { class: 'so-upbar-fill' }));
    const cancel = el('button', { type: 'button', class: 'btn', text: 'Stop', onclick: () => { stop = true; cancel.disabled = true; status.textContent = 'Stopping after this file…'; } });
    fill(body, status, bar, cancel);
    let known = [];
    try { known = await knownAccounts(); } catch (e) { fill(body, el('p', { class: 'bad-text', text: `Couldn't read Socials: ${e.message}` })); return; }
    if (!known.length) { fill(body, el('p', { class: 'muted', text: 'None of your Socials accounts has a profile photo with a face yet: add some there, then scan.' })); return; }
    const results = await scanFiles(todo, { download, known, cancelled: () => stop, onProgress: ({ i, n, name, still, stills }) => {
      const q = (i + (stills ? still / stills : 0)) / n; bar.firstChild.style.width = `${Math.max(3, Math.round(q * 100))}%`; bar.setAttribute('aria-valuenow', String(Math.round(q * 100)));
      status.textContent = `${i + 1} of ${n}: ${name}${stills > 1 ? ` (still ${still} of ${stills})` : ''}`;
    } });
    if (!dlg.isConnected) return;
    review(results, known);
  }

  async function review(results, known) {
    const kept = await listMatches(); const isKept = (fid, aid) => kept.some((m) => m.fileId === fid && m.accountId === aid);
    const withHits = results.filter((r) => r.hits.length); const faceless = results.filter((r) => !r.faces && !r.error).length; const unknown = results.filter((r) => r.faces && !r.hits.length).length;
    const errors = results.filter((r) => r.error);
    fill(body,
      el('p', { class: 'small', text: `Scanned ${results.length} file${results.length === 1 ? '' : 's'}: ${withHits.length} with someone who might be one of your accounts${unknown ? `, ${unknown} with faces not recognized` : ''}${faceless ? `, ${faceless} with no faces found` : ''}.` }),
      errors.length ? el('p', { class: 'small bad-text', text: `Couldn't read ${errors.length}: ${errors.map((r) => r.f.name).join(', ')}` }) : null,
      withHits.length ? el('ul', { class: 'sc-results' }, withHits.map((r) => el('li', { class: 'sc-file' },
        el('strong', { class: 'sc-name', text: `${isVideo(r.f) ? '🎬' : '🖼️'} ${r.f.name}` }),
        el('ul', { class: 'sc-hits' }, r.hits.map((h) => {
          const acc = known.find((k) => k.id === h.id);
          const row = el('li', { class: 'sc-hit' },
            acc?.avatar ? el('img', { class: 'sc-av', src: av(acc.avatar), alt: '' }) : null,
            el('span', { class: 'sc-who' }, el('strong', { text: `@${h.handle}` }), el('span', { class: 'small muted', text: ` ${h.sure}% likely` })));
          const yes = el('button', { type: 'button', class: 'btn small-btn primary', text: isKept(r.f.id, h.id) ? '✓ Kept' : '✓ It\'s them', disabled: isKept(r.f.id, h.id), 'aria-label': `It's @${h.handle} in ${r.f.name}`, onclick: async () => { await keepMatch({ fileId: r.f.id, name: r.f.name, accountId: h.id, handle: h.handle, sure: h.sure }); yes.textContent = '✓ Kept'; yes.disabled = true; no.hidden = true; } });
          const no = el('button', { type: 'button', class: 'btn small-btn ghost', text: '✕ Not them', 'aria-label': `Not @${h.handle} in ${r.f.name}`, hidden: isKept(r.f.id, h.id), onclick: () => { row.classList.add('sc-no'); yes.hidden = true; no.hidden = true; } });
          row.append(yes, no); return row;
        }))))) : null,
      el('p', { class: 'small muted', text: 'Only suggestions: nothing is changed. The ones you say yes to are kept in Character matches (⚙ in Saved Files).' }),
      el('button', { type: 'button', class: 'btn block', text: 'Done', onclick: () => dlg.close() }));
  }

  document.body.append(dlg); dlg.showModal(); choose();
}

/** Character matches: the files you said were your Socials accounts, as a page (in a dialog), each removable. */
export async function openMatches() {
  const body = el('div', {});
  const dlg = el('dialog', { class: 'ed-dialog sc-dialog', 'aria-label': 'Character matches' }, el('div', { class: 'sheet' },
    el('div', { class: 'row space' }, el('h2', { text: '🧑‍🤝‍🧑 Character matches' }), el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', text: '✕', onclick: () => dlg.close() })), body));
  dlg.addEventListener('close', () => dlg.remove());
  async function draw() {
    const list = await listMatches();
    const by = new Map(); for (const m of list) { if (!by.has(m.handle)) by.set(m.handle, []); by.get(m.handle).push(m); }
    fill(body,
      el('p', { class: 'small muted', text: 'Files you confirmed after a scan (🔎 Scan for characters), by account. Kept on this phone, inside the Vault. Nothing has been done with them.' }),
      list.length ? [...by].map(([handle, ms]) => el('section', { class: 'sc-acc' }, el('h3', { text: `@${handle} · ${ms.length}` }),
        el('ul', { class: 'sc-matches' }, ms.map((m) => el('li', {}, el('span', { class: 'sc-mname', text: m.name }), el('span', { class: 'small muted', text: ` ${m.sure}% · ${new Date(m.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}` }),
          el('button', { type: 'button', class: 'btn small-btn ghost', text: 'Remove', 'aria-label': `Remove ${m.name} as @${handle}`, onclick: async () => { await dropMatch(m.fileId, m.accountId); draw(); } })))))) : el('p', { class: 'muted', text: 'No matches kept yet.' }));
  }
  document.body.append(dlg); dlg.showModal(); await draw();
}
