// Socials (web/apps/socials/socials-core.js): accounts, following, the feed, likes, comments, removing,
// and state read back from storage made safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, addAccount, editAccount, removeAccount, toggleFollow, isFollowing, followersOf, addPost, feedFor, toggleLike, addComment, searchAccounts, normalize, cleanHandle, handleProblem, timeAgo, countLabel, postsBy, ownerOf, accountsInOrder, setOwner, editPost, reelsOf, sendMessage, conversation, conversationsOf, markRead, unreadCount, mergeStates, taggedIn, captionParts } from '../web/apps/socials/socials-core.js';

test('handles: cleaned as typed, never two the same', () => {
  assert.equal(cleanHandle(' @Maya Shoots!! '), 'mayashoots');
  const s = emptyState(); addAccount(s, { handle: 'maya' });
  assert.match(handleProblem(s, 'MAYA'), /already/);
  assert.match(handleProblem(s, '!!!'), /Pick a username/);
  assert.throws(() => addAccount(s, { handle: '@maya' }), /already/);
});

test('the first account is the one in use; the feed is your posts and those you follow, newest first', () => {
  const s = emptyState();
  const a = addAccount(s, { handle: 'a' }); const b = addAccount(s, { handle: 'b' }); const c = addAccount(s, { handle: 'c' });
  assert.equal(s.me, a.id);
  const pb = addPost(s, b.id, { caption: 'from b' }); pb.at = 1000;
  const pc = addPost(s, c.id, { caption: 'from c' }); pc.at = 2000;
  const pa = addPost(s, a.id, { caption: 'from a' }); pa.at = 1500;
  assert.deepEqual(feedFor(s, a.id).map((p) => p.caption), ['from a'], 'nothing followed: only your own');
  assert.equal(toggleFollow(s, a.id, b.id), true);
  assert.equal(toggleFollow(s, a.id, a.id), false, 'not yourself');
  assert.deepEqual(feedFor(s, a.id).map((p) => p.caption), ['from a', 'from b']);
  assert.ok(isFollowing(s, a.id, b.id) && !isFollowing(s, b.id, a.id));
  assert.deepEqual(followersOf(s, b.id).map((x) => x.handle), ['a']);
  assert.equal(toggleFollow(s, a.id, b.id), false, 'unfollowed');
  assert.deepEqual(feedFor(s, a.id).map((p) => p.caption), ['from a']);
});

test('likes and comments by the account in use; a post needs a photo or words', () => {
  const s = emptyState(); const a = addAccount(s, { handle: 'a' }); const b = addAccount(s, { handle: 'b' });
  assert.throws(() => addPost(s, a.id, { caption: '  ' }), /photo/);
  const p = addPost(s, a.id, { caption: 'hi' });
  assert.equal(toggleLike(s, p.id, b.id), true); assert.deepEqual(p.likes, [b.id]);
  assert.equal(toggleLike(s, p.id, b.id), false); assert.deepEqual(p.likes, []);
  assert.equal(addComment(s, p.id, b.id, '   '), null);
  assert.equal(addComment(s, p.id, b.id, ' nice ').text, 'nice');
});

test('editing and removing an account: its posts, follows, likes and comments go with it', () => {
  const s = emptyState(); const a = addAccount(s, { handle: 'a' }); const b = addAccount(s, { handle: 'b' });
  assert.throws(() => editAccount(s, b.id, { handle: 'a' }), /already/);
  editAccount(s, b.id, { handle: 'bee', bio: 'hello' }); assert.equal(b.handle, 'bee');
  const p = addPost(s, a.id, { caption: 'x' }); toggleFollow(s, a.id, b.id); toggleLike(s, p.id, b.id); addComment(s, p.id, b.id, 'yo');
  addPost(s, b.id, { caption: 'by b' });
  removeAccount(s, b.id);
  assert.equal(s.accounts.length, 1); assert.deepEqual(a.following, []); assert.deepEqual(p.likes, []); assert.deepEqual(p.comments, []);
  assert.deepEqual(postsBy(s, b.id), []);
  removeAccount(s, a.id); assert.equal(s.me, null);
});

test('search, time ago, counts, and state from storage made safe', () => {
  const s = emptyState(); addAccount(s, { handle: 'maya.shoots', name: 'Maya' }); addAccount(s, { handle: 'jordan' });
  assert.deepEqual(searchAccounts(s, '@MAY').map((a) => a.handle), ['maya.shoots']);
  assert.equal(searchAccounts(s, '').length, 2);
  assert.equal(timeAgo(0, 30_000), 'now'); assert.equal(timeAgo(0, 5 * 60_000), '5m'); assert.equal(timeAgo(0, 3 * 3600_000), '3h'); assert.equal(timeAgo(0, 2 * 86400_000), '2d');
  assert.equal(countLabel(1204), '1,204'); assert.equal(countLabel(12500), '12.5K'); assert.equal(countLabel(3_100_000), '3.1M');
  const n = normalize({ accounts: [{ id: 'x', handle: 'x', following: ['x', 'gone'] }, { bad: 1 }], posts: [{ id: 'p', by: 'gone' }, { id: 'q', by: 'x', likes: ['gone', 'x'] }], me: 'gone' });
  assert.equal(n.accounts.length, 1); assert.deepEqual(n.accounts[0].following, []); assert.equal(n.posts.length, 1); assert.deepEqual(n.posts[0].likes, ['x']); assert.equal(n.me, 'x');
  assert.deepEqual(normalize(null), emptyState());
});

/** A Saved Files script stand-in: folders in the main folder by name, files in each (same names replaced). */
function fakeDrive() {
  const folders = new Map(); let n = 0; const seen = [];
  return {
    seen,
    folders: async () => [...folders.keys()].map((name) => ({ id: `f:${name}`, name, path: name })),
    browse: async (id) => ({ files: [...(folders.get(id.slice(2)) ?? new Map()).values()].map(({ id: fid, name }) => ({ id: fid, name })), folders: [], path: [] }),
    async upload(file, from, folder) {
      const m = folders.get(folder) ?? new Map(); folders.set(folder, m);
      const bytes = new Uint8Array(await file.arrayBuffer()); seen.push(bytes);
      m.set(file.name, { id: `x${++n}`, name: file.name, bytes, type: file.type });
      return { id: `x${n}`, name: file.name };
    },
    async download(id) { for (const m of folders.values()) for (const f of m.values()) if (f.id === id) return new File([f.bytes], f.name, { type: f.type }); throw new Error('gone'); },
  };
}

test('sync between two phones through Drive: encrypted there, merged both ways, photos sent once, a wrong password refused', async () => {
  const { syncSocials, WrongPassword, opens, remoteHeader } = await import('../web/apps/socials/socials-sync.js');
  const drive = fakeDrive(); const pw = 'blue-heron-42'; const fast = { iterations: 1000 };
  const photo = new Blob([new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 6, 7, 8])], { type: 'image/jpeg' });
  // Phone A: an account and a post with a photo, sent first (the copy in Drive made now: a recovery key).
  const A = emptyState(); const maya = addAccount(A, { handle: 'maya' }); addPost(A, maya.id, { image: photo, caption: 'Sunset at the pier' });
  const r1 = await syncSocials(drive, A, pw, fast);
  assert.ok(r1.recoveryKey, 'a recovery key, shown once'); assert.equal(r1.sent, 1);
  // (Nothing readable in Drive: no caption, no handle in any file sent but the key file's wrapped key.)
  const text = drive.seen.map((b) => new TextDecoder().decode(b)).join('\n');
  assert.ok(!text.includes('Sunset') && !text.includes('maya'), 'encrypted in Drive');
  assert.ok(await opens(await remoteHeader(drive), pw) && !(await opens(await remoteHeader(drive), 'nope')));
  // Phone B, empty: the same password brings everything, the photo too.
  const r2 = await syncSocials(drive, emptyState(), pw, fast);
  assert.equal(r2.recoveryKey, null); assert.equal(r2.fetched, 1);
  const B = r2.state;
  assert.deepEqual(B.posts.map((p) => p.caption), ['Sunset at the pier']);
  assert.deepEqual([...new Uint8Array(await B.posts[0].image.arrayBuffer())], [...new Uint8Array(await photo.arrayBuffer())]);
  // B adds an account that follows maya and likes the post; A meanwhile edits its bio. Both synced: both have both.
  const jo = addAccount(B, { handle: 'jordan' }); B.me = jo.id; toggleFollow(B, jo.id, maya.id); toggleLike(B, B.posts[0].id, jo.id);
  await new Promise((r) => setTimeout(r, 5));
  const A2 = r1.state; editAccount(A2, maya.id, { bio: 'photos' });
  const rb = await syncSocials(drive, B, pw, fast); assert.equal(rb.sent, 0, 'the photo isn\'t sent again');
  const ra = await syncSocials(drive, A2, pw, fast);
  assert.deepEqual(ra.state.accounts.map((a) => a.handle).sort(), ['jordan', 'maya']);
  assert.equal(ra.state.me, maya.id, 'each phone keeps the account it\'s using');
  assert.deepEqual(feedFor(ra.state, jo.id).map((p) => p.caption), ['Sunset at the pier']);
  assert.equal(ra.state.accounts.find((a) => a.handle === 'maya').bio, 'photos');
  // A deletes the post; B, syncing after, loses it too (not brought back).
  removeAccount(ra.state, jo.id);
  await syncSocials(drive, ra.state, pw, fast);
  const rb2 = await syncSocials(drive, rb.state, pw, fast);
  assert.deepEqual(rb2.state.accounts.map((a) => a.handle), ['maya'], 'a deletion on one phone reaches the other');
  // Another password: refused, nothing changed.
  await assert.rejects(syncSocials(drive, emptyState(), 'wrong-password', fast), WrongPassword);
});

test('the Owner: the first account, always listed first; made another; never two; a deleted Owner passes it on', () => {
  const s = emptyState(); const o = addAccount(s, { handle: 'me' }); const b = addAccount(s, { handle: 'b' }); const c = addAccount(s, { handle: 'c' });
  assert.ok(o.owner && !b.owner && !c.owner); o.at = 1; b.at = 2; c.at = 3;
  s.accounts.reverse();
  assert.deepEqual(accountsInOrder(s).map((a) => a.handle), ['me', 'b', 'c']);
  assert.equal(setOwner(s, c.id), true); assert.equal(ownerOf(s).handle, 'c'); assert.ok(!o.owner);
  assert.deepEqual(accountsInOrder(s).map((a) => a.handle), ['c', 'me', 'b']);
  // (Two marked Owner (two phones each made one): the one made so last.)
  o.owner = true; o.upd = c.upd + 10; assert.equal(normalize(s).accounts.filter((a) => a.owner).map((a) => a.handle).join(), 'me');
  // (None marked (an older copy): the oldest account.)
  const n = normalize({ accounts: [{ id: 'y', handle: 'y', at: 5 }, { id: 'x', handle: 'x', at: 1 }] }); assert.equal(ownerOf(n).handle, 'x');
  removeAccount(s, c.id); assert.equal(ownerOf(s).handle, 'me', 'passed on to the oldest');
});

test('messages between accounts: sent, in order, unread until read; merged from two phones; gone with an account', () => {
  const s = emptyState(); const a = addAccount(s, { handle: 'a' }); const b = addAccount(s, { handle: 'b' }); const c = addAccount(s, { handle: 'c' });
  assert.equal(sendMessage(s, a.id, a.id, 'me?'), null); assert.equal(sendMessage(s, a.id, b.id, '  '), null);
  const m1 = sendMessage(s, a.id, b.id, 'hi b'); m1.at = 1000; const m2 = sendMessage(s, b.id, a.id, 'hi a'); m2.at = 2000; const m3 = sendMessage(s, c.id, b.id, 'yo'); m3.at = 3000;
  s.reads = {};
  assert.deepEqual(conversation(s, a.id, b.id).map((m) => m.text), ['hi b', 'hi a']);
  assert.equal(unreadCount(s, b.id), 2); assert.deepEqual(conversationsOf(s, b.id).map((x) => [x.other.handle, x.unread]), [['c', 1], ['a', 1]]);
  markRead(s, b.id, a.id, 2000); assert.equal(unreadCount(s, b.id), 1);
  const other = JSON.parse(JSON.stringify(s)); const m4 = sendMessage(other, a.id, b.id, 'from the other phone');
  const merged = mergeStates(s, other); assert.ok(conversation(merged, a.id, b.id).some((m) => m.id === m4.id)); assert.equal(merged.reads[b.id][a.id], 2000);
  removeAccount(merged, c.id); assert.equal(conversationsOf(merged, b.id).length, 1);
  assert.equal(mergeStates(merged, other).messages.some((m) => m.from === c.id), false, 'not brought back by the other copy');
});

test('videos: Reels has only them, newest first; a post edited (caption, photo) is marked so', () => {
  const s = emptyState(); const a = addAccount(s, { handle: 'a' });
  const img = new Blob(['x']); const vid = new Blob(['v'], { type: 'video/mp4' });
  const p1 = addPost(s, a.id, { image: img, caption: 'photo' }); const v1 = addPost(s, a.id, { image: img, video: vid, caption: 'clip 1' }); v1.at = 1; const v2 = addPost(s, a.id, { video: vid, caption: 'clip 2' }); v2.at = 2;
  assert.equal(v1.kind, 'video'); assert.ok(v1.videoId); assert.equal(p1.kind, 'photo');
  assert.deepEqual(reelsOf(s).map((p) => p.caption), ['clip 2', 'clip 1']);
  const old = p1.imageId; editPost(s, p1.id, { caption: 'photo, edited', image: new Blob(['y']) });
  assert.equal(p1.caption, 'photo, edited'); assert.notEqual(p1.imageId, old); assert.ok(p1.edited > 0);
  assert.equal(normalize(JSON.parse(JSON.stringify({ ...s, posts: s.posts.map(({ image, video, ...p }) => p) }))).posts.find((p) => p.id === v2.id).kind, 'video', 'kept a video when its file isn\'t here');
});

test('tags, @mentions and shared posts: only real accounts; tagged posts per account; a post shared in a message; gone with the account', () => {
  const s = emptyState(); const a = addAccount(s, { handle: 'a' }); const b = addAccount(s, { handle: 'b.c' });
  const p = addPost(s, a.id, { caption: 'Hi @b.c and @nobody, @B.C.', tags: [b.id, b.id, 'ghost'] });
  assert.deepEqual(p.tags, [b.id], 'each once, real ones');
  assert.deepEqual(taggedIn(s, b.id).map((x) => x.id), [p.id]);
  assert.deepEqual(captionParts(s, p.caption).map((x) => x.handle ?? x.text), ['Hi ', 'b.c', ' and @nobody, ', 'b.c', '.']);
  assert.equal(sendMessage(s, a.id, b.id, '', { post: 'nope' }), null, 'nothing to send');
  const m = sendMessage(s, a.id, b.id, '', { post: p.id }); assert.equal(m.post, p.id);
  assert.equal(normalize(JSON.parse(JSON.stringify(s))).messages[0].post, p.id, 'kept');
  removeAccount(s, b.id); assert.deepEqual(p.tags, []);
});

test('posts of several: their photos and videos in order, each its own id; kept and merged; Reels shuffled', async () => {
  const { mediaOf, shuffled } = await import('../web/apps/socials/socials-core.js');
  const s = emptyState(); const a = addAccount(s, { handle: 'a' });
  const img = (t) => new Blob([t], { type: 'image/jpeg' }); const vid = new Blob(['v'], { type: 'video/mp4' });
  const p = addPost(s, a.id, { image: img('1'), caption: 'trip', more: [{ image: img('2') }, { image: img('s'), video: vid }, {}] });
  const m = mediaOf(p); assert.equal(m.length, 3, 'empty ones left out'); assert.deepEqual(m.map((x) => x.kind), ['photo', 'photo', 'video']);
  assert.equal(new Set(m.flatMap((x) => [x.imageId, x.videoId]).filter(Boolean)).size, 4, 'each its own id');
  const back = normalize(JSON.parse(JSON.stringify({ ...s, posts: s.posts.map(({ image, video, ...q }) => ({ ...q, more: q.more.map(({ image: i2, video: v2, ...r }) => r) })) })));
  assert.deepEqual(mediaOf(back.posts[0]).map((x) => x.imageId), m.map((x) => x.imageId), 'ids kept without the files');
  assert.ok(addPost(s, a.id, { image: img('x'), more: Array.from({ length: 15 }, () => ({ image: img('y') })) }).more.length <= 9, 'ten at most');
  let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const order = shuffled([1, 2, 3, 4, 5, 6, 7, 8], rand); assert.deepEqual([...order].sort(), [1, 2, 3, 4, 5, 6, 7, 8]); assert.notDeepEqual(order, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('a post of several goes to another phone through Drive whole: every photo and video in it', async () => {
  const { syncSocials, pendingFiles } = await import('../web/apps/socials/socials-sync.js');
  const { mediaOf } = await import('../web/apps/socials/socials-core.js');
  const drive = fakeDrive(); const fast = { iterations: 1000 };
  const A = emptyState(); const a = addAccount(A, { handle: 'a' });
  addPost(A, a.id, { image: new Blob([new Uint8Array([0xff, 0xd8, 1])], { type: 'image/jpeg' }), more: [{ image: new Blob([new Uint8Array([0xff, 0xd8, 2])], { type: 'image/jpeg' }) }, { image: new Blob([new Uint8Array([0xff, 0xd8, 3])], { type: 'image/jpeg' }), video: new Blob([new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])], { type: 'video/mp4' }) }] });
  assert.equal(pendingFiles(A, [], true), 5, 'four files and the posts');
  const r1 = await syncSocials(drive, A, 'pw-1234', fast); assert.equal(r1.sent, 4);
  assert.equal(pendingFiles(r1.state, r1.driveMedia, false), 0);
  const B = (await syncSocials(drive, emptyState(), 'pw-1234', fast)).state;
  const m = mediaOf(B.posts[0]);
  assert.deepEqual(m.map((x) => x.kind), ['photo', 'photo', 'video']);
  assert.deepEqual(await Promise.all(m.map(async (x) => (await x.image.arrayBuffer()).byteLength)), [3, 3, 3]);
  assert.equal(m[2].video.type, 'video/mp4');
});

test('drafts, pins and the trash: drafts aren\'t shared; three pinned at most, first on the profile; deleted posts come back for a week, then go', async () => {
  const c = await import('../web/apps/socials/socials-core.js');
  const s = emptyState(); const a = addAccount(s, { handle: 'a' }); const b = addAccount(s, { handle: 'b' }); toggleFollow(s, b.id, a.id);
  const old = addPost(s, a.id, { caption: 'old' }); old.at = 1000;
  const d = addPost(s, a.id, { caption: 'draft #x', draft: true });
  assert.deepEqual(feedFor(s, b.id).map((p) => p.caption), ['old'], 'a draft isn\'t in the feed');
  assert.deepEqual(c.draftsOf(s, a.id).map((p) => p.id), [d.id]); assert.equal(c.postsWithTag(s, 'x').length, 0, 'nor under its hashtag');
  const ps = [1, 2, 3, 4].map((i) => { const p = addPost(s, a.id, { caption: `p${i}` }); p.at = 2000 + i; return p; });
  c.togglePin(s, old.id); c.togglePin(s, ps[0].id); c.togglePin(s, ps[1].id);
  assert.throws(() => c.togglePin(s, ps[2].id), /3 posts/);
  assert.deepEqual(postsBy(s, a.id).slice(0, 3).map((p) => p.caption).sort(), ['old', 'p1', 'p2'], 'pinned first');
  assert.equal(c.togglePin(s, old.id), false, 'unpinned');
  c.trashPost(s, ps[3].id, 5000);
  assert.ok(!postsBy(s, a.id).some((p) => p.id === ps[3].id), 'deleted: off the profile');
  assert.equal(c.trashOf(s, 5000 + 86400000)[0].daysLeft, 6);
  c.restorePost(s, ps[3].id); assert.ok(postsBy(s, a.id).some((p) => p.id === ps[3].id), 'brought back');
  c.trashPost(s, ps[3].id, 5000);
  assert.equal(c.emptyOldTrash(s, 5000 + 6 * 86400000), 0, 'still there after six days');
  assert.equal(c.emptyOldTrash(s, 5000 + 8 * 86400000), 1, 'gone after more than seven');
  assert.equal(c.postById(s, ps[3].id), null); assert.ok(s.gone[ps[3].id], 'and gone from the other devices too');
});

test('stories, comments for new posts, hashtags', async () => {
  const c = await import('../web/apps/socials/socials-core.js');
  const s = emptyState(); const a = addAccount(s, { handle: 'a' }); for (const h of ['b', 'c', 'd', 'e']) addAccount(s, { handle: h });
  const now = 10 * 86400000;
  const p1 = addPost(s, a.id, { caption: 'yesterday' }); p1.at = now - 25 * 3600000;
  const p2 = addPost(s, a.id, { caption: 'this morning #Beach' }); p2.at = now - 5 * 3600000;
  const p3 = addPost(s, a.id, { caption: 'just now #beach #sun' }); p3.at = now - 60000;
  assert.deepEqual(c.storiesOf(s, a.id, now).map((p) => p.caption), ['this morning #Beach', 'just now #beach #sun'], 'the last 24 hours, oldest first');
  let seed = 3; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cm = c.autoComment(s, p3.id, { rand, now });
  assert.equal(cm.length, 3); assert.equal(new Set(cm.map((x) => x.by)).size, 3, 'three different accounts');
  assert.ok(cm.every((x) => x.by !== a.id && c.NICE_COMMENTS.includes(x.text)), 'not the poster; from the list');
  assert.ok(c.NICE_COMMENTS.every((t) => /\p{Extended_Pictographic}/u.test(t)), 'each with an emoji');
  const solo = emptyState(); const o = addAccount(solo, { handle: 'o' }); const q = addPost(solo, o.id, { caption: 'x' });
  assert.deepEqual(c.autoComment(solo, q.id), [], 'no one else: none');
  assert.deepEqual(c.postsWithTag(s, '#BEACH').map((p) => p.id), [p3.id, p2.id]);
  assert.deepEqual(c.searchTags(s, 'b'), [{ tag: 'beach', count: 2 }]);
  assert.deepEqual(c.searchTags(s, '').map((t) => t.tag), ['beach', 'sun']);
});

test('collabs: invited accounts get a request; accepted, the post is on their profile and their followers\' feeds; declined or left, it isn\'t; a draft\'s are asked when it\'s shared', async () => {
  const c = await import('../web/apps/socials/socials-core.js');
  const s = emptyState(); const a = addAccount(s, { handle: 'a' }); const b = addAccount(s, { handle: 'b' }); const d = addAccount(s, { handle: 'd' }); const f = addAccount(s, { handle: 'fan' });
  toggleFollow(s, f.id, b.id); // (fan follows b, not a)
  const p = addPost(s, a.id, { caption: 'together' });
  assert.deepEqual(c.setCollabs(s, p.id, [b.id, d.id, a.id, 'ghost']), [b.id, d.id], 'not the poster, real ones');
  const req = s.messages.filter((m) => m.collab === p.id); assert.deepEqual(req.map((m) => m.to).sort(), [b.id, d.id].sort(), 'a request each');
  assert.equal(c.unreadCount(s, b.id), 1);
  assert.ok(!postsBy(s, b.id).some((x) => x.id === p.id), 'not on b\'s profile until accepted');
  assert.equal(c.answerCollab(s, p.id, b.id, true), true); assert.equal(c.answerCollab(s, p.id, b.id, false), false, 'answered once');
  c.answerCollab(s, p.id, d.id, false);
  assert.ok(postsBy(s, b.id).some((x) => x.id === p.id), 'on b\'s profile');
  assert.ok(!postsBy(s, d.id).some((x) => x.id === p.id), 'not d\'s (declined)');
  assert.deepEqual(feedFor(s, f.id).map((x) => x.id), [p.id], 'in b\'s followers\' feed');
  assert.deepEqual(c.collabsOf(p), [b.id]);
  c.leaveCollab(s, p.id, b.id); assert.ok(!postsBy(s, b.id).some((x) => x.id === p.id), 'left');
  assert.equal(normalize(JSON.parse(JSON.stringify(s))).messages.filter((m) => m.collab).length, 2, 'requests kept');
  const dr = addPost(s, a.id, { caption: 'later', draft: true }); c.setCollabs(s, dr.id, [d.id]);
  assert.equal(s.messages.filter((m) => m.collab === dr.id).length, 0, 'a draft: not asked yet');
  dr.draft = false; c.sendCollabRequests(s, dr.id); assert.equal(s.messages.filter((m) => m.collab === dr.id).length, 1, 'asked when shared');
  removeAccount(s, d.id); assert.equal(dr.collab.length, 0);
});

test('saved posts (each account\'s own) and views (counted per device, added up, merged with nothing lost; a view isn\'t an edit); the popular likelier first', async () => {
  const c = await import('../web/apps/socials/socials-core.js');
  const s = emptyState(); const a = addAccount(s, { handle: 'a' }); const b = addAccount(s, { handle: 'b' });
  const p = addPost(s, a.id, { caption: 'one' }); const q = addPost(s, a.id, { caption: 'two' });
  assert.equal(c.toggleSave(s, b.id, p.id), true); c.toggleSave(s, b.id, q.id);
  assert.deepEqual(c.savedOf(s, b.id).map((x) => x.caption), ['two', 'one'], 'latest saved first');
  assert.deepEqual(c.savedOf(s, a.id), [], 'b\'s own');
  c.trashPost(s, q.id); assert.deepEqual(c.savedOf(s, b.id).map((x) => x.caption), ['one'], 'a deleted post isn\'t in it');
  assert.equal(c.toggleSave(s, b.id, p.id), false);
  // Views: two devices, merged.
  const upd = p.upd;
  c.addView(s, p.id, 'phone'); c.addView(s, p.id, 'phone');
  assert.equal(c.viewsOf(p), 2); assert.equal(p.upd, upd, 'a view isn\'t a change to it');
  const other = JSON.parse(JSON.stringify(s)); other.posts.find((x) => x.id === p.id).viewsBy = { phone: 1, ipad: 3 };
  toggleLike(other, p.id, b.id); other.posts.find((x) => x.id === p.id).upd = p.upd + 1000; // (the other device also liked it, later: its version wins…)
  const m = mergeStates(s, other); const mp = m.posts.find((x) => x.id === p.id);
  assert.equal(c.viewsOf(mp), 5, '…but views from both: phone 2, iPad 3'); assert.deepEqual(mp.likes, [b.id]);
  assert.equal(c.viewsOf(normalize(JSON.parse(JSON.stringify(m))).posts.find((x) => x.id === p.id)), 5, 'kept');
  // Ranking: a much-viewed post is first far more often than a never-seen one of the same age.
  const t = emptyState(); const o = addAccount(t, { handle: 'o' });
  const hot = addPost(t, o.id, { caption: 'hot' }); const cold = addPost(t, o.id, { caption: 'cold' }); hot.at = cold.at = 1000;
  for (let i = 0; i < 200; i++) c.addView(t, hot.id, 'd');
  let seed = 11; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let first = 0; for (let i = 0; i < 400; i++) if (c.rankPosts(t.posts, { now: 2000, rand })[0].id === hot.id) first++;
  assert.ok(first > 260 && first < 400, `the popular first most of the time, not always: ${first}/400`);
  const old = addPost(t, o.id, { caption: 'old' }); old.at = 2000 - 60 * 86400000; const fresh = addPost(t, o.id, { caption: 'fresh' }); fresh.at = 2000;
  let fr = 0; for (let i = 0; i < 400; i++) { const r = c.rankPosts([old, fresh], { now: 2000, rand }); if (r[0].id === fresh.id) fr++; }
  assert.ok(fr > 300, `newer likelier first: ${fr}/400`);
});
