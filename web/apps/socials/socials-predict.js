// Socials' text predictor: comments made for a post (from its caption, hashtags and emojis) and replies made
// for a message (to what it says and how). All on the phone, offline: no model to download, nothing sent
// anywhere. It reads what the text is about (a beach, food, a birthday, a pet, a trip, a workout…), what kind
// of message it is (a question, thanks, a plan, a joke, sad news, a compliment, hello) and the emojis in it,
// and puts together something fitting from many phrasings, with the emojis matched. `rand` for tests.

import { PLACES } from '../../lib/places.js';
import { voice, personaOf } from './socials-style.js';

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
  { id: 'friends', words: ['friends', 'friend', 'bestie', 'besties', 'squad', 'crew', 'together', 'family', 'fam', 'sister', 'brother', 'mom', 'dad', 'love'], emoji: ['🥰', '❤️', '🤗', '👯'], nouns: ['crew', 'squad', 'group'], adj: ['the best', 'so sweet', 'goals', 'precious'] },
  { id: 'nature', words: ['flowers', 'flower', 'garden', 'bloom', 'spring', 'trees', 'leaves', 'autumn', 'fall', 'snow', 'winter', 'rain', 'nature', 'sun'], emoji: ['🌸', '🌿', '🍂', '❄️'], nouns: ['view', 'colors', 'scenery'], adj: ['beautiful', 'so pretty', 'peaceful', 'lovely'] },
  { id: 'music', words: ['music', 'concert', 'song', 'band', 'festival', 'dj', 'show', 'guitar', 'singing', 'dance', 'dancing'], emoji: ['🎶', '🎤', '🎸', '🕺'], nouns: ['show', 'vibes', 'night'], adj: ['electric', 'so fun', 'legendary', 'amazing'] },
  { id: 'art', words: ['art', 'painting', 'drawing', 'sketch', 'design', 'photo', 'photography', 'shot', 'edit', 'creative', 'build', 'made', 'handmade', 'craft'], emoji: ['🎨', '📸', '👏', '✨'], nouns: ['work', 'shot', 'piece', 'talent'], adj: ['so talented', 'incredible', 'beautiful', 'next level'] },
  { id: 'win', words: ['win', 'won', 'graduated', 'graduation', 'promotion', 'job', 'achievement', 'finally', 'done', 'finished', 'proud', 'congrats', 'milestone', 'first'], emoji: ['🎉', '🙌', '🏆', '👏'], nouns: ['achievement', 'moment', 'milestone'], adj: ['so well deserved', 'huge', 'amazing'] },
  { id: 'car', words: ['car', 'truck', 'jeep', 'ride', 'drive', 'driving', 'motorcycle', 'wheels', 'convertible'], emoji: ['🚗', '🏎️', '🔥', '😎'], nouns: ['ride', 'car', 'wheels'], adj: ['so clean', 'sick', 'a beauty', 'gorgeous'] },
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

// ---- What a photo shows (socials-vision.js reads it, socials-scene.js works out its people and background),
// as facts to talk about: each with how specific it is (the more, the likelier it's what's said and the
// caption), its emojis, things to say to it and captions for it.

// What the classifier's labels (ImageNet's names) are: { re, kind, topic, name } (name '' : not named).
const L = (re, kind, topic, name = '') => ({ re, kind, topic, name });
const LABELS = [
  L(/\b(retriever|terrier|spaniel|poodle|shepherd|hound|collie|corgi|pug|beagle|husky|chihuahua|dachshund|bulldog|labrador|schnauzer|setter|pointer|malamute|samoyed|pomeranian|shih-tzu|maltese|papillon|boxer|rottweiler|doberman|dalmatian|great dane|mastiff|newfoundland|pinscher|vizsla|weimaraner|basset|bloodhound|whippet|greyhound|chow|sheepdog|bernese|saint bernard|keeshond|pekinese|lhasa|basenji|spitz|pyrenees|kelpie|borzoi|wolfhound|coonhound|foxhound|brittany|griffon|yorkshire|pembroke|bichon|havanese|cocker)\b/, 'pet', 'pet', 'dog'),
  L(/\b(tabby|tiger cat|persian cat|siamese cat|egyptian cat)\b/, 'pet', 'pet', 'cat'),
  L(/\b(pizza)\b/, 'food', 'food', 'pizza'), L(/\b(cheeseburger)\b/, 'food', 'food', 'burger'), L(/\b(hotdog|hot dog)\b/, 'food', 'food', 'hot dog'), L(/\b(ice cream|ice lolly)\b/, 'food', 'food', 'ice cream'),
  L(/\b(espresso|coffee mug)\b/, 'food', 'food', 'coffee'), L(/\b(burrito)\b/, 'food', 'food', 'burrito'), L(/\b(bagel)\b/, 'food', 'food', 'bagel'), L(/\b(pretzel)\b/, 'food', 'food', 'pretzel'), L(/\b(guacamole)\b/, 'food', 'food', 'guac'),
  L(/\b(carbonara)\b/, 'food', 'food', 'pasta'), L(/\b(trifle|chocolate sauce|custard)\b/, 'food', 'food', 'dessert'), L(/\b(red wine|wine bottle)\b/, 'food', 'food', 'wine'), L(/\b(beer glass|beer bottle)\b/, 'food', 'food', 'beer'),
  L(/\b(strawberry|pineapple|banana|pomegranate|fig)\b/, 'food', 'food'), L(/\b(plate|meat loaf|french loaf|potpie|hot pot|consomme|mashed potato|bakery|restaurant|dough|waffle iron|frying pan|wok)\b/, 'food', 'food'),
  L(/\b(seashore|sandbar|coral reef)\b/, 'beach', 'beach', 'beach'), L(/\b(snorkel|scuba diver|catamaran|paddle)\b/, 'beach', 'beach'),
  L(/\b(alp)\b/, 'mountain', 'travel', 'mountains'), L(/\b(volcano)\b/, 'mountain', 'travel', 'volcano'), L(/\b(valley)\b/, 'mountain', 'travel', 'valley'), L(/\b(cliff|promontory)\b/, 'mountain', 'travel', 'cliffs'),
  L(/\b(lakeside)\b/, 'lake', 'travel', 'lake'), L(/\b(castle|palace)\b/, 'sight', 'travel', 'castle'), L(/\b(suspension bridge|steel arch bridge|viaduct)\b/, 'sight', 'travel', 'bridge'),
  L(/\b(geyser|dock|boathouse|monastery|church|mosque|triumphal arch|airliner|liner|canoe|mountain tent|obelisk)\b/, 'sight', 'travel'),
  L(/\b(daisy|rapeseed|yellow lady's slipper)\b/, 'flowers', 'nature', 'flowers'), L(/\b(ski|snowmobile|dogsled|snowplow)\b/, 'snow', 'nature', 'snow'),
  L(/\b(dumbbell|barbell|balance beam|horizontal bar|parallel bars)\b/, 'gym', 'fitness'),
  // (What they wear.)
  L(/\b(mortarboard|academic gown)\b/, 'grad', 'win', 'cap and gown'),
  L(/\b(swimming trunks|bikini|maillot)\b/, 'cloth:summer', 'style', 'swimsuit'), L(/\b(sandal)\b/, 'cloth:summer', 'style', 'sandals'), L(/\b(sunglass|sunglasses)\b/, 'cloth:summer', 'style', 'shades'), L(/\b(sombrero|cowboy hat)\b/, 'cloth', 'style', 'hat'),
  L(/\b(fur coat|trench coat|parka)\b/, 'cloth:winter', 'style', 'coat'), L(/\b(ski mask|mitten|wool|stole)\b/, 'cloth:winter', 'style', 'winter gear'), L(/\b(cardigan)\b/, 'cloth:cozy', 'style', 'cardigan'), L(/\b(sweatshirt)\b/, 'cloth:cozy', 'style', 'hoodie'),
  L(/\b(suit|bow tie|windsor tie)\b/, 'cloth:formal', 'style', 'suit'), L(/\b(gown|overskirt|hoopskirt)\b/, 'cloth:formal', 'style', 'dress'), L(/\b(miniskirt)\b/, 'cloth', 'style', 'skirt'),
  L(/\b(jean)\b/, 'cloth', 'style', 'jeans'), L(/\b(jersey)\b/, 'cloth', 'style', 'tee'), L(/\b(military uniform)\b/, 'cloth', 'style', 'uniform'), L(/\b(kimono)\b/, 'cloth', 'style', 'kimono'), L(/\b(pajama)\b/, 'cloth:cozy', 'style', 'pjs'),
  L(/\b(running shoe)\b/, 'cloth', 'style', 'sneakers'), L(/\b(cowboy boot)\b/, 'cloth', 'style', 'boots'), L(/\b(lipstick)\b/, 'cloth', 'style', 'lipstick'),
  L(/\b(acoustic guitar|electric guitar)\b/, 'music', 'music', 'guitar'), L(/\b(drum)\b/, 'music', 'music', 'drums'), L(/\b(grand piano|upright)\b/, 'music', 'music', 'piano'), L(/\b(violin|cello|banjo|sax|harmonica|microphone|stage)\b/, 'music', 'music'),
  L(/\b(joystick|monitor|desktop computer|screen)\b/, 'game', 'game', 'setup'),
  L(/\b(sports car|racer)\b/, 'car', 'car', 'car'), L(/\b(convertible)\b/, 'car', 'car', 'convertible'), L(/\b(jeep)\b/, 'car', 'car', 'jeep'), L(/\b(pickup)\b/, 'car', 'car', 'truck'), L(/\b(limousine|minivan|cab|grille|car wheel|beach wagon)\b/, 'car', 'car'),
  L(/\b(mountain bike|moped|motor scooter)\b/, 'car', 'car', 'bike'),
  L(/\b(candle|balloon)\b/, 'party', 'birthday'),
];
const labelOf = (name) => LABELS.find((x) => x.re.test(name)) ?? null;

/**
 * A photo read as what's in it, checked against itself: { topics, things, labels: [{ ...label, score }],
 * people, poses, bg, outfit, brand, place, night, morning, grad, season, faces }. A beach only with sand or
 * water to be seen (a blue sky alone isn't one), clothes only on someone, a pet's face not a person.
 */
export function sceneWords(photo) {
  const out = { words: [], things: [], topics: [], labels: [], people: 0, faces: 0, poses: [], bg: [], outfit: null, brand: null, place: null, night: false, morning: false, grad: false, season: null, formal: false, items: [] };
  if (!photo || typeof photo !== 'object') return out;
  out.bg = Array.isArray(photo.bg) ? photo.bg : [];
  const hasBg = Array.isArray(photo.bg);
  // (A pet: one sure label, or several breeds that add up (the classifier unsure which dog it is).)
  const petScore = (photo.labels ?? []).filter(([n]) => labelOf(n)?.kind === 'pet').reduce((t, [, k]) => t + k, 0);
  const pet = petScore >= 0.15 || (photo.labels ?? []).some(([n, k]) => k >= 0.1 && labelOf(n)?.kind === 'pet');
  out.faces = Number.isFinite(photo.faces) && !pet ? photo.faces : 0;
  out.people = pet ? 0 : Math.max(out.faces, Number.isFinite(photo.people) ? photo.people : 0);
  out.poses = out.people ? photo.poses ?? [] : [];
  const add = (topic, n = 1) => { const tp = TOPICS.find((t) => t.id === topic); if (!tp) return; for (let i = 0; i < n; i++) out.words.push(tp.words[0]); if (!out.topics.includes(topic)) out.topics.push(topic); };
  for (const [i, [name, score]] of (photo.labels ?? []).entries()) {
    const lb = labelOf(name); if (!lb || !(score >= 0.1)) continue;
    // (Checked: a beach needs its sand or water; a lake its water or green; clothes someone to wear them.)
    if (lb.kind === 'beach' && hasBg && !out.bg.some((b) => b === 'sand' || b === 'water')) continue;
    if (lb.kind === 'beach' && !hasBg && score < 0.5) continue;
    if (lb.kind === 'lake' && hasBg && !out.bg.some((b) => b === 'water' || b === 'green')) continue;
    if (lb.kind.startsWith('cloth') && !out.people && score < 0.5) continue;
    if (lb.kind.startsWith('cloth') && score < (lb.name === 'tee' ? 0.3 : 0.18)) continue;
    if (lb.kind === 'grad' && score < 0.15) continue;
    out.labels.push({ ...lb, score, label: name });
    add(lb.topic, score >= 0.4 ? 2 : 1);
    if (lb.name && (i === 0 || score >= 0.25)) {
      if (lb.kind.startsWith('cloth')) out.items.push(lb.name);
      else out.things.push(lb.kind === 'pet' && score >= 0.55 && i === 0 && lb.name === 'dog' ? name.replace(/-/g, ' ') : lb.name);
    }
    if (lb.kind === 'grad') out.grad = true;
    if (lb.kind === 'cloth:formal') out.formal = true;
  }
  // (The background, apart from the people: what's behind them.)
  // (Warm light over food or a pet, with no sky: a lamp, not a sunset. Snow only seen under a sky, or a ski.)
  const indoorWarm = out.labels.some((l) => ['food', 'pet'].includes(l.kind)) && !out.bg.includes('sky');
  if (!indoorWarm && (out.bg.includes('sunset') || (!hasBg && photo.tone === 'sunset' && !out.people))) add('sunset', 2);
  if (out.bg.includes('snow') || out.labels.some((l) => l.kind === 'snow')) { add('nature'); out.things.push('snow'); }
  if (out.bg.includes('sand') && out.bg.includes('water') && !out.topics.includes('beach')) add('beach');
  if (out.bg.includes('green') && !out.topics.length) add('nature');
  if (out.bg.includes('night') || photo.tone === 'night' || (photo.hour != null && (photo.hour >= 21 || photo.hour < 4))) out.night = true;
  if (photo.hour != null && photo.hour >= 5 && photo.hour < 9) out.morning = true;
  if (pet && !out.labels.some((l) => l.kind === 'pet')) { const top = (photo.labels ?? []).find(([n]) => labelOf(n)?.kind === 'pet'); out.labels.push({ ...labelOf(top[0]), score: petScore, label: top[0] }); out.things.push(labelOf(top[0]).name); add('pet'); }

  if (out.people >= 2 && !out.topics.length) add('friends');
  // (What they wear: its colour, and the season it says.)
  if (out.people && photo.outfit) out.outfit = photo.outfit;
  const kinds = out.labels.map((l) => l.kind); const month = Number(String(photo.taken ?? '').slice(5, 7)) || 0;
  if (out.people) {
    if (kinds.includes('cloth:winter') || (out.bg.includes('snow')) || (photo.outfit?.skin != null && photo.outfit.skin < 0.06 && [11, 12, 1, 2].includes(month))) out.season = 'winter';
    else if (kinds.includes('cloth:summer') || (photo.outfit?.skin ?? 0) >= 0.38 || out.bg.includes('sand')) out.season = 'summer';
    else if (kinds.includes('cloth:cozy')) out.season = 'cozy';
  }
  if (typeof photo.brand === 'string' && out.people) out.brand = photo.brand;
  if (typeof photo.place === 'string' && photo.place) out.place = photo.place;
  out.things = [...new Set(out.things)]; out.items = [...new Set(out.items)];
  return out;
}

/** What a photo shows, as a short plain description (for the on-device model to write from), or ''. */
export function describeScene(photo) {
  const s = sceneWords(photo); const bits = [];
  if (s.people) bits.push(s.people === 1 ? 'one person' : `${s.people} people`);
  if (s.things.length) bits.push(`with ${s.things.slice(0, 4).join(', ')}`);
  if (s.items.length || s.outfit?.color) bits.push(`wearing ${s.outfit?.color ? `${s.outfit.color} ` : ''}${s.items.length ? s.items.slice(0, 3).join(', ') : 'clothes'}`);
  if (s.brand) bits.push(`${s.brand} on`);
  if (s.grad) bits.push('a graduation');
  if (s.formal) bits.push('dressed up');
  if (s.topics.length) bits.push(`feels like: ${s.topics.slice(0, 3).join(', ')}`);
  if (s.bg.length) bits.push(`background: ${s.bg.slice(0, 3).join(', ')}`);
  if (s.place) bits.push(`in ${s.place}`);
  if (s.night) bits.push('at night'); else if (s.morning) bits.push('in the morning');
  if (s.season && s.season !== 'cozy') bits.push(`${s.season} look`);
  return bits.join('; ');
}

const nospace = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const HEARTS = { black: '🖤', white: '🤍', red: '❤️', orange: '🧡', yellow: '💛', green: '💚', 'dark green': '💚', olive: '💚', teal: '🩵', blue: '💙', navy: '💙', purple: '💜', pink: '🩷', magenta: '💗', brown: '🤎', beige: '🤎', gray: '🩶' };
const ITEM_EMOJI = { shades: '😎', sneakers: '👟', hat: '🤠', dress: '👗', suit: '🕴️', swimsuit: '👙', coat: '🧥', hoodie: '🧢', boots: '👢', jeans: '👖', tee: '👕', lipstick: '💄', skirt: '👗', sandals: '🩴', cardigan: '🧶', pjs: '😴', 'winter gear': '🧣', kimono: '👘', uniform: '🎖️' };
const FOOD_EMOJI = { pizza: '🍕', burger: '🍔', 'hot dog': '🌭', 'ice cream': '🍦', coffee: '☕', burrito: '🌯', wine: '🍷', beer: '🍺', pasta: '🍝', dessert: '🍰', bagel: '🥯', pretzel: '🥨', guac: '🥑' };
// (Colours named on clothes: ones that read well before an item.)
const WEARABLE = new Set(['tee', 'hoodie', 'dress', 'suit', 'coat', 'jeans', 'skirt', 'cardigan', 'swimsuit', 'kimono']);

/** A fact: { id, w (how specific), emoji, say (comments), cap (captions), tags }. */
const fact = (id, w, emoji, say, cap = [], tags = []) => ({ id, w, emoji, say, cap, tags });

/** What a photo gives to talk about, most specific first (see sceneWords). */
export function photoFacts(photo, { year = new Date().getFullYear() } = {}) {
  const sw = sceneWords(photo); const F = []; const P = sw.people;
  const yr = Number(String(photo?.taken ?? '').slice(0, 4)) || year;
  if (sw.grad) F.push(fact('grad', 10, ['🎓', '🎉', '👏', '🥳', '🙌'], ['Congrats grad!!', 'The cap and gown suits you', 'So proud of you, graduate', 'All that hard work paid off', 'Officially a grad!! Huge'], ['Cap, gown, done', 'Officially a graduate', `Class of ${yr}`, 'We did it'], ['graduation', `classof${yr}`, 'grad']));
  if (sw.brand) { const B = sw.brand; F.push(fact('brand', 9, ['🔥', '💯', '😎', '👟'], [`Repping ${B} I see`, `The ${B} fit is clean`, `${B} on point`, `Head to toe ${B}?`, `Love the ${B} look`], [`Repping ${B}`, `${B} kind of day`], [nospace(B)])); }
  const petLabel = sw.labels.find((l) => l.kind === 'pet');
  if (petLabel) {
    const isCat = petLabel.name === 'cat'; const t = sw.things.find((x) => x !== 'snow') ?? (isCat ? 'kitty' : 'pup'); const breed = !['dog', 'cat'].includes(t);
    F.push(fact('pet', breed ? 9 : 7, isCat ? ['🐱', '🐾', '😻', '🥰'] : ['🐶', '🐾', '🥰', '🐕'], [`Love the ${t}`, `That ${t} is the cutest`, `I need to meet this ${t}`, 'Look at that face!!', `Give the ${t} a hug from me`, breed ? `${cap(t)}s are the best` : 'Who\'s a good one?!'], ['My favorite coworker', 'Look at this face', isCat ? 'Best kitty ever' : 'Best pup ever', 'Living with a celebrity'], [isCat ? 'catsofinstagram' : 'dogsofinstagram', 'petlove']));
  }
  if (sw.place) { const pl = sw.place; F.push(fact('place', 8, ['📍', '✈️', '🗺️', '😍'], [`${pl} looks amazing`, ...(P ? [`${pl} looks so good on you`] : []), `Missing ${pl} so much`, `${pl}!! Take me with you next time`, `Enjoy ${pl}!`], [`${pl} days`, `Postcard from ${pl}`, `Can't get enough of ${pl}`], [nospace(pl)])); }
  const food = sw.labels.find((l) => l.kind === 'food' && l.name);
  if (food) { const f = food.name; F.push(fact('food', 8, [FOOD_EMOJI[f] ?? '😋', '😋', '🤤', '🍽️'], [`That ${f} looks incredible`, /^(burger|hot dog|burrito|bagel|pretzel)$/.test(f) ? `Save me a bite of that ${f}!` : `Save me some ${f}!`, `Okay now I want ${/^(burger|hot dog|burrito|bagel|pretzel)$/.test(f) ? 'a ' : ''}${f}`, `Where is this ${f} from?!`, 'Recipe please'], [`${cap(f)} o'clock`, 'Treat yourself', 'Worth every bite', `${cap(f)} > everything`], ['foodie', nospace(f)])); } else if (sw.topics.includes('food')) F.push(fact('food', 5, ['😋', '🤤', '🍽️'], ['Save me a bite!', 'Now I\'m hungry', 'This looks so good', 'Recipe please'], ['Eating good tonight', 'Treat yourself'], ['foodie', 'yum']));
  const color = sw.outfit?.color;
  for (const [k, i] of sw.items.slice(0, 2).entries()) {
    const c = color && WEARABLE.has(i) && k === 0 ? `${color} ` : '';
    F.push(fact(`item:${i}`, 7 - k, [ITEM_EMOJI[i] ?? '🔥', '🔥', '😍', '✨', '💅'], [`That ${c}${i} though`, `Love the ${i}`, `The ${i} is everything`, `Where's the ${i} from?!`, `Obsessed with the ${c}${i}`], [`${cap(c)}${i} kind of day`, `Fit check: the ${i}`], ['ootd', 'fitcheck']));
  }
  if (color && P && !sw.grad && !sw.items.some((i) => WEARABLE.has(i))) F.push(fact('color', 5, [HEARTS[color] ?? '✨', '✨', '😍'], color === 'black' ? ['All black everything', 'The all-black look is so good', 'Black on black, love it'] : [`${cap(color)} looks so good on you`, `That ${color} is your color`, `Loving the ${color}`], [color === 'black' ? 'All black everything' : `Wearing ${color} today`], []));
  if (sw.season === 'summer') F.push(fact('summer', 6, ['☀️', '😎', '🌴', '🕶️'], ['Summer fit on point', 'Dressed for the sunshine', 'Giving summer vibes', 'Perfect warm-weather look'], ['Summer state of mind', 'Sun\'s out', 'Summer uniform'], ['summervibes', 'summerfit']));
  if (sw.season === 'winter') F.push(fact('winter', 6, ['❄️', '🧣', '🧥', '☃️'], ['Bundled up and still stylish', 'Cozy winter look', 'Love the layers', 'Stay warm out there!'], ['Bundled up', 'Layers on layers', 'Cold outside, cozy inside'], ['winterfit', 'winterstyle']));
  if (sw.season === 'cozy') F.push(fact('cozy', 5, ['🧸', '☕', '🤎'], ['So cozy!', 'Comfy and cute', 'Cozy season is the best'], ['Cozy mode', 'Comfy is the vibe'], ['cozy']));
  if (sw.formal && !sw.grad) F.push(fact('formal', 6, ['🕴️', '✨', '👔', '💫'], ['Dressed to impress', 'So sharp', 'Looking like a million bucks', 'What\'s the occasion?! You look amazing'], ['All dressed up', 'Dressed up, nowhere to be'], ['dressedup']));
  // (What's behind them.)
  const behind = P ? ' behind you' : '';
  const kinds = sw.labels.map((l) => l.kind); const bg = sw.bg;
  if (kinds.includes('mountain')) F.push(fact('mountains', 6, ['🏔️', '⛰️', '🌲'], ['Those mountains!!', `That view${behind}`, 'Mountain air hits different', 'Okay this view is unreal'], ['Mountains are calling', 'Views for days', 'Up in the mountains'], ['mountains', 'views']));
  if (sw.topics.includes('beach')) F.push(fact('beach', 6, ['🌊', '🏖️', '☀️', '🐚'], ['Take me with you next time', 'I can almost hear the waves', 'Beach days are the best days', 'That water!!'], ['Salt in the air, sand in my hair', 'Vitamin sea', 'Beach days'], ['beach', 'vitaminsea']));
  if (kinds.includes('lake')) F.push(fact('lake', 6, ['🏞️', '🌲', '💧'], ['That lake view!!', 'So peaceful by the water', 'Lake days are the best'], ['Lake days', 'By the water'], ['lakelife']));
  if (sw.things.includes('snow')) F.push(fact('snow', 6, ['❄️', '☃️', '🏂'], ['Snow day!!', 'Winter wonderland', 'All that snow!'], ['Snow days', 'Winter wonderland'], ['snow', 'winter']));
  if (sw.topics.includes('sunset')) F.push(fact('sunset', 6, ['🌅', '🧡', '✨', '🌇'], ['That sky is unreal', 'Golden hour hits different', `The sky${behind}!!`, 'Perfect lighting'], ['Chasing sunsets', 'Golden hour', 'The sky put on a show'], ['sunset', 'goldenhour']));
  const scenic = F.some((f) => ['mountains', 'beach', 'lake', 'snow', 'sunset'].includes(f.id));
  if (!scenic && bg.includes('sky')) F.push(fact('sky', 4, ['☀️', '💙', '🌤️'], ['Blue skies and good vibes', 'Not a cloud in the sky', 'What a gorgeous day', 'Perfect weather for it'], ['Blue skies', 'Perfect day for it', 'Sunny days'], ['bluesky', 'sunnyday']));
  if (!scenic && bg.includes('green')) F.push(fact('green', 4, ['🌿', '🌳', '💚'], ['So green and peaceful', ...(P ? ['Nature looks good on you'] : []), 'Love all the green'], ['Outside is free', 'Fresh air'], ['outdoors', 'nature']));
  if (!scenic && bg.includes('city')) F.push(fact('city', 4, ['🏙️', '🌆', '✨'], ['City vibes', 'Love the city backdrop', 'Big city energy'], ['City days', 'Out in the city'], ['citylife']));
  // (Other things in it.)
  for (const [k, emoji, say, capn, tags] of [
    ['car', ['🚗', '🏎️', '😎'], ['Clean ride', 'Take me for a spin!', 'Dream car right here'], ['New ride', 'Weekend drives'], ['cars']],
    ['music', ['🎶', '🎸', '🎤'], ['Wish I was there!', 'Live music hits different', 'What a night'], ['Live music hits different', 'Turn it up'], ['livemusic']],
    ['game', ['🎮', '🕹️', '😎'], ['This setup is insane', 'One more game?', 'Gaming goals'], ['New setup', 'Late night sessions'], ['gaming']],
    ['gym', ['💪', '🔥', '🏋️'], ['Putting in the work!', 'Goals right here', 'Beast mode'], ['No days off', 'Stronger every day'], ['fitness']],
    ['flowers', ['🌸', '🌷', '💐'], ['So pretty!', 'Love the flowers', 'Spring vibes'], ['Stop and smell the flowers'], ['flowers']],
    ['sight', ['📸', '🗺️', '✨'], ['What a spot!', 'Adding this to my list', 'Where is this?!'], ['Out here exploring', 'Collecting moments'], ['travel']],
    ['party', ['🎉', '🎈', '🥳'], ['Party time!', 'Looks like so much fun', 'Happy celebrating!'], ['Make a wish', 'Celebrating'], ['celebrate']],
  ]) if (kinds.includes(k)) { const nm = sw.labels.find((l) => l.kind === k && l.name)?.name; F.push(fact(k, 5, emoji, nm ? [...say, `Love the ${nm}`] : say, capn, tags)); }
  // (How they stand.)
  const po = sw.poses;
  if (po.includes('allarmsup')) F.push(fact('allarmsup', 5, ['🙌', '🎉', '🥳'], ['Everyone\'s arms up, love it', 'The energy in this group!!', 'This is pure joy'], ['Arms up', 'Pure joy'], []));
  else if (po.includes('armsup')) F.push(fact('armsup', 5, ['🙌', '🥳', '🎉'], ['Arms up, love the energy', 'Living your best life', 'The joy in this!!', 'Celebration mode'], ['Arms up', 'Pure joy'], []));
  if (po.includes('wave')) F.push(fact('wave', 4, ['👋', '😄'], ['Hi to you too!', 'Love the wave', 'Waving back!'], ['Hi from here'], []));
  if (po.includes('hips')) F.push(fact('hips', 5, ['💁', '🔥', '💪'], ['Power pose activated', 'Owning it', 'The confidence!!', 'Strike a pose'], ['Owning it', 'Strike a pose'], []));
  if (po.includes('sitting')) F.push(fact('sitting', 5, ['😌', '✨', '☕'], ['So relaxed', 'Chilling in style', 'The perfect spot', 'Love this candid'], ['Sitting pretty', 'Taking a breather'], []));
  if (po.includes('full') && !sw.items.length) F.push(fact('full', 4, ['🔥', '✨', '👀'], ['Head to toe perfect', 'The whole look!!', 'Full fit, no notes'], ['Head to toe', 'Full look'], []));
  if (po.includes('close') || (P === 1 && sw.faces === 1 && !po.length)) F.push(fact('close', 4, ['😍', '✨', '💫', '🥹'], ['This smile!!', 'Glowing', 'That face!!', 'Okay you look amazing'], ['Feeling myself today', 'Good hair day', 'Just me'], []));
  // (How many.)
  if (P === 2) F.push(fact('two', 5, ['🥰', '👯', '❤️', '💕'], ['You two are the cutest', 'Love this pic of you two', 'Cutest duo', 'Double the fun'], ['My other half', 'Partners in crime', 'Two of a kind'], ['bestfriends']));
  else if (P >= 3 && P <= 5) F.push(fact('group', 5, ['👯', '🥳', '🤗', '❤️'], ['The whole crew!!', 'Best group pic', 'Love all these faces', `All ${P} of you!!`], ['My people', 'Good times with the best crew', 'Squad goals'], ['squad', 'friends']));
  else if (P >= 6) F.push(fact('crowd', 5, ['🎉', '🙌', '🥳', '👏'], ['The whole squad came out', 'What a crowd!', 'Everyone looks so happy', `${P} people and everyone looks great`], ['The whole gang', 'Full house'], ['squad', 'goodtimes']));
  else if (P === 1 && !F.some((f) => ['close', 'armsup', 'hips', 'sitting', 'full', 'wave'].includes(f.id))) F.push(fact('one', 3, ['😍', '✨', '📸'], ['Love this pic of you', 'Looking great!', 'Such a good photo'], ['Just me', 'Me, myself and I'], []));
  // (When.)
  if (sw.night) F.push(fact('night', 3, ['🌙', '✨', '🌃'], ['What a night', 'Night out vibes', 'The night is young'], ['Nights like these', 'After dark'], ['nightout']));
  if (sw.morning) F.push(fact('morning', 3, ['☀️', '🌅', '☕'], ['Early start!', 'Morning views like this', 'Rise and shine'], ['Rise and shine', 'Early bird'], []));
  // (Each fact as a few words, to put two together: "the black suit", "in Boulder", "you two".)
  const color2 = sw.outfit?.color;
  for (const f of F) {
    if (f.id === 'grad') f.bit = 'the cap and gown';
    else if (f.id === 'brand') f.bit = `the ${sw.brand} fit`;
    else if (f.id === 'pet') f.bit = `the ${sw.things.find((x) => x !== 'snow') ?? 'pup'}`;
    else if (f.id === 'food') { const fd = sw.labels.find((l) => l.kind === 'food' && l.name)?.name; if (fd) f.bit = `that ${fd}`; }
    else if (f.id.startsWith('item:')) { const it = f.id.slice(5); f.bit = `the ${color2 && WEARABLE.has(it) && f.w === 7 ? `${color2} ` : ''}${it}`; }
    else if (f.id === 'place') f.loc = `in ${sw.place}`;
    else if (f.id === 'mountains') f.loc = 'with those mountains';
    else if (f.id === 'beach') f.loc = 'on the beach';
    else if (f.id === 'lake') f.loc = 'by the lake';
    else if (f.id === 'snow') f.loc = 'in the snow';
    else if (f.id === 'sunset') f.loc = 'at golden hour';
    else if (f.id === 'city') f.loc = 'in the city';
    else if (f.id === 'night') f.loc = 'on a night out';
    else if (f.id === 'two') f.subj = 'you two';
    else if (f.id === 'group' || f.id === 'crowd') f.subj = 'you all';
  }
  return F.sort((a, b) => b.w - a.w);
}

/**
 * Comments that put two things about the post together (more specific than either alone): "That black suit in
 * Boulder?!", "You two at golden hour", "The cap and gown + those mountains".
 */
function comboFacts(facts) {
  const bits = facts.filter((f) => f.bit); const locs = facts.filter((f) => f.loc); const subs = facts.filter((f) => f.subj);
  const out = [];
  // (Not the same thing twice: "the beach on the beach".)
  const same = (b, l) => b.id === l.id || String(l.loc).toLowerCase().includes(String(b.bit ?? b.subj ?? '').toLowerCase().replace(/^(the|your|that) /, ''));
  for (const b of bits.slice(0, 3)) for (const l of locs.slice(0, 2)) if (!same(b, l)) out.push({ ...fact(`combo:${b.id}+${l.id}`, Math.max(b.w, l.w) + 2, [...b.emoji.slice(0, 2), ...l.emoji.slice(0, 2)], [`${cap(b.bit)} ${l.loc}?! Love it`, `Loving ${b.bit} ${l.loc}`, `${cap(b.bit)} ${l.loc} is everything`]), parts: [b.id, l.id] });
  for (const u of subs) {
    for (const l of locs.slice(0, 2)) if (!same(u, l)) out.push({ ...fact(`combo:${u.id}+${l.id}`, Math.max(u.w, l.w) + 2, [...u.emoji.slice(0, 2), ...l.emoji.slice(0, 2)], [`${cap(u.subj)} ${l.loc}, the best`, `Love seeing ${u.subj} ${l.loc}`]), parts: [u.id, l.id] });
    for (const b of bits.slice(0, 2)) out.push({ ...fact(`combo:${u.id}+${b.id}`, Math.max(u.w, b.w) + 1, [...u.emoji.slice(0, 2), ...b.emoji.slice(0, 2)], [`${cap(u.subj)} and ${b.bit}, perfect`]), parts: [u.id, b.id] });
  }
  if (bits.length >= 2) { const [a, b] = bits; out.push({ ...fact(`combo:${a.id}+${b.id}`, Math.max(a.w, b.w) + 1, [...a.emoji.slice(0, 2), ...b.emoji.slice(0, 2)], [`${cap(a.bit)} and ${b.bit}?! Iconic`]), parts: [a.id, b.id] }); }
  // (Livelier ways to say the one thing: "Not the black suit being this good", "The red dress said main character".)
  for (const b of bits.slice(0, 2)) out.push({ ...fact(`fun:${b.id}`, b.w, b.emoji, [`Not ${b.bit} being this good`, `${cap(b.bit)} said main character`, `The way ${b.bit} just works`, `${cap(b.bit)}? Iconic`, `Someone tell ${b.bit} to calm down`, `${cap(b.bit)} deserves its own post`]), parts: [b.id] });
  for (const l of locs.slice(0, 1)) out.push({ ...fact(`fun:${l.id}`, l.w, l.emoji, [`Living ${l.loc} rent free in my head now`, `Me pretending I'm ${l.loc} too`, `Okay ${l.loc} looks unreal`]), parts: [l.id] });
  return out;
}

/** What a caption gives to talk about: what it names, counts, asks, its hashtags and the people tagged. */
function captionFacts(caption, { tagged = [], as = '', rand }) {
  const F = []; const r = readText(caption); const tp = r.topics[0];
  const kw = tp ? r.keywords.find((w) => tp.words.includes(w) && w.length < 16 && !['birthday', 'bday', 'celebrate', 'celebrating', 'turning', 'finally', 'done', 'first', 'love', 'summer', 'winter', 'spring', 'fall', 'autumn'].includes(w)) : null;
  const things = [...new Set([kw, ...thingsIn(caption)].filter(Boolean))];
  const E = tp?.emoji ?? GENERAL.emoji;
  if (things.length) { const t = things[0]; const t2 = things[1] ?? t; F.push(fact('cap:thing', 6, E, [`Love the ${t}`, `That ${t} though`, `Obsessed with the ${t2}`, `The ${t2} is ${pick(tp?.adj ?? GENERAL.adj, rand)}`])); }
  const places = placesIn(caption);
  if (places.length) { const pl = places[0]; F.push(fact('cap:place', 8, ['📍', '✈️', '😍', '🗺️'], [`${pl} looks ${pick(['amazing', 'unreal', 'like a dream', 'incredible'], rand)}`, `Missing ${pl} so much`, `${pl}!! Take me with you next time`, `Enjoy ${pl}!`])); }
  const n = numbersIn(caption);
  if (n.age) F.push(fact('cap:age', 9, ['🎂', '🎉', '🥳', '🎈'], [`Happy ${ordinal(n.age)}!!`, `${n.age} looks good on you`, `Happy ${ordinal(n.age)} birthday! Have the best year`]));
  if (n.years && !n.age) F.push(fact('cap:years', 8, ['🥂', '❤️', '🎉'], [`${n.years} year${n.years === 1 ? '' : 's'}!! Congrats`, `Here's to ${n.years} more`]));
  if (n.km) F.push(fact('cap:km', 8, ['🏃', '🔥', '💪', '🏅'], [`${n.km}k?! Legend`, `Crushing that ${n.km}k`]));
  if (asks(caption)) {
    const opts = String(caption).match(/\b([\p{L}]+)\s+or\s+([\p{L}]+)\b[^?]*\?/iu);
    F.push(fact('cap:ask', 7, ['🤔', '👀', '🙌', '💯'], opts ? [`${cap(opts[2].toLowerCase())}, no question`, `${cap(opts[1].toLowerCase())} all the way`, `Team ${opts[pick([1, 2], rand)].toLowerCase()}`] : /which one|which\b/i.test(caption) ? ['The first one for sure', 'Second one!!'] : ['Definitely yes!!', 'Honestly? Go for it', '100% do it']));
  }
  if (r.tags.length) { const best = r.tags.filter((t) => tp?.words.some((w) => t.includes(w))); const tg = best[0] ?? r.tags[0]; const tg2 = r.tags.find((t) => t !== tg) ?? tg; F.push(fact('cap:tag', 4, E, [`#${tg} indeed`, `The #${tg} energy here`, `Peak #${tg2}`, `Living for the #${tg2} content`])); }
  const handles = [...new Set(tagged.filter(Boolean).map((h) => String(h).replace(/^@/, '')))]; const me = String(as ?? '').replace(/^@/, '');
  if (me && handles.includes(me)) F.push(fact('cap:me', 4, ['🥰', '❤️', '🙌'], ['Thanks for the tag!', 'So glad I was there for this', 'Best day with you']));
  const others = handles.filter((h) => h !== me);
  if (others.length) F.push(fact('cap:people', 3, ['🥰', '👯', '😍'], [`@${others[0]} you two!!`, `@${others[others.length - 1]} look at this`, `Love seeing you with @${others[0]}`]));
  if (tp) {
    const byTopic = {
      beach: ['Take me with you next time', 'I can almost hear the waves'], sunset: ['That sky is unreal', 'Golden hour hits different'], food: ['Save me a bite!', 'Recipe please', 'Now I\'m hungry'],
      birthday: ['Happy birthday!!', 'Happiest birthday! Hope it was the best'], pet: ['I need to meet this cutie', 'Give them a hug from me'], travel: ['Where is this??', 'Adding this to my list', 'Living the dream'],
      fitness: ['Putting in the work!', 'Goals right here'], style: ['Where\'s that from?!', 'Serving looks', 'This fit!!'], friends: ['Love you guys', 'Best crew'], nature: ['So peaceful', 'Nature is the best'],
      music: ['Wish I was there!', 'What a night'], art: ['You\'re so talented', 'This is next level'], win: ['Congrats!! So proud of you', 'You deserve this!'], game: ['This build is insane', 'How long did this take?!'], car: ['Clean ride', 'Take me for a spin!', 'Dream car right here'],
    }[tp.id] ?? [];
    const say = places.length ? byTopic.filter((x) => !/Where is this/.test(x)) : byTopic;
    if (say.length) F.push(fact(`cap:topic:${tp.id}`, 5, tp.emoji, say));
  }
  return F;
}

/** The general things to say (any post), for its topic. */
function generalFact(caption, photo, rand) {
  const r = readText(`${caption ?? ''} ${sceneWords(photo).words.join(' ')}`); const T = r.topics[0] ?? GENERAL;
  const noun = pick(T.nouns, rand); const adj = pick(T.adj, rand);
  return fact('general', 1, [...(r.emojis.length ? r.emojis : []), ...T.emoji, ...GENERAL.emoji], [`This ${noun} is ${adj}`, `${cap(adj)}!`, `Obsessed with this ${noun}`, `Wow, ${adj}`, `Okay this is ${adj}`, 'Need more of this', `${cap(adj)} as always`, 'Love love love this', 'Frame this immediately', 'This belongs in a museum', 'Okay whoever took this ate', 'Screenshotting this', 'Saving this forever', 'The way I gasped', 'Obsessed is an understatement', 'No because this is so good', 'Living rent free in my head now', 'Not me looking at this for ten minutes']);
}

/** A batch's memory: what's been said, in what words and with what emojis, so the next is different. */
const newBatch = () => ({ keys: new Set(), facts: new Map(), emojis: new Set(), starts: new Set() });
const opening = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}@# ]+/gu, '').split(/\s+/).slice(0, 2).join(' ');

/**
 * A comment for a post, made for what it shows (its photo, read on the phone: `photo`) and its caption: the
 * most specific things likeliest (a cap and gown, a brand, a dog's breed, the place, the food, what they wear,
 * what's behind them, how they pose, how many), then its hashtags, the people tagged (`tagged`; `as`: who's
 * commenting), general words least. `avoid`: comments already on it; `batch`: kept across a batch so each is
 * different (words, what it's about, emojis).
 */
export function generateComment(caption, { rand = Math.random, avoid = [], tagged = [], as = '', persona = null, photo = null, by = '', batch = newBatch() } = {}) {
  const pf = photoFacts(photo); const cf = captionFacts(caption, { tagged, as, rand });
  // (The caption's things can go with the photo's places: "The pizza in Denver?!".)
  const capThing = cf.find((f) => f.id === 'cap:thing'); if (capThing) { const t = capThing.say[0].replace(/^Love the /, ''); capThing.bit = `the ${t}`; }
  const capPlace = cf.find((f) => f.id === 'cap:place'); if (capPlace) capPlace.loc = `in ${capPlace.say[0].split(' looks ')[0]}`;
  const facts = [...comboFacts([...pf, ...cf]), ...pf, ...cf, generalFact(caption, photo, rand)];
  // (Now and then, to whoever posted it.)
  const poster = String(by ?? '').replace(/^@/, '');
  if (poster && poster !== String(as ?? '').replace(/^@/, '') && pf.length + cf.length) { const top = [...pf, ...cf][0]; facts.push(fact(`by:${top.id}`, 2, top.emoji, [`@${poster} this is so you`, `@${poster} you never miss`, `Okay @${poster}, I see you`])); }
  const said = new Set(avoid.map((a) => String(a).trim().toLowerCase())); const saidStarts = new Set(avoid.map(opening));
  const cands = [];
  // (While there are things not yet talked about (specific ones), those only.)
  const freshLeft = facts.some((f) => f.w >= 3 && !batch.facts.get(f.id) && f.say.some((x, i) => !batch.keys.has(`${f.id}:${i}`)));
  for (const f of facts) for (const [i, s] of f.say.entries()) {
    if (freshLeft && (batch.facts.get(f.id) || (f.parts ?? []).some((x) => batch.facts.get(x)))) continue;
    const key = `${f.id}:${i}`; if (batch.keys.has(key) || said.has(s.toLowerCase())) continue;
    let w = f.w * f.w; // (the more specific, much the likelier)
    w *= 0.12 ** (batch.facts.get(f.id) ?? 0); // (a thing already talked about: rarely again)
    if (batch.starts.has(opening(s)) || saidStarts.has(opening(s))) w *= 0.2;
    w /= f.say.length; // (a fact counts once, however many ways it can be said)
    cands.push({ f, s, key, w });
  }
  // (Emojis: ones not used yet in the batch; mirrored from the caption now and then.)
  const capEmoji = emojisIn(caption);
  const emojiFor2 = (f) => {
    const pool = [...new Set([...f.emoji, ...(rand() < 0.35 ? capEmoji : [])])]; const fresh = pool.filter((x) => !batch.emojis.has(x));
    const from = fresh.length ? fresh : [...new Set([...pool, ...GENERAL.emoji])].filter((x) => !batch.emojis.has(x));
    const list = from.length ? from : pool; const k = rand() < 0.3 && list.length > 1 ? 2 : 1; const out = [];
    for (let i = 0; i < k; i++) { const e = pick(list.filter((x) => !out.includes(x)), rand); if (e) out.push(e); }
    return out;
  };
  for (let tries = 0; tries < 30 && cands.length; tries++) {
    const total = cands.reduce((a, c) => a + c.w, 0); let x = rand() * total; let c = cands[cands.length - 1];
    for (const k of cands) { x -= k.w; if (x <= 0) { c = k; break; } }
    const es = emojisIn(c.s).length ? [] : emojiFor2(c.f);
    const text = `${c.s}${es.length ? ` ${es.join('')}` : ''}`.replace(/\s+/g, ' ').trim();
    if (said.has(text.toLowerCase())) { cands.splice(cands.indexOf(c), 1); continue; }
    batch.keys.add(c.key); batch.facts.set(c.f.id, (batch.facts.get(c.f.id) ?? 0) + 1); for (const part of c.f.parts ?? []) batch.facts.set(part, (batch.facts.get(part) ?? 0) + 1); batch.starts.add(opening(c.s)); for (const e of es) batch.emojis.add(e);
    // (In the voice of whoever's commenting.)
    return as || persona ? voice(text, { persona: persona ?? personaOf(String(as).replace(/^@/, '')), rand }) : text;
  }
  // (Everything said already: a general line not said yet.)
  const g = generalFact(caption, photo, rand);
  const own = (t) => (as || persona ? voice(t, { persona: persona ?? personaOf(String(as).replace(/^@/, '')), rand }) : t); // (in their voice too)
  for (let k = 0; k < 40; k++) { const t2 = `${pick(g.say, rand)} ${pick(g.emoji, rand)}`; if (!said.has(t2.toLowerCase())) return own(t2); }
  return own(`${pick(g.say, rand)} ${pick(g.emoji, rand)}${pick(g.emoji, rand)}`);
}

/** `n` different comments for a post (as `generateComment`; `as`: who says each, by turn): different words, things and emojis. */
export function generateComments(caption, n, { rand = Math.random, avoid = [], tagged = [], as = [], personas = [], photo = null, by = '' } = {}) {
  const out = []; const seen = [...avoid]; const batch = newBatch();
  for (let i = 0; i < n; i++) { const c = generateComment(caption, { rand, avoid: seen, tagged, as: as[i] ?? '', persona: personas[i] ?? null, photo, by, batch }); out.push(c); seen.push(c); }
  return out;
}

/**
 * A caption for a photo from what it shows, the most specific thing first (a cap and gown, a brand, the pet,
 * the place, the food, what they wear, the season, the scenery, the pose, how many): its words, an emoji,
 * 📍 the place and a few hashtags from what it's about. `avoid`: captions already suggested (the next most
 * specific then).
 */
export function suggestCaption(photo, { rand = Math.random, avoid = [] } = {}) {
  const facts = photoFacts(photo).filter((f) => f.cap.length);
  const said = new Set(avoid.map((a) => String(a).trim().toLowerCase()));
  const sw = sceneWords(photo); const place = sw.place;
  const build = (f, line) => {
    const second = facts.find((g) => g !== f && g.id !== 'place' && g.tags.length);
    const tags = [...new Set([...f.tags.slice(0, 2), ...(second ? second.tags.slice(0, 1) : []), ...(place && f.id !== 'place' ? [nospace(place)] : [])])].slice(0, 3);
    return `${line} ${f.emoji[0]}${place && f.id !== 'place' ? ` 📍 ${place}` : ''}${tags.length ? ` ${tags.map((t) => `#${t}`).join(' ')}` : ''}`.replace(/\s+/g, ' ').trim();
  };
  // (The most specific first; the same how-specific in a random order; each of its captions in turn.)
  const order = facts.map((f) => ({ f, k: f.w + rand() * 0.5 })).sort((a, b) => b.k - a.k).map((x) => x.f);
  for (const f of order) for (const line of shuffled2(f.cap, rand)) { const c = build(f, line); if (!said.has(c.toLowerCase())) return c; }
  const pool = sw.night ? ['Nights like these', 'After dark'] : ['Good vibes only', 'A little moment', 'Just because', 'Today was a good day'];
  for (const line of shuffled2(pool, rand)) { const c = `${line} ${pick(['✨', '📸', '💫'], rand)}${place ? ` 📍 ${place}` : ''}`; if (!said.has(c.toLowerCase())) return c; }
  return pick(pool, rand);
}
const shuffled2 = (a, rand) => { const o = [...a]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; };

/**
 * A photo's light and colour from its pixels (RGBA, w×h): 'night' (dark), 'sunset' (a warm orange-pink sky
 * up top), 'snow' (bright white), 'blue' (sky or water), 'green' (plants), or null.
 */
export function toneFromPixels(data, w, h) {
  const step = Math.max(1, Math.floor((w * h) / 6000)); let n = 0; let lum = 0; let warmTop = 0; let top = 0; let blue = 0; let green = 0; let white = 0;
  for (let i = 0; i < w * h; i += step) {
    const r = data[i * 4]; const g = data[i * 4 + 1]; const b = data[i * 4 + 2]; const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    n++; lum += y;
    if (Math.floor(i / w) < h * 0.45) { top++; if (r > 150 && r - b > 60 && r >= g && y > 0.3) warmTop++; }
    if (b > r + 25 && b > g && y > 0.25) blue++;
    if (g > r + 15 && g > b + 10) green++;
    if (r > 215 && g > 215 && b > 215) white++;
  }
  if (!n) return null;
  lum /= n;
  if (lum < 0.2) return 'night';
  if (top && warmTop / top > 0.35) return 'sunset';
  if (white / n > 0.4) return 'snow';
  if (blue / n > 0.35) return 'blue';
  if (green / n > 0.35) return 'green';
  return null;
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
