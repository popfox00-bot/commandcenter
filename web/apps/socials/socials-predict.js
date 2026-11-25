// Socials' text predictor: comments made for a post (from its caption, hashtags and emojis) and replies made
// for a message (to what it says and how). All on the phone, offline: no model to download, nothing sent
// anywhere. It reads what the text is about (a beach, food, a birthday, a pet, a trip, a workout…), what kind
// of message it is (a question, thanks, a plan, a joke, sad news, a compliment, hello) and the emojis in it,
// and puts together something fitting from many phrasings, with the emojis matched. `rand` for tests.

import { PLACES } from '../../lib/places.js';

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length) % arr.length];

/** The emojis in a text, each once, in order. */
export const emojisIn = (t) => [...new Set(String(t ?? '').match(/\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|️)*/gu) ?? [])];

// Topics: words that say it, ways to talk about it, emojis that go with it.
const TOPICS = [
  { id: 'beach', words: ['beach', 'ocean', 'sea', 'waves', 'surf', 'sand', 'coast', 'shore', 'island', 'tropical', 'pier', 'swim', 'pool', 'summer'], emoji: ['🌊', '🏖️', '☀️', '🐚'], nouns: ['beach day', 'view', 'water', 'ocean'], adj: ['dreamy', 'unreal', 'so peaceful', 'paradise'] },
  { id: 'sunset', words: ['sunset', 'sunrise', 'golden', 'sky', 'dusk', 'dawn', 'horizon'], emoji: ['🌅', '🌇', '✨', '🧡'], nouns: ['sky', 'sunset', 'colors', 'light'], adj: ['breathtaking', 'magical', 'gorgeous', 'unreal'] },
  { id: 'food', words: ['food', 'dinner', 'lunch', 'breakfast', 'brunch', 'pizza', 'burger', 'pasta', 'sushi', 'tacos', 'cake', 'coffee', 'latte', 'dessert', 'cooking', 'baked', 'recipe', 'restaurant', 'yum', 'delicious', 'chef', 'snack', 'icecream', 'ice cream'], emoji: ['😋', '🤤', '🍽️', '👨‍🍳'], nouns: ['food', 'plate', 'dish', 'meal'], adj: ['delicious', 'so good', 'amazing', 'mouthwatering'] },
  { id: 'birthday', words: ['birthday', 'bday', 'cake', 'candles', 'turning', 'celebrate', 'celebrating', 'party'], emoji: ['🎉', '🎂', '🥳', '🎈'], nouns: ['celebration', 'party', 'day'], adj: ['so fun', 'the best', 'perfect'] },
  { id: 'pet', words: ['dog', 'puppy', 'pup', 'cat', 'kitten', 'kitty', 'pet', 'doggo', 'pupper', 'furry', 'paws'], emoji: ['🐶', '🐱', '🥰', '🐾'], nouns: ['baby', 'fluffball', 'cutie'], adj: ['adorable', 'so cute', 'precious', 'the cutest'] },
  { id: 'travel', words: ['travel', 'trip', 'vacation', 'holiday', 'adventure', 'explore', 'exploring', 'city', 'flight', 'airport', 'abroad', 'road', 'roadtrip', 'wanderlust', 'paris', 'london', 'tokyo', 'italy', 'mountains', 'hike', 'hiking', 'trail', 'camping', 'lake', 'forest', 'park'], emoji: ['✈️', '🌍', '🏔️', '🗺️'], nouns: ['trip', 'adventure', 'place', 'view'], adj: ['incredible', 'stunning', 'a dream', 'epic'] },
  { id: 'fitness', words: ['gym', 'workout', 'run', 'running', 'training', 'fitness', 'lift', 'lifting', 'yoga', 'marathon', 'gains', 'sweat', 'cardio', 'pr'], emoji: ['💪', '🔥', '🏃', '🏋️'], nouns: ['progress', 'workout', 'dedication'], adj: ['inspiring', 'strong', 'unstoppable', 'impressive'] },
  { id: 'style', words: ['outfit', 'ootd', 'dress', 'style', 'fashion', 'look', 'shoes', 'fit', 'jacket', 'hair', 'makeup', 'nails', 'glam', 'selfie'], emoji: ['😍', '🔥', '💅', '✨'], nouns: ['look', 'outfit', 'style', 'fit'], adj: ['stunning', 'iconic', 'gorgeous', 'flawless'] },
  { id: 'friends', words: ['friends', 'friend', 'bestie', 'besties', 'squad', 'crew', 'together', 'family', 'fam', 'sister', 'brother', 'mom', 'dad', 'love'], emoji: ['🥰', '❤️', '🤗', '👯'], nouns: ['crew', 'people', 'squad', 'memories'], adj: ['the best', 'so sweet', 'goals', 'precious'] },
  { id: 'nature', words: ['flowers', 'flower', 'garden', 'bloom', 'spring', 'trees', 'leaves', 'autumn', 'fall', 'snow', 'winter', 'rain', 'nature', 'sun'], emoji: ['🌸', '🌿', '🍂', '❄️'], nouns: ['view', 'colors', 'scenery'], adj: ['beautiful', 'so pretty', 'peaceful', 'lovely'] },
  { id: 'music', words: ['music', 'concert', 'song', 'band', 'festival', 'dj', 'show', 'guitar', 'singing', 'dance', 'dancing'], emoji: ['🎶', '🎤', '🎸', '🕺'], nouns: ['show', 'vibes', 'night'], adj: ['electric', 'so fun', 'legendary', 'amazing'] },
  { id: 'art', words: ['art', 'painting', 'drawing', 'sketch', 'design', 'photo', 'photography', 'shot', 'edit', 'creative', 'build', 'made', 'handmade', 'craft'], emoji: ['🎨', '📸', '👏', '✨'], nouns: ['work', 'shot', 'piece', 'talent'], adj: ['so talented', 'incredible', 'beautiful', 'next level'] },
  { id: 'win', words: ['win', 'won', 'graduated', 'graduation', 'promotion', 'job', 'achievement', 'finally', 'done', 'finished', 'proud', 'congrats', 'milestone', 'first'], emoji: ['🎉', '🙌', '🏆', '👏'], nouns: ['achievement', 'moment', 'milestone'], adj: ['so well deserved', 'huge', 'amazing'] },
  { id: 'game', words: ['game', 'gaming', 'minecraft', 'play', 'playing', 'level', 'build', 'world', 'stream'], emoji: ['🎮', '🔥', '🙌', '😎'], nouns: ['build', 'setup', 'game'], adj: ['insane', 'so cool', 'epic', 'sick'] },
];
const GENERAL = { emoji: ['😍', '🔥', '✨', '👏', '❤️', '🙌', '💯', '🥰'], nouns: ['post', 'pic', 'shot', 'moment'], adj: ['amazing', 'gorgeous', 'so good', 'perfect', 'iconic', 'stunning'] };

const STOP = new Set('the a an and or but of to in on at for with from this that these those is are was were be been am im i me my mine you your yours we our us they them their it its so just very really too what when where who why how all any some more most much many can could would should will shall do does did done have has had not no yes yeah ok okay like get got go going went here there then than also about into out up down over again new day today time one'.split(' '));

/** What a text is about: its topics (best match first), the words that say so, its hashtags and its emojis. */
export function readText(text) {
  const t = String(text ?? ''); const low = t.toLowerCase();
  const tags = [...low.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]);
  const words = (low.replace(/#/g, ' ').match(/[\p{L}\p{N}']+/gu) ?? []).map((w) => w.replace(/'s$/, ''));
  const all = [...words, ...tags.flatMap((x) => x.split('_'))];
  const score = TOPICS.map((tp) => ({ tp, n: all.filter((w) => tp.words.includes(w)).length + (low.includes('ice cream') && tp.id === 'food' ? 1 : 0) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const keywords = [...new Set(all.filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w)))];
  return { topics: score.map((x) => x.tp), keywords, tags, emojis: emojisIn(t) };
}

/** Emojis for a reply: some of the text's own (the reply mirrors them), else its topic's, else general ones. */
function emojiFor(r, rand, max = 2) {
  const pool = r.emojis.length ? r.emojis : r.topics[0]?.emoji ?? GENERAL.emoji;
  const n = 1 + Math.floor(rand() * max); const out = [];
  for (let i = 0; i < n; i++) out.push(pick(pool, rand));
  return [...new Set(out)].join('');
}

/** Places named in a text (as people write them: "Denver", "New York", "Tokyo"), each once. */
const PLACE_NAMES = [...new Set(PLACES.flatMap(([n]) => n.replace(/\)/g, '').split(/\s*[(,]\s*/)).filter((n) => n.length > 2 && !/^(UTC|US|Georgia)$/.test(n)))];
export function placesIn(text) {
  const t = String(text ?? '');
  return PLACE_NAMES.filter((n) => new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu').test(t));
}

// (Words after "my", "the", "this"…: likely what the post shows ("my new car" → car); not these.)
const NOT_NOUN = new Set('half full rest end top bottom start best last other same whole little big good great only first next most very real favorite favourite fave final perfect beautiful amazing lovely sweet cute crazy little long short entire usual'.split(' '));
/** The things a caption says it shows: "Finally got my new bike" → ['bike']. */
export function thingsIn(text) {
  const low = String(text ?? '').toLowerCase().replace(/#[\p{L}\p{N}_]+/gu, ' ');
  const out = [];
  for (const m of low.matchAll(/\b(?:my|our|the|this|that|these|a|an|new|his|her|their)\s+(?:(?:new|little|first|favorite|favourite|own|big|lil|best|perfect|cutest|cute|cozy|fancy)\s+)?([a-z]{3,14})\b/g)) {
    const w = m[1]; if (!STOP.has(w) && !NOT_NOUN.has(w) && !/(ly|ing|ed)$/.test(w) && !out.includes(w)) out.push(w);
  }
  return out;
}

const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`; };

/** What a caption counts: a birthday's age, years of something, a race's distance ({ age, years, km }). */
export function numbersIn(text) {
  const low = String(text ?? '').toLowerCase(); const out = {};
  const age = low.match(/\b(?:turn(?:ing|ed|s)?|turned)\s+(\d{1,3})\b/) ?? low.match(/\b(\d{1,3})(?:st|nd|rd|th)\s+(?:birthday|bday)\b/) ?? low.match(/\b(?:birthday|bday)\s*#?\s*(\d{1,3})\b/);
  if (age && +age[1] > 0 && +age[1] < 120) out.age = +age[1];
  const yrs = low.match(/\b(\d{1,2})\s+years?\b/) ?? low.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+anniversary\b/);
  if (yrs && +yrs[1] > 0) out.years = +yrs[1];
  const km = low.match(/\b(\d{1,3}(?:\.\d)?)\s*k\b(?!\s*(?:followers|views|likes))/) ?? (/\bhalf marathon\b/.test(low) ? [0, '21.1'] : /\bmarathon\b/.test(low) ? [0, '42.2'] : null);
  if (km) out.km = km[1];
  return out;
}

/** Whether a caption asks something (its viewers are to answer). */
export const asks = (text) => /\?\s*(\p{Extended_Pictographic}|\s)*$|\b(which one|what do you think|thoughts\?|should i|would you|or\b.*\?)/iu.test(String(text ?? ''));

/**
 * A comment for a post, from its caption: about what it shows, in a few words, with fitting emojis, made for
 * that caption: its hashtags, the places and things it names, what it counts (an age, years, a distance),
 * a question it asks, and the accounts tagged in it. `tagged`: their handles; `as`: the handle commenting
 * (tagged itself: it says so). `avoid`: comments already on it (not said again).
 */
export function generateComment(caption, { rand = Math.random, avoid = [], tagged = [], as = '' } = {}) {
  const r = readText(caption); const tp = r.topics[0]; const T = tp ?? GENERAL;
  const noun = pick(T.nouns, rand); const adj = pick(T.adj, rand); const e = () => emojiFor(r, rand);
  const forms = [
    () => `This ${noun} is ${adj} ${e()}`, () => `${cap(adj)}! ${e()}`, () => `Obsessed with this ${noun} ${e()}`, () => `Wow, ${adj} ${e()}`,
    () => `Okay this is ${adj} ${e()}`, () => `Need more of this ${e()}`, () => `${cap(adj)} as always ${e()}`, () => `Love love love this ${e()}`,
  ];
  // (Made for this caption: likelier than anything general.)
  const own = [];
  // (A word from the caption only when it says what's in it (a topic's word): "Love the pizza", never "Love the random".)
  const kw = tp ? r.keywords.find((w) => tp.words.includes(w) && w.length < 16 && !['birthday', 'bday', 'celebrate', 'celebrating', 'turning', 'finally', 'done', 'first', 'love', 'summer', 'winter', 'spring', 'fall', 'autumn'].includes(w)) : null;
  if (kw) own.push(() => `Love the ${kw} ${e()}`, () => `That ${kw} though ${e()}`);
  const things = thingsIn(caption).filter((w) => w !== kw);
  if (things.length) { const th = () => pick(things, rand); own.push(() => `Love the ${th()} ${e()}`, () => `Obsessed with the ${th()} ${e()}`, () => `That ${th()} is ${adj} ${e()}`); }
  const places = placesIn(caption);
  if (places.length) { const pl = () => pick(places, rand); own.push(() => `${pl()} looks ${pick(['amazing', 'unreal', 'so good on you', 'like a dream', 'incredible'], rand)} ${e()}`, () => `Missing ${pl()} so much ${e()}`, () => `${pl()}!! Take me with you next time ${e()}`, () => `Enjoy ${pl()}! ${e()}`); }
  const n = numbersIn(caption);
  if (n.age) own.push(() => `Happy ${ordinal(n.age)}!! ${e()}`, () => `${n.age} looks good on you ${e()}`, () => `Happy ${ordinal(n.age)} birthday! Have the best year ${e()}`);
  if (n.years && !n.age) own.push(() => `${n.years} year${n.years === 1 ? '' : 's'}!! Congrats ${e()}`, () => `Here's to ${n.years} more ${e()}`);
  if (n.km) own.push(() => `${n.km}k?! Legend ${e()}`, () => `Crushing that ${n.km}k ${e()}`);
  if (asks(caption)) {
    const opts = String(caption).match(/\b([\p{L}]+)\s+or\s+([\p{L}]+)\b[^?]*\?/iu);
    own.push(...(opts ? [() => `${cap(opts[2].toLowerCase())}, no question ${e()}`, () => `${cap(opts[1].toLowerCase())} all the way ${e()}`, () => `Team ${opts[pick([1, 2], rand)].toLowerCase()} ${e()}`] : /which one|which\b/i.test(caption) ? [() => `The first one for sure ${e()}`, () => `Second one!! ${e()}`] : [() => `Definitely yes!! ${e()}`, () => `Honestly? Go for it ${e()}`, () => `100% do it ${e()}`]));
  }
  if (r.tags.length) {
    // (Its hashtags: the ones that say what it's about first.)
    const best = r.tags.filter((t) => tp?.words.some((w) => t.includes(w))); const tg = () => pick(best.length ? best : r.tags, rand);
    own.push(() => `#${tg()} indeed ${e()}`, () => `The #${tg()} energy here ${e()}`, () => `Peak #${tg()} ${e()}`, () => `Living for the #${tg()} content ${e()}`);
  }
  // (The people tagged: now and then.)
  const people = [];
  const handles = [...new Set(tagged.filter(Boolean).map((h) => String(h).replace(/^@/, '')))];
  const me = String(as ?? '').replace(/^@/, '');
  if (me && handles.includes(me)) people.push(() => `Thanks for the tag! ${e()}`, () => `So glad I was there for this ${e()}`, () => `Best day with you ${e()}`);
  const others = handles.filter((h) => h !== me);
  if (others.length) { const h = () => pick(others, rand); people.push(() => `@${h()} you two!! ${e()}`, () => `@${h()} look at this ${e()}`, () => `Love seeing you with @${h()} ${e()}`); }
  // (By topic: what someone would say to it.)
  const byTopic = {
    beach: [() => `Take me with you next time ${e()}`, () => `I can almost hear the waves ${e()}`],
    sunset: [() => `That sky is unreal ${e()}`, () => `Golden hour hits different ${e()}`],
    food: [() => `Save me a bite! ${e()}`, () => `Recipe please ${e()}`, () => `Now I'm hungry ${e()}`],
    birthday: [() => `Happy birthday!! ${e()}`, () => `Happiest birthday! Hope it was the best ${e()}`],
    pet: [() => `I need to meet this cutie ${e()}`, () => `Give them a hug from me ${e()}`],
    travel: [() => `Where is this?? ${e()}`, () => `Adding this to my list ${e()}`, () => `Living the dream ${e()}`],
    fitness: [() => `Putting in the work! ${e()}`, () => `Goals right here ${e()}`],
    style: [() => `Where's that from?! ${e()}`, () => `Serving looks ${e()}`, () => `This fit!! ${e()}`],
    friends: [() => `Love you guys ${e()}`, () => `Best crew ${e()}`],
    nature: [() => `So peaceful ${e()}`, () => `Nature is the best ${e()}`],
    music: [() => `Wish I was there! ${e()}`, () => `What a night ${e()}`],
    art: [() => `You're so talented ${e()}`, () => `This is next level ${e()}`],
    win: [() => `Congrats!! So proud of you ${e()}`, () => `You deserve this! ${e()}`],
    game: [() => `This build is insane ${e()}`, () => `How long did this take?! ${e()}`],
  };
  const topical = (tp && byTopic[tp.id]) || [];
  // (A place named: "Where is this??" makes no sense.)
  const fit = places.length ? topical.filter((f) => !/Where is this/.test(f())) : topical;
  forms.push(...fit, ...fit, ...own, ...own, ...own, ...people);
  const said = new Set(avoid.map((a) => String(a).trim().toLowerCase()));
  for (let i = 0; i < 20; i++) { const c = pick(forms, rand)().replace(/\s+/g, ' ').trim(); if (!said.has(c.toLowerCase())) return c; }
  return pick(forms, rand)().replace(/\s+/g, ' ').trim();
}

/** `n` different comments for a post (as `generateComment`; `as`: who says each, by turn). */
export function generateComments(caption, n, { rand = Math.random, avoid = [], tagged = [], as = [] } = {}) {
  const out = []; const seen = [...avoid];
  for (let i = 0; i < n; i++) { const c = generateComment(caption, { rand, avoid: seen, tagged, as: as[i] ?? '' }); out.push(c); seen.push(c); }
  return out;
}

// What kind of message: checked in order, the first that fits answers.
const INTENTS = [
  { id: 'sad', test: /\b(sad|sorry|bad day|rough|tired|sick|miss you|upset|lonely|crying|awful|terrible|stressed)\b|😢|😭|😔|💔|😞/i, replies: ['Oh no, are you okay? 💛', 'Sending hugs 🫂', 'I\'m here if you want to talk ❤️', 'Aw that sounds hard, I\'m sorry 💛', 'Want to talk about it? I\'m here 🤗'] },
  { id: 'thanks', test: /\b(thanks|thank you|thx|ty|appreciate)\b|🙏/i, replies: ['Anytime! 😊', 'Of course! ❤️', 'No problem at all 🙌', 'Always 💛', 'You\'re welcome! 😊'] },
  { id: 'howareyou', test: /\b(how are you|how r u|how's it going|how are things|what's up|whats up|wyd|what are you up to|how have you been)\b/i, replies: ['I\'m good! How about you? 😊', 'Pretty good, just relaxing. You? 🙂', 'Not bad at all! What are you up to? 😄', 'Doing great! Busy day but good 💪 You?'] },
  { id: 'hello', test: /^(hi|hey|hello|yo|hiya|heyy+|sup|good morning|morning|good night|gm|gn)\b/i, replies: ['Hey! 👋', 'Hiii 😊', 'Heyyy! What\'s up? 😄', 'Hey you! 💛', 'Hi!! How\'s your day going? 😊'] },
  { id: 'plan', test: /\b(tonight|tomorrow|this weekend|weekend|later|dinner|lunch|hang out|hangout|meet up|come over|movie|party|plans|free (on|this|tomorrow|tonight)|want to go|wanna go|let's go)\b/i, replies: ['I\'m in! What time? 🙌', 'Yes! Sounds fun 😄', 'Count me in! 🎉', 'Ooh I\'d love to, where? 😊', 'Let\'s do it! 🙌'] },
  { id: 'love', test: /\b(love you|luv you|ily|miss you)\b|❤️|💕|🥰|😘/i, replies: ['Love you too! ❤️', 'Aww 🥰', '❤️❤️', 'Miss you more! 💕'] },
  { id: 'compliment', test: /\b(you look|you're so|youre so|so pretty|gorgeous|beautiful|amazing job|proud of you|you're the best|great job|nice job|well done|congrats|congratulations)\b/i, replies: ['Aww thank you 🥰', 'Stop it, you\'re too sweet 😊', 'That means a lot! ❤️', 'You\'re the best 🥹', 'Thank you so much! 💛'] },
  { id: 'laugh', test: /\b(lol|lmao|haha+|hehe|rofl|funny|joke)\b|😂|🤣|😆/i, replies: ['😂😂 right?!', 'Hahaha stop 😂', 'I can\'t 🤣', 'LOL 😂', 'Dying 💀😂'] },
  { id: 'yesno', test: /^(are|do|did|can|could|will|would|should|is|have|has|was|were|want|wanna)\b.*\?$/i, replies: ['Yeah, for sure! 😊', 'Hmm maybe! 🤔', 'Yes!! 🙌', 'I think so! 😄', 'Probably not today, but soon! 🙂', 'Definitely 👍'] },
  { id: 'question', test: /\?\s*$|^(what|where|when|why|how|who|which)\b/i, replies: ['Good question, I\'m not sure yet 🤔', 'Hmm let me think… what do you think? 😊', 'Honestly no idea 😅', 'I\'ll let you know soon! 👍', 'Ooh I have to check, give me a sec 🙂'] },
  { id: 'excited', test: /!{2,}|\b(omg|oh my god|wow|guess what|can't wait|cant wait|so excited|yay)\b|🎉|🥳|🤩/i, replies: ['No way!! 🤩', 'OMG yes!! 🎉', 'Ahh that\'s amazing! 🥳', 'I\'m so happy for you! 🙌', 'Wait really?! Tell me everything 😄'] },
];

/** What kind of message it is (its intent id), or 'chat'. */
export function intentOf(message) {
  const t = String(message ?? '').trim();
  return INTENTS.find((x) => x.test.test(t))?.id ?? 'chat';
}

/** A reply to a message: to what it says, in its tone, with its emojis matched. */
export function generateReply(message, { rand = Math.random } = {}) {
  const t = String(message ?? '').trim(); const r = readText(t); const it = INTENTS.find((x) => x.test.test(t));
  let out;
  if (it) out = pick(it.replies, rand);
  else {
    const tp = r.topics[0]; const kw = r.keywords[0];
    const forms = [
      () => `That sounds ${pick(tp?.adj ?? ['fun', 'awesome', 'great', 'cool'], rand)}!`, () => 'Haha nice 😄', () => 'Oh really? Tell me more!', () => 'Love that 😊',
      ...(kw && kw.length < 16 ? [() => `Wait, ${kw}? Tell me more 👀`, () => `Ooh ${kw}! That's so ${pick(tp?.adj ?? ['cool', 'fun', 'nice'], rand)}`] : []),
      ...(tp ? [() => `${cap(pick(tp.adj, rand))}! ${pick(tp.emoji, rand)}`] : []),
    ];
    out = pick(forms, rand)();
  }
  // (Their emojis back, when the reply has none of its own.)
  if (!emojisIn(out).length && (r.emojis.length || rand() < 0.5)) out += ` ${emojiFor(r, rand, 1)}`;
  return out.replace(/\s+/g, ' ').trim();
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
