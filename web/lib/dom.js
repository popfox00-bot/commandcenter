// Small DOM helpers shared by the app shell, the jobs dashboard and the tools.

export const $ = (sel, root = document) => root.querySelector(sel);

export const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  json: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
};

/** el('button', { class: 'btn', text: 'Go', onclick }, ...children). Text is always set via textContent. */
/** node.replaceChildren(...kids), skipping null/false/undefined (which replaceChildren would show as text). */
export function fill(node, ...kids) {
  node.replaceChildren(...kids.flat().filter((c) => c != null && c !== false));
  return node;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    // Inline style attributes are blocked by the page's CSP; set styles through the CSSOM instead.
    else if (k === 'style') Object.assign(node.style, v);
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

export function safeLink(url, text) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') return el('a', { href: u.toString(), target: '_blank', rel: 'noopener noreferrer', text });
  } catch { /* fall through */ }
  return el('span', { text });
}
