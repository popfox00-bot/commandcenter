// Socials (web/apps/socials/socials-core.js): accounts, following, the feed, likes, comments, removing,
// and state read back from storage made safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, addAccount, editAccount, removeAccount, toggleFollow, isFollowing, followersOf, addPost, feedFor, toggleLike, addComment, searchAccounts, normalize, cleanHandle, handleProblem, timeAgo, countLabel, postsBy } from '../web/apps/socials/socials-core.js';

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
