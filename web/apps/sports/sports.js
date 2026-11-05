// Sports: your teams' games on a calendar, with the line, live scores and stats, plus college football
// near your ZIP. Its own app on the home screen; the code is shared with Weather (web/apps/updates/updates.js).
import { mount as mountUpdates } from '../updates/updates.js';

export function mount(host) {
  return mountUpdates(host, { only: 'sports' });
}
