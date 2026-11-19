import { SketchPad, TOOLS, renderStrokes } from "./canvas.js";

const MAX_SKETCHES = 6;
const COLORS = ["#1b2340", "#d64545", "#2f8f5b", "#3b4cca", "#e08a1e", "#8a4fd1", "#7a5a3a", "#f5d33f"];
const DEFAULT_HIGHLIGHT = "#f5d33f";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
};

const pad = new SketchPad($("pad"));
const state = {
  sketches: [newSketch()],
  active: 0,
  searching: null, // AbortController while a search is in flight
  mode: null, // "server" (Inkling server holds the key) or "browser" (user's own key, e.g. on GitHub Pages)
};

function newSketch() {
  return { id: crypto.randomUUID(), pad: null, caption: "", thumb: null };
}

// ---------------------------------------------------------------------------
// Toolbox
// ---------------------------------------------------------------------------

const toolbox = $("toolbox");
const toggle = $("toolboxToggle");

function setToolboxOpen(open) {
  toolbox.dataset.open = String(open);
  toggle.setAttribute("aria-expanded", String(open));
}
toggle.addEventListener("click", () => setToolboxOpen(toolbox.dataset.open !== "true"));
setToolboxOpen(window.matchMedia("(min-width: 720px)").matches);

const lastColor = { pen: COLORS[0], marker: COLORS[0], highlighter: DEFAULT_HIGHLIGHT };

for (const color of COLORS) {
  $("swatches").append(
    el("button", {
      className: "swatch",
      title: color,
      ariaLabel: `Colour ${color}`,
      style: `--c:${color}`,
      onclick: () => setColor(color),
    }),
  );
}

document.querySelectorAll(".tool[data-tool]").forEach((btn) =>
  btn.addEventListener("click", () => setTool(btn.dataset.tool)),
);

function setTool(tool) {
  pad.tool = tool;
  if (tool !== "eraser") pad.color = lastColor[tool];
  document.querySelectorAll(".tool[data-tool]").forEach((b) => {
    const on = b.dataset.tool === tool;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", String(on));
  });
  $("sizeRange").value = pad.size;
  syncToolUi();
}

function setColor(color) {
  if (pad.tool === "eraser") setTool("pen");
  pad.color = color;
  lastColor[pad.tool] = color;
  syncToolUi();
}

function syncToolUi() {
  const eraser = pad.tool === "eraser";
  document.querySelectorAll(".swatch").forEach((s) => {
    s.classList.toggle("active", !eraser && s.title === pad.color);
  });
  $("swatches").classList.toggle("disabled", eraser);
  const preview = $("sizePreview");
  const d = Math.max(3, Math.min(28, pad.size * 0.6));
  preview.style.width = preview.style.height = `${d}px`;
  preview.style.background = eraser ? "transparent" : pad.color;
  preview.style.opacity = TOOLS[pad.tool].alpha < 1 ? 0.5 : 1;
  preview.classList.toggle("eraser", eraser);
  $("currentToolDot").style.background = eraser ? "var(--paper)" : pad.color;
  $("pad").dataset.tool = pad.tool;
}

$("sizeRange").addEventListener("input", (e) => {
  pad.size = Number(e.target.value);
  syncToolUi();
});

$("undoBtn").addEventListener("click", () => pad.undo());
$("redoBtn").addEventListener("click", () => pad.redo());
$("clearBtn").addEventListener("click", () => pad.clear());

document.addEventListener("keydown", (e) => {
  const typing = e.target.closest("input, textarea");
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "Enter") {
    e.preventDefault();
    submit();
    return;
  }
  if (typing) return;
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? pad.redo() : pad.undo();
  } else if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    pad.redo();
  } else if (!mod) {
    const map = { p: "pen", m: "marker", h: "highlighter", e: "eraser" };
    if (map[e.key]) setTool(map[e.key]);
    if (e.key === "[" || e.key === "]") {
      pad.size = Math.max(1, Math.min(60, pad.size + (e.key === "]" ? 2 : -2)));
      $("sizeRange").value = pad.size;
      syncToolUi();
    }
  }
});

// Collapse the toolbox on small screens once the user starts drawing.
pad.addEventListener("strokestart", () => {
  if (!window.matchMedia("(min-width: 720px)").matches) setToolboxOpen(false);
});

// ---------------------------------------------------------------------------
// Multiple sketches
// ---------------------------------------------------------------------------

let thumbTimer;
pad.addEventListener("change", () => {
  const s = state.sketches[state.active];
  s.pad = pad.getState();
  $("padHint").hidden = !pad.isEmpty();
  $("undoBtn").disabled = !pad.undoStack.length;
  $("redoBtn").disabled = !pad.redoStack.length;
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    s.thumb = pad.isEmpty() ? null : pad.toDataURL({ width: 160 });
    renderTabs();
  }, 250);
  updateSummary();
});

$("caption").addEventListener("input", (e) => {
  state.sketches[state.active].caption = e.target.value;
});

function selectSketch(i) {
  state.active = i;
  const s = state.sketches[i];
  pad.loadState(s.pad);
  $("caption").value = s.caption;
  renderTabs();
}

function addSketch() {
  if (state.sketches.length >= MAX_SKETCHES) return;
  state.sketches.push(newSketch());
  selectSketch(state.sketches.length - 1);
}

function removeSketch(i) {
  const s = state.sketches[i];
  if (s.pad?.strokes?.length && !confirm(`Delete sketch ${i + 1}?`)) return;
  state.sketches.splice(i, 1);
  if (!state.sketches.length) state.sketches.push(newSketch());
  selectSketch(Math.min(state.active >= i && state.active > 0 ? state.active - 1 : state.active, state.sketches.length - 1));
}

function renderTabs() {
  const tabs = $("sketchTabs");
  tabs.replaceChildren(
    ...state.sketches.map((s, i) => {
      const active = i === state.active;
      const tab = el(
        "div",
        { className: `sketch-tab${active ? " active" : ""}` },
        el(
          "button",
          {
            className: "sketch-tab-select",
            role: "tab",
            ariaSelected: String(active),
            title: s.caption || `Sketch ${i + 1}`,
            onclick: () => selectSketch(i),
          },
          s.thumb ? el("img", { src: s.thumb, alt: "" }) : el("span", { className: "blank-thumb" }),
          el("span", { className: "sketch-tab-label" }, `Sketch ${i + 1}`),
        ),
      );
      if (state.sketches.length > 1) {
        tab.append(
          el("button", {
            className: "sketch-tab-remove",
            title: `Delete sketch ${i + 1}`,
            ariaLabel: `Delete sketch ${i + 1}`,
            textContent: "×",
            onclick: () => removeSketch(i),
          }),
        );
      }
      return tab;
    }),
  );
  if (state.sketches.length < MAX_SKETCHES) {
    tabs.append(
      el(
        "button",
        { className: "sketch-add", title: "Add another sketch of a different feature or view", onclick: addSketch },
        el("span", { textContent: "+" }),
        el("span", { className: "sketch-tab-label", textContent: "Add sketch" }),
      ),
    );
  }
}

function filledSketches() {
  return state.sketches.filter((s) => s.pad?.strokes?.some((st) => st.tool !== "eraser"));
}

function updateSummary() {
  const n = filledSketches().length;
  const hasText = $("description").value.trim().length > 0;
  const parts = [];
  if (n) parts.push(`${n} sketch${n > 1 ? "es" : ""}`);
  if (hasText) parts.push("description");
  $("summary").textContent = parts.length ? `Searching with ${parts.join(" + ")}` : "";
}
$("description").addEventListener("input", updateSummary);

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

$("submitBtn").addEventListener("click", submit);

async function submit() {
  if (state.searching) return;
  const text = $("description").value.trim();
  const sketches = filledSketches().map((s) => ({
    image: renderStrokes(s.pad.strokes, 1024),
    caption: s.caption.trim(),
  }));
  if (!text && !sketches.length) {
    showError("Draw something or describe what you're looking for first.");
    return;
  }
  await modeReady;
  if (state.mode === "browser" && !getApiKey()) {
    openSettings("Add your Anthropic API key to start searching.");
    return;
  }

  const controller = new AbortController();
  state.searching = controller;
  $("submitBtn").disabled = true;
  showLoading(controller, sketches.length, Boolean(text));

  try {
    const data =
      state.mode === "server"
        ? await searchViaServer({ text, sketches }, controller.signal)
        : await searchInBrowser({ text, sketches }, controller.signal);
    renderResults(data, sketches);
  } catch (err) {
    if (err.name === "AbortError" || controller.signal.aborted) showError("Search cancelled.");
    else showError(describeError(err));
  } finally {
    state.searching = null;
    $("submitBtn").disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Search transports: an Inkling server, or straight from the browser
// ---------------------------------------------------------------------------

const KEY_STORAGE = "inkling.apiKey";

async function detectMode() {
  try {
    const res = await fetch("api/status", { headers: { accept: "application/json" } });
    const status = res.ok ? await res.json() : null;
    state.mode = status?.configured ? "server" : "browser";
  } catch {
    state.mode = "browser"; // static hosting (e.g. GitHub Pages) has no API
  }
  document.body.dataset.mode = state.mode;
}

function getApiKey() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const key = store.getItem(KEY_STORAGE);
      if (key) return key;
    } catch {}
  }
  return memoryKey;
}

function setApiKey(key, remember) {
  for (const store of [sessionStorage, localStorage]) {
    try {
      store.removeItem(KEY_STORAGE);
    } catch {}
  }
  if (!key) return;
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY_STORAGE, key);
  } catch {
    memoryKey = key;
  }
}
let memoryKey = "";

async function searchViaServer(body, signal) {
  const res = await fetch("api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
  return data;
}

let browserClient;
async function searchInBrowser(body, signal) {
  const [{ Anthropic }, core] = await Promise.all([import("./vendor/anthropic-sdk.js"), import("./search-core.js")]);
  const apiKey = getApiKey();
  if (!browserClient || browserClient.apiKey !== apiKey) {
    browserClient = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }
  return core.searchWithClient(browserClient, core.parseSearchRequest(body), { signal });
}

function describeError(err) {
  const status = err?.status;
  if (status === 401) {
    if (state.mode === "browser") openSettings("That API key was rejected. Check it and try again.");
    return "Your Anthropic API key was rejected.";
  }
  if (status === 429) return "Rate limited — wait a moment and try again.";
  if (status === 400 && /credit|billing/i.test(err.message)) return "Your Anthropic account is out of credit.";
  if (status && status >= 500) return "The search service is having trouble. Try again shortly.";
  if (err instanceof TypeError && state.mode === "browser") return "Couldn't reach the search service. Check your connection.";
  return err?.message || "Something went wrong.";
}

// ---------------------------------------------------------------------------
// Settings dialog
// ---------------------------------------------------------------------------

const dialog = $("settingsDialog");

function openSettings(message) {
  const serverMode = state.mode === "server";
  $("serverModeNote").hidden = !serverMode;
  $("keyModeFields").hidden = serverMode;
  $("forgetKeyBtn").hidden = serverMode || !getApiKey();
  $("saveSettingsBtn").textContent = serverMode ? "Done" : "Save";
  $("apiKeyInput").value = getApiKey();
  let note = dialog.querySelector(".dialog-message");
  if (!note) {
    note = el("p", { className: "dialog-message" });
    $("settingsTitle").after(note);
  }
  note.textContent = message || "";
  note.hidden = !message;
  dialog.showModal();
  if (!serverMode) $("apiKeyInput").focus();
}

$("settingsBtn").addEventListener("click", async () => {
  await modeReady;
  openSettings();
});
$("cancelSettingsBtn").addEventListener("click", () => dialog.close());
$("forgetKeyBtn").addEventListener("click", () => {
  setApiKey("");
  memoryKey = "";
  browserClient = null;
  dialog.close();
});
$("settingsForm").addEventListener("submit", () => {
  if (state.mode === "server") return;
  setApiKey($("apiKeyInput").value.trim(), $("rememberKey").checked);
  browserClient = null;
});

const resultsEl = $("results");

function showResultsSection(...children) {
  resultsEl.hidden = false;
  resultsEl.replaceChildren(...children);
  resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showLoading(controller, nSketches, hasText) {
  const started = Date.now();
  const timer = el("span", { className: "elapsed", textContent: "0s" });
  const tick = setInterval(() => {
    if (!state.searching) return clearInterval(tick);
    timer.textContent = `${Math.round((Date.now() - started) / 1000)}s`;
  }, 1000);
  const what = [nSketches && `${nSketches} sketch${nSketches > 1 ? "es" : ""}`, hasText && "your description"]
    .filter(Boolean)
    .join(" and ");
  showResultsSection(
    el(
      "div",
      { className: "loading" },
      el("div", { className: "ink-drop", ariaHidden: "true" }, el("span"), el("span"), el("span")),
      el("p", {}, `Reading ${what} and searching the web… `, timer),
      el("p", { className: "muted" }, "This usually takes 20–60 seconds while Inkling checks several leads."),
      el("button", { className: "ghost", textContent: "Cancel", onclick: () => controller.abort() }),
    ),
  );
}

function showError(message) {
  showResultsSection(el("div", { className: "error" }, el("strong", {}, "Hmm. "), message));
}

function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function renderResults(data, sketches) {
  const header = el(
    "div",
    { className: "interpretation" },
    el(
      "div",
      { className: "interp-top" },
      el("span", { className: "chip category" }, data.category || "search"),
      el("div", { className: "query-sketches" }, sketches.map((s) => el("img", { src: s.image, alt: "Your sketch" }))),
    ),
    el("p", { className: "interp-text" }, data.interpretation || ""),
    data.features?.length
      ? el("div", { className: "chips" }, data.features.map((f) => el("span", { className: "chip" }, f)))
      : null,
  );

  const cards = (data.results || []).map((r, i) => {
    const href = safeUrl(r.url);
    let host = "";
    try {
      host = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {}
    const imgSrc = safeUrl(r.image_url);
    const thumb = el("div", { className: "thumb" });
    if (imgSrc) {
      const img = el("img", { src: imgSrc, alt: "", loading: "lazy", referrerPolicy: "no-referrer" });
      img.addEventListener("error", () => thumb.classList.add("no-image"));
      thumb.append(img);
    } else {
      thumb.classList.add("no-image");
    }
    thumb.append(el("img", { className: "thumb-fallback", src: "public/logo.svg", alt: "" }));

    return el(
      "article",
      { className: "result" },
      el("a", { className: "thumb-link", href, target: "_blank", rel: "noopener noreferrer", tabIndex: -1 }, thumb),
      el(
        "div",
        { className: "result-body" },
        el("div", { className: "result-rank" }, `#${i + 1}`, host ? el("span", { className: "host" }, host) : null),
        el("h3", {}, el("a", { href, target: "_blank", rel: "noopener noreferrer" }, r.title)),
        r.snippet ? el("p", { className: "snippet" }, r.snippet) : null,
        r.why ? el("p", { className: "why" }, el("strong", {}, "Why it matches: "), r.why) : null,
        r.matched_features?.length
          ? el("div", { className: "chips" }, r.matched_features.map((f) => el("span", { className: "chip match" }, `✓ ${f}`)))
          : null,
        typeof r.confidence === "number"
          ? el(
              "div",
              { className: "confidence", title: `Match confidence ${Math.round(r.confidence * 100)}%` },
              el("span", { style: `width:${Math.round(r.confidence * 100)}%` }),
            )
          : null,
      ),
    );
  });

  const extras = [];
  if (data.truncated) extras.push(el("p", { className: "muted" }, "The search was cut short — results may be incomplete."));
  if (data.follow_up) extras.push(el("div", { className: "follow-up" }, el("strong", {}, "To narrow it down: "), data.follow_up));
  if (data.queries?.length || data.sources?.length) {
    extras.push(
      el(
        "details",
        { className: "sources" },
        el("summary", {}, `How Inkling searched (${data.queries?.length || 0} queries, ${data.sources?.length || 0} pages)`),
        data.queries?.length ? el("ul", { className: "queries" }, data.queries.map((q) => el("li", {}, q))) : null,
        data.sources?.length
          ? el(
              "ul",
              {},
              data.sources.map((s) =>
                el("li", {}, el("a", { href: safeUrl(s.url), target: "_blank", rel: "noopener noreferrer" }, s.title)),
              ),
            )
          : null,
      ),
    );
  }

  showResultsSection(
    header,
    cards.length ? el("div", { className: "result-list" }, cards) : el("p", { className: "muted" }, "No matches found. Try adding more detail."),
    ...extras,
  );
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

setTool("pen");
selectSketch(0);

const modeReady = detectMode();
