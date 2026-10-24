// App-wide background color (web/theme.js): every preset, and colors across the range, get text,
// cards and muted text that read clearly on them; bad input is ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../web/theme.js';

const { PRESETS, palette, contrast, parse } = globalThis.ccTheme;

test('every background gets readable text, cards and muted text', () => {
  const grays = Array.from({ length: 18 }, (_, i) => `#${(i * 15).toString(16).padStart(2, '0').repeat(3)}`);
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#7f3fbf', '#e2793d', '#336699', '#808080'];
  for (const bg of [...PRESETS.map((p) => p.bg), ...grays, ...colors]) {
    const p = palette(bg); const v = (k) => parse(p.vars[k]);
    // 7:1 (WCAG AAA) on every preset; at least 4.5:1 (AA) even on mid tones.
    const need = PRESETS.some((q) => q.bg === bg) ? 7 : 4.5;
    assert.ok(contrast(v('--text'), v('--bg')) >= need, `${bg}: text on background`);
    assert.ok(contrast(v('--text'), v('--surface')) >= need, `${bg}: text on cards`);
    assert.ok(contrast(v('--muted'), v('--bg')) >= 4.5, `${bg}: muted text`);
    assert.equal(p.vars['--bg'], bg.toLowerCase());
  }
  assert.equal(palette('#0b1020').scheme, 'dark');
  assert.equal(palette('#f4ecdc').scheme, 'light');
});

test('not a color: no palette', () => {
  assert.equal(palette('navy'), null);
  assert.equal(palette(''), null);
  assert.equal(palette(undefined), null);
});
