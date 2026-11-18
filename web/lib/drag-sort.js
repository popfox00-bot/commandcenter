// Reordering a list by dragging its ☰ handles (Settings' cards, Edit Home Screen): press a handle and drag
// the row where it goes; the others make room as it passes. On the keyboard (or a screen reader), the
// focused handle moves its row with ↑ / ↓. `onMove(from, to)` is told where a row went (indices).

import { el } from './dom.js';

/** A ☰ handle for a row of `name`. */
export function dragHandle(name) {
  return el('button', { type: 'button', class: 'drag-handle', 'aria-label': `Reorder ${name} (drag, or ↑ ↓)`, 'aria-roledescription': 'drag handle', text: '☰' });
}

/**
 * `list`'s rows (its children, each with a `.drag-handle`) made draggable by their handles. Call again
 * after the rows are redrawn (it binds once per list).
 * @param {HTMLElement} list @param {(from: number, to: number) => void} onMove
 */
export function sortable(list, onMove) {
  if (list.dataset.sortable) return;
  list.dataset.sortable = '1';
  const rows = () => [...list.children].filter((r) => r.querySelector?.('.drag-handle'));
  let drag = null;

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest?.('.drag-handle'); if (!handle || !list.contains(handle)) return;
    const row = rows().find((r) => r.contains(handle)); if (!row) return;
    e.preventDefault(); e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const all = rows(); const from = all.indexOf(row);
    // (Each row's middle when the drag starts: where the dragged one goes is by these.)
    const mids = all.map((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; });
    const gap = all.length > 1 ? (all[1].getBoundingClientRect().top - all[0].getBoundingClientRect().top) : row.getBoundingClientRect().height;
    drag = { handle, row, all, from, to: from, y0: e.clientY, mids, h: row.getBoundingClientRect().height, gap: Math.max(gap, row.getBoundingClientRect().height), id: e.pointerId };
    row.classList.add('dragging');
  });
  list.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    drag.row.style.transform = `translateY(${dy}px)`;
    const y = drag.mids[drag.from] + dy;
    let to = drag.from;
    // (It takes a row's place once it's past halfway to that row's middle.)
    while (to < drag.all.length - 1 && y > (drag.mids[to] + drag.mids[to + 1]) / 2) to++;
    while (to > 0 && y < (drag.mids[to - 1] + drag.mids[to]) / 2) to--;
    drag.to = to;
    // (The rows between make room: each slides a row's height the other way.)
    drag.all.forEach((r, i) => {
      if (r === drag.row) return;
      const shift = drag.from < to && i > drag.from && i <= to ? -drag.gap : drag.from > to && i >= to && i < drag.from ? drag.gap : 0;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { from, to, all, row } = drag; drag = null;
    for (const r of all) r.style.transform = '';
    row.classList.remove('dragging');
    if (to !== from) onMove(from, to);
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  // (A tap on a handle mustn't open a folded card under it.)
  list.addEventListener('click', (e) => { if (e.target.closest?.('.drag-handle')) { e.preventDefault(); e.stopPropagation(); } }, true);
  list.addEventListener('keydown', (e) => {
    const handle = e.target.closest?.('.drag-handle'); if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const all = rows(); const from = all.findIndex((r) => r.contains(handle));
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (from < 0 || to < 0 || to >= all.length) return;
    e.preventDefault();
    onMove(from, to);
    // (Focus stays on the handle of the row that moved.)
    requestAnimationFrame(() => rows()[to]?.querySelector('.drag-handle')?.focus());
  });
}

/** `arr` with the item at `from` moved to `to` (a copy). */
export function moved(arr, from, to) {
  const out = [...arr]; const [x] = out.splice(from, 1); out.splice(to, 0, x); return out;
}
