// Video Editor → 📱 Socials Frame, its sums (pure, tested): the frames a video can be wrapped in (a story, a feed post,
// a short video, a video call: the app's own designs in those familiar shapes, no other app's name or logo), where the
// video goes in each, the one size every output has (1080 × 1920, portrait), and where to crop so the people in it
// stay in the frame (from the faces found every so often, eased from one to the next so the crop glides).

/** Every output's size: portrait 9:16, as phones show stories and calls. */
export const OUT = { w: 1080, h: 1920 };

/**
 * The frames: { id, name, note, video: { x, y, w, h } (where the video goes in OUT), fields: [what can be set] }.
 * Each is drawn by video-frame.js.
 */
export const STYLES = [
  { id: 'story', name: '📖 Story', note: 'Full screen, with progress bars, the account at the top and a reply box.', video: { x: 0, y: 0, w: 1080, h: 1920 }, fields: ['handle', 'avatar', 'time'] },
  { id: 'post', name: '🖼 Feed post', note: 'A 4:5 post with its header, likes and caption.', video: { x: 0, y: 330, w: 1080, h: 1350 }, fields: ['handle', 'avatar', 'time', 'caption', 'likes', 'comments', 'theme'] },
  { id: 'short', name: '🎬 Short video', note: 'Full screen, with likes and comments down the side and the caption below.', video: { x: 0, y: 0, w: 1080, h: 1920 }, fields: ['handle', 'avatar', 'caption', 'likes', 'comments', 'sound'] },
  { id: 'call', name: '📞 Video call', note: 'Full screen, with the caller\'s name, a call timer, your own small picture and call buttons.', video: { x: 0, y: 0, w: 1080, h: 1920 }, fields: ['name', 'avatar', 'selfie'] },
];
export const styleById = (id) => STYLES.find((s) => s.id === id) ?? STYLES[0];

/**
 * The part of a `W` × `H` frame to show in a box of shape `aspect` (w/h), centred as near (`cx`, `cy`) (0–1) as fits;
 * with no point, the middle (a little above, where faces usually are). Returns { sx, sy, sw, sh } in pixels.
 */
export function cropToward(W, H, aspect, cx = 0.5, cy = 0.45) {
  let sw = W; let sh = W / aspect; if (sh > H) { sh = H; sw = H * aspect; }
  sw = Math.min(W, Math.round(sw)); sh = Math.min(H, Math.round(sh)); // (whole pixels, never past the edge)
  const sx = Math.round(Math.max(0, Math.min(W - sw, cx * W - sw / 2))); const sy = Math.round(Math.max(0, Math.min(H - sh, cy * H - sh / 2)));
  return { sx, sy, sw, sh };
}

/**
 * Where the people are over time, from faces found at some moments: `found` [{ t, faces: [{ x, y, w, h } (0–1)] }].
 * Each moment's point is the faces' middle, weighted by size (a near face counts more), a little above it (heads
 * and shoulders); moments with none keep the last point. Returns focusAt(t) → { x, y }, eased between moments.
 */
export function focusPath(found, { fallback = { x: 0.5, y: 0.45 } } = {}) {
  const pts = []; let last = null;
  for (const f of [...(found ?? [])].sort((a, b) => a.t - b.t)) {
    const fs = (f.faces ?? []).filter((b) => b.w > 0.02);
    if (fs.length) {
      let wsum = 0; let x = 0; let y = 0;
      for (const b of fs) { const wt = b.w * b.h; x += (b.x + b.w / 2) * wt; y += (b.y + b.h * 0.6) * wt; wsum += wt; }
      last = { t: f.t, x: x / wsum, y: y / wsum };
    }
    if (last) pts.push({ t: f.t, x: last.x, y: last.y });
  }
  // (Smoothed: each point eased toward its neighbours, so a face found a little off one moment doesn't jerk the crop.)
  const sm = pts.map((p, i) => { const a = pts[i - 1] ?? p; const b = pts[i + 1] ?? p; return { t: p.t, x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 }; });
  return (t) => {
    if (!sm.length) return fallback;
    if (t <= sm[0].t) return sm[0]; if (t >= sm[sm.length - 1].t) return sm[sm.length - 1];
    let i = 1; while (sm[i].t < t) i++;
    const a = sm[i - 1]; const b = sm[i]; const k = (t - a.t) / Math.max(1e-6, b.t - a.t); const e = k * k * (3 - 2 * k); // (eased in and out)
    return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
  };
}

/** A count as apps show it: 999, 1.2K, 34K, 1.5M. */
export function shortCount(n) {
  n = Math.max(0, Math.round(Number(n) || 0));
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, '')}M`;
}
/** A call's time so far: 0:07, 1:05, 12:00. */
export const callClock = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** The file name of a framed video: its own, with the frame's name. */
export const framedName = (name, styleId) => `${String(name || 'video').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[\\/:*?"<>|]+/g, '_') || 'video'}-${styleId}.mp4`;
