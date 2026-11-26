// What Socials' AI worker may reach on the network: nothing that carries anything of yours. Its own files
// from the app, and, only while the model is being downloaded, plain GETs of that model's own files from
// Hugging Face (and the file servers it redirects to, which fetch follows by itself). No other host, no
// request with a body, nothing but GET/HEAD, and once the model is on the phone nothing remote at all: what
// you write, and what's written back, never leaves the phone. Pure: the worker wraps its fetch with it.

const HF = /^(huggingface\.co|[a-z0-9-]+(\.[a-z0-9-]+)*\.hf\.co)$/i;

/**
 * Whether the worker may make a request: `url` (absolute), `method`, `hasBody`; `origin`: the app's;
 * `model`: the model's id ("org/name"); `remote`: whether the model may be downloaded now. { ok, why }.
 */
export function allowRequest({ url, method = 'GET', hasBody = false, origin, model, remote }) {
  let u; try { u = new URL(url); } catch { return { ok: false, why: 'not a URL' }; }
  if (u.origin === origin) return { ok: true, why: '' };
  if (!remote) return { ok: false, why: 'the model is on this phone: nothing remote' };
  if (hasBody || !/^(GET|HEAD)$/i.test(method)) return { ok: false, why: 'only plain downloads' };
  if (u.protocol !== 'https:' || !HF.test(u.hostname)) return { ok: false, why: `not Hugging Face (${u.hostname})` };
  // (Only that model's files: huggingface.co/<model>/resolve/…; no query string carrying anything.)
  if (u.hostname.toLowerCase() === 'huggingface.co' && !u.pathname.startsWith(`/${model}/resolve/`)) return { ok: false, why: 'not the model\'s files' };
  if (u.search && !/^\?(download=true)?$/.test(u.search)) return { ok: false, why: 'no query strings' };
  return { ok: true, why: '' };
}

/** A fetch that asks allowRequest first (and refuses, without asking the network, what it doesn't allow). */
export function guardedFetch(realFetch, { origin, model, remote }) {
  return (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
    const hasBody = init.body != null;
    const abs = new URL(url, origin).href;
    const v = allowRequest({ url: abs, method, hasBody, origin, model: typeof model === 'function' ? model() : model, remote: remote() });
    if (!v.ok) return Promise.reject(new TypeError(`Blocked: ${v.why}`));
    return realFetch(input, init);
  };
}

/**
 * The worker's other ways out closed: XMLHttpRequest asks allowRequest too; WebSocket, EventSource and
 * sendBeacon (which only send) are taken away.
 */
export function fenceWorker(scope, { origin, model, remote }) {
  for (const k of ['WebSocket', 'EventSource']) { try { scope[k] = undefined; } catch { /* read-only */ } }
  try { if (scope.navigator?.sendBeacon) scope.navigator.sendBeacon = () => false; } catch { /* read-only */ }
  const X = scope.XMLHttpRequest; if (!X) return;
  const open = X.prototype.open; const send = X.prototype.send;
  X.prototype.open = function (method, url, ...rest) { this.__cc = { method, url: new URL(url, origin).href }; return open.call(this, method, url, ...rest); };
  X.prototype.send = function (body) {
    const v = allowRequest({ url: this.__cc?.url ?? '', method: this.__cc?.method ?? 'GET', hasBody: body != null, origin, model: typeof model === 'function' ? model() : model, remote: remote() });
    if (!v.ok) throw new TypeError(`Blocked: ${v.why}`);
    return send.call(this, body);
  };
}
