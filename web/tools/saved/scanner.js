// Saved Files → 🔎 Scan for characters: a batch of files read for faces (a photo once; a video at many stills
// from all through it), each face compared with the Socials accounts' faces (their profile photos' and posts',
// socials-faces.js), and who it might be suggested, with how sure, the face beside the account's photo and the
// file's own pictures to check by. You say yes ("It's them") or no to each: a yes puts the file on that account
// in Socials as a draft (waiting for you to share it there) and marks the file matched (a 👤 on its row, and a
// filter by person). Files saved from the phone are scanned as they're saved. All on this phone: each file is
// downloaded from your Drive as when it's opened, and read here; nothing else leaves the phone.

import { idb } from '../../lib/idb.js';
import { el, fill } from '../../lib/dom.js';

const MATCHES = 'cc.saved.matches';

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

/**
 * The Socials accounts' faces to match against (their profile photos' and their posts', socials-faces.js):
 * { known: [{ id, d }], accounts: [{ id, handle, avatar }] }. Socials' data is encrypted: it must be unlocked
 * in this session (throws 'locked' if it isn't). Faces read for the first time are kept with Socials.
 */
export async function knownAccounts() {
  const S = await import('../../apps/socials/socials-store.js');
  if (await S.dataEncrypted() && !(await S.dataKey())) throw Object.assign(new Error('Socials is locked.'), { locked: true });
  const F = await import('../../apps/socials/socials-faces.js'); const { setFace } = await import('../../apps/socials/socials-core.js');
  const { state } = await S.loadState(); let changed = false;
  for (const a of state.accounts ?? []) {
    if (!a.avatar || (a.face && a.faceOf === a.avatarId)) continue;
    try { const d = await F.faceOfAvatar(a.avatar); setFace(state, a.id, d); if (d) changed = true; } catch { /* that one */ }
  }
  if (await F.fillPostFaces(state, { limit: 40 })) changed = true;
  if (changed) await S.saveState(state);
  return { known: F.faceSetsFrom(state), not: F.notFacesFrom(state), accounts: (state.accounts ?? []).map((a) => ({ id: a.id, handle: a.handle, avatar: a.avatar })) };
}

/** What you said about a face, learned by that account in Socials (✓: it's them; ✕ `not`: it isn't). */
export async function learn(accountId, d, { not = false } = {}) {
  if (!Array.isArray(d)) return false;
  const S = await import('../../apps/socials/socials-store.js'); const C = await import('../../apps/socials/socials-core.js');
  const { state } = await S.loadState(); const changed = C.learnFace(state, accountId, d, { not });
  if (changed) await S.saveState(state);
  return changed;
}
/** ✕ Not them: never suggested for that file again, and the face learned as not that account. */
const REJECTS = 'cc.saved.rejects';
export async function listRejects() { const v = await idb.get(REJECTS); return Array.isArray(v) ? v : []; }
export async function rejectMatch(fileId, accountId, d = null) {
  const list = (await listRejects()).filter((x) => !(x.fileId === fileId && x.accountId === accountId));
  await idb.set(REJECTS, [{ fileId, accountId, at: Date.now() }, ...list].slice(0, 2000));
  if (d) await learn(accountId, d, { not: true }).catch(() => false);
}

// ---- Unknown people: faces matched to none of your accounts, grouped across scans (one group a person: each
// face joins the group with a face closest to it, under 0.45 apart), each face once per file. A group can be
// made a Socials account (its clearest face the profile photo; its files matched to it), or set aside ("Not
// someone": its faces keep joining it, hidden). Kept on this phone (Saved Files' storage, as the files' small
// pictures are).
const STRANGERS = 'cc.saved.strangers';
const near = (a, b) => { let t = 0; for (let i = 0; i < 128; i++) { const x = a[i] - b[i]; t += x * x; } return Math.sqrt(t); };
/** The groups: [{ id, faces: [{ d, fileId, name, size, crop: { buf, type } }], hidden, at }], the most files first. */
export async function listStrangers() { const v = await idb.get(STRANGERS); return (Array.isArray(v) ? v : []).sort((a, b) => b.faces.length - a.faces.length || b.at - a.at); }
/** Unknown faces (from scanFiles' results) added to the groups. */
export async function addStrangers(results) {
  const groups = await listStrangers(); let changed = false;
  for (const r of results) for (const u of r.unknown ?? []) {
    let best = null; let bd = 0.45;
    for (const g of groups) for (const f of g.faces) { const x = near(u.d, f.d); if (x < bd) { bd = x; best = g; } }
    const face = { d: u.d, fileId: r.f.id, name: r.f.name, size: u.size, crop: u.crop ? { buf: await u.crop.arrayBuffer(), type: 'image/jpeg' } : null };
    if (best) {
      const same = best.faces.findIndex((f) => f.fileId === r.f.id);
      if (same >= 0) { if ((best.faces[same].size ?? 0) < u.size) { best.faces[same] = face; changed = true; } continue; }
      best.faces.push(face); best.faces = best.faces.slice(-40); best.at = Date.now();
    } else groups.push({ id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, faces: [face], hidden: false, at: Date.now() });
    changed = true;
  }
  if (changed) await idb.set(STRANGERS, groups.slice(0, 300));
  return changed;
}
const keepStrangers = (groups) => idb.set(STRANGERS, groups);
/** A group set aside (its faces keep joining it, not shown) or brought back. */
export async function hideStranger(id, hidden = true) { await keepStrangers((await listStrangers()).map((g) => (g.id === id ? { ...g, hidden } : g))); }
/** The clearest face of a group (the biggest). */
export const bestFace = (g) => g.faces.reduce((a, b) => ((b.size ?? 0) > (a.size ?? 0) && b.crop ? b : a), g.faces.find((f) => f.crop) ?? g.faces[0]);

/**
 * A group made a Socials account: its clearest face its profile photo (and its face), the group's other faces
 * learned as it; each of its files matched to it. `kind`: 'friend' or 'celebrity'. Resolves to { id, handle }.
 */
export async function strangerToAccount(groupId, { handle, name = '', kind = 'friend' }) {
  const g = (await listStrangers()).find((x) => x.id === groupId); if (!g) throw new Error('That group is gone.');
  const S = await import('../../apps/socials/socials-store.js'); const C = await import('../../apps/socials/socials-core.js');
  const { state } = await S.loadState();
  const problem = C.handleProblem(state, handle); if (problem) throw new Error(problem);
  const best = bestFace(g);
  const a = C.addAccount(state, { handle, name, kind, avatar: best.crop ? new Blob([best.crop.buf], { type: best.crop.type }) : null });
  if (a.avatarId) C.setFace(state, a.id, best.d);
  for (const f of g.faces) if (f !== best) C.learnFace(state, a.id, f.d);
  await S.saveState(state);
  const files = [...new Map(g.faces.map((f) => [f.fileId, f.name])).entries()];
  for (const [fileId, fname] of files) await keepMatch({ fileId, name: fname, accountId: a.id, handle: a.handle, sure: 100 });
  await keepStrangers((await listStrangers()).filter((x) => x.id !== groupId));
  return { id: a.id, handle: a.handle, files: files.map(([id, n]) => ({ id, name: n })) };
}

/** Socials unlocked here with its password (for the scanner): true, or false if it's wrong. */
export async function unlockSocials(password) {
  const S = await import('../../apps/socials/socials-store.js'); const { makeLock } = await import('../../lib/hidden-lock.js');
  if (!(await makeLock('cc.socials.lock', 'cc.socials.open').tryPassword(password))) return false;
  return S.unlockData(password);
}

// (Small pictures of a file, kept on this phone so its row and the scan's review show what it is: a photo's
// own, made small; a video's stills from through it (four).)
const THUMB = (id) => `cc.saved.thumb.${id}`;
async function shrink(blob, edge, square = null) {
  const bmp = await createImageBitmap(blob); const W = bmp.width; const H = bmp.height;
  let sx = 0; let sy = 0; let sw = W; let sh = H;
  if (square) { // [x, y, w, h] (0–1): that part, a square around it with some room
    const [x, y, w, h] = square; const side = Math.min(Math.max(w * W, h * H) * 1.5, W, H);
    sx = Math.max(0, Math.min(W - side, (x + w / 2) * W - side / 2)); sy = Math.max(0, Math.min(H - side, (y + h / 2) * H - side / 2)); sw = side; sh = side;
  }
  const k = Math.min(1, edge / Math.max(sw, sh));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height); bmp.close?.();
  return new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.8));
}
/** A file's small pictures (Blobs; [] if none made yet). */
export async function thumbsOf(id) { const v = await idb.get(THUMB(id)); return Array.isArray(v) ? v.map((p) => new Blob([p.buf], { type: p.type })) : []; }
async function keepThumbs(id, blobs) { if (blobs.length) await idb.set(THUMB(id), await Promise.all(blobs.map(async (b) => ({ buf: await b.arrayBuffer(), type: 'image/jpeg' })))); }

/**
 * Files scanned: each read (`local` (a Map of id → File, just picked) or else `download(id)`), its faces found
 * (a video's at `stills` stills) and matched with `known` ([{ id, d }]; `accounts`: [{ id, handle, avatar }]).
 * Each file's small pictures are kept (thumbsOf). `onProgress({ i, n, name, still, stills })`. Resolves to
 * [{ f, faces, pics: [Blob], hits: [{ id, handle, avatar, distance, sure, crop (the face, a Blob) }], error }]
 * (in the files' order); `cancelled()` stops between files.
 */
export async function scanFiles(files, { download, local = null, known, not = [], accounts = [], stills = 12, onProgress = () => {}, cancelled = () => false }) {
  const { facesIn, matchFaces } = await import('../../apps/socials/socials-faces.js');
  const out = []; const rejects = await listRejects();
  for (const [i, f] of files.entries()) {
    if (cancelled()) break;
    onProgress({ i, n: files.length, name: f.name, still: 0, stills: isVideo(f) ? stills : 1 });
    const faces = []; let error = ''; let pics = [];
    try {
      const file = local?.get(f.id) ?? await download(f.id);
      let shots = [file];
      if (isVideo(f)) { const { videoFrames } = await import('../../apps/socials/socials-editor.js'); shots = await videoFrames(file, { n: stills, edge: 720, wait: 5000 }); }
      for (const [k, s] of shots.entries()) {
        onProgress({ i, n: files.length, name: f.name, still: k + 1, stills: shots.length });
        try { for (const x of await facesIn(s)) faces.push({ ...x, shot: s }); } catch { /* that still */ }
      }
      const pick = isVideo(f) ? [0.1, 0.4, 0.65, 0.9].map((q) => shots[Math.min(shots.length - 1, Math.floor(q * shots.length))]).filter((x, j, a) => x && a.indexOf(x) === j) : shots;
      try { pics = await Promise.all(pick.map((b) => shrink(b, isVideo(f) ? 200 : 360))); await keepThumbs(f.id, pics); } catch { pics = []; }
    } catch (e) { error = e.message; }
    const hits = []; const used = new Set();
    for (const h of matchFaces(faces, known, 0.5, { not })) {
      const face = faces[h.face]; used.add(h.face);
      if (rejects.some((x) => x.fileId === f.id && x.accountId === h.id)) continue; // (✕ Not them, said before)
      const a = accounts.find((x) => x.id === h.id);
      let crop = null; try { crop = await shrink(face.shot, 120, face.box); } catch { /* none */ }
      hits.push({ id: h.id, handle: a?.handle ?? '?', avatar: a?.avatar ?? null, distance: h.distance, sure: sureOf(h.distance), crop, d: face.d });
    }
    // (The faces that are none of your accounts, for Unknown people: each person once (a video shows them many
    // times), their biggest; small, far-off faces left out.)
    const unknown = [];
    for (const [k, face] of faces.entries()) {
      if (used.has(k) || face.size < 0.06 || matchFaces([face], known, 0.5).length) continue;
      const same = unknown.find((u) => near(u.d, face.d) < 0.4);
      if (same && same.size >= face.size) continue;
      let crop = null; try { crop = await shrink(face.shot, 256, face.box); } catch { /* none */ }
      const u = { d: face.d, size: face.size, crop }; if (same) Object.assign(same, u); else unknown.push(u);
    }
    out.push({ f, faces: faces.length, pics, hits, unknown, error });
  }
  try { await addStrangers(out); } catch { /* kept next time */ }
  return out;
}

/**
 * A file confirmed as an account: put on that account in Socials as a draft (its photo, or the video and a
 * still of it), marked as from Saved Files, waiting for you to look it over and share it there. Several people
 * in one file: the first confirmed has the draft, each one after is added to it as a collaborator (and
 * tagged), as a post with several people in it; asked when it's shared. Socials must be unlocked in this
 * session. `getFile()`: the file (only fetched when a new draft is made). Resolves to { draftId, owner (the
 * draft's account id), collab (true when added to one already there) }.
 */
export async function sendToSocials(accountId, f, getFile) {
  const S = await import('../../apps/socials/socials-store.js'); const C = await import('../../apps/socials/socials-core.js');
  const { state } = await S.loadState();
  if (!C.accountById(state, accountId)) throw new Error('That account isn\'t in Socials any more.');
  const had = state.posts.find((p) => p.draft && !p.trashed && p.fromSaved?.fileId === f.id);
  if (had) {
    if (had.by !== accountId) {
      C.setCollabs(state, had.id, [...(had.collab ?? []).filter((c) => c.status !== 'declined').map((c) => c.id), accountId]);
      had.tags = [...new Set([...(had.tags ?? []), accountId])]; had.upd = Date.now();
      await S.saveState(state);
    }
    return { draftId: had.id, owner: had.by, collab: had.by !== accountId };
  }
  const file = await getFile();
  let image = null; let video = null;
  if (isVideo(f)) { const { prepareVideo } = await import('../../apps/socials/socials-editor.js'); const v = await prepareVideo(file); video = v.video; image = v.still; }
  else image = await shrink(file, 1440).catch(() => file);
  const p = C.addPost(state, accountId, { image, video, draft: true });
  p.fromSaved = { fileId: f.id, name: f.name, at: Date.now() };
  await S.saveState(state);
  return { draftId: p.id, owner: accountId, collab: false };
}

/**
 * Files just saved, scanned at once (from the files picked, nothing downloaded): resolves to the results (as
 * scanFiles) or { locked: true } when Socials is locked (scan them later from 🔎), or [] with nothing to match.
 */
export async function autoScan(saved, local) {
  const todo = saved.filter(scannable); if (!todo.length) return [];
  let k; try { k = await knownAccounts(); } catch (e) { if (e.locked) return { locked: true, files: todo }; return []; }
  if (!k.known.length) return [];
  return scanFiles(todo, { local, download: () => { throw new Error('Not on this phone.'); }, known: k.known, not: k.not, accounts: k.accounts, stills: 8 });
}

/**
 * The scanner, as a dialog over Saved Files: `files` (the folder's), `download(id)`. Pick which, scan, then a
 * yes or no on each suggestion: a yes puts the file on that account in Socials as a draft (to look over and
 * share there) and marks it matched here. `results` (from autoScan): straight to the review. `onChange()`
 * after a yes; `onClose()` once it's closed (its files' new small pictures to show).
 */
export function openScanner(files, { download, results: preset = null, onChange = () => {}, onClose = () => {} }) {
  const list = files.filter(scannable);
  const picked = new Set(list.map((f) => f.id));
  const body = el('div', { class: 'sc-body' });
  const dlg = el('dialog', { class: 'ed-dialog sc-dialog', 'aria-label': 'Scan for characters' }, el('div', { class: 'sheet' },
    el('div', { class: 'row space' }, el('h2', { text: '🔎 Scan for characters' }), el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', text: '✕', onclick: () => dlg.close() })), body));
  let stop = false;
  const urls = []; const url = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  dlg.addEventListener('close', () => { stop = true; dlg.remove(); for (const u of urls) URL.revokeObjectURL(u); onClose(); });

  function choose() {
    if (!list.length) { fill(body, el('p', { class: 'muted', text: 'No photos or videos in this folder to scan.' })); return; }
    const count = el('span', {});
    const go = el('button', { type: 'button', class: 'btn primary block', onclick: run }, 'Scan ', count);
    const paint = () => { count.textContent = `${picked.size} file${picked.size === 1 ? '' : 's'}`; go.disabled = !picked.size; };
    fill(body,
      el('p', { class: 'small muted', text: 'Each file is downloaded and read on this phone: a photo once, a video at 12 stills from all through it. Faces are compared with your Socials accounts\' profile photos and posts, and who they might be is suggested for you to confirm.' }),
      el('div', { class: 'row wrap' }, el('button', { type: 'button', class: 'btn small-btn ghost', text: 'All', onclick: () => { list.forEach((f) => picked.add(f.id)); choose(); } }), el('button', { type: 'button', class: 'btn small-btn ghost', text: 'None', onclick: () => { picked.clear(); choose(); } })),
      el('ul', { class: 'sc-pick' }, list.map((f) => { const c = el('input', { type: 'checkbox', checked: picked.has(f.id) }); c.addEventListener('change', () => { if (c.checked) picked.add(f.id); else picked.delete(f.id); paint(); }); return el('li', {}, el('label', {}, c, ` ${isVideo(f) ? '🎬' : '🖼️'} ${f.name}`)); })),
      go);
    paint();
  }

  // (Socials locked: its password, here, once a session.)
  function unlock(then) {
    const pw = el('input', { type: 'password', class: 'sc-pw', autocomplete: 'current-password', 'aria-label': 'Socials password' });
    const err = el('p', { class: 'small bad-text', role: 'alert' });
    const ok = el('button', { type: 'submit', class: 'btn primary', text: 'Unlock' });
    const form = el('form', { class: 'sc-unlock' }, el('p', { class: 'small', text: 'Socials\' accounts are encrypted on this phone: enter the Socials password to compare faces with them (until the app is closed).' }), pw, ok, err);
    form.addEventListener('submit', async (e) => { e.preventDefault(); ok.disabled = true; err.textContent = ''; const good = await unlockSocials(pw.value).catch(() => false); ok.disabled = false; if (good) then(); else err.textContent = 'That password doesn\'t unlock Socials.'; });
    fill(body, form); pw.focus();
  }

  async function run() {
    const todo = list.filter((f) => picked.has(f.id));
    const status = el('p', { class: 'small', 'aria-live': 'polite', text: 'Getting your Socials accounts\' faces…' });
    const bar = el('div', { class: 'so-upbar-track', role: 'progressbar', 'aria-label': 'Scan progress', 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('span', { class: 'so-upbar-fill' }));
    const cancel = el('button', { type: 'button', class: 'btn', text: 'Stop', onclick: () => { stop = true; cancel.disabled = true; status.textContent = 'Stopping after this file…'; } });
    fill(body, status, bar, cancel);
    let k;
    try { k = await knownAccounts(); } catch (e) { if (e.locked) { unlock(run); return; } fill(body, el('p', { class: 'bad-text', text: `Couldn't read Socials: ${e.message}` })); return; }
    if (!k.known.length) { fill(body, el('p', { class: 'muted', text: 'None of your Socials accounts has a profile photo with a face yet: add some there, then scan.' })); return; }
    const results = await scanFiles(todo, { download, known: k.known, not: k.not, accounts: k.accounts, cancelled: () => stop, onProgress: ({ i, n, name, still, stills }) => {
      const q = (i + (stills ? still / stills : 0)) / n; bar.firstChild.style.width = `${Math.max(3, Math.round(q * 100))}%`; bar.setAttribute('aria-valuenow', String(Math.round(q * 100)));
      status.textContent = `${i + 1} of ${n}: ${name}${stills > 1 ? ` (still ${still} of ${stills})` : ''}`;
    } });
    if (!dlg.isConnected) return;
    review(results);
  }

  async function review(results) {
    const kept = await listMatches(); const keptOf = (fid, aid) => kept.find((m) => m.fileId === fid && m.accountId === aid);
    const withHits = results.filter((r) => r.hits.length); const faceless = results.filter((r) => !r.faces && !r.error).length; const unknown = results.filter((r) => r.faces && !r.hits.length).length;
    const errors = results.filter((r) => r.error);
    const preview = (r) => (r.pics.length ? el('div', { class: `sc-preview${isVideo(r.f) ? ' sc-stills' : ''}`, 'aria-label': isVideo(r.f) ? `Stills from ${r.f.name}` : `${r.f.name}`, role: 'img' }, r.pics.map((b) => el('img', { src: url(b), alt: '' }))) : null);
    fill(body,
      el('p', { class: 'small', text: `Scanned ${results.length} file${results.length === 1 ? '' : 's'}: ${withHits.length} with someone who might be one of your accounts${unknown ? `, ${unknown} with faces not recognized` : ''}${faceless ? `, ${faceless} with no faces found` : ''}.` }),
      errors.length ? el('p', { class: 'small bad-text', text: `Couldn't read ${errors.length}: ${errors.map((r) => r.f.name).join(', ')}` }) : null,
      results.some((r) => r.unknown?.length) ? el('p', { class: 'small' }, `👥 ${results.reduce((t, r) => t + (r.unknown?.length ?? 0), 0)} face${results.reduce((t, r) => t + (r.unknown?.length ?? 0), 0) === 1 ? '' : 's'} not one of your accounts: grouped by person in `, el('button', { type: 'button', class: 'so-link sc-link', text: 'Unknown people', onclick: () => { dlg.close(); openMatches({ download, tab: 'unknown' }); } }), ', to make into accounts.') : null,
      withHits.length ? el('ul', { class: 'sc-results' }, withHits.map((r) => el('li', { class: 'sc-file' },
        el('strong', { class: 'sc-name', text: `${isVideo(r.f) ? '🎬' : '🖼️'} ${r.f.name}` }),
        preview(r),
        el('ul', { class: 'sc-hits' }, r.hits.map((h) => {
          const was = keptOf(r.f.id, h.id);
          const note = el('span', { class: 'small sc-note', 'aria-live': 'polite', text: was ? `✓ Matched${was.draftId ? ' · a draft on Socials' : ''}` : '' });
          const row = el('li', { class: 'sc-hit' },
            el('span', { class: 'sc-pair' },
              h.crop ? el('img', { class: 'sc-face', src: url(h.crop), alt: `The face in ${r.f.name}` }) : el('span', { class: 'sc-face sc-noface', 'aria-hidden': 'true', text: '🙂' }),
              el('span', { class: 'sc-vs', 'aria-hidden': 'true', text: '↔' }),
              h.avatar ? el('img', { class: 'sc-av', src: url(h.avatar), alt: `@${h.handle}'s profile photo` }) : el('span', { class: 'sc-av sc-noface', 'aria-hidden': 'true', text: '👤' })),
            el('span', { class: 'sc-who' }, el('strong', { text: `@${h.handle}` }), el('span', { class: 'small muted', text: ` ${h.sure}% likely` }), note));
          const yes = el('button', { type: 'button', class: 'btn small-btn primary', text: '✓ It\'s them', hidden: !!was, 'aria-label': `It's @${h.handle} in ${r.f.name}`, onclick: async () => {
            yes.disabled = true; no.disabled = true; note.textContent = `Putting it in @${h.handle}'s drafts…`;
            try {
              const d = await sendToSocials(h.id, r.f, () => download(r.f.id));
              learn(h.id, h.d).catch(() => false); // (more of their faces: matched better next time)
              await keepMatch({ fileId: r.f.id, name: r.f.name, accountId: h.id, handle: h.handle, sure: h.sure, draftId: d.draftId });
              const ownerHandle = r.hits.find((x) => x.id === d.owner)?.handle;
              note.textContent = d.collab ? `✓ Matched · added as a collaborator on ${ownerHandle ? `@${ownerHandle}'s` : 'the'} draft (it's one post with them both)` : `✓ Matched · a draft on @${h.handle}, waiting for your OK in Socials`;
              yes.hidden = true; no.hidden = true; onChange();
            } catch (e) { note.textContent = e.message === 'Socials is locked.' ? 'Socials is locked: open it (or scan again) to unlock.' : `Couldn't: ${e.message}`; yes.disabled = false; no.disabled = false; }
          } });
          const no = el('button', { type: 'button', class: 'btn small-btn ghost', text: '✕ Not them', 'aria-label': `Not @${h.handle} in ${r.f.name}`, hidden: !!was, onclick: () => { row.classList.add('sc-no'); yes.hidden = true; no.hidden = true; note.textContent = 'Not them (not suggested again)'; rejectMatch(r.f.id, h.id, h.d).catch(() => {}); } });
          row.append(el('span', { class: 'row sc-yesno' }, yes, no)); return row;
        }))))) : null,
      el('p', { class: 'small muted', text: 'Only suggestions until you say so. "It\'s them" puts the file on that account in Socials as a draft (nothing is shared until you share it there) and marks it matched here. Several people in one file: say yes to each; the first has the draft and the others are added to it as collaborators. The matches are in ⚙ Character matches.' }),
      el('button', { type: 'button', class: 'btn block', text: 'Done', onclick: () => dlg.close() }));
  }

  document.body.append(dlg); dlg.showModal();
  if (preset) review(preset); else choose();
}

/**
 * Character matches, as a page (in a dialog): Matches (the files you said were your Socials accounts, by account,
 * each removable) and Unknown people (faces that are none of your accounts, grouped by person: make one a Socials
 * account, or set it aside). `download(id)`: a file (to put a new account's files in its drafts); `tab`. Resolves
 * once it's closed.
 */
export async function openMatches({ download = null, tab = 'matches' } = {}) {
  const body = el('div', { class: 'sc-body' });
  const tabs = el('div', { class: 'row sc-tabs', role: 'tablist' });
  const dlg = el('dialog', { class: 'ed-dialog sc-dialog', 'aria-label': 'Character matches' }, el('div', { class: 'sheet' },
    el('div', { class: 'row space' }, el('h2', { text: '🧑‍🤝‍🧑 Character matches' }), el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', text: '✕', onclick: () => dlg.close() })), tabs, body));
  const urls = []; const url = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  const closed = new Promise((ok) => dlg.addEventListener('close', () => { dlg.remove(); for (const u of urls) URL.revokeObjectURL(u); ok(); }));
  let showHidden = false;
  const paintTabs = async () => {
    const n = (await listStrangers()).filter((g) => !g.hidden).length;
    fill(tabs, [['matches', 'Matches'], ['unknown', `👥 Unknown people${n ? ` · ${n}` : ''}`]].map(([id, label]) => el('button', { type: 'button', role: 'tab', class: `btn small-btn sv-chip${tab === id ? ' on' : ''}`, 'aria-selected': String(tab === id), text: label, onclick: () => { tab = id; draw(); } })));
  };
  async function matchesTab() {
    const list = await listMatches();
    const by = new Map(); for (const m of list) { if (!by.has(m.handle)) by.set(m.handle, []); by.get(m.handle).push(m); }
    fill(body,
      el('p', { class: 'small muted', text: 'Files you confirmed after a scan (🔎 Scan for characters), by account: each was put on that account in Socials as a draft. Kept on this phone. Removing one here only takes off the 👤 mark (the draft stays in Socials).' }),
      list.length ? [...by].map(([handle, ms]) => el('section', { class: 'sc-acc' }, el('h3', { text: `@${handle} · ${ms.length}` }),
        el('ul', { class: 'sc-matches' }, ms.map((m) => el('li', {}, el('span', { class: 'sc-mname', text: m.name }), el('span', { class: 'small muted', text: ` ${m.sure}% · ${new Date(m.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}` }),
          el('button', { type: 'button', class: 'btn small-btn ghost', text: 'Remove', 'aria-label': `Remove ${m.name} as @${handle}`, onclick: async () => { await dropMatch(m.fileId, m.accountId); draw(); } })))))) : el('p', { class: 'muted', text: 'No matches kept yet.' }));
  }
  function makeForm(g, row) {
    const handle = el('input', { type: 'text', class: 'sc-in', 'aria-label': 'Username', placeholder: 'username', autocapitalize: 'none', autocomplete: 'off' });
    const name = el('input', { type: 'text', class: 'sc-in', 'aria-label': 'Name', placeholder: 'Name (optional)' });
    const kind = el('select', { class: 'sc-in', 'aria-label': 'Kind of account' }, el('option', { value: 'friend', text: 'Friend' }), el('option', { value: 'celebrity', text: 'Celebrity' }));
    const drafts = el('input', { type: 'checkbox', checked: false }); const err = el('p', { class: 'small bad-text', role: 'alert' });
    const go = el('button', { type: 'submit', class: 'btn primary', text: 'Make the account' });
    const files = [...new Set(g.faces.map((f) => f.fileId))].length;
    const form = el('form', { class: 'sc-make' }, handle, name, kind,
      download ? el('label', { class: 'small' }, drafts, ` Also put ${files === 1 ? 'the file' : `the ${files} files`} in its drafts (waiting for your OK)`) : null, el('div', { class: 'row' }, go, el('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onclick: () => form.remove() })), err);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = ''; go.disabled = true;
      try {
        const made = await strangerToAccount(g.id, { handle: handle.value, name: name.value.trim(), kind: kind.value });
        let n = 0;
        if (drafts.checked && download) for (const f of made.files) { go.textContent = `Drafts… ${n + 1} of ${made.files.length}`; try { const d = await sendToSocials(made.id, f, () => download(f.id)); await keepMatch({ fileId: f.id, name: f.name, accountId: made.id, handle: made.handle, sure: 100, draftId: d.draftId }); n++; } catch { /* that one */ } }
        tab = 'unknown'; await draw(`@${made.handle} is a Socials account now, with this face as its profile photo; ${made.files.length} file${made.files.length === 1 ? '' : 's'} matched to it${n ? `, ${n} in its drafts` : ''}.`);
      } catch (x) { err.textContent = x.message === 'Socials is locked.' ? 'Socials is locked: scan once (it asks for the password), or open Socials, then try again.' : x.message; go.disabled = false; go.textContent = 'Make the account'; }
    });
    row.append(form); handle.focus();
  }
  async function unknownTab(msg = '') {
    const all = await listStrangers(); const shown = all.filter((g) => showHidden || !g.hidden);
    const hiddenN = all.filter((g) => g.hidden).length;
    fill(body,
      msg ? el('p', { class: 'small', role: 'status', text: msg }) : null,
      el('p', { class: 'small muted', text: 'Faces found by scans that are none of your Socials accounts, grouped by person (the most files first). Make one an account: its clearest face becomes the profile photo, its files are matched to it, and later scans know it.' }),
      shown.length ? el('ul', { class: 'sc-strangers' }, shown.map((g) => {
        const b = bestFace(g); const files = [...new Map(g.faces.map((f) => [f.fileId, f.name])).values()];
        const row = el('li', { class: `sc-stranger${g.hidden ? ' sc-hidden' : ''}` },
          el('div', { class: 'row sc-stranger-head' },
            b?.crop ? el('img', { class: 'sc-face sc-face-big', src: url(new Blob([b.crop.buf], { type: b.crop.type })), alt: `Unknown person in ${files.length} file${files.length === 1 ? '' : 's'}` }) : el('span', { class: 'sc-face sc-face-big sc-noface', text: '🙂' }),
            el('span', { class: 'sc-who' }, el('strong', { text: `In ${files.length} file${files.length === 1 ? '' : 's'}` }), el('span', { class: 'small muted', text: files.slice(0, 3).join(', ') + (files.length > 3 ? ` +${files.length - 3}` : '') }),
              g.faces.length > 1 ? el('span', { class: 'sc-more', 'aria-hidden': 'true' }, g.faces.filter((f) => f !== b && f.crop).slice(0, 5).map((f) => el('img', { src: url(new Blob([f.crop.buf], { type: f.crop.type })), alt: '' }))) : null)),
          el('div', { class: 'row wrap' },
            g.hidden ? el('button', { type: 'button', class: 'btn small-btn', text: 'Bring back', onclick: async () => { await hideStranger(g.id, false); draw(); } })
              : [el('button', { type: 'button', class: 'btn small-btn primary', text: '＋ Make a Socials account', 'aria-label': `Make a Socials account of the person in ${files.length} file${files.length === 1 ? '' : 's'}`, onclick: (e) => { e.currentTarget.disabled = true; makeForm(g, row); } }),
                el('button', { type: 'button', class: 'btn small-btn ghost', text: 'Not someone', 'aria-label': `Not someone: set aside the person in ${files.length} file${files.length === 1 ? '' : 's'}`, onclick: async () => { await hideStranger(g.id, true); draw(); } })]));
        return row;
      })) : el('p', { class: 'muted', text: all.length ? 'None to show.' : 'No unknown faces yet: they\'re gathered as you scan.' }),
      hiddenN ? el('button', { type: 'button', class: 'so-link sc-link', text: showHidden ? 'Hide the ones set aside' : `Show the ${hiddenN} set aside`, onclick: () => { showHidden = !showHidden; draw(); } }) : null);
  }
  async function draw(msg = '') { await paintTabs(); if (tab === 'unknown') await unknownTab(msg); else await matchesTab(); }
  document.body.append(dlg); dlg.showModal(); await draw(); return closed;
}
