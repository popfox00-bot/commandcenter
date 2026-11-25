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

test('accounts: a friend or a celebrity (kept, changed, read back)', async () => {
  const { emptyState, addAccount, editAccount, normalize } = await import('../web/apps/socials/socials-core.js');
  const s = emptyState();
  const o = addAccount(s, { handle: 'me' }); const f = addAccount(s, { handle: 'pal' }); const c = addAccount(s, { handle: 'star', kind: 'celebrity' });
  assert.equal(f.kind, 'friend'); assert.equal(c.kind, 'celebrity'); assert.equal(o.owner, true);
  editAccount(s, f.id, { kind: 'celebrity' }); assert.equal(f.kind, 'celebrity');
  editAccount(s, f.id, { kind: 'nonsense' }); assert.equal(f.kind, 'friend');
  const back = normalize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back.accounts.map((a) => a.kind), ['friend', 'friend', 'celebrity']);
  assert.equal(normalize({ accounts: [{ id: 'x', handle: 'old' }] }).accounts[0].kind, 'friend', 'older accounts: friends');
});

test('comments made for the caption: its places, things, numbers, question, hashtags and people', async () => {
  const { generateComments, placesIn, thingsIn, numbersIn, asks } = await import('../web/apps/socials/socials-predict.js');
  assert.deepEqual([...placesIn('Sunset in Denver, then New York!')].sort(), ['Denver', 'New York']);
  assert.ok(placesIn('Weekend in Tokyo').includes('Tokyo')); assert.deepEqual(placesIn('Pizza at home'), []);
  assert.deepEqual(thingsIn('Finally got my new bike and the best helmet'), ['bike', 'helmet']);
  assert.deepEqual(numbersIn('Turning 21 today'), { age: 21 }); assert.equal(numbersIn('our 10th anniversary').years, 10); assert.equal(numbersIn('Ran a 5k this morning').km, '5');
  assert.ok(asks('Pizza or tacos tonight?')); assert.ok(!asks('Pizza night'));
  const all = (cap, o = {}) => { const out = []; for (let i = 0; i < 60; i++) out.push(...generateComments(cap, 5, o)); return out.join('\n'); };
  assert.match(all('Sunset in Denver #goldenhour'), /Denver/); assert.match(all('Sunset in Denver #goldenhour'), /#goldenhour/);
  assert.match(all('Turning 21 today 🎉'), /21st/);
  assert.match(all('Pizza or tacos tonight?'), /Tacos|Pizza|tacos|pizza/);
  assert.match(all('Finally got my new bike'), /bike/);
  assert.match(all('Beach day', { tagged: ['sam'] }), /@sam/);
  assert.match(all('Beach day', { tagged: ['sam'], as: ['sam', 'sam', 'sam', 'sam', 'sam'] }), /tag|there|with you/);
  assert.doesNotMatch(all('Beach day', { tagged: ['sam'], as: ['sam', 'sam', 'sam', 'sam', 'sam'] }), /@sam/, 'not to itself');
  // A batch: all different.
  for (let i = 0; i < 20; i++) { const b = generateComments('Golden hour at the beach 🌅 #summer', 5); assert.equal(new Set(b).size, 5); }
});
