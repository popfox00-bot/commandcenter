// Socials group chats (socials-core.js): made with three or more accounts, a message to all, unread counted per
// member, named by its members until renamed, kept through normalize and merged between phones, and let go when
// fewer than two are left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, addAccount, removeAccount, sendMessage, conversationsOf, unreadCount, markRead, normalize, mergeStates, createGroup, groupById, groupName, renameGroup, leaveGroup, sendGroupMessage, groupConversation } from '../web/apps/socials/socials-core.js';

const setup = () => { const s = emptyState(); const [me, a, b, c] = ['me', 'amy', 'ben', 'cal'].map((h) => addAccount(s, { handle: h })); return { s, me, a, b, c }; };

test('a group needs three or more people, its maker among them; named by the others until renamed', () => {
  const { s, me, a, b } = setup();
  assert.equal(createGroup(s, me.id, [a.id]), null, 'two people is a chat, not a group');
  const g = createGroup(s, me.id, [a.id, b.id, a.id]);
  assert.deepEqual(g.members, [me.id, a.id, b.id]);
  assert.equal(groupName(s, g, me.id), 'amy and ben');
  renameGroup(s, g.id, '  Beach crew ');
  assert.equal(groupName(s, groupById(s, g.id), me.id), 'Beach crew');
  renameGroup(s, g.id, '');
  assert.equal(groupName(s, g, a.id), 'me and ben');
});

test('a message goes to everyone in it: in their chats, unread for each but its sender, read when opened', () => {
  const { s, me, a, b, c } = setup();
  const g = createGroup(s, me.id, [a.id, b.id], 'Crew');
  sendMessage(s, a.id, me.id, 'hey you');
  assert.equal(sendGroupMessage(s, c.id, g.id, 'let me in'), null, 'only its members write in it');
  assert.equal(sendGroupMessage(s, me.id, g.id, '   '), null);
  const m1 = sendGroupMessage(s, me.id, g.id, 'beach at 5?');
  const m2 = sendGroupMessage(s, a.id, g.id, 'im in'); m2.at = m1.at + 1; // (a moment later)
  assert.deepEqual(groupConversation(s, g.id).map((m) => m.text), ['beach at 5?', 'im in']);
  assert.equal(m1.group, g.id);
  const mine = conversationsOf(s, me.id);
  assert.equal(mine.length, 2); const gc = mine.find((x) => x.group); assert.equal(gc.group.id, g.id); assert.equal(gc.other, null); assert.equal(gc.unread, 1); assert.equal(gc.last.text, 'im in');
  assert.equal(conversationsOf(s, b.id).find((c2) => c2.group)?.unread, 2);
  assert.equal(conversationsOf(s, c.id).length, 0, 'not in it: not in their chats');
  assert.equal(unreadCount(s, b.id), 2);
  markRead(s, b.id, g.id, m2.at); assert.equal(unreadCount(s, b.id), 0);
});

test('kept through normalize and merged between two phones; leaving or a deleted account can end it', () => {
  const { s, me, a, b } = setup();
  const g = createGroup(s, me.id, [a.id, b.id]); sendGroupMessage(s, me.id, g.id, 'one');
  const n = normalize(JSON.parse(JSON.stringify(s)));
  assert.equal(n.groups.length, 1); assert.equal(n.messages[0].group, g.id); assert.ok(n.reads[me.id][g.id] > 0);
  // Another phone renamed it and wrote in it.
  const other = normalize(JSON.parse(JSON.stringify(s)));
  renameGroup(other, g.id, 'Renamed'); groupById(other, g.id).upd += 5; sendGroupMessage(other, a.id, g.id, 'two');
  const merged = mergeStates(s, other);
  assert.equal(groupById(merged, g.id).name, 'Renamed');
  assert.deepEqual(groupConversation(merged, g.id).map((m) => m.text), ['one', 'two']);
  // An account deleted: out of it; with two left it goes on, with fewer it's let go.
  removeAccount(merged, b.id); assert.deepEqual(groupById(merged, g.id).members, [me.id, a.id]);
  leaveGroup(merged, g.id, a.id); assert.equal(groupById(merged, g.id), null);
  assert.equal(groupConversation(merged, g.id).length, 0); assert.ok(merged.gone[g.id]);
  // (Deleted on one phone: stays deleted when merged with one that still has it.)
  assert.equal(groupById(mergeStates(merged, other), g.id), null);
});
