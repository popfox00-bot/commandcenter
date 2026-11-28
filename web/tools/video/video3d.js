// Video Editor → 🥽 2D → 3D: a regular video made stereoscopic 3D for VR headsets (Meta Quest's players: Skybox VR,
// DeoVR, Meta's own), side by side (full or half) or top and bottom, as an MP4 (H.264 + AAC). Each frame's depth
// comes from an AI model on this phone (Depth Anything V2 Small, downloaded once); the two eyes are drawn from it
// (video3d-worker.js, video-core.js). A frame can be previewed first (side by side, its depth, red-cyan or cross-eye);
// converting shows frames done, time left and Cancel; the file made is checked before it's offered.
import { el, fill, store, about } from '../../lib/dom.js';
import { LAYOUTS, EYE_CAPS, VR_SUFFIXES, eyeSize, frameSize, anaglyph } from './video-core.js';
import * as O from './video-ops.js';
import { picker, field, group, select, toggle, slider, segmented, progressBar, clock, secs, resultCard, showError, timeline } from './video-ui.js';

const KEY = 'cc.video3d.options';
// (Tests run without the model: depth guessed from the picture instead. Never set for real use.)
const TEST_KEY = 'cc.video3d.test';
const DEFAULTS = { layout: 'sbs', cap: 1920, strength: 3, popout: 50, smoothing: 60, swap: false, detail: 350, stride: 1 };
const DETAIL = [[256, 'Fast'], [350, 'Balanced'], [518, 'Fine']];
const STRIDE = [[1, 'Every frame'], [2, 'Every 2nd frame'], [3, 'Every 3rd frame']];
const VIEWS = [['sbs', 'Side by side'], ['depth', 'Depth'], ['anaglyph', 'Red-cyan'], ['cross', 'Cross-eye']];

const QUEST = [
  'Copy the file to the Quest: plug it into a computer (Files → Quest → Movies), or put it in Google Drive / Dropbox and open it from Skybox VR or DeoVR on the headset.',
  'Skybox VR and DeoVR pick 3D from the name (_SBS_LR, _3dh, _TB). If one doesn\'t, choose 3D → Side by side (or Top-Bottom) and 2D screen / Flat in its video settings.',
  'Meta\'s own player (Files → the video): open the ⋯ menu and pick the 3D layout.',
  'If things look inside out (near things far), turn on Swap eyes and convert again.',
];

export function mount(host) {
  const o = { ...DEFAULTS, ...store.json(KEY, {}) };
  const save = () => store.set(KEY, JSON.stringify(o));
  const test = store.get(TEST_KEY) === '1';
  const urls = new Set();
  let file = null; let opened = null; let worker = null; let loaded = null; let controller = null; let msPerFrame = null; let previewed = null; let tl = null;
  const trim = { start: 0, end: 0 };

  const status = el('div', { class: 'vid-status', role: 'status' });
  const pick = picker('Choose a video', (f) => openFile(f[0]));
  const infoLine = el('p', { class: 'small muted vid-info' });
  const model = el('div', { class: 'vid-model' });
  const opts = el('div', { class: 'options' });
  const previewBox = el('div', { class: 'vid-preview' });
  const go = el('button', { type: 'button', class: 'btn primary block', text: 'Convert to 3D', disabled: true, onclick: () => convert() });
  const progress = progressBar();
  const estimate = el('p', { class: 'small muted' });
  const out = el('div', {});
  const work = el('div', { hidden: true }, infoLine, model, opts, previewBox, estimate, go, progress, out);
  host.append(el('h2', { class: 'vid-title', text: '🥽 2D → 3D for VR' }), status, pick, work,
    about('Makes a stereoscopic 3D copy of a regular video for VR headsets, worked out on this phone: an AI model (Depth Anything V2 Small, Apache-2.0, about 26 MB, downloaded once from Hugging Face) estimates how far away everything in each frame is, the depth is steadied from frame to frame (and started afresh at scene cuts), and the left and right eyes are drawn from it, with gaps behind near things filled from what\'s behind them. The video is never uploaded. The sound is kept as it is when it\'s AAC; other sound is converted to AAC. A frame takes about a second on a phone, so a minute of video can take a while: Depth every 2nd or 3rd frame and Fast detail speed it up.'));

  O.videoSupport().then((s) => { if (!s.ok) { fill(status, el('p', { class: 'bad-text', text: `Can't make 3D videos in this browser: ${s.why}` })); pick.hidden = true; } });

  async function openFile(f) {
    fill(out); fill(previewBox); previewed = null; msPerFrame = null;
    try {
      fill(status, el('p', { class: 'small muted', text: `Opening ${f.name}…` }));
      opened = await O.openVideo(f); file = f; trim.start = 0; trim.end = opened.info.duration;
      tl = timeline(opened, O.frameAt, { start: 0, end: trim.end, onChange: (s2, e2) => {
        trim.start = s2; trim.end = e2;
        for (const [k, v] of [['Start (seconds)', s2], ['End (seconds)', e2]]) { const n = opts.querySelector(`input[aria-label="${k}"]`); if (n) n.value = String(Math.round(v * 10) / 10); }
        renderEstimate();
      } });
      fill(status); work.hidden = false;
      const i = opened.info;
      infoLine.textContent = `${f.name}: ${i.w}×${i.h} · ${secs(i.duration)} · ${Math.round(i.fps * 100) / 100} fps · ${i.audio ? `sound (${i.audio.codec})` : 'no sound'}`;
      renderOptions(); await renderModel(); renderPreview(); renderEstimate();
    } catch (e) { work.hidden = true; opened = null; showError(status, e); }
  }

  // ---- the depth model ----
  async function renderModel() {
    if (test) { fill(model, el('p', { class: 'small muted', text: 'Test mode: depth is guessed from the picture (no AI model).' })); go.disabled = false; return; }
    const device = await O.depthDevice(); const have = await O.depthDownloaded(device);
    go.disabled = !have && !loaded;
    if (have || loaded) { fill(model, el('p', { class: 'small muted', text: `Depth model: on this phone (${device === 'webgpu' ? 'graphics chip' : 'processor'}).` })); return; }
    const bar = progressBar();
    const btn = el('button', { type: 'button', class: 'btn primary', text: `Download the depth model (${device === 'webgpu' ? '48' : '26'} MB, once)`, onclick: async () => {
      btn.disabled = true; bar.set(0, 'Downloading…');
      try { await ensureWorker(true, (f) => bar.set(f, `Downloading… ${Math.round(f * 100)}%`)); bar.hide(); renderModel(); renderPreview(); } catch (e) { bar.hide(); btn.disabled = false; showError(note, new Error(`The model couldn't be downloaded: ${e.message}. Check the connection and try again.`)); }
    } });
    const note = el('div', {});
    fill(model, el('p', { class: 'small', text: '3D needs an AI depth model on this phone first. After that it works offline.' }), btn, bar, note);
  }
  async function ensureWorker(download = false, onProgress) {
    worker ??= O.stereoWorker();
    if (!loaded) { const device = await O.depthDevice(); loaded = worker.load({ download, device, test }, onProgress).catch((e) => { loaded = null; throw e; }); }
    return loaded;
  }

  // ---- options ----
  function renderOptions() {
    const i = opened.info; const eye = eyeSize(i.w, i.h, o.cap); const fs = frameSize(o.layout, eye);
    const layoutNote = el('span', { class: 'muted small', text: `${LAYOUTS.find((l) => l.id === o.layout).note} Output ${fs.w}×${fs.h}, named …${VR_SUFFIXES[o.layout]}.mp4.` });
    const changed = () => { save(); renderOptions(); renderEstimate(); };
    const tnum = (k) => { const n = el('input', { type: 'number', min: '0', max: String(i.duration), step: '0.1', value: String(Math.round(trim[k] * 10) / 10), inputmode: 'decimal', 'aria-label': k === 'start' ? 'Start (seconds)' : 'End (seconds)' }); n.addEventListener('change', () => { const v = Math.max(0, Math.min(i.duration, Number(n.value) || 0)); trim[k] = v; if (trim.end <= trim.start) trim[k === 'start' ? 'end' : 'start'] = k === 'start' ? Math.min(i.duration, v + 0.1) : Math.max(0, v - 0.1); tl?.set(trim.start, trim.end); renderOptions(); renderEstimate(); }); return n; };
    fill(opts,
      group('Layout', segmented('Layout', o.layout, LAYOUTS.map((l) => [l.id, l.name]), (v) => { o.layout = v; changed(); }), null), layoutNote,
      field('Size per eye', select(o.cap, EYE_CAPS.map(([v, l]) => [v, v ? `${l} px (longer side)` : `${l} (${i.w}×${i.h})`]), (v) => { o.cap = Number(v); changed(); }), 'Never bigger than the video. 1920 suits Quest 3; 1440 converts faster.'),
      slider('3D strength', o.strength, { min: 1, max: 8, step: 0.5, fmt: (v) => `${v}%`, hint: 'How far apart the eyes see: more is deeper but harder on the eyes. 2–4% is comfortable.', onChange: (v) => { o.strength = v; save(); } }),
      slider('Pop-out', o.popout, { min: 0, max: 100, step: 5, fmt: (v) => `${v}`, hint: '0: everything sits behind the screen. 100: everything comes out toward you. 50 puts the middle of the scene at the screen.', onChange: (v) => { o.popout = v; save(); } }),
      slider('Steadiness', o.smoothing, { min: 0, max: 100, step: 5, fmt: (v) => `${v}`, hint: 'Smooths depth between frames so it doesn\'t flicker. Starts fresh at each scene cut.', onChange: (v) => { o.smoothing = v; save(); } }),
      field('Depth detail', select(o.detail, DETAIL, (v) => { o.detail = Number(v); changed(); })),
      field('Work out depth', select(o.stride, STRIDE, (v) => { o.stride = Number(v); changed(); }), 'Every 2nd or 3rd frame is faster; scene cuts are always worked out.'),
      toggle('Swap eyes (right eye first)', o.swap, (v) => { o.swap = v; save(); }),
      group('Part to make 3D', tl), el('div', { class: 'vid-trim' }, group('Start (s)', tnum('start')), group('End (s)', tnum('end'))),
    );
  }
  const params = () => ({ layout: o.layout, strength: o.strength, convergence: 1 - o.popout / 100, smoothing: o.smoothing / 100, swap: o.swap, detail: o.detail, stride: o.stride });

  function renderEstimate() {
    if (!opened) return;
    const n = Math.round((trim.end - trim.start) * opened.info.fps);
    estimate.textContent = msPerFrame ? `${n} frames · about ${clock((n * msPerFrame) / 1000 / (1 + (o.stride - 1) * 0.6))} on this phone (from the preview).` : `${n} frames. Preview a frame to see how long it will take.`;
  }

  // ---- preview ----
  function renderPreview() {
    const i = opened.info;
    const at = el('input', { type: 'range', min: '0', max: String(i.duration), step: '0.05', value: String(Math.min(i.duration / 3, i.duration)), 'aria-label': 'Frame to preview' });
    const atOut = el('output', { text: secs(Number(at.value)) }); at.addEventListener('input', () => { atOut.textContent = secs(Number(at.value)); });
    const canvas = el('canvas', { class: 'vid-canvas', 'aria-label': '3D preview' });
    const note = el('p', { class: 'small muted' });
    let view = 'sbs';
    const views = segmented('Preview view', view, VIEWS, (v) => { view = v; draw(); });
    const btn = el('button', { type: 'button', class: 'btn', text: 'Preview this frame', onclick: async () => {
      btn.disabled = true; note.textContent = 'Working out depth…';
      try {
        await ensureWorker(false);
        // (At the size it will be made, up to 960 px per eye, so it's quick.)
        const eye = eyeSize(i.w, i.h, Math.min(960, o.cap || 960));
        const rgba = await O.frameAt(opened, Number(at.value), eye.w, eye.h);
        const t0 = performance.now();
        const r = await worker.preview(rgba, eye.w, eye.h, { ...params(), layout: 'sbs' });
        msPerFrame = (performance.now() - t0) * Math.max(1, (eyeSize(i.w, i.h, o.cap).w * eyeSize(i.w, i.h, o.cap).h) / (eye.w * eye.h)) ** 0.35;
        previewed = { L: new Uint8ClampedArray(r.left), R: new Uint8ClampedArray(r.right), D: new Uint8ClampedArray(r.depth), w: r.eyeW, h: r.eyeH, dw: r.dw, dh: r.dh };
        note.textContent = `Worked out in ${Math.round(performance.now() - t0)} ms.`; draw(); renderEstimate();
      } catch (e) { note.textContent = ''; showError(note, e); } finally { btn.disabled = false; }
    } });
    function draw() {
      if (!previewed) return; const { L, R, D, w, h, dw, dh } = previewed; const ctx = canvas.getContext('2d');
      if (view === 'depth') { canvas.width = dw; canvas.height = dh; ctx.putImageData(new ImageData(D, dw, dh), 0, 0); return; }
      if (view === 'anaglyph') { canvas.width = w; canvas.height = h; ctx.putImageData(new ImageData(anaglyph(L, R), w, h), 0, 0); return; }
      canvas.width = w * 2; canvas.height = h; const [a, b] = view === 'cross' ? [R, L] : [L, R];
      ctx.putImageData(new ImageData(a, w, h), 0, 0); ctx.putImageData(new ImageData(b, w, h), w, 0);
    }
    fill(previewBox, el('h3', { text: 'Preview' }), group('Frame', el('span', { class: 'range-row' }, at, atOut)), btn, views, canvas, note,
      el('p', { class: 'small muted', text: 'Red-cyan needs 3D glasses; for cross-eye, cross your eyes until the two pictures meet in the middle.' }));
  }

  // ---- convert ----
  async function convert() {
    if (controller) { controller.abort(); return; }
    controller = new AbortController(); fill(out); go.textContent = 'Cancel'; progress.set(0, 'Starting…');
    for (const u of urls) URL.revokeObjectURL(u); urls.clear();
    const t0 = Date.now();
    try {
      await ensureWorker(false);
      const i = opened.info;
      const r = await O.convert3d(opened, file, worker, { ...params(), cap: o.cap, trim: { start: trim.start, end: trim.end }, signal: controller.signal,
        onProgress: ({ done, total, eta }) => progress.set(done / Math.max(1, total), `${done} / ${total} frames · ${eta == null ? 'working out time left…' : `${clock(eta)} left`}`) });
      progress.hide();
      fill(out, resultCard({ blob: r.blob, name: r.name, check: r.check, extra: [
        el('p', { class: 'small muted', text: `${r.size.w}×${r.size.h} · ${r.frames} frames in ${clock((Date.now() - t0) / 1000)}${r.cuts ? ` · ${r.cuts} scene cut${r.cuts === 1 ? '' : 's'} found` : ''}${i.audio ? '' : ' · the video had no sound'}.` }),
        el('details', { class: 'vid-quest', open: true }, el('summary', { text: 'How to watch on a Meta Quest' }), el('ol', { class: 'small' }, ...QUEST.map((t) => el('li', { text: t })))),
      ] }, urls));
    } catch (e) {
      progress.hide();
      showError(out, e.canceled ? new Error('Canceled. Nothing was saved.') : new Error(`The 3D video couldn't be made: ${e.message}`));
    } finally { controller = null; go.textContent = 'Convert to 3D'; }
  }

  return { openFile, destroy: () => { controller?.abort(); worker?.close(); for (const u of urls) URL.revokeObjectURL(u); } };
}
