// Rap app logic (no DOM): words and how they rhyme (rap-words.txt, built by scripts/build-rap-words.mjs),
// syllables, which earlier line a line should rhyme with, the next word (from the lines it has learned:
// rap-corpus.js and your songs) and endings that complete a line on a rhyme, about as long as the line
// it answers.

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
 * The word line `i` should rhyme with, or null: the last word of the line before, unless those two
 * lines before already rhyme with each other (a couplet done: this line starts a new one).
 */
export function rhymeTarget(dict, lines, i) {
  const last = (k) => tokens(lines[k] ?? '').at(-1);
  if (i < 1 || !last(i - 1)) return null;
  if (i >= 2 && last(i - 2) && rhymeLevel(dict, last(i - 1), last(i - 2)) > 0) return null;
  return last(i - 1);
}

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
export function nextWords(model, dict, before, { target = null, targetSyl = 0, explicit = false, n = 3 } = {}) {
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
  take(top(model.tri.get(prev2), n, skip));
  take(top(model.bi.get(prev), n, skip));
  take(top(model.bi.get('<s>'), n, skip));
  take(top(model.uni, n, skip));
  return out;
}

// ---------- completing a line ----------

const LINKS = new Set(['the', 'a', 'an', 'my', 'your', 'his', 'her', 'our', 'their', 'this', 'that', 'in', 'on', 'to', 'of', 'for', 'with', 'like', 'at', 'from', 'and', 'but', 'so', 'i', "i'm", 'we', 'you', 'they']);

/**
 * Up to `n` ways to finish the line `before` (its words so far): endings from the lines learned, and
 * ending patterns ("watch me ___", "in the ___") filled with words that rhyme with `target` (the line
 * it answers), about as long as the rest of that line (`targetSyl`). With no target, endings that make
 * a line of about `targetSyl` (or 10) syllables. Strings to append.
 */
export function completeLine(model, dict, before, { target = null, targetSyl = 0, explicit = false, endings = {}, n = 3 } = {}) {
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
    let score = bonus - 1.2 * Math.abs(sylOf(t) - left);
    if (target) {
      const r = rhymeLevel(dict, end, target);
      if (!r) return;
      score += r === 2 ? 4 : 1.5;
    }
    // Flows from the last word written (learned to follow it), or starts fresh after a linking word.
    if (last && model.bi.get(last)?.has(t[0])) score += 1.5;
    if (last && LINKS.has(last) && LINKS.has(t[0])) score -= 2;
    cands.push({ t, score });
  };
  // Endings from the lines learned that can start here: on a linking word, or one learned to follow
  // the last word written.
  for (const t of model.ends) if (LINKS.has(t[0]) || (last && model.bi.get(last)?.has(t[0])) || (!last && model.bi.get('<s>')?.has(t[0]))) consider(t, 0);
  if (target) {
    const r = rhymesFor(dict, target, { explicit, max: 40 });
    for (const e of [...r.perfect, ...r.near.slice(0, 15)]) {
      if (e.lvl > 2) continue;
      for (const p of [...e.pos]) for (const pat of endings[p] ?? []) consider(tokens(pat.replace('{}', e.word)), -0.5 - 0.3 * e.lvl);
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const out = []; const ends = new Set(); const starts = new Set();
  for (const c of cands) {
    // A different rhyme word for each suggestion, and a different way there.
    const end = c.t.at(-1); const start = c.t.slice(0, Math.min(2, c.t.length - 1)).join(' ');
    if (ends.has(end) || starts.has(start)) continue;
    ends.add(end); starts.add(start);
    out.push(c.t.join(' ').replace(/\bi\b/g, 'I').replace(/\bi'/g, "I'"));
    if (out.length >= n) break;
  }
  return out;
}
