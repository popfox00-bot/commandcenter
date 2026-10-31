// Rap app: write lyrics line by line, big and white like a lyrics view (the line you're on in focus,
// the ones before smaller and grayed above it), with suggestions as you go: the next word, endings
// that complete the line on a rhyme, and a bank of words that rhyme with your last word (or any word
// you tap). Songs are kept on this phone. Everything works offline. Routes: #/rap (Create), #/rap/songs.

import { el, fill, store } from '../../lib/dom.js';
import { parseWords, tokens, syllables, rhymesFor, rhymeTarget, buildModel, nextWords, completeLine } from './rap-core.js';
import { LINES, ENDINGS } from './rap-corpus.js';

const SONGS_KEY = 'cc.rap.songs';
const CURRENT_KEY = 'cc.rap.current';
const EXPLICIT_KEY = 'cc.rap.explicit';

let dictPromise = null;
/** The word list, fetched once (precached, so offline too). */
const loadDict = () => (dictPromise ??= fetch(new URL('./rap-words.txt', import.meta.url)).then((r) => { if (!r.ok) throw new Error(`Couldn't load the word list (${r.status}).`); return r.text(); }).then(parseWords));

const uid = () => crypto.randomUUID();
const loadSongs = () => { const s = store.json(SONGS_KEY, []); return Array.isArray(s) ? s : []; };
const saveSongs = (songs) => store.set(SONGS_KEY, JSON.stringify(songs));

export function mount(host) {
  let songs = loadSongs();
  let song = songs.find((s) => s.id === store.get(CURRENT_KEY)) ?? null;
  let at = song ? Math.max(0, song.lines.length - 1) : 0; // the line being written
  let rhymeWord = null;      // a word tapped for the rhyme bank (null: the last word written)
  let explicit = store.get(EXPLICIT_KEY) === 'on';
  let dict = null; let model = null; let saveTimer = 0;

  const root = el('div', { class: 'rap' });
  host.append(root);

  const newSong = () => ({ id: uid(), title: '', lines: [''], created: Date.now(), updated: Date.now() });
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!song) return;
      song.updated = Date.now();
      const empty = !song.title.trim() && song.lines.every((l) => !l.trim());
      songs = songs.filter((s) => s.id !== song.id);
      if (!empty) songs.unshift(song);
      saveSongs(songs);
      store.set(CURRENT_KEY, song.id);
    }, 300);
  }
  /** What suggestions learn from: the built-in lines and every saved song (your style). */
  function relearn() { model = buildModel([...LINES, ...songs.flatMap((s) => s.lines)]); }

  // ---------- routes ----------

  const view = () => (location.hash.split('/')[2] === 'songs' ? 'songs' : 'create');
  function show() {
    const tabs = el('div', { class: 'segmented rap-tabs', role: 'tablist' },
      ...[['create', '✍️ Create', '#/rap'], ['songs', '💾 Saved Songs', '#/rap/songs']].map(([id, label, href]) => el('a', {
        class: `seg${view() === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(view() === id), text: label, href,
      })));
    if (view() === 'songs') fill(root, tabs, songsView());
    else { song ??= newSong(); fill(root, tabs, createView()); }
  }

  // ---------- Saved Songs ----------

  function songsView() {
    const list = songs.length ? el('ul', { class: 'rap-songs' }, ...songs.map((s) => el('li', { class: 'card rap-song' },
      el('button', { class: 'rap-song-open', 'aria-label': `Open ${s.title || 'Untitled'}`, onclick: () => { song = s; at = Math.max(0, s.lines.length - 1); rhymeWord = null; store.set(CURRENT_KEY, s.id); location.hash = '#/rap'; } },
        el('strong', { text: s.title || 'Untitled' }),
        el('span', { class: 'muted small', text: s.lines.find((l) => l.trim()) ?? '' }),
        el('span', { class: 'muted small', text: `${s.lines.filter((l) => l.trim()).length} lines · ${new Date(s.updated).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}` })),
      el('div', { class: 'row' },
        el('button', { class: 'btn small-btn ghost', text: 'Share', onclick: () => shareSong(s) }),
        el('button', { class: 'btn small-btn ghost bad-text', text: 'Delete', 'aria-label': `Delete ${s.title || 'Untitled'}`, onclick: () => {
          if (!confirm(`Delete "${s.title || 'Untitled'}"?`)) return;
          songs = songs.filter((x) => x.id !== s.id); saveSongs(songs);
          if (song?.id === s.id) { song = null; store.set(CURRENT_KEY, ''); }
          show();
        } }))))) : el('p', { class: 'muted small', text: 'No songs yet. Write one in Create: it\'s kept here as you go.' });
    return el('div', { class: 'rap-saved' },
      el('button', { class: 'btn primary block', text: '+ New song', onclick: () => { song = newSong(); at = 0; rhymeWord = null; location.hash = '#/rap'; } }),
      list);
  }

  async function shareSong(s) {
    const text = `${s.title || 'Untitled'}\n\n${s.lines.join('\n').trim()}\n`;
    try { if (navigator.share) { await navigator.share({ title: s.title || 'Untitled', text }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(text); alert('Copied the lyrics.'); } catch { /* nothing to do */ }
  }

  // ---------- Create ----------

  let stage; let input; let dock; let lineEls = [];

  function createView() {
    const title = el('input', { class: 'rap-title', placeholder: 'Untitled', value: song.title, 'aria-label': 'Song title', maxlength: '80' });
    title.addEventListener('input', () => { song.title = title.value; persist(); });
    stage = el('div', { class: 'rap-stage', 'aria-label': 'Lyrics' });
    dock = el('div', { class: 'rap-dock' });
    const bar = el('div', { class: 'row space rap-bar' }, title,
      el('div', { class: 'row' },
        el('button', { class: `chip${explicit ? ' active' : ''}`, 'aria-pressed': String(explicit), title: 'Explicit words in suggestions', text: '🅴', onclick: (e) => { explicit = !explicit; store.set(EXPLICIT_KEY, explicit ? 'on' : 'off'); e.currentTarget.classList.toggle('active', explicit); e.currentTarget.setAttribute('aria-pressed', String(explicit)); suggest(); } }),
        el('button', { class: 'btn small-btn ghost', text: 'New', onclick: () => { if (song.lines.some((l) => l.trim()) && !confirm('Start a new song? This one is saved in Saved Songs.')) return; persist(); song = newSong(); at = 0; rhymeWord = null; show(); } })));
    renderLines();
    if (!dict) loadDict().then((d) => { dict = d; relearn(); suggest(); }).catch((err) => fill(dock, el('p', { class: 'small bad-text', text: err.message })));
    else { relearn(); queueMicrotask(suggest); }
    keepAboveKeyboard();
    return el('div', { class: 'rap-create' }, bar, stage, dock);
  }

  /** The lines: the one being written is a text box, the others text (tap a word: its rhymes). */
  function renderLines() {
    lineEls = song.lines.map((text, i) => {
      if (i === at) {
        input = el('textarea', { class: 'rap-line rap-current', rows: '1', 'aria-label': `Line ${i + 1}`, placeholder: i ? 'Next line…' : 'Write your first line…', enterkeyhint: 'enter', autocapitalize: 'sentences', spellcheck: 'false' });
        input.value = text;
        input.addEventListener('input', () => { song.lines[at] = input.value.replace(/\n/g, ' '); grow(); persist(); suggest(); });
        input.addEventListener('keydown', onKey);
        input.addEventListener('select', () => { const w = input.value.slice(input.selectionStart, input.selectionEnd).trim(); if (/^[a-z']+$/i.test(w)) { rhymeWord = w.toLowerCase(); suggest(); } });
        return el('div', { class: 'rap-row is-current' }, input, el('span', { class: 'rap-syl', 'aria-label': 'Syllables' }));
      }
      const d = i - at;
      const words = text.split(/(\s+)/).map((part) => (/\S/.test(part)
        ? el('span', { class: 'rap-word', text: part, onclick: (e) => { e.stopPropagation(); const w = tokens(part)[0]; if (w) { rhymeWord = w; suggest(); markWord(); } } })
        : part));
      return el('div', { class: `rap-row ${d < 0 ? 'is-before' : 'is-after'} rap-d${Math.min(4, Math.abs(d))}`, ondblclick: () => editLine(i) },
        el('p', { class: 'rap-line' }, ...(text ? words : [el('span', { class: 'rap-blank', text: '·' })])),
        el('button', { class: 'rap-edit', 'aria-label': `Edit line ${i + 1}`, text: '✎', onclick: () => editLine(i) }));
    });
    fill(stage, el('div', { class: 'rap-pad' }), ...lineEls, el('div', { class: 'rap-pad' }));
    markWord();
    requestAnimationFrame(() => { grow(); input.focus({ preventScroll: true }); const n = input.value.length; input.setSelectionRange(n, n); focusLine(); });
  }
  function grow() { if (!input) return; input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; }
  /** Scroll so the line being written sits a little above the middle; the lines before it show above. */
  function focusLine(smooth = true) {
    const row = input?.closest('.rap-row'); if (!row) return;
    const top = row.offsetTop - stage.clientHeight * 0.42 + row.offsetHeight / 2;
    stage.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }
  function markWord() { for (const s of stage?.querySelectorAll('.rap-word') ?? []) s.classList.toggle('picked', !!rhymeWord && tokens(s.textContent)[0] === rhymeWord); }
  function editLine(i) { at = i; rhymeWord = null; renderLines(); suggest(); }

  function onKey(e) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      // A new line after this one (what's after the cursor goes with it).
      const pos = input.selectionStart; const v = input.value;
      song.lines[at] = v.slice(0, pos).trimEnd();
      song.lines.splice(at + 1, 0, v.slice(pos).trimStart());
      at += 1; rhymeWord = null;
      persist(); renderLines(); suggest();
    } else if (e.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0 && at > 0) {
      // At the start of a line: join it to the line before.
      e.preventDefault();
      const prev = song.lines[at - 1]; const rest = input.value;
      song.lines.splice(at, 1);
      at -= 1; song.lines[at] = rest ? `${prev} ${rest}`.trim() : prev;
      persist(); renderLines(); suggest();
      requestAnimationFrame(() => { input.setSelectionRange(prev.length, prev.length); });
    } else if (e.key === 'ArrowUp' && at > 0 && input.selectionStart === 0) { e.preventDefault(); editLine(at - 1); }
    else if (e.key === 'ArrowDown' && at < song.lines.length - 1 && input.selectionStart === input.value.length) { e.preventDefault(); editLine(at + 1); }
  }

  /** Add words to the line being written (with a space before them if needed), and keep writing. */
  function insert(text) {
    const v = input.value;
    // A suggestion that finishes a word already started replaces that start.
    const partial = /([a-z']+)$/i.exec(v)?.[1] ?? '';
    const base = partial && text.toLowerCase().startsWith(partial.toLowerCase()) && !/\s$/.test(v) ? v.slice(0, -partial.length) : v;
    input.value = `${base}${base && !/\s$/.test(base) ? ' ' : ''}${text} `;
    song.lines[at] = input.value.trimEnd();
    grow(); persist(); suggest();
    input.focus({ preventScroll: true });
    const n = input.value.length; input.setSelectionRange(n, n);
  }

  // ---------- suggestions ----------

  function suggest() {
    if (!dock?.isConnected || !input) return;
    for (const [i, row] of lineEls.entries()) if (row.classList.contains('is-current')) row.querySelector('.rap-syl').textContent = dict ? String(syllables(dict, song.lines[i] ?? '') || '') : '';
    if (!dict) { fill(dock, el('p', { class: 'small muted', text: 'Loading words…' })); return; }
    const text = input.value;
    const done = /\s$/.test(text) || !text; // a word just finished
    const words = tokens(text);
    const before = done ? words : words.slice(0, -1);
    const target = rhymeTarget(dict, song.lines, at);
    const targetSyl = at > 0 ? syllables(dict, song.lines[at - 1]) : 0;
    let next = nextWords(model, dict, before, { target, targetSyl, explicit, n: 6 });
    // Mid-word: the suggestions that start with what's typed so far.
    if (!done && words.length) { const p = words.at(-1); const starting = next.filter((w) => w.startsWith(p) && w !== p); next = starting.length ? starting : next; }
    const lines = completeLine(model, dict, before, { target, targetSyl, explicit, endings: ENDINGS, n: 3 });
    // The rhyme bank: the word tapped, else the last word written on this line, else the line before.
    const auto = (done ? words.at(-1) : words.at(-2)) ?? tokens(song.lines[at - 1] ?? '').at(-1) ?? null;
    const rw = rhymeWord ?? auto;
    const r = rw ? rhymesFor(dict, rw, { explicit, max: 40 }) : null;
    const chip = (raw, cls = '') => { const w = raw.replace(/^i('|$)/, 'I$1'); return el('button', { class: `chip rap-chip ${cls}`, text: w, onpointerdown: (e) => e.preventDefault(), onclick: () => insert(w) }); };
    const bankInput = el('input', { class: 'rap-bank-word', value: rw ?? '', placeholder: 'word', 'aria-label': 'Rhymes for', enterkeyhint: 'search' });
    bankInput.addEventListener('change', () => { rhymeWord = tokens(bankInput.value)[0] ?? null; suggest(); markWord(); });
    fill(dock,
      el('section', { class: 'rap-sugg', 'aria-label': 'Suggestions' },
        el('h3', { text: 'Suggestions' }),
        el('div', { class: 'rap-chips' }, ...next.slice(0, 4).map((w) => chip(w))),
        el('h4', { text: target ? `Complete the line · rhymes with “${target}”` : 'Complete the line' }),
        lines.length ? el('div', { class: 'rap-completes' }, ...lines.map((l) => el('button', { class: 'rap-complete', onpointerdown: (e) => e.preventDefault(), onclick: () => insert(l) }, `… ${l}`))) : el('p', { class: 'small muted', text: 'Keep writing…' })),
      el('section', { class: 'rap-bank', 'aria-label': 'Rhymes' },
        el('h3', {}, 'Rhymes · ', bankInput, rhymeWord ? el('button', { class: 'linkish small', text: '↺ last word', onclick: () => { rhymeWord = null; suggest(); markWord(); } }) : null),
        r ? el('div', { class: 'rap-bank-list' },
          ...r.perfect.slice(0, 24).map((e) => chip(e.word)),
          r.near.length ? el('span', { class: 'rap-near-label small muted', text: 'near' }) : null,
          ...r.near.slice(0, 16).map((e) => chip(e.word, 'near')),
          !r.perfect.length && !r.near.length ? el('p', { class: 'small muted', text: 'No rhymes found.' }) : null)
          : el('p', { class: 'small muted', text: 'Write a word, or tap one in your lines.' })));
    focusLine();
  }

  /** On a phone, the suggestions stay just above the keyboard. */
  function keepAboveKeyboard() {
    const vv = window.visualViewport; if (!vv) return;
    const place = () => { if (!dock?.isConnected) { vv.removeEventListener('resize', place); vv.removeEventListener('scroll', place); return; } dock.style.setProperty('--kb', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`); };
    vv.addEventListener('resize', place); vv.addEventListener('scroll', place); place();
  }

  const onHash = () => { if (/^#\/rap(\/|$)/.test(location.hash)) show(); };
  window.addEventListener('hashchange', onHash);
  show();
  return () => { window.removeEventListener('hashchange', onHash); clearTimeout(saveTimer); if (song) { const empty = !song.title.trim() && song.lines.every((l) => !l.trim()); if (!empty) { songs = [song, ...songs.filter((s) => s.id !== song.id)]; saveSongs(songs); } } };
}
