// What a photo's pixels and the people in it say, worked out from the maps socials-vision.js reads on the
// phone (pure: give it the numbers). The background apart from the people (sky, sand, water, green, snow, a
// warm sunset sky, a city's greys, night), what they wear (its main colour, how much skin shows: summer or
// covered up), how many people and how they stand (arms up, hands on hips, sitting, head to toe, close up),
// and brand names in text read off their clothes.

/** A colour's name, as people say it ('navy', 'beige'…), from r, g, b (0–255). */
export function colorName(r, g, b) {
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const l = (mx + mn) / 510; const d = mx - mn; const s = d / 255;
  if (l < 0.16) return 'black';
  if (s < 0.12) return l > 0.82 ? 'white' : l < 0.3 ? 'black' : 'gray';
  let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  if (h >= 18 && h < 50 && l > 0.62 && s < 0.5) return 'beige';
  if (h < 15 || h >= 340) return l > 0.7 ? 'pink' : 'red';
  if (h < 40) return l < 0.4 ? 'brown' : s < 0.5 && l > 0.6 ? 'beige' : 'orange';
  if (h < 65) return l < 0.35 ? 'olive' : 'yellow';
  if (h < 165) return l < 0.3 ? 'dark green' : 'green';
  if (h < 200) return 'teal';
  if (h < 250) return l < 0.32 ? 'navy' : 'blue';
  if (h < 290) return 'purple';
  return l > 0.6 ? 'pink' : 'magenta';
}

/**
 * The background (pixels where no person is), as what's in it: ['sky', 'sand', 'water', 'green', 'snow',
 * 'sunset', 'city', 'night'] (those found, most first). `px`: RGBA, w×h; `person`: 0–255 per pixel (how sure
 * it's a person), or null (all background).
 */
export function backgroundOf(px, w, h, person = null) {
  const c = { sky: 0, pale: 0, sand: 0, water: 0, green: 0, snow: 0, sunset: 0, city: 0 }; let n = 0; let top = 0; let low = 0; let lum = 0; let topL = 0; let lowL = 0; let warmL = 0;
  const step = Math.max(1, Math.floor((w * h) / 9000));
  for (let i = 0; i < w * h; i += step) {
    if (person && person[i] > 90) continue;
    const r = px[i * 4]; const g = px[i * 4 + 1]; const b = px[i * 4 + 2]; const y = Math.floor(i / w) / h; const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    n++; lum += L; if (y < 0.45) { top++; topL += L; } else { low++; lowL += L; }
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const s = mx ? (mx - mn) / mx : 0;
    if (y < 0.5) {
      if (b > r + 18 && b >= g && L > 0.45) c.sky++;
      else if (L > 0.78 && s < 0.12) c.pale++; // (a pale or cloudy sky: or a white wall)
      if (r > 170 && r - b > 55 && r >= g && L > 0.45) { c.sunset++; warmL += L; }
    } else {
      if (r > 150 && g > 120 && b > 80 && r > g && g > b && r - b > 30 && r - b < 110 && s < 0.45 && L > 0.5) c.sand++;
      // (Water: a deeper blue, or blue-green; the pale blue of a sky behind someone isn't.)
      if (b > r + 15 && b > g - 10 && L > 0.15 && (L < 0.48 || (g > b * 0.82 && b > r + 40 && L < 0.7))) c.water++;
      if (L > 0.82 && s < 0.08) c.snow++;
    }
    if (g > r + 12 && g > b + 8) c.green++;
    if (s < 0.1 && L > 0.25 && L < 0.7) c.city += 0.4;
  }
  if (!n) return [];
  lum /= n;
  const out = [];
  if (lum < 0.18) out.push(['night', 1]);
  // (A sky is blue somewhere (a white wall isn't one); a sunset's sky is bright and lighter than the ground
  // under it (a warm room or a wooden wall isn't one); snow lies under a sky.)
  const blueTop = c.sky / Math.max(1, top);
  if (blueTop >= 0.08) c.sky += c.pale * 0.6;
  if (!(topL / Math.max(1, top) > (lowL / Math.max(1, low)) * 1.1 && warmL / Math.max(1, c.sunset) > 0.5)) c.sunset = 0;
  if (blueTop < 0.08) c.snow = 0;
  const share = { sky: c.sky / Math.max(1, top), sunset: c.sunset / Math.max(1, top), sand: c.sand / Math.max(1, low), water: c.water / Math.max(1, low), snow: c.snow / Math.max(1, low), green: c.green / n, city: c.city / n };
  const need = { sky: 0.3, sunset: 0.3, sand: 0.22, water: 0.25, snow: 0.3, green: 0.25, city: 0.32 };
  for (const [k, v] of Object.entries(share)) if (v >= need[k]) out.push([k, v]);
  // (A warm sky is a sunset, not a blue one.)
  const has = (k) => out.some(([x]) => x === k);
  return out.filter(([k]) => !(k === 'sky' && has('sunset')) && !(k === 'city' && (has('sand') || has('snow') || has('water')))).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/**
 * What the people wear, from the clothes and skin maps (0–255 per pixel, w×h) over RGBA `px`: { color (its
 * main colour, when one clearly is), skin (how much skin shows: 0–1 of skin and clothes), area (0–1 of the
 * photo that's clothes), box ([x0, y0, x1, y1] of the clothes, 0–1) }, or null with no clothes in sight.
 */
export function outfitOf(px, w, h, clothes, skin) {
  const count = new Map(); let cl = 0; let sk = 0; let x0 = w; let y0 = h; let x1 = 0; let y1 = 0;
  for (let i = 0; i < w * h; i++) {
    if (skin && skin[i] > 140) sk++;
    if (!clothes || clothes[i] < 150) continue;
    cl++; const x = i % w; const y = Math.floor(i / w);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    const name = colorName(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); count.set(name, (count.get(name) ?? 0) + 1);
  }
  if (cl < w * h * 0.02) return null;
  const [top, k] = [...count].sort((a, b) => b[1] - a[1])[0];
  return { color: k / cl >= 0.42 ? top : null, skin: Math.round((sk / (sk + cl)) * 100) / 100, area: Math.round((cl / (w * h)) * 100) / 100, box: [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h] };
}

/**
 * How the people stand, from their poses (pose.js: [{ shoulders, elbows, wrists, hips, knees, ankles, nose }],
 * each point [x, y, seen], in a W×H picture): ['armsup', 'wave', 'hips', 'sitting', 'full', 'close'] for the
 * main one (the biggest), and 'allarmsup' when most of a group have their arms up.
 */
export function posesOf(poses, W, H) {
  if (!poses?.length) return [];
  const seen = (p) => p && p[2] > 0.5 && p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H;
  const width = (p) => Math.abs(p.shoulders[1][0] - p.shoulders[0][0]);
  const up = (p, i) => seen(p.wrists[i]) && seen(p.shoulders[i]) && p.wrists[i][1] < p.shoulders[i][1] - width(p) * 0.25;
  const main = poses.reduce((a, b) => (width(b) > width(a) ? b : a));
  const out = [];
  const u0 = up(main, 0); const u1 = up(main, 1);
  if (u0 && u1) out.push('armsup'); else if (u0 || u1) out.push('wave');
  const sw = width(main);
  if (!u0 && !u1 && [0, 1].every((i) => seen(main.wrists[i]) && seen(main.hips[i]) && Math.hypot(main.wrists[i][0] - main.hips[i][0], main.wrists[i][1] - main.hips[i][1]) < sw * 0.45) && [0, 1].every((i) => seen(main.elbows[i])) && Math.abs(main.elbows[1][0] - main.elbows[0][0]) > sw * 1.25) out.push('hips');
  const hipsSeen = [0, 1].every((i) => seen(main.hips[i])); const kneesSeen = [0, 1].every((i) => seen(main.knees[i]));
  if (hipsSeen && kneesSeen) {
    const torso = Math.abs((main.hips[0][1] + main.hips[1][1]) / 2 - (main.shoulders[0][1] + main.shoulders[1][1]) / 2);
    const thigh = Math.abs((main.knees[0][1] + main.knees[1][1]) / 2 - (main.hips[0][1] + main.hips[1][1]) / 2);
    if (torso > 0 && thigh < torso * 0.45) out.push('sitting');
  }
  if ([0, 1].every((i) => seen(main.ankles[i])) && !out.includes('sitting')) out.push('full');
  if (!hipsSeen && sw > W * 0.35) out.push('close');
  if (poses.length >= 3 && poses.filter((p) => up(p, 0) && up(p, 1)).length >= poses.length * 0.6) out.push('allarmsup');
  return out;
}

/** Brands and teams people wear, as they're written. */
export const BRANDS = ['Nike', 'Adidas', 'Jordan', 'Puma', 'Reebok', 'Under Armour', 'New Balance', 'Asics', 'Vans', 'Converse', 'Champion', 'Patagonia', 'The North Face', 'North Face', 'Columbia', 'Carhartt', 'Supreme', 'Gucci', 'Prada', 'Chanel', 'Louis Vuitton', 'Balenciaga', 'Lululemon', 'Gymshark', 'Levi\'s', 'Ralph Lauren', 'Polo', 'Tommy Hilfiger', 'Calvin Klein', 'Hollister', 'Abercrombie', 'Hurley', 'Quiksilver', 'Billabong', 'Oakley', 'Ray-Ban', 'Fila', 'Kappa', 'Yeezy', 'Stussy', 'Essentials', 'Fear of God', 'Off-White', 'Hoka', 'On Running', 'Arc\'teryx', 'Broncos', 'Nuggets', 'Avalanche', 'Rockies', 'Buffaloes', 'Colorado', 'Rapids', 'Lakers', 'Warriors', 'Celtics', 'Bulls', 'Yankees', 'Dodgers', 'Cowboys', 'Chiefs', 'Packers', '49ers', 'Eagles', 'Steelers', 'Real Madrid', 'Barcelona', 'Manchester United', 'Arsenal', 'Chelsea', 'Liverpool', 'Harvard', 'Stanford', 'Yale', 'NASA', 'Disney', 'Starbucks', 'Coca-Cola'];

/** The brand named in text read off clothes (OCR, so loosely: a whole word, any case), or null. */
export function brandIn(text) {
  const t = ` ${String(text ?? '').replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ')} `.toLowerCase();
  const hit = BRANDS.filter((b) => b.length >= 4 || /^[A-Z0-9]+$/.test(b)).find((b) => t.includes(` ${b.toLowerCase()} `));
  return hit === 'North Face' ? 'The North Face' : hit ?? null;
}
