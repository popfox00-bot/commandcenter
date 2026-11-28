// Video Editor → ✂️ Edit: trim (on a timeline of its frames), crop, resize, rotate and flip, text on it, faster or
// slower, keep, remove or replace the sound, play it backward, join clips, make a GIF, or save the sound alone. All on this phone (video-ops.js); every file made is MP4 (H.264 + AAC), checked
// before it's offered.
import { el, fill, about } from '../../lib/dom.js';
import { renameExt, formatBytes } from '../../lib/files.js';
import * as O from './video-ops.js';
import { picker, field, group, select, toggle, segmented, progressBar, secs, resultCard, showError, timeline } from './video-ui.js';

const CROPS = [['', 'No crop'], ['1:1', 'Square 1:1'], ['9:16', 'Tall 9:16'], ['16:9', 'Wide 16:9'], ['4:5', 'Portrait 4:5'], ['4:3', '4:3']];
const SIZES = [[0, 'Original'], [1920, '1920 px'], [1280, '1280 px'], [1080, '1080 px'], [720, '720 px'], [480, '480 px']];
const ROTATE = [[0, 'None'], [90, '90° right'], [180, '180°'], [270, '90° left']];
const MODES = [['edit', '✂️ Edit'], ['gif', '🎞 GIF'], ['reverse', '⏪ Reverse'], ['combine', '➕ Combine'], ['sound', '🎵 Sound only']];
const SPEEDS = [[0.25, '¼× (slow motion)'], [0.5, '½× (slower)'], [0.75, '¾×'], [1, 'Normal speed'], [1.5, '1.5×'], [2, '2× (faster)'], [4, '4× (much faster)']];
const TEXT_POS = [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']];
const TEXT_SIZE = [['S', 'Small'], ['M', 'Medium'], ['L', 'Large']];
const TEXT_COLOR = [['#ffffff', 'White'], ['#ffd400', 'Yellow'], ['#000000', 'Black'], ['#ff3b5c', 'Pink'], ['#3ec7ff', 'Blue']];
const GIF_WIDTH = [[320, '320 px (small)'], [480, '480 px'], [640, '640 px (bigger file)']];
const GIF_FPS = [[8, '8 a second'], [12, '12 a second'], [15, '15 a second (smoother)']];

/** The biggest centered crop of a `w` × `h` picture with the shape `ratio` ('a:b'), or null for none. */
export function cropFor(w, h, ratio) {
  if (!ratio) return null;
  const [a, b] = ratio.split(':').map(Number); const r = a / b;
  let cw = w; let ch = Math.round(w / r); if (ch > h) { ch = h; cw = Math.round(h * r); }
  cw -= cw % 2; ch -= ch % 2;
  return { left: Math.floor((w - cw) / 2), top: Math.floor((h - ch) / 2), width: cw, height: ch };
}

export function mount(host) {
  const urls = new Set();
  let file = null; let opened = null; let srcUrl = null; let controller = null;
  const e = { start: 0, end: 0, crop: '', size: 0, rotate: 0, flipH: false, flipV: false, sound: 'keep', soundFile: null, speed: 1, text: '', textPos: 'bottom', textSize: 'M', textColor: '#ffffff', gifWidth: 480, gifFps: 12 };
  let mode = 'edit'; let clips = []; let tl = null;

  const status = el('div', { class: 'vid-status', role: 'status' });
  O.videoSupport().then((s) => { if (!s.ok) { fill(status, el('p', { class: 'bad-text', text: `Can't edit videos in this browser: ${s.why}` })); pick.hidden = true; } });
  const pick = picker('Choose a video', (f) => openFile(f[0]));
  const player = el('video', { class: 'vid-player', controls: true, playsinline: true, preload: 'metadata' });
  const info = el('p', { class: 'small muted vid-info' });
  const modes = segmented('What to do', mode, MODES, (m) => { mode = m; render(); });
  const panel = el('div', { class: 'options' });
  const go = el('button', { type: 'button', class: 'btn primary block', onclick: () => run() });
  const progress = progressBar();
  const out = el('div', {});
  const work = el('div', { hidden: true }, player, info, modes, panel, go, progress, out);
  host.append(el('h2', { class: 'vid-title', text: '🎬 Video Editor' }), status, pick, work,
    about('Edited on this phone with its own video encoder; nothing is uploaded. Files are saved as MP4 (H.264 video, AAC sound), which plays everywhere. Sound that\'s already AAC is copied as it is; trimming, combining and reversing re-encode the picture.'));

  async function openFile(f) {
    fill(out); fill(status, el('p', { class: 'small muted', text: `Opening ${f.name}…` }));
    try {
      opened = await O.openVideo(f); file = f; clips = [{ file: f, opened }];
      if (srcUrl) URL.revokeObjectURL(srcUrl); srcUrl = URL.createObjectURL(f); player.src = srcUrl;
      Object.assign(e, { start: 0, end: opened.info.duration, crop: '', size: 0, rotate: 0, flipH: false, flipV: false, sound: 'keep', soundFile: null, speed: 1, text: '' });
      // (The timeline: made once for the video; dragging a handle shows that moment in the player.)
      tl = timeline(opened, O.frameAt, { start: 0, end: opened.info.duration, onChange: (s, en) => {
        const moved = Math.abs(s - e.start) > 1e-3 ? s : en; e.start = s; e.end = en;
        try { player.currentTime = moved; } catch { /* not ready */ }
        for (const [k, v] of [['Start (s)', s], ['End (s)', en]]) { const n = panel.querySelector(`input[aria-label="${k}"]`); if (n) n.value = String(Math.round(v * 10) / 10); }
        go.disabled = e.end - e.start < 0.05;
      } });
      const i = opened.info;
      info.textContent = `${f.name}: ${i.w}×${i.h} · ${secs(i.duration)} · ${Math.round(i.fps * 100) / 100} fps · ${i.audio ? `sound (${i.audio.codec})` : 'no sound'} · ${formatBytes(f.size)}`;
      fill(status); work.hidden = false; render();
    } catch (err) { work.hidden = true; showError(status, err); }
  }

  function timeField(k, label) {
    const n = el('input', { type: 'number', min: '0', max: String(opened.info.duration), step: '0.1', inputmode: 'decimal', value: String(Math.round(e[k] * 10) / 10), 'aria-label': label });
    n.addEventListener('change', () => { e[k] = Math.max(0, Math.min(opened.info.duration, Number(n.value) || 0)); tl?.set(e.start, e.end); render(); });
    const here = el('button', { type: 'button', class: 'btn small-btn ghost', text: 'Here', 'aria-label': `${label}: where the video is`, onclick: () => { e[k] = Math.round(player.currentTime * 100) / 100; tl?.set(e.start, e.end); render(); } });
    return group(label, el('span', { class: 'row' }, n, here));
  }

  function render() {
    if (!opened) return;
    const i = opened.info;
    if (mode === 'edit') {
      const soundPick = el('input', { type: 'file', accept: 'audio/*,video/*,.mp3,.m4a,.aac,.wav', class: 'visually-hidden', id: 'vid-sound-file' });
      soundPick.addEventListener('change', () => { e.soundFile = soundPick.files[0] ?? null; render(); });
      const words = el('input', { type: 'text', class: 'so-input', value: e.text, placeholder: 'Words on the video (optional)', 'aria-label': 'Text on the video', maxlength: '120' });
      words.addEventListener('input', () => { e.text = words.value; });
      fill(panel,
        group('Keep', tl), el('div', { class: 'vid-trim' }, timeField('start', 'Start (s)'), timeField('end', 'End (s)')),
        field('Speed', select(e.speed, SPEEDS, (v) => { e.speed = Number(v); render(); }), e.speed !== 1 && i.audio ? 'The sound speeds up or slows down with it (higher or lower).' : null),
        group('Text', el('div', { class: 'vid-text' }, words,
          el('div', { class: 'row wrap' }, select(e.textPos, TEXT_POS, (v) => { e.textPos = v; }), select(e.textSize, TEXT_SIZE, (v) => { e.textSize = v; }), select(e.textColor, TEXT_COLOR, (v) => { e.textColor = v; })))),
        field('Crop', select(e.crop, CROPS, (v) => { e.crop = v; render(); }), 'Centered. Applied after rotating.'),
        field('Size (longer side)', select(e.size, SIZES, (v) => { e.size = Number(v); })),
        field('Rotate', select(e.rotate, ROTATE, (v) => { e.rotate = Number(v); render(); })),
        toggle('Flip left to right', e.flipH, (v) => { e.flipH = v; }),
        toggle('Flip upside down', e.flipV, (v) => { e.flipV = v; }),
        group('Sound', segmented('Sound', e.sound, [['keep', 'Keep'], ['remove', 'Remove'], ['replace', 'Replace']], (v) => { e.sound = v; render(); })),
        e.sound === 'replace' ? el('div', {}, el('label', { class: 'btn', for: 'vid-sound-file', text: e.soundFile ? `Sound: ${e.soundFile.name}` : 'Choose the new sound (music, a recording, or a video)' }), soundPick) : null,
        !i.audio && e.sound === 'keep' ? el('p', { class: 'small muted', text: 'This video has no sound.' }) : null);
      go.textContent = 'Make the video';
      go.disabled = e.end - e.start < 0.05 || (e.sound === 'replace' && !e.soundFile);
    } else if (mode === 'gif') {
      const len = Math.min(e.end - e.start, O.GIF_MAX_SECONDS);
      fill(panel,
        group('Part', tl),
        el('p', { class: 'small muted', text: e.end - e.start > O.GIF_MAX_SECONDS ? `GIFs are kept to ${O.GIF_MAX_SECONDS} s: the first ${O.GIF_MAX_SECONDS} s of the part chosen.` : `${secs(len)} of video, about ${Math.round(len * e.gifFps)} frames. A GIF has no sound and loops.` }),
        field('Width', select(e.gifWidth, GIF_WIDTH, (v) => { e.gifWidth = Number(v); render(); })),
        field('Frames', select(e.gifFps, GIF_FPS, (v) => { e.gifFps = Number(v); render(); })));
      go.textContent = 'Make the GIF'; go.disabled = e.end - e.start < 0.1;
    } else if (mode === 'reverse') {
      fill(panel, el('p', { class: 'small', text: `Plays the whole video backward${i.audio ? ', sound too' : ''}.` }));
      go.textContent = 'Make it backward'; go.disabled = false;
    } else if (mode === 'combine') {
      const more = picker('Add clips', (fs) => addClips(fs), { multiple: true });
      fill(panel,
        el('p', { class: 'small', text: 'Joined in this order, each fitted into the first clip\'s frame (black bars where shapes differ).' }),
        el('ol', { class: 'file-list vid-clips' }, ...clips.map((c, n) => el('li', { class: 'file' },
          el('span', { class: 'file-name', text: c.file.name }), el('span', { class: 'muted small', text: secs(c.opened.info.duration) }),
          n > 0 ? el('button', { type: 'button', class: 'icon-btn small-btn', 'aria-label': `Move ${c.file.name} up`, text: '↑', onclick: () => { [clips[n - 1], clips[n]] = [clips[n], clips[n - 1]]; render(); } }) : null,
          clips.length > 1 ? el('button', { type: 'button', class: 'icon-btn small-btn', 'aria-label': `Remove ${c.file.name}`, text: '✕', onclick: () => { clips.splice(n, 1); render(); } }) : null))),
        more);
      go.textContent = `Join ${clips.length} clip${clips.length === 1 ? '' : 's'}`; go.disabled = clips.length < 2;
    } else {
      fill(panel, el('p', { class: 'small', text: i.audio ? 'Saves the sound alone, as an .m4a (plays in Music, Files and most apps).' : 'This video has no sound.' }));
      go.textContent = 'Save the sound'; go.disabled = !i.audio;
    }
  }

  async function addClips(fs) {
    for (const f of fs) {
      try { clips.push({ file: f, opened: await O.openVideo(f) }); } catch (err) { showError(out, new Error(`${f.name}: ${err.message}`)); }
    }
    render();
  }

  async function run() {
    if (controller) { controller.abort(); return; }
    controller = new AbortController(); const signal = controller.signal; const label = go.textContent;
    go.textContent = 'Cancel'; fill(out); progress.set(0, 'Working…');
    for (const u of urls) URL.revokeObjectURL(u); urls.clear();
    const onProgress = (p) => progress.set(p, `${Math.round(p * 100)}%`);
    try {
      let r; let name;
      if (mode === 'edit') {
        const i = opened.info; const turned = (e.rotate + (e.flipV ? 180 : 0)) % 180 ? { w: i.h, h: i.w } : { w: i.w, h: i.h };
        const trimmed = e.start > 0.01 || e.end < i.duration - 0.01;
        const text = e.text.trim() ? { value: e.text.trim(), pos: e.textPos, size: e.textSize, color: e.textColor } : null;
        const changes = trimmed || e.crop || e.size || e.rotate || e.flipH || e.flipV || e.sound === 'remove' || text;
        // (Steps, each on the last one's file: the edits, a new sound, the speed.)
        const steps = (changes || (e.sound !== 'replace' && e.speed === 1) ? 1 : 0) + (e.sound === 'replace' ? 1 : 0) + (e.speed !== 1 ? 1 : 0); let done = 0;
        const part = (p) => onProgress((done + p) / steps);
        r = changes || (e.sound !== 'replace' && e.speed === 1) ? await O.editVideo(opened, { trim: { start: e.start, end: e.end }, crop: cropFor(turned.w, turned.h, e.crop), size: e.size, rotate: e.rotate, flipH: e.flipH, flipV: e.flipV, audio: e.sound === 'remove' ? 'remove' : 'keep', text, onProgress: part, signal }) : null;
        if (r) done++;
        if (e.sound === 'replace') {
          progress.set(done / steps, 'Putting the new sound in…');
          const base = r ? await O.openVideo(r.blob) : opened;
          r = await O.replaceAudio(base, e.soundFile, { onProgress: part, signal }); done++;
        }
        if (e.speed !== 1) {
          progress.set(done / steps, e.speed < 1 ? 'Slowing it down…' : 'Speeding it up…');
          const base = r ? await O.openVideo(r.blob) : opened;
          r = await O.speedVideo(base, e.speed, { onProgress: part, signal });
        }
        name = renameExt(file.name, 'mp4', '-edited');
      } else if (mode === 'gif') {
        const g = await O.makeGif(opened, { trim: { start: e.start, end: e.end }, width: e.gifWidth, fps: e.gifFps, onProgress, signal });
        r = { blob: g.blob, check: { ok: true, problems: [], warnings: [], info: { w: g.w, h: g.h, frames: g.frames, duration: g.frames / e.gifFps, audio: null } } };
        name = renameExt(file.name, 'gif');
      } else if (mode === 'reverse') { r = await O.reverse(opened, { onProgress, signal }); name = renameExt(file.name, 'mp4', '-reversed'); }
      else if (mode === 'combine') { r = await O.combine(clips, { onProgress, signal }); name = renameExt(file.name, 'mp4', '-combined'); }
      else { r = await O.extractAudio(opened, { signal }); name = renameExt(file.name, 'm4a', '-sound'); }
      progress.hide();
      fill(out, resultCard({ blob: r.blob, name, check: r.check }, urls));
    } catch (err) {
      progress.hide();
      showError(out, err.canceled || signal.aborted ? new Error('Canceled. Nothing was saved.') : err);
    } finally { controller = null; go.textContent = label; }
  }

  return { openFile, destroy: () => { controller?.abort(); if (srcUrl) URL.revokeObjectURL(srcUrl); for (const u of urls) URL.revokeObjectURL(u); } };
}
