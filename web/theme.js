// App-wide look: the background color chosen in Settings. A plain script loaded in <head> (before
// the stylesheet's first paint), so the page never flashes the default colors first. From the
// background, the rest follows so everything stays readable: light or dark text, cards a shade off
// the background, borders, muted text. Stored on this phone only (localStorage). Also importable in
// Node for tests: it puts its functions on globalThis.ccTheme.
(function () {
  const KEY = 'cc.theme.v1';
  const DEFAULT_THEME_COLOR = '#0f1115';
  const PRESETS = [
    { id: 'midnight', name: 'Midnight', bg: '#0b1020' },
    { id: 'charcoal', name: 'Charcoal', bg: '#1c1c1e' },
    { id: 'navy', name: 'Navy', bg: '#0f2a4a' },
    { id: 'forest', name: 'Forest', bg: '#13261c' },
    { id: 'plum', name: 'Plum', bg: '#2a1530' },
    { id: 'slate', name: 'Slate', bg: '#e6eaf0' },
    { id: 'sand', name: 'Sand', bg: '#f4ecdc' },
    { id: 'mint', name: 'Mint', bg: '#e3f4ec' },
    { id: 'blush', name: 'Blush', bg: '#f8e7ec' },
    { id: 'white', name: 'White', bg: '#ffffff' },
  ];
  const VARS = ['--bg', '--surface', '--border', '--text', '--muted', '--idle-bg'];

  function parse(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  const toHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  /** WCAG relative luminance (0 black .. 1 white). */
  function luminance(c) {
    const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const contrast = (a, b) => { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  /**
   * The colors that go with background `bg` (#rrggbb): { scheme: 'dark' | 'light', vars: { '--bg', ... } },
   * or null for a color that isn't one.
   */
  function palette(bg) {
    const c = parse(bg);
    if (!c) return null;
    const white = [255, 255, 255]; const black = [0, 0, 0];
    const dark = contrast(white, c) >= contrast(black, c);
    const surface = dark ? mix(c, white, 0.07) : mix(c, white, 0.7);
    // Soft white or near-black text, or pure white or black on mid tones where that's needed.
    let text = dark ? [232, 234, 238] : [20, 23, 28];
    if (Math.min(contrast(text, c), contrast(text, surface)) < 7) text = dark ? white : black;
    const border = dark ? mix(c, white, 0.16) : mix(c, black, 0.1);
    // Muted text: as far toward the background as still reads easily (4.5:1 on cards and background).
    let muted = text;
    for (let t = 0.6; t >= 0; t -= 0.05) {
      const m = mix(text, c, t);
      if (contrast(m, c) >= 4.5 && contrast(m, surface) >= 4.5) { muted = m; break; }
    }
    return {
      scheme: dark ? 'dark' : 'light',
      vars: { '--bg': toHex(c), '--surface': toHex(surface), '--border': toHex(border), '--text': toHex(text), '--muted': toHex(muted), '--idle-bg': toHex(dark ? mix(c, white, 0.12) : mix(c, black, 0.06)) },
    };
  }

  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); return s && parse(s.bg) ? { bg: toHex(parse(s.bg)) } : null; } catch { return null; }
  }

  /** Apply a setting ({ bg } or null for the system's light/dark default) to the page. */
  function apply(setting, doc = typeof document === 'undefined' ? null : document) {
    if (!doc) return;
    const root = doc.documentElement;
    const p = setting ? palette(setting.bg) : null;
    for (const v of VARS) root.style.removeProperty(v);
    if (p) { root.dataset.theme = p.scheme; for (const [k, v] of Object.entries(p.vars)) root.style.setProperty(k, v); } else delete root.dataset.theme;
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', p ? p.vars['--bg'] : DEFAULT_THEME_COLOR);
  }

  /** Save and apply; null goes back to the default. */
  function save(setting) {
    try { if (setting) localStorage.setItem(KEY, JSON.stringify({ bg: setting.bg })); else localStorage.removeItem(KEY); } catch { /* private mode: this visit only */ }
    apply(setting);
  }

  globalThis.ccTheme = { KEY, PRESETS, palette, contrast, parse, load, apply, save };
  if (typeof document !== 'undefined') apply(load());
})();
