// Rap app logic (web/apps/rap/rap-core.js) with the real word list: rhymes, syllables, which line a
// line answers, the next word and completing a line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWords, tokens, info, syllables, rhymesFor, rhymeLevel, rhymeTarget, buildModel, nextWords, completeLine } from '../web/apps/rap/rap-core.js';
import { LINES, ENDINGS } from '../web/apps/rap/rap-corpus.js';

const dict = parseWords(readFileSync(resolve(import.meta.dirname, '../web/apps/rap/rap-words.txt'), 'utf8'));
const model = buildModel(LINES);
const words = (list) => list.map((e) => e.word);

test('the word list: tens of thousands of words, common ones first in each rhyme', () => {
  assert.ok(dict.words.size > 25000, `${dict.words.size} words`);
  const night = dict.get('night');
  assert.deepEqual([night.tail, night.syl, night.lvl], ['AY T', 1, 1]);
  assert.equal(dict.get('tonight').syl, 2);
});

test('rhymes: perfect ones (the same sounds from the stressed vowel on), then near ones (the same vowels)', () => {
  const r = rhymesFor(dict, 'night');
  for (const w of ['light', 'fight', 'right', 'tonight', 'bright']) assert.ok(words(r.perfect).includes(w), w);
  assert.ok(!words(r.perfect).includes('night'), 'not the word itself');
  for (const w of ['ride', 'side']) assert.ok(words(r.near).includes(w), `near: ${w}`);
  assert.ok(words(rhymesFor(dict, 'money').perfect).includes('honey'));
  assert.ok(words(rhymesFor(dict, 'flow').perfect).includes('go'));
  // Common words come first.
  assert.equal(r.perfect.slice(0, 15).every((e) => e.lvl === 1), true);
  assert.equal(rhymeLevel(dict, 'grind', 'mind'), 2);
  assert.equal(rhymeLevel(dict, 'grind', 'time'), 1);
  assert.equal(rhymeLevel(dict, 'grind', 'cat'), 0);
});

test("words the list lacks: dropped g's, plurals, and slang by their ending", () => {
  assert.equal(info(dict, "runnin'").tail, info(dict, 'running').tail);
  assert.equal(info(dict, 'dreams').syl, 1);
  assert.ok(words(rhymesFor(dict, "stuntin'").perfect).includes('hunting'));
  assert.deepEqual(tokens("I'm runnin' it, y'all — LET'S GO!"), ["i'm", "runnin'", 'it', "y'all", "let's", 'go']);
  assert.equal(syllables(dict, 'I been on my grind since the break of day'), 10);
});

test('which line a line rhymes with: the one before, unless those two already rhyme (a new couplet)', () => {
  const lines = ['I been up all night', 'chasing every light', 'now I keep it real', ''];
  assert.equal(rhymeTarget(dict, lines, 0), null);
  assert.equal(rhymeTarget(dict, lines, 1), 'night');
  assert.equal(rhymeTarget(dict, lines, 2), null, 'night/light done: free');
  assert.equal(rhymeTarget(dict, lines, 3), 'real');
});

test('the next word: what follows in the lines learned; near the end of an answering line, its rhymes', () => {
  const early = nextWords(model, dict, tokens('I been on my'), { n: 3 });
  assert.ok(early.includes('grind'), `after "on my": ${early}`);
  const late = nextWords(model, dict, tokens('now I keep on fighting for the'), { target: 'night', targetSyl: 9, n: 3 });
  assert.ok(late.slice(0, 2).every((w) => rhymeLevel(dict, w, 'night') > 0), `rhymes first near the end: ${late}`);
  // Learns your own lines.
  const mine = buildModel([...LINES, 'purple rain on the boulevard']);
  assert.ok(nextWords(mine, dict, tokens('purple'), { n: 3 }).includes('rain'));
});

test('complete the line: endings on a rhyme with the line it answers, about as long as it, each different', () => {
  const out = completeLine(model, dict, tokens('now I'), { target: 'night', targetSyl: 7, endings: ENDINGS, n: 3 });
  assert.equal(out.length, 3);
  for (const l of out) assert.ok(rhymeLevel(dict, tokens(l).at(-1), 'night') > 0, `"${l}" rhymes with night`);
  assert.equal(new Set(out.map((l) => tokens(l).at(-1))).size, 3, 'a different rhyme word each');
  for (const l of out) assert.ok(Math.abs(syllables(dict, `now I ${l}`) - 7) <= 3, `"now I ${l}" about 7 syllables`);
  // No line to answer: still endings, about 10 syllables in all.
  assert.ok(completeLine(model, dict, tokens('started from the'), { endings: ENDINGS }).length > 0);
});

test('explicit words only when asked for', () => {
  const x = [...dict.words.values()].find((e) => e.x && e.tail && dict.tails.get(e.tail).length > 3);
  assert.ok(x, 'some words are marked explicit');
  const other = dict.tails.get(x.tail).find((e) => e.word !== x.word);
  assert.ok(!words(rhymesFor(dict, other.word).perfect).includes(x.word));
  assert.ok(words(rhymesFor(dict, other.word, { explicit: true, max: 500 }).perfect).includes(x.word));
});
