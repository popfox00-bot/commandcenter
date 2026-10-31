#!/usr/bin/env node
// Builds web/apps/rap/rap-words.txt, the Rap app's word list: each common English word with how it
// rhymes (its sounds from the last stressed vowel on, from the CMU Pronouncing Dictionary), how
// common it is (SCOWL size 10/20/35), its syllables, and whether it's a noun, verb or adjective
// (WordNet). Words SCOWL lists as offensive are left out; profane ones are marked (shown only with
// Explicit on). The sources aren't in this repository; their notices are in web/apps/rap/DATA-LICENSES.md.
//
//   node scripts/build-rap-words.mjs CMUDICT SCOWL_FINAL_DIR SCOWL_MISC_DIR WORDNET_DICT_DIR
//
// CMUDICT: cmudict.dict (github.com/cmusphinx/cmudict). SCOWL: scowl-2020.12.07 (wordlist.aspell.net),
// its final/ and misc/ folders. WordNet: the dict/ folder of WordNet 3.x (e.g. npm wordnet-db).
//
// Output, one line per rhyme sound: `SOUNDS|entry entry …`, entries `word<level><syllables><flags>`
// (level 1–3, flags: n noun, v verb, a adjective, x profane), most common first.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [cmuPath, finalDir, miscDir, wnDir] = process.argv.slice(2);
if (!wnDir) { console.error('usage: build-rap-words.mjs CMUDICT SCOWL_FINAL_DIR SCOWL_MISC_DIR WORDNET_DICT_DIR'); process.exit(1); }
const read = (p) => (existsSync(p) ? readFileSync(p, 'latin1') : '');
const lines = (t) => t.split('\n').map((s) => s.trim()).filter(Boolean);

// How common: the smallest SCOWL size listing it (American or general English).
const level = new Map();
for (const [size, lvl] of [[10, 1], [20, 2], [35, 3]]) {
  for (const kind of ['english-words', 'american-words']) {
    for (const w of lines(read(join(finalDir, `${kind}.${size}`)))) {
      const word = w === 'I' ? 'i' : w;
      if (!/^[a-z][a-z']*$/.test(word)) continue;
      if (!level.has(word)) level.set(word, lvl);
    }
  }
}
// Slang and words common in songs that a dictionary-based list ranks low or lacks.
const EXTRA = `ain't y'all gonna wanna gotta lemme kinda sorta bling drip flex grind hustle homie dope fam lit vibe vibes squad crew
  goat hype haters hater swag savage beat beats bars flow rhyme rhymes mic stage hood block cash bands stacks paper whip ride
  chain chains ice shine shining shady hustler baller ballin player cypher verse hook track studio beef clout real fake broke
  rich rap rapper rapping freestyle lyric lyrics dreams dreamer grinding winning boss hustling ghost toast frost`;
for (const w of EXTRA.split(/\s+/).filter(Boolean)) if (!level.has(w) || level.get(w) > 2) level.set(w, 2);

const offensive = new Set([...lines(read(join(miscDir, 'offensive.1'))), ...lines(read(join(miscDir, 'offensive.2')))].map((w) => w.toLowerCase()));
const profane = new Set([...lines(read(join(miscDir, 'profane.1'))), ...lines(read(join(miscDir, 'profane.3')))].map((w) => w.toLowerCase()));

// Part of speech (lemmas), from WordNet's index files: the one a word is mostly used as (its senses'
// counts in WordNet's tagged texts), and any other used at least a third as often. A word never seen
// tagged (like "despite" as a noun) gets none, so line endings don't use it the wrong way.
const tagged = new Map(); // word -> { n, v, a }
for (const [file, flag] of [['index.noun', 'n'], ['index.verb', 'v'], ['index.adj', 'a']]) {
  for (const l of lines(read(join(wnDir, file)))) {
    if (l.startsWith(' ')) continue;
    const f = l.split(' ');
    const w = f[0];
    if (!/^[a-z']+$/.test(w)) continue;
    // lemma pos synset_cnt p_cnt [ptr_symbol…] sense_cnt tagsense_cnt synset_offset…
    const p = Number(f[3]); const tagsense = Number(f[4 + p + 1]);
    if (!tagged.has(w)) tagged.set(w, {});
    tagged.get(w)[flag] = tagsense;
  }
}
const pos = new Map();
for (const [w, c] of tagged) {
  const max = Math.max(...Object.values(c));
  if (max < 1) continue;
  pos.set(w, Object.entries(c).filter(([, v]) => v >= max / 3).map(([k]) => k).join(''));
}
// Never suggested (sexual terms the offensive lists don't cover).
const SKIP = new Set(['cumming', 'cum', 'cums', 'jizz']);

// Pronunciations: the first one listed for each word.
const VOWEL = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)[012]$/;
const sounds = new Map();
for (const l of readFileSync(cmuPath, 'utf8').split('\n')) {
  const m = /^([a-z'][a-z'.-]*)(\(\d+\))? ([A-Z0-9 ]+?)(\s*#.*)?$/.exec(l.trim());
  if (!m || m[2] || sounds.has(m[1])) continue;
  sounds.set(m[1], m[3].split(' '));
}

/** The rhyming part: from the last stressed vowel (primary, else secondary, else the last vowel) on. */
function tail(ph) {
  let at = -1;
  for (const s of ['1', '2', '0']) { for (let i = ph.length - 1; i >= 0; i--) if (VOWEL.test(ph[i]) && ph[i].endsWith(s)) { at = i; break; } if (at >= 0) break; }
  return at < 0 ? null : ph.slice(at).map((p) => p.replace(/\d/, '')).join(' ');
}

const groups = new Map();
let n = 0;
for (const [word, lvl] of level) {
  if (offensive.has(word) || SKIP.has(word) || /'s$/.test(word)) continue;
  const ph = sounds.get(word); if (!ph) continue;
  const t = tail(ph); if (!t) continue;
  const syl = Math.min(9, ph.filter((p) => VOWEL.test(p)).length);
  const flags = [...new Set(pos.get(word) ?? '')].sort().join('') + (profane.has(word) ? 'x' : '');
  if (!groups.has(t)) groups.set(t, []);
  groups.get(t).push({ word, lvl, syl, flags });
  n++;
}
const out = ['# Rap words: rhyme sounds (CMU Pronouncing Dictionary), common words (SCOWL), parts of speech (WordNet). See DATA-LICENSES.md.'];
for (const t of [...groups.keys()].sort()) {
  const list = groups.get(t).sort((a, b) => a.lvl - b.lvl || a.word.localeCompare(b.word));
  out.push(`${t}|${list.map((e) => `${e.word}${e.lvl}${e.syl}${e.flags}`).join(' ')}`);
}
const dest = resolve(import.meta.dirname, '../web/apps/rap/rap-words.txt');
writeFileSync(dest, `${out.join('\n')}\n`);
console.log(`${n} words in ${groups.size} rhyme sounds → ${dest}`);
