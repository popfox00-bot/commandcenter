// Socials' chat replies: what another account says back when the Owner messages it, from the whole
// conversation, not only the last line. It knows when it's being answered (it asked something a moment ago:
// "good!" to its "how are you?" gets "Love that!"), when it's asked something back ("you?"), what the chat's
// been about (the pizza, the trip), plans the Owner mentioned before and how they went ("How was the concert??"
// the next day), a post shared with it, and what it's said already (never the same again). It remembers what the
// Owner has told it (a pet's name, a sister, where they work or live, what they love) and asks after it later; it has
// a life of its own (what it's into, from its profile) that it talks about; and its replies are often a reaction, a
// bit of its own, and a question to keep it going. All on the phone, offline. Pure: give it the history. `rand` and
// `now` for tests.

import { readText, emojisIn, intentOf, generateComment, placesIn } from './socials-predict.js';
import { voice, styleOf } from './socials-style.js';

const pick = (a, rand) => a[Math.floor(rand() * a.length) % a.length];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s) => String(s ?? '').toLowerCase();

const POS = /\b(good|great|amazing|awesome|fun|yes|yeah|yep|yess+|love(d)?|perfect|nice|fantastic|so good|the best|incredible|happy|excited|well|fine|not bad|pretty good|chill|relaxing)\b|😊|😁|😄|🥰|❤️|🎉|🙌|😍/i;
const NEG = /\b(bad|awful|terrible|no|nope|not really|tired|sad|sick|ugh|rough|stressed|meh|boring|bored|exhausted|annoyed|sucked|sucks|horrible|worst)\b|😢|😭|😔|💔|😞|😩|😫/i;
const BYE = /\b(bye|good ?night|gn|night night|ttyl|talk (to you )?later|gotta go|got to go|see (you|ya)|cya|later!?)\b/i;
const ASK_BACK = /\b(you\?|and you|what about you|how about you|u\?|hbu|wbu|yourself\?)\s*$/i;
const WHEN = /\b(tonight|tomorrow|this weekend|later today|later|next week|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;

// ---- What the Owner's told it, remembered.
const PETS = 'dog|cat|puppy|pup|kitten|bunny|rabbit|bird|parrot|fish|hamster|horse|turtle|lizard|snake';
const PEOPLE = 'sister|brother|mom|mum|dad|boyfriend|girlfriend|wife|husband|partner|roommate|bestie|best friend|boss|son|daughter|grandma|grandpa|cousin|niece|nephew|fiance|fiancé|fiancee';
const NOT_NAME = /^(I|Im|The|A|An|And|But|So|He|She|They|It|We|You|Is|Was|Just|Today|Tonight|Lol|Omg)$/;
/**
 * What the Owner has told it about themselves, from their messages, latest last: [{ kind: 'pet' | 'person' | 'work' |
 * 'city' | 'love', what, name?, at }] ("my dog Max" → { kind: 'pet', what: 'dog', name: 'Max' }).
 */
export function factsIn(history) {
  const out = []; const seen = new Set();
  const push = (f) => { const k = `${f.kind}|${lower(f.name ?? f.what)}`; if (seen.has(k)) return; seen.add(k); out.push(f); };
  for (const m of history ?? []) {
    if (!m?.mine || !m.text) continue; const t = String(m.text);
    for (const g of t.matchAll(new RegExp(`\\bmy (${PETS})(?:'s name is|,| named| called| is called)? ([A-Z][a-z]{1,14})\\b`, 'gi'))) if (!NOT_NAME.test(g[2]) && /^[A-Z]/.test(g[2])) push({ kind: 'pet', what: g[1].toLowerCase(), name: g[2], at: m.at });
    for (const g of t.matchAll(new RegExp(`\\bmy (${PEOPLE})(?:,| named| called)? ([A-Z][a-z]{1,14})?`, 'gi'))) { const name = g[2] && /^[A-Z]/.test(g[2]) && !NOT_NAME.test(g[2]) ? g[2] : undefined; push({ kind: 'person', what: g[1].toLowerCase(), name, at: m.at }); }
    const w = t.match(/\bI (?:work|started working) (?:at|for) ([A-Z][\w&'.]*(?: [A-Z][\w&'.]*){0,3})/); if (w) push({ kind: 'work', what: w[1], at: m.at });
    const c = t.match(/\bI (?:live|just moved|moved) (?:in|to) ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/); if (c) push({ kind: 'city', what: c[1], at: m.at });
    const l = t.match(/\bI(?:'m| am)? (?:love|really love|really like|am obsessed with|'m obsessed with|obsessed with) ([a-z][a-z' ]{2,24}?)(?=[.!?,]|\s+(?:so|lately|right now|rn)\b|$)/i); if (l && !/^(you|it|that|this|him|her|them)\b/i.test(l[1])) push({ kind: 'love', what: l[1].trim(), at: m.at });
  }
  return out;
}
/** Something to ask after what it knows, or '' ("How's Max doing?"). */
function recallLine(f, rand) {
  if (f.kind === 'pet') return f.name ? pick([`How's ${f.name} doing?`, `Give ${f.name} a pet from me!`, `What's ${f.name} up to today?`], rand) : `How's your ${f.what}?`;
  if (f.kind === 'person') return f.name ? pick([`How's ${f.name}?`, `How's ${f.name} doing?`], rand) : pick([`How's your ${f.what} doing?`, `How's your ${f.what}?`], rand);
  if (f.kind === 'work') return pick([`How's work at ${f.what}?`, `Is ${f.what} keeping you busy?`], rand);
  if (f.kind === 'city') return pick([`How's ${f.what} treating you?`, `Anything fun going on in ${f.what}?`], rand);
  if (f.kind === 'love') return pick([`Still obsessed with ${f.what}?`, `Had any ${f.what} lately?`], rand);
  return '';
}

// ---- Its own life: what it's into (its profile's Into, else its bio's words), to talk about.
/** What an account is into, from its profile: a few short things ("hiking", "coffee", "techno"). */
export function interestsOf(about = '') {
  const into = String(about).match(/Into:\s*([^.]*)/i)?.[1] ?? '';
  return into.split(/[,;/&+]|\band\b/i).map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 3 && x.length <= 24 && !/^(stuff|things|everything|life)$/.test(x)).slice(0, 6);
}
const ownDoing = (x, rand) => pick([`Been all about ${x} today`, `Just did some ${x} stuff`, `Honestly just thinking about ${x} lol`, `Planning some ${x} this weekend`], rand);
const ownShare = (x, rand) => pick([`Random but I've been so into ${x} lately`, `Also I finally got some ${x} time in this week`, `I've been on a ${x} kick lately honestly`], rand);

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

// ---- Its words back: what they said, said back to them (I → you, my → your) and built on, so the reply is about
// what they actually said, not a stock line.

const FLIP = { i: 'you', "i'm": "you're", im: "you're", "i've": "you've", ive: "you've", "i'll": "you'll", "i'd": "you'd", me: 'you', my: 'your', mine: 'yours', myself: 'yourself', we: 'you guys', "we're": "you guys are", "we've": "you guys have", us: 'you guys', our: 'your', ours: 'yours', am: 'are' };
/** A sentence of theirs said back: "I got my license" → "you got your license" (null if it talks to it: "you"). */
export function flip(text) {
  const t = String(text ?? '').trim().replace(/[.!?…]+$/u, '').replace(/\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|️)*/gu, '').trim();
  if (!t || /\b(you|your|you're|u|ur)\b/i.test(t)) return null;
  let out = t.split(/(\s+)/).map((w) => { const k = w.toLowerCase().replace(/[^a-z']/g, ''); const f = FLIP[k]; return f ? w.replace(new RegExp(k.replace(/'/g, "'"), 'i'), f) : w; }).join('');
  out = out.replace(/\byou was\b/gi, 'you were').replace(/\byou guys was\b/gi, 'you guys were');
  return out;
}

const ADJ = 'best|new|first|cutest|biggest|worst|little|big|huge|cute|amazing|good|great|perfect|favorite|favourite|crazy|fancy|cozy|delicious|long|short|old|last|whole|tiny|beautiful|gorgeous|fresh|hot|cold|spicy|sweet|own';
const SKIP = new Set('day time thing things way lot bit kind sort today tonight tomorrow week weekend morning night moment while one ones stuff people guy guys idea point reason'.split(' '));
/** The thing they talk about, with what they said of it: "I had the best pizza" → { phrase: 'the best pizza', noun: 'pizza' }. */
export function phraseIn(text) {
  const t = lower(text).replace(/#\S+/g, ' ');
  const re = new RegExp(`\\b(the|a|an|my|our|this|that|some|these|those)\\s+((?:(?:${ADJ}|really|so|super|very)\\s+){0,2})([a-z][a-z'-]{2,14})(?:\\s+([a-z]{3,14}))?\\b`, 'g');
  let best = null;
  for (const m of t.matchAll(re)) {
    let noun = m[3]; let extra = '';
    // (Two words that go together: "ice cream", "road trip", "birthday party".)
    if (m[4] && /^(cream|trip|party|game|show|class|date|night|dinner|lunch|truck|shop|place|bar|day|cake|movie|concert|interview|exam|test|job|car|house|apartment|dress|shoes|book|song|album|tickets|ticket|flight|team|match|run|hike)$/.test(m[4]) && !SKIP.has(noun)) { extra = ` ${m[4]}`; }
    if (SKIP.has(noun) || /^(be|go|do|get|got|have|see|make|so|very|really|just|been|being)$/.test(noun)) continue;
    const det = { my: 'your', our: 'your', this: 'that', these: 'those' }[m[1]] ?? m[1];
    const cand = { phrase: `${det} ${m[2]}${noun}${extra}`.replace(/\s+/g, ' ').trim(), noun: `${noun}${extra}`, adj: m[2].trim(), own: /^(my|our)$/.test(m[1]) };
    if (!best || cand.adj.length > best.adj.length) best = cand;
  }
  // (Said without a "the": "best show ever".)
  if (!best) { const m = t.match(new RegExp(`\\b(${ADJ})\\s+([a-z]{3,14})(\\s+ever)?\\b`)); if (m && !SKIP.has(m[2]) && !/^(and|but|the|so|for|with)$/.test(m[2])) best = { phrase: `${m[1]} ${m[2]}${m[3] ?? ''}`, noun: m[2], adj: m[1], own: false, bare: true }; }
  return best;
}

const FEEL = {
  tired: ['Get some rest tonight', 'Go take a nap!', 'Long day?'], exhausted: ['Get some rest tonight', 'You deserve a break'], sleepy: ['Go to sleep lol', 'Nap time'],
  sick: ['Feel better soon!', 'Rest up and drink water', 'Do you need anything?'], bored: ['Want to hang out?', 'Same honestly', 'Come over!'], hungry: ['Same, what are you getting?', 'Food run?', 'What are you craving?'],
  stressed: ['What\'s going on?', 'Take a breath, you\'ve got this', 'Want to talk about it?'], sad: ['What happened?', 'Want to talk?', 'Sending a hug'], excited: ['Why?! Tell me', 'Love that energy', 'For what?!'],
  happy: ['Love that for you', 'What happened?!', 'Yay!'], nervous: ['You\'ve got this', 'For what?', 'It\'ll go great'], busy: ['Don\'t work too hard', 'Busy with what?', 'Take a break soon'],
  proud: ['You should be!', 'So proud of you too'], cold: ['Get a blanket lol', 'Same, it\'s freezing'], hot: ['Same, it\'s so hot', 'Stay cool!'], done: ['Same lol', 'What happened?'],
};
const NEWS = /^(i|we)\s+(just\s+|finally\s+|officially\s+)?(got|finished|passed|won|made|bought|started|booked|adopted|landed|beat|ran|hit|signed|moved|graduated|aced|found|met|tried|saw|watched|did|completed|scored|sold|built|cooked|baked|painted|wrote|learned|lost|broke|failed|missed|crashed|quit)\b/i;
const BAD_NEWS = /\b(lost|broke|failed|missed|crashed|quit|died)\b/i;
const NEWS2 = /^(my|our)\s+([a-z]+)\s+(just\s+|finally\s+)?([a-z]+ed|got|won|made|did|ate|ran|took|threw|broke|lost|found)\b/i;

/** Replies made from their own words: [text, weight]. `ctx`: { rand, mood, talk, askedQ, said }. */
function reflect(text, { rand, mood, talk, askedQ, said }) {
  const out = []; const e = (pool) => pick(pool, rand);
  const sentences = String(text ?? '').split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const bare = (x) => { let y = x; for (let i = 0; i < 2; i++) y = y.replace(/^(ugh+|omg|so|well|guess what|yay|ok|okay|lol|haha+|wow|yo|hey|honestly|literally|bro|dude|man|oh|ah+)[,!.\s]+/i, '').replace(/[,\s]+(lol|lmao|haha+|fr|ngl|tbh|omg|rn|tho|though)[.!?]*\s*$/i, ''); return y; };
  const main = bare(sentences.find((x) => NEWS.test(bare(x)) || NEWS2.test(bare(x)) || /\bi'?m\b/i.test(x) || /\b(is|was|are|were)\b/i.test(x)) ?? sentences[sentences.length - 1] ?? '');
  let said2 = false;
  const ph = phraseIn(text); const places = placesIn(text); const when = lower(text).match(WHEN)?.[1];
  // (News: said back as a question, and a reaction to it.)
  if ((NEWS.test(main) || NEWS2.test(main)) && main.split(/\s+/).length <= 12) {
    const f = flip(main);
    if (f) {
      said2 = true; const bad = BAD_NEWS.test(main);
      // (What kind of news: done something big, been somewhere or tried something, or learned something.)
      const kind = bad ? 'bad' : /\b(got|passed|won|graduated|finished|aced|landed|signed|bought|booked|adopted|completed|scored|sold|built|beat|hit|made)\b/i.test(main) ? 'win' : /\b(learned|found|figured)\b/i.test(main) ? 'learn' : 'did';
      const P2 = ph ? (ph.bare ? `the ${ph.noun}` : ph.phrase.replace(/^(a|an|some) /, 'the ')) : null;
      const react = { bad: ['Oh no', 'Noo, I\'m sorry', 'Ugh, that\'s the worst'], win: ['That\'s huge', 'Congrats!!', 'No way', 'I\'m so happy for you', 'Let\'s go'], learn: ['That\'s amazing', 'No way', 'So smart', 'Love that'], did: ['Ooh', 'No way', 'Jealous', 'Love that', 'Fun!!'] }[kind];
      const emj = { bad: ['😕', '🫂'], win: ['🎉', '🙌', '🥳', '👏'], learn: ['🤩', '👏', '🙌'], did: ['😄', '👀', '🙌', '😍'] }[kind];
      const ask = { bad: ['What happened?', 'Are you okay?', 'Want to talk about it?'], win: ['How do you feel?', 'We have to celebrate!', ...(P2 ? [`Tell me everything about ${P2}`] : [])], learn: ['Show me!!', 'How long did that take?', ...(P2 ? [`Send a video of ${P2}!`] : [])], did: ['How was it?!', 'Was it good?', 'Would you go again?', ...(P2 ? [`How was ${P2}?`] : [])] }[kind];
      out.push([`${cap(f)}?! ${pick(react, rand)} ${e(emj)} ${pick(ask, rand)}`, 10]);
    }
  }
  // (How they feel: "I'm so tired" → "So tired? Get some rest tonight".)
  const fm = lower(main).match(/\bi'?m\s+(so |really |super |kinda |kind of |pretty |very |a little |literally )?([a-z]+)\b/);
  if (fm && FEEL[fm[2]]) { const deg = (fm[1] ?? '').trim(); out.push([`${cap(deg ? `${deg} ` : '')}${fm[2]}? ${pick(FEEL[fm[2]], rand)} ${mood === 'neg' ? e(['💛', '🫂', '😕']) : e(['😊', '🙌', '😄'])}`, 10]); }
  // (What they think of something: "the weather is so nice" → "Agreed, the weather is so nice!".)
  const om = main.match(/^(?:omg |honestly |ok |okay |wow )?((?:the|this|that|my|our|today|it)\b[a-z' ]{0,24}?)\s+(is|was|are|were|looks|looked|tastes|tasted|sounds|sounded)\s+(so |really |super |kinda |pretty |very |literally )?([a-z]+)\b/i);
  if (om && !/\b(you|your)\b/i.test(om[1])) {
    said2 = true; const subj = flip(om[1]) ?? om[1]; const adj = om[4].toLowerCase(); const good = POS.test(adj) || /^(nice|beautiful|gorgeous|fun|cool|cute|delicious|insane|crazy|wild|epic)$/.test(adj);
    const lead = pick(['Agreed,', 'Right?!', 'Yes!!', 'Honestly,', 'Seriously,'], rand); const sj = /[!?]$/.test(lead) ? cap(subj.toLowerCase()) : subj.toLowerCase();
    out.push([good ? `${lead} ${sj} ${om[2].toLowerCase()} ${(om[3] ?? 'so ').trim()} ${adj}${pick(['!', '', ' 😍'], rand)} ${e(['😍', '🙌', '✨', '💯'])}`.replace(/\s+/g, ' ') : `${cap((om[3] ?? '').trim() ? `${om[3].trim()} ${adj}` : adj)}?! ${pick([`Ugh, sorry ${subj.toLowerCase()} ${om[2].toLowerCase()} like that`, 'What happened?', 'That\'s annoying'], rand)} ${e(['😕', '😩'])}`, 9]);
  }
  // (A place, and when: "Denver tomorrow?! So fun! What are you doing there?")
  if (places.length) {
    const pl = places[0];
    out.push([`${pl}${when && !/later/.test(when) ? ` ${when}` : ''}?! ${pick(['So fun', 'I\'m so jealous', `I love ${pl}`, `I've always wanted to go to ${pl}`], rand)} ${e(['😍', '✈️', '🙌'])} ${pick([`What are you doing in ${pl}?`, 'Who are you going with?', `Bring me back something from ${pl}`, 'Send pics!!'], rand)}`, 9]);
  }
  // (The thing they're talking about: said back, and something about it.)
  if (ph && !places.length && !said2) {
    const P = ph.phrase; const n = ph.noun; const P2 = ph.bare ? `the ${n}` : P.replace(/^(a|an|some) /, 'the ');
    const pool = talk?.ask?.length ? [...talk.ask, `How's ${P2}?`] : [`Tell me about ${P2}!`, `How's ${P2}?`, `Send a pic of ${P2}!`, ...(/^(the|that|those|your)\b/.test(P2) ? [`Where'd you get ${P2}?`] : [])];
    out.push([`${cap(ph.adj ? P.replace(/^(the|a|an|that|some|those|your) /, '') : P)}?! ${pick(['Love that', 'Ooh', 'No way', 'Okay I need details', 'Wait yes'], rand)} ${talk ? e(talk.e) : e(['👀', '😄', '🙌', '😍'])} ${pick(pool, rand)}`, 8]);
    if (ph.adj && /best|amazing|perfect|favorite|delicious|great|good/.test(ph.adj)) out.push([`${cap(ph.adj)} ${n} ever?! ${pick([`Okay now I want ${n === n.replace(/s$/, '') ? 'one' : 'some'}`, `I'm so jealous`, 'Take me next time'], rand)} ${e(talk?.e ?? ['😋', '🤩', '👀'])}`, 8]);
    if (ph.own) out.push([`${cap(P)}? ${pick(['Aw I love that', 'So cute', 'Okay show me'], rand)} ${e(['🥰', '😄', '👀'])}`, 6]);
  }
  // (Answering its question: the answer's own words back.)
  if (askedQ && ph) out.push([`${cap(ph.phrase)}?${ph.bare ? '!' : ''} ${mood === 'neg' ? pick(['Aw no', 'Ugh, sorry'], rand) : pick(['Love that', 'Nice!!', 'Ahh so good'], rand)} ${mood === 'neg' ? e(['😕', '🫂']) : e(['😊', '🙌', '💛'])}${talk ? ` ${pick(talk.ask, rand)}` : ''}`, 9]);
  return out;
}

/**
 * A reply from the other account to the Owner, from the conversation so far: `history` [{ mine (the Owner's),
 * text, at, post?: { caption, scene } }] oldest first. A sentence or two, with emojis that fit, never one it's
 * sent before in the chat.
 */
/**
 * Something of its own to add, about what they said: "I've been craving tacos all week", "I've always wanted to
 * go to Denver" (by topic, with their words).
 */
function addition(text, talk, rand) {
  const ph = phraseIn(text); const pl = placesIn(text)[0]; const n = ph?.noun; const r = readText(text); const id = r.topics[0]?.id;
  const pool = [];
  if (pl) return ''; // (A place: its echo says enough already.)
  if (id === 'food' && n) pool.push(`I've been craving ${n} all week`, `Okay ${n} sounds perfect right now`, `I had ${n} yesterday lol`, `Now I need ${n} too`);
  if (id === 'fitness') pool.push('I skipped the gym today, you\'re making me feel bad lol', 'You\'re inspiring me to go tomorrow');
  if (id === 'music') pool.push('I\'ve had their song stuck in my head all day', 'I need to see them live someday');
  if (id === 'pet') pool.push('I miss having a pet so much', 'Okay I need to come visit');
  if (id === 'travel' && !pl) pool.push('I need a trip so bad', 'Take me with you next time');
  if (id === 'beach') pool.push('I need a beach day so bad');
  if (id === 'game') pool.push('I\'ve been playing way too much lately too');
  if (id === 'style' && n) pool.push(`I need ${n === n.replace(/s$/, '') ? 'one' : 'some'} too`);
  return pool.length ? pick(pool, rand) : '';
}

/**
 * A reply from the other account (in its voice: `persona`) to the Owner, from the conversation: as chatReply
 * below, then said its way and leaning toward how the Owner texts in this chat. Two messages, sometimes ("\n"
 * between: sent one after the other).
 */
export function chatReplyStyled(history, { rand = Math.random, now = Date.now(), persona = 'classic', about = '' } = {}) {
  const h = (history ?? []).filter((m) => m && (m.text || m.post));
  const style = styleOf(h.filter((m) => m.mine).map((m) => m.text));
  let out = chatReply(h, { rand, now, interests: interestsOf(about) });
  // (Now and then, something from earlier in the chat brought back.)
  const theirs = h.filter((m) => m.mine && m.text); const older = theirs.slice(0, -3);
  if (older.length >= 2 && rand() < 0.14) { const old = [...older].reverse().map((m) => phraseIn(m.text)).find(Boolean); if (old && !out.toLowerCase().includes(old.noun)) out += ` ${pick([`Also still thinking about ${old.phrase} lol`, `Wait and how was ${old.phrase.replace(/^(a|an|some) /, 'the ')}?`, `Still not over ${old.phrase} btw`], rand)}`; }
  // (A fuller reply now and then: when they wrote a lot and this is short, or it doesn't ask anything, something of
  // its own and a question to keep it going.)
  const last = [...h].reverse().find((m) => m.mine)?.text ?? ''; const ints = interestsOf(about);
  if (!BYE.test(last) && moodOf(last) !== 'neg') {
    if (last.length > 70 && out.length < 70 && rand() < 0.6) out += ` ${pick(['Honestly that sounds like a lot.', 'I love hearing about this stuff.', 'Okay that\'s so interesting.', 'Wow, okay.'], rand)}`;
    if (ints.length && !/\?/.test(out) && rand() < 0.2) out += ` ${ownShare(pick(ints, rand), rand)}.`;
    if (!/\?/.test(out) && rand() < 0.35) out += ` ${pick(['What else is new with you?', 'How\'s the rest of your day going?', 'What are you up to later?', 'Anything fun this week?'], rand)}`;
  }
  out = voice(out, { persona, style, rand });
  // (Two messages: a reaction, then the rest; as people text.)
  const parts = out.split(/(?<=[.!?…]|\p{Extended_Pictographic})\s+(?=[\p{L}@])/u);
  if (parts.length >= 2 && (persona === 'hype' || persona === 'chill' || style?.short) && rand() < 0.4) out = `${parts[0]}\n${parts.slice(1).join(' ')}`;
  return out;
}

export function chatReply(history, { rand = Math.random, now = Date.now(), interests = [] } = {}) {
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
  const add = (t, w = 1, keep = false) => { if (t && !mine.has(lower(t).trim())) opts.push([t, w, keep]); };
  const e = (pool) => pick(pool, rand);
  const emo = emojisIn(text);

  // (A post shared with it: something about the post (its photo and caption), and maybe a question.)
  const shared = [...fresh].reverse().find((m) => m.post)?.post;
  if (shared) {
    const c = generateComment(shared.caption ?? '', { rand, photo: shared.scene ?? null });
    add(c, 6, true); add(`${c} ${pick(['Where was this?', 'When was this?!', 'Love it'], rand)}`, 4, true);
  }
  // (Saying goodbye.)
  if (BYE.test(text) && !shared) { const night = /night|gn/i.test(text); return `${pick(night ? ['Night!', 'Night night', 'Sleep well!', 'Good night!'] : ['Bye!!', 'Talk soon!', 'Okay ttyl!', 'See you!'], rand)} ${e(night ? ['😴', '🌙', '💛', '❤️'] : ['👋', '❤️', '💛', '😄'])}`; }
  // (Its own question just answered: to the answer.)
  const askedQ = said && !said.mine && /\?\s*\S*$/.test(said.text ?? '');
  // (A question back isn't an answer: "how are you?" after its own question is answered as a question.)
  if (askedQ && text && !BYE.test(text) && !ASK_BACK.test(text) && it !== 'howareyou' && !/\?\s*$/.test(text)) {
    const q = lower(said.text);
    const ack = mood === 'pos' ? pick(['Love that!', 'Yay!!', 'Nice!!', 'Ahh that\'s great', 'Glad to hear it!'], rand) : mood === 'neg' ? pick(['Aw no', 'Ugh, I\'m sorry', 'Oh no, that\'s rough', 'Noo'], rand) : pick(['Ohh okay', 'Got it!', 'Ah nice', 'Fair enough'], rand);
    const em = mood === 'pos' ? e(['😊', '🙌', '🥳', '💛']) : mood === 'neg' ? e(['😕', '🫂', '💛']) : e(['👍', '😄', '🙂']);
    const follow = mood === 'neg' ? pick(['Want to talk about it?', 'What happened?', 'Anything I can do?'], rand) : talk ? pick(talk.ask, rand) : /how was|how did/.test(q) ? pick(['What was the best part?', 'Tell me everything', 'Would you go again?'], rand) : '';
    add(`${ack} ${em}${follow ? ` ${follow}` : ''}`, 8);
  }
  // (Asked something back: "you?", "how are you?", "wyd".)
  if (ASK_BACK.test(text) || it === 'howareyou') {
    const doing = /\b(wyd|what are you (up to|doing)|what('?s| is) up|whats up|wbu|what about you)\b/i.test(text);
    add(doing ? `${interests.length && rand() < 0.6 ? ownDoing(pick(interests, rand), rand) : pick(DOING, rand)} ${e(['😄', '🙂', '😌', '🛋️'])}` : `${pick(FEELING, rand)} ${e(['😊', '🙂', '💛', '😄'])} ${pick(['Thanks for asking', 'What about you?', 'Busy day but good', 'Just relaxing now'], rand)}`, 10, true);
  }
  // (A plan from before, now over: how did it go?)
  const plans = plansIn(h.filter((m) => m !== undefined)).filter((p) => over(p, now) && !h.some((m) => !m.mine && m.at > p.at && lower(m.text).includes('how was')));
  if (plans.length && !askedQ && !shared) { const p = plans[plans.length - 1]; add(`${/^(hi|hey|hello|yo|hiya|heyy+|good morning|morning|gm)\b/i.test(text) ? `${pick(['Hey!!', 'Hiii!', 'Heyy!'], rand)} ` : ''}How was ${p.what}?? ${e(['👀', '😄', '🥳'])}`, 12, true); }
  // (A plan now: excited about it, and a question.)
  const now1 = plansIn(fresh)[0];
  if (now1) add(`${pick(['Ooh fun!', 'Ahh that sounds so fun', 'Nice!! Have the best time', 'Jealous!'], rand)} ${e(['🙌', '🥳', '😄'])} ${talk ? pick(talk.ask, rand) : pick(['Who\'s going?', 'What time?', 'Send pics!'], rand)}`, 7);
  // (What it's about: to the topic, often with a question to keep it going.)
  if (talk && text) add(`${pick(talk.say, rand)} ${e(talk.e)}${rand() < 0.65 ? ` ${pick(talk.ask, rand)}` : ''}`, 5);
  // (The intent: thanks, hello, a laugh, sad news… made to the conversation.)
  if (it === 'sad') add(`${pick(['Oh no, what happened?', 'Aw I\'m sorry', 'Sending hugs', 'That sounds hard'], rand)} ${e(['🫂', '💛', '😕'])}${tp ? ` ${pick(['Is it about', 'Was it the'], rand)} ${tp.nouns[0]}?` : ''}`, 6);
  if (it === 'thanks') add(`${pick(['Anytime!', 'Of course!', 'Always', 'No problem at all', 'Of course, anytime'], rand)} ${e(['😊', '❤️', '🙌', '💛'])}`, 12, true);
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
  if (mood === 'pos' && !askedQ && !ASK_BACK.test(text) && it !== 'thanks') add(`${pick(['Love that!', 'Yay!', 'That\'s awesome'], rand)} ${e(['😊', '🙌', '💛'])}`, 3);
  // (Something it was told before, asked after: a greeting, small talk, or now and then. Not what it asked after lately.)
  const facts = factsIn(h.slice(0, -2)); const theirsRecent = h.filter((m) => !m.mine).slice(-8).map((m) => lower(m.text)).join(' ');
  const fact = [...facts].reverse().find((f) => !theirsRecent.includes(lower(f.name ?? f.what)) && !lower(text).includes(lower(f.name ?? f.what)));
  if (fact && !BYE.test(text) && mood !== 'neg') {
    const q = recallLine(fact, rand);
    if (it === 'hello') add(`${pick(['Hey!!', 'Hiii!', 'Heyy!', 'Hey you!'], rand)} ${e(['👋', '😊', '💛'])} ${q}`, 9, true);
    else if (q && (it === 'chat' || it === 'yesno') && rand() < 0.35) add(`${pick(['Haha okay', 'Love that', 'Nice', 'Ha!'], rand)} ${e(['😄', '😊', '🙂'])} ${q}`, 5, true);
  }
  // (Something they said that it's into too.)
  const shared2 = interests.find((x) => lower(text).includes(x));
  if (shared2) add(`Wait, ${shared2}?! ${pick(['That\'s literally my favorite thing', 'I\'m obsessed with that', 'Okay we need to talk about this'], rand)} ${e(['🤩', '🙌', '😍'])} ${pick([`How long have you been into ${shared2}?`, 'Tell me everything', `We should do ${shared2} together sometime`], rand)}`, 11, true);
  // (Its words back come first: about what they actually said. The stock lines only when there's nothing to echo.)
  const echo = BYE.test(text) ? [] : reflect(text, { rand, mood, talk, askedQ, said });
  // (Something of its own, added to one of its echoes now and then: adding to the conversation.)
  if (echo.length && mood !== 'neg' && rand() < 0.45) {
    const ad = addition(text, talk, rand);
    const i0 = Math.floor(rand() * echo.length); const head = lower(ad).split(/\s+/).slice(0, 4).join(' ');
    if (ad && !lower(echo[i0][0]).includes(head)) {
      const i = i0; const t0 = echo[i][0];
      // (Before its question, as a sentence of its own; else at the end.)
      const parts = t0.split(/(?<=[.!?]|\p{Extended_Pictographic})\s+(?=[\p{Lu}@])/u);
      const txt = parts.length > 1 && /\?$/.test(parts[parts.length - 1]) ? [...parts.slice(0, -1), `${ad}.`, parts[parts.length - 1]].join(' ') : `${t0} ${ad}.`;
      echo[i] = [txt, echo[i][1] + 1];
    }
  }
  if (echo.length) { for (const o of opts) if (!o[2]) o[1] *= 0.05; for (const [t, w] of echo) { if (t && !mine.has(lower(t).trim())) opts.push([t, w, true]); } }
  // (The general ones: only now and then when there's something better.)
  const gw = opts.some(([, w]) => w >= 5) ? 0 : opts.length ? 0.12 : 1;
  for (const g of ['Haha nice', 'Oh really? Tell me more!', 'Love that', 'Wait what', 'Omg', 'Same honestly', 'That\'s so true']) add(`${g} ${emo.length && rand() < 0.5 ? pick(emo, rand) : e(['😄', '😊', '🙂', '👀'])}`, gw);
  if (!opts.length) return pick(['Haha', 'Okay!', 'Nice', 'Ooh'], rand) + ' ' + e(['😄', '🙂']);
  // (Not opening the way it did lately, nor asking what it's asked already.)
  const recent = h.filter((m) => !m.mine).slice(-5).map((m) => lower(m.text));
  const openOf = (t2) => lower(t2).replace(/[^\p{L}\p{N} ]+/gu, '').split(/\s+/).slice(0, 2).join(' ');
  const asked = new Set(recent.flatMap((t2) => t2.match(/[^.!?]*\?/g) ?? []).map((q) => q.trim()));
  for (const o of opts) { if (recent.some((t2) => openOf(t2) === openOf(o[0]))) o[1] *= 0.15; const q = lower(o[0]).match(/[^.!?]*\?$/)?.[0]?.trim(); if (q && asked.has(q)) o[1] *= 0.1; }
  const total = opts.reduce((a, [, w]) => a + w, 0); let x = rand() * total;
  for (const [t, w] of opts) { x -= w; if (x <= 0) return t.replace(/\s+/g, ' ').trim(); }
  return opts[opts.length - 1][0].replace(/\s+/g, ' ').trim();
}

// ---- Replies to comments: the post's account answering a comment on its post, as people do: thanks for a
// compliment (warmer the warmer it was), an answer to a question (where, who, when), banter back for a tease,
// something about what they named ("the pizza was unreal honestly"), the commenter @mentioned now and then.

const PRAISE = /\b(everything|hits|yum+|delicious|looks (so )?good|so good|need|want|jealous|dream|cozy|chef|living|serving|ate|clean|crisp|fresh|love|loving|cute|gorgeous|beautiful|stunning|amazing|iconic|fire|obsessed|perfect|pretty|hot|best|goals|incredible|unreal|slay|queen|king|legend|wow|yes+|congrats|congratulations|proud|vibes?)\b|[🔥😍🥰😻💯✨🙌👏🥹❤️💛💕]/iu;
const TEASE = /\b(jealous|show ?off|rude|unfair|invite|without me|where was my|save me|stop it)\b|😤|🙄/i;
const THINGS = /\b(pizza|burger|coffee|dog|pup|puppy|cat|kitty|beach|view|sunset|mountains?|lake|outfit|fit|dress|suit|shoes|sneakers|shades|hair|cake|food|car|game|concert|city|trip|hike|snow|hat|jacket)\b/i;

/**
 * The post's account's reply to a comment: `comment` (its text), `commenter` (their handle), `caption`.
 * Plain words (made the account's own with voice/spice by the caller).
 */
export function commentReply(comment, { commenter = '', caption = '', rand = Math.random } = {}) {
  const t = String(comment ?? '').trim(); const lt = lower(t); const mood = moodOf(t);
  const at = commenter && rand() < 0.55 ? `@${commenter} ` : '';
  const thing = (lt.match(THINGS) ?? lower(caption).match(THINGS))?.[1];
  const q = /\?/.test(t) || /^(where|who|when|how|what|did|can|is|are|do)\b/i.test(t);
  if (q) {
    if (/\bwhere\b/i.test(t)) { const place = placesIn?.(`${caption} ${t}`)?.[0]; return `${at}${place ? pick([`${place}!!`, `In ${place} 📍`, `${place}, you'd love it`], rand) : pick(['Secret spot 🤫 I\'ll take you', 'I\'ll text you the spot!', 'Tell you later 👀'], rand)}`; }
    if (/\bwho\b.*\b(took|shot|snapped)\b/i.test(t)) return `${at}${pick(['Self timer for the win 📸', 'My roommate! Hired as my photographer now', 'A very patient friend 😂'], rand)}`;
    if (/\bwho\b/i.test(t)) return `${at}${pick(['My favorite people 💛', 'The best crew', 'Haha you know who 👀'], rand)}`;
    if (/\bwhen\b/i.test(t)) return `${at}${pick(['Last weekend!', 'Just the other day', 'Yesterday!! Still thinking about it'], rand)}`;
    if (/\b(invite|come|next time|join)\b/i.test(t)) return `${at}${pick(['Next time, you\'re coming 🙌', 'Obviously!! Next time', 'Say less, you\'re in'], rand)}`;
    if (/\b(how was|was it good|fun)\b/i.test(t)) return `${at}${pick([`So good${thing ? `, the ${thing} especially` : ''}!!`, 'Honestly the best day', 'Even better than it looks'], rand)}`;
    const r = chatReply([{ mine: true, text: t, at: Date.now() }], { rand });
    return `${at}${r}`;
  }
  if (TEASE.test(t)) return `${at}${pick(['Haha next time I promise 😂', 'You\'re coming next time, no excuses', 'Don\'t be jealous 😌', 'I\'ll make it up to you'], rand)}`;
  if (mood === 'pos' || PRAISE.test(t)) {
    const big = (t.match(/!|🔥|😍|🥹|❤️|💛|✨/gu) ?? []).length >= 2 || /\b(obsessed|stunning|iconic|legend|incredible|queen|king)\b/i.test(t);
    if (/\bcongrat/i.test(t)) return `${at}${pick(['Thank you so much!! 🥹', 'Thank youuu, means a lot 💛', 'Couldn\'t have done it without you!!'], rand)}`;
    if (thing && (THINGS.test(lt) || rand() < 0.5)) return `${at}${pick([`Thank you!! The ${thing} was unreal honestly`, `Right?! The ${thing} made the day`, `The ${thing} deserves all the credit 😂`], rand)}`;
    return `${at}${big ? pick(['Stop it 🙈 thank you!!', 'You\'re too sweet 🥹', 'Okay you just made my day 💛', 'Ahh thank youuu'], rand) : pick(['Thank you!!', 'Thanks!! 😊', 'Appreciate you 💛', 'Haha thank you'], rand)}`;
  }
  if (mood === 'neg') return `${at}${pick(['Aw, I know 😕', 'Haha it wasn\'t that bad', 'Lol fair'], rand)}`;
  // (Anything else: agreed, warmly, with what they named when there's one.)
  return `${at}${thing ? pick([`Right?! The ${thing} 🙌`, `The ${thing} was everything honestly`, `Haha the ${thing} really did that`], rand) : pick(['Haha right?!', 'Facts 😂', 'You get it 🙌', 'Literally', 'Exactly what I said'], rand)}`;
}
