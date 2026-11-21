// Socials: the data and rules, with no page (so they can be tested). Everything is made in the app:
// accounts (a handle, a name, a bio, a picture; one of them the Owner, yours), who each follows, posts (a
// photo or a video, and a caption, by one account), likes, comments, and direct messages between accounts.
//
// The state: { accounts, posts, messages, reads, me: accountId | null, gone: { id: when } } where
//   Account = { id, handle, name, bio, avatar: Blob | null, avatarId, owner: bool, following: [accountId], at, upd }
//   Post    = { id, by, kind: 'photo' | 'video', image: Blob | null (the photo, or a video's still), imageId,
//               video: Blob | null, videoId, more: [{ kind, image, imageId, video, videoId }] (a post of several:
//               its 2nd and later photos or videos), caption, tags: [accountId], at, upd, edited, likes, comments }
//   Message = { id, from, to, text, post?: postId (a post shared), at }      reads = { accountId: { otherId: when last read } }
// `upd` is when it last changed and `gone` when something was deleted, so two phones' copies can be merged
// (mergeStates); each photo and video has its own id so it's copied to Drive once.

/** A new, empty state. */
export const emptyState = () => ({ accounts: [], posts: [], messages: [], reads: {}, me: null, gone: {} });

/** A fresh id (time and a little randomness: unique enough on one phone). */
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** A handle cleaned up as typed: lower case, letters, digits, dots and underscores, at most 30. */
export const cleanHandle = (s) => String(s ?? '').trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30);

/** Why a handle can't be used (empty, taken by another account), or null when it can. */
export function handleProblem(state, handle, exceptId = null) {
  const h = cleanHandle(handle);
  if (!h) return 'Pick a username (letters, numbers, . and _).';
  if (state.accounts.some((a) => a.handle === h && a.id !== exceptId)) return `@${h} is already one of your accounts.`;
  return null;
}

export const accountById = (state, id) => state.accounts.find((a) => a.id === id) ?? null;

/** Add an account (the first is the Owner, and the one in use). Returns it, or throws why not. */
export function addAccount(state, { handle, name = '', bio = '', avatar = null }) {
  const p = handleProblem(state, handle); if (p) throw new Error(p);
  const now = Date.now();
  const a = { id: newId(), handle: cleanHandle(handle), name: String(name).trim().slice(0, 60), bio: String(bio).trim().slice(0, 300), avatar, avatarId: avatar ? newId() : null, owner: !state.accounts.some((x) => x.owner), following: [], at: now, upd: now };
  state.accounts.push(a);
  if (!state.me) state.me = a.id;
  return a;
}

/** Change an account's handle, name, bio or picture. Throws if the new handle can't be used. */
export function editAccount(state, id, changes) {
  const a = accountById(state, id); if (!a) return null;
  if (changes.handle != null) { const p = handleProblem(state, changes.handle, id); if (p) throw new Error(p); a.handle = cleanHandle(changes.handle); }
  if (changes.name != null) a.name = String(changes.name).trim().slice(0, 60);
  if (changes.bio != null) a.bio = String(changes.bio).trim().slice(0, 300);
  if (changes.avatar !== undefined) { a.avatar = changes.avatar; a.avatarId = changes.avatar ? newId() : null; }
  a.upd = Date.now();
  return a;
}

/** The Owner account (yours), or null with no accounts. */
export const ownerOf = (state) => state.accounts.find((a) => a.owner) ?? null;

/** The accounts as they're listed to pick from: the Owner first, then the others, oldest first. */
export const accountsInOrder = (state) => [...state.accounts].sort((a, b) => (b.owner ? 1 : 0) - (a.owner ? 1 : 0) || a.at - b.at);

/** Make an account the Owner (the one before isn't any more). */
export function setOwner(state, id) {
  const a = accountById(state, id); if (!a || a.owner) return false;
  const now = Date.now();
  for (const x of state.accounts) if (x.owner) { x.owner = false; x.upd = now; }
  a.owner = true; a.upd = now + 1; return true;
}

/** Remove an account, its posts and messages, and it from everyone's following, likes and comments. */
export function removeAccount(state, id) {
  const now = Date.now(); state.gone ??= {}; state.gone[id] = now;
  const wasOwner = !!accountById(state, id)?.owner;
  for (const p of state.posts) if (p.by === id) state.gone[p.id] = now;
  for (const m of state.messages ?? []) if (m.from === id || m.to === id) state.gone[m.id] = now;
  state.messages = (state.messages ?? []).filter((m) => m.from !== id && m.to !== id);
  if (state.reads) delete state.reads[id];
  state.accounts = state.accounts.filter((a) => a.id !== id);
  state.posts = state.posts.filter((p) => p.by !== id);
  for (const a of state.accounts) if (a.following.includes(id)) { a.following = a.following.filter((f) => f !== id); a.upd = now; }
  for (const p of state.posts) if (p.likes.includes(id) || p.comments.some((c) => c.by === id) || (p.tags ?? []).includes(id)) { p.likes = p.likes.filter((l) => l !== id); p.comments = p.comments.filter((c) => c.by !== id); p.tags = (p.tags ?? []).filter((t) => t !== id); p.upd = now; }
  if (wasOwner && state.accounts.length) { const next = [...state.accounts].sort((a, b) => a.at - b.at)[0]; next.owner = true; next.upd = now; }
  if (state.me === id) state.me = ownerOf(state)?.id ?? state.accounts[0]?.id ?? null;
}

export const isFollowing = (state, who, whom) => !!accountById(state, who)?.following.includes(whom);

/** Follow or unfollow `whom` as `who` (never yourself). Returns whether `who` now follows them. */
export function toggleFollow(state, who, whom) {
  const a = accountById(state, who); if (!a || who === whom || !accountById(state, whom)) return false;
  a.upd = Date.now();
  if (a.following.includes(whom)) { a.following = a.following.filter((f) => f !== whom); return false; }
  a.following.push(whom); return true;
}

export const followersOf = (state, id) => state.accounts.filter((a) => a.following.includes(id));
export const followingOf = (state, id) => (accountById(state, id)?.following ?? []).map((f) => accountById(state, f)).filter(Boolean);
export const postsBy = (state, id) => state.posts.filter((p) => p.by === id).sort((a, b) => b.at - a.at);

/** Add a post by an account: a photo, or a video (with its still, `image`). Returns it. */
export function addPost(state, by, { image = null, video = null, caption = '', tags = [], more = [] }) {
  if (!accountById(state, by)) throw new Error('No account to post from.');
  if (!image && !video && !String(caption).trim()) throw new Error('Pick a photo or video first.');
  const now = Date.now();
  const p = { id: newId(), by, kind: video ? 'video' : 'photo', image, imageId: image ? newId() : null, video, videoId: video ? newId() : null, more: (more ?? []).filter((m) => m && (m.image || m.video)).slice(0, 9).map((m) => ({ kind: m.video ? 'video' : 'photo', image: m.image ?? null, imageId: m.image ? newId() : null, video: m.video ?? null, videoId: m.video ? newId() : null })), caption: String(caption).trim().slice(0, 2200), tags: cleanTags(state, tags), at: now, upd: now, edited: 0, likes: [], comments: [] };
  state.posts.push(p);
  return p;
}

/** The accounts tagged in a post: real ones, each once. */
const cleanTags = (state, tags) => [...new Set((tags ?? []).filter((t) => accountById(state, t)))];

/** The posts an account is tagged in, newest first. */
export const taggedIn = (state, id) => state.posts.filter((p) => (p.tags ?? []).includes(id)).sort((a, b) => b.at - a.at);

/** A caption cut into text and @mentions of accounts there are: [{ text } | { handle, account }]. */
export function captionParts(state, text) {
  const out = []; const re = /@([a-z0-9._]+)/gi; let last = 0; let m;
  while ((m = re.exec(text))) {
    const a = state.accounts.find((x) => x.handle === m[1].toLowerCase().replace(/\.+$/, ''));
    if (!a) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ handle: a.handle, account: a });
    last = m.index + 1 + a.handle.length; re.lastIndex = last;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Change a post's caption, the accounts tagged in it, or its photo (edited again). */
export function editPost(state, id, { caption, image, tags }) {
  const p = postById(state, id); if (!p) return null;
  if (caption != null) p.caption = String(caption).trim().slice(0, 2200);
  if (tags) p.tags = cleanTags(state, tags);
  if (image) { p.image = image; p.imageId = newId(); }
  p.upd = p.edited = Date.now();
  return p;
}

/** A post's photos and videos, in order: [{ kind, image, imageId, video, videoId }] (its first, then the rest). */
export const mediaOf = (p) => [{ kind: p.kind, image: p.image, imageId: p.imageId, video: p.video, videoId: p.videoId }, ...(p.more ?? [])];

/** `items` in a random order (Fisher–Yates; `rand` for tests). */
export function shuffled(items, rand = Math.random) {
  const a = [...items]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a;
}

/** The videos everyone has posted, newest first (Reels). */
export const reelsOf = (state, by = null) => state.posts.filter((p) => p.kind === 'video' && (!by || p.by === by)).sort((a, b) => b.at - a.at);

export const removePost = (state, id) => { state.gone ??= {}; state.gone[id] = Date.now(); state.posts = state.posts.filter((p) => p.id !== id); };
export const postById = (state, id) => state.posts.find((p) => p.id === id) ?? null;

/** The home feed for an account: its own posts and those of the accounts it follows, newest first. */
export function feedFor(state, me) {
  const a = accountById(state, me); if (!a) return [];
  const seen = new Set([me, ...a.following]);
  return state.posts.filter((p) => seen.has(p.by) && accountById(state, p.by)).sort((x, y) => y.at - x.at);
}

/** Like or unlike a post as `who`. Returns whether it's now liked. */
export function toggleLike(state, postId, who) {
  const p = postById(state, postId); if (!p || !accountById(state, who)) return false;
  p.upd = Date.now();
  if (p.likes.includes(who)) { p.likes = p.likes.filter((l) => l !== who); return false; }
  p.likes.push(who); return true;
}

/** Comment on a post as `who`. Returns the comment, or null. */
export function addComment(state, postId, who, text) {
  const p = postById(state, postId); const t = String(text ?? '').trim();
  if (!p || !t || !accountById(state, who)) return null;
  const c = { id: newId(), by: who, text: t.slice(0, 500), at: Date.now() };
  p.comments.push(c); p.upd = c.at; return c;
}

// ---- Direct messages between accounts.

/** Send a message from one account to another (with a post shared, `post`). Returns it, or null (empty, or to yourself). */
export function sendMessage(state, from, to, text, { post = null } = {}) {
  const t = String(text ?? '').trim(); const sh = post && postById(state, post) ? post : null;
  if ((!t && !sh) || from === to || !accountById(state, from) || !accountById(state, to)) return null;
  const m = { id: newId(), from, to, text: t.slice(0, 2000), at: Date.now(), ...(sh ? { post: sh } : {}) };
  (state.messages ??= []).push(m); markRead(state, from, to, m.at);
  return m;
}

/** The messages between two accounts, oldest first. */
export const conversation = (state, a, b) => (state.messages ?? []).filter((m) => (m.from === a && m.to === b) || (m.from === b && m.to === a)).sort((x, y) => x.at - y.at);

/** When `me` last read their chat with `other` (0: never). */
const lastRead = (state, me, other) => state.reads?.[me]?.[other] ?? 0;

/** `me` has read their chat with `other` (up to `at`). */
export function markRead(state, me, other, at = Date.now()) {
  state.reads ??= {}; state.reads[me] ??= {};
  state.reads[me][other] = Math.max(state.reads[me][other] ?? 0, at);
}

/** An account's chats, the latest first: [{ other: Account, last: Message, unread: number }]. */
export function conversationsOf(state, me) {
  const by = new Map();
  for (const m of state.messages ?? []) {
    if (m.from !== me && m.to !== me) continue;
    const o = m.from === me ? m.to : m.from; const c = by.get(o) ?? { last: null, unread: 0 };
    if (!c.last || m.at > c.last.at) c.last = m;
    if (m.to === me && m.at > lastRead(state, me, o)) c.unread++;
    by.set(o, c);
  }
  return [...by].map(([o, c]) => ({ other: accountById(state, o), ...c })).filter((c) => c.other).sort((a, b) => b.last.at - a.last.at);
}

/** How many messages to `me` they haven't read. */
export const unreadCount = (state, me) => conversationsOf(state, me).reduce((n, c) => n + c.unread, 0);

/** Accounts whose handle or name has `q` in it (all of them for an empty search). */
export function searchAccounts(state, q) {
  const s = String(q ?? '').trim().toLowerCase().replace(/^@/, '');
  return state.accounts.filter((a) => !s || a.handle.includes(s) || a.name.toLowerCase().includes(s));
}

/** "now", "5m", "3h", "2d", "4w", or a date: how long ago, as the feed shows it. */
export function timeAgo(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  if (s < 365 * 86400) return `${Math.floor(s / (7 * 86400))}w`;
  return new Date(at).toLocaleDateString();
}

/** A count as a profile shows it: 999, 1,204, 12.5K, 3.1M. */
export function countLabel(n) {
  if (n < 10000) return n.toLocaleString('en-US');
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e5 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}

/** A state read back from storage, made safe to use (anything missing filled in, anything broken dropped). */
export function normalize(raw) {
  const s = emptyState(); if (!raw || typeof raw !== 'object') return s;
  const ok = (v) => typeof v === 'string' && v.length > 0;
  s.accounts = (Array.isArray(raw.accounts) ? raw.accounts : []).filter((a) => a && ok(a.id) && ok(a.handle)).map((a) => ({ id: a.id, handle: a.handle, name: a.name ?? '', bio: a.bio ?? '', avatar: a.avatar ?? null, avatarId: a.avatarId ?? (a.avatar ? newId() : null), owner: !!a.owner, following: Array.isArray(a.following) ? a.following.filter(ok) : [], at: a.at ?? 0, upd: a.upd ?? a.at ?? 0 }));
  // (Exactly one Owner: the one made so last, else the oldest account.)
  { const owners = s.accounts.filter((a) => a.owner).sort((a, b) => b.upd - a.upd); for (const a of owners.slice(1)) a.owner = false; if (!owners.length && s.accounts.length) [...s.accounts].sort((a, b) => a.at - b.at)[0].owner = true; }
  const ids = new Set(s.accounts.map((a) => a.id));
  for (const a of s.accounts) a.following = a.following.filter((f) => ids.has(f) && f !== a.id);
  s.posts = (Array.isArray(raw.posts) ? raw.posts : []).filter((p) => p && ok(p.id) && ids.has(p.by)).map((p) => ({ id: p.id, by: p.by, kind: p.kind === 'video' ? 'video' : 'photo', image: p.image ?? null, imageId: p.imageId ?? (p.image ? newId() : null), video: p.video ?? null, videoId: p.videoId ?? (p.video ? newId() : null), more: Array.isArray(p.more) ? p.more.filter((m) => m && (m.imageId || m.videoId || m.image || m.video)).map((m) => ({ kind: m.kind === 'video' ? 'video' : 'photo', image: m.image ?? null, imageId: m.imageId ?? (m.image ? newId() : null), video: m.video ?? null, videoId: m.videoId ?? (m.video ? newId() : null) })) : [], caption: p.caption ?? '', tags: Array.isArray(p.tags) ? [...new Set(p.tags.filter((t) => ids.has(t)))] : [], at: p.at ?? 0, upd: p.upd ?? p.at ?? 0, edited: p.edited ?? 0, likes: Array.isArray(p.likes) ? p.likes.filter((l) => ids.has(l)) : [], comments: Array.isArray(p.comments) ? p.comments.filter((c) => c && ids.has(c.by) && ok(c.text)) : [] }));
  s.me = ids.has(raw.me) ? raw.me : (s.accounts[0]?.id ?? null);
  s.gone = raw.gone && typeof raw.gone === 'object' ? Object.fromEntries(Object.entries(raw.gone).filter(([k, v]) => ok(k) && Number.isFinite(v))) : {};
  s.messages = (Array.isArray(raw.messages) ? raw.messages : []).filter((m) => m && ok(m.id) && ids.has(m.from) && ids.has(m.to) && (ok(m.text) || ok(m.post)) && !s.gone[m.id]).map((m) => ({ id: m.id, from: m.from, to: m.to, text: m.text ?? '', at: m.at ?? 0, ...(ok(m.post) ? { post: m.post } : {}) }));
  s.reads = {};
  if (raw.reads && typeof raw.reads === 'object') for (const [a, o] of Object.entries(raw.reads)) if (ids.has(a) && o && typeof o === 'object') s.reads[a] = Object.fromEntries(Object.entries(o).filter(([b, v]) => ids.has(b) && Number.isFinite(v)));
  return s;
}

/**
 * Two copies of the state (this phone's and another's, from Drive) made one: every account and post either
 * has, the newer version of each where both have it (by `upd`), and nothing that either deleted after its
 * last change. Which account is in use stays this phone's (`local`). Photos aren't fetched here: each item
 * keeps what it had (a Blob, or null with only its id, to be fetched).
 */
export function mergeStates(local, remote) {
  const gone = { ...(local.gone ?? {}) };
  for (const [k, v] of Object.entries(remote.gone ?? {})) gone[k] = Math.max(gone[k] ?? 0, v);
  const pick = (xs, ys) => {
    const m = new Map(xs.map((x) => [x.id, x]));
    for (const y of ys) { const x = m.get(y.id); if (!x || (y.upd ?? 0) > (x.upd ?? 0)) m.set(y.id, y); }
    return [...m.values()].filter((v) => !(gone[v.id] >= (v.upd ?? 0)));
  };
  // (Messages never change: every one either has, less those deleted. What each account has read: the later.)
  const msgs = new Map([...(local.messages ?? []), ...(remote.messages ?? [])].map((m) => [m.id, m]));
  const reads = JSON.parse(JSON.stringify(local.reads ?? {}));
  for (const [a, o] of Object.entries(remote.reads ?? {})) for (const [b, v] of Object.entries(o ?? {})) { reads[a] ??= {}; reads[a][b] = Math.max(reads[a][b] ?? 0, v); }
  return normalize({ accounts: pick(local.accounts, remote.accounts ?? []), posts: pick(local.posts, remote.posts ?? []), messages: [...msgs.values()].filter((m) => !gone[m.id]), reads, me: local.me, gone });
}
