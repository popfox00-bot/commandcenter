// Socials' chat replies: what another account says back when the Owner messages it, from the whole
// conversation, not only the last line. It knows when it's being answered (it asked something a moment ago:
// "good!" to its "how are you?" gets "Love that!"), when it's asked something back ("you?"), what the chat's
// been about (the pizza, the trip), plans the Owner mentioned before and how they went ("How was the concert??"
// the next day), a post shared with it, and what it's said already (never the same again). All on the phone,
// offline. Pure: give it the history. `rand` and `now` for tests.

import { readText, emojisIn, intentOf, generateComment } from './socials-predict.js';

const pick = (a, rand) => a[Math.floor(rand() * a.length) % a.length];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s) => String(s ?? '').toLowerCase();

const POS = /\b(good|great|amazing|awesome|fun|yes|yeah|yep|yess+|love(d)?|perfect|nice|fantastic|so good|the best|incredible|happy|excited|well|fine|not bad|pretty good|chill|relaxing)\b|😊|😁|😄|🥰|❤️|🎉|🙌|😍/i;
const NEG = /\b(bad|awful|terrible|no|nope|not really|tired|sad|sick|ugh|rough|stressed|meh|boring|bored|exhausted|annoyed|sucked|sucks|horrible|worst)\b|😢|😭|😔|💔|😞|😩|😫/i;
const BYE = /\b(bye|good ?night|gn|night night|ttyl|talk (to you )?later|gotta go|got to go|see (you|ya)|cya|later!?)\b/i;
const ASK_BACK = /\b(you\?|and you|what about you|how about you|u\?|hbu|wbu|yourself\?)\s*$/i;
const WHEN = /\b(tonight|tomorrow|this weekend|later today|later|next week|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;

/** How someone's message sounds: 'pos' | 'neg' | 'neutral'. */
export function moodOf(text) {
  // ("Not great" is bad; "not bad" is good.)
  const t = String(text ?? '').replace(/\b(not|isn'?t|wasn'?t|never) (so |that |very |really )?(good|great|fun|amazing|awesome|well|nice|happy|the best)\b/gi, 'bad'); const n = NEG.test(t) && !/\b(not bad|no worries)\b/i.test(t); const p = POS.test(t);
  return n && !p ? 'neg' : p && !n ? 'pos' : n && p ? (/\b(but|though)\b/i.test(t) ? 'neg' : 'pos') : 'neutral';
}

/**
 * Plans the Owner mentioned: [{ what, when, at }] ("going to a concert tonight" → { what: 'the concert',
 * when: 'tonight' }), from their messages.
 */
export function plansIn(history) {
  const out = [];
  for (const m of history) {
    if (!m.mine || !m.text) continue;
    const t = lower(m.text); const w = t.match(WHEN); if (!w) continue;
    const g = t.match(/\b(?:going to|gonna go to|gonna|heading to|have|got|off to|at|seeing|trying|doing|starting|my)\s+(?:a |an |the |my |our |this |that )?([a-z][a-z' ]{2,30}?)(?=\s+(?:tonight|tomorrow|this weekend|later|next week|on \w+day)\b|[.!?,]|$)/);
    if (!g) continue;
    let what = g[1].trim().replace(/\s+(with|and|at|for)\b.*$/, '');
    if (/^(to|be|go|do|it|so|that|this|work out|sleep)$/.test(what) || what.split(' ').length > 4) continue;
    // (A place or a name, as they wrote it: "Denver", not "the denver".)
    const orig = String(m.text).match(new RegExp(`\\b${what.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'))?.[0] ?? what;
    what = /^[A-Z]/.test(orig) ? orig : /^(a|an|the|my)\b/.test(what) ? what : `the ${what}`;
    out.push({ what, when: w[1], at: m.at });
  }
  return out;
}

/** Whether a plan is over by `now` (a night's plan by the next morning, tomorrow's by the day after…). */
function over(plan, now) {
  const d = new Date(plan.at); const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); const D = 86400000;
  const w = plan.when;
  const end = /tonight|later/.test(w) ? day + D + 6 * 3600000 : /tomorrow/.test(w) ? day + 2 * D : /weekend/.test(w) ? day + 4 * D : /next week/.test(w) ? day + 9 * D : day + 3 * D;
  return now >= end;
}

// What to say to a topic, and something to ask about it.
const TOPIC_TALK = {
  food: { say: ['Ooh that sounds so good', 'Okay now I\'m hungry', 'Jealous!!', 'Yum'], ask: ['What did you get?', 'Where from?', 'Was it good?'], e: ['😋', '🤤', '🍕'] },
  travel: { say: ['That sounds amazing', 'So jealous', 'Living the dream'], ask: ['When do you leave?', 'Who are you going with?', 'How long are you there?'], e: ['✈️', '🌍', '😍'] },
  fitness: { say: ['Proud of you!', 'Look at you go', 'Beast mode'], ask: ['What did you work on?', 'How long did you go for?'], e: ['💪', '🔥', '🏃'] },
  music: { say: ['That sounds so fun', 'Wish I was there!', 'Ahh fun!!'], ask: ['Who\'s playing?', 'What was the best song?'], e: ['🎶', '🎤', '🕺'] },
  pet: { say: ['Aww', 'Too cute', 'I miss them!'], ask: ['Send pics!!', 'What are they up to?'], e: ['🐶', '🥰', '🐾'] },
  birthday: { say: ['Happy birthday!!', 'Yay birthday!', 'Aww happy birthday'], ask: ['What are you doing to celebrate?', 'Any plans?'], e: ['🎂', '🎉', '🥳'] },
  friends: { say: ['Love that', 'That sounds so fun', 'Aw I love you guys'], ask: ['Who all is coming?', 'Was everyone there?'], e: ['🥰', '👯', '❤️'] },
  style: { say: ['Ooh cute', 'Okay fashion icon', 'Love that'], ask: ['Where\'s it from?', 'Send a pic!'], e: ['😍', '✨', '💅'] },
  win: { say: ['Congrats!!', 'So proud of you!', 'You deserve it'], ask: ['How does it feel?', 'Are you celebrating?'], e: ['🎉', '🙌', '🏆'] },
  game: { say: ['Nice!!', 'Let\'s gooo', 'Okay gamer'], ask: ['What are you playing?', 'Did you win?'], e: ['🎮', '🔥', '😎'] },
  beach: { say: ['So jealous', 'Beach day!!', 'That sounds perfect'], ask: ['Which beach?', 'Is it nice out?'], e: ['🌊', '☀️', '🏖️'] },
  nature: { say: ['So peaceful', 'Love that', 'Sounds lovely'], ask: ['Where are you?', 'Send pics!'], e: ['🌿', '🌸', '😊'] },
  car: { say: ['Nice ride', 'Ooh fancy'], ask: ['What did you get?', 'Take me for a drive?'], e: ['🚗', '😎'] },
  sunset: { say: ['Gorgeous', 'Love a good sunset'], ask: ['Where were you?'], e: ['🌅', '🧡'] },
  art: { say: ['You\'re so talented', 'Love that'], ask: ['Can I see?', 'What are you making?'], e: ['🎨', '✨'] },
};

// What it's doing, when asked.
const DOING = ['Just got back from the gym', 'Making dinner', 'Watching a movie', 'Just chilling at home', 'Out getting coffee', 'Working, but bored', 'Cleaning my room lol', 'About to go for a walk', 'Scrolling on my phone honestly'];
const FEELING = ['I\'m good!', 'Pretty good!', 'Doing great!', 'Not bad at all!', 'Honestly so good today'];

/**
 * A reply from the other account to the Owner, from the conversation so far: `history` [{ mine (the Owner's),
 * text, at, post?: { caption, scene } }] oldest first. A sentence or two, with emojis that fit, never one it's
 * sent before in the chat.
 */
export function chatReply(history, { rand = Math.random, now = Date.now() } = {}) {
  const h = (history ?? []).filter((m) => m && (m.text || m.post));
  const lastThem = [...h].reverse().findIndex((m) => !m.mine);
  // (What the Owner's said since it last spoke.)
  const fresh = lastThem < 0 ? h.filter((m) => m.mine) : h.slice(h.length - lastThem).filter((m) => m.mine);
  const said = lastThem < 0 ? null : h[h.length - 1 - lastThem];
  const text = fresh.map((m) => m.text).filter(Boolean).join(' ').trim();
  const mine = new Set(h.filter((m) => !m.mine).map((m) => lower(m.text).trim()));
  const window = h.slice(-8).map((m) => m.text || m.post?.caption || '').join(' ');
  const r = readText(text); const rw = readText(window); const tp = r.topics[0] ?? rw.topics[0];
  const talk = tp ? TOPIC_TALK[tp.id] : null;
  const it = intentOf(text); const mood = moodOf(text);
  const opts = []; // [text, weight]
  const add = (t, w = 1) => { if (t && !mine.has(lower(t).trim())) opts.push([t, w]); };
  const e = (pool) => pick(pool, rand);
  const emo = emojisIn(text);

  // (A post shared with it: something about the post (its photo and caption), and maybe a question.)
  const shared = [...fresh].reverse().find((m) => m.post)?.post;
  if (shared) {
    const c = generateComment(shared.caption ?? '', { rand, photo: shared.scene ?? null });
    add(c, 6); add(`${c} ${pick(['Where was this?', 'When was this?!', 'Love it'], rand)}`, 4);
  }
  // (Saying goodbye.)
  if (BYE.test(text) && !shared) { const night = /night|gn/i.test(text); return `${pick(night ? ['Night!', 'Night night', 'Sleep well!', 'Good night!'] : ['Bye!!', 'Talk soon!', 'Okay ttyl!', 'See you!'], rand)} ${e(night ? ['😴', '🌙', '💛', '❤️'] : ['👋', '❤️', '💛', '😄'])}`; }
  // (Its own question just answered: to the answer.)
  const askedQ = said && !said.mine && /\?\s*\S*$/.test(said.text ?? '');
  if (askedQ && text && !BYE.test(text)) {
    const q = lower(said.text);
    const ack = mood === 'pos' ? pick(['Love that!', 'Yay!!', 'Nice!!', 'Ahh that\'s great', 'Glad to hear it!'], rand) : mood === 'neg' ? pick(['Aw no', 'Ugh, I\'m sorry', 'Oh no, that\'s rough', 'Noo'], rand) : pick(['Ohh okay', 'Got it!', 'Ah nice', 'Fair enough'], rand);
    const em = mood === 'pos' ? e(['😊', '🙌', '🥳', '💛']) : mood === 'neg' ? e(['😕', '🫂', '💛']) : e(['👍', '😄', '🙂']);
    const follow = mood === 'neg' ? pick(['Want to talk about it?', 'What happened?', 'Anything I can do?'], rand) : talk ? pick(talk.ask, rand) : /how was|how did/.test(q) ? pick(['What was the best part?', 'Tell me everything', 'Would you go again?'], rand) : '';
    add(`${ack} ${em}${follow ? ` ${follow}` : ''}`, 8);
  }
  // (Asked something back: "you?", "how are you?", "wyd".)
  if (ASK_BACK.test(text) || it === 'howareyou') {
    const doing = /\b(wyd|what are you (up to|doing)|what('?s| is) up|whats up|wbu|what about you)\b/i.test(text);
    add(doing ? `${pick(DOING, rand)} ${e(['😄', '🙂', '😌', '🛋️'])}` : `${pick(FEELING, rand)} ${e(['😊', '🙂', '💛', '😄'])} ${pick(['Thanks for asking', 'What about you?', 'Busy day but good', 'Just relaxing now'], rand)}`, 8);
  }
  // (A plan from before, now over: how did it go?)
  const plans = plansIn(h.filter((m) => m !== undefined)).filter((p) => over(p, now) && !h.some((m) => !m.mine && m.at > p.at && lower(m.text).includes('how was')));
  if (plans.length && !askedQ && !shared) { const p = plans[plans.length - 1]; add(`${/^(hi|hey|hello|yo|hiya|heyy+|good morning|morning|gm)\b/i.test(text) ? `${pick(['Hey!!', 'Hiii!', 'Heyy!'], rand)} ` : ''}How was ${p.what}?? ${e(['👀', '😄', '🥳'])}`, 9); }
  // (A plan now: excited about it, and a question.)
  const now1 = plansIn(fresh)[0];
  if (now1) add(`${pick(['Ooh fun!', 'Ahh that sounds so fun', 'Nice!! Have the best time', 'Jealous!'], rand)} ${e(['🙌', '🥳', '😄'])} ${talk ? pick(talk.ask, rand) : pick(['Who\'s going?', 'What time?', 'Send pics!'], rand)}`, 7);
  // (What it's about: to the topic, often with a question to keep it going.)
  if (talk && text) add(`${pick(talk.say, rand)} ${e(talk.e)}${rand() < 0.65 ? ` ${pick(talk.ask, rand)}` : ''}`, 5);
  // (The intent: thanks, hello, a laugh, sad news… made to the conversation.)
  if (it === 'sad') add(`${pick(['Oh no, what happened?', 'Aw I\'m sorry', 'Sending hugs', 'That sounds hard'], rand)} ${e(['🫂', '💛', '😕'])}${tp ? ` ${pick(['Is it about', 'Was it the'], rand)} ${tp.nouns[0]}?` : ''}`, 6);
  if (it === 'thanks') add(`${pick(['Anytime!', 'Of course!', 'Always', 'No problem at all'], rand)} ${e(['😊', '❤️', '🙌', '💛'])}`, 6);
  if (it === 'hello') add(`${pick(['Hey!', 'Hiii', 'Heyyy', 'Hey you!'], rand)} ${e(['👋', '😊', '💛'])} ${h.length > 2 ? pick(['How\'s your day going?', 'What are you up to?', 'How\'s it going?'], rand) : pick(['What\'s up?', 'How are you?'], rand)}`, 5);
  if (it === 'laugh') add(pick(['😂😂 right?!', 'Hahaha stop', 'I can\'t 🤣', 'LOL 😂', 'Dying 💀😂'], rand), 6);
  if (it === 'love') add(`${pick(['Love you too!', 'Aww', 'Miss you more!'], rand)} ${e(['❤️', '🥰', '💕'])}`, 6);
  if (it === 'compliment') add(`${pick(['Aww thank you', 'Stop it, you\'re too sweet', 'That means a lot'], rand)} ${e(['🥰', '🥹', '❤️'])}`, 6);
  if (it === 'excited') add(`${pick(['No way!!', 'OMG yes!!', 'Ahh that\'s amazing!', 'Wait really?!'], rand)} ${e(['🤩', '🎉', '🥳'])} ${pick(['Tell me everything', 'I\'m so happy for you', 'When??'], rand)}`, 6);
  if (it === 'plan') add(`${pick(['I\'m in!', 'Yes! Sounds fun', 'Count me in!', 'Let\'s do it!'], rand)} ${e(['🙌', '🎉', '😄'])} ${pick(['What time?', 'Where?', 'Who else is coming?'], rand)}`, 6);
  if (it === 'yesno') add(`${pick(['Yeah, for sure!', 'Hmm maybe!', 'Yes!!', 'I think so!', 'Definitely'], rand)} ${e(['😊', '🤔', '🙌', '👍'])}`, 5);
  if (it === 'question' && !ASK_BACK.test(text)) add(`${pick(['Good question', 'Hmm let me think', 'Honestly not sure yet', 'Ooh I have to check'], rand)} ${e(['🤔', '😅', '🙂'])} ${pick(['What do you think?', 'I\'ll let you know!', 'Why, what\'s up?'], rand)}`, 4);
  // (Its words back about what they said, and the general ones.)
  const kw = r.keywords.find((w) => w.length > 3 && w.length < 16 && !/^(that|this|with|have|just|really|today|going|about)$/.test(w));
  if (kw && it === 'chat') add(`Wait, ${kw}? Tell me more ${e(['👀', '😄', '🙂'])}`, 3);
  if (mood === 'neg' && !askedQ && !ASK_BACK.test(text)) add(`${pick(['Oh no', 'Aw', 'Ugh'], rand)} ${e(['😕', '🫂'])} ${pick(['What happened?', 'Are you okay?', 'Want to talk?'], rand)}`, 4);
  if (mood === 'pos' && !askedQ && !ASK_BACK.test(text)) add(`${pick(['Love that!', 'Yay!', 'That\'s awesome'], rand)} ${e(['😊', '🙌', '💛'])}`, 3);
  // (The general ones: only now and then when there's something better.)
  const gw = opts.some(([, w]) => w >= 5) ? 0 : opts.length ? 0.12 : 1;
  for (const g of ['Haha nice', 'Oh really? Tell me more!', 'Love that', 'Wait what', 'Omg', 'Same honestly', 'That\'s so true']) add(`${g} ${emo.length && rand() < 0.5 ? pick(emo, rand) : e(['😄', '😊', '🙂', '👀'])}`, gw);
  if (!opts.length) return pick(['Haha', 'Okay!', 'Nice', 'Ooh'], rand) + ' ' + e(['😄', '🙂']);
  const total = opts.reduce((a, [, w]) => a + w, 0); let x = rand() * total;
  for (const [t, w] of opts) { x -= w; if (x <= 0) return t.replace(/\s+/g, ' ').trim(); }
  return opts[opts.length - 1][0].replace(/\s+/g, ' ').trim();
}
