// FM (FaceMask): everything for faces, an app of its own. The photo editor with only its face tools
// (web/tools/editor/editor.js, mounted with `fm`): ⚡ Quick Swap (two photos in, a finished swap out),
// 🙂 Identify faces, ✂️ cut a face out as a Character, 🎭 insert a Character on a face (turned in 3D,
// fitted, recolored and blended), 🙂 level a face; Done saves or shares the result. Its photo is kept
// apart from the one open in Files. (Reverse Fill is an app of its own in Magic now.)

import { mount as mountEditor } from '../../tools/editor/editor.js';

export function mount(host) {
  return mountEditor(host, { fm: true });
}
