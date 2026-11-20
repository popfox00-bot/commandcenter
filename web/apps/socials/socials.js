// Socials: a photo-sharing app laid out like the familiar ones (a feed of square-ish photo posts, a row of
// accounts across the top, a tab bar at the bottom: Home, Search, New post, Profile), where everything is
// yours and made here. Make accounts, switch between them, post photos from any of them, follow one from
// another, like and comment; Home shows the posts of the accounts the one you're using follows. All of it is
// kept on this phone (IndexedDB, photos included) and stays after a reload.
// Behind its own password (as the hidden area is: only a salted hash kept), asked each time the app starts.
// With Saved Files set up, it's also kept in your own Google Drive, encrypted with that password on the
// phone first, so your other devices open the same Socials with the same password (socials-sync.js).

import { el, fill } from '../../lib/dom.js';
import { idb } from '../../lib/idb.js';
import { makeLock } from '../../lib/hidden-lock.js';
import { connected } from '../../lib/saved-files.js';
import { syncSocials, remoteHeader, opens, changeRemotePassword, isRecoveryKey, WrongPassword } from './socials-sync.js';
import { sniffType, decodeImage, fitSize, canvasToBlob } from '../../lib/image.js';
import {
  emptyState, normalize, addAccount, editAccount, removeAccount, accountById, toggleFollow, isFollowing,
  followersOf, followingOf, postsBy, addPost, removePost, postById, feedFor, toggleLike, addComment,
  searchAccounts, timeAgo, countLabel, handleProblem, mergeStates,
} from './socials-core.js';

const KEY = 'cc.socials';
export const socialsLock = makeLock('cc.socials.lock', 'cc.socials.open');
// The password, once entered, for as long as the app is open (it opens the copy in Drive): forgotten on a
// reload or when the app is closed, so it's asked again then.
let sessionPw = null;

export function mount(host) {
  let state = emptyState();
  let view = { name: 'feed' };
  let alive = true;
  const urls = new Map(); // Blob → object URL, made once each.
  const urlOf = (b) => { if (!b) return null; let u = urls.get(b); if (!u) { u = URL.createObjectURL(b); urls.set(b, u); } return u; };
  const save = () => { idb.set(KEY, state); soon(); };
  // ---- Sync with Drive: after each change (a few seconds later), when the app opens, when back online.
  const sync = { busy: false, again: false, msg: '', ok: null, wrong: false, timer: 0 };
  const soon = () => { clearTimeout(sync.timer); sync.timer = setTimeout(runSync, 3000); };
  async function runSync() {
    clearTimeout(sync.timer);
    const api = connected(); if (!api || !sessionPw || !alive) { sync.msg = api ? '' : 'Not set up'; return; }
    if (sync.busy) { sync.again = true; return; }
    sync.busy = true; sync.msg = 'Syncing…'; sync.ok = null; drawStatus();
    try {
      const r = await syncSocials(api, state, sessionPw);
      if (!alive) return;
      // (Anything changed here while it ran is kept: merged again over what came back.)
      state = mergeStates(state, r.state); await idb.set(KEY, state);
      sync.ok = true; sync.wrong = false; sync.msg = `Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      if (r.recoveryKey) sync.pendingKey = r.recoveryKey;
      // (Shown again only where nothing's being typed or picked: a post being made, a comment, a form stay as they are.)
      if (['feed', 'profile', 'people'].includes(view.name)) draw(); else drawStatus();
    } catch (e) {
      sync.ok = false; sync.wrong = e instanceof WrongPassword;
      sync.msg = sync.wrong ? 'The copy in your Drive has a different password' : navigator.onLine === false ? 'Offline: syncs when back online' : `Couldn't sync: ${e.message}`;
    } finally { sync.busy = false; drawStatus(); if (sync.again) { sync.again = false; soon(); } }
  }
  const onOnline = () => soon();
  globalThis.addEventListener?.('online', onOnline);
  const statusEl = el('button', { type: 'button', class: 'so-cloud', 'aria-label': 'Sync and password', onclick: () => go({ name: 'settings' }) });
  function drawStatus() {
    const api = !!connected();
    statusEl.textContent = !api ? '⚙' : sync.busy ? '⟳' : sync.ok === false ? '⚠' : '☁';
    statusEl.title = sync.msg || 'Sync and password';
    if (view.name === 'settings') { const m = main.querySelector('.so-sync-msg'); if (m) m.textContent = syncLine(); }
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
      m && el('span', { class: 'so-top-right' }, statusEl, el('button', { type: 'button', class: 'so-switch', 'aria-label': `Using @${m.handle}: switch account`, onclick: () => go({ name: 'accounts' }) }, avatar(m, 's'), el('span', { text: m.handle }), el('span', { 'aria-hidden': 'true', text: ' ▾' }))));
    drawStatus();
    const tab = (name, label, icon, v) => el('button', { type: 'button', class: `so-tab${view.name === name && (name !== 'profile' || view.id === state.me) ? ' active' : ''}`, 'aria-label': label, onclick: () => go(v) }, icon);
    fill(tabs, m && [
      tab('feed', 'Home', '⌂', { name: 'feed' }),
      tab('explore', 'Search', '⌕', { name: 'explore' }),
      tab('new', 'New post', '⊕', { name: 'new' }),
      tab('profile', 'Profile', avatar(m, 's'), { name: 'profile', id: state.me }),
    ]);
  }

  // ---- A post, as the feed shows it.
  function postCard(p, { full = false } = {}) {
    const by = accountById(state, p.by); const m = me();
    const liked = p.likes.includes(state.me);
    const heart = el('button', { type: 'button', class: `so-act so-like${liked ? ' on' : ''}`, 'aria-label': liked ? 'Unlike' : 'Like', 'aria-pressed': String(liked), text: liked ? '♥' : '♡', onclick: () => { toggleLike(state, p.id, state.me); save(); draw(); } });
    let lastTap = 0;
    const pic = p.image ? el('div', { class: 'so-pic', ondblclick: () => like(), onpointerup: () => { const t = Date.now(); if (t - lastTap < 300) like(); lastTap = t; } }, el('img', { src: urlOf(p.image), alt: p.caption ? `Photo: ${p.caption.slice(0, 80)}` : `Photo by ${by.handle}` })) : null;
    function like() {
      if (!p.likes.includes(state.me)) { toggleLike(state, p.id, state.me); save(); }
      draw();
      const big = el('span', { class: 'so-burst', 'aria-hidden': 'true', text: '♥' }); main.querySelector(`[data-post="${p.id}"] .so-pic`)?.append(big); setTimeout(() => big.remove(), 700);
    }
    const menu = p.by === state.me ? el('button', { type: 'button', class: 'so-more', 'aria-label': 'Post options', text: '⋯', onclick: () => { if (confirm('Delete this post?')) { removePost(state, p.id); save(); if (view.name === 'post') go({ name: 'profile', id: by.id }); else draw(); } } }) : null;
    const shown = full ? p.comments : p.comments.slice(-2);
    const commentBox = full && m ? (() => {
      const input = el('input', { class: 'so-input so-comment-input', type: 'text', placeholder: `Add a comment as ${m.handle}…`, 'aria-label': 'Add a comment', maxlength: '500' });
      const post = () => { if (addComment(state, p.id, state.me, input.value)) { save(); draw(); } };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') post(); });
      return el('div', { class: 'so-comment-add' }, avatar(m, 's'), input, el('button', { type: 'button', class: 'so-link', text: 'Post', onclick: post }));
    })() : null;
    return el('article', { class: 'so-post', 'data-post': p.id },
      el('div', { class: 'so-post-head' }, el('button', { type: 'button', class: 'so-avbtn', 'aria-label': `@${by.handle}`, onclick: () => go({ name: 'profile', id: by.id }) }, avatar(by, 's')), handleBtn(by), el('span', { class: 'so-dot muted', text: `• ${timeAgo(p.at)}` }), menu),
      pic,
      el('div', { class: 'so-actions' }, heart, el('button', { type: 'button', class: 'so-act', 'aria-label': 'Comments', text: '💬', onclick: () => go({ name: 'post', id: p.id }) })),
      p.likes.length ? el('div', { class: 'so-likes', text: `${countLabel(p.likes.length)} like${p.likes.length === 1 ? '' : 's'}` }) : null,
      p.caption ? el('p', { class: 'so-caption' }, handleBtn(by), ' ', p.caption) : null,
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
      fill(grid, s ? null : [...state.posts].filter((p) => p.image).sort((a, b) => b.at - a.at).map(tile));
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

  const tile = (p) => el('button', { type: 'button', class: 'so-tile', 'aria-label': `Post by ${accountById(state, p.by)?.handle}${p.caption ? `: ${p.caption.slice(0, 60)}` : ''}`, onclick: () => go({ name: 'post', id: p.id }) },
    p.image ? el('img', { src: urlOf(p.image), alt: '' }) : el('span', { class: 'so-tile-text', text: p.caption }));

  function profile(id) {
    const a = accountById(state, id); if (!a) return feed();
    const mine = a.id === state.me; const posts = postsBy(state, a.id);
    const f = isFollowing(state, state.me, a.id);
    const stat = (n, label, v) => el('button', { type: 'button', class: 'so-stat', onclick: v ? () => go(v) : null }, el('strong', { text: countLabel(n) }), el('span', { text: label }));
    return el('div', {},
      el('div', { class: 'so-pad so-prof' },
        el('div', { class: 'so-prof-top' }, avatar(a, 'xl'),
          el('div', { class: 'so-stats' }, stat(posts.length, 'posts'), stat(followersOf(state, a.id).length, 'followers', { name: 'people', id: a.id, kind: 'followers' }), stat(a.following.length, 'following', { name: 'people', id: a.id, kind: 'following' }))),
        el('div', { class: 'so-prof-handle', text: `@${a.handle}` }),
        a.name ? el('div', { class: 'so-prof-name', text: a.name }) : null,
        a.bio ? el('p', { class: 'so-bio', text: a.bio }) : null,
        el('div', { class: 'so-row' }, mine
          ? [el('button', { type: 'button', class: 'btn', text: 'Edit profile', onclick: () => go({ name: 'edit' }) }), el('button', { type: 'button', class: 'btn', text: 'Switch account', onclick: () => go({ name: 'accounts' }) })]
          : [el('button', { type: 'button', class: `btn${f ? '' : ' primary'}`, text: f ? 'Following' : 'Follow', onclick: () => { toggleFollow(state, state.me, a.id); save(); draw(); } }), el('button', { type: 'button', class: 'btn', text: 'Use this account', onclick: () => { state.me = a.id; save(); draw(); } })])),
      posts.length ? el('div', { class: 'so-grid' }, posts.map(tile)) : el('div', { class: 'so-empty' }, el('p', { class: 'so-empty-big', text: 'No posts yet' }), mine ? el('button', { type: 'button', class: 'btn primary', text: 'Share your first post', onclick: () => go({ name: 'new' }) }) : null));
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

  function accounts() {
    return el('div', {}, backBar('Accounts', { name: 'feed' }),
      el('div', { class: 'so-people' }, state.accounts.map((a) => el('div', { class: 'so-person' },
        el('button', { type: 'button', class: 'so-person-main', 'aria-label': `Use @${a.handle}`, onclick: () => { state.me = a.id; save(); go({ name: 'feed' }); } }, avatar(a, 'm'), el('span', { class: 'so-person-text' }, el('strong', { text: a.handle }), el('span', { class: 'muted small', text: a.name || ' ' }))),
        a.id === state.me ? el('span', { class: 'so-check', 'aria-label': 'In use', text: '✓' }) : null))),
      el('div', { class: 'so-pad' }, el('h3', { text: 'Add account' }), accountForm(null)));
  }

  // ---- Making or editing an account.
  function accountForm(a) {
    let pic = a?.avatar ?? null; let changed = false;
    const prev = el('span', { class: 'so-form-av' });
    const showPic = () => fill(prev, pic ? el('img', { class: 'so-av so-av-l', src: urlOf(pic), alt: '' }) : el('span', { class: 'so-av so-av-l so-av-none', text: '+' }));
    showPic();
    const file = el('input', { type: 'file', accept: 'image/*', class: 'so-file', 'aria-label': 'Profile picture' });
    file.addEventListener('change', async () => { const f = file.files?.[0]; if (!f) return; try { pic = await prepare(f, 320, true); changed = true; showPic(); } catch (e) { err.textContent = e.message; } });
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
        el('button', { type: 'button', class: 'btn danger so-delete', text: `Delete @${a.handle}`, onclick: () => { if (confirm(`Delete @${a.handle} and all its posts? This can't be undone.`)) { removeAccount(state, a.id); save(); go({ name: 'feed' }); } } })));
  }

  // ---- A new post.
  function newPost() {
    const m = me(); let img = null;
    const prev = el('div', { class: 'so-new-prev' }, el('span', { class: 'muted', text: 'Pick a photo' }));
    const file = el('input', { type: 'file', accept: 'image/*', class: 'so-file', 'aria-label': 'Photo' });
    const caption = el('textarea', { class: 'so-input', rows: '3', placeholder: 'Write a caption…', 'aria-label': 'Caption', maxlength: '2200' });
    const err = el('p', { class: 'so-err', role: 'alert' });
    const share = el('button', { type: 'button', class: 'btn primary', text: 'Share', disabled: true });
    file.addEventListener('change', async () => {
      const f = file.files?.[0]; if (!f) return; err.textContent = ''; prev.replaceChildren(el('span', { class: 'muted', text: 'Loading…' }));
      try { img = await prepare(f, 1440, false); prev.replaceChildren(el('img', { src: urlOf(img), alt: 'Your photo' })); share.disabled = false; } catch (e) { img = null; share.disabled = true; prev.replaceChildren(); err.textContent = e.message; }
    });
    share.addEventListener('click', () => { try { addPost(state, m.id, { image: img, caption: caption.value }); save(); go({ name: 'feed' }); } catch (e) { err.textContent = e.message; } });
    return el('div', {}, backBar(`New post as @${m.handle}`, { name: 'feed' }),
      el('div', { class: 'so-pad so-new' }, el('label', { class: 'so-new-pick' }, prev, file), caption, err, share));
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
    fill(main, v.name === 'settings' ? settings() : v.name === 'explore' ? explore() : v.name === 'new' ? newPost() : v.name === 'profile' ? profile(v.id ?? state.me)
      : v.name === 'post' ? onePost(v.id) : v.name === 'accounts' ? accounts() : v.name === 'edit' ? edit() : v.name === 'people' ? people(v.id, v.kind) : feed());
  }

  // Opened: what's on this device, then a sync.
  let loaded = false;
  function start() {
    if (loaded) { draw(); runSync(); return; }
    fill(main, el('p', { class: 'muted so-pad', text: 'Loading…' }));
    idb.get(KEY).then((raw) => { loaded = true; state = normalize(raw); draw(); runSync(); });
  }
  if (sessionPw) start(); else gate();

  return () => { alive = false; clearTimeout(sync.timer); globalThis.removeEventListener?.('online', onOnline); for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); };
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
