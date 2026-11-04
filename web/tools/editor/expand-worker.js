// Generative Expand off the page's thread (it takes a few seconds on a phone): { rgba, w, h, layout,
// opts } in; { progress } messages, then { rgba } (the expanded picture) or { error } out.
import { expandFill } from './expand.js';

self.onmessage = (e) => {
  const { rgba, w, h, layout, opts } = e.data;
  try {
    const out = expandFill(rgba, w, h, layout, { ...opts, onProgress: (p) => self.postMessage({ progress: p }) });
    self.postMessage({ rgba: out }, [out.buffer]);
  } catch (err) { self.postMessage({ error: err.message || String(err) }); }
};
