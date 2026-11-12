// Reverse Fill, an app of its own in Magic: the photo editor with only its 🎨 Reverse Fill tool
// (web/tools/editor/reverse-fill-ui.js, mounted with `refill`): press on a color (the magnifier showing
// it), the area of it found and outlined by itself (or a loop drawn), brushed in or out, then taken
// off and filled from the surface around it. Its photo is kept apart from Files' and FM's.

import { mount as mountEditor } from '../../tools/editor/editor.js';

export function mount(host) {
  return mountEditor(host, { refill: true });
}
