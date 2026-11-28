// Video Editor → 📱 Socials Frame: a video wrapped in a social-app frame (a story, a feed post, a short video, a video
// call; the app's own designs in those familiar shapes, with no other app's name or logo), cropped to the frame's
// shape around the people in it (faces found every half second on this phone, face-api's tiny detector, eased from one
// to the next), as one uniform output: MP4, 1080 × 1920, its sound kept. Sums in video-frame-core.js.
import { el, fill, store, about } from '../../lib/dom.js';
import { OUT, STYLES, styleById, cropToward, focusPath, shortCount, callClock, framedName } from './video-frame-core.js';
import * as O from './video-ops.js';
import { picker, field, group, select, toggle, segmented, progressBar, secs, resultCard, showError, timeline } from './video-ui.js';

const KEY = 'cc.videoframe.options';
const DEFAULTS = { style: 'story', handle: 'me', time: '2h', caption: '', likes: 1280, comments: 46, theme: 'light', sound: 'Original sound', name: 'Alex', selfie: 'blur', people: true };

// ---- People in the frame: faces found, every so often (face-api's tiny face detector, on the phone).
let faceP = null;
function faceApi() {
  faceP ??= (async () => {
    const api = await import(new URL('../../vendor/face/face-api.esm.js', import.meta.url).href);
    if (!api.tf.getBackend()) { try { await api.tf.setBackend('webgl'); } catch { await api.tf.setBackend('cpu'); } }
    await api.tf.ready();
    if (!api.nets.tinyFaceDetector.isLoaded) await api.nets.tinyFaceDetector.loadFromUri(new URL('../../vendor/face/model/', import.meta.url).href);
    return api;
  })();
  faceP.catch(() => { faceP = null; });
  return faceP;
}
/** Faces at moments of the video (every `every` s, at most `max`): [{ t (from `start`), faces: [{ x, y, w, h } 0–1] }]. */
export async function findPeople(opened, { start = 0, end = opened.info.duration, every = 0.5, max = 90, onProgress = () => {}, signal } = {}) {
  const api = await faceApi(); const M = await O.mb();
  const n = Math.min(max, Math.max(1, Math.floor((end - start) / every) + 1)); const times = Array.from({ length: n }, (_, i) => start + ((end - start) * i) / Math.max(1, n - 1));
  const { w, h } = opened.info; const k = Math.min(1, 800 / Math.max(w, h)); const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext('2d', { willReadFrequently: true }); const out = []; let i = 0;
  const sink = new M.VideoSampleSink(opened.video);
  for await (const s of sink.samplesAtTimestamps(times)) {
    if (signal?.aborted) { s?.close(); throw Object.assign(new Error('Canceled.'), { canceled: true }); }
    const t = times[i++] - start;
    if (s) { s.draw(ctx, 0, 0, c.width, c.height); s.close(); }
    const found = s ? await api.detectAllFaces(c, new api.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.35 })) : [];
    out.push({ t, faces: found.map((d) => ({ x: d.box.x / c.width, y: d.box.y / c.height, w: d.box.width / c.width, h: d.box.height / c.height })) });
    onProgress(i / times.length);
  }
  return out;
}

// ---- Drawing.
const font = (px, weight = 600) => `${weight} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function textShadow(ctx, on = true) { ctx.shadowColor = on ? 'rgba(0,0,0,.55)' : 'transparent'; ctx.shadowBlur = on ? 8 : 0; ctx.shadowOffsetY = on ? 2 : 0; }
/** An avatar: the picture chosen (cover), else the handle's first letter on a colour of its own. */
function avatar(ctx, img, handle, cx, cy, r, ring = null) {
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
  if (ring) { ctx.lineWidth = 5; ctx.strokeStyle = ring; ctx.stroke(); }
  ctx.clip();
  if (img) { const k = Math.max((2 * r) / img.width, (2 * r) / img.height); const w = img.width * k; const h = img.height * k; ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h); }
  else { let hh = 0; for (const ch of String(handle)) hh = (hh * 31 + ch.charCodeAt(0)) >>> 0; ctx.fillStyle = `hsl(${hh % 360} 55% 48%)`; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r); ctx.fillStyle = '#fff'; ctx.font = font(r, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText((String(handle)[0] ?? '?').toUpperCase(), cx, cy + r * 0.05); }
  ctx.restore();
}
const gradient = (ctx, y0, y1, a0, a1) => { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, `rgba(0,0,0,${a0})`); g.addColorStop(1, `rgba(0,0,0,${a1})`); ctx.fillStyle = g; ctx.fillRect(0, Math.min(y0, y1), OUT.w, Math.abs(y1 - y0)); };
function heart(ctx, x, y, s, fillIt = false) { ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24); ctx.beginPath(); ctx.moveTo(12, 21); ctx.bezierCurveTo(5, 15, 1, 11.5, 1, 7.5); ctx.bezierCurveTo(1, 4, 3.5, 2, 6.5, 2); ctx.bezierCurveTo(8.5, 2, 10.5, 3.2, 12, 5); ctx.bezierCurveTo(13.5, 3.2, 15.5, 2, 17.5, 2); ctx.bezierCurveTo(20.5, 2, 23, 4, 23, 7.5); ctx.bezierCurveTo(23, 11.5, 19, 15, 12, 21); ctx.closePath(); ctx.lineWidth = 2.2; if (fillIt) ctx.fill(); else ctx.stroke(); ctx.restore(); }
function bubble(ctx, x, y, s) { ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24); ctx.beginPath(); ctx.arc(12, 11, 9.5, 0.65 * Math.PI, 2.55 * Math.PI); ctx.lineTo(3, 21); ctx.closePath(); ctx.lineWidth = 2.2; ctx.stroke(); ctx.restore(); }
function plane(ctx, x, y, s) { ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24); ctx.beginPath(); ctx.moveTo(22, 2); ctx.lineTo(2, 10); ctx.lineTo(10, 13); ctx.lineTo(13, 22); ctx.closePath(); ctx.moveTo(22, 2); ctx.lineTo(10, 13); ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); }
function mark(ctx, x, y, s) { ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24); ctx.beginPath(); ctx.moveTo(5, 2); ctx.lineTo(19, 2); ctx.lineTo(19, 22); ctx.lineTo(12, 16); ctx.lineTo(5, 22); ctx.closePath(); ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); }
const ellipsize = (ctx, s, max) => { s = String(s); if (ctx.measureText(s).width <= max) return s; while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1); return `${s}…`; };

/**
 * One finished frame: the video's frame (`src`, a canvas `W` × `H`) cropped toward `focus` into the style's place, then
 * the style drawn over it, `t` seconds in of `dur`. `o`: the options; `img`: the avatar (ImageBitmap) or null.
 */
export function drawFrame(ctx, src, W, H, focus, t, dur, o, img) {
  const st = styleById(o.style); const v = st.video; const dark = o.theme === 'dark';
  ctx.save(); ctx.fillStyle = st.id === 'post' ? (dark ? '#000' : '#fff') : '#000'; ctx.fillRect(0, 0, OUT.w, OUT.h);
  const c = cropToward(W, H, v.w / v.h, focus.x, focus.y); ctx.drawImage(src, c.sx, c.sy, c.sw, c.sh, v.x, v.y, v.w, v.h);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const handle = String(o.handle || 'me').replace(/^@/, '');
  if (st.id === 'story') {
    gradient(ctx, 0, 300, 0.55, 0); gradient(ctx, OUT.h, OUT.h - 320, 0.5, 0);
    // (Progress: three stories, this the second, filling as it plays.)
    const gap = 10; const sw = (OUT.w - 48 - gap * 2) / 3;
    for (let i = 0; i < 3; i++) { const x = 24 + i * (sw + gap); rr(ctx, x, 36, sw, 7, 4); ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fill(); const f = i === 0 ? 1 : i === 1 ? Math.min(1, t / Math.max(0.1, dur)) : 0; if (f > 0) { rr(ctx, x, 36, sw * f, 7, 4); ctx.fillStyle = '#fff'; ctx.fill(); } }
    avatar(ctx, img, handle, 84, 112, 40);
    textShadow(ctx); ctx.fillStyle = '#fff'; ctx.font = font(36, 700); ctx.fillText(handle, 142, 112); const hw = ctx.measureText(handle).width;
    ctx.font = font(32, 500); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText(o.time || '', 142 + hw + 18, 112);
    ctx.font = font(48, 700); ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText('⋯', OUT.w - 40, 106); ctx.textAlign = 'left';
    textShadow(ctx, false); rr(ctx, 36, OUT.h - 150, 790, 92, 46); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 3; ctx.stroke();
    textShadow(ctx); ctx.font = font(34, 500); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText('Send message', 76, OUT.h - 104);
    ctx.strokeStyle = '#fff'; heart(ctx, 860, OUT.h - 130, 52); plane(ctx, 960, OUT.h - 130, 52);
  } else if (st.id === 'post') {
    const fg = dark ? '#fff' : '#111'; const sub = dark ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.55)';
    ctx.fillStyle = fg; ctx.font = font(44, 700); ctx.textAlign = 'center'; ctx.fillText('Posts', OUT.w / 2, 150); ctx.textAlign = 'left'; ctx.font = font(64, 400); ctx.fillText('‹', 36, 146);
    avatar(ctx, img, handle, 76, 266, 40, dark ? '#444' : '#ddd');
    ctx.fillStyle = fg; ctx.font = font(34, 700); ctx.fillText(handle, 136, 266); ctx.font = font(48, 700); ctx.textAlign = 'right'; ctx.fillText('⋯', OUT.w - 36, 258); ctx.textAlign = 'left';
    const iy = v.y + v.h + 30; ctx.strokeStyle = fg; heart(ctx, 36, iy, 58); bubble(ctx, 130, iy, 56); plane(ctx, 224, iy, 54); mark(ctx, OUT.w - 92, iy, 56);
    ctx.fillStyle = fg; ctx.font = font(32, 700); ctx.fillText(`${Number(o.likes || 0).toLocaleString('en-US')} likes`, 36, iy + 110);
    ctx.font = font(32, 700); const cap = String(o.caption || ''); ctx.fillText(handle, 36, iy + 162); const hw = ctx.measureText(`${handle} `).width; ctx.font = font(32, 400); ctx.fillText(ellipsize(ctx, cap, OUT.w - 72 - hw), 36 + hw, iy + 162);
    ctx.fillStyle = sub; ctx.font = font(26, 500); ctx.fillText(`${o.comments ? `View all ${shortCount(o.comments)} comments · ` : ''}${String(o.time || '').toUpperCase()}${o.time ? ' AGO' : ''}`, 36, iy + 210);
  } else if (st.id === 'short') {
    gradient(ctx, OUT.h, OUT.h - 620, 0.65, 0); gradient(ctx, 0, 220, 0.35, 0);
    textShadow(ctx); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.textAlign = 'center';
    const col = OUT.w - 84;
    heart(ctx, col - 36, 1160, 72); ctx.font = font(30, 700); ctx.fillText(shortCount(o.likes), col, 1270);
    bubble(ctx, col - 34, 1330, 68); ctx.fillText(shortCount(o.comments), col, 1438);
    plane(ctx, col - 32, 1500, 64); ctx.fillText('Share', col, 1600);
    ctx.font = font(52, 700); ctx.fillText('⋯', col, 1680); ctx.textAlign = 'left';
    avatar(ctx, img, handle, 80, 1640, 40, '#fff'); ctx.font = font(34, 700); ctx.fillText(handle, 136, 1640); const hw = ctx.measureText(handle).width;
    textShadow(ctx, false); rr(ctx, 136 + hw + 22, 1614, 130, 54, 14); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); textShadow(ctx); ctx.font = font(28, 700); ctx.fillText('Follow', 136 + hw + 42, 1641);
    ctx.font = font(32, 400); ctx.fillText(ellipsize(ctx, o.caption || '', 860), 40, 1730);
    ctx.font = font(28, 500); ctx.fillText(ellipsize(ctx, `♪ ${o.sound || 'Original sound'} · ${handle}`, 820), 40, 1800);
  } else if (st.id === 'call') {
    gradient(ctx, 0, 360, 0.6, 0); gradient(ctx, OUT.h, OUT.h - 420, 0.6, 0);
    textShadow(ctx); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = font(52, 700); ctx.fillText(o.name || 'Alex', OUT.w / 2, 140);
    ctx.font = font(34, 500); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(callClock(t), OUT.w / 2, 200); ctx.textAlign = 'left'; textShadow(ctx, false);
    // (Your own picture, small, at the top right: a soft copy of the video, your picture, or none.)
    if (o.selfie !== 'none') {
      const px = OUT.w - 320; const py = 270; const pw = 280; const ph = 420;
      ctx.save(); rr(ctx, px, py, pw, ph, 30); ctx.clip();
      if (o.selfie === 'avatar' && img) { const k = Math.max(pw / img.width, ph / img.height); ctx.drawImage(img, px + (pw - img.width * k) / 2, py + (ph - img.height * k) / 2, img.width * k, img.height * k); }
      else if (o.selfie === 'avatar') { ctx.fillStyle = '#333'; ctx.fillRect(px, py, pw, ph); avatar(ctx, null, handle, px + pw / 2, py + ph / 2, 80); }
      else { ctx.filter = 'blur(14px) brightness(0.85)'; const cc = cropToward(W, H, pw / ph, 0.5, 0.5); ctx.drawImage(src, cc.sx, cc.sy, cc.sw, cc.sh, px - 20, py - 20, pw + 40, ph + 40); ctx.filter = 'none'; }
      ctx.restore(); rr(ctx, px, py, pw, ph, 30); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 3; ctx.stroke();
    }
    rr(ctx, 60, OUT.h - 270, OUT.w - 120, 190, 95); ctx.fillStyle = 'rgba(30,30,30,.6)'; ctx.fill();
    const ys = OUT.h - 175; const xs = [210, 430, 650]; ctx.font = font(52, 400); ctx.textAlign = 'center';
    for (const [i, g] of ['🎤', '📷', '🔊'].entries()) { ctx.beginPath(); ctx.arc(xs[i], ys, 62, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(g, xs[i], ys + 4); }
    ctx.beginPath(); ctx.arc(870, ys, 62, 0, Math.PI * 2); ctx.fillStyle = '#ff3b30'; ctx.fill();
    ctx.save(); ctx.translate(870, ys); ctx.rotate(Math.PI * 0.75); ctx.font = font(52, 400); ctx.fillText('📞', 0, 4); ctx.restore(); ctx.textAlign = 'left';
  }
  ctx.restore();
}

/**
 * A video framed: `opened`, options `o` (the style and its words), `img` (avatar or null), `trim`, `people` (keep the
 * faces in frame). Resolves to { blob, check, name }. Output: OUT, its frame rate and sound kept.
 */
export async function frameVideo(opened, file, o, img, { trim = {}, onProgress = () => {}, signal } = {}) {
  const M = await O.mb(); const { input, audio, info } = opened;
  const start = Math.max(0, trim.start ?? 0); const end = Math.min(info.duration, trim.end ?? info.duration);
  if (end - start < 0.1) throw new Error('The part chosen is too short.');
  if (!(await M.canEncodeVideo('avc', { width: OUT.w, height: OUT.h }))) throw new Error(`This phone can't encode H.264 at ${OUT.w}×${OUT.h}.`);
  if (audio && audio.codec !== 'aac') await O.ensureAac();
  const found = o.people ? await findPeople(opened, { start, end, onProgress: (p) => onProgress(p * 0.2, 'Finding the people…'), signal }).catch((e) => { if (e.canceled) throw e; return []; }) : [];
  const focusAt = focusPath(found);
  const W = Math.round(info.w / 2) * 2; const H = Math.round(info.h / 2) * 2;
  const src = new OffscreenCanvas(W, H); const sctx = src.getContext('2d');
  const out = new OffscreenCanvas(OUT.w, OUT.h); const octx = out.getContext('2d');
  const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
  const dur = end - start;
  const conversion = await M.Conversion.init({
    input, output, trim: { start, end }, showWarnings: false,
    video: { codec: 'avc', bitrate: M.QUALITY_HIGH, forceTranscode: true, width: W, height: H, fit: 'fill', processedWidth: OUT.w, processedHeight: OUT.h,
      process: (sample) => { const t = Math.max(0, sample.timestamp - start); sctx.clearRect(0, 0, W, H); sample.draw(sctx, 0, 0, W, H); drawFrame(octx, src, W, H, focusAt(t), t, dur, o, img); return out; } },
    audio: audio ? { codec: 'aac' } : undefined,
  });
  if (!conversion.isValid) throw new Error('This video can\'t be converted here.');
  conversion.onProgress = (p) => onProgress(0.2 + p * 0.8, `Making it… ${Math.round(p * 100)}%`);
  const stop = () => conversion.cancel(); signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) throw Object.assign(new Error('Canceled.'), { canceled: true });
  try { await conversion.execute(); } catch (e) { if (signal?.aborted) throw Object.assign(new Error('Canceled.'), { canceled: true }); throw e; } finally { signal?.removeEventListener('abort', stop); }
  const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
  const check = await O.checkOutput(blob, { w: OUT.w, h: OUT.h, duration: dur, audio: !!audio, fps: info.fps });
  return { blob, check, name: framedName(file.name, o.style), people: found.filter((f) => f.faces.length).length };
}

/**
 * A framed video put on a Socials account as a draft post (its video and a still of it, the frame's caption), waiting
 * there for you to look it over and share it. Socials must be unlocked in this session. Resolves to the post's id.
 */
export async function toSocialsDraft(blob, name, accountId, caption = '') {
  const S = await import('../../apps/socials/socials-store.js'); const C = await import('../../apps/socials/socials-core.js');
  const { state } = await S.loadState();
  if (!C.accountById(state, accountId)) throw new Error('That account isn\'t in Socials any more.');
  const { prepareVideo } = await import('../../apps/socials/socials-editor.js');
  const v = await prepareVideo(new File([blob], name, { type: 'video/mp4' }));
  const p = C.addPost(state, accountId, { image: v.still, video: v.video, caption: String(caption ?? '').slice(0, 2200), draft: true });
  p.fromFrame = { name, at: Date.now() };
  await S.saveState(state);
  return p.id;
}
/** Socials' accounts to post as ([{ id, handle, owner }], the Owner first), or null when Socials is locked. */
async function socialsAccounts() {
  try {
    const S = await import('../../apps/socials/socials-store.js'); const C = await import('../../apps/socials/socials-core.js');
    const { state } = await S.loadState();
    return C.accountsInOrder(state).map((a) => ({ id: a.id, handle: a.handle, owner: !!a.owner }));
  } catch { return null; }
}
/** 📤 Make a Socials post: which account, then a draft on it (or why it can't be yet). */
function socialsPostBox(r, o) {
  const box = el('div', { class: 'vid-topost' }, el('p', { class: 'small muted', text: 'Looking for your Socials accounts…' }));
  socialsAccounts().then((accts) => {
    if (!accts) { fill(box, el('p', { class: 'small', text: '📤 To make it a Socials post, open Socials once (it asks for its password), then come back here: this video stays.' })); return; }
    if (!accts.length) { fill(box, el('p', { class: 'small', text: '📤 Make an account in Socials first to post this from it.' })); return; }
    const want = String(o.handle || '').replace(/^@/, '').toLowerCase();
    const first = accts.find((a) => a.handle.toLowerCase() === want) ?? accts[0];
    const who = select(first.id, accts.map((a) => [a.id, `@${a.handle}${a.owner ? ' (Owner)' : ''}`]), () => {});
    who.setAttribute('aria-label', 'Post as');
    const cap = el('input', { type: 'text', class: 'so-input', value: o.caption || '', placeholder: 'Caption (optional)', 'aria-label': 'Post caption', maxlength: '2200' });
    const note = el('p', { class: 'small', role: 'status' });
    const btn = el('button', { type: 'button', class: 'btn primary', text: '📤 Make a Socials post', onclick: async () => {
      btn.disabled = true; note.textContent = 'Putting it in Socials…';
      try {
        await toSocialsDraft(r.blob, r.name, who.value, cap.value);
        const h = accts.find((a) => a.id === who.value)?.handle;
        fill(note, `✓ A draft on @${h} in Socials, waiting for you to share it. `, el('a', { href: '#/socials', text: 'Open Socials' }));
      } catch (e) { note.textContent = e.message === 'Socials is locked.' ? 'Socials is locked: open it once (its password), then tap again.' : `It couldn't be put in Socials: ${e.message}`; btn.disabled = false; }
    } });
    fill(box, el('strong', { text: '📤 Post it in Socials' }), el('div', { class: 'vid-topost-row' }, who, cap, btn), note);
  });
  return box;
}

export function mount(host) {
  const o = { ...DEFAULTS, ...store.json(KEY, {}) }; const save = () => store.set(KEY, JSON.stringify(o));
  const urls = new Set(); let file = null; let opened = null; let img = null; let controller = null; let tl = null; const trim = { start: 0, end: 0 };
  const status = el('div', { class: 'vid-status', role: 'status' });
  const pick = picker('Choose a video', (f) => openFile(f[0]));
  const opts = el('div', { class: 'options' });
  const preview = el('canvas', { class: 'vid-frame-preview', width: String(OUT.w / 3), height: String(OUT.h / 3), 'aria-label': 'How it will look' });
  const go = el('button', { type: 'button', class: 'btn primary block', text: 'Make the video', onclick: () => run() });
  const progress = progressBar(); const out = el('div', {});
  const work = el('div', { hidden: true }, opts, el('div', { class: 'vid-frame-wrap' }, preview), go, progress, out);
  host.append(el('h2', { class: 'vid-title', text: '📱 Socials Frame' }), status, pick, work,
    about(`Wraps a video in a social-app frame (a story, a feed post, a short video or a video call: this app's own designs, with no other app's name or logo), cropped to the frame's shape around the people in it (faces found on this phone), as one size every time: MP4, ${OUT.w} × ${OUT.h}, portrait, with its sound. Nothing is uploaded.`));
  O.videoSupport().then((s) => { if (!s.ok) { fill(status, el('p', { class: 'bad-text', text: `Can't make videos in this browser: ${s.why}` })); pick.hidden = true; } });

  async function openFile(f) {
    fill(out);
    try {
      fill(status, el('p', { class: 'small muted', text: `Opening ${f.name}…` }));
      opened = await O.openVideo(f); file = f; trim.start = 0; trim.end = opened.info.duration;
      tl = timeline(opened, O.frameAt, { start: 0, end: trim.end, onChange: (s, e) => { trim.start = s; trim.end = e; } });
      fill(status, el('p', { class: 'small muted', text: `${f.name}: ${opened.info.w}×${opened.info.h} · ${secs(opened.info.duration)} · ${opened.info.audio ? 'with sound' : 'no sound'}` }));
      work.hidden = false; render(); drawPreview();
    } catch (e) { work.hidden = true; showError(status, e); }
  }

  function render() {
    const st = styleById(o.style); const has = (k) => st.fields.includes(k);
    const text = (k, label, ph = '') => { const i = el('input', { type: 'text', class: 'so-input', value: String(o[k] ?? ''), placeholder: ph, 'aria-label': label, maxlength: '140' }); i.addEventListener('input', () => { o[k] = i.value; save(); drawPreview(); }); return field(label, i); };
    const num = (k, label) => { const i = el('input', { type: 'number', class: 'so-input', min: '0', value: String(o[k] ?? 0), 'aria-label': label, inputmode: 'numeric' }); i.addEventListener('input', () => { o[k] = Number(i.value) || 0; save(); drawPreview(); }); return field(label, i); };
    const av = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'vf-avatar' });
    av.addEventListener('change', async () => { const f = av.files[0]; if (!f) return; try { img = await createImageBitmap(f); drawPreview(); render(); } catch { showError(out, new Error('That picture couldn\'t be read.')); } });
    fill(opts,
      group('Frame', segmented('Frame', o.style, STYLES.map((s) => [s.id, s.name]), (v) => { o.style = v; save(); render(); drawPreview(); })),
      el('p', { class: 'small muted', text: `${st.note} Output ${OUT.w}×${OUT.h}.` }),
      group('Part', tl),
      has('handle') ? text('handle', 'Name shown', 'me') : null,
      has('name') ? text('name', 'Caller\'s name', 'Alex') : null,
      has('avatar') ? el('div', { class: 'row' }, el('label', { class: 'btn small', for: 'vf-avatar', text: img ? 'Change picture' : 'Choose a picture' }), img ? el('button', { type: 'button', class: 'btn small ghost', text: 'No picture', onclick: () => { img = null; render(); drawPreview(); } }) : null, av) : null,
      has('time') ? text('time', 'Posted (how long ago)', '2h') : null,
      has('caption') ? text('caption', 'Caption', 'Best day ever ☀️') : null,
      has('likes') ? num('likes', 'Likes') : null,
      has('comments') ? num('comments', 'Comments') : null,
      has('sound') ? text('sound', 'Sound name', 'Original sound') : null,
      has('theme') ? field('Look', select(o.theme, [['light', 'Light'], ['dark', 'Dark']], (v) => { o.theme = v; save(); drawPreview(); })) : null,
      has('selfie') ? field('Your small picture', select(o.selfie, [['blur', 'Soft copy of the video'], ['avatar', 'Your picture'], ['none', 'None']], (v) => { o.selfie = v; save(); drawPreview(); })) : null,
      toggle('Keep the people in frame (finds faces)', o.people, (v) => { o.people = v; save(); }));
  }

  let drawing = 0;
  async function drawPreview() {
    if (!opened) return; const my = ++drawing;
    const t = Math.min(opened.info.duration - 0.05, (trim.start + trim.end) / 2);
    const W = Math.round(opened.info.w / 2) * 2; const H = Math.round(opened.info.h / 2) * 2;
    try {
      const px = await O.frameAt(opened, t, W, H); if (my !== drawing) return;
      const src = new OffscreenCanvas(W, H); src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
      const big = new OffscreenCanvas(OUT.w, OUT.h); drawFrame(big.getContext('2d'), src, W, H, { x: 0.5, y: 0.45 }, t - trim.start, trim.end - trim.start, o, img);
      preview.getContext('2d').drawImage(big, 0, 0, preview.width, preview.height);
    } catch { /* a frame that won't read: the preview stays */ }
  }

  async function run() {
    if (controller) { controller.abort(); return; }
    controller = new AbortController(); fill(out); go.textContent = 'Cancel'; progress.set(0, 'Starting…');
    for (const u of urls) URL.revokeObjectURL(u); urls.clear();
    try {
      const r = await frameVideo(opened, file, o, img, { trim, signal: controller.signal, onProgress: (p, label) => progress.set(p, label) });
      progress.hide();
      fill(out, resultCard({ blob: r.blob, name: r.name, check: r.check, extra: [el('p', { class: 'small muted', text: o.people ? (r.people ? `Kept the people in frame (faces found at ${r.people} moment${r.people === 1 ? '' : 's'}).` : 'No faces found: cropped around the middle.') : 'Cropped around the middle.' }), socialsPostBox(r, o)] }, urls));
    } catch (e) { progress.hide(); showError(out, e.canceled ? new Error('Canceled. Nothing was saved.') : new Error(`The video couldn't be made: ${e.message}`)); }
    finally { controller = null; go.textContent = 'Make the video'; }
  }

  return { openFile, destroy: () => { controller?.abort(); for (const u of urls) URL.revokeObjectURL(u); } };
}
