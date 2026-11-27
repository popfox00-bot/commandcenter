// The speaking-voice picker (Edit profile → Speaking voice → Choose…): every voice as a card, its name and a few
// words describing it (warm · deep · British · man), filtered by those words, by kind (natural, blends, this
// phone's) and by a search; ▶ plays a line in it, Use picks it. Resolves to the voice ('n:<id>' or 'p:<id>'),
// '' (its own, picked from its username), or null (closed without picking).

import { el, fill } from '../../lib/dom.js';
import { NATURAL, phoneVoicesReady, phoneTags, naturalDownloaded, speak, stopSpeaking, naturalReady, naturalLoad } from './socials-speech.js';

/** Every voice to choose from, described: [{ value, name, kind ('natural' | 'blend' | 'phone'), tags, best }]. */
export async function voiceCatalog() {
  const nat = await naturalDownloaded();
  const out = nat ? NATURAL.map((v) => ({ value: `n:${v.id}`, name: v.name, kind: v.blend ? 'blend' : 'natural', tags: v.tags, best: v.best })) : [];
  for (const v of await phoneVoicesReady()) out.push({ value: `p:${v.id}`, name: v.name.replace(/\s*\((enhanced|premium|compact)\)/i, ''), kind: 'phone', tags: phoneTags(v), best: /\((enhanced|premium)\)/i.test(v.name) });
  return out;
}

/** The voices that fit: `kind` ('' all, 'natural' (blends too), 'blend', 'phone'), `tags` (all of them), `q` (name or tag). */
export function filterVoices(list, { kind = '', tags = [], q = '' } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((v) => (!kind || (kind === 'natural' ? v.kind !== 'phone' : v.kind === kind))
    && tags.every((t) => v.tags.includes(t))
    && words.every((w) => v.name.toLowerCase().includes(w) || v.tags.some((t) => t.toLowerCase().startsWith(w))));
}

/** The words most often describing `list` (to filter by), the most first. */
export function commonTags(list, n = 16) {
  const count = new Map(); for (const v of list) for (const t of v.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count].filter(([, c]) => c < list.length && (c > 1 || list.length <= 12)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([t]) => t);
}

/**
 * The picker, as a dialog: `current` (its voice now), `who` (the account as it stands: its handle, voice, speed
 * and pitch, for ▶).
 */
export function pickVoice({ current = '', who = {} } = {}) {
  return new Promise((resolve) => {
    let picked = null; let kind = ''; let tags = []; let q = ''; let all = [];
    const search = el('input', { type: 'search', class: 'so-input', placeholder: 'Search voices (a name or a word: deep, British…)', 'aria-label': 'Search voices' });
    const kinds = el('div', { class: 'row wrap vp-chips', role: 'group', 'aria-label': 'Kind of voice' });
    const tagRow = el('div', { class: 'row wrap vp-chips', role: 'group', 'aria-label': 'Describing words' });
    const note = el('p', { class: 'small muted', 'aria-live': 'polite' });
    const list = el('ul', { class: 'vp-list', 'aria-label': 'Voices' });
    const dlg = el('dialog', { class: 'ed-dialog vp-dialog', 'aria-label': 'Speaking voice' }, el('div', { class: 'sheet' },
      el('div', { class: 'row space' }, el('h2', { text: '🗣 Speaking voice' }), el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', text: '✕', onclick: () => dlg.close() })),
      search, kinds, tagRow, note, list));
    dlg.addEventListener('close', () => { stopSpeaking(); dlg.remove(); resolve(picked); });
    search.addEventListener('input', () => { q = search.value; paint(); });
    const chip = (label, on, onclick, extra = {}) => el('button', { type: 'button', class: `btn small-btn sv-chip${on ? ' on' : ''}`, 'aria-pressed': String(on), text: label, onclick, ...extra });
    let playing = null;
    const play = async (b, value) => {
      if (playing === b) { stopSpeaking(); return; }
      playing?.classList.remove('on'); playing = b; b.classList.add('on');
      if (value.startsWith('n:') && !naturalReady()) { b.textContent = '…'; await naturalLoad().catch(() => {}); b.textContent = '▶'; }
      await speak(`Hi, I'm ${who.handle || 'your account'}. This is how I'd sound.`, { ...who, speech: { ...(who.speech ?? {}), voice: value || undefined } }, { natural: value.startsWith('n:') }).catch(() => {});
      if (playing === b) { playing = null; b.classList.remove('on'); }
    };
    const card = (v) => el('li', { class: `vp-card${current === v.value ? ' on' : ''}` },
      el('span', { class: 'vp-text' },
        el('strong', { text: `${v.name}${v.best ? ' ★' : ''}` }), el('span', { class: 'small muted vp-kind', text: v.kind === 'phone' ? ' · this phone' : v.kind === 'blend' ? ' · natural blend' : v.value ? ' · natural' : '' }),
        el('span', { class: 'vp-tags' }, v.tags.map((t) => el('span', { class: 'vp-tag', text: t })))),
      el('span', { class: 'row vp-acts' },
        v.value ? el('button', { type: 'button', class: 'btn small-btn', text: '▶', 'aria-label': `Play ${v.name}`, onclick: (e) => play(e.currentTarget, v.value) }) : null,
        el('button', { type: 'button', class: `btn small-btn${current === v.value ? '' : ' primary'}`, text: current === v.value ? '✓ In use' : 'Use', 'aria-label': `Use ${v.name}`, onclick: () => { picked = v.value; dlg.close(); } })));
    function paint() {
      fill(kinds, [['', 'All'], ['natural', '🗣 Natural'], ['blend', '🧪 Blends'], ['phone', '📱 This phone']].filter(([k]) => !k || all.some((v) => (k === 'natural' ? v.kind !== 'phone' : v.kind === k)))
        .map(([k, t]) => chip(t, kind === k, () => { kind = k; tags = []; paint(); })));
      const inKind = filterVoices(all, { kind });
      fill(tagRow, commonTags(inKind).map((t) => chip(t, tags.includes(t), () => { tags = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]; paint(); })));
      const shown = filterVoices(all, { kind, tags, q });
      note.textContent = `${shown.length} voice${shown.length === 1 ? '' : 's'}${tags.length ? ` · ${tags.join(' · ')}` : ''}${all.some((v) => v.kind !== 'phone') ? '' : ' · download the natural voices (Sync and password) for 43 more'}.`;
      fill(list, (kind || tags.length || q ? [] : [card({ value: '', name: 'Its own', kind: '', tags: ['picked from its username'], best: false })]).concat(shown.slice(0, 120).map(card)));
    }
    document.body.append(dlg); dlg.showModal(); fill(list, el('li', { class: 'muted small', text: 'Finding the voices…' }));
    voiceCatalog().then((c) => { all = c; paint(); search.focus(); });
  });
}

/** A voice described in a line (for the profile): "Harbor · warm · polished · soft · transatlantic · woman", or its own. */
export async function describeVoice(value) {
  if (!value) return 'Its own (picked from its username)';
  const v = (await voiceCatalog()).find((x) => x.value === value);
  return v ? [v.name, ...v.tags.slice(0, 5)].join(' · ') : 'Its own (that voice isn\'t on this phone)';
}
