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
import { syncSocials, remoteHeader, opens, changeRemotePassword, isRecoveryKey, WrongPassword, pendingFiles } from './socials-sync.js';
import { sniffType, decodeImage, fitSize, canvasToBlob } from '../../lib/image.js';
import { editPhoto, prepareVideo } from './socials-editor.js';
import {
  emptyState, normalize, addAccount, editAccount, removeAccount, accountById, toggleFollow, isFollowing,
  followersOf, followingOf, postsBy, addPost, removePost, postById, feedFor, toggleLike, addComment,
  searchAccounts, timeAgo, countLabel, handleProblem, mergeStates, accountsInOrder, setOwner, editPost,
  reelsOf, sendMessage, conversation, conversationsOf, markRead, unreadCount, taggedIn, captionParts,
} from './socials-core.js';
import { handoff } from '../../lib/handoff.js';

// (What's waiting for Drive, kept on the phone so a refresh or closing the app doesn't lose track of it:
// which photos and videos Drive had at the last sync, and whether anything changed since.)
const DRIVE_KEY = 'cc.socials.drive';
const DIRTY_KEY = 'cc.socials.dirty';
export const socialsLock = makeLock('cc.socials.lock', 'cc.socials.open');
// The password, once entered, for as long as the app is open (it opens the copy in Drive): forgotten on a
// reload or when the app is closed, so it's asked again then.
let sessionPw = null;
// (Reels' sound: off until it's turned on once, then on for each reel while the app is open.)
let reelSound = false;
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
    const api = connected(); if (!api || !sessionPw || !alive) { sync.msg = api ? '' : 'Not set up'; return; }
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
      const got = new Map(); const each = (st, fn) => { for (const a of st.accounts) fn(a, 'avatar', 'avatarId'); for (const p of st.posts) { fn(p, 'image', 'imageId'); fn(p, 'video', 'videoId'); } };
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
    if (p.kind === 'video') {
      if (!p.video) return el('div', { class: 'so-pic so-novideo' }, p.image ? el('img', { src: urlOf(p.image), alt: '' }) : null, el('span', { text: 'This video is on the device it was posted from (too big to sync).' }));
      return el('div', { class: 'so-pic so-vid' }, el('video', { src: urlOf(p.video), poster: urlOf(p.image) ?? undefined, controls: true, playsinline: true, preload: 'metadata', 'aria-label': `Video by ${by.handle}` }));
    }
    // (A photo whose file couldn't be read on this device: said so, not a broken picture. With Saved Files, the
    // copy in Drive brings it back at the next sync.)
    if (!p.image) return p.imageId ? lostPhoto() : null;
    let lastTap = 0;
    const box = el('div', { class: 'so-pic', ondblclick: () => like(), onpointerup: () => { const t = Date.now(); if (t - lastTap < 300) like(); lastTap = t; } }, el('img', { src: urlOf(p.image), alt: p.caption ? `Photo: ${p.caption.slice(0, 80)}` : `Photo by ${by.handle}`, onerror: () => box.replaceWith(lostPhoto()) }));
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
  const captionNodes = (text) => captionParts(state, text).map((x) => (x.account ? handleBtn(x.account, 'so-handle so-mention') : x.text));

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
    if (!mine && !canOpen) return null;
    return el('button', { type: 'button', class: 'so-more', 'aria-label': 'Post options', text: '⋯', onclick: async () => {
      const c = await sheet('Post options', [...(canOpen ? [['open', 'Open in…']] : []), ...(mine ? [['edit', 'Edit'], ['delete', 'Delete', true]] : [])]);
      if (c === 'edit') go({ name: 'editpost', id: p.id });
      if (c === 'delete' && confirm('Delete this post?')) { removePost(state, p.id); save(); if (view.name === 'post') go({ name: 'profile', id: by.id }); else draw(); }
      if (c === 'open') openIn(p, by);
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
  function tagPicker(selected, author) {
    const box = el('div', { class: 'so-tagpick', role: 'group', 'aria-label': 'Tag people' });
    const drawPick = () => fill(box, el('span', { class: 'so-tagpick-label', text: '👤 Tag people' }),
      accountsInOrder(state).filter((a) => a.id !== author).map((a) => el('button', { type: 'button', class: `so-chip${selected.has(a.id) ? ' on' : ''}`, 'aria-pressed': String(selected.has(a.id)), text: `@${a.handle}`, onclick: () => { if (selected.has(a.id)) selected.delete(a.id); else selected.add(a.id); drawPick(); } })),
      accountsInOrder(state).length < 2 ? el('span', { class: 'muted small', text: 'Make another account to tag it.' }) : null);
    drawPick(); return box;
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
    return el('article', { class: 'so-post', 'data-post': p.id },
      el('div', { class: 'so-post-head' }, el('button', { type: 'button', class: 'so-avbtn', 'aria-label': `@${by.handle}`, onclick: () => go({ name: 'profile', id: by.id }) }, avatar(by, 's')), handleBtn(by), el('span', { class: 'so-dot muted', text: `• ${timeAgo(p.at)}${p.edited ? ' · edited' : ''}` }), menu),
      pic,
      el('div', { class: 'so-actions' }, heart, el('button', { type: 'button', class: 'so-act', 'aria-label': 'Comments', text: '💬', onclick: () => go({ name: 'post', id: p.id }) }), el('button', { type: 'button', class: 'so-act so-share', 'aria-label': 'Share', text: '✈', onclick: () => share(p) })),
      tagLine(p),
      p.likes.length ? el('div', { class: 'so-likes', text: `${countLabel(p.likes.length)} like${p.likes.length === 1 ? '' : 's'}` }) : null,
      p.caption ? el('p', { class: 'so-caption' }, handleBtn(by), ' ', ...captionNodes(p.caption)) : null,
      !full && p.comments.length > 2 ? el('button', { type: 'button', class: 'so-link muted', text: `View all ${p.comments.length} comments`, onclick: () => go({ name: 'post', id: p.id }) }) : null,
      ...shown.map((c) => { const a = accountById(state, c.by); return a ? el('p', { class: 'so-comment' }, handleBtn(a), ' ', c.text, full ? el('span', { class: 'muted small', text: `  ${timeAgo(c.at)}` }) : null) : null; }),
      commentBox);
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
    const m = me(); const items = feedFor(state, m.id);
    const follows = followingOf(state, m.id);
    const row = el('div', { class: 'so-stories', role: 'list', 'aria-label': 'Accounts you follow' },
      [m, ...follows].map((a) => el('button', { type: 'button', role: 'listitem', class: 'so-story', onclick: () => go({ name: 'profile', id: a.id }) }, el('span', { class: 'so-ring' }, avatar(a, 'l')), el('span', { class: 'so-story-name', text: a.id === m.id ? 'Your profile' : a.handle }))));
    return el('div', {}, row,
      items.length ? items.map((p) => postCard(p))
        : el('div', { class: 'so-empty' },
          el('p', { class: 'so-empty-big', text: 'Welcome to your feed' }),
          el('p', { class: 'muted', text: follows.length ? 'No posts yet from the accounts you follow.' : 'Follow accounts to see their posts here, or share your first post.' }),
          el('div', { class: 'so-row' }, el('button', { type: 'button', class: 'btn primary', text: 'New post', onclick: () => go({ name: 'new' }) }), el('button', { type: 'button', class: 'btn', text: 'Find accounts', onclick: () => go({ name: 'explore' }) }))));
  }

  function explore() {
    const q = el('input', { class: 'so-input so-search', type: 'search', placeholder: 'Search', 'aria-label': 'Search accounts', value: view.q ?? '' });
    const list = el('div', { class: 'so-people' });
    const grid = el('div', { class: 'so-grid' });
    const show = () => {
      view.q = q.value;
      const s = q.value.trim();
      fill(list, s ? searchAccounts(state, s).map(personRow) : null);
      fill(grid, s ? null : [...state.posts].filter((p) => p.image || p.video).sort((a, b) => b.at - a.at).map(tile));
      if (s && !list.childElementCount) list.append(el('p', { class: 'muted so-pad', text: 'No accounts found.' }));
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

  const tile = (p) => el('button', { type: 'button', class: 'so-tile', 'aria-label': `${p.kind === 'video' ? 'Video' : 'Post'} by ${accountById(state, p.by)?.handle}${p.caption ? `: ${p.caption.slice(0, 60)}` : ''}`, onclick: () => go(p.kind === 'video' ? { name: 'reels', start: p.id, by: view.name === 'profile' ? p.by : null } : { name: 'post', id: p.id }) },
    p.image ? el('img', { src: urlOf(p.image), alt: '' }) : el('span', { class: 'so-tile-text', text: p.caption }),
    p.kind === 'video' ? el('span', { class: 'so-tile-badge', 'aria-hidden': 'true', text: '▶︎' }) : null);

  function profile(id) {
    const a = accountById(state, id); if (!a) return feed();
    const mine = a.id === state.me; const all = postsBy(state, a.id);
    const grid = view.grid ?? 'posts'; const showReels = grid === 'reels';
    const posts = grid === 'reels' ? all.filter((p) => p.kind === 'video') : grid === 'tagged' ? taggedIn(state, a.id) : all;
    const f = isFollowing(state, state.me, a.id);
    const stat = (n, label, v) => el('button', { type: 'button', class: 'so-stat', onclick: v ? () => go(v) : null }, el('strong', { text: countLabel(n) }), el('span', { text: label }));
    return el('div', {},
      el('div', { class: 'so-pad so-prof' },
        el('div', { class: 'so-prof-top' }, avatar(a, 'xl'),
          el('div', { class: 'so-stats' }, stat(all.length, 'posts'), stat(followersOf(state, a.id).length, 'followers', { name: 'people', id: a.id, kind: 'followers' }), stat(a.following.length, 'following', { name: 'people', id: a.id, kind: 'following' }))),
        el('div', { class: 'so-prof-handle' }, `@${a.handle}`, a.owner ? el('span', { class: 'so-owner', text: 'Owner' }) : null),
        a.name ? el('div', { class: 'so-prof-name', text: a.name }) : null,
        a.bio ? el('p', { class: 'so-bio', text: a.bio }) : null,
        el('div', { class: 'so-row' }, mine
          ? [el('button', { type: 'button', class: 'btn', text: 'Edit profile', onclick: () => go({ name: 'edit' }) }), el('button', { type: 'button', class: 'btn', text: 'Switch account', onclick: () => go({ name: 'accounts' }) })]
          : [el('button', { type: 'button', class: `btn${f ? '' : ' primary'}`, text: f ? 'Following' : 'Follow', onclick: () => { toggleFollow(state, state.me, a.id); save(); draw(); } }), el('button', { type: 'button', class: 'btn', text: 'Message', onclick: () => go({ name: 'chat', id: a.id }) }), el('button', { type: 'button', class: 'btn', text: 'Use this account', onclick: () => { state.me = a.id; save(); draw(); } })])),
      el('div', { class: 'so-ptabs', role: 'tablist' },
        [['posts', 'Posts', '▦'], ['reels', 'Reels', '▶︎'], ['tagged', 'Tagged', '👤']].map(([g, label, icon]) => el('button', { type: 'button', role: 'tab', class: `so-ptab${grid === g ? ' on' : ''}`, 'aria-selected': String(grid === g), 'aria-label': label, text: icon, onclick: () => go({ ...view, grid: g }) }))),
      posts.length ? el('div', { class: 'so-grid' }, posts.map(tile)) : el('div', { class: 'so-empty' }, el('p', { class: 'so-empty-big', text: showReels ? 'No reels yet' : grid === 'tagged' ? 'No tagged posts yet' : 'No posts yet' }), mine && grid !== 'tagged' ? el('button', { type: 'button', class: 'btn primary', text: 'Share your first post', onclick: () => go({ name: 'new' }) }) : null));
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
    return el('div', {}, backBar('Post', { name: 'profile', id: p.by }), postCard(p, { full: true }));
  }

  // (Picking the account to use: the Owner always first, on its own, then the others.)
  function accounts() {
    const row = (a) => el('div', { class: `so-person${a.owner ? ' so-owner-row' : ''}` },
      el('button', { type: 'button', class: 'so-person-main', 'aria-label': `Use @${a.handle}${a.owner ? ' (Owner)' : ''}`, onclick: () => { state.me = a.id; save(); go({ name: 'feed' }); } }, avatar(a, 'm'), el('span', { class: 'so-person-text' }, el('strong', {}, a.handle, a.owner ? el('span', { class: 'so-owner', text: 'Owner' }) : null), el('span', { class: 'muted small', text: a.name || ' ' }))),
      unreadCount(state, a.id) ? el('span', { class: 'so-badge so-badge-inline', 'aria-label': `${unreadCount(state, a.id)} unread messages`, text: String(unreadCount(state, a.id)) }) : null,
      a.id === state.me ? el('span', { class: 'so-check', 'aria-label': 'In use', text: '✓' }) : null);
    const list = accountsInOrder(state); const owner = list.filter((a) => a.owner); const others = list.filter((a) => !a.owner);
    return el('div', {}, backBar('Accounts', { name: 'feed' }),
      el('h3', { class: 'so-section', text: 'Owner' }), el('div', { class: 'so-people' }, owner.map(row)),
      el('h3', { class: 'so-section', text: 'Other accounts' }),
      others.length ? el('div', { class: 'so-people' }, others.map(row)) : el('p', { class: 'muted so-pad', text: 'None yet: add one below.' }),
      el('div', { class: 'so-pad' }, el('h3', { text: 'Add account' }), accountForm(null)));
  }

  // ---- Making or editing an account.
  function accountForm(a) {
    let pic = a?.avatar ?? null; let changed = false;
    const prev = el('span', { class: 'so-form-av' });
    const showPic = () => fill(prev, pic ? el('img', { class: 'so-av so-av-l', src: urlOf(pic), alt: '' }) : el('span', { class: 'so-av so-av-l so-av-none', text: '+' }));
    showPic();
    const file = el('input', { type: 'file', accept: 'image/*', class: 'so-file', 'aria-label': 'Profile picture' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0]; file.value = ''; if (!f) return;
      try { const b = await photoFrom(f, true); if (b) { pic = b; changed = true; showPic(); } } catch (e) { err.textContent = e.message; }
    });
    const handle = el('input', { class: 'so-input', type: 'text', placeholder: 'Username', 'aria-label': 'Username', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', maxlength: '30', value: a?.handle ?? '' });
    const name = el('input', { class: 'so-input', type: 'text', placeholder: 'Name', 'aria-label': 'Name', maxlength: '60', value: a?.name ?? '' });
    const bio = el('textarea', { class: 'so-input', rows: '3', placeholder: 'Bio', 'aria-label': 'Bio', maxlength: '300' }); bio.value = a?.bio ?? '';
    const err = el('p', { class: 'so-err', role: 'alert' });
    const submit = () => {
      err.textContent = '';
      const p = handleProblem(state, handle.value, a?.id ?? null); if (p) { err.textContent = p; return; }
      if (a) { editAccount(state, a.id, { handle: handle.value, name: name.value, bio: bio.value, ...(changed ? { avatar: pic } : {}) }); save(); go({ name: 'profile', id: a.id }); }
      else { const n = addAccount(state, { handle: handle.value, name: name.value, bio: bio.value, avatar: pic }); state.me = n.id; save(); go({ name: 'feed' }); }
    };
    return el('div', { class: 'so-form' },
      el('label', { class: 'so-form-pic' }, prev, el('span', { class: 'so-link', text: a?.avatar ? 'Change profile photo' : 'Add profile photo' }), file),
      handle, name, bio, err,
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

  // ---- A new post: a photo (edited first) or a video (with its sound).
  function newPost() {
    const m = me(); let img = null; let original = null; let vid = null; const tags = new Set();
    const prev = el('div', { class: 'so-new-prev' }, el('span', { class: 'muted', text: 'Pick a photo or video' }));
    const file = el('input', { type: 'file', accept: 'image/*,video/*', class: 'so-file', 'aria-label': 'Photo or video' });
    const caption = el('textarea', { class: 'so-input', rows: '3', placeholder: 'Write a caption…', 'aria-label': 'Caption', maxlength: '2200' });
    const err = el('p', { class: 'so-err', role: 'alert' });
    const share = el('button', { type: 'button', class: 'btn primary', text: 'Share', disabled: true });
    const again = el('button', { type: 'button', class: 'btn', text: 'Edit photo', hidden: true });
    const showPhoto = () => { prev.replaceChildren(el('img', { src: urlOf(img), alt: 'Your photo' })); share.disabled = false; again.hidden = false; };
    const editIt = async () => { const b = await photoFrom(original, false); if (b) { img = b; showPhoto(); } };
    again.addEventListener('click', () => editIt().catch((e) => { err.textContent = e.message; }));
    file.addEventListener('change', async () => {
      const f = file.files?.[0]; file.value = ''; if (!f) return; err.textContent = ''; img = vid = null; share.disabled = true; again.hidden = true;
      prev.replaceChildren(el('span', { class: 'muted', text: 'Opening…' }));
      try {
        if (/^video\//.test(f.type) || /\.(mov|mp4|m4v|webm)$/i.test(f.name)) {
          if (f.size > MAX_VIDEO) throw new Error(`That video is too big (${Math.round(f.size / 1048576)} MB; ${MAX_VIDEO / 1048576} MB at most).`);
          vid = await prepareVideo(f);
          prev.replaceChildren(el('video', { src: urlOf(vid.video), poster: urlOf(vid.still), controls: true, playsinline: true, 'aria-label': 'Your video' }));
          if (f.size > 24 * 1048576 && connected()) err.textContent = 'This video is over 24 MB: it stays on this device and won\'t play on your other devices.';
          share.disabled = false;
        } else {
          original = f; img = await photoFrom(f, false);
          if (img) showPhoto(); else prev.replaceChildren(el('span', { class: 'muted', text: 'Pick a photo or video' }));
        }
      } catch (e) { img = vid = null; prev.replaceChildren(el('span', { class: 'muted', text: 'Pick a photo or video' })); err.textContent = e.message; }
    });
    share.addEventListener('click', () => {
      try { addPost(state, m.id, vid ? { image: vid.still, video: vid.video, caption: caption.value, tags: [...tags] } : { image: img, caption: caption.value, tags: [...tags] }); save(); go(vid ? { name: 'reels' } : { name: 'feed' }); } catch (e) { err.textContent = e.message; }
    });
    return el('div', {}, backBar(`New post as @${m.handle}`, { name: 'feed' }),
      el('div', { class: 'so-pad so-new' }, el('label', { class: 'so-new-pick' }, prev, file), again, caption, tagPicker(tags, m.id), err, share));
  }

  // ---- Editing a post: its caption, and its photo (through the editor again).
  function editPostView(id) {
    const p = postById(state, id); if (!p || p.by !== state.me) return feed();
    let img = null; const tags = new Set(p.tags ?? []);
    const prev = el('div', { class: 'so-new-prev so-edit-prev' }, p.kind === 'video' ? el('video', { src: urlOf(p.video), poster: urlOf(p.image) ?? undefined, controls: true, playsinline: true }) : el('img', { src: urlOf(p.image), alt: 'The photo' }));
    const caption = el('textarea', { class: 'so-input', rows: '4', 'aria-label': 'Caption', maxlength: '2200' }); caption.value = p.caption;
    const err = el('p', { class: 'so-err', role: 'alert' });
    const photo = p.kind === 'photo' && p.image ? el('button', { type: 'button', class: 'btn', text: 'Edit photo (fit, filter, adjust)', onclick: async () => { try { const b = await photoFrom(img ?? p.image, false); if (b) { img = b; prev.replaceChildren(el('img', { src: urlOf(b), alt: 'The photo' })); } } catch (e) { err.textContent = e.message; } } }) : null;
    return el('div', {}, backBar('Edit post', { name: 'post', id }),
      el('div', { class: 'so-pad so-new' }, prev, photo, caption, tagPicker(tags, p.by), err,
        el('button', { type: 'button', class: 'btn primary', text: 'Save', onclick: () => { editPost(state, id, { caption: caption.value, image: img, tags: [...tags] }); save(); go({ name: 'post', id }); } })));
  }

  // ---- Reels: everyone's videos, one at a time, full height; swipe up for the next. Each plays when it's
  // in view (its sound on once you turn it on); tap to pause.
  let reelObserver = null;
  function reels() {
    const list = reelsOf(state, view.by ?? null);
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
          v ? sound : null),
        el('div', { class: 'so-reel-info' },
          el('button', { type: 'button', class: 'so-reel-by', onclick: () => go({ name: 'profile', id: by.id }) }, avatar(by, 's'), el('strong', { text: by.handle })),
          p.caption ? el('p', { class: 'so-reel-cap' }, ...captionNodes(p.caption)) : null, tagLine(p)));
    }));
    // (The one in view plays; the others stop.)
    if ('IntersectionObserver' in globalThis) {
      reelObserver = new IntersectionObserver((es) => { for (const e of es) { const v = e.target.querySelector('video'); if (!v) continue; if (e.isIntersecting && e.intersectionRatio > 0.6) { v.removeAttribute('data-off'); v.muted = !reelSound; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); } else { v.setAttribute('data-off', ''); v.pause(); } } }, { root: wrap, threshold: [0, 0.6, 1] });
      requestAnimationFrame(() => { for (const s2 of wrap.children) reelObserver.observe(s2); if (view.start) wrap.querySelector(`[data-post="${view.start}"]`)?.scrollIntoView({ block: 'start' }); });
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
          el('span', { class: 'so-person-text' }, el('strong', { text: c.other.handle }), el('span', { class: `small${c.unread ? ' so-unread' : ' muted'}`, text: `${c.last.from === m.id ? 'You: ' : ''}${c.last.text ? c.last.text.slice(0, 60) : 'Shared a post'} · ${timeAgo(c.last.at)}` }))),
        c.unread ? el('span', { class: 'so-badge so-badge-inline', 'aria-hidden': 'true', text: String(c.unread) }) : null)))
        : el('p', { class: 'muted so-pad', text: 'No messages yet.' }),
      others.length ? el('div', {}, el('h3', { class: 'so-section', text: 'New message' }), el('div', { class: 'so-people' }, others.map((a) => el('div', { class: 'so-person' },
        el('button', { type: 'button', class: 'so-person-main', 'aria-label': `Message @${a.handle}`, onclick: () => go({ name: 'chat', id: a.id }) }, avatar(a, 'm'), el('span', { class: 'so-person-text' }, el('strong', {}, a.handle, a.owner ? el('span', { class: 'so-owner', text: 'Owner' }) : null), el('span', { class: 'muted small', text: a.name || 'Send a message' }))))))) : null,
      state.accounts.length < 2 ? el('p', { class: 'muted so-pad small', text: 'Make another account to message it (Accounts → Add account); switch to it to answer.' }) : null);
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
      list.append(el('div', { class: `so-bubble${x.from === m.id ? ' mine' : ''}${x.post ? ' so-bubble-post' : ''}`, title: new Date(x.at).toLocaleString() }, x.post ? sharedCard(x.post) : null, x.text || null, el('span', { class: 'so-bubble-time', text: new Date(x.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })));
    }
    if (!msgs.length) list.append(el('p', { class: 'muted so-pad', text: `Say hi to @${o.handle}. (Switch to @${o.handle} to answer as them.)` }));
    const input = el('input', { class: 'so-input', type: 'text', placeholder: 'Message…', 'aria-label': 'Message', maxlength: '2000', enterkeyhint: 'send' });
    const send = () => { if (sendMessage(state, m.id, o.id, input.value)) { save(); draw(); main.querySelector('.so-chat-bar input')?.focus(); } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    return el('div', { class: 'so-chat-wrap' },
      el('div', { class: 'so-back' }, el('button', { type: 'button', class: 'so-act', 'aria-label': 'Back', text: '‹', onclick: () => go({ name: 'inbox' }) }),
        el('button', { type: 'button', class: 'so-chat-who', onclick: () => go({ name: 'profile', id: o.id }) }, avatar(o, 's'), el('strong', { text: o.handle })),
        el('button', { type: 'button', class: 'so-link so-chat-as', text: `Answer as @${o.handle}`, onclick: () => { state.me = o.id; save(); go({ name: 'chat', id: m.id }); } })),
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
    const opened = (p) => { sessionPw = p; start(); };
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
      box.append(el('p', { class: 'muted', text: 'Enter your Socials password.' }), el('div', { class: 'so-form' }, p, err, go2),
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
        el('h3', { text: 'Password' }),
        el('div', { class: 'so-form' }, cur, n1, n2, err, done, change),
        el('h3', { text: 'Lock' }),
        el('button', { type: 'button', class: 'btn', text: '🔒 Lock Socials now', onclick: () => { sessionPw = null; socialsLock.lock(); view = { name: 'feed' }; gate(); } })));
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
    if (!sessionPw) { gate(); return; }
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
    fill(main, v.name === 'settings' ? settings() : v.name === 'reels' ? reels() : v.name === 'inbox' ? inbox() : v.name === 'chat' ? chat(v.id) : v.name === 'editpost' ? editPostView(v.id) : v.name === 'explore' ? explore() : v.name === 'new' ? newPost() : v.name === 'profile' ? profile(v.id ?? state.me)
      : v.name === 'post' ? onePost(v.id) : v.name === 'accounts' ? accounts() : v.name === 'edit' ? edit() : v.name === 'people' ? people(v.id, v.kind) : feed());
  }

  // Opened: what's on this device, then a sync.
  let loaded = false;
  function start() {
    if (loaded) { draw(); runSync(); return; }
    fill(main, el('p', { class: 'muted so-pad', text: 'Loading…' }));
    // (If what's kept can't be read, nothing is shown or saved over it: an empty Socials saved now would replace it.)
    loadState().then((r) => { loaded = true; state = r.state; draw(); runSync(); }).catch(() => { fill(main, el('div', { class: 'so-pad so-empty' }, el('p', { class: 'so-empty-big', text: 'Socials couldn\'t open what\'s kept on this device' }), el('p', { class: 'muted', text: 'Nothing has been changed. Close the app and open it again.' }), el('button', { type: 'button', class: 'btn', text: 'Try again', onclick: start }))); });
  }
  if (sessionPw) start(); else gate();

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
