// Socials: a photo-sharing app laid out like the familiar ones (a feed of square-ish photo posts, a row of
// accounts across the top, a tab bar at the bottom: Home, Search, New post, Profile), where everything is
// yours and made here. Make accounts, switch between them, post photos from any of them, follow one from
// another, like and comment; Home shows the posts of the accounts the one you're using follows. All of it is
// kept on this phone (IndexedDB, photos included) and stays after a reload; nothing goes anywhere.

import { el, fill } from '../../lib/dom.js';
import { idb } from '../../lib/idb.js';
import { sniffType, decodeImage, fitSize, canvasToBlob } from '../../lib/image.js';
import {
  emptyState, normalize, addAccount, editAccount, removeAccount, accountById, toggleFollow, isFollowing,
  followersOf, followingOf, postsBy, addPost, removePost, postById, feedFor, toggleLike, addComment,
  searchAccounts, timeAgo, countLabel, handleProblem,
} from './socials-core.js';

const KEY = 'cc.socials';

export function mount(host) {
  let state = emptyState();
  let view = { name: 'feed' };
  let alive = true;
  const urls = new Map(); // Blob → object URL, made once each.
  const urlOf = (b) => { if (!b) return null; let u = urls.get(b); if (!u) { u = URL.createObjectURL(b); urls.set(b, u); } return u; };
  const save = () => idb.set(KEY, state);
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
      m && el('button', { type: 'button', class: 'so-switch', 'aria-label': `Using @${m.handle}: switch account`, onclick: () => go({ name: 'accounts' }) }, avatar(m, 's'), el('span', { text: m.handle }), el('span', { 'aria-hidden': 'true', text: ' ▾' })));
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
      el('p', { class: 'muted', text: 'Make an account to start posting. Everything here is made by you and kept only on this phone.' }),
      accountForm(null));
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

  function draw() {
    if (!alive) return;
    drawBars();
    if (!me()) { fill(main, welcome()); return; }
    const v = view;
    fill(main, v.name === 'explore' ? explore() : v.name === 'new' ? newPost() : v.name === 'profile' ? profile(v.id ?? state.me)
      : v.name === 'post' ? onePost(v.id) : v.name === 'accounts' ? accounts() : v.name === 'edit' ? edit() : v.name === 'people' ? people(v.id, v.kind) : feed());
  }

  fill(main, el('p', { class: 'muted so-pad', text: 'Loading…' }));
  idb.get(KEY).then((raw) => { state = normalize(raw); draw(); });

  return () => { alive = false; for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); };
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
