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
