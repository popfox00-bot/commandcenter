// Saved Files (in Magic): the files in your own Google Drive folder (web/tools/saved/saved.js). A
// photo opened from it goes to Files → Photo Editor, a PDF to Files → PDF.
import { mount as mountSaved } from '../../tools/saved/saved.js';
import { handoff } from '../../lib/handoff.js';

export function mount(host) {
  // (From a home-screen shortcut: #/saved/search or #/saved/scan.)
  const sub = location.hash.split('/')[2] ?? '';
  if (sub) { try { history.replaceState(null, '', '#/saved'); } catch { /* fine */ } }
  return mountSaved(host, {
    open: ['search', 'scan'].includes(sub) ? sub : '',
    onEdit: (file) => { handoff.put('photo', file); location.hash = '#/files/photo'; },
    onWrite: (file) => { handoff.put('pdf', file); location.hash = '#/files/pdf'; },
  });
}
