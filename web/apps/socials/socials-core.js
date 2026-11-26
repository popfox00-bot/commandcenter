// Socials: the data and rules, with no page (so they can be tested). Everything is made in the app:
// accounts (a handle, a name, a bio, a picture; one of them the Owner, yours), who each follows, posts (a
// photo or a video, and a caption, by one account), likes, comments, and direct messages between accounts.
//
// The state: { accounts, posts, messages, reads, me: accountId | null, gone: { id: when } } where
//   Account = { id, handle, name, bio, avatar: Blob | null, avatarId, owner: bool, following: [accountId], saved: [postId], at, upd }
//   Post    = { id, by, kind: 'photo' | 'video', image: Blob | null (the photo, or a video's still), imageId,
//               video: Blob | null, videoId, more: [{ kind, image, imageId, video, videoId }] (a post of several:
//               its 2nd and later photos or videos), caption, tags: [accountId], at, upd, edited, likes, comments,
//               draft: bool (saved, not shared yet), pinned: when (to the top of its profile), trashed: when (deleted:
//               recoverable for TRASH_DAYS), collab: [{ id: accountId, status: 'pending' | 'accepted' | 'declined', at }]
//               (accounts invited to share it: accepted, it's on their profile and in their followers' feeds too),
//               viewsBy: { deviceId: count } (how many times it's been seen, counted on each device and added up) }
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
/** An account's kind: a friend or a celebrity (the Owner is neither). */
export const KINDS = ['friend', 'celebrity'];
const kindOf = (k) => (k === 'celebrity' ? 'celebrity' : 'friend');

// (An account's voice, chosen in its profile (socials-style.js' personas); none: its own, from its handle.)
export const VOICES = ['hype', 'chill', 'warm', 'witty', 'classic'];
export function addAccount(state, { handle, name = '', bio = '', avatar = null, kind = 'friend' }) {
  const p = handleProblem(state, handle); if (p) throw new Error(p);
  const now = Date.now();
  const a = { id: newId(), handle: cleanHandle(handle), name: String(name).trim().slice(0, 60), bio: String(bio).trim().slice(0, 300), avatar, avatarId: avatar ? newId() : null, owner: !state.accounts.some((x) => x.owner), kind: kindOf(kind), following: [], at: now, upd: now };
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
  if (changes.kind != null) a.kind = kindOf(changes.kind);
  if (changes.voice !== undefined) { if (VOICES.includes(changes.voice)) a.voice = changes.voice; else delete a.voice; }
  if (changes.interests != null) { const t = String(changes.interests).trim().slice(0, 120); if (t) a.interests = t; else delete a.interests; }
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
  for (const p of state.posts) if (p.likes.includes(id) || p.comments.some((c) => c.by === id) || (p.tags ?? []).includes(id) || (p.collab ?? []).some((c) => c.id === id)) { p.likes = p.likes.filter((l) => l !== id); p.comments = p.comments.filter((c) => c.by !== id); p.tags = (p.tags ?? []).filter((t) => t !== id); p.collab = (p.collab ?? []).filter((c) => c.id !== id); p.upd = now; }
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
/** The accounts a post is a collab with (those who accepted, or with `status`, those). */
export const collabsOf = (p, status = 'accepted') => (p.collab ?? []).filter((c) => c.status === status).map((c) => c.id);

/** Whether a post is shared and showing (not a draft, not deleted). */
export const live = (p) => !p.draft && !p.trashed;
/** An account's posts as its profile shows them: pinned first (the latest pinned first), then newest first. */
export const postsBy = (state, id) => state.posts.filter((p) => (p.by === id || collabsOf(p).includes(id)) && live(p)).sort((a, b) => (b.pinned || 0) - (a.pinned || 0) || b.at - a.at);

/** Add a post by an account: a photo, or a video (with its still, `image`). Returns it. */
export function addPost(state, by, { image = null, video = null, caption = '', tags = [], more = [], draft = false, scene = null, fit = null }) {
  if (!accountById(state, by)) throw new Error('No account to post from.');
  if (!image && !video && !String(caption).trim()) throw new Error('Pick a photo or video first.');
  const now = Date.now();
  const vf = (v, f) => (v && cleanFit(f) ? { fit: cleanFit(f) } : {});
  const p = { id: newId(), by, kind: video ? 'video' : 'photo', image, imageId: image ? newId() : null, video, videoId: video ? newId() : null, ...vf(video, fit), more: (more ?? []).filter((m) => m && (m.image || m.video)).slice(0, 9).map((m) => ({ kind: m.video ? 'video' : 'photo', image: m.image ?? null, imageId: m.image ? newId() : null, video: m.video ?? null, videoId: m.video ? newId() : null, ...vf(m.video, m.fit) })), caption: String(caption).trim().slice(0, 2200), tags: cleanTags(state, tags), at: now, upd: now, edited: 0, likes: [], comments: [], draft: !!draft, pinned: 0, trashed: 0, scene: scene == null ? undefined : cleanScene(scene) };
  state.posts.push(p);
  return p;
}

/**
 * What a post's photo shows, as read on the phone (socials-vision.js), kept made safe: { labels: [[name,
 * score]], faces, people, poses, bg, outfit: { color, skin }, brand, tone, place, hour, taken }, each only when
 * it's sound; null for nothing.
 */
export function cleanScene(x) {
  if (!x || typeof x !== 'object') return null;
  const out = {};
  if (Array.isArray(x.labels)) { const l = x.labels.filter((v) => Array.isArray(v) && typeof v[0] === 'string' && v[0].length < 60 && Number.isFinite(v[1])).slice(0, 8).map(([n, k]) => [n, Math.max(0, Math.min(1, k))]); if (l.length) out.labels = l; }
  if (Number.isInteger(x.faces) && x.faces >= 0 && x.faces < 50) out.faces = x.faces;
  if (Number.isInteger(x.people) && x.people >= 0 && x.people < 50) out.people = x.people;
  if (Array.isArray(x.poses)) { const v = [...new Set(x.poses.filter((k) => ['armsup', 'wave', 'hips', 'sitting', 'full', 'close', 'allarmsup'].includes(k)))]; if (v.length) out.poses = v; }
  if (Array.isArray(x.bg)) { const v = [...new Set(x.bg.filter((k) => ['sky', 'sand', 'water', 'green', 'snow', 'sunset', 'city', 'night'].includes(k)))]; if (v.length) out.bg = v; }
  if (x.outfit && typeof x.outfit === 'object') { const o = {}; if (typeof x.outfit.color === 'string' && /^[a-z ]{3,12}$/.test(x.outfit.color)) o.color = x.outfit.color; if (Number.isFinite(x.outfit.skin)) o.skin = Math.max(0, Math.min(1, x.outfit.skin)); if (Object.keys(o).length) out.outfit = o; }
  if (typeof x.brand === 'string' && /^[\p{L}\p{N}' .&-]{2,30}$/u.test(x.brand)) out.brand = x.brand;
  if (['night', 'sunset', 'snow', 'blue', 'green'].includes(x.tone)) out.tone = x.tone;
  if (typeof x.place === 'string' && x.place && x.place.length <= 60) out.place = x.place;
  if (Number.isInteger(x.hour) && x.hour >= 0 && x.hour < 24) out.hour = x.hour;
  if (typeof x.taken === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(x.taken)) out.taken = x.taken;
  return Object.keys(out).length ? out : null;
}

/** The accounts tagged in a post: real ones, each once. */
const cleanTags = (state, tags) => [...new Set((tags ?? []).filter((t) => accountById(state, t)))];

/** The posts an account is tagged in, newest first. */
export const taggedIn = (state, id) => state.posts.filter((p) => live(p) && (p.tags ?? []).includes(id)).sort((a, b) => b.at - a.at);

/** A caption cut into text, @mentions of accounts there are, and #hashtags: [{ text } | { handle, account } | { tag }]. */
export function captionParts(state, text) {
  const out = []; const re = /@([a-z0-9._]+)|(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]{1,50})/giu; let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m[3]) {
      const at = m.index + m[2].length; if (at > last) out.push({ text: text.slice(last, at) });
      out.push({ tag: m[3].toLowerCase(), text: `#${m[3]}` }); last = at + 1 + m[3].length; re.lastIndex = last; continue;
    }
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

/**
 * A post's photos and videos changed (added, removed, reordered): `items` [{ kind, image, imageId?, video,
 * videoId? }] in their new order. Those it had keep their ids (nothing uploaded again); new ones get new ids.
 * At least one; at most ten.
 */
export function setMedia(state, id, items) {
  const p = postById(state, id); if (!p) return null;
  const list = (items ?? []).filter((m) => m && (m.image || m.video)).slice(0, 10).map((m) => {
    const video = m.kind === 'video' || (!m.kind && m.video) ? m.video ?? null : null;
    const fit = video ? cleanFit(m.fit) : null;
    return { kind: video ? 'video' : 'photo', image: m.image ?? null, imageId: m.image ? m.imageId ?? newId() : null, video, videoId: video ? m.videoId ?? newId() : null, ...(fit ? { fit } : {}) };
  });
  if (!list.length) throw new Error('A post needs at least one photo or video.');
  const [first, ...rest] = list;
  delete p.fit; Object.assign(p, first); p.more = rest;
  p.upd = p.edited = Date.now();
  return p;
}

/** A video's frame made safe: { x, y, w, h, a } inside the video, or null (the whole video). */
export function cleanFit(f) {
  if (!f || typeof f !== 'object') return null;
  const n = (v) => (Number.isFinite(v) ? v : NaN);
  const x = n(f.x); const y = n(f.y); const w = n(f.w); const h = n(f.h); const a = n(f.a);
  if (![x, y, w, h, a].every(Number.isFinite) || w < 0.05 || h < 0.05 || w > 1.0001 || h > 1.0001 || x < -1e-4 || y < -1e-4 || x + w > 1.0001 || y + h > 1.0001 || a <= 0 || a > 20) return null;
  if (w > 0.999 && h > 0.999) return null;
  const r = (v) => Math.round(v * 10000) / 10000;
  return { x: r(x), y: r(y), w: r(w), h: r(h), a: r(a) };
}

/**
 * An account's face, from its profile photo (socials-faces.js: 128 numbers), kept with the photo it's of
 * (`faceOf`: that photo's id): { face, faceOf } made safe, or {} for none (or a photo changed since).
 */
export function cleanFace(a) {
  if (!Array.isArray(a?.face) || a.face.length !== 128 || !a.face.every(Number.isFinite) || !a.faceOf || a.faceOf !== a.avatarId) return {};
  return { face: a.face.map((v) => Math.round(v * 10000) / 10000), faceOf: a.faceOf };
}
// (Faces learned for an account from what you've said: ✓ It's them (more of its faces, from more angles), ✕ Not
// them (faces that aren't it, so they aren't suggested again). At most LEARNED of each, the newest kept.)
export const LEARNED = 24;
const fdist = (a, b) => { let t = 0; for (let i = 0; i < 128; i++) { const d = a[i] - b[i]; t += d * d; } return Math.sqrt(t); };
const cleanFaces = (v) => (Array.isArray(v) ? v.filter((d) => Array.isArray(d) && d.length === 128 && d.every(Number.isFinite)).slice(-LEARNED).map((d) => d.map((x) => Math.round(x * 10000) / 10000)) : []);
/** A face learned for an account (`not`: one that isn't it). Returns whether it was new. */
export function learnFace(state, id, d, { not = false } = {}) {
  const a = accountById(state, id); if (!a || !Array.isArray(d) || d.length !== 128) return false;
  const key = not ? 'notFaces' : 'learned'; const list = cleanFaces(a[key]);
  if (list.some((x) => fdist(x, d) < 0.12)) return false; // (much the same as one it has)
  a[key] = cleanFaces([...list, d]);
  // (Said both ways: the latest wins.)
  const other = not ? 'learned' : 'notFaces'; if (a[other]?.length) a[other] = cleanFaces(a[other]).filter((x) => fdist(x, d) >= 0.12);
  return true;
}

/** Keep an account's face (from its current profile photo). */
export function setFace(state, id, face) {
  const a = accountById(state, id); if (!a || !a.avatarId) return null;
  if (!face) { delete a.face; delete a.faceOf; return a; }
  Object.assign(a, cleanFace({ face, faceOf: a.avatarId, avatarId: a.avatarId })); return a;
}

/** A post's photos and videos, in order: [{ kind, image, imageId, video, videoId }] (its first, then the rest). */
export const mediaOf = (p) => [{ kind: p.kind, image: p.image, imageId: p.imageId, video: p.video, videoId: p.videoId, ...(p.fit ? { fit: p.fit } : {}) }, ...(p.more ?? [])];

/** `items` in a random order (Fisher–Yates; `rand` for tests). */
export function shuffled(items, rand = Math.random) {
  const a = [...items]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a;
}

/** The videos everyone has posted, newest first (Reels). */
export const reelsOf = (state, by = null) => state.posts.filter((p) => p.kind === 'video' && live(p) && (!by || p.by === by)).sort((a, b) => b.at - a.at);

// ---- Drafts, pinning, the trash.

/** An account's drafts, the latest first. */
/** Drafts put on accounts from Saved Files (a scan's "It's them"), waiting to be looked over: the latest first. */
export const savedDrafts = (state) => state.posts.filter((p) => p.draft && !p.trashed && p.fromSaved).sort((a, b) => b.upd - a.upd);
export const draftsOf = (state, id) => state.posts.filter((p) => p.by === id && p.draft && !p.trashed).sort((a, b) => b.upd - a.upd);

/** Most posts pinned to a profile at once. */
export const MAX_PINNED = 3;
/** Pin a post to the top of its profile, or unpin it. Returns whether it's pinned now; throws when there are already three. */
export function togglePin(state, id) {
  const p = postById(state, id); if (!p) return false;
  if (p.pinned) { p.pinned = 0; p.upd = Date.now(); return false; }
  if (state.posts.filter((q) => q.by === p.by && q.pinned && live(q)).length >= MAX_PINNED) throw new Error(`${MAX_PINNED} posts can be pinned at most: unpin one first.`);
  p.pinned = p.upd = Date.now(); return true;
}

/** How long a deleted post can be brought back. */
export const TRASH_DAYS = 7;
/** Delete a post to the trash (it can be brought back for a week). */
export function trashPost(state, id, now = Date.now()) { const p = postById(state, id); if (!p) return; p.trashed = now; p.pinned = 0; p.upd = now; }
/** Bring a deleted post back. */
export function restorePost(state, id) { const p = postById(state, id); if (!p) return; p.trashed = 0; p.upd = Date.now(); }
/** What's in the trash, the latest deleted first, with how many days each has left. */
export const trashOf = (state, now = Date.now()) => state.posts.filter((p) => p.trashed).sort((a, b) => b.trashed - a.trashed).map((p) => ({ post: p, daysLeft: Math.max(0, Math.ceil(TRASH_DAYS - (now - p.trashed) / 86400000)) }));
/** Deleted for good what's been in the trash longer than a week. Returns how many. */
export function emptyOldTrash(state, now = Date.now()) {
  const old = state.posts.filter((p) => p.trashed && now - p.trashed > TRASH_DAYS * 86400000);
  for (const p of old) removePost(state, p.id);
  return old.length;
}

// ---- Stories: an account's posts of the last day, one after another.

export const STORY_HOURS = 24;
/** An account's stories: its posts of the last 24 hours, oldest first. */
export const storiesOf = (state, id, now = Date.now()) => state.posts.filter((p) => (p.by === id || collabsOf(p).includes(id)) && live(p) && now - p.at < STORY_HOURS * 3600000).sort((a, b) => a.at - b.at);

// ---- Comments made for a new post: three of the other accounts, a kind word each.

export const NICE_COMMENTS = [
  'Love this! 😍', 'Stunning 🔥', 'So good 👏', 'Obsessed 😍😍', 'This is everything ✨', 'Wow 🤩', 'Gorgeous 💕', 'Iconic 🙌',
  'Goals 💯', 'Amazing shot 📸', 'Beautiful ❤️', 'Yesss 🔥🔥', 'Can\'t stop looking at this 👀', 'Perfection 👌', 'Vibes ✨🌿',
  'Absolutely love it 💖', 'So pretty 🌸', 'Killing it 💪', 'Need this in my life 😍', 'Such a mood 😎', 'Glowing ✨', 'Obsessed with this 🙌',
  'Incredible 🤯', 'This made my day 😊', 'Too cute 🥰', 'Love the colors 🎨', 'Wow wow wow 🔥', 'Frame this 🖼️', 'Living for this 💃', 'Best one yet 👏',
];

/**
 * A new post commented on by up to three of the other accounts (at random), each a kind word from the list,
 * a moment apart. Returns the comments.
 */
export function autoComment(state, postId, { rand = Math.random, now = Date.now(), count = 3, write = null } = {}) {
  const p = postById(state, postId); if (!p) return [];
  const who = shuffled(state.accounts.filter((a) => a.id !== p.by), rand).slice(0, count);
  const words = shuffled(NICE_COMMENTS, rand);
  // (`write(accounts)`: their words (made for the post); else kind words from the list.)
  const made = write ? write(who) : null;
  const out = who.map((a, i) => ({ id: newId(), by: a.id, text: (made?.[i] && String(made[i]).trim().slice(0, 500)) || words[i % words.length], at: now + (i + 1) * 1000 }));
  p.comments.push(...out); if (out.length) p.upd = out[out.length - 1].at;
  return out;
}

// ---- Hashtags.

/** The #hashtags in a text, lower case, each once (letters, digits and _, from a letter or digit). */
export const hashtagsIn = (text) => [...new Set([...String(text ?? '').matchAll(/(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]{1,50})/gu)].map((m) => m[2].toLowerCase()))];
/** The shared posts with a hashtag in their caption, newest first. */
export const postsWithTag = (state, tag) => { const t = String(tag).toLowerCase().replace(/^#/, ''); return state.posts.filter((p) => live(p) && hashtagsIn(p.caption).includes(t)).sort((a, b) => b.at - a.at); };
/** Hashtags used in shared posts that start with (or contain) `q`, with how many posts each: [{ tag, count }]. */
export function searchTags(state, q) {
  const s2 = String(q ?? '').trim().toLowerCase().replace(/^#/, ''); const n = new Map();
  for (const p of state.posts) if (live(p)) for (const t of hashtagsIn(p.caption)) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n].filter(([t]) => !s2 || t.includes(s2)).sort((a, b) => (b[0].startsWith(s2) ? 1 : 0) - (a[0].startsWith(s2) ? 1 : 0) || b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
}

export const removePost = (state, id) => { state.gone ??= {}; state.gone[id] = Date.now(); state.posts = state.posts.filter((p) => p.id !== id); };
export const postById = (state, id) => state.posts.find((p) => p.id === id) ?? null;

/** The home feed for an account: its own posts and those of the accounts it follows, newest first. */
export function feedFor(state, me) {
  const a = accountById(state, me); if (!a) return [];
  const seen = new Set([me, ...a.following]);
  return state.posts.filter((p) => (seen.has(p.by) || collabsOf(p).some((c) => seen.has(c))) && live(p) && accountById(state, p.by)).sort((x, y) => y.at - x.at);
}

/** Like or unlike a post as `who`. Returns whether it's now liked. */
export function toggleLike(state, postId, who) {
  const p = postById(state, postId); if (!p || !accountById(state, who)) return false;
  p.upd = Date.now();
  if (p.likes.includes(who)) { p.likes = p.likes.filter((l) => l !== who); return false; }
  p.likes.push(who); return true;
}

/** Comment on a post as `who`. Returns the comment, or null. */
export function addComment(state, postId, who, text, { re = null, at = Date.now() } = {}) {
  const p = postById(state, postId); const t = String(text ?? '').trim();
  if (!p || !t || !accountById(state, who)) return null;
  // (`re`: the comment it answers (a reply, shown under it); replies to replies go under the same one.)
  const parent = re ? p.comments.find((x) => x.id === re) : null; const root = parent?.re ?? parent?.id ?? null;
  const c = { id: newId(), by: who, text: t.slice(0, 500), at, ...(root ? { re: root } : {}) };
  p.comments.push(c); p.upd = c.at; return c;
}

// ---- Saved posts: each account's own list, private to it.

/** Save a post to an account's list, or take it off. Returns whether it's saved now. */
export function toggleSave(state, who, postId) {
  const a = accountById(state, who); if (!a || !postById(state, postId)) return false;
  a.saved ??= []; a.upd = Date.now();
  if (a.saved.includes(postId)) { a.saved = a.saved.filter((x) => x !== postId); return false; }
  a.saved.unshift(postId); return true;
}
export const isSaved = (state, who, postId) => !!accountById(state, who)?.saved?.includes(postId);
/** An account's saved posts (still shared and showing), the latest saved first. */
export const savedOf = (state, who) => (accountById(state, who)?.saved ?? []).map((id) => postById(state, id)).filter((p) => p && live(p));

// ---- Views: how many times a post's been seen (in a feed, in Reels, opened from a profile), by anyone.
// Counted on each device and added up (a device's count only ever grows), so two devices' counts merge with
// nothing lost; a view doesn't count as a change to the post (it never overrides a like or an edit).

/** A view of a post, counted on `device`. */
export function addView(state, postId, device) {
  const p = postById(state, postId); if (!p) return 0;
  p.viewsBy ??= {}; p.viewsBy[device] = (p.viewsBy[device] ?? 0) + 1;
  return viewsOf(p);
}
/** How many times a post's been seen, on every device. */
export const viewsOf = (p) => Object.values(p?.viewsBy ?? {}).reduce((a, n) => a + n, 0);

/**
 * Posts in an order that favors the popular (views, then likes and comments) and the new, at random: the more
 * seen and liked, and the newer, the likelier near the top, not always (a weighted shuffle). `rand` for tests.
 */
export function rankPosts(posts, { now = Date.now(), rand = Math.random } = {}) {
  const weight = (p) => {
    const pop = 1 + Math.log1p(viewsOf(p)) + 0.6 * Math.log1p(p.likes.length) + 0.4 * Math.log1p(p.comments.length);
    const age = Math.max(0, now - p.at) / 86400000; // days
    return pop / (1 + age / 4);
  };
  return posts.map((p) => ({ p, k: Math.log(Math.max(1e-12, rand())) / weight(p) })).sort((a, b) => b.k - a.k).map((x) => x.p);
}

// ---- Collabs: a post shared by its account and up to three others, each invited and saying yes.

export const MAX_COLLAB = 3;
/**
 * Invite accounts to a post as collaborators: each new one gets a collab request in their messages. Those
 * no longer in `ids` are taken off it. Returns the accounts newly invited.
 */
export function setCollabs(state, postId, ids) {
  const p = postById(state, postId); if (!p) return [];
  const want = [...new Set(ids ?? [])].filter((id) => id !== p.by && accountById(state, id)).slice(0, MAX_COLLAB);
  const before = p.collab ?? [];
  const keep = before.filter((c) => want.includes(c.id));
  const fresh = want.filter((id) => !keep.some((c) => c.id === id));
  const now = Date.now();
  p.collab = [...keep, ...fresh.map((id) => ({ id, status: 'pending', at: now }))];
  if (fresh.length || keep.length !== before.length) p.upd = now;
  // (A request each, in their messages, unless it's a draft: they're asked when it's shared.)
  if (!p.draft) for (const id of fresh) sendMessage(state, p.by, id, '', { collab: p.id });
  return fresh;
}
/** Send the requests of a draft's collaborators, now that it's shared. */
export function sendCollabRequests(state, postId) {
  const p = postById(state, postId); if (!p || p.draft) return;
  for (const c of p.collab ?? []) if (c.status === 'pending' && !(state.messages ?? []).some((m) => m.collab === p.id && m.to === c.id)) sendMessage(state, p.by, c.id, '', { collab: p.id });
}
/** `who` answers a collab request: yes (the post's on their profile too) or no. Returns whether it changed. */
export function answerCollab(state, postId, who, accept) {
  const p = postById(state, postId); const c = p?.collab?.find((x) => x.id === who);
  if (!c || c.status !== 'pending') return false;
  c.status = accept ? 'accepted' : 'declined'; c.at = p.upd = Date.now(); return true;
}
/** The posts an account's been asked to collaborate on and hasn't answered (newest first; `from`: by that one only). */
export const pendingCollabsFor = (state, who, from = null) => state.posts.filter((p) => !p.trashed && !p.draft && (!from || p.by === from) && p.collab?.some((c) => c.id === who && c.status === 'pending')).sort((a, b) => b.at - a.at);
/** Accept every collab request an account has (`from`: only that one's). Returns how many. */
export function acceptAllCollabs(state, who, from = null) {
  const posts = pendingCollabsFor(state, who, from); let n = 0;
  for (const p of posts) if (answerCollab(state, p.id, who, true)) n++;
  // (Their notifications cleared too: each request's message read (anything newer stays unread).)
  const ids = new Set(posts.map((p) => p.id));
  for (const m of state.messages ?? []) if (m.to === who && m.collab && (ids.has(m.collab) || (from ? m.from === from : true))) markRead(state, who, m.from, m.at);
  return n;
}
/** A collaborator leaves a post (it's off their profile). */
export function leaveCollab(state, postId, who) {
  const p = postById(state, postId); if (!p?.collab?.some((c) => c.id === who)) return false;
  p.collab = p.collab.filter((c) => c.id !== who); p.upd = Date.now(); return true;
}

// ---- Direct messages between accounts.

/** Send a message from one account to another (with a post shared, `post`). Returns it, or null (empty, or to yourself). */
export function sendMessage(state, from, to, text, { post = null, collab = null } = {}) {
  const t = String(text ?? '').trim(); const sh = post && postById(state, post) ? post : null; const co = collab && postById(state, collab) ? collab : null;
  if ((!t && !sh && !co) || from === to || !accountById(state, from) || !accountById(state, to)) return null;
  const m = { id: newId(), from, to, text: t.slice(0, 2000), at: Date.now(), ...(sh ? { post: sh } : {}), ...(co ? { collab: co } : {}) };
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

/** An account's unopened messages: how many, and when the latest of them was sent (0: none). */
export function unreadInfo(state, me) {
  let n = 0; let last = 0;
  for (const m of state.messages ?? []) if (m.to === me && m.at > lastRead(state, me, m.from)) { n++; last = Math.max(last, m.at); }
  return { n, last };
}

/**
 * The accounts to pick from, in order: the Owner first; then those with unopened messages (collab requests
 * among them), the most first, then the latest sent; then the rest, the most recently used first (`used`:
 * { accountId: when it was last switched to }).
 */
export function switcherOrder(state, used = {}) {
  const owner = state.accounts.filter((a) => a.owner);
  const rest = state.accounts.filter((a) => !a.owner).map((a) => ({ a, u: unreadInfo(state, a.id), t: used[a.id] ?? 0 }));
  rest.sort((x, y) => (y.u.n > 0) - (x.u.n > 0) || y.u.n - x.u.n || y.u.last - x.u.last || y.t - x.t || x.a.at - y.a.at);
  return [...owner, ...rest.map((x) => x.a)];
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
  s.accounts = (Array.isArray(raw.accounts) ? raw.accounts : []).filter((a) => a && ok(a.id) && ok(a.handle)).map((a) => ({ id: a.id, handle: a.handle, name: a.name ?? '', bio: a.bio ?? '', avatar: a.avatar ?? null, avatarId: a.avatarId ?? (a.avatar ? newId() : null), owner: !!a.owner, kind: kindOf(a.kind), following: Array.isArray(a.following) ? a.following.filter(ok) : [], saved: Array.isArray(a.saved) ? [...new Set(a.saved.filter(ok))] : [], ...(VOICES.includes(a.voice) ? { voice: a.voice } : {}), ...(typeof a.interests === 'string' && a.interests.trim() ? { interests: a.interests.trim().slice(0, 120) } : {}), ...cleanFace(a), ...(cleanFaces(a.learned).length ? { learned: cleanFaces(a.learned) } : {}), ...(cleanFaces(a.notFaces).length ? { notFaces: cleanFaces(a.notFaces) } : {}), at: a.at ?? 0, upd: a.upd ?? a.at ?? 0 }));
  // (Exactly one Owner: the one made so last, else the oldest account.)
  { const owners = s.accounts.filter((a) => a.owner).sort((a, b) => b.upd - a.upd); for (const a of owners.slice(1)) a.owner = false; if (!owners.length && s.accounts.length) [...s.accounts].sort((a, b) => a.at - b.at)[0].owner = true; }
  const ids = new Set(s.accounts.map((a) => a.id));
  for (const a of s.accounts) a.following = a.following.filter((f) => ids.has(f) && f !== a.id);
  s.posts = (Array.isArray(raw.posts) ? raw.posts : []).filter((p) => p && ok(p.id) && ids.has(p.by)).map((p) => ({ id: p.id, by: p.by, kind: p.kind === 'video' ? 'video' : 'photo', image: p.image ?? null, imageId: p.imageId ?? (p.image ? newId() : null), video: p.video ?? null, videoId: p.videoId ?? (p.video ? newId() : null), ...(cleanFit(p.fit) ? { fit: cleanFit(p.fit) } : {}), more: Array.isArray(p.more) ? p.more.filter((m) => m && (m.imageId || m.videoId || m.image || m.video)).map((m) => ({ kind: m.kind === 'video' ? 'video' : 'photo', image: m.image ?? null, imageId: m.imageId ?? (m.image ? newId() : null), video: m.video ?? null, videoId: m.videoId ?? (m.video ? newId() : null), ...(cleanFit(m.fit) ? { fit: cleanFit(m.fit) } : {}) })) : [], viewsBy: p.viewsBy && typeof p.viewsBy === 'object' ? Object.fromEntries(Object.entries(p.viewsBy).filter(([k, v]) => ok(k) && Number.isFinite(v) && v > 0).map(([k, v]) => [k, Math.floor(v)])) : {}, collab: Array.isArray(p.collab) ? p.collab.filter((c) => c && ids.has(c.id) && c.id !== p.by && ['pending', 'accepted', 'declined'].includes(c.status)).slice(0, MAX_COLLAB).map((c) => ({ id: c.id, status: c.status, at: c.at ?? 0 })) : [], draft: !!p.draft, pinned: Number(p.pinned) || 0, trashed: Number(p.trashed) || 0, ...(p.fromSaved && typeof p.fromSaved.fileId === 'string' ? { fromSaved: { fileId: p.fromSaved.fileId.slice(0, 200), name: String(p.fromSaved.name ?? '').slice(0, 200), at: Number(p.fromSaved.at) || 0 } } : {}), ...(Array.isArray(p.faces) ? { faces: p.faces.filter((d) => Array.isArray(d) && d.length === 128 && d.every(Number.isFinite)).slice(0, 8).map((d) => d.map((v) => Math.round(v * 10000) / 10000)) } : {}), scene: p.scene === undefined ? undefined : cleanScene(p.scene), caption: p.caption ?? '', tags: Array.isArray(p.tags) ? [...new Set(p.tags.filter((t) => ids.has(t)))] : [], at: p.at ?? 0, upd: p.upd ?? p.at ?? 0, edited: p.edited ?? 0, likes: Array.isArray(p.likes) ? p.likes.filter((l) => ids.has(l)) : [], comments: Array.isArray(p.comments) ? p.comments.filter((c) => c && ids.has(c.by) && ok(c.text)) : [] }));
  s.me = ids.has(raw.me) ? raw.me : (s.accounts[0]?.id ?? null);
  s.gone = raw.gone && typeof raw.gone === 'object' ? Object.fromEntries(Object.entries(raw.gone).filter(([k, v]) => ok(k) && Number.isFinite(v))) : {};
  s.messages = (Array.isArray(raw.messages) ? raw.messages : []).filter((m) => m && ok(m.id) && ids.has(m.from) && ids.has(m.to) && (ok(m.text) || ok(m.post) || ok(m.collab)) && !s.gone[m.id]).map((m) => ({ id: m.id, from: m.from, to: m.to, text: m.text ?? '', at: m.at ?? 0, ...(ok(m.post) ? { post: m.post } : {}), ...(ok(m.collab) ? { collab: m.collab } : {}) }));
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
  const out = normalize({ accounts: pick(local.accounts, remote.accounts ?? []), posts: pick(local.posts, remote.posts ?? []), messages: [...msgs.values()].filter((m) => !gone[m.id]), reads, me: local.me, gone });
  // (Views from both: each device's count, the higher (a device's only grows), whichever version of the post won.)
  const vb = new Map(); for (const p of [...local.posts, ...(remote.posts ?? [])]) { const m = vb.get(p.id) ?? {}; for (const [k, v] of Object.entries(p.viewsBy ?? {})) m[k] = Math.max(m[k] ?? 0, v); vb.set(p.id, m); }
  for (const p of out.posts) p.viewsBy = { ...(vb.get(p.id) ?? {}) };
  return out;
}
