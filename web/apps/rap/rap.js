// Rap app: write lyrics line by line, big and white like a lyrics view (the line you're on in focus,
// the ones before smaller and grayed above it), each with its rhyme letter (A, B…: the scheme as you
// write it, AABB, ABAB…, near and phrase rhymes counted), and suggestions as you go, on the rhyme the
// scheme calls for and the song's theme: whole next lines, endings that finish the line, the next
// word, and a bank of words that rhyme with your last word (or any word you tap). Tap anywhere in a
// line to edit it there; 🎤 to dictate; New ▸ Import to bring lyrics in from a document or a
// screenshot. Untitled songs get a title from what they're about. Songs are kept on this phone.
// Everything works offline (dictation uses the phone's speech recognition). Routes: #/rap, #/rap/songs.

import { el, fill, store } from '../../lib/dom.js';
import { parseWords, tokens, syllables, rhymesFor, buildModel, nextWords, completeLine, nextLines, rhymeLetters, schemeName, rhymeOptions, rhymeScheme, themesOf, smartTitle } from './rap-core.js';
import { importLyrics, IMPORT_ACCEPT } from './rap-import.js';
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
  let noteOpen = -1;         // the line whose note is showing
  let explicit = store.get(EXPLICIT_KEY) === 'on';
  let pane = 'lines';        // on a phone: the suggestions pane showing ('lines' or 'rhymes')
  let dictation = null;      // speech recognition while dictating
  let dict = null; let model = null; let saveTimer = 0;

  const root = el('div', { class: 'rap' });
  host.append(root);

  const newSong = () => ({ id: uid(), title: '', lines: [''], notes: [''], created: Date.now(), updated: Date.now() });
  /** A note per line (delivery, ad-libs, ideas), kept beside the lines (older songs get them on opening). */
  const notes = () => { song.notes ??= []; while (song.notes.length < song.lines.length) song.notes.push(''); return song.notes; };

  /** The note button at the end of a line, and (when it's open) the note under the line. */
  function noteParts(i) {
    const has = !!notes()[i]?.trim();
    const btn = el('button', { class: `rap-note-btn${has ? ' has-note' : ''}${noteOpen === i ? ' open' : ''}`, 'aria-label': `Note for line ${i + 1}`, 'aria-expanded': String(noteOpen === i), title: has ? 'Note' : 'Add a note', text: '🗒',
      onpointerdown: (e) => e.preventDefault(),
      onclick: (e) => {
        e.stopPropagation(); noteOpen = noteOpen === i ? -1 : i;
        renderLines(input?.selectionStart ?? null); suggest();
        // An opened note is ready to type in (after the line takes its focus back).
        if (noteOpen === i) requestAnimationFrame(() => requestAnimationFrame(() => { const n = stage.querySelector('.rap-note'); if (n) { n.focus({ preventScroll: true }); n.setSelectionRange(n.value.length, n.value.length); } }));
      } });
    if (noteOpen !== i) return [btn];
    const box = el('textarea', { class: 'rap-note', rows: '2', placeholder: 'A note for this line: delivery, ad-libs, ideas…', 'aria-label': `Note for line ${i + 1}` });
    box.value = notes()[i] ?? '';
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('input', () => { notes()[i] = box.value; btn.classList.toggle('has-note', !!box.value.trim()); persist(); });
    return [btn, box];
  }
  /** Save the song being written (soon, or `now`: before switching to another one). */
  function persist(now = false) {
    clearTimeout(saveTimer);
    const write = () => {
      if (!song) return;
      song.updated = Date.now();
      const empty = !song.title.trim() && song.lines.every((l) => !l.trim());
      songs = songs.filter((s) => s.id !== song.id);
      if (!empty) songs.unshift(song);
      saveSongs(songs);
      store.set(CURRENT_KEY, song.id);
    };
    if (now) write(); else saveTimer = setTimeout(write, 300);
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
      el('button', { class: 'rap-song-open', 'aria-label': `Open ${nameOf(s)}`, onclick: () => { startSong(s); store.set(CURRENT_KEY, s.id); location.hash = '#/rap'; } },
        el('strong', { text: nameOf(s) }),
        el('span', { class: 'muted small', text: s.lines.find((l) => l.trim()) ?? '' }),
        el('span', { class: 'muted small', text: `${s.lines.filter((l) => l.trim()).length} lines · ${new Date(s.updated).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}` })),
      el('div', { class: 'row' },
        el('button', { class: 'btn small-btn ghost', text: 'Share', onclick: () => shareSong(s) }),
        el('button', { class: 'btn small-btn ghost bad-text', text: 'Delete', 'aria-label': `Delete ${nameOf(s)}`, onclick: () => {
          if (!confirm(`Delete "${nameOf(s)}"?`)) return;
          songs = songs.filter((x) => x.id !== s.id); saveSongs(songs);
          if (song?.id === s.id) { song = null; store.set(CURRENT_KEY, ''); }
          show();
        } }))))) : el('p', { class: 'muted small', text: 'No songs yet. Write one in Create: it\'s kept here as you go.' });
    return el('div', { class: 'rap-saved' },
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn primary', text: '+ New song', onclick: () => { startSong(newSong()); location.hash = '#/rap'; } }),
        el('button', { class: 'btn', text: '📥 Import', onclick: () => importDialog() })),
      list);
  }
  /** A song's name: its title, else the one worked out from its lines. */
  const nameOf = (s) => s.title?.trim() || s.autoTitle || 'Untitled';
  function startSong(s) { stopDictation(); if (song && song !== s) persist(true); song = s; at = Math.max(0, s.lines.length - 1); rhymeWord = null; noteOpen = -1; }

  /** New ▸ Create new, or Import lyrics from a document or a screenshot. */
  function newMenu() {
    const dlg = el('dialog', { class: 'ed-dialog' }, el('form', { method: 'dialog', class: 'sheet rap-new' },
      el('h2', { text: 'New song' }),
      el('button', { class: 'btn primary block', value: 'new', text: '✍️ Create new' }),
      el('button', { class: 'btn block', value: 'import', text: '📥 Import: a document or a screenshot' }),
      el('p', { class: 'small muted', text: 'Import reads the lyrics from a text file, Word document (.docx), PDF, or a screenshot or photo of lyrics, into a new song.' }),
      el('div', { class: 'row end' }, el('button', { class: 'btn ghost', value: 'cancel', text: 'Cancel' }))));
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (dlg.returnValue === 'new') { startSong(newSong()); show(); } else if (dlg.returnValue === 'import') importDialog();
    });
    document.body.append(dlg); dlg.showModal();
  }

  /** Pick a file and read its lyrics into a new song (a screenshot's text is read on the phone). */
  function importDialog() {
    const file = el('input', { type: 'file', accept: IMPORT_ACCEPT, class: 'visually-hidden', id: 'rap-import-file' });
    const status = el('p', { class: 'small muted', 'aria-live': 'polite' });
    const dlg = el('dialog', { class: 'ed-dialog' }, el('div', { class: 'sheet rap-new' },
      el('h2', { text: 'Import lyrics' }),
      el('p', { class: 'small muted', text: 'A text file, Word document (.docx), PDF, or a screenshot or photo of lyrics. Everything is read on this phone.' }),
      el('label', { class: 'btn primary block', for: 'rap-import-file', text: 'Choose a file or screenshot' }), file, status,
      el('div', { class: 'row end' }, el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => dlg.close() }))));
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      status.className = 'small muted'; status.textContent = /^image\//.test(f.type) ? 'Reading the text in the picture… (a few seconds)' : 'Reading…';
      try {
        const { title, lines } = await importLyrics(f, { onProgress: (p) => { status.textContent = `Reading the text in the picture… ${Math.round(p * 100)}%`; } });
        if (!lines.length) throw new Error('No lyrics found in that file.');
        const s = { ...newSong(), title, lines, notes: lines.map(() => '') };
        startSong(s);
        songs = [s, ...songs]; saveSongs(songs); store.set(CURRENT_KEY, s.id);
        dlg.close();
        if (location.hash !== '#/rap') location.hash = '#/rap'; else show();
      } catch (err) { status.className = 'small bad-text'; status.textContent = err.message; }
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  async function shareSong(s) {
    const text = `${s.title || 'Untitled'}\n\n${s.lines.map((l, i) => (s.notes?.[i]?.trim() ? `${l}   [${s.notes[i].trim()}]` : l)).join('\n').trim()}\n`;
    try { if (navigator.share) { await navigator.share({ title: s.title || 'Untitled', text }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(text); alert('Copied the lyrics.'); } catch { /* nothing to do */ }
  }

  // ---------- Create ----------

  let stage; let input; let dock; let lineEls = [];

  let titleInput;
  function createView() {
    titleInput = el('input', { class: 'rap-title', placeholder: 'Untitled', value: song.title, 'aria-label': 'Song title', maxlength: '80' });
    titleInput.addEventListener('input', () => { song.title = titleInput.value; persist(); });
    const useTitle = el('button', { class: 'chip rap-use-title', title: 'Use the suggested title', 'aria-label': 'Use the suggested title', text: '✨', hidden: true,
      onclick: () => { if (!song.autoTitle) return; song.title = song.autoTitle; titleInput.value = song.title; persist(); suggest(); } });
    stage = el('div', { class: 'rap-stage', 'aria-label': 'Lyrics' });
    dock = el('div', { class: 'rap-dock' });
    const mic = el('button', { class: `chip rap-mic${dictation ? ' active' : ''}`, 'aria-pressed': String(!!dictation), 'aria-label': 'Dictate', title: 'Dictate (speak your lines)', text: '🎤', onclick: () => toggleDictation() });
    const bar = el('div', { class: 'row space rap-bar' },
      el('div', { class: 'row rap-title-row' }, titleInput, useTitle),
      el('div', { class: 'row' },
        el('span', { class: 'rap-scheme', title: 'Rhyme scheme of the last lines', 'aria-label': 'Rhyme scheme' }),
        mic,
        el('button', { class: `chip${explicit ? ' active' : ''}`, 'aria-pressed': String(explicit), title: 'Explicit words in suggestions', text: '🅴', onclick: (e) => { explicit = !explicit; store.set(EXPLICIT_KEY, explicit ? 'on' : 'off'); e.currentTarget.classList.toggle('active', explicit); e.currentTarget.setAttribute('aria-pressed', String(explicit)); suggest(); } }),
        el('button', { class: 'btn small-btn ghost', text: 'New ▸', onclick: newMenu })));
    renderLines();
    if (!dict) loadDict().then((d) => { dict = d; relearn(); suggest(); }).catch((err) => fill(dock, el('p', { class: 'small bad-text', text: err.message })));
    else { relearn(); queueMicrotask(suggest); }
    keepAboveKeyboard();
    return el('div', { class: 'rap-create' }, bar, el('div', { class: 'rap-work' }, stage, dock));
  }

  /**
   * The lines: the one being written is a text box, the others text. Tapping a line edits it with the
   * cursor right where you tapped (and the rhyme bank on the word there). Each line has its rhyme letter.
   */
  function renderLines(caret = null) {
    lineEls = song.lines.map((text, i) => {
      const letter = el('span', { class: 'rap-letter', 'aria-label': 'Rhyme' });
      if (i === at) {
        input = el('textarea', { class: 'rap-line rap-current', rows: '1', 'aria-label': `Line ${i + 1}`, placeholder: i ? 'Next line…' : 'Write your first line…', enterkeyhint: 'enter', autocapitalize: 'sentences', spellcheck: 'false' });
        input.value = text;
        input.addEventListener('input', () => { song.lines[at] = input.value.replace(/\n/g, ' '); grow(); persist(); suggest(); });
        input.addEventListener('keydown', onKey);
        // The cursor moved into a word: the rhyme bank follows it; at the end of the line, the last word.
        const follow = () => {
          const pos = input.selectionStart; const v = input.value;
          const word = (/[a-z']+$/i.exec(v.slice(0, pos))?.[0] ?? '') + (/^[a-z']*/i.exec(v.slice(pos))?.[0] ?? '');
          const w = pos < v.trimEnd().length && word ? tokens(word)[0] ?? null : null;
          if (w !== rhymeWord) { rhymeWord = w; suggest(); }
        };
        input.addEventListener('click', follow);
        input.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') follow(); });
        return el('div', { class: 'rap-row is-current' }, letter, input, el('span', { class: 'rap-syl', 'aria-label': 'Syllables' }), ...noteParts(i));
      }
      const d = i - at;
      const words = text.split(/(\s+)/).map((part) => (/\S/.test(part) ? el('span', { class: 'rap-word', text: part }) : part));
      const p = el('p', { class: 'rap-line' }, ...(text ? words : [el('span', { class: 'rap-blank', text: '·' })]));
      return el('div', { class: `rap-row ${d < 0 ? 'is-before' : 'is-after'} rap-d${Math.min(4, Math.abs(d))}`, role: 'button', 'aria-label': `Edit line ${i + 1}`, onclick: (e) => tapLine(e, i, p) },
        letter, p, el('span', { class: 'rap-syl' }), ...noteParts(i));
    });
    fill(stage, el('div', { class: 'rap-pad' }), ...lineEls, el('div', { class: 'rap-pad' }));
    markWord();
    // Focus right away, so nothing typed straight after Enter is lost; sizes once laid out.
    if (stage.isConnected) { input.focus({ preventScroll: true }); const n = Math.min(caret ?? input.value.length, input.value.length); input.setSelectionRange(n, n); }
    requestAnimationFrame(() => {
      grow();
      if (document.activeElement !== input && !document.activeElement?.closest?.('dialog, .rap-note, .rap-bank-word, .rap-title')) { input.focus({ preventScroll: true }); const n = Math.min(caret ?? input.value.length, input.value.length); input.setSelectionRange(n, n); }
      focusLine();
    });
  }

  /** A tap on a line not being written: edit it, the cursor where the tap was (between the letters). */
  function tapLine(e, i, p) {
    const text = song.lines[i] ?? '';
    let offset = text.length;
    const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
    const range = pos ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY);
    const node = pos?.offsetNode ?? range?.startContainer; const off = pos?.offset ?? range?.startOffset ?? 0;
    if (node && p.contains(node)) {
      // Characters before the tapped one, across the word spans.
      let n = 0;
      const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(); t; t = walk.nextNode()) { if (t === node) { n += off; break; } n += t.textContent.length; }
      offset = Math.min(text.length, n);
    }
    const word = /[a-z']+$/i.exec(text.slice(0, offset))?.[0] ?? '';
    const tail = /^[a-z']*/i.exec(text.slice(offset))?.[0] ?? '';
    at = i;
    rhymeWord = offset < text.trimEnd().length ? tokens(word + tail)[0] ?? null : null;
    renderLines(offset); suggest();
  }
  function grow() { if (!input) return; input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; }
  /** Scroll so the line being written sits a little above the middle; the lines before it show above. */
  function focusLine(smooth = true) {
    const row = input?.closest('.rap-row'); if (!row) return;
    const top = row.offsetTop - stage.clientHeight * 0.42 + row.offsetHeight / 2;
    stage.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }
  function markWord() { for (const s of stage?.querySelectorAll('.rap-word') ?? []) s.classList.toggle('picked', !!rhymeWord && tokens(s.textContent)[0] === rhymeWord); }
  function editLine(i, caret = null) { at = i; rhymeWord = null; renderLines(caret); suggest(); }

  function onKey(e) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      newLine();
    } else if (e.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0 && at > 0) {
      // At the start of a line: join it to the line before.
      e.preventDefault();
      const prev = song.lines[at - 1]; const rest = input.value;
      song.lines.splice(at, 1);
      // The notes of the two lines joined go together.
      const ns = notes(); ns[at - 1] = [ns[at - 1], ns[at]].filter((x) => x?.trim()).join(' · '); ns.splice(at, 1);
      if (noteOpen >= at) noteOpen = noteOpen === at ? at - 1 : noteOpen - 1;
      at -= 1; song.lines[at] = rest ? `${prev} ${rest}`.trim() : prev;
      persist(); renderLines(); suggest();
      requestAnimationFrame(() => { input.setSelectionRange(prev.length, prev.length); });
    } else if (e.key === 'ArrowUp' && at > 0 && input.selectionStart === 0) { e.preventDefault(); editLine(at - 1); }
    else if (e.key === 'ArrowDown' && at < song.lines.length - 1 && input.selectionStart === input.value.length) { e.preventDefault(); editLine(at + 1); }
  }

  /** A new line after this one (what's after the cursor goes with it). */
  function newLine() {
    const pos = input.selectionStart; const v = input.value;
    song.lines[at] = v.slice(0, pos).trimEnd();
    song.lines.splice(at + 1, 0, v.slice(pos).trimStart());
    notes().splice(at + 1, 0, '');
    if (noteOpen > at) noteOpen += 1;
    at += 1; rhymeWord = null;
    persist(); renderLines(); suggest();
  }

  // ---------- dictation ----------

  /**
   * 🎤: speak your lines (the phone's speech recognition). What you say goes in at the cursor; saying
   * "new line" (or "next line") starts the next one. It keeps listening until you tap 🎤 again.
   */
  function toggleDictation() {
    if (dictation) { stopDictation(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Dictation isn\'t available in this browser. On iPhone, the 🎤 on the keyboard dictates too.'); return; }
    const rec = new SR();
    rec.lang = navigator.language || 'en-US'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let k = e.resultIndex; k < e.results.length; k++) {
        const res = e.results[k];
        if (!res.isFinal) { interim += res[0].transcript; continue; }
        const parts = res[0].transcript.split(/\b(?:new|next) line\b/i);
        parts.forEach((part, j) => { if (j) newLine(); if (part.trim()) insert(part.trim().replace(/^./, (c) => (input.value.trim() ? c : c.toUpperCase()))); });
      }
      showInterim(interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopDictation(); alert('Allow the microphone for this app to dictate (in your browser\'s settings).'); }
      else if (e.error === 'network') { stopDictation(); alert('Dictation needs a connection on this device. The 🎤 on the keyboard may work offline.'); }
    };
    // Some phones stop after a pause: keep listening until it's turned off.
    rec.onend = () => { if (dictation === rec) { try { rec.start(); } catch { stopDictation(); } } };
    dictation = rec;
    try { rec.start(); } catch { dictation = null; }
    markMic();
  }
  function stopDictation() {
    const rec = dictation; dictation = null;
    try { rec?.stop(); } catch { /* already stopped */ }
    showInterim(''); markMic();
  }
  function markMic() { const b = document.querySelector('.rap-mic'); if (b) { b.classList.toggle('active', !!dictation); b.setAttribute('aria-pressed', String(!!dictation)); } }
  /** What's being heard, not final yet: shown under the line being written. */
  function showInterim(text) {
    let tip = stage?.querySelector('.rap-interim');
    if (!text) { tip?.remove(); return; }
    if (!tip) { tip = el('p', { class: 'rap-interim', 'aria-live': 'polite' }); input.closest('.rap-row')?.after(tip); }
    tip.textContent = `🎤 ${text}`;
  }

  /** Add words at the cursor (finishing a word just started, spaced), and keep writing. */
  function insert(text) {
    const v = input.value; const pos = input.selectionStart ?? v.length;
    let head = v.slice(0, pos); const rest = v.slice(pos);
    // A suggestion that finishes a word already started replaces that start.
    const partial = /([a-z']+)$/i.exec(head)?.[1] ?? '';
    if (partial && text.toLowerCase().startsWith(partial.toLowerCase())) head = head.slice(0, -partial.length);
    const add = `${head && !/\s$/.test(head) ? ' ' : ''}${text}${rest && !/^\s/.test(rest) ? ' ' : rest ? '' : ' '}`;
    input.value = head + add + rest;
    song.lines[at] = input.value.trimEnd();
    grow(); persist(); suggest();
    input.focus({ preventScroll: true });
    const n = (head + add).length; input.setSelectionRange(n, n);
  }

  // ---------- suggestions ----------

  const LETTER_COLORS = 6;
  const tagOf = (L) => el('span', { class: `rap-letter rap-L${(L.charCodeAt(0) - 65) % LETTER_COLORS}`, text: L });

  /** A whole suggested line: it becomes the line being written (or the one after it), then on to a new one. */
  function useLine(text) {
    const cur = input.value.trim();
    if (cur) { song.lines.splice(at + 1, 0, text); notes().splice(at + 1, 0, ''); at += 1; } else song.lines[at] = text;
    song.lines.splice(at + 1, 0, ''); notes().splice(at + 1, 0, ''); at += 1;
    rhymeWord = null; persist(); renderLines(); suggest();
  }

  function suggest() {
    if (!dock?.isConnected || !input) return;
    if (!dict) { fill(dock, el('p', { class: 'small muted', text: 'Loading words…' })); return; }
    // Each line's syllables and rhyme letter, and the scheme of the last lines.
    const letters = rhymeLetters(dict, song.lines);
    for (const [i, row] of lineEls.entries()) {
      row.querySelector('.rap-syl').textContent = String(syllables(dict, song.lines[i] ?? '') || '');
      const badge = row.querySelector('.rap-letter'); const L = letters[i] ?? '';
      badge.textContent = L; badge.className = `rap-letter${L ? ` rap-L${(L.charCodeAt(0) - 65) % LETTER_COLORS}` : ''}`;
    }
    const schemeEl = document.querySelector('.rap-scheme');
    const name = schemeName(letters.slice(0, at + 1));
    if (schemeEl) schemeEl.textContent = name.length >= 2 ? name : '';
    const pos = input.selectionStart ?? input.value.length;
    const text = input.value.slice(0, pos);
    const done = /\s$/.test(text) || !text; // a word just finished
    const words = tokens(text);
    const before = done ? words : words.slice(0, -1);
    const theme = themesOf(dict, song.lines, at, before);
    // An untitled song gets a title from what it's about.
    const auto = smartTitle(dict, song.lines, theme);
    if (auto !== song.autoTitle) { song.autoTitle = auto; persist(); }
    if (titleInput) { titleInput.placeholder = auto ? `✨ ${auto}` : 'Untitled'; titleInput.nextElementSibling.hidden = !auto || !!song.title.trim(); }

    // The rhymes this line could take, the one the scheme calls for first.
    const options = rhymeOptions(dict, song.lines, at);
    const fit = options[0];
    const want = rhymeScheme(dict, song.lines, at);
    const lineOf = (o) => (o.target ? song.lines.slice(0, at).reverse().find((l) => tokens(l).at(-1) === o.target) ?? o.target : null);
    const targetSyl = at > 0 ? syllables(dict, song.lines[at - 1]) : 0;
    const usedEnds = song.lines.slice(0, at).filter((l) => tokens(l).length);
    const sources = [...LINES, ...songs.filter((x) => x.id !== song.id).flatMap((x) => x.lines)];
    const otherLines = song.lines.filter((_, k) => k !== at);
    // Whole next lines, by rhyme letter.
    const lineGroups = options.slice(0, 3).map((o) => ({ ...o, lines: nextLines(dict, sources, { targetLine: lineOf(o), targetSyl, theme, explicit, avoid: o.target ? [] : usedEnds, have: otherLines, n: o.fits ? 3 : 2 }) })).filter((g) => g.lines.length);
    // Finishing the line being written (once it has words).
    const finish = before.length ? options.slice(0, 2).map((o) => ({ ...o, lines: completeLine(model, dict, before, { target: o.target, targetLine: lineOf(o), targetSyl, explicit, endings: ENDINGS, n: o.fits ? 2 : 1, theme, avoid: o.target ? [] : usedEnds.map((l) => tokens(l).at(-1)) }) })).filter((g) => g.lines.length) : [];
    let next = nextWords(model, dict, before, { target: fit?.target ?? null, targetSyl, explicit, n: 8, theme });
    // Mid-word: the suggestions that start with what's typed so far.
    if (!done && words.length) { const p = words.at(-1); const starting = next.filter((w) => w.startsWith(p) && w !== p); next = starting.length ? starting : next; }
    // The rhyme bank: the word tapped, else the last word written on this line, else the line before.
    const autoWord = (done ? words.at(-1) : words.at(-2)) ?? tokens(song.lines[at - 1] ?? '').at(-1) ?? null;
    const rw = rhymeWord ?? autoWord;
    const r = rw ? rhymesFor(dict, rw, { explicit, max: 80 }) : null;
    const byTheme = (list) => [...list].sort((x, y) => Number(theme.words.has(y.word)) - Number(theme.words.has(x.word)));
    const chip = (raw, cls = '') => { const w = raw.replace(/^i('|$)/, 'I$1'); return el('button', { class: `chip rap-chip ${cls}`, text: w, onpointerdown: (e) => e.preventDefault(), onclick: () => insert(w) }); };
    const bankInput = el('input', { class: 'rap-bank-word', value: rw ?? '', placeholder: 'word', 'aria-label': 'Rhymes for', enterkeyhint: 'search' });
    bankInput.addEventListener('change', () => { rhymeWord = tokens(bankInput.value)[0] ?? null; suggest(); markWord(); });
    const why = (g) => (g.fits ? (name.length >= 2 ? `fits ${name}` : 'fits') : '');
    const groupHead = (g) => el('div', { class: `rap-group${g.fits ? ' fits' : ''}` }, tagOf(g.letter),
      el('span', { text: g.target ? `rhymes with “${g.target}”` : `new rhyme${theme.themes.length ? ' · on theme' : ''}` }),
      why(g) ? el('span', { class: 'rap-fits', text: why(g) }) : null);
    const schemeNote = want.scheme === 'new' ? 'The last two lines rhyme: this one can start a new rhyme.' : want.scheme === 'alternate' ? 'Alternating: this line answers the one two back.' : want.scheme === 'run' ? 'One rhyme running: keep it going.' : want.target ? 'This line answers the one before.' : '';

    const linesPane = el('section', { class: 'rap-pane rap-pane-lines', 'aria-label': 'Suggestions' },
      el('div', { class: 'rap-topic' },
        theme.themes.length ? el('span', { text: `On theme: ${theme.themes.map((t) => `${t.icon} ${t.name}`).join(' · ')}` }) : el('span', { class: 'muted', text: 'Write a line or two: suggestions follow your rhymes and your topic.' }),
        schemeNote ? el('span', { class: 'muted', text: schemeNote }) : null),
      el('h3', { text: 'Next line' }),
      lineGroups.length ? el('div', { class: 'rap-completes' }, ...lineGroups.flatMap((g) => [groupHead(g),
        ...g.lines.map((l) => el('button', { class: 'rap-complete rap-nextline', 'data-letter': g.letter, onpointerdown: (e) => e.preventDefault(), onclick: () => useLine(l) }, l))])) : el('p', { class: 'small muted', text: 'Keep writing…' }),
      finish.length ? el('h3', { text: 'Finish this line' }) : null,
      finish.length ? el('div', { class: 'rap-completes' }, ...finish.flatMap((g) => [groupHead(g),
        ...g.lines.map((l) => el('button', { class: 'rap-complete rap-finish', 'data-letter': g.letter, onpointerdown: (e) => e.preventDefault(), onclick: () => insert(l) }, `… ${l}`))])) : null,
      el('h3', { text: 'Next word' }),
      el('div', { class: 'rap-chips rap-next' }, ...next.slice(0, 6).map((w) => chip(w))));
    const rhymesPane = el('section', { class: 'rap-pane rap-pane-rhymes rap-bank', 'aria-label': 'Rhymes' },
      el('h3', {}, 'Rhymes · ', bankInput, rhymeWord ? el('button', { class: 'linkish small', text: '↺ last word', onclick: () => { rhymeWord = null; suggest(); markWord(); } }) : null),
      r ? el('div', { class: 'rap-bank-list' },
        ...byTheme(r.perfect).slice(0, 36).map((e) => chip(e.word, theme.words.has(e.word) ? 'themed' : '')),
        r.near.length ? el('span', { class: 'rap-near-label small muted', text: 'near' }) : null,
        ...byTheme(r.near).slice(0, 24).map((e) => chip(e.word, `near${theme.words.has(e.word) ? ' themed' : ''}`)),
        !r.perfect.length && !r.near.length ? el('p', { class: 'small muted', text: 'No rhymes found.' }) : null)
        : el('p', { class: 'small muted', text: 'Write a word, or tap one in your lines.' }));
    // On a phone, one pane at a time (tabs); wide screens show both.
    const tabs = el('div', { class: 'segmented rap-pane-tabs', role: 'tablist' },
      ...[['lines', '💡 Suggestions'], ['rhymes', `🎯 Rhymes${rw ? ` · ${rw}` : ''}`]].map(([id, label]) => el('button', {
        class: `seg${pane === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(pane === id), text: label,
        onpointerdown: (e) => e.preventDefault(), onclick: () => { pane = id; suggest(); },
      })));
    dock.dataset.pane = pane;
    const keep = dock.scrollTop;
    fill(dock, tabs, linesPane, rhymesPane);
    dock.scrollTop = keep;
    markWord();
    focusLine();
  }

  /**
   * The Create screen fits what's visible (above the keyboard when it's open): the lyrics take what's
   * left after the suggestions, so the line being written is never hidden behind them.
   */
  function keepAboveKeyboard() {
    const vv = window.visualViewport;
    const place = () => {
      const box = dock?.closest('.rap-create');
      if (!box?.isConnected) { vv?.removeEventListener('resize', place); vv?.removeEventListener('scroll', place); window.removeEventListener('resize', place); return; }
      const visible = vv ? vv.height + vv.offsetTop : window.innerHeight;
      const top = box.getBoundingClientRect().top;
      box.style.height = `${Math.max(360, visible - Math.max(0, top) - 8)}px`;
      focusLine(false);
    };
    vv?.addEventListener('resize', place); vv?.addEventListener('scroll', place); window.addEventListener('resize', place);
    requestAnimationFrame(place);
  }

  const onHash = () => { if (/^#\/rap(\/|$)/.test(location.hash)) show(); };
  window.addEventListener('hashchange', onHash);
  show();
  return () => { stopDictation(); window.removeEventListener('hashchange', onHash); clearTimeout(saveTimer); if (song) { const empty = !song.title.trim() && song.lines.every((l) => !l.trim()); if (!empty) { songs = [song, ...songs.filter((s) => s.id !== song.id)]; saveSongs(songs); } } };
}
