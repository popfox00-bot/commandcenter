// Socials' built-in replies remember what the Owner told them (a pet's name, a sister, work, home, what they love),
// ask after it later, and have their own interests (from the account's Into) to talk about.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factsIn, interestsOf, chatReply, chatReplyStyled } from '../web/apps/socials/socials-chat.js';

const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

test('facts the Owner told: pets and people by name, work, city, what they love; not from other accounts', () => {
  const f = factsIn([
    { mine: true, text: 'My dog Max ate my sock lol', at: 1 }, { mine: false, text: 'my cat Luna says hi', at: 2 },
    { mine: true, text: 'my sister Jen is visiting. I work at Acme Corp and I live in Boulder', at: 3 },
    { mine: true, text: 'honestly I love sushi so much', at: 4 }, { mine: true, text: 'my roommate is loud', at: 5 },
  ]);
  assert.deepEqual(f.map((x) => [x.kind, x.what, x.name]), [['pet', 'dog', 'Max'], ['person', 'sister', 'Jen'], ['work', 'Acme Corp', undefined], ['city', 'Boulder', undefined], ['love', 'sushi', undefined], ['person', 'roommate', undefined]]);
});

test('an account\'s interests from its profile', () => {
  assert.deepEqual(interestsOf('Bio: barista. Into: hiking, coffee and techno / film'), ['hiking', 'coffee', 'techno', 'film']);
  assert.deepEqual(interestsOf('Bio: just vibes'), []);
});

test('a hello later on asks after something it was told', () => {
  const h = [{ mine: true, text: 'my dog Max is the best', at: 1 }, { mine: false, text: 'aww so cute', at: 2 }, { mine: true, text: 'lol yeah', at: 3 }, { mine: false, text: 'haha', at: 4 }, { mine: true, text: 'hey!', at: 5 }];
  const replies = new Set(); for (let i = 0; i < 40; i++) replies.add(chatReply(h, { rand: Math.random }));
  assert.ok([...replies].some((r) => /Max/.test(r)), [...replies].join(' | '));
});

test('something the Owner mentions that the account is into gets an excited reply; asked what it\'s doing, its own life', () => {
  const r = chatReply([{ mine: true, text: 'went hiking all morning', at: 1 }], { rand: seq(0, 0.1, 0.2, 0.3), interests: ['hiking'] });
  assert.match(r, /hiking/i);
  const doing = new Set(); for (let i = 0; i < 30; i++) doing.add(chatReplyStyled([{ mine: true, text: 'wyd?', at: 1 }], { about: 'Into: pottery', rand: Math.random }));
  assert.ok([...doing].some((x) => /pottery/i.test(x)), [...doing].join(' | '));
});
