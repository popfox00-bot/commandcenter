// Clock: a picture for each place, drawn here (vector art: no images fetched, it works offline): Colorado's
// mountains, California's Golden Gate Bridge, New York's Statue of Liberty, Hawaii's palms and volcano, London's
// Big Ben, Germany's Brandenburg Gate, Romania's Carpathians and Bran Castle, Paris' Eiffel Tower, Tokyo's Mount
// Fuji, a desert for Arizona, a city skyline for anywhere else. Its sky follows the time there (day, sunrise or
// sunset, night with stars), and the time is written over a dark shade, so it's always clear to read.

const KEYS = [
  ['mountains', /colorado|denver|utah|wyoming|montana|idaho|boise|calgary|switzerland|austria|nepal|chile|new mexico|alaska|anchorage|norway/i],
  ['goldengate', /california|san francisco|los angeles|oregon|washington$|seattle|vancouver|nevada|las vegas/i],
  ['liberty', /new york|washington, d\.c\.|boston|massachusetts|pennsylvania|new jersey|toronto|montreal/i],
  ['hawaii', /hawaii|honolulu|fiji|guam|bali|jamaica|puerto rico|cancún|cancun|costa rica|florida|miami/i],
  ['london', /london|united kingdom|england|ireland|dublin/i],
  ['gate', /germany|berlin|munich|frankfurt|europe\/berlin/i],
  ['castle', /romania|bucharest|moldova|bulgaria|hungary|czech|serbia|croatia|ukraine/i],
  ['eiffel', /paris|france/i],
  ['fuji', /tokyo|japan|seoul|korea/i],
  ['desert', /arizona|phoenix|dubai|emirates|saudi|qatar|egypt|morocco|texas|dallas|houston/i],
];
const BY_ZONE = { 'America/Denver': 'mountains', 'America/Los_Angeles': 'goldengate', 'America/New_York': 'liberty', 'Pacific/Honolulu': 'hawaii', 'Europe/London': 'london', 'Europe/Berlin': 'gate', 'Europe/Bucharest': 'castle', 'Europe/Paris': 'eiffel', 'Asia/Tokyo': 'fuji', 'America/Phoenix': 'desert' };

/** The scene for a place: by its name, else its time zone, else the city. */
export function sceneOf(place) {
  for (const [k, re] of KEYS) if (re.test(place.name)) return k;
  return BY_ZONE[place.zone] ?? 'city';
}

/** The time of day for a sky: 'night' | 'dawn' | 'day' | 'dusk' by the hour there. */
export const skyOf = (h) => (h < 5 || h >= 21 ? 'night' : h < 7 ? 'dawn' : h < 17 ? 'day' : 'dusk');

const SKIES = {
  night: { top: '#081028', bot: '#1f3060', ink: '#030712', far: '#0b1733', sun: false },
  dawn: { top: '#5b4bd6', bot: '#fb923c', ink: '#1c1534', far: '#4c2f63', sun: true },
  day: { top: '#2563eb', bot: '#93c5fd', ink: '#16233b', far: '#3d5a86', sun: true },
  dusk: { top: '#4c1d95', bot: '#f97316', ink: '#1b0f2c', far: '#5b2149', sun: true },
};

const STARS = '<g fill="#fff" opacity=".8"><circle cx="40" cy="25" r="1"/><circle cx="90" cy="50" r=".8"/><circle cx="150" cy="18" r="1.2"/><circle cx="210" cy="40" r=".7"/><circle cx="260" cy="15" r="1"/><circle cx="330" cy="35" r=".9"/><circle cx="375" cy="20" r="1.1"/><circle cx="120" cy="80" r=".7"/><circle cx="300" cy="70" r=".8"/></g>';

/** The art for each scene (viewBox 400×220; the bottom-right holds the landmark, the left stays clear). */
function art(k, s) {
  const ink = s.ink; const far = s.far;
  switch (k) {
    case 'mountains': return `
      <path fill="${far}" d="M0 220V140l50-40 40 30 50-55 45 50 40-35 50 45 45-40 40 30 40-25v120z"/>
      <path fill="${ink}" d="M0 220V170l70-55 35 30 70-80 55 70 45-40 60 60 35-25 30 20v80z"/>
      <path fill="#f8fafc" opacity=".85" d="M175 65l-16 20 8-2 7 9 9-10 7 5zM280 105l-12 13 7-1 5 6 6-7 6 3z"/>
      <path fill="${ink}" d="M330 220l12-40 12 40zM355 220l10-32 10 32zM300 220l9-28 9 28z"/>`;
    case 'goldengate': return `
      <rect y="178" width="400" height="42" fill="${far}"/>
      <path fill="none" stroke="${s.sun ? '#c2410c' : ink}" stroke-width="3" d="M0 150Q70 156 130 60Q215 170 300 60Q350 140 400 132"/>
      <g fill="${s.sun ? '#c2410c' : ink}"><rect x="124" y="56" width="12" height="130"/><rect x="294" y="56" width="12" height="130"/>
      <rect x="120" y="80" width="20" height="5"/><rect x="120" y="110" width="20" height="5"/><rect x="290" y="80" width="20" height="5"/><rect x="290" y="110" width="20" height="5"/>
      <rect y="160" width="400" height="7"/></g>
      <g stroke="${s.sun ? '#c2410c' : ink}" stroke-width="1" opacity=".8"><path d="M150 160V96M170 160V122M190 160V140M210 160V145M230 160V140M250 160V122M270 160V96M320 160V86M340 160V106M360 160V120M380 160V128M110 160V96M90 160V122M70 160V138M50 160V146M30 160V150"/></g>`;
    case 'liberty': return `
      <g fill="${far}"><rect x="20" y="140" width="22" height="80"/><rect x="46" y="110" width="18" height="110"/><rect x="68" y="130" width="26" height="90"/><rect x="98" y="95" width="14" height="125"/><path d="M103 95l2-25 2 25z"/><rect x="116" y="125" width="24" height="95"/><rect x="144" y="150" width="30" height="70"/></g>
      <g fill="${ink}"><path d="M280 220l10-40h60l10 40z"/><rect x="297" y="160" width="46" height="22"/>
      <path d="M305 160l4-60c2-10 6-14 11-14s9 4 11 14l4 60z"/><circle cx="320" cy="80" r="9"/>
      <path d="M311 74l-6-9 9 6zM316 71l-2-11 5 10zM322 71l2-11 2 11zM327 72l6-9-3 10z"/>
      <path d="M327 100l14-50 6 2-12 50z"/><path d="M338 48l6-12 7 4-5 11z"/></g>
      <path fill="#fbbf24" d="M345 34c-3-6 2-10 3-14 3 5 6 8 2 14z"/>`;
    case 'hawaii': return `
      <path fill="${far}" d="M0 185l70-60c20-15 40-15 60 0l70 60z"/>
      <rect y="185" width="400" height="35" fill="${far}" opacity=".9"/>
      <path fill="none" stroke="#e0f2fe" stroke-opacity=".5" stroke-width="2" d="M0 198q20-6 40 0t40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0"/>
      <g fill="${ink}"><path d="M300 220c6-40 4-80-6-120l6-2c12 40 14 80 8 122z"/>
      <path d="M296 100c-25-10-45-2-60 12 20-5 38-6 56-2zM297 98c-10-20-30-28-48-26 18 8 32 16 44 30zM300 98c5-22 22-34 42-36-14 10-26 22-36 38zM302 100c22-6 42 2 56 18-18-8-36-10-54-12zM298 102c-8 14-10 30-6 46-8-16-8-32 2-48z"/>
      <path d="M355 220c3-30 2-55-4-80l5-1c7 25 8 52 5 81z"/><path d="M352 140c-18-6-32 0-42 10 14-4 28-4 40-1zM354 139c4-16 16-24 30-25-10 7-19 15-26 27zM356 141c16-3 30 3 40 15-12-6-26-8-38-10z"/></g>`;
    case 'london': return `
      <g fill="${far}"><rect x="0" y="170" width="250" height="50"/><path d="M10 170l5-14 5 14zM40 170l5-18 5 18zM70 170l5-14 5 14zM100 170l5-18 5 18zM130 170l5-14 5 14zM160 170l5-18 5 18zM190 170l5-14 5 14zM220 170l5-18 5 18z"/></g>
      <g fill="${ink}"><rect x="300" y="80" width="40" height="140"/><rect x="296" y="70" width="48" height="16"/><path d="M298 70l22-34 22 34z"/><path d="M318 36l2-16 2 16z"/>
      <rect x="250" y="160" width="150" height="60"/></g>
      <circle cx="320" cy="106" r="13" fill="#fde68a" opacity="${s.sun ? '.9' : '.95'}"/><path stroke="${ink}" stroke-width="2" d="M320 106v-9M320 106l6 4"/>`;
    case 'gate': return `
      <g fill="${far}"><rect x="0" y="175" width="400" height="45"/></g>
      <g fill="${ink}"><rect x="220" y="110" width="170" height="16"/><rect x="214" y="126" width="182" height="8"/>
      <rect x="226" y="134" width="12" height="70"/><rect x="254" y="134" width="12" height="70"/><rect x="282" y="134" width="12" height="70"/><rect x="316" y="134" width="12" height="70"/><rect x="344" y="134" width="12" height="70"/><rect x="372" y="134" width="12" height="70"/>
      <rect x="214" y="204" width="182" height="16"/><rect x="270" y="96" width="70" height="14"/>
      <path d="M285 96c2-14 8-20 14-22l4-10 4 10c6 2 12 8 14 22z"/></g>`;
    case 'castle': return `
      <path fill="${far}" d="M0 220V150l60-40 50 30 60-50 60 45 50-30 60 40 60-30v125z"/>
      <path fill="${ink}" d="M0 220v-40c60-30 120-20 180 5 60 20 140 15 220-15v50z"/>
      <g fill="${ink}"><rect x="275" y="120" width="70" height="70"/><rect x="265" y="100" width="22" height="70"/><path d="M262 100l14-28 14 28z"/>
      <rect x="320" y="92" width="26" height="60"/><path d="M316 92l17-32 17 32z"/><rect x="295" y="108" width="18" height="30"/><path d="M292 108l12-20 12 20z"/></g>
      <g fill="#fde68a" opacity="${s.sun ? '.0' : '.9'}"><rect x="300" y="140" width="5" height="8"/><rect x="330" y="118" width="5" height="8"/><rect x="272" y="125" width="4" height="7"/></g>`;
    case 'eiffel': return `
      <rect y="190" width="400" height="30" fill="${far}"/>
      <g fill="${ink}"><path d="M300 30l4 40h-8zM296 70h8l10 60h-28zM286 130h28l26 90h-18c-4-25-14-38-22-38s-18 13-22 38h-18z"/><rect x="282" y="126" width="36" height="6"/><rect x="290" y="68" width="20" height="5"/></g>`;
    case 'fuji': return `
      <path fill="${far}" d="M60 220l110-120c10-10 30-10 40 0l110 120z"/>
      <path fill="#f8fafc" opacity=".9" d="M150 122l20-22c10-10 30-10 40 0l20 22-12-6-10 8-10-8-10 8-10-8z"/>
      <g fill="${ink}"><rect x="320" y="150" width="40" height="70"/><path d="M308 150h64l-12-12h-40zM312 130h56l-12-12h-32zM318 112h44l-12-12h-20z"/><path d="M338 100l2-20 2 20z"/></g>
      <rect y="200" width="400" height="20" fill="${ink}"/>`;
    case 'desert': return `
      <path fill="${far}" d="M0 220v-50c80-20 160-25 240-10s120 10 160 0v60z"/>
      <path fill="${ink}" d="M0 220v-25c100-10 200-5 400-20v45z"/>
      <g fill="${ink}"><path d="M300 200v-90c0-8 12-8 12 0v90z"/><path d="M300 150h-14v-30c0-6 8-6 8 0v22h6zM312 140h12v-28c0-6 8-6 8 0v36h-20z"/>
      <path d="M360 205v-50c0-6 9-6 9 0v50z"/><path d="M360 175h-9v-16c0-5 6-5 6 0v10h3z"/></g>`;
    default: return `
      <g fill="${far}"><rect x="150" y="120" width="30" height="100"/><rect x="185" y="90" width="22" height="130"/><rect x="212" y="135" width="28" height="85"/><rect x="245" y="70" width="18" height="150"/><path d="M251 70l3-22 3 22z"/></g>
      <g fill="${ink}"><rect x="200" y="150" width="40" height="70"/><rect x="245" y="125" width="30" height="95"/><rect x="280" y="100" width="25" height="120"/><rect x="310" y="140" width="40" height="80"/><rect x="355" y="115" width="30" height="105"/><rect y="200" width="400" height="20"/></g>
      <g fill="#fde68a" opacity="${s.sun ? '.0' : '.8'}"><rect x="286" y="110" width="4" height="5"/><rect x="295" y="130" width="4" height="5"/><rect x="320" y="150" width="4" height="5"/><rect x="362" y="125" width="4" height="5"/><rect x="252" y="140" width="4" height="5"/></g>`;
  }
}

/** The scene as SVG markup (static, made here), for the time of day `sky`. */
export function sceneSvg(key, sky) {
  const s = SKIES[sky] ?? SKIES.day; const id = `g${key}${sky}`;
  // (Toward the middle: a small card shows only the right of the picture.)
  const orb = sky === 'night' ? '<circle cx="250" cy="34" r="11" fill="#f1f5f9"/><circle cx="256" cy="30" r="10" fill="#14254d"/>' : sky === 'day' ? '<circle cx="240" cy="38" r="14" fill="#fef9c3" opacity=".95"/>' : '<circle cx="230" cy="150" r="20" fill="#fde047" opacity=".85"/>';
  return `<svg viewBox="0 0 400 220" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.top}"/><stop offset="1" stop-color="${s.bot}"/></linearGradient></defs><rect width="400" height="220" fill="url(#${id})"/>${sky === 'night' ? STARS : ''}${orb}${art(key, s)}</svg>`;
}
