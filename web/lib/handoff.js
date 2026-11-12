// A file handed from one app to another (Saved Files → Files' Photo Editor or PDF): put before
// going there, taken when it opens. In memory only.
const pending = new Map();
export const handoff = {
  /** @param {string} to @param {File} file */
  put(to, file) { pending.set(to, file); },
  /** @param {string} to @returns {File|undefined} */
  take(to) { const f = pending.get(to); pending.delete(to); return f; },
};
