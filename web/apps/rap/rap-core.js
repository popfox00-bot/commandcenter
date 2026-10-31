// Rap app logic (no DOM): words and how they rhyme (rap-words.txt, built by scripts/build-rap-words.mjs),
// syllables, the rhyme scheme (which earlier line a line should rhyme with: pairs, alternating, or the
// same rhyme running on), what the lines are about (themes, rap-themes.js), the next word (from the lines
// it has learned: rap-corpus.js and your songs) and endings that complete a line: on the rhyme the
// scheme calls for, or on the theme when the line starts something new, about as long as the line it
// answers.

import { THEMES, themeIndex } from './rap-themes.js';

// ---------- words ----------

const ENTRY = /^([a-z][a-z']*)(\d)(\d)([nvax]*)$/;

/**
 * The word list: `SOUNDS|word<level><syllables><flags> …` lines. Returns { get(word), tails, skeletons }:
 * get → { word, tail, lvl, syl, pos, x } or undefined; tails: sounds → entries (most common first);
 * skeletons: the vowels of the sounds → the sounds that share them (for near rhymes).
 */
export function parseWords(text) {
  const words = new Map(); const tails = new Map(); const skeletons = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const bar = line.indexOf('|'); if (bar < 0) continue;
    const tail = line.slice(0, bar);
    const list = [];
    for (const e of line.slice(bar + 1).split(' ')) {
      const m = ENTRY.exec(e); if (!m) continue;
      const entry = { word: m[1], tail, lvl: Number(m[2]), syl: Number(m[3]), pos: m[4].replace('x', ''), x: m[4].includes('x') };
      list.push(entry);
      if (!words.has(entry.word)) words.set(entry.word, entry);
    }
    tails.set(tail, list);
    const sk = skeleton(tail);
    if (!skeletons.has(sk)) skeletons.set(sk, []);
    skeletons.get(sk).push(tail);
  }
  return { get: (w) => words.get(w), tails, skeletons, words };
}

const VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);
/** The vowels of a rhyme's sounds ("AY T" → "AY", "AH N IY" → "AH IY"): what near rhymes share. */
export const skeleton = (tail) => tail.split(' ').filter((p) => VOWELS.has(p)).join(' ');
/** How a rhyme ends: on a vowel, a stop, a nasal, a hiss or another consonant (near rhymes like the same kind). */
function endClass(tail) {
  const last = tail.split(' ').at(-1);
  if (VOWELS.has(last)) return 'v';
  if (['P', 'B', 'T', 'D', 'K', 'G'].includes(last)) return 'stop';
  if (['M', 'N', 'NG'].includes(last)) return 'nasal';
  if (['S', 'Z', 'SH', 'ZH', 'F', 'V', 'TH', 'DH', 'CH', 'JH'].includes(last)) return 'hiss';
  return 'other';
}

/** The words of a line, lowercase, with apostrophes kept ("I'm", "runnin'") and other punctuation dropped. */
export function tokens(line) {
  return String(line).toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9]+(?:'[a-z]+)*'?/g) ?? [];
}

/** Syllables of a word not in the list, from its spelling. */
function guessSyllables(w) {
  const s = w.replace(/'/g, '').replace(/e$/, '').replace(/[^a-z]/g, '');
  const n = (s.match(/[aeiouy]+/g) ?? []).length;
  return Math.max(1, n);
}

/**
 * What's known of a word: the list's entry, or for one it lacks (slang, a name, "runnin'") the entry
 * of the word it most likely sounds like (dropped g's restored, plurals and 's taken off, else the
 * common word with the longest same ending), marked `guess`.
 */
export function info(dict, raw) {
  const w = String(raw).toLowerCase();
  const hit = dict.get(w); if (hit) return hit;
  const tries = [];
  if (/in'?$/.test(w)) tries.push(w.replace(/in'?$/, 'ing'));
  if (/'s$/.test(w)) tries.push(w.slice(0, -2));
  if (/s$/.test(w)) tries.push(w.slice(0, -1));
  tries.push(w.replace(/'/g, ''));
  for (const t of tries) {
    const e = dict.get(t);
    if (e) return { ...e, word: w, guess: true, syl: e.syl };
  }
  // A word made from one in the list: its stem's sounds and "-ing" or "-s" ("stuntin'": stunt + ing).
  const spelled = (/in'?$/.test(w) ? w.replace(/in'?$/, 'ing') : w).replace(/'/g, '');
  const ing = /^(.{2,}?)ing$/.exec(spelled);
  if (ing) {
    const st = ing[1];
    for (const stem of [st, `${st}e`, /(.)\1$/.test(st) ? st.slice(0, -1) : null]) {
      const e = stem && dict.get(stem);
      if (e?.tail) return { ...e, word: w, tail: `${e.tail} IH NG`, syl: e.syl + 1, guess: true };
    }
  }
  const plural = /^(.{2,}?)(es|s)$/.exec(spelled);
  if (plural) {
    for (const stem of [plural[1] + (plural[2] === 'es' ? 'e' : ''), plural[1]]) {
      const e = dict.get(stem);
      if (e?.tail) return { ...e, word: w, tail: `${e.tail} ${/[aeiouy]$/.test(stem) || /[bdgvmnlr]e?$/.test(stem) ? 'Z' : 'S'}`, guess: true };
    }
  }
  // The same ending as a common word (the longest shared, from 6 letters down to 3; 2 for a short
  // word), spelled out ("stuntin'" as "stunting": like "hunting").
  dict.suffix ??= new Map();
  const base = (/in'?$/.test(w) ? w.replace(/in'?$/, 'ing') : w).replace(/'/g, '');
  for (let n = Math.min(6, base.length - 1); n >= (base.length <= 4 ? 2 : 3); n--) {
    const end = base.slice(-n);
    if (!dict.suffix.has(end)) {
      let best = null;
      for (const e of dict.words.values()) if (e.word.endsWith(end) && e.word.length > n && (!best || e.lvl < best.lvl)) best = e;
      dict.suffix.set(end, best);
    }
    const e = dict.suffix.get(end);
    if (e) return { ...e, word: w, guess: true, syl: guessSyllables(w) };
  }
  return { word: w, tail: null, lvl: 4, syl: guessSyllables(w), pos: '', x: false, guess: true };
}

/** Syllables in a line. */
export const syllables = (dict, line) => tokens(line).reduce((s, w) => s + info(dict, w).syl, 0);

/**
 * Words that rhyme with `word`: { word, tail, perfect, near }. Perfect: the same sounds from the last
 * stressed vowel on (night, light, tonight). Near: the same vowels with a different ending, closest
 * ending first (night → ride, life, time): what rap leans on. Most common words first; the word itself
 * and, unless `explicit`, profane words are left out.
 */
export function rhymesFor(dict, word, { explicit = false, max = 60 } = {}) {
  const me = info(dict, word);
  if (!me?.tail) return { word: me?.word ?? word, tail: null, perfect: [], near: [] };
  const ok = (e) => e.word !== me.word && (explicit || !e.x) && e.lvl <= 3;
  const perfect = (dict.tails.get(me.tail) ?? []).filter(ok).slice(0, max);
  const cls = endClass(me.tail);
  const nearTails = (dict.skeletons.get(skeleton(me.tail)) ?? []).filter((t) => t !== me.tail);
  const near = nearTails.flatMap((t) => (dict.tails.get(t) ?? []).filter(ok).map((e) => ({ e, same: endClass(t) === cls })))
    .sort((a, b) => Number(b.same) - Number(a.same) || a.e.lvl - b.e.lvl || a.e.syl - b.e.syl)
    .slice(0, max).map((x) => x.e);
  return { word: me.word, tail: me.tail, perfect, near };
}

/** How well two words rhyme: 2 perfect, 1 near, 0 not. */
export function rhymeLevel(dict, a, b) {
  const x = info(dict, a); const y = info(dict, b);
  if (!x.tail || !y.tail || x.word === y.word) return 0;
  if (x.tail === y.tail) return 2;
  return skeleton(x.tail) === skeleton(y.tail) ? 1 : 0;
}

/**
 * The rhyme scheme so far, and what line `i` should rhyme with: { target (a word, or null for a free
 * line), line (its index), scheme }. Worked out from the last few lines' end words:
 * - 'run': the last three rhyme (AAA…): keep the rhyme going;
 * - 'new': the last two rhyme and the one before them doesn't (a pair done, AABB): a free line, starting a pair;
 * - 'alternate': the line before rhymes with the one three back, or the last two don't rhyme and
 *   aren't half of a pair (ABAB): rhyme with the line two back;
 * - 'pair': the line before starts a pair (the two before it rhyme with each other, or it's the first line): rhyme with it.
 */
export function rhymeScheme(dict, lines, i) {
  const end = (k) => (k >= 0 ? tokens(lines[k] ?? '').at(-1) : undefined);
  const r = (a, b) => { const x = end(a); const y = end(b); return !!x && !!y && rhymeLevel(dict, x, y) > 0; };
  const at = (k, scheme) => ({ target: end(k) ?? null, line: k, scheme });
  if (i < 1 || !end(i - 1)) return { target: null, line: -1, scheme: null };
  if (i === 1) return at(0, 'pair');
  if (r(i - 1, i - 2)) return r(i - 2, i - 3) ? at(i - 1, 'run') : { target: null, line: -1, scheme: 'new' };
  if (r(i - 1, i - 3)) return at(i - 2, 'alternate');
  if (i >= 3 && r(i - 2, i - 3)) return at(i - 1, 'pair');
  return end(i - 2) ? at(i - 2, 'alternate') : at(i - 1, 'pair');
}

/**
 * The rhyme letter of each line, as in AABB: lines whose last words rhyme share a letter (A for the
 * first rhyme, B for the next…); '' for an empty line. Only the `upTo` lines first are lettered.
 */
export function rhymeLetters(dict, lines, upTo = lines.length) {
  const groups = []; // [{ letter, words: [] }]
  return lines.slice(0, upTo).map((line) => {
    const w = tokens(line).at(-1);
    if (!w) return '';
    let g = groups.find((x) => x.words.some((y) => y === w || rhymeLevel(dict, y, w) > 0));
    if (!g) { g = { letter: String.fromCharCode(65 + (groups.length % 26)), words: [] }; groups.push(g); }
    g.words.push(w);
    return g.letter;
  });
}

/** The pattern of the last (up to 4) lettered lines, lettered afresh from A: "AABB", "ABAB", "AAAA"… */
export function schemeName(letters) {
  const recent = letters.filter(Boolean).slice(-4);
  const map = new Map();
  return recent.map((l) => { if (!map.has(l)) map.set(l, String.fromCharCode(65 + map.size)); return map.get(l); }).join('');
}

/**
 * The rhymes line `i` could take, for suggestions grouped by letter: the one the scheme calls for
 * first (`fits: true`), then the other recent rhymes, then a new one (target null). Each:
 * { letter, target, fits }.
 */
export function rhymeOptions(dict, lines, i) {
  const letters = rhymeLetters(dict, lines, i);
  const want = rhymeScheme(dict, lines, i);
  const lastOf = new Map(); // letter → its latest end word (in the last 4 lines)
  for (let k = Math.max(0, i - 4); k < i; k++) if (letters[k]) lastOf.set(letters[k], tokens(lines[k]).at(-1));
  const used = new Set(letters.filter(Boolean));
  const fresh = String.fromCharCode(65 + (used.size % 26));
  const out = [];
  if (want.target) out.push({ letter: letters[want.line], target: want.target, fits: true });
  for (const [letter, target] of [...lastOf].reverse()) if (!out.some((o) => o.letter === letter)) out.push({ letter, target, fits: false });
  out.push({ letter: fresh, target: null, fits: !want.target });
  // The one that fits goes first.
  return out.sort((a, b) => Number(b.fits) - Number(a.fits));
}

/** The word line `i` should rhyme with, or null (see rhymeScheme). */
export const rhymeTarget = (dict, lines, i) => rhymeScheme(dict, lines, i).target;

// ---------- themes ----------

/** A word's plain form, as the themes list it (dreaming → dream, stacks → stack, runnin' → run). */
export function plain(dict, raw) {
  const w = String(raw).toLowerCase().replace(/in'$/, 'ing').replace(/'/g, '');
  const idx = themeIndex();
  const known = (x) => idx.has(x) || dict.get(x);
  if (idx.has(w)) return w;
  const tries = [];
  let m;
  if ((m = /^(.{2,}?)ing$/.exec(w))) tries.push(m[1], `${m[1]}e`, m[1].replace(/(.)\1$/, '$1'));
  if ((m = /^(.{2,}?)ed$/.exec(w))) tries.push(m[1], `${m[1]}e`, m[1].replace(/(.)\1$/, '$1'));
  if ((m = /^(.{2,}?)ies$/.exec(w))) tries.push(`${m[1]}y`);
  if ((m = /^(.{2,}?)es$/.exec(w))) tries.push(m[1]);
  if ((m = /^(.{2,}?)s$/.exec(w))) tries.push(m[1]);
  for (const t of tries) if (idx.has(t)) return t;
  for (const t of tries) if (known(t) && t.length > 2) return t;
  return w;
}

/**
 * What the song is about at line `i`: the themes its words point to (the lines before, the nearer the
 * more, and what's written of line `i`), strongest first, and the words of those themes with a weight
 * (0–1) for leaning suggestions their way. { themes: [{ name, icon, score }], words: Map }.
 */
export function themesOf(dict, lines, i, current = []) {
  const idx = themeIndex();
  const score = new Map(); const used = new Set();
  const add = (w, wt) => {
    const p = plain(dict, w); used.add(p);
    for (const t of idx.get(p) ?? []) score.set(t, (score.get(t) ?? 0) + wt);
  };
  for (let k = Math.max(0, i - 8); k < i; k++) for (const w of tokens(lines[k] ?? '')) add(w, 1 / (1 + 0.35 * (i - 1 - k)));
  for (const w of current) add(w, 1.2);
  const ranked = [...score].filter(([, v]) => v >= 0.9).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const words = new Map();
  if (ranked.length) {
    const max = ranked[0][1];
    for (const [name, v] of ranked) for (const w of THEMES[name].words.split(/\s+/)) words.set(w, Math.max(words.get(w) ?? 0, v / max));
  }
  return { themes: ranked.map(([name, v]) => ({ name, icon: THEMES[name].icon, score: v })), words, used };
}

/** How much a word belongs to the theme (0–1). */
const themeWeight = (dict, theme, w) => theme?.words.get(plain(dict, w)) ?? 0;

// ---------- the next word ----------

/** Word sequences learned from lines: counts of what follows one word, and two. */
export function buildModel(lines) {
  const bi = new Map(); const tri = new Map(); const uni = new Map(); const ends = [];
  const add = (m, k, w) => { let c = m.get(k); if (!c) m.set(k, c = new Map()); c.set(w, (c.get(w) ?? 0) + 1); };
  for (const line of lines) {
    const t = tokens(line); if (!t.length) continue;
    const seq = ['<s>', ...t];
    for (let i = 1; i < seq.length; i++) {
      uni.set(seq[i], (uni.get(seq[i]) ?? 0) + 1);
      add(bi, seq[i - 1], seq[i]);
      if (i >= 2) add(tri, `${seq[i - 2]} ${seq[i - 1]}`, seq[i]);
    }
    // Every ending of the line (2 to 7 words), for completing lines.
    for (let k = Math.max(0, t.length - 7); k <= t.length - 2; k++) ends.push(t.slice(k));
  }
  return { bi, tri, uni, ends };
}

const top = (m, n, skip) => [...(m ?? new Map())].filter(([w]) => !skip(w)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);

/**
 * Up to `n` words that could come next after `before` (the words of the line so far): from what
 * followed the last two words in the lines learned, then the last one, then common line starts. Near
 * the end of a line that should rhyme (its syllables close to the line it answers), words that rhyme
 * with `target` come first.
 */
export function nextWords(model, dict, before, { target = null, targetSyl = 0, explicit = false, n = 3, theme = null } = {}) {
  const ws = before.map((w) => w.toLowerCase());
  const seen = new Set();
  const skip = (w) => seen.has(w) || (!explicit && info(dict, w).x);
  const out = [];
  const take = (list) => { for (const w of list) { if (out.length >= n) return; if (skip(w)) continue; seen.add(w); out.push(w); } };
  const used = ws.reduce((s, w) => s + info(dict, w).syl, 0);
  if (target && targetSyl && used >= targetSyl - 3) {
    const left = Math.max(1, targetSyl - used);
    const r = rhymesFor(dict, target, { explicit });
    take([...r.perfect, ...r.near].filter((e) => e.lvl <= 2 && e.syl <= left + 1).sort((a, b) => Math.abs(a.syl - left) - Math.abs(b.syl - left) || a.lvl - b.lvl).slice(0, 2).map((e) => e.word));
  }
  const prev = ws.at(-1) ?? '<s>'; const prev2 = ws.length >= 2 ? `${ws.at(-2)} ${prev}` : `<s> ${prev}`;
  // What usually comes next (the nearer the context, the more it counts), with words on the song's
  // theme lifted; and after a word that leads into one (the, my, so, gonna…), theme words that fit.
  const scored = new Map();
  const put = (w, v) => { if (!skip(w)) scored.set(w, Math.max(scored.get(w) ?? -Infinity, v + 1.6 * themeWeight(dict, theme, w))); };
  top(model.tri.get(prev2), 3 * n, skip).forEach((w, k) => put(w, 3 - 0.25 * k));
  top(model.bi.get(prev), 3 * n, skip).forEach((w, k) => put(w, 2 - 0.25 * k));
  if (theme?.words.size) {
    const slot = NOUN_BEFORE.has(prev) ? 'n' : ADJ_BEFORE.has(prev) ? 'a' : VERB_BEFORE.has(prev) ? 'v' : null;
    if (slot) {
      const fits = [...theme.words].filter(([w]) => { const e = dict.get(w); return e && e.pos.includes(slot) && !theme.used?.has(w); })
        .sort((a, b) => b[1] - a[1] || (dict.get(a[0]).lvl - dict.get(b[0]).lvl));
      fits.slice(0, 3).forEach(([w, wt], k) => put(w, 1.4 + wt - 0.2 * k));
    }
  }
  take([...scored].sort((a, b) => b[1] - a[1]).map(([w]) => w));
  take(top(model.bi.get('<s>'), n, skip));
  take(top(model.uni, n, skip));
  return out;
}

// Words after which a noun, an adjective or a verb usually comes.
const NOUN_BEFORE = new Set(['the', 'a', 'an', 'my', 'your', 'his', 'her', 'our', 'their', 'this', 'that', 'these', 'those', 'no', 'some', 'every', 'of', 'in', 'on', 'for', 'with', 'from']);
const ADJ_BEFORE = new Set(['so', 'too', 'very', 'feeling', 'stay', 'keep', 'getting', 'real', 'more', 'most', "i'm", "we're", "you're", "it's", 'is', 'was', 'be', 'been']);
const VERB_BEFORE = new Set(['to', 'gonna', 'wanna', 'gotta', "i'mma", 'i', 'we', 'they', 'you', 'never', 'can', "can't", 'will', "won't", 'let', 'me', 'just', "don't", 'still', 'always', 'must']);

// ---------- completing a line ----------

const LINKS = new Set(['the', 'a', 'an', 'my', 'your', 'his', 'her', 'our', 'their', 'this', 'that', 'in', 'on', 'to', 'of', 'for', 'with', 'like', 'at', 'from', 'and', 'but', 'so', 'i', "i'm", 'we', 'you', 'they']);

/**
 * Up to `n` ways to finish the line `before` (its words so far): endings from the lines learned, and
 * ending patterns ("watch me ___", "in the ___") filled with words that rhyme with `target` (the line
 * it answers), about as long as the rest of that line (`targetSyl`). With no target, endings that make
 * a line of about `targetSyl` (or 10) syllables, on the song's `theme` when it has one, and not on a
 * rhyme in `avoid` (the rhymes already used, when starting a new one). Strings to append.
 */
export function completeLine(model, dict, before, { target = null, targetSyl = 0, explicit = false, endings = {}, n = 3, theme = null, avoid = [] } = {}) {
  const ws = before.map((w) => w.toLowerCase());
  const used = ws.reduce((s, w) => s + info(dict, w).syl, 0);
  const goal = targetSyl || 10;
  const left = Math.max(2, goal - used);
  const last = ws.at(-1);
  const sylOf = (t) => t.reduce((s, w) => s + info(dict, w).syl, 0);
  const clean = (t) => explicit || !t.some((w) => info(dict, w).x);
  const cands = [];
  const consider = (t, bonus) => {
    if (!t.length || !clean(t)) return;
    if (last && t[0] === last) return; // "the the"
    const end = t.at(-1);
    // About the right length (a little off is fine: the flow can stretch).
    let score = bonus - Math.min(4, 0.7 * Math.abs(sylOf(t) - left));
    if (target) {
      const r = rhymeLevel(dict, end, target);
      if (!r) return;
      score += r === 2 ? 5 : 1.2;
    } else if (avoid.some((a) => a === end || rhymeLevel(dict, a, end) > 0)) return; // a new rhyme: not one already used
    // Flows from the last word written (learned to follow it), or starts fresh after a linking word.
    if (last && model.bi.get(last)?.has(t[0])) score += 1.5;
    if (last && LINKS.has(last) && LINKS.has(t[0])) score -= 2;
    // On the song's theme: its words in the ending (and the song's own words not said again).
    const onTheme = Math.min(2, t.reduce((v, w) => v + themeWeight(dict, theme, w), 0));
    score += 1.4 * onTheme;
    cands.push({ t, score, onTheme });
  };
  // Endings from the lines learned that can start here: on a linking word, or one learned to follow
  // the last word written.
  for (const t of model.ends) if (LINKS.has(t[0]) || (last && model.bi.get(last)?.has(t[0])) || (!last && model.bi.get('<s>')?.has(t[0]))) consider(t, 0);
  if (target) {
    const r = rhymesFor(dict, target, { explicit, max: 60 });
    for (const e of [...r.perfect, ...r.near.slice(0, 15)]) {
      if (e.lvl > 2) continue;
      for (const p of [...e.pos]) for (const pat of endings[p] ?? []) consider(tokens(pat.replace('{}', e.word)), -0.5 - 0.3 * e.lvl);
    }
  } else if (theme?.words.size) {
    // A free line (starting a new rhyme): the endings filled with the theme's words instead.
    for (const [w, wt] of theme.words) {
      const e = dict.get(w); if (!e || e.lvl > 2 || wt < 0.5) continue;
      for (const p of [...e.pos]) for (const pat of endings[p] ?? []) consider(tokens(pat.replace('{}', w)), -1 - 0.3 * e.lvl);
    }
  }
  cands.sort((a, b) => b.score - a.score);
  // No rhyme to answer: on the theme, when there is one.
  const pool = !target && theme?.words.size && cands.some((c) => c.onTheme > 0) ? cands.filter((c) => c.onTheme > 0) : cands;
  const out = []; const ends = new Set(); const starts = new Set();
  for (const c of pool) {
    // A different rhyme word for each suggestion, and a different way there.
    const end = c.t.at(-1); const start = c.t.slice(0, Math.min(2, c.t.length - 1)).join(' ');
    if (ends.has(end) || starts.has(start)) continue;
    ends.add(end); starts.add(start);
    out.push(c.t.join(' ').replace(/\bi\b/g, 'I').replace(/\bi'/g, "I'"));
    if (out.length >= n) break;
  }
  return out;
}
