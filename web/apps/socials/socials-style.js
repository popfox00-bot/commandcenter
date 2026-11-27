// How an account talks, and how the Owner does: each of the other accounts has a voice of its own (hype,
// chill, warm, witty or classic, the same every time, from its handle), and what it writes leans toward the
// Owner's own way of texting in that chat (all lowercase, lots of emojis or none, !!!, short, "lol" / "fr").
// Applied to a reply or comment once it's written. Pure; `rand` for tests.

const pick = (a, rand) => a[Math.floor(rand() * a.length) % a.length];
const EMOJI = /\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|️)*/gu;

/** The voices. */
export const PERSONAS = ['hype', 'chill', 'warm', 'witty', 'classic'];

/** An account's voice, the same every time: from its handle (a celebrity's is hype, warm or classic). */
export function personaOf(handle, kind = 'friend') {
  let h = 2166136261; for (const ch of String(handle ?? '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const pool = kind === 'celebrity' ? ['hype', 'warm', 'classic'] : PERSONAS;
  return pool[(h >>> 0) % pool.length];
}

/** An account's voice: the one chosen in its profile (Edit profile → Voice), else its own from its handle. */
export const personaFor = (a) => (PERSONAS.includes(a?.voice) ? a.voice : personaOf(a?.handle, a?.kind));
/** What an account's about, for the on-device AI to write as it: its bio and what it's into ('' if neither). */
export const aboutOf = (a) => [a?.bio ? `Bio: ${String(a.bio).slice(0, 160)}` : '', a?.interests ? `Into: ${String(a.interests).slice(0, 120)}` : ''].filter(Boolean).join('. ');

const SLANG = ['lol', 'lmao', 'fr', 'ngl', 'lowkey', 'omg', 'tbh', 'literally', 'bro', 'haha'];
/**
 * How someone texts, from their messages: { lower (most start lowercase), emoji (emojis a message), bang
 * ('!' a message), short (few words), slang: [the ones they use], stretch (sooo, yesss) }, or null with none.
 */
export function styleOf(texts) {
  const t = (texts ?? []).map((x) => String(x ?? '').trim()).filter(Boolean).slice(-8);
  if (!t.length) return null;
  const starts = t.filter((x) => /^[\p{L}]/u.test(x));
  const lower = starts.length ? starts.filter((x) => /^[\p{Ll}]/u.test(x)).length / starts.length >= 0.6 : false;
  const emoji = t.reduce((a, x) => a + (x.match(EMOJI)?.length ?? 0), 0) / t.length;
  const bang = t.reduce((a, x) => a + (x.match(/!/g)?.length ?? 0), 0) / t.length;
  const words = t.reduce((a, x) => a + x.split(/\s+/).length, 0) / t.length;
  const all = t.join(' ').toLowerCase();
  return { lower, emoji, bang, short: words <= 5, slang: SLANG.filter((w) => new RegExp(`\\b${w}\\b`).test(all)), stretch: /([a-z])\1\1/i.test(all) };
}

/** The emojis in a text taken out (spaces tidied). */
const noEmoji = (s) => s.replace(new RegExp(`([\\p{L}\\p{N}])\\s*(?:${EMOJI.source})+\\s+(?=\\p{L})`, 'gu'), '$1! ').replace(EMOJI, '').replace(/\s{2,}/g, ' ').replace(/\s+([?!.,])/g, '$1').trim();
/** Sentences' first letters made small (not an @handle's). */
const lowerStarts = (s) => s.replace(new RegExp(`(^|[.!?]\\s+|(?:${EMOJI.source})\\s+)(\\p{Lu})(?=[\\p{Ll}\\s'’]|$)`, 'gu'), (m, a, ...r) => a + r[r.length - 3].toLowerCase()).replace(/\bI\b/g, 'i').replace(/\bI'/g, "i'");
/** An emoji added at the end (beside one there already, else after a space). */
const addEmoji = (s, e) => (new RegExp(`(?:${EMOJI.source})$`, 'u').test(s) ? s + e : `${s} ${e}`);
/** A word drawn out: so → sooo, yes → yesss. */
const stretch = (s, rand) => s.replace(/\b(so|yes|omg|no|love|yay|nice|cute|wait)\b/i, (w) => (rand() < 0.7 ? w + w.slice(-1).repeat(2) : w));

/**
 * `text` in the account's voice (`persona`) and leaning toward the Owner's way of texting (`style`, from
 * styleOf; null: none).
 */
export function voice(text, { persona = 'classic', style = null, rand = Math.random } = {}) {
  let s = String(text ?? '').trim(); if (!s) return s;
  const emojis = s.match(EMOJI) ?? [];
  // (Its own voice.)
  if (persona === 'hype') {
    if (rand() < 0.45) s = stretch(s, rand);
    s = s.replace(/!(?!!)/, rand() < 0.6 ? '!!' : '!');
    if (rand() < 0.22 && !/^(omg|wait|stop|no way)/i.test(s)) s = `${pick(['OMG', 'WAIT', 'STOP', 'Okay'], rand)} ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
    if (emojis.length && rand() < 0.5) s = addEmoji(s, emojis[emojis.length - 1]);
  } else if (persona === 'chill') {
    s = lowerStarts(s).replace(/!{2,}/g, '!').replace(/\?!/g, '?');
    if (emojis.length > 1) { let n = 0; s = s.replace(EMOJI, (e) => (n++ ? '' : e)).replace(/\s{2,}/g, ' ').trim(); }
    if (rand() < 0.25 && !/\b(fr|ngl|lol)\b/.test(s)) s = s.replace(/([.!?]?)(\s*\p{Extended_Pictographic}*)$/u, (m, p, e) => ` ${pick(['fr', 'ngl', 'lol', 'tbh'], rand)}${e}`).replace(/\s{2,}/g, ' ');
  } else if (persona === 'warm') {
    if (!/[💛❤️🥹🥰💕🤍]/u.test(s) && rand() < 0.6) s = addEmoji(s, pick(['💛', '🥹', '❤️', '🥰'], rand));
    if (rand() < 0.15 && !/^aw+/i.test(s)) s = `Aww ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  } else if (persona === 'witty') {
    if (rand() < 0.3 && s.length < 70) s = s.replace(/(\s*\p{Extended_Pictographic}*)$/u, (e) => ` ${pick(['(no notes)', '10/10', 'iconic behavior', 'and I mean that', 'not even kidding'], rand)}${e}`);
  }
  // (Leaning toward the Owner's way of texting.)
  if (style) {
    if (style.lower) s = lowerStarts(s);
    if (style.emoji < 0.25 && rand() < 0.7) s = noEmoji(s);
    else if (style.emoji >= 1.5 && (s.match(EMOJI)?.length ?? 0) < 3) { const e = s.match(EMOJI); if (e) s = addEmoji(s, e[0]); }
    if (style.bang >= 1.5) s = s.replace(/!(?!!)/g, '!!'); else if (style.bang < 0.2 && persona !== 'hype') s = s.replace(/!{2,}/g, '!');
    // (They text short: its last sentence left off, when what's left still says something.)
    if (style.short && s.split(/\s+/).length > 12) { const parts = s.split(/(?<=[.!?])\s+/); const keep = parts.slice(0, -1).join(' '); if (parts.length > 2 && keep.split(/\s+/).length >= 5 && rand() < 0.6) s = keep; }
    if (style.stretch && persona !== 'hype' && rand() < 0.35) s = stretch(s, rand);
    if (style.slang.length && rand() < 0.3 && !new RegExp(`\\b(${style.slang.join('|')})\\b`, 'i').test(s)) s = s.replace(/(\s*\p{Extended_Pictographic}*)$/u, (e) => ` ${pick(style.slang.filter((x) => ['lol', 'fr', 'ngl', 'lowkey', 'tbh', 'haha', 'lmao'].includes(x)).concat(['lol']), rand)}${e}`);
  }
  return s.replace(/\s{2,}/g, ' ').trim();
}

// ---- How tame or adult the words are (Socials' setting: 0 Tame, 1 Casual, 2 Spicy, 3 Adult). Tame never
// swears (anything that slips in is cleaned); Casual says damn and hell; Spicy swears freely; Adult adds crude
// humor and flirting. Never explicit: it's banter.

export const CONTENT_LEVELS = [
  { id: 'tame', name: 'Tame', note: 'No swearing at all.' },
  { id: 'casual', name: 'Casual', note: 'Mild words now and then: damn, hell.' },
  { id: 'spicy', name: 'Spicy', note: 'Swears freely, like close friends do.' },
  { id: 'adult', name: 'Adult (18+)', note: 'Swearing, crude humor and flirting, in comments, captions and messages (every account here is a made-up adult). Banter, not explicit.' },
];

const STRONG = /\b(fuck(?:ing|in'?|ed|er|s)?|motherfuck\w*|shit(?:ty|s)?|bullshit|ass(?:hole)?|bitch(?:es|ing)?|dick|piss(?:ed)?|bastard|wtf|af)\b/gi;
const MILD = /\b(damn|dammit|hell|crap|freaking|frickin)\b/gi;
const SOFT = { fuck: 'heck', fucking: 'freaking', fuckin: 'freaking', "fuckin'": 'freaking', fucked: 'messed', fucker: 'jerk', fucks: 'hecks', shit: 'stuff', shitty: 'crummy', shits: 'stuff', bullshit: 'nonsense', ass: 'butt', asshole: 'jerk', bitch: 'jerk', bitches: 'jerks', bitching: 'complaining', dick: 'jerk', piss: 'tick', pissed: 'mad', bastard: 'jerk', wtf: 'what', af: 'so much', damn: 'dang', dammit: 'darn it', hell: 'heck', crap: 'stuff', freaking: 'really', frickin: 'really' };
const softWord = (w) => { const r = SOFT[w.toLowerCase()] ?? 'heck'; return w[0] === w[0].toUpperCase() ? r.charAt(0).toUpperCase() + r.slice(1) : r; };

/** Words above the level cleaned out: Tame none at all, Casual only mild ones. */
export function cleanWords(text, level = 0) {
  let s = String(text ?? '');
  if (level < 2) s = s.replace(/\bholy shit\b/gi, (m) => (m[0] === 'H' ? 'Holy cow' : 'holy cow')).replace(/\bno fucking way\b/gi, 'no way').replace(/\bwhat the fuck\b/gi, 'what the heck').replace(/\bfuck (yes|yeah)\b/gi, (m, w) => `${m[0] === 'F' ? 'Heck' : 'heck'} ${w}`).replace(STRONG, softWord);
  if (level < 1) s = s.replace(MILD, softWord);
  return s.replace(/\s{2,}/g, ' ').trim();
}

/**
 * A reply or comment at a level: spiced up now and then (Casual: "damn", "hell yeah"; Spicy: "holy shit", "so
 * fucking good"; Adult: and crude, flirty asides), never over it. `mood`: 'pos' | 'neg' | 'neutral'.
 */
export function spice(text, level = 0, { rand = Math.random, mood = 'neutral', persona = 'classic' } = {}) {
  let s = cleanWords(text, level); if (level <= 0) return s;
  const chance = [0, 0.3, 0.5, 0.65][level] * (persona === 'warm' ? 0.6 : persona === 'hype' || persona === 'chill' ? 1.2 : 1);
  if (rand() >= chance) return s;
  const lead = (pool) => { const w = pick(pool, rand); return `${w} ${s.charAt(0).toLowerCase()}${s.slice(1)}`; };
  const pools = {
    pos: [['Damn,', 'Hell yeah,', 'Dang,'], ['Holy shit,', 'Fuck yes,', 'Hell yeah,', 'Damn,'], ['Holy shit,', 'Fuck yes,', 'Hell yeah,', 'Goddamn,']],
    neg: [['Damn,', 'Well hell,', 'Dang,'], ['Shit,', 'Fuck,', 'Damn,'], ['Shit,', 'Fuck,', 'Ugh, fuck,']],
    neutral: [['Damn,', 'Okay damn,'], ['Okay damn,', 'Holy shit,', 'Damn,'], ['Okay damn,', 'Holy shit,', 'Damn,']],
  }[mood] ?? [['Damn,']];
  const r = rand();
  if (r < 0.45 && !/^(damn|hell|holy|fuck|shit|goddamn|dang|okay damn|well hell)/i.test(s)) s = lead(pools[level - 1]);
  else if (r < 0.8 && /\bso (good|cute|fun|hot|nice|pretty|cool|jealous|happy|proud|bad|annoying|gorgeous)\b/i.test(s)) s = s.replace(/\bso (good|cute|fun|hot|nice|pretty|cool|jealous|happy|proud|bad|annoying|gorgeous)\b/i, (m, w) => `so ${level >= 2 ? pick(['fucking', 'damn', 'freaking'], rand) : 'damn'} ${w}`);
  else if (level >= 2 && mood !== 'neg') s = s.replace(/(\s*\p{Extended_Pictographic}*)$/u, (e) => ` ${pick(level >= 3 ? ['no fucking way', 'holy shit', 'love that shit', 'damn'] : ['no fucking way', 'holy shit', 'damn'], rand)}${e}`);
  // (Adult: a crude or flirty aside, now and then.)
  if (level >= 3 && rand() < 0.22 && mood !== 'neg') s = s.replace(/(\s*\p{Extended_Pictographic}*)$/u, (e) => ` ${pick(['ngl that\'s hot', 'okay who gave you permission to be this hot', 'I\'m not even mad, that\'s sexy as hell', 'damn, save some for the rest of us', 'that\'s some sexy shit right there'], rand)}${e}`);
  return s.replace(/\s{2,}/g, ' ').trim();
}
