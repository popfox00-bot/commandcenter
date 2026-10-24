// Editor state: everything is non-destructive and serializable (it is autosaved), and the original
// image is never modified. Values for adjustments are -1..1 (or 0..1 where noted).

import { FULL_CROP } from './geometry.js';

export const ADJUSTMENTS = [
  { id: 'exposure', label: 'Exposure', icon: '±' },
  { id: 'brilliance', label: 'Brilliance', icon: '✧' },
  { id: 'highlights', label: 'Highlights', icon: '◐' },
  { id: 'shadows', label: 'Shadows', icon: '◑' },
  { id: 'contrast', label: 'Contrast', icon: '◧' },
  { id: 'brightness', label: 'Brightness', icon: '☀' },
  { id: 'blackPoint', label: 'Black Point', icon: '●' },
  { id: 'saturation', label: 'Saturation', icon: '◍' },
  { id: 'vibrance', label: 'Vibrance', icon: '✺' },
  { id: 'warmth', label: 'Warmth', icon: '🌡' },
  { id: 'tint', label: 'Tint', icon: '◒' },
  { id: 'sharpness', label: 'Sharpness', icon: '△', min: 0 },
  { id: 'definition', label: 'Definition', icon: '▦' },
  { id: 'noise', label: 'Noise Reduction', icon: '▒', min: 0 },
  { id: 'vignette', label: 'Vignette', icon: '◎' },
];

const zeroAdjust = () => Object.fromEntries(ADJUSTMENTS.map((a) => [a.id, 0]));

// Filters: adjustment offsets plus a color matrix (row-major 3×3) applied after adjustments,
// all scaled by the filter intensity. Modeled on the iPhone Photos set, plus two extras.
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const MONO = [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722];
export const FILTERS = [
  { id: 'original', label: 'Original', adjust: {}, matrix: I },
  { id: 'vivid', label: 'Vivid', adjust: { saturation: 0.25, vibrance: 0.2, contrast: 0.12 }, matrix: I },
  { id: 'vivid-warm', label: 'Vivid Warm', adjust: { saturation: 0.22, vibrance: 0.15, contrast: 0.1, warmth: 0.35 }, matrix: I },
  { id: 'vivid-cool', label: 'Vivid Cool', adjust: { saturation: 0.22, vibrance: 0.15, contrast: 0.1, warmth: -0.35 }, matrix: I },
  { id: 'dramatic', label: 'Dramatic', adjust: { contrast: 0.3, highlights: -0.35, shadows: 0.15, saturation: -0.2 }, matrix: I },
  { id: 'dramatic-warm', label: 'Dramatic Warm', adjust: { contrast: 0.3, highlights: -0.35, saturation: -0.1, warmth: 0.4 }, matrix: I },
  { id: 'dramatic-cool', label: 'Dramatic Cool', adjust: { contrast: 0.3, highlights: -0.35, saturation: -0.1, warmth: -0.4 }, matrix: I },
  { id: 'mono', label: 'Mono', adjust: {}, matrix: MONO },
  { id: 'silvertone', label: 'Silvertone', adjust: { contrast: 0.15, brightness: 0.1, highlights: 0.1 }, matrix: MONO },
  { id: 'noir', label: 'Noir', adjust: { contrast: 0.55, blackPoint: 0.35, shadows: -0.2 }, matrix: MONO },
  { id: 'fade', label: 'Fade', adjust: { contrast: -0.3, blackPoint: -0.5, saturation: -0.25 }, matrix: I },
  { id: 'sepia', label: 'Sepia', adjust: { contrast: 0.05 }, matrix: [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131] },
];

export const RATIOS = [
  { id: 'free', label: 'Freeform', ratio: null },
  { id: 'original', label: 'Original', ratio: 'original' },
  { id: '1:1', label: 'Square', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '5:4', label: '5:4', ratio: 5 / 4 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

export function defaultState() {
  return {
    v: 1,
    rotate: 0, flipH: false, flipV: false, straighten: 0,
    crop: { ...FULL_CROP }, ratio: 'free',
    adjust: zeroAdjust(),
    filter: 'original', filterIntensity: 1,
    markup: [],
    patches: [], // retouch patches painted on the source first (e.g. overlay icons filled in), see retouch.js
  };
}

/** Fill in anything missing (older autosaves) and drop unknown keys. */
export function normalizeState(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object') return d;
  return {
    ...d,
    ...Object.fromEntries(Object.entries(s).filter(([k]) => k in d)),
    adjust: { ...d.adjust, ...(s.adjust ?? {}) },
    crop: { ...d.crop, ...(s.crop ?? {}) },
    markup: Array.isArray(s.markup) ? s.markup : [],
    patches: Array.isArray(s.patches) ? s.patches : [],
  };
}

export function isDefault(state) {
  return JSON.stringify(state) === JSON.stringify(defaultState());
}

/** Adjustments + filter combined into what the renderer uses. */
export function effectiveParams(state) {
  const f = FILTERS.find((x) => x.id === state.filter) ?? FILTERS[0];
  const k = state.filter === 'original' ? 0 : state.filterIntensity;
  const adjust = { ...state.adjust };
  for (const [key, v] of Object.entries(f.adjust)) adjust[key] = Math.max(-1, Math.min(1, adjust[key] + v * k));
  const matrix = f.matrix.map((m, i) => I[i] + (m - I[i]) * k);
  return { adjust, matrix };
}

/** Undo/redo over whole-state snapshots. */
export function createHistory(initial, limit = 100) {
  let past = [];
  let present = initial;
  let future = [];
  return {
    get state() { return present; },
    push(next) {
      if (JSON.stringify(next) === JSON.stringify(present)) return false;
      past.push(present);
      if (past.length > limit) past.shift();
      present = next;
      future = [];
      return true;
    },
    /** Replace the present without an undo step (live slider movement). */
    replace(next) { present = next; },
    undo() { if (!past.length) return false; future.push(present); present = past.pop(); return true; },
    redo() { if (!future.length) return false; past.push(present); present = future.pop(); return true; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    reset(state) { past = []; future = []; present = state; },
  };
}

/** Auto-Enhance (per-photo settings from a small rendering): see enhance.js. */
export { autoAdjust } from './enhance.js';
