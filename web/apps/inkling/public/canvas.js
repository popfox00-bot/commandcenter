// SketchPad: a pointer-driven drawing surface (mouse, touch and stylus).
// Strokes are stored as vector data in a fixed logical coordinate space so
// the pad can be resized freely and exported at a consistent resolution.

export const LOGICAL_W = 1024;
export const LOGICAL_H = 768;

export const TOOLS = {
  pen: { label: "Pen", defaultSize: 4, alpha: 1, pressure: true },
  marker: { label: "Marker", defaultSize: 14, alpha: 1, pressure: false },
  highlighter: { label: "Highlighter", defaultSize: 28, alpha: 0.35, pressure: false, cap: "butt" },
  eraser: { label: "Eraser", defaultSize: 30, alpha: 1, pressure: false },
};

export class SketchPad extends EventTarget {
  constructor(canvas) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cache = document.createElement("canvas"); // committed strokes
    this.cacheCtx = this.cache.getContext("2d");

    this.tool = "pen";
    this.color = "#1b2340";
    this.sizes = Object.fromEntries(Object.entries(TOOLS).map(([k, t]) => [k, t.defaultSize]));

    this.strokes = [];
    this.undoStack = [];
    this.redoStack = [];
    this.current = null;
    this.activePointer = null;
    this.frameRequested = false;

    this.bindEvents();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  get size() {
    return this.sizes[this.tool];
  }
  set size(v) {
    this.sizes[this.tool] = v;
  }

  // ---- state -------------------------------------------------------------

  getState() {
    return { strokes: this.strokes, undoStack: this.undoStack, redoStack: this.redoStack };
  }

  loadState(state) {
    this.strokes = state?.strokes ?? [];
    this.undoStack = state?.undoStack ?? [];
    this.redoStack = state?.redoStack ?? [];
    this.current = null;
    this.activePointer = null;
    this.rebuildCache();
    this.render();
    this.emitChange();
  }

  isEmpty() {
    return !this.strokes.some((s) => s.tool !== "eraser");
  }

  commit(newStrokes) {
    this.undoStack.push(this.strokes);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.strokes = newStrokes;
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.strokes);
    this.strokes = this.undoStack.pop();
    this.rebuildCache();
    this.render();
    this.emitChange();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.strokes);
    this.strokes = this.redoStack.pop();
    this.rebuildCache();
    this.render();
    this.emitChange();
  }

  clear() {
    if (!this.strokes.length) return;
    this.commit([]);
    this.rebuildCache();
    this.render();
    this.emitChange();
  }

  emitChange() {
    this.dispatchEvent(new Event("change"));
  }

  // ---- sizing ------------------------------------------------------------

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = this.cache.width = w;
    this.canvas.height = this.cache.height = h;
    this.rebuildCache();
    this.render();
  }

  get scale() {
    return this.canvas.width / LOGICAL_W;
  }

  // ---- input -------------------------------------------------------------

  bindEvents() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("pointercancel", (e) => this.onUp(e));
    c.addEventListener("lostpointercapture", (e) => this.onUp(e));
    c.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  toLogical(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * LOGICAL_W;
    const y = ((e.clientY - rect.top) / rect.height) * LOGICAL_H;
    // Mouse and most touch screens don't report real pressure.
    const p = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100];
  }

  onDown(e) {
    if (this.activePointer !== null) return; // ignore extra fingers
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.activePointer = e.pointerId;
    const t = TOOLS[this.tool];
    this.current = {
      tool: this.tool,
      color: this.tool === "eraser" ? "#000" : this.color,
      size: this.size,
      alpha: t.alpha,
      points: [this.toLogical(e)],
    };
    this.dispatchEvent(new Event("strokestart"));
    this.requestRender();
  }

  onMove(e) {
    if (e.pointerId !== this.activePointer || !this.current) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const pt = this.toLogical(ev);
      const last = this.current.points.at(-1);
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 0.8) this.current.points.push(pt);
    }
    this.requestRender();
  }

  onUp(e) {
    if (e.pointerId !== this.activePointer) return;
    this.activePointer = null;
    const stroke = this.current;
    this.current = null;
    if (!stroke) return;
    this.commit([...this.strokes, stroke]);
    drawStroke(this.cacheCtx, stroke, this.scale);
    this.render();
    this.emitChange();
  }

  // ---- rendering ---------------------------------------------------------

  requestRender() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.render();
    });
  }

  rebuildCache() {
    const ctx = this.cacheCtx;
    ctx.clearRect(0, 0, this.cache.width, this.cache.height);
    for (const s of this.strokes) drawStroke(ctx, s, this.scale);
  }

  render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.cache, 0, 0);
    if (this.current) drawStroke(ctx, this.current, this.scale);
  }

  /** Export on a white background as a data URL. */
  toDataURL({ width = LOGICAL_W, type = "image/png" } = {}) {
    return renderStrokes(this.strokes, width, type);
  }
}

/** Render a stroke list to a white-backed image data URL without a live pad. */
export function renderStrokes(strokes, width = LOGICAL_W, type = "image/png") {
  const height = Math.round((width * LOGICAL_H) / LOGICAL_W);
  const ink = document.createElement("canvas");
  ink.width = width;
  ink.height = height;
  const ictx = ink.getContext("2d");
  for (const s of strokes) drawStroke(ictx, s, width / LOGICAL_W);

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const octx = out.getContext("2d");
  octx.fillStyle = "#fff";
  octx.fillRect(0, 0, width, height);
  octx.drawImage(ink, 0, 0);
  return out.toDataURL(type, 0.9);
}

function drawStroke(ctx, stroke, scale) {
  const pts = stroke.points;
  if (!pts.length) return;
  const tool = TOOLS[stroke.tool] ?? TOOLS.pen;
  ctx.save();
  ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = ctx.fillStyle = stroke.color;
  ctx.lineJoin = "round";
  ctx.lineCap = tool.cap ?? "round";

  if (tool.pressure) {
    // Variable-width pen: draw each smoothed segment with its own width.
    ctx.globalAlpha = stroke.alpha;
    const w = (p) => Math.max(0.6, stroke.size * (0.35 + p * 1.3)) * scale;
    if (pts.length === 1) {
      dot(ctx, pts[0], w(pts[0][2]) / 2, scale);
    } else {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const prevMid = i > 1 ? mid(pts[i - 2], a) : a;
        const m = mid(a, b);
        ctx.lineWidth = w((a[2] + b[2]) / 2);
        ctx.beginPath();
        ctx.moveTo(prevMid[0] * scale, prevMid[1] * scale);
        ctx.quadraticCurveTo(a[0] * scale, a[1] * scale, m[0] * scale, m[1] * scale);
        if (i === pts.length - 1) ctx.lineTo(b[0] * scale, b[1] * scale);
        ctx.stroke();
      }
    }
  } else {
    // Constant width: one path so translucent strokes don't darken where they overlap themselves.
    ctx.globalAlpha = stroke.alpha;
    ctx.lineWidth = stroke.size * scale;
    if (stroke.tool === "highlighter") ctx.globalCompositeOperation = "multiply";
    if (pts.length === 1) {
      dot(ctx, pts[0], (stroke.size * scale) / 2, scale);
    } else {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * scale, pts[0][1] * scale);
      for (let i = 1; i < pts.length - 1; i++) {
        const m = mid(pts[i], pts[i + 1]);
        ctx.quadraticCurveTo(pts[i][0] * scale, pts[i][1] * scale, m[0] * scale, m[1] * scale);
      }
      const last = pts.at(-1);
      ctx.lineTo(last[0] * scale, last[1] * scale);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function dot(ctx, p, r, scale) {
  ctx.beginPath();
  ctx.arc(p[0] * scale, p[1] * scale, r, 0, Math.PI * 2);
  ctx.fill();
}

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
