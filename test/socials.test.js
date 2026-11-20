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
