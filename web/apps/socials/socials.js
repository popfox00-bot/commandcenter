// Socials: a photo-sharing app laid out like the familiar ones (a feed of photo and video posts, a row of
// accounts across the top, a tab bar at the bottom: Home, Search, New post, Reels, Profile; ✈ for messages),
// where everything is yours and made here. Make accounts (the first is the Owner, listed first), switch
// between them, post photos (fitted, filtered and adjusted in the photo editor: socials-editor.js) and videos
// (with their sound) from any of them, follow one from another, like, comment and message; Home shows the
// posts of the accounts the one you're using follows, Reels everyone's videos. All of it is kept on this phone
// (IndexedDB, photos and videos included) and stays after a reload.
// Behind its own password (as the hidden area is: only a salted hash kept), asked each time the app starts.
// With Saved Files set up, it's also kept in your own Google Drive, encrypted with that password on the
// phone first, so your other devices open the same Socials with the same password (socials-sync.js).

import { el, fill, store } from '../../lib/dom.js';
import { loadState, saveState } from './socials-store.js';
import { makeLock } from '../../lib/hidden-lock.js';
import { connected } from '../../lib/saved-files.js';
import { passkeysSupported, deviceCanPasskey, hasPasskey, createPasskey, usePasskey, removePasskey, passkeyOf } from '../../lib/passkey.js';
import { syncSocials, remoteHeader, opens, changeRemotePassword, isRecoveryKey, WrongPassword, pendingFiles } from './socials-sync.js';
import { sniffType, decodeImage, fitSize, canvasToBlob } from '../../lib/image.js';
import { editPhoto, prepareVideo } from './socials-editor.js';
import {
  emptyState, normalize, addAccount, editAccount, removeAccount, accountById, toggleFollow, isFollowing,
  followersOf, followingOf, postsBy, addPost, removePost, postById, feedFor, toggleLike, addComment,
  searchAccounts, timeAgo, countLabel, handleProblem, mergeStates, accountsInOrder, setOwner, editPost,
  reelsOf, sendMessage, conversation, conversationsOf, markRead, unreadCount, taggedIn, captionParts, mediaOf, shuffled,
  toggleSave, isSaved, savedOf, addView, viewsOf, rankPosts, collabsOf, setCollabs, answerCollab, leaveCollab, MAX_COLLAB, live, draftsOf, togglePin, trashPost, restorePost, trashOf, emptyOldTrash, storiesOf, autoComment, postsWithTag, searchTags, hashtagsIn, switcherOrder, TRASH_DAYS,
} from './socials-core.js';
import { generateComment, generateReply } from './socials-predict.js';
import { createZip } from '../../lib/zip.js';
import { downloadBlob, shareFiles, canShareFiles } from '../../lib/files.js';
import { handoff } from '../../lib/handoff.js';

// (What's waiting for Drive, kept on the phone so a refresh or closing the app doesn't lose track of it:
// which photos and videos Drive had at the last sync, and whether anything changed since.)
const DRIVE_KEY = 'cc.socials.drive';
const DIRTY_KEY = 'cc.socials.dirty';
export const socialsLock = makeLock('cc.socials.lock', 'cc.socials.open');
// The password, once entered, for as long as the app is open (it opens the copy in Drive): forgotten on a
// reload or when the app is closed, so it's asked again then.
let sessionPw = null;
// (Open while the app is: by the password, or by Face ID (a passkey). With Face ID alone on a passkey that can't
// keep the password, `sessionPw` stays null: Socials is open, and the password is asked for only to sync.)
let sessionOpen = false;
// (Reels' sound: off until it's turned on once, then on for each reel while the app is open.)
let reelSound = false;
// (Reels' order: shuffled once when the app opens, again on a pull down at the top; a video just posted first.)
let reelOrder = null;
/** Most photos and videos in one post. */
const MAX_ITEMS = 10;
// (Stories each account has seen, on this device: { viewerId: { postId: when } }.)
const SEEN_KEY = 'cc.socials.seen';
// (Comments made for each new post, from three other accounts: on unless the Owner turns them off.)
const AUTO_KEY = 'cc.socials.autocomment';
const autoOn = () => store.get(AUTO_KEY) !== '0';
// (This device, for counting views: each device counts its own, the counts added up.)
const DEVICE_KEY = 'cc.socials.device';
const deviceId = () => { let d = store.get(DEVICE_KEY); if (!d) { d = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; store.set(DEVICE_KEY, d); } return d; };
// (Views counted this session, by account and post: a post seen again by the same account isn't counted twice.)
const viewedNow = new Set();
// (Home's order: ranked once per account while the app's open (popular and new likelier first), new posts first.)
const feedOrder = new Map();
/** Videos bigger than this aren't taken (a phone's storage; and only up to 24 MB go to Drive). */
const MAX_VIDEO = 300 * 1024 * 1024;

export function mount(host) {
  let state = emptyState();
  let view = { name: 'feed' };
  let alive = true;
  const urls = new Map(); // Blob → object URL, made once each.
  const urlOf = (b) => { if (!b) return null; let u = urls.get(b); if (!u) { u = URL.createObjectURL(b); urls.set(b, u); } return u; };
  let edits = 0;
  const save = () => { saveState(state); edits++; store.set(DIRTY_KEY, '1'); soon(); };
  /** How many files are waiting to be saved to Drive (Saved Files). */
  const pending = () => (connected() ? pendingFiles(state, store.json(DRIVE_KEY, null)?.media ?? [], store.get(DIRTY_KEY) === '1') : 0);
  // ---- Sync with Drive: after each change (a few seconds later), when the app opens, when back online.
  const sync = { busy: false, again: false, msg: '', ok: null, wrong: false, timer: 0 };
  const soon = () => { clearTimeout(sync.timer); sync.timer = setTimeout(runSync, 3000); };
  async function runSync() {
    clearTimeout(sync.timer);
    const api = connected(); if (!api || !sessionPw || !alive) { sync.msg = !api ? 'Not set up' : sessionOpen && !sessionPw ? 'Opened with Face ID: enter your password below to sync on this device' : ''; drawStatus(); return; }
    if (sync.busy) { sync.again = true; return; }
    // (Offline: nothing tried; it's saved when the connection's back.)
    if (navigator.onLine === false) { sync.ok = false; sync.wrong = false; sync.msg = 'Offline: saved to Saved Files when back online'; drawStatus(); return; }
    sync.busy = true; sync.msg = 'Syncing…'; sync.ok = null; drawStatus();
    const editsAt = edits;
    try {
      const r = await syncSocials(api, state, sessionPw);
      if (!alive) return;
      store.set(DRIVE_KEY, JSON.stringify({ media: r.driveMedia, at: Date.now() }));
      if (edits === editsAt) store.set(DIRTY_KEY, '');
      // (Anything changed here while it ran is kept: merged again over what came back.)
      state = mergeStates(state, r.state);
      // (Photos and videos fetched from Drive (one this device had lost, too) put in, by their ids.)
      const got = new Map(); const each = (st, fn) => { for (const a of st.accounts) fn(a, 'avatar', 'avatarId'); for (const p of st.posts) for (const o of [p, ...(p.more ?? [])]) { fn(o, 'image', 'imageId'); fn(o, 'video', 'videoId'); } };
      each(r.state, (o, k, idk) => { if (o[k] && o[idk]) got.set(o[idk], o[k]); });
      each(state, (o, k, idk) => { if (!o[k] && o[idk] && got.has(o[idk])) o[k] = got.get(o[idk]); });
      await saveState(state);
      sync.ok = true; sync.wrong = false; sync.msg = `Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      if (r.recoveryKey) sync.pendingKey = r.recoveryKey;
      // (Shown again only where nothing's being typed or picked: a post being made, a comment, a form stay as they are.)
      if (['feed', 'profile', 'people', 'inbox'].includes(view.name) || (sync.pendingKey && ['settings', 'explore'].includes(view.name))) draw(); else { drawStatus(); drawBars(); }
    } catch (e) {
      sync.ok = false; sync.wrong = e instanceof WrongPassword;
      sync.msg = sync.wrong ? 'The copy in your Drive has a different password' : navigator.onLine === false ? 'Offline: syncs when back online' : `Couldn't sync: ${e.message}`;
    } finally { sync.busy = false; drawStatus(); if (sync.again) { sync.again = false; soon(); } }
  }
  const onOnline = () => { drawStatus(); soon(); };
  const onOffline = () => { if (!sync.busy) { sync.ok = false; sync.msg = 'Offline: saved to Saved Files when back online'; } drawStatus(); };
  globalThis.addEventListener?.('offline', onOffline);
  globalThis.addEventListener?.('online', onOnline);
  const statusEl = el('button', { type: 'button', class: 'so-cloud', 'aria-label': 'Sync and password', onclick: () => go({ name: 'settings' }) });
  function drawStatus() {
    const api = !!connected();
    const n = pending(); const off = navigator.onLine === false;
    // (⏳ with how many are waiting, while there are: offline, or not saved yet.)
    fill(statusEl, !api ? '⚙' : sync.busy ? '⟳' : n && (off || sync.ok === false) ? '⏳' : sync.ok === false ? '⚠' : '☁', n && api && !sync.busy ? el('span', { class: 'so-badge so-wait-badge', 'aria-hidden': 'true', text: n > 99 ? '99+' : String(n) }) : null);
    statusEl.setAttribute('aria-label', n && api ? `Sync and password: ${n} file${n === 1 ? '' : 's'} waiting to be saved` : 'Sync and password');
    statusEl.title = sync.msg || 'Sync and password';
    if (view.name === 'settings') { const m = main.querySelector('.so-sync-msg'); if (m) m.textContent = syncLine(); const w = main.querySelector('.so-waiting'); if (w) w.replaceWith(waiting()); }
  }
  /** (The Owner's view of what's waiting for Saved Files: how many, and when they'll go.) */
  function waiting() {
    if (!connected() || !me()?.owner) return el('div', { class: 'so-waiting', hidden: true });
    const n = pending(); const off = navigator.onLine === false;
    if (!n) return el('div', { class: 'so-waiting so-waiting-done', role: 'status' }, el('span', { 'aria-hidden': 'true', text: '✓ ' }), 'Everything is saved to Saved Files.');
    return el('div', { class: 'so-waiting', role: 'status' },
      el('strong', { text: `⏳ ${n} file${n === 1 ? '' : 's'} waiting to be saved to Saved Files` }),
      el('span', { class: 'small', text: off ? 'You\'re offline. They\'ll be saved as soon as you\'re back online with Socials open. Refreshing or closing the app doesn\'t lose them: they\'re kept on this device, and saved the next time Socials is opened online.' : 'They\'ll be saved in a moment (or tap Sync now). Refreshing or closing the app first doesn\'t lose them: they\'re kept on this device, and saved the next time Socials is opened online.' }));
  }
  const syncLine = () => (!connected() ? 'Not syncing: Saved Files isn\'t set up on this device.' : sync.msg || 'Ready to sync.');
  const me = () => accountById(state, state.me);

  const main = el('div', { class: 'so-main' });
  const top = el('header', { class: 'so-top' });
  const tabs = el('nav', { class: 'so-tabs', 'aria-label': 'Socials' });
  const root = el('div', { class: 'so' }, top, main, tabs);
  host.append(root);

  const go = (v) => { view = v; draw(); try { window.scrollTo(0, 0); } catch { /* jsdom */ } };
  const avatar = (a, size = 'm') => {
    const u = urlOf(a?.avatar);
    return u ? el('img', { class: `so-av so-av-${size}`, src: u, alt: '' })
      : el('span', { class: `so-av so-av-${size} so-av-none`, 'aria-hidden': 'true', text: (a?.handle ?? '?').slice(0, 1).toUpperCase() });
  };
  const handleBtn = (a, cls = 'so-handle') => el('button', { type: 'button', class: cls, text: a.handle, onclick: (e) => { e.stopPropagation(); go({ name: 'profile', id: a.id }); } });

  // ---- The top bar and the tab bar.
  function drawBars() {
    const m = me();
    fill(top,
      el('span', { class: 'so-logo', text: 'Socials' }),
      m && el('span', { class: 'so-top-right' }, statusEl, dmButton(m), el('button', { type: 'button', class: 'so-switch', 'aria-label': `Using @${m.handle}: switch account`, onclick: () => go({ name: 'accounts' }) }, avatar(m, 's'), el('span', { text: m.handle }), el('span', { 'aria-hidden': 'true', text: ' ▾' }))));
    drawStatus();
    const tab = (name, label, icon, v) => el('button', { type: 'button', class: `so-tab${view.name === name && (name !== 'profile' || view.id === state.me) ? ' active' : ''}`, 'aria-label': label, onclick: () => go(v) }, icon);
    fill(tabs, m && [
      tab('feed', 'Home', '⌂', { name: 'feed' }),
      tab('explore', 'Search', '⌕', { name: 'explore' }),
      tab('new', 'New post', '⊕', { name: 'new' }),
      tab('reels', 'Reels', '▶︎', { name: 'reels' }),
      tab('profile', 'Profile', avatar(m, 's'), { name: 'profile', id: state.me }),
    ]);
  }
  // (✈ Messages, with how many are unread for the account in use.)
  function dmButton(m) {
    const n = unreadCount(state, m.id);
    return el('button', { type: 'button', class: 'so-dm', 'aria-label': n ? `Messages, ${n} unread` : 'Messages', onclick: () => go({ name: 'inbox' }) }, '✈', n ? el('span', { class: 'so-badge', 'aria-hidden': 'true', text: n > 9 ? '9+' : String(n) }) : null);
  }

  /** A post's photo or video, as the feed shows it. */
  function media(p, by, like) {
    const items = mediaOf(p);
    if (items.length < 2) return slide(items[0], p, by, like);
    // (Several: side by side, swiped through one at a time, with dots and "2/3" saying which.)
    const track = el('div', { class: 'so-carousel', role: 'group', 'aria-roledescription': 'carousel', 'aria-label': `${items.length} photos and videos` }, items.map((it, i) => el('div', { class: 'so-slide', 'aria-label': `${i + 1} of ${items.length}` }, slide(it, p, by, like))));
    const dots = el('div', { class: 'so-dots', 'aria-hidden': 'true' }, items.map((_, i) => el('span', { class: `so-dot-i${i ? '' : ' on'}` })));
    const count = el('span', { class: 'so-count', text: `1/${items.length}` });
    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      count.textContent = `${i + 1}/${items.length}`; [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
      for (const v of track.querySelectorAll('video')) if (!v.paused && v.closest('.so-slide') !== track.children[i]) v.pause();
    }, { passive: true });
    return el('div', { class: 'so-multi' }, track, count, dots);
  }

  /** One photo or video of a post. */
  function slide(it, p, by, like) {
    if (it.kind === 'video') {
      if (!it.video) return el('div', { class: 'so-pic so-novideo' }, it.image ? el('img', { src: urlOf(it.image), alt: '' }) : null, el('span', { text: 'This video is on the device it was posted from (too big to sync).' }));
      return el('div', { class: 'so-pic so-vid' }, el('video', { src: urlOf(it.video), poster: urlOf(it.image) ?? undefined, controls: true, playsinline: true, preload: 'metadata', 'aria-label': `Video by ${by.handle}` }));
    }
    // (A photo whose file couldn't be read on this device: said so, not a broken picture. With Saved Files, the
    // copy in Drive brings it back at the next sync.)
    if (!it.image) return it.imageId ? lostPhoto() : null;
    let lastTap = 0;
    const box = el('div', { class: 'so-pic', ondblclick: () => like(), onpointerup: () => { const t = Date.now(); if (t - lastTap < 300) like(); lastTap = t; } }, el('img', { src: urlOf(it.image), alt: p.caption ? `Photo: ${p.caption.slice(0, 80)}` : `Photo by ${by.handle}`, onerror: () => box.replaceWith(lostPhoto()) }));
    return box;
  }

  // ---- Tags, @mentions, sharing and Open in.
  /** The accounts tagged in a post, as links: "with @a and @b". */
  function tagLine(p) {
    const tags = (p.tags ?? []).map((t) => accountById(state, t)).filter(Boolean);
    if (!tags.length) return null;
    const parts = []; tags.forEach((a, i) => { if (i) parts.push(i === tags.length - 1 ? ' and ' : ', '); parts.push(handleBtn(a, 'so-handle so-tag')); });
    return el('p', { class: 'so-tags' }, el('span', { 'aria-hidden': 'true', text: '👤 ' }), 'with ', ...parts);
  }
  /** A caption's @mentions of your accounts as links to them. */
  const captionNodes = (text) => captionParts(state, text).map((x) => (x.account ? handleBtn(x.account, 'so-handle so-mention') : x.tag ? el('button', { type: 'button', class: 'so-hashtag', text: x.text, onclick: (e) => { e.stopPropagation(); go({ name: 'tag', tag: x.tag }); } }) : x.text));

  /** A small note that fades (sent, opened). */
  function toast(text) {
    const t = el('div', { class: 'so-toast', role: 'status', text }); document.body.append(t); setTimeout(() => t.remove(), 2200);
  }

  /** Share a post in a message, as the account in use, to one of the others. */
  async function share(p) {
    const others = accountsInOrder(state).filter((a) => a.id !== state.me);
    if (!others.length) { toast('Make another account to share with (Accounts → Add account).'); return; }
    const to = await sheet('Send to', others.map((a) => [a.id, `@${a.handle}${a.owner ? ' (Owner)' : ''}`]));
    if (!to) return;
    if (sendMessage(state, state.me, to, '', { post: p.id })) { save(); drawBars(); toast(`Sent to @${accountById(state, to).handle}`); }
  }

  /** The ⋯ of a post: Edit and Delete for your own; on the Owner account, Open in… (another app) for any photo. */
  function postMenu(p, by) {
    const mine = p.by === state.me; const owner = !!me()?.owner; const canOpen = owner && p.kind === 'photo' && !!p.image;
    const inCollab = !mine && collabsOf(p).includes(state.me);
    if (!mine && !canOpen && !inCollab) return null;
    return el('button', { type: 'button', class: 'so-more', 'aria-label': 'Post options', text: '⋯', onclick: async () => {
      const c = await sheet('Post options', [...(canOpen ? [['open', 'Open in…']] : []), ...(inCollab ? [['leave', 'Remove me from this collab', true]] : []), ...(mine ? [['pin', p.pinned ? 'Unpin from profile' : 'Pin to profile'], ['edit', 'Edit'], ['delete', 'Delete', true]] : [])]);
      if (c === 'edit') go({ name: 'editpost', id: p.id });
      if (c === 'pin') { try { const on = togglePin(state, p.id); save(); toast(on ? 'Pinned to the top of your profile' : 'Unpinned'); draw(); } catch (e) { toast(e.message); } }
      // (Deleted to Recently deleted: it can be brought back for a week.)
      if (c === 'delete') { trashPost(state, p.id); save(); toast(`Deleted: in Recently deleted for ${TRASH_DAYS} days`); if (view.name === 'post') go({ name: 'profile', id: by.id }); else draw(); }
      if (c === 'open') openIn(p, by);
      if (c === 'leave' && confirm('Take this post off your profile? It stays on theirs.')) { leaveCollab(state, p.id, state.me); save(); toast('Removed from your profile'); draw(); }
    } });
  }

  /**
   * Open a post's photo in another app (the Owner's): Photo Editor, FM, or Fashion (as the person to dress or
   * as the clothes). It's handed over as a copy: what's done there stays there (or in Saved Files).
   */
  async function openIn(p, by) {
    const app = await sheet('Open in', [['photo', '🖼️ Photo Editor'], ['fm', '🎭 FM'], ['fashion', '👕 Fashion']]);
    if (!app) return;
    let to = app; let hash = app === 'photo' ? '#/files/photo' : app === 'fm' ? '#/fm' : '#/fashion';
    if (app === 'fashion') {
      const role = await sheet('Open in Fashion as', [['base', 'The base (the person to dress)'], ['piece', 'The piece (what to put on)']]);
      if (!role) return; to = `fashion:${role}`; hash = '#/fashion';
    }
    const ext = p.image.type === 'image/png' ? 'png' : 'jpg';
    handoff.put(to, new File([p.image], `${by.handle}-${p.id}.${ext}`, { type: p.image.type || 'image/jpeg' }));
    location.hash = hash;
  }

  /** People to tag: a chip for each account (but the one posting), on or off. */
  // (When each account was last switched to, on this device: the account list puts the latest first.)
  const USED_KEY = 'cc.socials.used';
  const usedTimes = () => { try { return JSON.parse(localStorage.getItem(USED_KEY)) ?? {}; } catch { return {}; } };
  /** Switch to account `id` (and remember when, for the account list's order). */
  function useAccount(id) {
    state.me = id;
    try { const u = usedTimes(); u[id] = Date.now(); localStorage.setItem(USED_KEY, JSON.stringify(u)); } catch { /* private mode */ }
  }
  const byHandle = (list) => [...list].sort((a, b) => a.handle.localeCompare(b.handle, undefined, { sensitivity: 'base' }));

  /** A small button that opens (and closes) a list: its label shows how many are picked. */
  function folded(label, count, body, open) {
    const box = el('div', { class: 'so-fold' });
    const btn = el('button', { type: 'button', class: `so-chip so-fold-btn${count() ? ' on' : ''}`, 'aria-expanded': String(open.v) });
    const panel = el('div', { class: 'so-fold-panel' });
    const draw = () => {
      const n = count(); btn.textContent = `${label}${n ? ` · ${n}` : ''} ${open.v ? '▴' : '▾'}`;
      btn.classList.toggle('on', n > 0); btn.setAttribute('aria-expanded', String(open.v));
      panel.hidden = !open.v; if (open.v) fill(panel, body()); else panel.replaceChildren();
    };
    btn.addEventListener('click', () => { open.v = !open.v; draw(); });
    box.append(btn, panel); box.redraw = draw; draw(); return box;
  }

  /** Who's tagged in a post (alphabetical, folded until opened). */
  function tagPicker(selected, author) {
    const open = { v: false }; let box;
    const others = () => byHandle(state.accounts.filter((a) => a.id !== author));
    box = folded('👤 Tag', () => selected.size, () => [
      el('div', { class: 'so-tagpick', role: 'group', 'aria-label': 'Tag people' }, others().map((a) => el('button', { type: 'button', class: `so-chip${selected.has(a.id) ? ' on' : ''}`, 'aria-pressed': String(selected.has(a.id)), text: `@${a.handle}`, onclick: () => { if (selected.has(a.id)) selected.delete(a.id); else selected.add(a.id); box.redraw(); } }))),
      others().length ? null : el('span', { class: 'muted small', text: 'Make another account to tag it.' })], open);
    return box;
  }

  /** Who to invite to collaborate (the post on their profile too, once they say yes): up to three. Each is
   * tagged too (tagging alone doesn't collab). */
  function collabPicker(selected, author, statusOf = () => null, tagged = null) {
    const open = { v: false }; let box;
    const others = () => byHandle(state.accounts.filter((a) => a.id !== author));
    box = folded('🤝 Collab', () => selected.size, () => [
      el('div', { class: 'so-tagpick so-collabpick', role: 'group', 'aria-label': 'Collab' }, others().map((a) => { const on = selected.has(a.id); const st = statusOf(a.id); return el('button', { type: 'button', class: `so-chip${on ? ' on' : ''}`, 'aria-pressed': String(on), 'aria-label': `Collab with @${a.handle}`, text: `@${a.handle}${on && st === 'accepted' ? ' ✓' : on && st === 'pending' ? ' …' : ''}`, onclick: () => {
        if (on) selected.delete(a.id);
        else if (selected.size < MAX_COLLAB) { selected.add(a.id); if (tagged) { tagged.set.add(a.id); tagged.box?.redraw(); } } else toast(`${MAX_COLLAB} collaborators at most.`);
        box.redraw();
      } }); })),
      el('span', { class: 'muted small so-collab-note', text: others().length ? 'Each gets a collab request in their messages (and is tagged); once they accept, it\'s on their profile too.' : 'Make another account to collab with it.' })], open);
    return box;
  }

  /** Hashtags used before (by every account), the most used first: a tap adds one to the caption. */
  function communityPicker(caption) {
    const open = { v: false };
    const has = (t) => hashtagsIn(caption.value).includes(t);
    let box;
    box = folded('# Community', () => 0, () => {
      const tags = searchTags(state, '');
      return tags.length ? el('div', { class: 'so-tagpick', role: 'group', 'aria-label': 'Hashtags used before' }, tags.slice(0, 40).map((t) => el('button', { type: 'button', class: `so-chip${has(t.tag) ? ' on' : ''}`, 'aria-pressed': String(has(t.tag)), 'aria-label': `#${t.tag}, used ${t.count} times`, text: `#${t.tag} ${t.count}`, onclick: () => {
        if (!has(t.tag)) { caption.value = `${caption.value.replace(/\s*$/, '')}${caption.value.trim() ? ' ' : ''}#${t.tag}`; caption.dispatchEvent(new Event('input')); }
        box.redraw();
      } }))) : el('span', { class: 'muted small', text: 'No hashtags yet: put #something in a caption.' });
    }, open);
    return box;
  }

  // ---- Saved posts and views.
  /** 🔖: save a post to the account in use's own list (or take it off). */
  function saveBtn(p, cls) {
    const on = isSaved(state, state.me, p.id);
    return el('button', { type: 'button', class: `${cls}${on ? ' on' : ''}`, 'aria-label': on ? 'Saved: remove from saved' : 'Save', 'aria-pressed': String(on), onclick: (e) => {
      const now = toggleSave(state, state.me, p.id); save(); toast(now ? 'Saved (your profile → 🔖)' : 'Removed from saved');
      const b = e.currentTarget; b.classList.toggle('on', now); b.setAttribute('aria-pressed', String(now)); b.setAttribute('aria-label', now ? 'Saved: remove from saved' : 'Save');
    } }, el('span', { class: 'so-save-icon', 'aria-hidden': 'true', text: '🔖' }));
  }
  let viewSaveT = 0;
  /** A post seen by the account in use (once each while the app's open): counted, kept a moment later. */
  function countView(postId) {
    const k = `${state.me}:${postId}`; if (viewedNow.has(k) || !postById(state, postId)) return;
    viewedNow.add(k); const n = addView(state, postId, deviceId());
    clearTimeout(viewSaveT); viewSaveT = setTimeout(() => save(), 2000);
    // (Shown where it is on screen now, without drawing it all again.)
    const label = `👁 ${countLabel(n)} view${n === 1 ? '' : 's'}`;
    for (const card of main.querySelectorAll(`.so-post[data-post="${postId}"]`)) {
      let v = card.querySelector('.so-views');
      if (!v) { v = el('div', { class: 'so-views muted small' }); card.querySelector('.so-actions')?.after(v); }
      v.textContent = label;
    }
    for (const r of main.querySelectorAll(`.so-reel[data-post="${postId}"] .so-reel-views`)) { r.textContent = `👁 ${countLabel(n)}`; r.setAttribute('aria-label', `${n} views`); }
  }
  /** Posts in a list counted as seen when most of one has been on screen for a second. */
  let viewObserver = null;
  function watchViews(container) {
    viewObserver?.disconnect(); if (!('IntersectionObserver' in globalThis)) return;
    const timers = new Map();
    viewObserver = new IntersectionObserver((es) => { for (const e of es) { const id = e.target.dataset.post; if (!id) continue; if (e.isIntersecting && e.intersectionRatio >= 0.6) { if (!timers.has(id)) timers.set(id, setTimeout(() => countView(id), 1000)); } else { clearTimeout(timers.get(id)); timers.delete(id); } } }, { threshold: [0, 0.6] });
    requestAnimationFrame(() => { for (const n of container.querySelectorAll('.so-post[data-post]')) viewObserver.observe(n); });
  }

  function lostPhoto() {
    return el('div', { class: 'so-pic so-lost', role: 'img', 'aria-label': 'Photo not available' },
      el('span', { class: 'so-lost-icon', 'aria-hidden': 'true', text: '🖼' }),
      el('span', { text: connected() ? 'This photo couldn\'t be loaded on this device. If it was saved to Saved Files, it comes back at the next sync.' : 'This photo couldn\'t be loaded on this device.' }));
  }

  /** A small menu of choices over the page (a post's ⋯): resolves to the picked one's id, or null. */
  function sheet(title, choices) {
    return new Promise((resolve) => {
      const close = (v) => { box.remove(); resolve(v); };
      const box = el('div', { class: 'so-sheet-back', onclick: (e) => { if (e.target === box) close(null); } },
        el('div', { class: 'so-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          ...choices.map(([id, label, danger]) => el('button', { type: 'button', class: `so-sheet-btn${danger ? ' danger' : ''}`, text: label, onclick: () => close(id) })),
          el('button', { type: 'button', class: 'so-sheet-btn', text: 'Cancel', onclick: () => close(null) })));
      document.body.append(box); box.querySelector('button')?.focus();
    });
  }

  // ---- A post, as the feed shows it.
  function postCard(p, { full = false } = {}) {
    const by = accountById(state, p.by); const m = me();
    const liked = p.likes.includes(state.me);
    const heart = el('button', { type: 'button', class: `so-act so-like${liked ? ' on' : ''}`, 'aria-label': liked ? 'Unlike' : 'Like', 'aria-pressed': String(liked), text: liked ? '♥' : '♡', onclick: () => { toggleLike(state, p.id, state.me); save(); draw(); } });
    const pic = media(p, by, like);
    function like() {
      if (!p.likes.includes(state.me)) { toggleLike(state, p.id, state.me); save(); }
      draw();
      const big = el('span', { class: 'so-burst', 'aria-hidden': 'true', text: '♥' }); main.querySelector(`[data-post="${p.id}"] .so-pic`)?.append(big); setTimeout(() => big.remove(), 700);
    }
    const menu = postMenu(p, by);
    const shown = full ? p.comments : p.comments.slice(-2);
    const commentBox = full && m ? (() => {
      const input = el('input', { class: 'so-input so-comment-input', type: 'text', placeholder: `Add a comment as ${m.handle}…`, 'aria-label': 'Add a comment', maxlength: '500' });
      const post = () => { if (addComment(state, p.id, state.me, input.value)) { save(); draw(); } };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') post(); });
      return el('div', { class: 'so-comment-add' }, avatar(m, 's'), input, el('button', { type: 'button', class: 'so-link', text: 'Post', onclick: post }));
    })() : null;
    const genBox = full && m?.owner ? generateCommentBox(p) : null;
    return el('article', { class: 'so-post', 'data-post': p.id },
      el('div', { class: 'so-post-head' }, el('button', { type: 'button', class: 'so-avbtn', 'aria-label': `@${by.handle}`, onclick: () => go({ name: 'profile', id: by.id }) }, avatar(by, 's')), handleBtn(by), ...collabsOf(p).flatMap((cid) => { const ca = accountById(state, cid); return ca ? [el('span', { class: 'so-and', text: ' and ' }), handleBtn(ca)] : []; }), el('span', { class: 'so-dot muted', text: `• ${timeAgo(p.at)}${p.edited ? ' · edited' : ''}` }), menu),
      pic,
      el('div', { class: 'so-actions' }, heart, el('button', { type: 'button', class: 'so-act', 'aria-label': 'Comments', text: '💬', onclick: () => go({ name: 'post', id: p.id }) }), el('button', { type: 'button', class: 'so-act so-share', 'aria-label': 'Share', text: '✈', onclick: () => share(p) }), saveBtn(p, 'so-act so-save')),
      viewsOf(p) ? el('div', { class: 'so-views muted small', text: `👁 ${countLabel(viewsOf(p))} view${viewsOf(p) === 1 ? '' : 's'}` }) : null,
      tagLine(p),
      p.likes.length ? el('div', { class: 'so-likes', text: `${countLabel(p.likes.length)} like${p.likes.length === 1 ? '' : 's'}` }) : null,
      p.caption ? el('p', { class: 'so-caption' }, handleBtn(by), ' ', ...captionNodes(p.caption)) : null,
      !full && p.comments.length > 2 ? el('button', { type: 'button', class: 'so-link muted', text: `View all ${p.comments.length} comments`, onclick: () => go({ name: 'post', id: p.id }) }) : null,
      ...shown.map((c) => { const a = accountById(state, c.by); return a ? el('p', { class: 'so-comment' }, handleBtn(a), ' ', c.text, full ? el('span', { class: 'muted small', text: `  ${timeAgo(c.at)}` }) : null) : null; }),
      genBox, commentBox);
  }

  // ---- The text predictor (the Owner only): a comment from another account, or a reply in a chat.
  let genWho = ''; // ('' = a random account)
  /** ✨ Generate comment: one of the other accounts (random, or the one picked) says something about the post. */
  function generateCommentBox(p) {
    const others = byHandle(state.accounts.filter((a) => a.id !== p.by));
    if (!others.length) return null;
    if (genWho && !others.some((a) => a.id === genWho)) genWho = '';
    const pick = el('select', { class: 'so-input so-gen-who', 'aria-label': 'Comment as' }, el('option', { value: '', text: '🎲 Random account' }), others.map((a) => el('option', { value: a.id, text: `@${a.handle}` })));
    pick.value = genWho; pick.addEventListener('change', () => { genWho = pick.value; });
    const go1 = () => {
      // (Random: one that hasn't commented yet, when there is one.)
      const fresh = others.filter((a) => !p.comments.some((c) => c.by === a.id));
      const pool = fresh.length ? fresh : others;
      const who = genWho || pool[Math.floor(Math.random() * pool.length)].id;
      const text = generateComment(p.caption, { avoid: p.comments.map((c) => c.text) });
      if (addComment(state, p.id, who, text)) { save(); draw(); }
    };
    return el('div', { class: 'so-gen' }, el('button', { type: 'button', class: 'btn so-gen-btn', text: '✨ Generate comment', onclick: go1 }), pick);
  }

  // ---- Screens.
  function welcome() {
    return el('div', { class: 'so-pad so-welcome' },
      el('div', { class: 'so-logo so-logo-big', text: 'Socials' }),
      el('p', { class: 'muted', text: connected() ? 'Make an account to start posting. Everything here is made by you, kept on this device and, encrypted, in your Drive.' : 'Make an account to start posting. Everything here is made by you and kept on this device.' }),
      accountForm(null),
      el('button', { type: 'button', class: 'so-link', text: 'Sync and password', onclick: () => go({ name: 'settings' }) }));
  }

  function feed() {
    const m = me(); const raw = feedFor(state, m.id);
    // (Ranked: the more seen and liked, and the newer, the likelier near the top; the order kept while the app's
    // open, and anything new since (your own new post) first.)
    let order = feedOrder.get(m.id);
    if (!order) { order = rankPosts(raw).map((p) => p.id); feedOrder.set(m.id, order); }
    const ids = raw.map((p) => p.id); const fresh = raw.filter((p) => !order.includes(p.id)).sort((a, b) => b.at - a.at).map((p) => p.id);
    order = [...fresh, ...order.filter((id) => ids.includes(id))]; feedOrder.set(m.id, order);
    const byId = new Map(raw.map((p) => [p.id, p])); const items = order.map((id) => byId.get(id)).filter(Boolean);
    const follows = followingOf(state, m.id);
    // (The row across the top: their stories (a ring round any with a post in the last day: bright while
    // there's one not seen yet), those first; tapping one with stories opens them, else its profile.)
    const accs = [m, ...follows]; const withSt = accs.filter((a) => storiesOf(state, a.id).length);
    const ordered = [m, ...accs.slice(1).sort((x, y) => (storyState(y.id) === 'new' ? 1 : 0) - (storyState(x.id) === 'new' ? 1 : 0))];
    const row = el('div', { class: 'so-stories', role: 'group', 'aria-label': 'Stories' },
      ordered.map((a) => { const st = storyState(a.id); return el('button', { type: 'button', class: 'so-story', 'aria-label': st ? `@${a.handle}'s story${st === 'new' ? ', new' : ''}` : `@${a.handle}`, onclick: () => (st ? openStories(withSt.map((x) => x.id), a.id) : go({ name: 'profile', id: a.id })) }, el('span', { class: `so-ring${st === 'seen' ? ' seen' : st ? '' : ' none'}` }, avatar(a, 'l')), el('span', { class: 'so-story-name', text: a.id === m.id ? (st ? 'Your story' : 'Your profile') : a.handle })); }));
    const list = el('div', { class: 'so-feed' }, items.map((p) => postCard(p))); watchViews(list);
    return el('div', {}, row,
      items.length ? list
        : el('div', { class: 'so-empty' },
          el('p', { class: 'so-empty-big', text: 'Welcome to your feed' }),
          el('p', { class: 'muted', text: follows.length ? 'No posts yet from the accounts you follow.' : 'Follow accounts to see their posts here, or share your first post.' }),
          el('div', { class: 'so-row' }, el('button', { type: 'button', class: 'btn primary', text: 'New post', onclick: () => go({ name: 'new' }) }), el('button', { type: 'button', class: 'btn', text: 'Find accounts', onclick: () => go({ name: 'explore' }) }))));
  }

  function explore() {
    const q = el('input', { class: 'so-input so-search', type: 'search', placeholder: 'Search', 'aria-label': 'Search accounts and hashtags', value: view.q ?? '' });
    const list = el('div', { class: 'so-people' });
    const grid = el('div', { class: 'so-grid' });
    const show = () => {
      view.q = q.value;
      const s = q.value.trim();
      // (#tag: hashtags; else accounts, and hashtags like it under them.)
      const tagRow = ({ tag, count: c }) => el('button', { type: 'button', class: 'so-person-main so-tagrow', onclick: () => go({ name: 'tag', tag }) }, el('span', { class: 'so-av so-av-m so-av-tag', 'aria-hidden': 'true', text: '#' }), el('span', { class: 'so-person-text' }, el('strong', { text: `#${tag}` }), el('span', { class: 'muted small', text: `${countLabel(c)} post${c === 1 ? '' : 's'}` })));
      const tags = s ? searchTags(state, s).slice(0, 8) : [];
      fill(list, !s ? null : s.startsWith('#') ? tags.map((t) => el('div', { class: 'so-person' }, tagRow(t))) : [...searchAccounts(state, s).map(personRow), ...(tags.length ? [el('h3', { class: 'so-section', text: 'Hashtags' }), ...tags.map((t) => el('div', { class: 'so-person' }, tagRow(t)))] : [])]);
      fill(grid, s ? null : state.posts.filter((p) => live(p) && (p.image || p.video)).sort((a, b) => b.at - a.at).map(tile));
      if (s && !list.childElementCount) list.append(el('p', { class: 'muted so-pad', text: s.startsWith('#') ? 'No posts with that hashtag yet.' : 'No accounts found.' }));
      if (!s && !grid.childElementCount) grid.append(el('p', { class: 'muted so-pad', text: 'Posts from all your accounts show here.' }));
    };
    q.addEventListener('input', show); show();
    return el('div', {}, el('div', { class: 'so-pad' }, q), list, grid);
  }

  function personRow(a) {
    const mine = a.id === state.me; const f = isFollowing(state, state.me, a.id);
    return el('div', { class: 'so-person' },
      el('button', { type: 'button', class: 'so-person-main', onclick: () => go({ name: 'profile', id: a.id }) }, avatar(a, 'm'), el('span', { class: 'so-person-text' }, el('strong', { text: a.handle }), el('span', { class: 'muted small', text: a.name || `${countLabel(followersOf(state, a.id).length)} followers` }))),
      mine ? el('span', { class: 'muted small', text: 'You' }) : el('button', { type: 'button', class: `btn small${f ? '' : ' primary'}`, text: f ? 'Following' : 'Follow', onclick: () => { toggleFollow(state, state.me, a.id); save(); draw(); } }));
  }

  const tile = (p) => el('button', { type: 'button', class: 'so-tile', 'aria-label': `${p.draft ? 'Draft' : p.kind === 'video' ? 'Video' : 'Post'} by ${accountById(state, p.by)?.handle}${p.pinned ? ' (pinned)' : ''}${p.caption ? `: ${p.caption.slice(0, 60)}` : ''}`, onclick: () => go(p.draft ? { name: 'new', draft: p.id } : p.kind === 'video' ? { name: 'reels', start: p.id, by: view.name === 'profile' ? p.by : null } : { name: 'post', id: p.id }) },
    p.pinned && view.name === 'profile' ? el('span', { class: 'so-tile-pin', 'aria-hidden': 'true', text: '📌' }) : null,
    p.image ? el('img', { src: urlOf(p.image), alt: '' }) : el('span', { class: 'so-tile-text', text: p.caption }),
    p.more?.length ? el('span', { class: 'so-tile-badge', 'aria-hidden': 'true', text: '❐' }) : p.kind === 'video' ? el('span', { class: 'so-tile-badge', 'aria-hidden': 'true', text: '▶︎' }) : null);

  // ---- Stories.
  const seenMap = () => { const v = store.json(SEEN_KEY, {}); return v && typeof v === 'object' ? v : {}; };
  /** An account's stories for the one in use: 'new' (one not seen yet), 'seen', or '' (none). */
  function storyState(id) {
    const st = storiesOf(state, id); if (!st.length) return '';
    const seen = seenMap()[state.me] ?? {}; return st.every((p) => seen[p.id]) ? 'seen' : 'new';
  }
  function markSeen(postId) {
    const all = seenMap(); const mine = all[state.me] ?? {}; mine[postId] = Date.now();
    const cut = Date.now() - 2 * 86400000; for (const [k, v] of Object.entries(mine)) if (v < cut) delete mine[k];
    all[state.me] = mine; store.set(SEEN_KEY, JSON.stringify(all));
  }
  /**
   * The stories of `ids` (accounts, in order), from `startId`: full screen, each post's photos and videos one
   * after another (a photo five seconds, a video as long as it is, with its sound once turned on), bars across
   * the top saying where; tap the right to go on, the left to go back; ✕ (or Escape, or a swipe down) to close.
   * Then the next account's.
   */
  function openStories(ids, startId) {
    const groups = ids.map((id) => ({ acc: accountById(state, id), frames: storiesOf(state, id).flatMap((p) => mediaOf(p).map((it) => ({ p, it }))) })).filter((g) => g.acc && g.frames.length);
    if (!groups.length) return;
    let g = Math.max(0, groups.findIndex((x) => x.acc.id === startId));
    // (Start at the first not seen yet.)
    const seen0 = seenMap()[state.me] ?? {}; let f = Math.max(0, groups[g].frames.findIndex((x) => !seen0[x.p.id]));
    let raf = 0; let t0 = 0; let vid = null; let closed = false;
    const bars = el('div', { class: 'so-sv-bars' }); const head = el('div', { class: 'so-sv-head' }); const stage = el('div', { class: 'so-sv-stage' }); const cap = el('div', { class: 'so-sv-cap' });
    const close = () => { closed = true; cancelAnimationFrame(raf); vid?.pause(); box.remove(); document.removeEventListener('keydown', onKey); draw(); };
    const next = () => { if (f + 1 < groups[g].frames.length) f++; else if (g + 1 < groups.length) { g++; f = 0; } else { close(); return; } show(); };
    const prev = () => { if (f > 0) f--; else if (g > 0) { g--; f = groups[g].frames.length - 1; } show(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') prev(); };
    const sound = el('button', { type: 'button', class: 'so-sv-btn', 'aria-label': reelSound ? 'Sound off' : 'Sound on', text: reelSound ? '🔊' : '🔇', onclick: (e) => { e.stopPropagation(); reelSound = !reelSound; sound.textContent = reelSound ? '🔊' : '🔇'; sound.setAttribute('aria-label', reelSound ? 'Sound off' : 'Sound on'); if (vid) vid.muted = !reelSound; } });
    function show() {
      cancelAnimationFrame(raf); vid?.pause(); vid = null;
      const G2 = groups[g]; const fr = G2.frames[f]; markSeen(fr.p.id);
      fill(bars, G2.frames.map((_, i) => el('span', { class: 'so-sv-bar' }, el('span', { class: 'so-sv-fill', style: { width: i < f ? '100%' : '0%' } }))));
      fill(head, avatar(G2.acc, 's'), el('strong', { text: G2.acc.handle }), el('span', { class: 'so-sv-time', text: timeAgo(fr.p.at) }), fr.it.kind === 'video' ? sound : null,
        el('button', { type: 'button', class: 'so-sv-btn', 'aria-label': 'Close', text: '✕', onclick: (e) => { e.stopPropagation(); close(); } }));
      const fillBar = () => bars.children[f]?.firstChild;
      if (fr.it.kind === 'video' && fr.it.video) {
        vid = el('video', { class: 'so-sv-media', src: urlOf(fr.it.video), poster: urlOf(fr.it.image) ?? undefined, playsinline: true, 'aria-label': `Story by ${G2.acc.handle}` });
        vid.muted = !reelSound; vid.addEventListener('ended', next);
        fill(stage, vid); vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });
        const tick = () => { if (closed || !vid) return; const b = fillBar(); if (b && vid.duration) b.style.width = `${(100 * vid.currentTime) / vid.duration}%`; raf = requestAnimationFrame(tick); };
        raf = requestAnimationFrame(tick);
      } else {
        fill(stage, fr.it.image ? el('img', { class: 'so-sv-media', src: urlOf(fr.it.image), alt: fr.p.caption ? `Story: ${fr.p.caption.slice(0, 80)}` : `Story by ${G2.acc.handle}` }) : el('p', { class: 'so-sv-text', text: fr.p.caption }));
        t0 = performance.now();
        const tick = (t) => { if (closed) return; const k = Math.min(1, (t - t0) / 5000); const b = fillBar(); if (b) b.style.width = `${k * 100}%`; if (k >= 1) { next(); return; } raf = requestAnimationFrame(tick); };
        raf = requestAnimationFrame(tick);
      }
      fill(cap, fr.p.caption ? el('p', {}, ...captionNodes(fr.p.caption)) : null);
    }
    // (Tap: the left third back, the rest on. A swipe down closes.)
    let ty = null;
    const box = el('div', { class: 'so-sv', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Stories',
      onclick: (e) => { if (e.target.closest('button')) return; const r = box.getBoundingClientRect(); if (e.clientX - r.left < r.width / 3) prev(); else next(); },
      ontouchstart: (e) => { ty = e.touches[0].clientY; }, ontouchend: (e) => { if (ty != null && e.changedTouches[0].clientY - ty > 90) close(); ty = null; } },
      bars, head, stage, cap,
      el('div', { class: 'so-sv-nav' }, el('button', { type: 'button', class: 'so-sv-btn', 'aria-label': 'Previous', text: '‹', onclick: (e) => { e.stopPropagation(); prev(); } }), el('button', { type: 'button', class: 'so-sv-btn', 'aria-label': 'Next', text: '›', onclick: (e) => { e.stopPropagation(); next(); } })));
    document.body.append(box); document.addEventListener('keydown', onKey); show();
  }

  // ---- A hashtag's posts.
  function tagView(tag) {
    const posts = postsWithTag(state, tag);
    return el('div', {}, backBar(`#${tag}`, { name: 'explore' }),
      el('div', { class: 'so-pad so-tag-head' }, el('span', { class: 'so-av so-av-xl so-av-tag', 'aria-hidden': 'true', text: '#' }), el('div', {}, el('strong', { class: 'so-tag-name', text: `#${tag}` }), el('div', { class: 'muted', text: `${countLabel(posts.length)} post${posts.length === 1 ? '' : 's'}` }))),
      posts.length ? el('div', { class: 'so-grid' }, posts.map(tile)) : el('p', { class: 'muted so-pad', text: 'No posts with this hashtag yet.' }));
  }

  // ---- One account's photos and videos, in one zip to save (with a list of their captions).
  async function exportAccount(a) {
    toast('Making the zip…');
    try {
      const pad = (n) => String(n).padStart(2, '0'); const ext = (b) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/mp4': 'mp4' }[b.type] ?? (b.type.startsWith('video/') ? 'mp4' : 'jpg'));
      const files = []; const lines = [`@${a.handle}${a.name ? ` (${a.name})` : ''}: ${postsBy(state, a.id).length} posts`, ''];
      if (a.avatar) files.push({ name: `profile.${ext(a.avatar)}`, bytes: new Uint8Array(await a.avatar.arrayBuffer()) });
      for (const p of [...postsBy(state, a.id)].sort((x, y) => x.at - y.at)) {
        const d = new Date(p.at); const stem = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
        const names = []; const items = mediaOf(p);
        for (let i = 0; i < items.length; i++) {
          const b = items[i].kind === 'video' ? items[i].video : items[i].image; if (!b) continue;
          const name = `${stem}${items.length > 1 ? `_${i + 1}` : ''}.${ext(b)}`; files.push({ name, bytes: new Uint8Array(await b.arrayBuffer()) }); names.push(name);
        }
        lines.push(`${d.toLocaleString()}  ${names.join(', ') || '(no file on this device)'}`, p.caption ? `  ${p.caption.replace(/\n/g, '\n  ')}` : '  (no caption)', '');
      }
      files.push({ name: 'captions.txt', bytes: new TextEncoder().encode(lines.join('\n')) });
      const zip = new File([createZip(files)], `${a.handle}-socials.zip`, { type: 'application/zip' });
      if (canShareFiles([zip])) await shareFiles([zip], zip.name).catch(() => downloadBlob(zip, zip.name)); else downloadBlob(zip, zip.name);
    } catch (e) { toast(`Couldn't make the zip: ${e.message}`); }
  }

  function profile(id) {
    const a = accountById(state, id); if (!a) return feed();
    const mine = a.id === state.me; const all = postsBy(state, a.id);
    const grid = view.grid ?? 'posts'; const showReels = grid === 'reels';
    const posts = grid === 'reels' ? all.filter((p) => p.kind === 'video') : grid === 'tagged' ? taggedIn(state, a.id) : grid === 'drafts' && mine ? draftsOf(state, a.id) : grid === 'saved' && mine ? savedOf(state, a.id) : all;
    const st = storyState(a.id);
    const f = isFollowing(state, state.me, a.id);
    const stat = (n, label, v) => el('button', { type: 'button', class: 'so-stat', onclick: v ? () => go(v) : null }, el('strong', { text: countLabel(n) }), el('span', { text: label }));
    return el('div', {},
      el('div', { class: 'so-pad so-prof' },
        el('div', { class: 'so-prof-top' }, st ? el('button', { type: 'button', class: `so-ring so-ring-btn${st === 'seen' ? ' seen' : ''}`, 'aria-label': `@${a.handle}'s story`, onclick: () => openStories([a.id], a.id) }, avatar(a, 'xl')) : avatar(a, 'xl'),
          el('div', { class: 'so-stats' }, stat(all.length, 'posts'), stat(followersOf(state, a.id).length, 'followers', { name: 'people', id: a.id, kind: 'followers' }), stat(a.following.length, 'following', { name: 'people', id: a.id, kind: 'following' }))),
        el('div', { class: 'so-prof-handle' }, `@${a.handle}`, a.owner ? el('span', { class: 'so-owner', text: 'Owner' }) : null),
        a.name ? el('div', { class: 'so-prof-name', text: a.name }) : null,
        a.bio ? el('p', { class: 'so-bio', text: a.bio }) : null,
        el('div', { class: 'so-row' }, mine
          ? [el('button', { type: 'button', class: 'btn', text: 'Edit profile', onclick: () => go({ name: 'edit' }) }), el('button', { type: 'button', class: 'btn', text: 'Switch account', onclick: () => go({ name: 'accounts' }) }), el('button', { type: 'button', class: 'btn', 'aria-label': `Download @${a.handle}'s photos and videos`, text: '⬇', onclick: () => exportAccount(a) })]
          : [el('button', { type: 'button', class: `btn${f ? '' : ' primary'}`, text: f ? 'Following' : 'Follow', onclick: () => { toggleFollow(state, state.me, a.id); save(); draw(); } }), el('button', { type: 'button', class: 'btn', text: 'Message', onclick: () => go({ name: 'chat', id: a.id }) }), el('button', { type: 'button', class: 'btn', text: 'Use this account', onclick: () => { useAccount(a.id); save(); draw(); } }), el('button', { type: 'button', class: 'btn', 'aria-label': `Download @${a.handle}'s photos and videos`, text: '⬇', onclick: () => exportAccount(a) })])),
      el('div', { class: 'so-ptabs', role: 'tablist' },
        [['posts', 'Posts', '▦'], ['reels', 'Reels', '▶︎'], ['tagged', 'Tagged', '👤'], ...(mine ? [['saved', 'Saved', '🔖'], ['drafts', `Drafts${draftsOf(state, a.id).length ? ` (${draftsOf(state, a.id).length})` : ''}`, '✎']] : [])].map(([g, label, icon]) => el('button', { type: 'button', role: 'tab', class: `so-ptab${grid === g ? ' on' : ''}`, 'aria-selected': String(grid === g), 'aria-label': label, text: icon, onclick: () => go({ ...view, grid: g }) }))),
      posts.length ? el('div', { class: 'so-grid' }, posts.map(tile)) : el('div', { class: 'so-empty' }, el('p', { class: 'so-empty-big', text: showReels ? 'No reels yet' : grid === 'tagged' ? 'No tagged posts yet' : grid === 'drafts' ? 'No drafts' : grid === 'saved' ? 'Nothing saved yet: tap 🔖 on a post to save it here (only you see this)' : 'No posts yet' }), mine && !['tagged', 'drafts', 'saved'].includes(grid) ? el('button', { type: 'button', class: 'btn primary', text: 'Share your first post', onclick: () => go({ name: 'new' }) }) : null));
  }

  function people(id, kind) {
    const a = accountById(state, id); if (!a) return feed();
    const list = kind === 'followers' ? followersOf(state, id) : followingOf(state, id);
    return el('div', {}, backBar(`@${a.handle} · ${kind === 'followers' ? 'Followers' : 'Following'}`, { name: 'profile', id }),
      list.length ? el('div', { class: 'so-people' }, list.map(personRow)) : el('p', { class: 'muted so-pad', text: kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.' }));
  }

  const backBar = (title, v) => el('div', { class: 'so-back' }, el('button', { type: 'button', class: 'so-act', 'aria-label': 'Back', text: '‹', onclick: () => go(v) }), el('strong', { text: title }));

  function onePost(id) {
    const p = postById(state, id); if (!p) return feed();
    // (Opened (from a profile, a grid, a message): a view.)
    countView(p.id);
    return el('div', {}, backBar('Post', { name: 'profile', id: p.by }), postCard(p, { full: true }));
  }

  // (Picking the account to use: the Owner always first, on its own, then the others.)
  function accounts() {
    const row = (a) => el('div', { class: `so-person${a.owner ? ' so-owner-row' : ''}` },
      el('button', { type: 'button', class: 'so-person-main', 'aria-label': `Use @${a.handle}${a.owner ? ' (Owner)' : ''}`, onclick: () => { useAccount(a.id); save(); go({ name: 'feed' }); } }, avatar(a, 'm'), el('span', { class: 'so-person-text' }, el('strong', {}, a.handle, a.owner ? el('span', { class: 'so-owner', text: 'Owner' }) : null), el('span', { class: 'muted small', text: a.name || ' ' }))),
      unreadCount(state, a.id) ? el('span', { class: 'so-badge so-badge-inline', 'aria-label': `${unreadCount(state, a.id)} unread messages`, text: String(unreadCount(state, a.id)) }) : null,
      a.id === state.me ? el('span', { class: 'so-check', 'aria-label': 'In use', text: '✓' }) : null);
    // (The Owner, then Friends and Celebrities, each in the same order: unread first, then last used.)
    const list = switcherOrder(state, usedTimes()); const owner = list.filter((a) => a.owner);
    const friends = list.filter((a) => !a.owner && a.kind !== 'celebrity'); const celebs = list.filter((a) => !a.owner && a.kind === 'celebrity');
    const group = (title, l, none) => [el('h3', { class: 'so-section', text: `${title}${l.length ? ` · ${l.length}` : ''}` }), l.length ? el('div', { class: 'so-people' }, l.map(row)) : el('p', { class: 'muted so-pad small', text: none })];
    return el('div', {}, backBar('Accounts', { name: 'feed' }),
      el('h3', { class: 'so-section', text: 'Owner' }), el('div', { class: 'so-people' }, owner.map(row)),
      el('div', { class: 'so-pad so-add-new' }, el('button', { type: 'button', class: 'btn primary', text: '+ Add New', onclick: () => go({ name: 'newaccount' }) })),
      ...group('Friends', friends, 'No friends yet.'),
      ...group('Celebrities', celebs, 'No celebrities yet.'));
  }

  function newAccount() {
    return el('div', {}, backBar('New account', { name: 'accounts' }), el('div', { class: 'so-pad' }, accountForm(null)));
  }

  // ---- Making or editing an account.
  function accountForm(a) {
    let pic = a?.avatar ?? null; let changed = false; let full = null;
    let kind = a?.kind === 'celebrity' ? 'celebrity' : 'friend';
    const kindPick = a?.owner || !state.accounts.length ? null : el('div', { class: 'so-kind', role: 'radiogroup', 'aria-label': 'Kind of account' });
    const drawKind = () => kindPick && fill(kindPick, [['friend', '👥 Friend'], ['celebrity', '⭐ Celebrity']].map(([k, label]) => el('button', { type: 'button', role: 'radio', class: `so-chip${kind === k ? ' on' : ''}`, 'aria-checked': String(kind === k), text: label, onclick: () => { kind = k; drawKind(); } })));
    drawKind();
    const prev = el('span', { class: 'so-form-av' });
    const showPic = () => fill(prev, pic ? el('img', { class: 'so-av so-av-l', src: urlOf(pic), alt: '' }) : el('span', { class: 'so-av so-av-l so-av-none', text: '+' }));
    showPic();
    const file = el('input', { type: 'file', accept: 'image/*', class: 'so-file', 'aria-label': 'Profile picture' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0]; file.value = ''; if (!f) return;
      // (The photo as it is, uncropped, too: it's posted when the account is saved.)
      try { const b = await photoFrom(f, true); if (b) { pic = b; changed = true; showPic(); try { full = await prepare(f, 1440, false); } catch { full = null; } } } catch (e) { err.textContent = e.message; }
    });
    const handle = el('input', { class: 'so-input', type: 'text', placeholder: 'Username', 'aria-label': 'Username', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', maxlength: '30', value: a?.handle ?? '' });
    const name = el('input', { class: 'so-input', type: 'text', placeholder: 'Name', 'aria-label': 'Name', maxlength: '60', value: a?.name ?? '' });
    const bio = el('textarea', { class: 'so-input', rows: '3', placeholder: 'Bio', 'aria-label': 'Bio', maxlength: '300' }); bio.value = a?.bio ?? '';
    const err = el('p', { class: 'so-err', role: 'alert' });
    const submit = () => {
      err.textContent = '';
      const p = handleProblem(state, handle.value, a?.id ?? null); if (p) { err.textContent = p; return; }
      // (A new profile photo is also posted, whole, as it was picked.)
      const postPic = (id) => { if (changed && pic && full) addPost(state, id, { image: full, caption: 'New profile picture 📸' }); };
      if (a) { editAccount(state, a.id, { handle: handle.value, name: name.value, bio: bio.value, ...(a.owner ? {} : { kind }), ...(changed ? { avatar: pic } : {}) }); postPic(a.id); save(); go({ name: 'profile', id: a.id }); }
      else { const n = addAccount(state, { handle: handle.value, name: name.value, bio: bio.value, avatar: pic, kind }); postPic(n.id); useAccount(n.id); save(); go({ name: 'feed' }); }
    };
    return el('div', { class: 'so-form' },
      el('label', { class: 'so-form-pic' }, prev, el('span', { class: 'so-link', text: a?.avatar ? 'Change profile photo' : 'Add profile photo' }), file),
      handle, name, bio, kindPick, err,
      el('button', { type: 'button', class: 'btn primary', text: a ? 'Done' : 'Create account', onclick: submit }));
  }

  function edit() {
    const a = me();
    return el('div', {}, backBar('Edit profile', { name: 'profile', id: a.id }),
      el('div', { class: 'so-pad' }, accountForm(a),
        a.owner ? el('p', { class: 'muted small so-delete', text: 'This is the Owner account (yours), always listed first. To delete it, make another account the Owner first.' })
          : el('div', { class: 'so-form so-delete' },
            el('button', { type: 'button', class: 'btn', text: 'Make this the Owner account', onclick: () => { if (confirm(`Make @${a.handle} the Owner account?`)) { setOwner(state, a.id); save(); go({ name: 'profile', id: a.id }); } } }),
            el('button', { type: 'button', class: 'btn danger', text: `Delete @${a.handle}`, onclick: () => { if (confirm(`Delete @${a.handle}, its posts and messages? This can't be undone.`)) { removeAccount(state, a.id); save(); go({ name: 'feed' }); } } }))));
  }

  /** A photo picked, through the editor (fit, filter, adjust); kept as it is where the editor can't run. */
  async function photoFrom(f, isAvatar) {
    try { return await editPhoto(f, { avatar: isAvatar }); } catch (e) {
      if (/WebGL/.test(e.message)) return prepare(f, isAvatar ? 480 : 1440, isAvatar);
      throw e;
    }
  }

  // ---- A new post: photos (each edited first) and videos (with their sound), up to ten in one post.
  function newPost() {
    const m = me(); const tags = new Set();
    /** Its items: { kind, image (the photo, or a video's still), video, original (the photo as picked) }. */
    const items = []; let cur = 0;
    // (A draft opened again: its photos and videos, caption and tags.)
    const draft = view.draft ? postById(state, view.draft) : null;
    const collabs = new Set(draft?.draft ? (draft.collab ?? []).map((c) => c.id) : []);
    if (draft && draft.by === m.id && draft.draft) { for (const it of mediaOf(draft)) if (it.image || it.video) items.push({ kind: it.kind, image: it.image, video: it.video, original: it.image }); for (const t of draft.tags ?? []) tags.add(t); }
    const prev = el('div', { class: 'so-new-prev' }, el('span', { class: 'muted', text: 'Pick photos or videos' }));
    const strip = el('div', { class: 'so-new-strip', role: 'list', 'aria-label': 'In this post' });
    const file = el('input', { type: 'file', accept: 'image/*,video/*', multiple: true, class: 'so-file', 'aria-label': 'Photo or video' });
    const more = el('input', { type: 'file', accept: 'image/*,video/*', multiple: true, class: 'so-file', 'aria-label': 'Add more photos or videos' });
    const caption = el('textarea', { class: 'so-input', rows: '3', placeholder: 'Write a caption…', 'aria-label': 'Caption', maxlength: '2200' });
    const err = el('p', { class: 'so-err', role: 'alert' });
    const tagBox = tagPicker(tags, m.id);
    if (draft?.draft) caption.value = draft.caption;
    const share = el('button', { type: 'button', class: 'btn primary', text: 'Share', disabled: true });
    const saveDraft = el('button', { type: 'button', class: 'btn', text: draft?.draft ? 'Save draft' : 'Save as draft', disabled: true });
    const again = el('button', { type: 'button', class: 'btn', text: 'Edit photo', hidden: true });
    const addLabel = el('label', { class: 'btn so-add-more', hidden: true }, '＋ Add more', more);
    const show = () => {
      const it = items[cur];
      fill(prev, !it ? el('span', { class: 'muted', text: 'Pick photos or videos' }) : it.kind === 'video' ? el('video', { src: urlOf(it.video), poster: urlOf(it.image), controls: true, playsinline: true, 'aria-label': 'Your video' }) : el('img', { src: urlOf(it.image), alt: 'Your photo' }));
      fill(strip, items.length > 1 ? items.map((x, i) => el('div', { class: `so-new-thumb${i === cur ? ' on' : ''}`, role: 'listitem' },
        el('button', { type: 'button', class: 'so-new-thumb-pick', 'aria-label': `${x.kind === 'video' ? 'Video' : 'Photo'} ${i + 1}`, onclick: () => { cur = i; show(); } }, el('img', { src: urlOf(x.image), alt: '' }), x.kind === 'video' ? el('span', { class: 'so-tile-badge', text: '▶︎' }) : null),
        el('button', { type: 'button', class: 'so-new-thumb-x', 'aria-label': `Remove ${i + 1}`, text: '✕', onclick: () => { items.splice(i, 1); cur = Math.min(cur, items.length - 1); show(); } }))) : null);
      share.disabled = !items.length; saveDraft.disabled = !items.length && !caption.value.trim(); again.hidden = !(it && it.kind === 'photo'); addLabel.hidden = !items.length || items.length >= MAX_ITEMS;
    };
    again.addEventListener('click', async () => { const it = items[cur]; try { const b = await photoFrom(it.original, false); if (b) { it.image = b; show(); } } catch (e) { err.textContent = e.message; } });
    // (Each picked file in turn: a video as it is, a photo through the editor (Cancel: as it is).)
    const take = async (list) => {
      err.textContent = ''; const room = MAX_ITEMS - items.length; const files = [...list].slice(0, room);
      if (list.length > room) err.textContent = `${MAX_ITEMS} at most in one post.`;
      for (const f of files) {
        try {
          if (/^video\//.test(f.type) || /\.(mov|mp4|m4v|webm)$/i.test(f.name)) {
            if (f.size > MAX_VIDEO) throw new Error(`"${f.name}" is too big (${Math.round(f.size / 1048576)} MB; ${MAX_VIDEO / 1048576} MB at most).`);
            const v = await prepareVideo(f); items.push({ kind: 'video', image: v.still, video: v.video });
            if (f.size > 24 * 1048576 && connected()) err.textContent = 'A video over 24 MB stays on this device and won\'t play on your other devices.';
          } else {
            const b = (await photoFrom(f, false)) ?? (files.length > 1 ? await prepare(f, 1440, false) : null);
            if (b) items.push({ kind: 'photo', image: b, original: f });
          }
          cur = items.length - 1; show();
        } catch (e) { err.textContent = e.message; }
      }
    };
    file.addEventListener('change', () => { const l = [...(file.files ?? [])]; file.value = ''; if (l.length) take(l); });
    more.addEventListener('change', () => { const l = [...(more.files ?? [])]; more.value = ''; if (l.length) take(l); });
    caption.addEventListener('input', () => { saveDraft.disabled = !items.length && !caption.value.trim(); });
    const make = (asDraft) => {
      const [first, ...rest] = items;
      const p = addPost(state, m.id, { image: first?.image ?? null, video: first?.kind === 'video' ? first.video : null, caption: caption.value, tags: [...new Set([...tags, ...collabs])], more: rest.map((x) => ({ image: x.image, video: x.kind === 'video' ? x.video : null })), draft: asDraft });
      if (draft?.draft) removePost(state, draft.id); // (the draft it was: replaced)
      // (Its collaborators: asked now if it's shared; when a draft is, they're asked when it's shared.)
      setCollabs(state, p.id, [...collabs]);
      return p;
    };
    share.addEventListener('click', () => {
      if (!items.length) return;
      try {
        const p = make(false);
        // (A few of the other accounts say something nice about it.)
        if (autoOn()) autoComment(state, p.id);
        save(); go(items[0].kind === 'video' ? { name: 'reels' } : { name: 'feed' });
      } catch (e) { err.textContent = e.message; }
    });
    saveDraft.addEventListener('click', () => { try { make(true); save(); toast('Saved to your drafts (your profile → ✎)'); go({ name: 'profile', id: m.id, grid: 'drafts' }); } catch (e) { err.textContent = e.message; } });
    if (items.length) requestAnimationFrame(show);
    return el('div', {}, backBar(draft?.draft ? `Draft · @${m.handle}` : `New post as @${m.handle}`, draft?.draft ? { name: 'profile', id: m.id, grid: 'drafts' } : { name: 'feed' }),
      el('div', { class: 'so-pad so-new' }, el('label', { class: 'so-new-pick' }, prev, file), strip, el('div', { class: 'so-row' }, again, addLabel), caption, communityPicker(caption), tagBox, collabPicker(collabs, m.id, undefined, { set: tags, box: tagBox }), err, el('div', { class: 'so-row' }, saveDraft, share),
        draft?.draft ? el('button', { type: 'button', class: 'so-link so-danger-link', text: 'Delete draft', onclick: () => { if (confirm('Delete this draft?')) { removePost(state, draft.id); save(); go({ name: 'profile', id: m.id, grid: 'drafts' }); } } }) : null));
  }

  // ---- Editing a post: its caption, and its photo (through the editor again).
  function editPostView(id) {
    const p = postById(state, id); if (!p || p.by !== state.me) return feed();
    let img = null; const tags = new Set(p.tags ?? []); const collabs = new Set((p.collab ?? []).filter((c) => c.status !== 'declined').map((c) => c.id));
    const prev = el('div', { class: 'so-new-prev so-edit-prev' }, p.kind === 'video' ? el('video', { src: urlOf(p.video), poster: urlOf(p.image) ?? undefined, controls: true, playsinline: true }) : el('img', { src: urlOf(p.image), alt: 'The photo' }));
    const caption = el('textarea', { class: 'so-input', rows: '4', 'aria-label': 'Caption', maxlength: '2200' }); caption.value = p.caption;
    const err = el('p', { class: 'so-err', role: 'alert' });
    const tagBox = tagPicker(tags, p.by);
    const photo = p.kind === 'photo' && p.image ? el('button', { type: 'button', class: 'btn', text: 'Edit photo (fit, filter, adjust)', onclick: async () => { try { const b = await photoFrom(img ?? p.image, false); if (b) { img = b; prev.replaceChildren(el('img', { src: urlOf(b), alt: 'The photo' })); } } catch (e) { err.textContent = e.message; } } }) : null;
    return el('div', {}, backBar('Edit post', { name: 'post', id }),
      el('div', { class: 'so-pad so-new' }, prev, photo, caption, communityPicker(caption), tagBox, collabPicker(collabs, p.by, (cid) => p.collab?.find((c) => c.id === cid)?.status ?? null, { set: tags, box: tagBox }), err,
        el('button', { type: 'button', class: 'btn primary', text: 'Save', onclick: () => { editPost(state, id, { caption: caption.value, image: img, tags: [...new Set([...tags, ...collabs])] }); const sent = setCollabs(state, id, [...collabs]); save(); if (sent.length) toast(`Collab request sent to ${sent.map((x) => `@${accountById(state, x)?.handle}`).join(', ')}`); go({ name: 'post', id }); } })));
  }

  // ---- Reels: everyone's videos, one at a time, full height; swipe up for the next. Each plays when it's
  // in view (its sound on once you turn it on); tap to pause.
  let reelObserver = null;
  function reels() {
    // (Everyone's: in a shuffled order, the same while the app's open, new ones first; one account's: newest first.)
    let list = reelsOf(state, view.by ?? null);
    if (!view.by) {
      const ids = list.map((p) => p.id);
      if (!reelOrder) reelOrder = rankPosts(list).map((p) => p.id);
      const fresh = ids.filter((id) => !reelOrder.includes(id)); reelOrder = [...fresh, ...reelOrder.filter((id) => ids.includes(id))];
      const byId = new Map(list.map((p) => [p.id, p])); list = reelOrder.map((id) => byId.get(id)).filter(Boolean);
    }
    reelObserver?.disconnect();
    if (!list.length) return el('div', { class: 'so-empty' }, el('p', { class: 'so-empty-big', text: 'No reels yet' }), el('p', { class: 'muted', text: 'Videos posted from any of your accounts show here.' }), el('button', { type: 'button', class: 'btn primary', text: 'Post a video', onclick: () => go({ name: 'new' }) }));
    const vids = [];
    const wrap = el('div', { class: 'so-reels' }, list.map((p) => {
      const by = accountById(state, p.by); const liked = p.likes.includes(state.me);
      const v = p.video ? el('video', { class: 'so-reel-video', src: urlOf(p.video), poster: urlOf(p.image) ?? undefined, playsinline: true, loop: true, preload: 'metadata', 'aria-label': `Reel by ${by.handle}` }) : null;
      if (v) { v.muted = !reelSound; vids.push(v); v.addEventListener('click', () => { if (v.paused) v.play().catch(() => {}); else v.pause(); }); }
      const sound = el('button', { type: 'button', class: 'so-reel-btn so-reel-sound', 'aria-label': reelSound ? 'Sound off' : 'Sound on', text: reelSound ? '🔊' : '🔇', onclick: () => { reelSound = !reelSound; for (const x of vids) x.muted = !reelSound; for (const b of wrap.querySelectorAll('.so-reel-sound')) { b.textContent = reelSound ? '🔊' : '🔇'; b.setAttribute('aria-label', reelSound ? 'Sound off' : 'Sound on'); } if (reelSound) wrap.querySelector('video:not([data-off])')?.play().catch(() => {}); } });
      return el('section', { class: 'so-reel', 'data-post': p.id },
        v ?? el('div', { class: 'so-reel-missing' }, p.image ? el('img', { src: urlOf(p.image), alt: '' }) : null, el('p', { text: 'This video is on the device it was posted from (too big to sync).' })),
        el('div', { class: 'so-reel-side' },
          el('button', { type: 'button', class: `so-reel-btn${liked ? ' on' : ''}`, 'aria-label': liked ? 'Unlike' : 'Like', 'aria-pressed': String(liked), onclick: (e) => { const on = toggleLike(state, p.id, state.me); save(); const b = e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'Unlike' : 'Like'); b.querySelector('.so-reel-icon').textContent = on ? '♥' : '♡'; b.querySelector('.so-reel-n').textContent = countLabel(p.likes.length); } }, el('span', { class: 'so-reel-icon', text: liked ? '♥' : '♡' }), el('span', { class: 'so-reel-n', text: countLabel(p.likes.length) })),
          el('button', { type: 'button', class: 'so-reel-btn', 'aria-label': 'Comments', onclick: () => go({ name: 'post', id: p.id }) }, el('span', { class: 'so-reel-icon', text: '💬' }), el('span', { class: 'so-reel-n', text: countLabel(p.comments.length) })),
          el('button', { type: 'button', class: 'so-reel-btn', 'aria-label': 'Share', onclick: () => share(p) }, el('span', { class: 'so-reel-icon', text: '✈' })),
          saveBtn(p, 'so-reel-btn so-reel-save'),
          el('span', { class: 'so-reel-views', 'aria-label': `${viewsOf(p)} views`, text: `👁 ${countLabel(viewsOf(p))}` }),
          v ? sound : null),
        el('div', { class: 'so-reel-info' },
          el('button', { type: 'button', class: 'so-reel-by', onclick: () => go({ name: 'profile', id: by.id }) }, avatar(by, 's'), el('strong', { text: by.handle })),
          p.caption ? el('p', { class: 'so-reel-cap' }, ...captionNodes(p.caption)) : null, tagLine(p)));
    }));
    // (Pulled down at the top: shuffled again.)
    if (!view.by) {
      const hint = el('div', { class: 'so-pull', 'aria-hidden': 'true', text: '↻' }); wrap.prepend(hint);
      let y0 = null; let pulled = 0;
      const startAt = (y) => { y0 = wrap.scrollTop <= 0 ? y : null; pulled = 0; };
      const moveTo = (y) => { if (y0 == null) return; pulled = Math.max(0, y - y0); hint.style.height = `${Math.min(80, pulled * 0.6)}px`; hint.classList.toggle('ready', pulled > 90); };
      const endPull = () => { if (y0 != null && pulled > 90) { reelOrder = rankPosts(reelsOf(state)).map((p) => p.id); toast('Shuffled'); draw(); return; } y0 = null; hint.style.height = '0px'; hint.classList.remove('ready'); };
      wrap.addEventListener('touchstart', (e) => startAt(e.touches[0].clientY), { passive: true });
      wrap.addEventListener('touchmove', (e) => moveTo(e.touches[0].clientY), { passive: true });
      wrap.addEventListener('touchend', endPull);
      wrap.addEventListener('mousedown', (e) => startAt(e.clientY));
      wrap.addEventListener('mousemove', (e) => { if (e.buttons & 1) moveTo(e.clientY); });
      wrap.addEventListener('mouseup', endPull);
    }
    // (The one in view plays; the others stop.)
    if ('IntersectionObserver' in globalThis) {
      reelObserver = new IntersectionObserver((es) => { for (const e of es) { const v = e.target.querySelector('video'); if (!v) continue; if (e.isIntersecting && e.intersectionRatio > 0.6) { countView(e.target.dataset.post); v.removeAttribute('data-off'); v.muted = !reelSound; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); } else { v.setAttribute('data-off', ''); v.pause(); } } }, { root: wrap, threshold: [0, 0.6, 1] });
      requestAnimationFrame(() => { for (const s2 of wrap.querySelectorAll('.so-reel')) reelObserver.observe(s2); if (view.start) wrap.querySelector(`[data-post="${view.start}"]`)?.scrollIntoView({ block: 'start' }); });
    }
    return el('div', {}, view.by ? backBar(`@${accountById(state, view.by)?.handle ?? ''} · Reels`, { name: 'profile', id: view.by, grid: 'reels' }) : null, wrap);
  }

  // ---- Messages: the account in use's chats with the other accounts.
  function inbox() {
    const m = me(); const chats = conversationsOf(state, m.id);
    const others = accountsInOrder(state).filter((a) => a.id !== m.id && !chats.some((c) => c.other.id === a.id));
    return el('div', {}, backBar(`Messages · @${m.handle}`, { name: 'feed' }),
      chats.length ? el('div', { class: 'so-people' }, chats.map((c) => el('div', { class: 'so-person' },
        el('button', { type: 'button', class: 'so-person-main', 'aria-label': `Chat with @${c.other.handle}${c.unread ? `, ${c.unread} unread` : ''}`, onclick: () => go({ name: 'chat', id: c.other.id }) }, avatar(c.other, 'm'),
          el('span', { class: 'so-person-text' }, el('strong', { text: c.other.handle }), el('span', { class: `small${c.unread ? ' so-unread' : ' muted'}`, text: `${c.last.from === m.id ? 'You: ' : ''}${c.last.text ? c.last.text.slice(0, 60) : c.last.collab ? '🤝 Collab request' : 'Shared a post'} · ${timeAgo(c.last.at)}` }))),
        c.unread ? el('span', { class: 'so-badge so-badge-inline', 'aria-hidden': 'true', text: String(c.unread) }) : null)))
        : el('p', { class: 'muted so-pad', text: 'No messages yet.' }),
      others.length ? el('div', {}, el('h3', { class: 'so-section', text: 'New message' }), el('div', { class: 'so-people' }, others.map((a) => el('div', { class: 'so-person' },
        el('button', { type: 'button', class: 'so-person-main', 'aria-label': `Message @${a.handle}`, onclick: () => go({ name: 'chat', id: a.id }) }, avatar(a, 'm'), el('span', { class: 'so-person-text' }, el('strong', {}, a.handle, a.owner ? el('span', { class: 'so-owner', text: 'Owner' }) : null), el('span', { class: 'muted small', text: a.name || 'Send a message' }))))))) : null,
      state.accounts.length < 2 ? el('p', { class: 'muted so-pad small', text: 'Make another account to message it (Accounts → Add account); switch to it to answer.' }) : null);
  }

  /** A collab request in a message: the post, and for the one asked, Accept and Decline. */
  function collabCard(x, m) {
    const p = postById(state, x.collab); const by = p && accountById(state, p.by);
    if (!p || !by) return el('div', { class: 'so-shared so-shared-gone', text: 'This post is no longer here.' });
    const c = p.collab?.find((q) => q.id === x.to); const asked = accountById(state, x.to);
    const status = !c ? 'gone' : c.status;
    const line = x.to === m.id
      ? (status === 'pending' ? `@${by.handle} invited you to collaborate on this post` : status === 'accepted' ? 'You accepted: it\'s on your profile' : status === 'declined' ? 'You declined' : 'No longer invited')
      : (status === 'pending' ? `Collab request sent to @${asked?.handle}` : status === 'accepted' ? `@${asked?.handle} accepted` : status === 'declined' ? `@${asked?.handle} declined` : 'Invitation taken back');
    return el('div', { class: 'so-collab-card' },
      el('div', { class: 'so-collab-title', text: '🤝 Collab request' }), sharedCard(p.id), el('div', { class: 'so-collab-line', text: line }),
      x.to === m.id && status === 'pending' ? el('div', { class: 'so-row' },
        el('button', { type: 'button', class: 'btn small primary', text: 'Accept', onclick: () => { answerCollab(state, p.id, m.id, true); save(); toast('It\'s on your profile now'); draw(); } }),
        el('button', { type: 'button', class: 'btn small', text: 'Decline', onclick: () => { answerCollab(state, p.id, m.id, false); save(); draw(); } })) : null);
  }

  /** A post shared in a message: its picture, who posted it, the start of its caption; opens it. */
  function sharedCard(id) {
    const p = postById(state, id); const by = p && accountById(state, p.by);
    if (!p || !by) return el('div', { class: 'so-shared so-shared-gone', text: 'This post is no longer here.' });
    return el('button', { type: 'button', class: 'so-shared', 'aria-label': `Shared post by @${by.handle}${p.caption ? `: ${p.caption.slice(0, 60)}` : ''}`, onclick: () => go(p.kind === 'video' ? { name: 'reels', start: p.id } : { name: 'post', id: p.id }) },
      el('span', { class: 'so-shared-by' }, avatar(by, 's'), el('strong', { text: by.handle })),
      p.image ? el('img', { src: urlOf(p.image), alt: '' }) : null,
      p.kind === 'video' ? el('span', { class: 'so-shared-badge', 'aria-hidden': 'true', text: '▶︎' }) : null,
      p.caption ? el('span', { class: 'so-shared-cap', text: p.caption.slice(0, 90) }) : null);
  }

  function chat(otherId) {
    const m = me(); const o = accountById(state, otherId); if (!o || o.id === m.id) return inbox();
    const msgs = conversation(state, m.id, o.id);
    if (msgs.length) { markRead(state, m.id, o.id, msgs[msgs.length - 1].at); saveState(state); }
    const list = el('div', { class: 'so-chat', role: 'log', 'aria-label': `Messages with @${o.handle}` });
    let lastDay = '';
    for (const x of msgs) {
      const day = new Date(x.at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      if (day !== lastDay) { list.append(el('div', { class: 'so-chat-day', text: day })); lastDay = day; }
      list.append(el('div', { class: `so-bubble${x.from === m.id ? ' mine' : ''}${x.post ? ' so-bubble-post' : ''}`, title: new Date(x.at).toLocaleString() }, x.post ? sharedCard(x.post) : null, x.collab ? collabCard(x, m) : null, x.text || null, el('span', { class: 'so-bubble-time', text: new Date(x.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })));
    }
    if (!msgs.length) list.append(el('p', { class: 'muted so-pad', text: `Say hi to @${o.handle}. (Switch to @${o.handle} to answer as them.)` }));
    const input = el('input', { class: 'so-input', type: 'text', placeholder: 'Message…', 'aria-label': 'Message', maxlength: '2000', enterkeyhint: 'send' });
    const send = () => { if (sendMessage(state, m.id, o.id, input.value)) { save(); draw(); main.querySelector('.so-chat-bar input')?.focus(); } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    // (The Owner just said something: ✨ a reply from the other account, to what was said.)
    const last = msgs[msgs.length - 1];
    if (m.owner && last && last.from === m.id && (last.text || last.post)) {
      const lastText = last.text || postById(state, last.post)?.caption || '';
      list.append(el('div', { class: 'so-gen so-gen-reply' }, el('button', { type: 'button', class: 'btn so-gen-btn', text: `✨ Generate reply from @${o.handle}`, onclick: () => {
        const r = sendMessage(state, o.id, m.id, generateReply(lastText));
        if (r) { markRead(state, m.id, o.id, r.at); save(); draw(); }
      } })));
    }
    return el('div', { class: 'so-chat-wrap' },
      el('div', { class: 'so-back' }, el('button', { type: 'button', class: 'so-act', 'aria-label': 'Back', text: '‹', onclick: () => go({ name: 'inbox' }) }),
        el('button', { type: 'button', class: 'so-chat-who', onclick: () => go({ name: 'profile', id: o.id }) }, avatar(o, 's'), el('strong', { text: o.handle })),
        el('button', { type: 'button', class: 'so-link so-chat-as', text: `Answer as @${o.handle}`, onclick: () => { useAccount(o.id); save(); go({ name: 'chat', id: m.id }); } })),
      list,
      el('div', { class: 'so-chat-bar' }, avatar(m, 's'), input, el('button', { type: 'button', class: 'so-link', text: 'Send', onclick: send })));
  }

  // ---- The password: asked first, every time the app starts.
  function gate() {
    fill(top, el('span', { class: 'so-logo', text: 'Socials' })); fill(tabs);
    const box = el('div', { class: 'so-pad so-welcome so-gate' }, el('div', { class: 'so-logo so-logo-big', text: 'Socials' }));
    fill(main, box);
    const pw = (label) => el('input', { class: 'so-input', type: 'password', autocomplete: 'off', 'aria-label': label, placeholder: label });
    const err = el('p', { class: 'so-err', role: 'alert' });
    const busy = (b, btn) => { btn.disabled = b; };
    const opened = (p) => { sessionOpen = true; sessionPw = p || null; start(); };
    // (A new password, after the recovery key opened the copy in Drive.)
    const newPassword = (rk) => {
      const a = pw('New password'); const b = pw('New password again');
      const go2 = el('button', { type: 'button', class: 'btn primary', text: 'Set password' });
      go2.addEventListener('click', async () => {
        err.textContent = ''; if (a.value !== b.value) { err.textContent = 'The two don\'t match.'; return; }
        if (a.value.length < 4) { err.textContent = 'Use at least 4 characters.'; return; }
        busy(true, go2);
        try { await changeRemotePassword(connected(), rk, a.value); await socialsLock.setPassword(a.value); opened(a.value); } catch (e) { err.textContent = e.message; busy(false, go2); }
      });
      fill(box, el('div', { class: 'so-logo so-logo-big', text: 'Socials' }), el('p', { class: 'muted', text: 'Recovery key accepted. Pick a new password for Socials (on your other devices too).' }), el('div', { class: 'so-form' }, a, b, err, go2));
    };
    if (socialsLock.hasPassword()) {
      const p = pw('Password'); const go2 = el('button', { type: 'button', class: 'btn primary', text: 'Open' });
      const submit = async () => {
        err.textContent = ''; const wait = socialsLock.waitLeft(); if (wait) { err.textContent = `Too many tries: wait ${wait}s.`; return; }
        busy(true, go2);
        if (await socialsLock.tryPassword(p.value)) { opened(p.value); return; }
        // (A recovery key, when Socials is in Drive: it opens that copy, then a new password.)
        if (isRecoveryKey(p.value) && connected()) { try { const h = await remoteHeader(connected()); if (h && await opens(h, p.value)) { newPassword(p.value); return; } } catch { /* offline */ } }
        err.textContent = socialsLock.waitLeft() ? `Too many tries: wait ${socialsLock.waitLeft()}s.` : 'Wrong password.'; busy(false, go2); p.select();
      };
      p.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }); go2.addEventListener('click', submit);
      // (Face ID, when it's set up: as well as the password.)
      const face = hasPasskey('socials') ? el('button', { type: 'button', class: 'btn so-faceid', text: '🔓 Use Face ID', onclick: async () => {
        err.textContent = ''; const r = await usePasskey('socials');
        if (r.ok) { socialsLock.openWithPasskey(); opened(r.secret); } else err.textContent = r.reason;
      } }) : null;
      box.append(el('p', { class: 'muted', text: 'Enter your Socials password.' }), el('div', { class: 'so-form' }, p, err, go2, face),
        el('p', { class: 'muted small', text: 'Forgot it? Enter the recovery key you saved instead (when Socials is synced to your Drive).' }));
      setTimeout(() => p.focus(), 50);
      return;
    }
    // (No password on this device yet: Socials may already be in Drive, from another device.)
    const create = (note) => {
      const a = pw('Password'); const b = pw('Password again'); const go2 = el('button', { type: 'button', class: 'btn primary', text: 'Set password' });
      go2.addEventListener('click', async () => {
        err.textContent = ''; if (a.value !== b.value) { err.textContent = 'The two don\'t match.'; return; }
        try { await socialsLock.setPassword(a.value); opened(a.value); } catch (e) { err.textContent = e.message; }
      });
      fill(box, el('div', { class: 'so-logo so-logo-big', text: 'Socials' }), el('p', { class: 'muted', text: note }), el('div', { class: 'so-form' }, a, b, err, go2));
    };
    const join = (header) => {
      const p = pw('Password or recovery key'); const go2 = el('button', { type: 'button', class: 'btn primary', text: 'Open' });
      const submit = async () => {
        err.textContent = ''; busy(true, go2);
        if (await opens(header, p.value)) {
          if (isRecoveryKey(p.value)) { newPassword(p.value); return; }
          await socialsLock.setPassword(p.value); opened(p.value); return;
        }
        err.textContent = 'That doesn\'t open it.'; busy(false, go2);
      };
      p.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }); go2.addEventListener('click', submit);
      fill(box, el('div', { class: 'so-logo so-logo-big', text: 'Socials' }), el('p', { class: 'muted', text: 'Your Socials is in your Drive (from another device). Enter its password to open it here.' }), el('div', { class: 'so-form' }, p, err, go2));
    };
    const api = connected();
    if (!api) { create('Set a password for Socials. It\'s asked each time the app starts. (Set up Saved Files to keep Socials on your other devices too, with the same password.)'); return; }
    box.append(el('p', { class: 'muted', text: 'Checking your Drive…' }));
    remoteHeader(api).then((h) => { if (!alive) return; if (h) join(h); else create('Set a password for Socials. It\'s asked each time the app starts, and it encrypts the copy kept in your Drive, so your other devices open it with the same password.'); })
      .catch(() => { if (!alive) return; create('Couldn\'t reach your Drive. If Socials is already on another device, try again when online and use its password; otherwise set one now.'); box.append(el('button', { type: 'button', class: 'btn', text: 'Try again', onclick: gate })); });
  }

  // ---- Sync and password settings.
  function settings() {
    const api = connected();
    const pw = (label) => el('input', { class: 'so-input', type: 'password', autocomplete: 'off', 'aria-label': label, placeholder: label });
    const err = el('p', { class: 'so-err', role: 'alert' }); const done = el('p', { class: 'muted small', role: 'status' });
    const cur = pw('Current password'); const n1 = pw('New password'); const n2 = pw('New password again');
    const change = el('button', { type: 'button', class: 'btn', text: 'Change password' });
    change.addEventListener('click', async () => {
      err.textContent = ''; done.textContent = '';
      if (n1.value !== n2.value) { err.textContent = 'The new passwords don\'t match.'; return; }
      if (n1.value.length < 4) { err.textContent = 'Use at least 4 characters.'; return; }
      if (!(await socialsLock.tryPassword(cur.value))) { err.textContent = 'The current password is wrong.'; return; }
      change.disabled = true;
      try {
        if (api) await changeRemotePassword(api, cur.value, n1.value);
        await socialsLock.setPassword(n1.value); sessionPw = n1.value;
        // (Face ID kept the old password: off, to set up again with the new one.)
        if (hasPasskey('socials') && passkeyOf('socials')?.prf) { removePasskey('socials'); toast('Face ID turned off with the old password: set it up again below.'); }
        cur.value = n1.value = n2.value = ''; done.textContent = api ? 'Password changed, here and for the copy in your Drive: use the new one on your other devices.' : 'Password changed.';
      } catch (e) { err.textContent = navigator.onLine === false ? 'You\'re offline: the password is changed in your Drive too, so it needs a connection.' : e.message; }
      change.disabled = false;
    });
    // (Another device changed the password: the new one, to keep syncing.)
    const fix = sync.wrong ? (() => {
      const p = pw('The password used on your other device'); const b = el('button', { type: 'button', class: 'btn primary', text: 'Use it' }); const e2 = el('p', { class: 'so-err', role: 'alert' });
      b.addEventListener('click', async () => { e2.textContent = ''; try { const h = await remoteHeader(api); if (h && await opens(h, p.value) && !isRecoveryKey(p.value)) { await socialsLock.setPassword(p.value); sessionPw = p.value; sync.wrong = false; runSync(); draw(); } else e2.textContent = 'That doesn\'t open it.'; } catch (x) { e2.textContent = x.message; } });
      return el('div', { class: 'so-form' }, el('p', { text: 'Socials in your Drive has a different password (changed on another device?). Enter it to keep syncing; it becomes this device\'s password too.' }), p, e2, b);
    })() : null;
    return el('div', {}, backBar('Sync and password', { name: 'feed' }),
      el('div', { class: 'so-pad so-settings' },
        el('h3', { text: 'Sync' }),
        el('p', { class: 'so-sync-msg', text: syncLine() }),
        waiting(),
        api ? el('p', { class: 'muted small', text: 'Kept in the Socials folder of your Saved Files (Google Drive), encrypted with your Socials password on this device first. Other devices with Saved Files set up open it with the same password.' })
          : el('p', { class: 'muted small', text: 'To keep Socials on your other devices, set up Saved Files (Settings → Saved Files), then open Socials there with the same password.' }),
        api ? el('button', { type: 'button', class: 'btn primary', text: 'Sync now', onclick: () => runSync() }) : null,
        fix,
        // (Opened by Face ID without the password: it, once, to sync on this device.)
        api && sessionOpen && !sessionPw ? (() => {
          const p = pw('Your Socials password'); const b = el('button', { type: 'button', class: 'btn primary', text: 'Sync with it' }); const e2 = el('p', { class: 'so-err', role: 'alert' });
          b.addEventListener('click', async () => { e2.textContent = ''; if (await socialsLock.tryPassword(p.value)) { sessionPw = p.value; runSync(); draw(); } else e2.textContent = 'Wrong password.'; });
          return el('div', { class: 'so-form' }, el('p', { class: 'small', text: 'Socials was opened with Face ID. Your password is needed once (until the app is closed) to sync with your Drive.' }), p, e2, b);
        })() : null,
        faceIdSection(),
        el('h3', { text: 'Password' }),
        el('div', { class: 'so-form' }, cur, n1, n2, err, done, change),
        // (What was deleted, for a week: brought back, or deleted for good.)
        (() => {
          const tr = trashOf(state);
          return el('div', { class: 'so-trash' }, el('h3', { text: `Recently deleted${tr.length ? ` (${tr.length})` : ''}` }),
            el('p', { class: 'muted small', text: `Deleted posts stay here for ${TRASH_DAYS} days, then they're gone for good.` }),
            tr.length ? tr.map(({ post: p, daysLeft }) => { const by = accountById(state, p.by); return el('div', { class: 'so-trash-row' },
              el('span', { class: 'so-trash-thumb' }, p.image ? el('img', { src: urlOf(p.image), alt: '' }) : el('span', { text: '📝' })),
              el('span', { class: 'so-person-text' }, el('strong', { text: `@${by?.handle ?? '?'}` }), el('span', { class: 'muted small', text: `${p.caption ? `${p.caption.slice(0, 40)} · ` : ''}${daysLeft} day${daysLeft === 1 ? '' : 's'} left` })),
              el('button', { type: 'button', class: 'btn small primary', text: 'Restore', 'aria-label': `Restore @${by?.handle}'s post`, onclick: () => { restorePost(state, p.id); save(); toast('Restored'); draw(); } }),
              el('button', { type: 'button', class: 'btn small', text: 'Delete', 'aria-label': `Delete @${by?.handle}'s post for good`, onclick: () => { if (confirm('Delete it for good? It can\'t be brought back.')) { removePost(state, p.id); save(); draw(); } } })); }) : el('p', { class: 'muted small', text: 'Nothing deleted.' }));
        })(),
        // (The Owner's: comments on each new post from three of the other accounts.)
        me()?.owner ? el('label', { class: 'so-switch-row' }, (() => { const c = el('input', { type: 'checkbox', checked: autoOn() }); c.addEventListener('change', () => store.set(AUTO_KEY, c.checked ? '1' : '0')); return c; })(),
          el('span', {}, el('strong', { text: 'Comments on new posts' }), el('span', { class: 'muted small', text: ' Three of your other accounts leave a kind word (with an emoji) on each new post.' }))) : null,
        el('h3', { text: 'Lock' }),
        el('button', { type: 'button', class: 'btn', text: '🔒 Lock Socials now', onclick: () => { sessionPw = null; sessionOpen = false; socialsLock.lock(); view = { name: 'feed' }; gate(); } })));
  }

  // ---- Face ID (a passkey) to open Socials, as well as its password.
  function faceIdSection() {
    if (!passkeysSupported()) return null;
    const box = el('div', { class: 'so-form so-faceid-set' }); const note = el('p', { class: 'muted small', role: 'status' });
    const on = hasPasskey('socials'); const k = passkeyOf('socials');
    const pwIn = !on && !sessionPw ? el('input', { class: 'so-input', type: 'password', autocomplete: 'off', 'aria-label': 'Your Socials password (for Face ID)', placeholder: 'Your Socials password' }) : null;
    const btn = el('button', { type: 'button', class: 'btn', text: on ? 'Turn off Face ID' : 'Set up Face ID', onclick: async () => {
      note.textContent = '';
      if (on) { removePasskey('socials'); draw(); return; }
      let secret = sessionPw;
      if (!secret) { if (!(await socialsLock.tryPassword(pwIn.value))) { note.textContent = 'Wrong password.'; return; } secret = pwIn.value; sessionPw = secret; }
      try { const r = await createPasskey('socials', 'Socials', { secret }); toast(r.prf ? 'Face ID now opens Socials (and syncs).' : 'Face ID now opens Socials.'); draw(); } catch (e) { note.textContent = e?.name === 'NotAllowedError' ? 'Cancelled.' : e.message; }
    } });
    box.append(el('h3', { text: 'Face ID' }),
      el('p', { class: 'small', text: on ? (k?.prf ? 'On: Face ID opens Socials and gives it what it needs to sync; your password works too.' : 'On: Face ID opens Socials; your password works too, and is asked for once to sync (this passkey can\'t keep it).') : 'Open Socials with Face ID (a passkey, kept in your phone\'s passwords) as well as your password.' }),
      pwIn, btn, note);
    deviceCanPasskey().then((ok) => { if (!ok && !on) note.textContent = 'This device may not have Face ID or a fingerprint for passkeys.'; });
    return box;
  }

  function recovery(key) {
    return el('div', { class: 'so-pad so-settings' },
      el('h3', { text: 'Your recovery key' }),
      el('p', { text: 'Socials is now kept in your Drive, encrypted. If you ever forget your password, this key opens it instead. Write it down or save it somewhere safe; it\'s shown only this once.' }),
      el('p', { class: 'so-key', text: key }),
      el('button', { type: 'button', class: 'btn primary', text: 'I\'ve saved it', onclick: () => go({ name: 'feed' }) }));
  }

  function draw() {
    if (!alive) return;
    if (!sessionOpen) { gate(); return; }
    drawBars();
    // (The recovery key, once, as soon as nothing's being made.)
    if (sync.pendingKey && ['feed', 'profile', 'people', 'explore', 'settings'].includes(view.name)) { view = { name: 'recovery', key: sync.pendingKey }; sync.pendingKey = null; }
    if (view.name === 'recovery') { fill(main, recovery(view.key)); return; }
    if (!me() && view.name !== 'settings') { fill(main, welcome()); return; }
    if (!me()) { fill(main, settings()); return; }
    const v = view;
    reelObserver?.disconnect();
    root.classList.toggle('so-in-reels', v.name === 'reels'); root.classList.toggle('so-in-chat', v.name === 'chat');
    // (Reels and a chat fill the screen below the bars: how far down they start.)
    if (v.name === 'reels' || v.name === 'chat') root.style.setProperty('--so-reels-top', `${Math.round(main.getBoundingClientRect().top + (globalThis.scrollY || 0))}px`);
    fill(main, v.name === 'settings' ? settings() : v.name === 'reels' ? reels() : v.name === 'inbox' ? inbox() : v.name === 'chat' ? chat(v.id) : v.name === 'editpost' ? editPostView(v.id) : v.name === 'tag' ? tagView(v.tag) : v.name === 'explore' ? explore() : v.name === 'new' ? newPost() : v.name === 'profile' ? profile(v.id ?? state.me)
      : v.name === 'post' ? onePost(v.id) : v.name === 'accounts' ? accounts() : v.name === 'newaccount' ? newAccount() : v.name === 'edit' ? edit() : v.name === 'people' ? people(v.id, v.kind) : feed());
  }

  // Opened: what's on this device, then a sync.
  let loaded = false;
  function start() {
    if (loaded) { draw(); runSync(); return; }
    fill(main, el('p', { class: 'muted so-pad', text: 'Loading…' }));
    // (If what's kept can't be read, nothing is shown or saved over it: an empty Socials saved now would replace it.)
    loadState().then((r) => { loaded = true; state = r.state; if (emptyOldTrash(state)) save(); draw(); runSync(); }).catch(() => { fill(main, el('div', { class: 'so-pad so-empty' }, el('p', { class: 'so-empty-big', text: 'Socials couldn\'t open what\'s kept on this device' }), el('p', { class: 'muted', text: 'Nothing has been changed. Close the app and open it again.' }), el('button', { type: 'button', class: 'btn', text: 'Try again', onclick: start }))); });
  }
  if (sessionOpen) start(); else gate();

  return () => { alive = false; reelObserver?.disconnect(); clearTimeout(sync.timer); globalThis.removeEventListener?.('online', onOnline); globalThis.removeEventListener?.('offline', onOffline); for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); };
}

/** A picked photo made ready to keep: at most `edge` px on its long side (or a centered square), as JPEG. */
async function prepare(file, edge, square) {
  const bmp = await decodeImage(file, await sniffType(file));
  try {
    const c = document.createElement('canvas'); const x = c.getContext('2d');
    if (square) {
      const s = Math.min(bmp.width, bmp.height); const n = Math.min(edge, s); c.width = c.height = n;
      x.imageSmoothingQuality = 'high'; x.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, n, n);
    } else {
      const f = fitSize(bmp.width, bmp.height, edge); c.width = f.width; c.height = f.height;
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, c.width, c.height);
    }
    return await canvasToBlob(c, 'image/jpeg', 0.88);
  } finally { bmp.close?.(); }
}
