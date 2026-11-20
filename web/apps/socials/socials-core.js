// Socials: the data and rules, with no page (so they can be tested). Everything is made in the app and kept
// on this phone: accounts (a handle, a name, a bio, a picture), who each follows, posts (a photo and a
// caption, by one account), likes and comments. Nothing is fetched or sent anywhere.
//
// The state: { accounts: [Account], posts: [Post], me: accountId | null, gone: { id: when } } where
//   Account = { id, handle, name, bio, avatar: Blob | null, avatarId, following: [accountId], at, upd }
//   Post    = { id, by: accountId, image: Blob | null, imageId, caption, at, upd, likes: [accountId], comments: [{ id, by, text, at }] }
// `upd` is when it last changed and `gone` when something was deleted, so two phones' copies can be merged
// (mergeStates); each photo has its own id (imageId, avatarId) so it's copied to Drive once.

/** A new, empty state. */
export const emptyState = () => ({ accounts: [], posts: [], me: null, gone: {} });

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

/** Add an account (and make it the one you're using if it's the first). Returns it, or throws why not. */
export function addAccount(state, { handle, name = '', bio = '', avatar = null }) {
  const p = handleProblem(state, handle); if (p) throw new Error(p);
  const now = Date.now();
  const a = { id: newId(), handle: cleanHandle(handle), name: String(name).trim().slice(0, 60), bio: String(bio).trim().slice(0, 300), avatar, avatarId: avatar ? newId() : null, following: [], at: now, upd: now };
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

/** Remove an account, its posts, and it from everyone's following, likes and comments. */
export function removeAccount(state, id) {
  const now = Date.now(); state.gone ??= {}; state.gone[id] = now;
  for (const p of state.posts) if (p.by === id) state.gone[p.id] = now;
  state.accounts = state.accounts.filter((a) => a.id !== id);
  state.posts = state.posts.filter((p) => p.by !== id);
  for (const a of state.accounts) if (a.following.includes(id)) { a.following = a.following.filter((f) => f !== id); a.upd = now; }
  for (const p of state.posts) if (p.likes.includes(id) || p.comments.some((c) => c.by === id)) { p.likes = p.likes.filter((l) => l !== id); p.comments = p.comments.filter((c) => c.by !== id); p.upd = now; }
  if (state.me === id) state.me = state.accounts[0]?.id ?? null;
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

/** Add a post by an account. Returns it. */
export function addPost(state, by, { image = null, caption = '' }) {
  if (!accountById(state, by)) throw new Error('No account to post from.');
  if (!image && !String(caption).trim()) throw new Error('Pick a photo first.');
  const now = Date.now();
  const p = { id: newId(), by, image, imageId: image ? newId() : null, caption: String(caption).trim().slice(0, 2200), at: now, upd: now, likes: [], comments: [] };
  state.posts.push(p);
  return p;
}

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
  s.accounts = (Array.isArray(raw.accounts) ? raw.accounts : []).filter((a) => a && ok(a.id) && ok(a.handle)).map((a) => ({ id: a.id, handle: a.handle, name: a.name ?? '', bio: a.bio ?? '', avatar: a.avatar ?? null, avatarId: a.avatarId ?? (a.avatar ? newId() : null), following: Array.isArray(a.following) ? a.following.filter(ok) : [], at: a.at ?? 0, upd: a.upd ?? a.at ?? 0 }));
  const ids = new Set(s.accounts.map((a) => a.id));
  for (const a of s.accounts) a.following = a.following.filter((f) => ids.has(f) && f !== a.id);
  s.posts = (Array.isArray(raw.posts) ? raw.posts : []).filter((p) => p && ok(p.id) && ids.has(p.by)).map((p) => ({ id: p.id, by: p.by, image: p.image ?? null, imageId: p.imageId ?? (p.image ? newId() : null), caption: p.caption ?? '', at: p.at ?? 0, upd: p.upd ?? p.at ?? 0, likes: Array.isArray(p.likes) ? p.likes.filter((l) => ids.has(l)) : [], comments: Array.isArray(p.comments) ? p.comments.filter((c) => c && ids.has(c.by) && ok(c.text)) : [] }));
  s.me = ids.has(raw.me) ? raw.me : (s.accounts[0]?.id ?? null);
  s.gone = raw.gone && typeof raw.gone === 'object' ? Object.fromEntries(Object.entries(raw.gone).filter(([k, v]) => ok(k) && Number.isFinite(v))) : {};
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
  return normalize({ accounts: pick(local.accounts, remote.accounts ?? []), posts: pick(local.posts, remote.posts ?? []), me: local.me, gone });
}
