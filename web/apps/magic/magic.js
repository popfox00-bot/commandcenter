// Magic: an app of apps. Downloads (a video from a link), FM (FaceMask) and Saved Files (your own
// Google Drive folder), each opened from here and back to here; under them, Recent edits in its apps.
import { childrenOf } from '../index.js';
import { renderHub } from '../hub.js';
import { recentIn } from '../../lib/home-extras.js';

export function mount(host) {
  const apps = childrenOf('magic');
  renderHub(host, apps);
  // (Unfinished work in its apps: FM, Reverse Fill, Fashion.)
  recentIn(host, (href) => apps.some((a) => a.href === href));
}
