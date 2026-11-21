// Socials: the text predictor (web/apps/socials/socials-predict.js) and the account list's order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, generateComment, generateReply, intentOf, emojisIn } from '../web/apps/socials/socials-predict.js';
import { emptyState, addAccount, setOwner, sendMessage, markRead, switcherOrder } from '../web/apps/socials/socials-core.js';

const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('a caption read for its topics, tags and emoji', () => {
  const r = readText('Golden hour at the beach 🌅🌊 #summer');
  assert.ok(r.topics.map((t) => t.id).includes('beach')); assert.ok(r.tags.includes('summer'));
  assert.deepEqual(emojisIn('so good 🍕🍕 yes 🎉'), ['🍕', '🎉']);
});

test('comments: never empty, varied, and on topic when the caption has one', () => {
  for (let i = 0; i < 40; i++) {
    const c = generateComment('Pizza night with the best crew 🍕', { rand: seq(i / 40, 0.3, 0.7, 0.1) });
    assert.ok(c.trim().length > 1);
  }
  const seen = new Set(); for (let i = 0; i < 30; i++) seen.add(generateComment('my dog at the park 🐶'));
  assert.ok(seen.size > 3);
  const c = generateComment('', { rand: () => 0.5 }); assert.ok(c.trim().length > 1);
  // (Avoided: comments already there.)
  const first = generateComment('sunset 🌅', { rand: () => 0 });
  for (let i = 0; i < 10; i++) assert.notEqual(generateComment('sunset 🌅', { avoid: [first] }), first);
});

test('replies answer what was said', () => {
  assert.equal(intentOf('thank you so much!'), 'thanks');
  assert.equal(intentOf('how are you?'), 'howareyou');
  assert.equal(intentOf('want to get dinner tomorrow?'), 'plan');
  for (const m of ['hey', 'lol 😂', 'are you coming?', 'I miss you ❤️', 'ok', '']) assert.ok(generateReply(m).trim().length > 0);
});

test('the account list: Owner first, then unread (most, then latest), then last used, then oldest', () => {
  const s = emptyState();
  const a = addAccount(s, { handle: 'a' }); const b = addAccount(s, { handle: 'b' }); const c = addAccount(s, { handle: 'c' }); const d = addAccount(s, { handle: 'd' });
  setOwner(s, a.id);
  a.at = 1; b.at = 2; c.at = 3; d.at = 4;
  assert.deepEqual(switcherOrder(s).map((x) => x.handle), ['a', 'b', 'c', 'd']);
  assert.deepEqual(switcherOrder(s, { [d.id]: 50, [c.id]: 40 }).map((x) => x.handle), ['a', 'd', 'c', 'b']);
  // (b has one unread, c has two: c then b, ahead of the latest used.)
  const m1 = sendMessage(s, a.id, b.id, 'hi'); m1.at = 100;
  const m2 = sendMessage(s, a.id, c.id, 'hi'); m2.at = 90; const m3 = sendMessage(s, d.id, c.id, 'yo'); m3.at = 95;
  assert.deepEqual(switcherOrder(s, { [d.id]: 50 }).map((x) => x.handle), ['a', 'c', 'b', 'd']);
  markRead(s, c.id, a.id, 1000); markRead(s, c.id, d.id, 1000);
  assert.deepEqual(switcherOrder(s, { [d.id]: 50 }).map((x) => x.handle), ['a', 'b', 'd', 'c']);
});
