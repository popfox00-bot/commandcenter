// Magic: an app of apps. Downloads (a video from a link), FM (FaceMask) and Saved Files (your own
// Google Drive folder), each opened from here and back to here.
import { childrenOf } from '../index.js';
import { renderHub } from '../hub.js';

export function mount(host) {
  renderHub(host, childrenOf('magic'));
}
