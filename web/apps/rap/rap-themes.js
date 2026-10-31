// What lines are about: themes rap verses keep coming back to, each a set of words that signal it and
// that suggestions can lean on (a verse about money gets money words; one about the night, night words).
// Words are in their plain form (cash, not cashes; dream, not dreaming): lines are matched on that.

export const THEMES = {
  money: { icon: '💰', words: 'money cash paper bands stack stacks rich wealth bank check pay paid cost price dollar dollars million millions bill bills coin gold diamond diamonds chain chains ice jewel watch bag bags fortune profit spend save broke poor rent deal deals business boss invest gain flex buy sell' },
  hustle: { icon: '⚙️', words: 'grind hustle work job shift sweat effort plan goal goals mission focus build built climb rise push grind daily early late sleep wake struggle earn chase hunger hungry tired ambition discipline patience progress step steps level' },
  success: { icon: '🏆', words: 'win winner winning top crown king queen throne fame famous star stars legend legacy name champion trophy victory success glory shine boss best greatest made higher peak gold first lead' },
  struggle: { icon: '🌧️', words: 'pain hurt cry tears struggle fall fell broke bottom dark cold alone lonely lost fear doubt scar scars storm rain fight fought survive pressure weight burden trouble hard sorrow bleed wound grief stress' },
  dreams: { icon: '✨', words: 'dream dreams vision hope wish believe faith future destiny sky stars fly heaven goal imagine purpose chance light shine' },
  love: { icon: '❤️', words: 'love heart baby girl kiss touch hold miss lover romance soul forever together beautiful eyes smile tender trust kiss sweet honey darling babe affection passion desire' },
  family: { icon: '👪', words: 'mama mom mother father dad brother sister family son daughter kids home blood grandma cousin crew squad homie friend friends loyal loyalty' },
  street: { icon: '🏙️', words: 'street streets block hood corner city town avenue alley concrete neighborhood projects ghetto trap gang crew cops siren sirens gun guns war beef enemy enemies' },
  party: { icon: '🎉', words: 'party club dance floor night drink drinks bottle bottles cup toast vibe vibes lit turn wild crowd shot shots celebrate dj speakers loud fun' },
  music: { icon: '🎤', words: 'mic beat beats bars verse rhyme rhymes flow song songs track stage studio record sound bass rap rapper hook melody rhythm crowd tour album' },
  ride: { icon: '🚗', words: 'car cars ride whip wheel wheels drive speed road highway engine gas lane fast roll rolling cruise window windows seat' },
  night: { icon: '🌙', words: 'night moon midnight dark late stars sky city lights dream sleep shadow shadows evening dusk dawn neon' },
  time: { icon: '⏳', words: 'time clock hour hours day days year years past future moment memory memories young old age forever yesterday tomorrow today minute' },
  faith: { icon: '🙏', words: 'god pray prayer faith bless blessed blessing heaven angel soul spirit grace church believe lord holy sin devil' },
  fight: { icon: '🥊', words: 'fight battle war enemy enemies strong strength power warrior soldier weapon blade sword armor defend attack beat win lose rival rivals' },
  nature: { icon: '🌊', words: 'sun moon sky ocean sea wave waves river fire flame rain storm wind tree trees mountain earth stone water ice snow cold heat summer winter' },
};

/** Each word's themes, built once. */
let index = null;
export function themeIndex() {
  if (index) return index;
  index = new Map();
  for (const [name, t] of Object.entries(THEMES)) for (const w of t.words.split(/\s+/).filter(Boolean)) {
    if (!index.has(w)) index.set(w, new Set());
    index.get(w).add(name);
  }
  return index;
}
