// Reverse Fill's removing and filling, off the page's thread (a big area can take a while): the photo,
// what goes and the trace in; the patch out. The page works it out itself when there's no worker.
import { reverseFill } from './cleanup.js';

self.onmessage = (e) => {
  const { seq, rgba, w, h, mask, box, region, from } = e.data;
  try {
    const p = reverseFill(rgba, w, h, mask, box, region, { from });
    self.postMessage({ seq, p }, p ? [p.rgba.buffer] : []);
  } catch (err) { self.postMessage({ seq, error: String(err?.message ?? err) }); }
};
