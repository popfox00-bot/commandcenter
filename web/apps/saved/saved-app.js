// Saved Files (in Magic): the files in your own Google Drive folder (web/tools/saved/saved.js). A
// photo opened from it goes to Files → Photo Editor, a PDF to Files → PDF.
import { mount as mountSaved } from '../../tools/saved/saved.js';
import { handoff } from '../../lib/handoff.js';

export function mount(host) {
  return mountSaved(host, {
    onEdit: (file) => { handoff.put('photo', file); location.hash = '#/files/photo'; },
    onWrite: (file) => { handoff.put('pdf', file); location.hash = '#/files/pdf'; },
  });
}
