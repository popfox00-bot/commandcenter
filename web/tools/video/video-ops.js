// Video Editor's work on files, on the phone (the browser's own video encoders and decoders, WebCodecs, through
// Mediabunny: vendor/mediabunny, MPL-2.0): edits (trim, crop, resize, rotate, flip, sound kept, removed or replaced),
// reversing, joining clips, saving the sound alone, and 2D → 3D side by side (each frame through video3d-worker.js).
// Every output is MP4 with H.264 video and AAC sound: sound already in AAC is copied as it is (in sync, untouched);
// any other is encoded, by the browser's AAC encoder or, where there's none, Mediabunny's own (WebAssembly). Each
// output is checked when it's made (its picture, length, frame count and sound) before it's offered.

import * as V from './video-core.js';

let mbP = null;
/** Mediabunny (loaded the first time it's needed). */
export const mb = () => (mbP ??= import('../../vendor/mediabunny/mediabunny.min.mjs'));
let aacReady = null;
/** AAC encoding made possible: the browser's, else Mediabunny's own (registered once). */
export async function ensureAac() {
  const M = await mb();
  return (aacReady ??= (async () => { if (!(await M.canEncodeAudio('aac'))) { const A = await import('../../vendor/mediabunny/mediabunny-aac-encoder.min.mjs'); A.registerAacEncoder(); return 'built-in'; } return 'browser'; })());
}

/** Whether this browser can make videos here: { ok, why }. (WebCodecs' H.264 encoder and decoder, and workers.) */
export async function videoSupport() {
  if (typeof globalThis.VideoEncoder === 'undefined' || typeof globalThis.VideoDecoder === 'undefined') return { ok: false, why: 'This browser can\'t encode video (it has no WebCodecs). On iPhone it needs iOS 16.4 or later; on a computer, a current Chrome, Edge or Safari.' };
  if (typeof globalThis.OffscreenCanvas === 'undefined' || typeof globalThis.Worker === 'undefined') return { ok: false, why: 'This browser is missing what video editing needs here (OffscreenCanvas and workers).' };
  try { const M = await mb(); if (!(await M.canEncodeVideo('avc', { width: 1280, height: 720 }))) return { ok: false, why: 'This browser can\'t encode H.264 video, so it can\'t make MP4s Quest players and phones play.' }; } catch (e) { return { ok: false, why: `Video tools couldn't start here: ${e.message}` }; }
  return { ok: true, why: '' };
}

/** A file opened for reading: { input, video (track or null), audio (track or null), info }. */
export async function openVideo(file) {
  const M = await mb();
  const input = new M.Input({ source: file instanceof Blob ? new M.BlobSource(file) : new M.BufferSource(file), formats: M.ALL_FORMATS });
  let video = null; let audio = null;
  try { video = await input.getPrimaryVideoTrack(); audio = await input.getPrimaryAudioTrack(); } catch (e) { throw new Error(`This file can't be read as a video (${e.message}).`); }
  if (!video) throw new Error('There\'s no video in this file.');
  if (!(await video.canDecode())) throw new Error(`This phone can't decode this video (${video.codec ?? 'unknown codec'}). H.264, HEVC and VP9 usually work.`);
  const duration = await input.computeDuration();
  const stats = await video.computePacketStats(240).catch(() => null);
  const info = { w: video.displayWidth, h: video.displayHeight, duration, fps: stats?.averagePacketRate || 30, audio: audio ? { codec: audio.codec, rate: audio.sampleRate, channels: audio.numberOfChannels } : null, video: { codec: video.codec } };
  return { input, video, audio, info };
}

/** How many frames fall in [start, end) seconds (counted from the file's own packets: no decoding). */
export async function countFrames(videoTrack, start = 0, end = Infinity) {
  const M = await mb(); const sink = new M.EncodedPacketSink(videoTrack); let n = 0;
  for await (const p of sink.packets(undefined, undefined, { metadataOnly: true })) if (p.timestamp >= start - 1e-6 && p.timestamp < end - 1e-6) n++;
  return n;
}

/**
 * An MP4 made checked: it opens; its picture is `w` × `h` (when given); its length is within a frame or two of
 * `duration`; it has `frames` frames (when given); and it has sound when `audio` (else says so). Returns
 * { ok, problems: [..], warnings: [..], info }.
 */
export async function checkOutput(blob, { w, h, duration, frames, audio, fps = 30 } = {}) {
  const problems = []; const warnings = [];
  let o;
  try { o = await openVideo(blob); } catch (e) { return { ok: false, problems: [`The file made doesn't open (${e.message}).`], warnings, info: null }; }
  const { info } = o;
  if (w && (info.w !== w || info.h !== h)) problems.push(`Its picture is ${info.w}×${info.h}, not ${w}×${h}.`);
  const tol = 2.5 / (fps || 30);
  if (duration && Math.abs(info.duration - duration) > Math.max(tol, 0.08)) problems.push(`It's ${info.duration.toFixed(2)} s long, not ${duration.toFixed(2)} s.`);
  if (frames) { const n = await countFrames(o.video); if (Math.abs(n - frames) > 1) problems.push(`It has ${n} frames, not ${frames}.`); info.frames = n; }
  if (audio && !o.audio) warnings.push('It has no sound, though the video it was made from had sound.');
  return { ok: !problems.length, problems, warnings, info };
}

const makeOutput = async () => { const M = await mb(); return new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() }); };
const blobOf = (output) => new Blob([output.target.buffer], { type: 'video/mp4' });
/** The reasons Mediabunny left tracks out, in words. */
const canceled = () => Object.assign(new Error('Canceled.'), { canceled: true });
const why = (d) => ({ undecodable_source_codec: 'this phone can\'t decode it', no_encodable_target_codec: 'this phone can\'t encode it as AAC', discarded_by_user: 'removed' }[d.reason] ?? String(d.reason ?? 'unknown'));

// ---- 2D → 3D ------------------------------------------------------------------------------------------------------

/** The 2D → 3D worker, as a small client: load(options, onProgress), frame(...), preview(...), reset(), close(). */
export function stereoWorker() {
  const w = new Worker(new URL('./video3d-worker.js', import.meta.url), { type: 'module' }); let seq = 0; const pending = new Map();
  w.onmessage = (e) => { const p = pending.get(e.data?.id); if (!p) return; if (e.data.type === 'progress') p.progress?.(e.data); else { pending.delete(e.data.id); if (e.data.type === 'error') p.reject(new Error(e.data.error)); else p.resolve(e.data); } };
  w.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'The 3D worker stopped (out of memory?).')); pending.clear(); };
  const ask = (msg, progress, transfer = []) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject, progress }); w.postMessage({ id, ...msg }, transfer); });
  return {
    load: (options, onProgress) => { const files = new Map(); return ask({ type: 'load', options }, (p) => { if (!p.file) return; files.set(p.file, { l: p.status === 'done' ? (p.total || 0) : p.loaded, t: p.total || 0 }); let l = 0; let t = 0; for (const f of files.values()) { l += f.l; t += f.t; } onProgress?.(t ? Math.min(1, l / t) : 0); }); },
    frame: (rgba, W, H, params) => ask({ type: 'frame', rgba: rgba.buffer, W, H, params }, null, [rgba.buffer]),
    preview: (rgba, W, H, params) => ask({ type: 'preview', rgba: rgba.buffer, W, H, params }, null, [rgba.buffer]),
    reset: () => ask({ type: 'reset' }),
    close: () => w.terminate(),
  };
}

export const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';
/** Whether the depth model is on this phone (for `device`'s version: 'webgpu' fp16, else 8-bit). */
export async function depthDownloaded(device = 'wasm') {
  try { const c = await caches.open('transformers-cache'); const re = device === 'webgpu' ? /model_fp16\.onnx/ : /model_quantized\.onnx/; return (await c.keys()).some((r) => r.url.includes(DEPTH_MODEL) && re.test(r.url)); } catch { return false; }
}
/** Where the depth model runs best here: 'webgpu' (with 16-bit shaders) or 'wasm'. */
export async function depthDevice() {
  try { const a = await navigator.gpu?.requestAdapter(); if (a?.features?.has?.('shader-f16')) return 'webgpu'; } catch { /* none */ }
  return 'wasm';
}

/** A frame of a video at `t` seconds, drawn at `w` × `h`: its RGBA (for the preview). */
export async function frameAt(opened, t, w, h) {
  const M = await mb(); const sink = new M.VideoSampleSink(opened.video);
  const s = await sink.getSample(Math.max(0, t)); if (!s) throw new Error('No frame there.');
  const c = new OffscreenCanvas(w, h); const ctx = c.getContext('2d'); s.draw(ctx, 0, 0, w, h); s.close();
  return ctx.getImageData(0, 0, w, h).data;
}

/**
 * A video made 3D: `opened` (openVideo's), with `worker` (stereoWorker's, loaded). Options: layout, cap (per eye),
 * strength, convergence, smoothing, swap, detail, stride, trim { start, end }; `onProgress({ done, total, eta })`;
 * `signal` (cancels). Resolves to { blob, name, check, frames }.
 */
export async function convert3d(opened, file, worker, { layout = 'sbs', cap = 1920, strength = 3, convergence = 0.5, smoothing = 0.6, swap = false, detail = 350, stride = 1, trim = {}, onProgress = () => {}, signal } = {}) {
  const M = await mb(); const { input, video, audio, info } = opened;
  const start = Math.max(0, trim.start ?? 0); const end = Math.min(info.duration, trim.end ?? info.duration);
  if (end - start < 0.05) throw new Error('The trimmed part is too short.');
  const eye = V.eyeSize(info.w, info.h, cap); const fs = V.frameSize(layout, eye);
  if (!(await M.canEncodeVideo('avc', { width: fs.w, height: fs.h }))) throw new Error(`This phone can't encode H.264 at ${fs.w}×${fs.h}. Pick a smaller size per eye${layout === 'half' ? '' : ', or Half SBS'}.`);
  if (audio && audio.codec !== 'aac') await ensureAac();
  const total = await countFrames(video, start, end);
  const output = await makeOutput();
  const src = new OffscreenCanvas(eye.w, eye.h); const sctx = src.getContext('2d', { willReadFrequently: true });
  const out = new OffscreenCanvas(fs.w, fs.h); const octx = out.getContext('2d');
  await worker.reset();
  let done = 0; const t0 = Date.now(); let cuts = 0;
  const conversion = await M.Conversion.init({
    input, output, trim: { start, end }, showWarnings: false,
    video: { codec: 'avc', bitrate: M.QUALITY_HIGH, forceTranscode: true, width: eye.w, height: eye.h, fit: 'fill', processedWidth: fs.w, processedHeight: fs.h,
      process: async (sample) => {
        sctx.clearRect(0, 0, eye.w, eye.h); sample.draw(sctx, 0, 0, eye.w, eye.h);
        const rgba = sctx.getImageData(0, 0, eye.w, eye.h).data;
        const r = await worker.frame(rgba, eye.w, eye.h, { layout, strength, convergence, smoothing, swap, detail, stride });
        if (r.cut) cuts++;
        octx.putImageData(new ImageData(new Uint8ClampedArray(r.frame), r.fw, r.fh), 0, 0);
        done++; const el = (Date.now() - t0) / 1000; onProgress({ done, total, eta: done > 2 ? (el / done) * Math.max(0, total - done) : null, cuts });
        return out;
      } },
    audio: audio ? { codec: 'aac' } : undefined,
  });
  const lost = conversion.discardedTracks.filter((d) => d.track.type === 'audio');
  if (!conversion.isValid) throw new Error(`This video can't be converted here: ${conversion.discardedTracks.map((d) => `${d.track.type} (${why(d)})`).join(', ') || 'unknown reason'}.`);
  const stop = () => conversion.cancel();
  signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) throw canceled();
  try { await conversion.execute(); } catch (e) { if (signal?.aborted) throw canceled(); throw e; } finally { signal?.removeEventListener('abort', stop); }
  const blob = blobOf(output);
  const check = await checkOutput(blob, { w: fs.w, h: fs.h, duration: end - start, frames: total, audio: !!audio, fps: info.fps });
  if (lost.length) check.warnings.unshift(`The sound couldn't be kept (${why(lost[0])}).`);
  return { blob, name: V.vrName(file.name, layout), check, frames: done, cuts, size: fs };
}

// ---- Edits --------------------------------------------------------------------------------------------------------

/**
 * Edits in one pass: trim { start, end }, crop { left, top, width, height } (after rotation), size (the longer side:
 * 0 keeps it), rotate (0/90/180/270), flipH, flipV, audio ('keep' | 'remove'). Resolves to { blob, check }.
 */
export async function editVideo(opened, { trim = {}, crop = null, size = 0, rotate = 0, flipH = false, flipV = false, audio = 'keep', text = null, onProgress = () => {}, signal } = {}) {
  const M = await mb(); const { input, info } = opened;
  const start = Math.max(0, trim.start ?? 0); const end = Math.min(info.duration, trim.end ?? info.duration);
  const rot = ((rotate % 360) + (flipV ? 180 : 0)) % 360; const flip = flipH !== flipV; // (vertical flip: 180° and a horizontal one)
  const turned = rot % 180 ? { w: info.h, h: info.w } : { w: info.w, h: info.h };
  const region = crop ?? { left: 0, top: 0, width: turned.w, height: turned.h };
  const k = size > 0 ? Math.min(1, size / Math.max(region.width, region.height)) : 1;
  const W = Math.max(2, Math.round((region.width * k) / 2) * 2); const H = Math.max(2, Math.round((region.height * k) / 2) * 2);
  if (opened.audio && audio === 'keep' && opened.audio.codec !== 'aac') await ensureAac();
  const output = await makeOutput();
  const words = String(text?.value ?? '').trim();
  const plain = !crop && !size && !rot && !flip && !words;
  // (Text on it: drawn on each frame, at the size it's made.)
  const tc = words ? new OffscreenCanvas(W, H) : null; const tctx = tc?.getContext('2d');
  const conversion = await M.Conversion.init({
    input, output, trim: { start, end }, showWarnings: false,
    video: plain ? { codec: 'avc' } : { codec: 'avc', bitrate: M.QUALITY_HIGH, rotate: rot, flip, ...(crop ? { crop: { left: Math.round(crop.left), top: Math.round(crop.top), width: Math.round(crop.width), height: Math.round(crop.height) } } : {}), width: W, height: H, fit: 'fill',
      ...(words ? { process: (sample) => { tctx.clearRect(0, 0, W, H); sample.draw(tctx, 0, 0, W, H); drawText(tctx, W, H, { ...text, value: words }); return tc; } } : {}) },
    audio: audio === 'remove' ? { discard: true } : { codec: 'aac' },
  });
  if (!conversion.isValid) throw new Error(`This video can't be edited here: ${conversion.discardedTracks.map((d) => `${d.track.type} (${why(d)})`).join(', ')}.`);
  const lost = audio === 'keep' && opened.audio ? conversion.discardedTracks.filter((d) => d.track.type === 'audio') : [];
  conversion.onProgress = (p) => onProgress(p);
  const stop = () => conversion.cancel(); signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) throw canceled();
  try { await conversion.execute(); } catch (e) { if (signal?.aborted) throw canceled(); throw e; } finally { signal?.removeEventListener('abort', stop); }
  const blob = blobOf(output);
  const check = await checkOutput(blob, { w: plain ? 0 : W, h: plain ? 0 : H, duration: end - start, audio: audio === 'keep' && !!opened.audio, fps: info.fps });
  if (lost.length) check.warnings.unshift(`The sound couldn't be kept (${why(lost[0])}).`);
  return { blob, check };
}

/** A video with another file's sound instead of its own (trimmed to the video's length; silent after if shorter). */
export async function replaceAudio(opened, soundFile, { onProgress = () => {}, signal } = {}) {
  const M = await mb(); await ensureAac();
  const s = new M.Input({ source: new M.BlobSource(soundFile), formats: M.ALL_FORMATS });
  const sa = await s.getPrimaryAudioTrack(); if (!sa) throw new Error('That file has no sound in it.');
  const output = await makeOutput(); const dur = opened.info.duration;
  const cv = await M.Conversion.init({ input: opened.input, output, composable: true, showWarnings: false, video: { codec: 'avc' }, audio: { discard: true } });
  const ca = await M.Conversion.init({ input: s, output, composable: true, showWarnings: false, video: { discard: true }, audio: { codec: 'aac' }, trim: { start: 0, end: Math.min(dur, await s.computeDuration()) } });
  if (!ca.utilizedTracks.length) throw new Error(`That sound can't be used: ${ca.discardedTracks.map(why).join(', ')}.`);
  await output.start();
  const stop = () => { cv.cancel(); ca.cancel(); }; signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) throw canceled();
  cv.onProgress = (p) => onProgress(p);
  try { await Promise.all([cv.execute(), ca.execute()]); await output.finalize(); } catch (e) { if (signal?.aborted) throw canceled(); throw e; } finally { signal?.removeEventListener('abort', stop); }
  const blob = blobOf(output);
  return { blob, check: await checkOutput(blob, { duration: dur, audio: true, fps: opened.info.fps }) };
}

/** The sound alone, as an .m4a (AAC; copied when it's AAC already). */
export async function extractAudio(opened, { signal } = {}) {
  const M = await mb(); if (!opened.audio) throw new Error('This video has no sound.');
  if (opened.audio.codec !== 'aac') await ensureAac();
  const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
  const c = await M.Conversion.init({ input: opened.input, output, showWarnings: false, video: { discard: true }, audio: { codec: 'aac' } });
  if (!c.isValid) throw new Error(`The sound can't be saved: ${c.discardedTracks.map(why).join(', ')}.`);
  const stop = () => c.cancel(); signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) throw canceled();
  try { await c.execute(); } finally { signal?.removeEventListener('abort', stop); }
  return { blob: new Blob([output.target.buffer], { type: 'audio/mp4' }) };
}

/** PCM of a track as one AudioBuffer at 48 kHz stereo (resampled), or a silent one of `seconds` when there's none. */
async function pcmOf(track, seconds, start = 0, end = Infinity) {
  const rate = 48000; const len = Math.max(1, Math.round(seconds * rate));
  const ctx = new OfflineAudioContext(2, len, rate);
  if (track) {
    const M = await mb(); const sink = new M.AudioBufferSink(track);
    for await (const { buffer, timestamp } of sink.buffers(start, end)) { const n = ctx.createBufferSource(); n.buffer = buffer; n.connect(ctx.destination); n.start(Math.max(0, timestamp - start)); }
  }
  return ctx.startRendering();
}

/**
 * Clips joined end to end, each fitted into the first one's frame (black bars where shapes differ), their sound
 * joined in step (silence for a clip with none). `items`: [{ opened }]. Resolves to { blob, check }.
 */
export async function combine(items, { onProgress = () => {}, signal } = {}) {
  const M = await mb(); await ensureAac();
  const first = items[0].opened.info; const W = Math.round(first.w / 2) * 2; const H = Math.round(first.h / 2) * 2;
  if (!(await M.canEncodeVideo('avc', { width: W, height: H }))) throw new Error(`This phone can't encode H.264 at ${W}×${H}.`);
  const output = await makeOutput();
  const canvas = new OffscreenCanvas(W, H); const ctx = canvas.getContext('2d');
  const vs = new M.CanvasSource(canvas, { codec: 'avc', bitrate: M.QUALITY_HIGH }); output.addVideoTrack(vs, { frameRate: first.fps });
  const as = new M.AudioBufferSource({ codec: 'aac', bitrate: M.QUALITY_HIGH }); output.addAudioTrack(as);
  await output.start();
  let offset = 0; const totalDur = items.reduce((t, x) => t + x.opened.info.duration, 0);
  for (const { opened } of items) {
    const { info } = opened; const sink = new M.VideoSampleSink(opened.video);
    const k = Math.min(W / info.w, H / info.h); const dw = info.w * k; const dh = info.h * k;
    for await (const s of sink.samples()) {
      if (signal?.aborted) { s.close(); await output.cancel(); throw canceled(); }
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); s.draw(ctx, (W - dw) / 2, (H - dh) / 2, dw, dh);
      await vs.add(offset + s.timestamp, s.duration); s.close();
      onProgress(Math.min(0.99, (offset + s.timestamp) / totalDur));
    }
    await as.add(await pcmOf(opened.audio, info.duration));
    offset += info.duration;
  }
  vs.close(); as.close(); await output.finalize();
  const blob = blobOf(output);
  return { blob, check: await checkOutput(blob, { w: W, h: H, duration: totalDur, audio: true, fps: first.fps }) };
}

/** A video played backward (its sound too), worked through in short stretches from the end (a few frames held). */
export async function reverse(opened, { onProgress = () => {}, signal } = {}) {
  const M = await mb(); await ensureAac(); const { info } = opened;
  const W = Math.round(info.w / 2) * 2; const H = Math.round(info.h / 2) * 2;
  const output = await makeOutput();
  const canvas = new OffscreenCanvas(W, H); const ctx = canvas.getContext('2d');
  const vs = new M.CanvasSource(canvas, { codec: 'avc', bitrate: M.QUALITY_HIGH }); output.addVideoTrack(vs, { frameRate: info.fps });
  const as = opened.audio ? new M.AudioBufferSource({ codec: 'aac', bitrate: M.QUALITY_HIGH }) : null; if (as) output.addAudioTrack(as);
  await output.start();
  // (Every frame's time, from the packets; then stretches of up to 24 frames from the end, each decoded in order and
  // written back to front.)
  const pk = new M.EncodedPacketSink(opened.video); const times = [];
  for await (const p of pk.packets(undefined, undefined, { metadataOnly: true })) times.push({ t: p.timestamp, d: p.duration });
  times.sort((a, b) => a.t - b.t);
  const sink = new M.VideoSampleSink(opened.video); const first = times[0]?.t ?? 0; const end = info.duration;
  for (let hi = times.length; hi > 0; hi -= 24) {
    const lo = Math.max(0, hi - 24); const held = [];
    for await (const s of sink.samplesAtTimestamps(times.slice(lo, hi).map((x) => x.t))) { if (!s) continue; const c = new OffscreenCanvas(W, H); s.draw(c.getContext('2d'), 0, 0, W, H); held.push({ c, t: s.timestamp, d: s.duration }); s.close(); }
    for (let i = held.length - 1; i >= 0; i--) {
      if (signal?.aborted) { await output.cancel(); throw canceled(); }
      const f = held[i]; ctx.drawImage(f.c, 0, 0); await vs.add(end - (f.t - first) - f.d, f.d);
    }
    onProgress(1 - lo / times.length);
  }
  if (as) {
    const buf = await pcmOf(opened.audio, info.duration);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) buf.getChannelData(ch).reverse();
    await as.add(buf); as.close();
  }
  vs.close(); await output.finalize();
  const blob = blobOf(output);
  return { blob, check: await checkOutput(blob, { w: W, h: H, duration: info.duration, frames: times.length, audio: !!opened.audio, fps: info.fps }) };
}

// ---- Text on a video, speed, and GIFs ------------------------------------------------------------------------------

/**
 * Words drawn on a frame: `value`, `pos` ('top' | 'middle' | 'bottom'), `size` ('S' | 'M' | 'L'), `color` (CSS), with
 * a dark outline so they read on anything; long lines wrapped to the frame's width.
 */
export function drawText(ctx, W, H, { value = '', pos = 'bottom', size = 'M', color = '#ffffff' } = {}) {
  const px = Math.round(Math.min(W, H) * ({ S: 0.055, M: 0.08, L: 0.12 }[size] ?? 0.08));
  ctx.save(); ctx.font = `800 ${px}px system-ui, -apple-system, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = []; let cur = '';
  for (const w of String(value).split(/\s+/)) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > W * 0.88 && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  const lh = px * 1.2; const total = lh * lines.length;
  const y0 = pos === 'top' ? H * 0.08 + lh / 2 : pos === 'middle' ? H / 2 - total / 2 + lh / 2 : H * 0.92 - total + lh / 2;
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, px * 0.14); ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = color;
  lines.forEach((l, i) => { ctx.strokeText(l, W / 2, y0 + i * lh); ctx.fillText(l, W / 2, y0 + i * lh); });
  ctx.restore();
}

/**
 * A video sped up or slowed down (`speed`: 0.25 … 4), its sound too (faster is higher, slower is lower, as a tape
 * would). Frames are kept at its own frame rate (sped up: some left out; slowed: each held longer).
 */
export async function speedVideo(opened, speed, { onProgress = () => {}, signal } = {}) {
  const M = await mb(); const { info } = opened; const k = Math.max(0.25, Math.min(4, Number(speed) || 1));
  if (opened.audio) await ensureAac();
  const W = Math.round(info.w / 2) * 2; const H = Math.round(info.h / 2) * 2; const fps = info.fps || 30;
  const output = await makeOutput();
  const canvas = new OffscreenCanvas(W, H); const ctx = canvas.getContext('2d');
  const vs = new M.CanvasSource(canvas, { codec: 'avc', bitrate: M.QUALITY_HIGH }); output.addVideoTrack(vs, { frameRate: fps });
  const as = opened.audio ? new M.AudioBufferSource({ codec: 'aac', bitrate: M.QUALITY_HIGH }) : null; if (as) output.addAudioTrack(as);
  await output.start();
  const sink = new M.VideoSampleSink(opened.video); const dur = info.duration / k; let lastSlot = -1; let held = null;
  for await (const smp of sink.samples()) {
    if (signal?.aborted) { smp.close(); await output.cancel(); throw canceled(); }
    const t = smp.timestamp / k; const slot = Math.floor(t * fps + 1e-6);
    if (slot > lastSlot) {
      // (The frame before held until this one: slowed down, frames last longer.)
      if (held) { await vs.add(held.t, Math.max(1 / fps, t - held.t)); }
      ctx.clearRect(0, 0, W, H); smp.draw(ctx, 0, 0, W, H); held = { t }; lastSlot = slot;
    }
    smp.close(); onProgress(Math.min(0.95, t / dur));
  }
  if (held) await vs.add(held.t, Math.max(1 / fps, dur - held.t));
  if (as) {
    const src = await pcmOf(opened.audio, info.duration); const len = Math.max(1, Math.round(src.length / k));
    const oc = new OfflineAudioContext(src.numberOfChannels, len, src.sampleRate); const n = oc.createBufferSource(); n.buffer = src; n.playbackRate.value = k; n.connect(oc.destination); n.start();
    await as.add(await oc.startRendering()); as.close();
  }
  vs.close(); await output.finalize();
  const blob = blobOf(output);
  return { blob, check: await checkOutput(blob, { w: W, h: H, duration: dur, audio: !!opened.audio, fps }) };
}

/** The longest GIF made (a GIF of more is huge, and slow to make on a phone). */
export const GIF_MAX_SECONDS = 15;
/**
 * A GIF of a video (or its `trim`): `width` px wide (even), `fps` frames a second, each frame with its own 256-colour
 * palette (gifenc, vendor/gifenc, MIT). Resolves to { blob (image/gif), frames, w, h }.
 */
export async function makeGif(opened, { trim = {}, width = 480, fps = 12, onProgress = () => {}, signal } = {}) {
  const M = await mb(); const { info } = opened; const G = await import('../../vendor/gifenc/gifenc.esm.js');
  const start = Math.max(0, trim.start ?? 0); const end = Math.min(info.duration, trim.end ?? info.duration, start + GIF_MAX_SECONDS);
  if (end - start < 0.1) throw new Error('The part chosen is too short.');
  const w = Math.max(2, Math.round(Math.min(width, info.w) / 2) * 2); const h = Math.max(2, Math.round((w * info.h) / info.w / 2) * 2);
  const times = []; for (let t = start; t < end - 1e-6; t += 1 / fps) times.push(t);
  const c = new OffscreenCanvas(w, h); const ctx = c.getContext('2d', { willReadFrequently: true });
  const gif = G.GIFEncoder(); const sink = new M.VideoSampleSink(opened.video); let n = 0; const delay = Math.round(1000 / fps);
  for await (const smp of sink.samplesAtTimestamps(times)) {
    if (signal?.aborted) { smp?.close(); throw canceled(); }
    if (smp) { ctx.clearRect(0, 0, w, h); smp.draw(ctx, 0, 0, w, h); smp.close(); }
    const { data } = ctx.getImageData(0, 0, w, h);
    const palette = G.quantize(data, 256); const index = G.applyPalette(data, palette);
    gif.writeFrame(index, w, h, { palette, delay });
    n++; onProgress(n / times.length);
  }
  gif.finish();
  return { blob: new Blob([gif.bytes()], { type: 'image/gif' }), frames: n, w, h };
}
