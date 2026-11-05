// Weather: alerts and heads-ups (freeze, wind, air quality), hourly and 7-day, for your ZIP. Its own
// app on the home screen; the code is shared with Sports (web/apps/updates/updates.js).
import { mount as mountUpdates } from '../updates/updates.js';

export function mount(host) {
  return mountUpdates(host, { only: 'weather' });
}
