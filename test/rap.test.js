// Rap app logic (web/apps/rap/rap-core.js) with the real word list: rhymes, syllables, which line a
// line answers, the next word and completing a line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWords, tokens, info, syllables, rhymesFor, rhymeLevel, rhymeTarget, rhymeScheme, rhymeLetters, schemeName, rhymeOptions, themesOf, plain, buildModel, nextWords, completeLine, phraseRhyme, nextLines, smartTitle } from '../web/apps/rap/rap-core.js';
import { lyricsFromText, textFromDocx, textFromRtf } from '../web/apps/rap/rap-import.js';
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
  const x = [...dict.words.values()].find((e) => e.x && e.lvl <= 3 && e.tail && dict.tails.get(e.tail).length > 3);
  assert.ok(x, 'some words are marked explicit');
  const other = dict.tails.get(x.tail).find((e) => e.word !== x.word);
  assert.ok(!words(rhymesFor(dict, other.word).perfect).includes(x.word));
  assert.ok(words(rhymesFor(dict, other.word, { explicit: true, max: 500 }).perfect).includes(x.word));
});

test('the rhyme scheme as you write: pairs (AABB), alternating (ABAB), or one rhyme running on', () => {
  const aabb = ['stacking up the paper every day', 'counting all the money that they pay', 'diamonds on my wrist', 'every single one I kissed', ''];
  assert.deepEqual(rhymeLetters(dict, aabb).filter(Boolean), ['A', 'A', 'B', 'B']);
  assert.equal(schemeName(rhymeLetters(dict, aabb)), 'AABB');
  assert.deepEqual(rhymeScheme(dict, aabb, 2), { target: null, line: -1, scheme: 'new' }, 'after a pair: a new rhyme');
  assert.equal(rhymeScheme(dict, aabb, 3).target, 'wrist');
  const abab = ['I been up all night', 'chasing every dream', 'city full of light', 'nothing what it seem', ''];
  assert.equal(schemeName(rhymeLetters(dict, abab)), 'ABAB');
  assert.deepEqual(rhymeScheme(dict, abab.slice(0, 3).concat(''), 2), { target: 'night', line: 0, scheme: 'alternate' }, 'two lines not rhyming: alternate');
  assert.deepEqual(rhymeScheme(dict, abab, 3), { target: 'dream', line: 1, scheme: 'alternate' });
  const run = ['I keep it tight', 'I hold the light', 'I win the fight', ''];
  assert.equal(schemeName(rhymeLetters(dict, run)), 'AAA');
  assert.equal(rhymeScheme(dict, run, 3).scheme, 'run');
  // The options for the next line, by letter: the one that fits first, then the others, then a new one.
  const opts = rhymeOptions(dict, abab, 4);
  assert.deepEqual(opts.map((o) => [o.letter, o.target, o.fits]), [['A', 'light', true], ['B', 'seem', false], ['C', null, false]]);
  assert.deepEqual(rhymeOptions(dict, aabb, 4).map((o) => o.letter), ['C', 'B', 'A'], 'after AABB: a new rhyme fits');
});

test('themes: what the lines are about, the latest counting most; suggestions lean on it', () => {
  assert.equal(plain(dict, 'stacking'), 'stack'); assert.equal(plain(dict, 'wishes'), 'wish'); assert.equal(plain(dict, 'clocks'), 'clock'); assert.equal(plain(dict, "grindin'"), 'grind');
  const lines = ['stacking up the paper every day', 'counting all the money that they pay', ''];
  const t = themesOf(dict, lines, 2, []);
  assert.equal(t.themes[0].name, 'money');
  assert.ok(t.words.get('cash') > 0.9);
  // The next word after "the": money words first.
  const next = nextWords(model, dict, tokens('now I got the'), { theme: t, n: 3 });
  assert.ok(next.some((w) => t.words.has(w)), `on theme: ${next}`);
  // A free line (a new rhyme): endings on the theme, and not on a rhyme already used.
  const free = completeLine(model, dict, tokens('I keep'), { theme: t, endings: ENDINGS, avoid: ['day', 'pay'], n: 3 });
  assert.ok(free.length >= 2);
  for (const l of free) assert.ok(tokens(l).some((w) => t.words.has(plain(dict, w))), `"${l}" is on theme`);
  for (const l of free) assert.equal(rhymeLevel(dict, tokens(l).at(-1), 'day'), 0, `"${l}" is a new rhyme`);
});

test('phrase and near rhymes group lines: "paved road" and "Bronco" rhyme; the scheme stays simple', () => {
  assert.ok(phraseRhyme(dict, 'rolling down the paved road', 'riding in the Bronco') > 0);
  assert.equal(phraseRhyme(dict, 'money', 'honey'), 3);
  assert.equal(phraseRhyme(dict, 'stacking up the paper', 'see you later'), 2, 'multi: the last two vowels');
  assert.ok(phraseRhyme(dict, 'on the grind', 'all the time') > 0);
  assert.equal(phraseRhyme(dict, 'in the city', 'counting money'), 0, 'a weak "-y" alone isn\'t a rhyme');
  assert.equal(phraseRhyme(dict, 'every night', 'the cat'), 0);
  const ride = ['rolling down the paved road', 'riding in the Bronco', 'window down the beat slow', 'got my homies in tow', 'pull up to the light', 'everything feel right'];
  assert.equal(rhymeLetters(dict, ride).join(''), 'AAAABB');
});

test('whole next lines: rhyming with the line they answer, on the theme, about as long', () => {
  const lines = ['rolling down the paved road', 'riding in the Bronco', 'window down the beat slow', ''];
  const theme = themesOf(dict, lines, 3, []);
  const out = nextLines(dict, LINES, { targetLine: lines[2], targetSyl: 6, theme, have: lines, n: 3 });
  assert.equal(out.length, 3);
  for (const l of out) assert.ok(phraseRhyme(dict, l, lines[2]) > 0, `"${l}" rhymes with "${lines[2]}"`);
  assert.equal(new Set(out.map((l) => tokens(l).at(-1))).size, 3);
  // A new rhyme: on theme, and not on a sound already used.
  const money = ['stacking up the paper every single day', 'counting all the money that they never pay', ''];
  const t2 = themesOf(dict, money, 2, []);
  const free = nextLines(dict, LINES, { theme: t2, avoid: money.slice(0, 2), have: money, n: 3 });
  assert.ok(free.length >= 2);
  for (const l of free) assert.equal(phraseRhyme(dict, l, money[1]), 0, `"${l}": a new rhyme`);
  assert.ok(free.some((l) => tokens(l).some((w) => t2.words.has(plain(dict, w)))), `on theme: ${free}`);
});

test('a smart title: the hook if there is one, else the strongest words on the theme', () => {
  const ride = ['rolling down the paved road', 'riding in the Bronco', 'window down the beat slow'];
  assert.equal(smartTitle(dict, ride, themesOf(dict, ride, 3, [])), 'Paved Road');
  const hook = ['we on the come up', 'all my people waiting', 'yeah we on the come up', 'nobody hating'];
  assert.equal(smartTitle(dict, hook, null), 'Come Up');
  assert.equal(smartTitle(dict, [''], null), '');
});

test('import: text (title above a blank line, verses kept), Word .docx, RTF', async () => {
  assert.deepEqual(lyricsFromText('Night Shift\n\nI been working all night\r\nchasing   every light\n\n\n\nkeep it real\n'), { title: 'Night Shift', lines: ['I been working all night', 'chasing every light', '', 'keep it real'] });
  assert.equal(lyricsFromText('one line only', 'IMG_0042').title, '', 'a camera file name is no title');
  assert.equal(lyricsFromText('one line only', 'Summer Verse').title, 'Summer Verse');
  // A minimal .docx (a zip with word/document.xml), made here.
  const { deflateRawSync } = await import('node:zlib');
  const xml = '<w:document><w:body><w:p><w:r><w:t>Paved Road</w:t></w:r></w:p><w:p></w:p><w:p><w:r><w:t xml:space="preserve">Rolling down the </w:t></w:r><w:r><w:t>paved road</w:t></w:r></w:p><w:p><w:r><w:t>Riding in the Bronco</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>Windows down &amp; slow</w:t></w:r></w:p></w:body></w:document>';
  const name = Buffer.from('word/document.xml'); const data = deflateRawSync(Buffer.from(xml));
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const cdOffset = 30 + name.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdOffset, 16);
  const docx = new File([Buffer.concat([local, name, data, central, name, end])], 'song.docx');
  assert.deepEqual(lyricsFromText(await textFromDocx(docx)), { title: 'Paved Road', lines: ['Rolling down the paved road', 'Riding in the Bronco', 'Windows down & slow'] });
  assert.equal(textFromRtf('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 line one\\par line two\\par}').split('\n').map((l) => l.trim()).filter(Boolean).join('|'), 'line one|line two');
});
