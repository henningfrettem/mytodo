/* canvas.js — a home-grown diagram canvas for the Todo notes.
 *
 * A classic script rather than an ES module, because modules are refused on
 * file:// and the app is opened straight off disk. It exposes one global,
 * window.TodoCanvas, and knows nothing about Supabase or notes: it is handed
 * a drawing, lets you edit it, and reports every finished change through
 * onChange. Saving is the caller's business.
 *
 *   const c = TodoCanvas.create(element, { data, onChange(data) {} });
 *   c.getData(); c.setData(data); c.fit(); c.refresh(); c.destroy();
 *
 * A drawing is plain data, so it can be stored as JSON:
 *   { v: 1, type: "diagram",
 *     nodes: [{ id, shape: "rect" | "oval", x, y, w, h, color: 0-4, text }],
 *     links: [{ id, from: { node, side }, to: { node, side },
 *               style: "elbow" | "straight" | "curved",
 *               arrow: "end" | "both" | "none", label }] }
 * Sides are "top", "right", "bottom" and "left".
 */
(function () {
"use strict";

const SVGNS = "http://www.w3.org/2000/svg";
const GRID = 20;
const MIN_W = 40, MIN_H = 40;
const NEW_W = 160, NEW_H = 80;
const TEXT_MAX = 14, TEXT_MIN = 6;
const PAD = 6;           // text margin inside a shape: kept small on purpose
const RADIUS = 6;        // a rectangle's corners: square, just softened
const BEND = 6;          // the same softening on a right-angled line's bends
const STUB = 20;         // straight run out of a connection point before any bend
const ZOOM_MIN = 0.2, ZOOM_MAX = 3;
const HISTORY = 100;

const COLORS = [
  { name: "White", fill: "#ffffff", stroke: "#bdb29a" },
  { name: "Sand",  fill: "#fbefc5", stroke: "#d4b458" },
  { name: "Sage",  fill: "#e1eed6", stroke: "#94b67d" },
  { name: "Sky",   fill: "#dce8f6", stroke: "#86a8d1" },
  { name: "Rose",  fill: "#f8ded6", stroke: "#d4907b" }
];
const SIDES = ["top", "right", "bottom", "left"];
const NORMAL = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
const OPPOSITE = { top: "bottom", bottom: "top", left: "right", right: "left" };
const STYLES = ["elbow", "straight", "curved"];
const ARROWS = ["end", "both", "none"];

/* ---------- small helpers ---------- */
const snap = v => Math.round(v / GRID) * GRID;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function svgEl(tag, attrs, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
  if (parent) parent.append(n);
  return n;
}
function htmlEl(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "html") n.innerHTML = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
}

function anchorPoint(n, side) {
  switch (side) {
    case "top": return { x: n.x + n.w / 2, y: n.y };
    case "right": return { x: n.x + n.w, y: n.y + n.h / 2 };
    case "bottom": return { x: n.x + n.w / 2, y: n.y + n.h };
    default: return { x: n.x, y: n.y + n.h / 2 };
  }
}
function nearestSide(n, p) {
  let best = "top", d = Infinity;
  for (const s of SIDES) {
    const q = dist(anchorPoint(n, s), p);
    if (q < d) { d = q; best = s; }
  }
  return best;
}
// The side of a node that faces a point, by the dominant direction.
function sideFacing(n, p) {
  const dx = p.x - (n.x + n.w / 2), dy = p.y - (n.y + n.h / 2);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "bottom" : "top");
}
function overlaps(a, b, m) {
  return a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
}

function normalize(input) {
  const d = input && typeof input === "object" ? JSON.parse(JSON.stringify(input)) : {};
  const nodes = (Array.isArray(d.nodes) ? d.nodes : []).filter(n => n && n.id != null).map(n => ({
    id: String(n.id),
    shape: n.shape === "oval" ? "oval" : "rect",
    x: +n.x || 0,
    y: +n.y || 0,
    w: Math.max(MIN_W, +n.w || NEW_W),
    h: Math.max(MIN_H, +n.h || NEW_H),
    color: clamp(n.color | 0, 0, COLORS.length - 1),
    text: typeof n.text === "string" ? n.text : ""
  }));
  const ids = new Set(nodes.map(n => n.id));
  const end = e => e && ids.has(String(e.node)) && SIDES.includes(e.side)
    ? { node: String(e.node), side: e.side } : null;
  const links = (Array.isArray(d.links) ? d.links : []).map(l => ({
    id: l && l.id != null ? String(l.id) : uid(),
    from: end(l && l.from),
    to: end(l && l.to),
    style: STYLES.includes(l && l.style) ? l.style : "elbow",
    arrow: ARROWS.includes(l && l.arrow) ? l.arrow : "end",
    label: l && typeof l.label === "string" ? l.label : ""
  })).filter(l => l.from && l.to && l.from.node !== l.to.node);
  return { v: 1, type: "diagram", nodes, links };
}

/* ---------- text that shrinks to fit ---------- */
let measurer = null;
const fitCache = new Map();

// The area inside a shape that text may use. An oval's is the largest
// rectangle that sits comfortably inside the ellipse.
function textBox(n) {
  const k = n.shape === "oval" ? 0.72 : 1;
  const iw = n.w * k, ih = n.h * k;
  return {
    x: n.x + (n.w - iw) / 2 + PAD,
    y: n.y + (n.h - ih) / 2 + PAD,
    w: Math.max(4, iw - PAD * 2),
    h: Math.max(4, ih - PAD * 2)
  };
}
function fitFont(text, w, h) {
  if (!text) return TEXT_MAX;
  const key = w + "x" + h + "\u0000" + text;
  const hit = fitCache.get(key);
  if (hit) return hit;
  if (!measurer) {
    measurer = htmlEl("div", { class: "tc-label tc-measure", "aria-hidden": "true" });
    document.body.append(measurer);
  }
  measurer.style.width = w + "px";
  measurer.textContent = text;
  let size = TEXT_MAX;
  for (; size > TEXT_MIN; size -= 0.5) {
    measurer.style.fontSize = size + "px";
    if (measurer.scrollHeight <= h + 0.5 && measurer.scrollWidth <= w + 0.5) break;
  }
  if (fitCache.size > 3000) fitCache.clear();
  fitCache.set(key, size);
  return size;
}

/* ---------- line geometry ---------- */
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const collinear = (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01)
      || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01);
    if (collinear) out.splice(i, 1);
  }
  return out;
}
function segDir(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  return l < 0.01 ? null : [dx / l, dy / l];
}
function isOrthogonal(pts) {
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i].x - pts[i - 1].x) > 0.01 && Math.abs(pts[i].y - pts[i - 1].y) > 0.01) return false;
  }
  return true;
}
// How many of a path's segments pass through a node's interior.
function crossings(pts, r) {
  let n = 0;
  const x0 = r.x + 1, x1 = r.x + r.w - 1, y0 = r.y + 1, y1 = r.y + r.h - 1;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const lx = Math.min(a.x, b.x), hx = Math.max(a.x, b.x);
    const ly = Math.min(a.y, b.y), hy = Math.max(a.y, b.y);
    if (hx > x0 && lx < x1 && hy > y0 && ly < y1) n++;
  }
  return n;
}
function pathLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

// A right-angled route between two connection points. Each end first runs
// straight out of its side, then a handful of candidate routes are scored:
// shorter and fewer bends is better, never doubling back into either shape,
// and passing through a shape is heavily penalised.
function elbowPoints(p1, n1, p2, n2, ra, rb) {
  const A = { x: p1.x + n1[0] * STUB, y: p1.y + n1[1] * STUB };
  const B = { x: p2.x + n2[0] * STUB, y: p2.y + n2[1] * STUB };
  const xs = [(A.x + B.x) / 2], ys = [(A.y + B.y) / 2];
  if (ra && rb) {
    xs.push(Math.min(ra.x, rb.x) - STUB, Math.max(ra.x + ra.w, rb.x + rb.w) + STUB);
    ys.push(Math.min(ra.y, rb.y) - STUB, Math.max(ra.y + ra.h, rb.y + rb.h) + STUB);
  }
  const candidates = [
    [A, B],
    [A, { x: B.x, y: A.y }, B],
    [A, { x: A.x, y: B.y }, B]
  ];
  for (const x of xs) candidates.push([A, { x, y: A.y }, { x, y: B.y }, B]);
  for (const y of ys) candidates.push([A, { x: A.x, y }, { x: B.x, y }, B]);

  let best = null, bestCost = Infinity;
  for (const c of candidates) {
    const pts = simplify(c);
    if (!isOrthogonal(pts)) continue;
    if (pts.length > 1) {
      const first = segDir(pts[0], pts[1]);
      const last = segDir(pts[pts.length - 2], pts[pts.length - 1]);
      if (first && first[0] * n1[0] + first[1] * n1[1] < -0.01) continue;
      if (last && last[0] * n2[0] + last[1] * n2[1] > 0.01) continue;
    }
    let cost = pathLength(pts) + (pts.length - 2) * 40;
    if (ra) cost += 100000 * crossings(pts, ra);
    if (rb) cost += 100000 * crossings(pts, rb);
    if (cost < bestCost) { bestCost = cost; best = pts; }
  }
  return simplify([p1, ...(best || [A, { x: B.x, y: A.y }, B]), p2]);
}

function roundedPath(pts, r) {
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p = pts[i], p2 = pts[i + 1];
    const rr = Math.min(r, dist(p0, p) / 2, dist(p, p2) / 2);
    const a = { x: p.x + (p0.x - p.x) * rr / dist(p0, p), y: p.y + (p0.y - p.y) * rr / dist(p0, p) };
    const b = { x: p.x + (p2.x - p.x) * rr / dist(p, p2), y: p.y + (p2.y - p.y) * rr / dist(p, p2) };
    d += ` L${a.x} ${a.y} Q${p.x} ${p.y} ${b.x} ${b.y}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last.x} ${last.y}`;
}

// ra/rb are the two shapes, used to steer right-angled lines around them.
function routeD(style, p1, side1, p2, side2, ra, rb) {
  if (style === "straight" || !side2) return `M${p1.x} ${p1.y} L${p2.x} ${p2.y}`;
  const n1 = NORMAL[side1], n2 = NORMAL[side2];
  if (style === "curved") {
    const k = Math.max(30, dist(p1, p2) / 2.2);
    return `M${p1.x} ${p1.y} C${p1.x + n1[0] * k} ${p1.y + n1[1] * k} `
      + `${p2.x + n2[0] * k} ${p2.y + n2[1] * k} ${p2.x} ${p2.y}`;
  }
  return roundedPath(elbowPoints(p1, n1, p2, n2, ra, rb), BEND);
}

/* ---------- icons for the toolbars ---------- */
const I = (d, extra) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" `
  + `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra || ""}>${d}</svg>`;
const ICON = {
  rect: I('<rect x="3.5" y="6" width="17" height="12" rx="2"/>'),
  oval: I('<ellipse cx="12" cy="12" rx="8.5" ry="6"/>'),
  undo: I('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: I('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  zoomIn: I('<circle cx="11" cy="11" r="6.5"/><path d="M11 8v6M8 11h6M20 20l-4.2-4.2"/>'),
  zoomOut: I('<circle cx="11" cy="11" r="6.5"/><path d="M8 11h6M20 20l-4.2-4.2"/>'),
  fit: I('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  dup: I('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  front: I('<rect x="9" y="9" width="11" height="11" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M15 5H5v10"/>'),
  back: I('<rect x="4" y="4" width="11" height="11" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M9 19h10V9"/>'),
  trash: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  elbow: I('<path d="M4 18h6a2 2 0 0 0 2-2V8a2 2 0 0 1 2-2h6"/>'),
  straight: I('<path d="M4 19 20 5"/>'),
  curved: I('<path d="M4 19C12 19 12 5 20 5"/>'),
  arrowEnd: I('<path d="M4 12h15M14 7l5 5-5 5"/>'),
  arrowBoth: I('<path d="M5 12h14M10 7l-5 5 5 5M14 7l5 5-5 5"/>'),
  arrowNone: I('<path d="M4 12h16"/>'),
  flip: I('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
  label: I('<path d="M5 18 10 6h1l5 12M7 14h7"/><path d="M18 9v9"/>')
};

/* ---------- styles, injected once ---------- */
function injectStyles() {
  if (document.getElementById("tc-styles")) return;
  const accent = "var(--accent, #a0391c)";
  const css = `
  .tc-root [hidden] { display: none !important; }
  .tc-root { position: relative; width: 100%; height: 100%; overflow: hidden; outline: none;
    background: var(--paper, #faf8f3); user-select: none; -webkit-user-select: none;
    font-family: var(--font-body, "Segoe UI", system-ui, sans-serif); color: var(--ink, #141108); }
  .tc-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
  .tc-root.tc-placing .tc-svg { cursor: crosshair; }
  .tc-root.tc-panning .tc-svg, .tc-root.tc-panning .tc-svg * { cursor: grabbing !important; }
  .tc-node { cursor: move; }
  .tc-shape { stroke-width: 1.5; }
  .tc-fo { pointer-events: none; overflow: visible; }
  .tc-fo.editing { pointer-events: auto; }
  .tc-box { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
  .tc-label { width: 100%; max-height: 100%; text-align: center; white-space: pre-wrap; overflow-wrap: anywhere;
    line-height: 1.25; color: var(--ink, #141108); font-family: var(--font-body, "Segoe UI", system-ui, sans-serif);
    outline: none; }
  .tc-label[contenteditable] { cursor: text; user-select: text; -webkit-user-select: text; min-height: 1.25em; }
  .tc-measure { position: fixed; left: -10000px; top: 0; visibility: hidden; max-height: none; }
  .tc-link-hit { fill: none; stroke: transparent; cursor: pointer; }
  .tc-link-line { fill: none; stroke: #6a6252; stroke-width: 1.6; stroke-linejoin: round; pointer-events: none; }
  .tc-link.selected .tc-link-line { stroke: ${accent}; }
  .tc-link-label { cursor: pointer; }
  .tc-link-label rect { fill: var(--paper, #faf8f3); }
  .tc-link-label text { font-size: 12px; fill: #2f2a22; font-family: var(--font-body, "Segoe UI", system-ui, sans-serif); }
  .tc-sel { fill: none; stroke: ${accent}; stroke-width: 1.5; vector-effect: non-scaling-stroke; pointer-events: none; }
  .tc-handle { fill: #fff; stroke: ${accent}; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
  .tc-anchor { fill: #fff; stroke: ${accent}; stroke-width: 1.5; vector-effect: non-scaling-stroke; cursor: crosshair; }
  .tc-anchor.hot { fill: ${accent}; }
  .tc-plus { cursor: pointer; }
  .tc-plus circle { fill: #fff; stroke: ${accent}; stroke-width: 1.2; vector-effect: non-scaling-stroke; opacity: .9; }
  .tc-plus:hover circle { fill: ${accent}; }
  .tc-plus path { stroke: ${accent}; stroke-width: 1.6; vector-effect: non-scaling-stroke; }
  .tc-plus:hover path { stroke: #fff; }
  .tc-end { fill: #fff; stroke: ${accent}; stroke-width: 1.5; vector-effect: non-scaling-stroke; cursor: grab; }
  .tc-marquee { fill: rgba(160, 57, 28, .06); stroke: ${accent}; stroke-width: 1; stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke; pointer-events: none; }
  .tc-rubber { fill: none; stroke: ${accent}; stroke-width: 1.5; stroke-dasharray: 5 4;
    vector-effect: non-scaling-stroke; pointer-events: none; }
  .tc-bar { position: absolute; display: flex; align-items: center; gap: 2px; padding: 4px;
    background: #fff; border: 1px solid var(--rule, #cdc3ae); border-radius: 8px;
    box-shadow: 0 6px 18px rgba(26, 22, 18, .1), 0 1px 3px rgba(26, 22, 18, .08); z-index: 2; }
  .tc-tools { left: 12px; top: 50%; transform: translateY(-50%); flex-direction: column; }
  .tc-zoom { right: 12px; bottom: 12px; }
  .tc-ctx { transform: translateX(-50%); }
  .tc-btn { width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 6px;
    background: transparent; color: #2f2a22; cursor: pointer; padding: 0; }
  .tc-btn:hover { background: var(--paper-2, #ece7db); }
  .tc-btn.on { background: rgba(160, 57, 28, .1); color: ${accent}; }
  .tc-btn:disabled { opacity: .35; cursor: default; background: transparent; }
  .tc-sep { width: 1px; align-self: stretch; margin: 4px 3px; background: var(--rule-soft, #ddd4be); }
  .tc-tools .tc-sep { width: auto; height: 1px; margin: 3px 4px; }
  .tc-swatch { width: 22px; height: 22px; margin: 0 2px; border-radius: 50%; cursor: pointer; padding: 0;
    border: 1.5px solid; box-sizing: border-box; }
  .tc-swatch.on { box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px ${accent}; }
  .tc-zoom-level { min-width: 44px; text-align: center; font-size: 12px; color: #6a6252;
    font-variant-numeric: tabular-nums; }
  .tc-label-input { position: absolute; z-index: 3; transform: translate(-50%, -50%); width: 180px;
    padding: 5px 8px; font: inherit; font-size: 13px; text-align: center; border: 1px solid ${accent};
    border-radius: 6px; outline: none; background: #fff; box-shadow: 0 4px 14px rgba(26, 22, 18, .12); }
  `;
  document.head.append(htmlEl("style", { id: "tc-styles" }, css));
}

let instances = 0;

/* ---------- the editor ---------- */
function create(container, opts) {
  opts = opts || {};
  injectStyles();
  const ID = "tc" + (++instances);
  const onChange = typeof opts.onChange === "function" ? opts.onChange : () => {};

  let data = normalize(opts.data);
  let view = { x: 0, y: 0, z: 1 };        // screen = world * z + (x, y)
  let selNodes = new Set();
  let selLink = null;
  let tool = null;                        // "rect" | "oval" while placing a shape
  let hover = null;                       // node whose connection points are showing
  let gesture = null;                     // the pointer interaction in progress
  let editing = null;                     // { node, label, fo, before } while typing in a shape
  let labelEdit = null;                   // { link, before } while typing a line's label
  let lastColor = 0;
  let pendingBefore = null;
  const undoStack = [], redoStack = [];

  /* DOM */
  const root = htmlEl("div", { class: "tc-root", tabindex: "0" });
  const svg = svgEl("svg", { class: "tc-svg" });
  const defs = svgEl("defs", {}, svg);
  const pattern = svgEl("pattern", {
    id: ID + "-grid", width: GRID, height: GRID, x: -GRID / 2, y: -GRID / 2, patternUnits: "userSpaceOnUse"
  }, defs);
  svgEl("circle", { cx: GRID / 2, cy: GRID / 2, r: 1.1, fill: "#cfc5b0" }, pattern);
  for (const [suffix, color] of [["", "#6a6252"], ["-sel", "#a0391c"]]) {
    const m = svgEl("marker", {
      id: ID + "-arrow" + suffix, viewBox: "0 0 10 10", refX: 9, refY: 5,
      markerWidth: 6.5, markerHeight: 6.5, orient: "auto-start-reverse"
    }, defs);
    svgEl("path", { d: "M0 1 L9.5 5 L0 9 z", fill: color }, m);
  }
  const world = svgEl("g", {}, svg);
  const gridRect = svgEl("rect", {
    x: -100000, y: -100000, width: 200000, height: 200000, fill: `url(#${ID}-grid)`
  }, world);
  const linkLayer = svgEl("g", {}, world);
  const nodeLayer = svgEl("g", {}, world);
  const overlay = svgEl("g", {}, world);

  const btn = (icon, title, onclick, extra) => htmlEl("button", Object.assign({
    class: "tc-btn", type: "button", title, "aria-label": title, html: icon,
    onmousedown: e => e.preventDefault(), onclick
  }, extra || {}));
  const sep = () => htmlEl("span", { class: "tc-sep" });

  const rectTool = btn(ICON.rect, "Rectangle: click, then click the canvas", () => setTool("rect"));
  const ovalTool = btn(ICON.oval, "Oval: click, then click the canvas", () => setTool("oval"));
  const undoBtn = btn(ICON.undo, "Undo (Ctrl+Z)", () => undo());
  const redoBtn = btn(ICON.redo, "Redo (Ctrl+Y)", () => redo());
  const tools = htmlEl("div", { class: "tc-bar tc-tools" }, rectTool, ovalTool, sep(), undoBtn, redoBtn);

  const zoomLevel = htmlEl("span", { class: "tc-zoom-level" }, "100%");
  const zoomBar = htmlEl("div", { class: "tc-bar tc-zoom" },
    btn(ICON.zoomOut, "Zoom out", () => zoomCentre(1 / 1.25)),
    zoomLevel,
    btn(ICON.zoomIn, "Zoom in", () => zoomCentre(1.25)),
    sep(),
    btn(ICON.fit, "Fit to screen", () => fit()));

  const ctx = htmlEl("div", { class: "tc-bar tc-ctx", hidden: true });
  let ctxKind = null;

  const labelInput = htmlEl("input", {
    class: "tc-label-input", type: "text", maxlength: "80", placeholder: "Label", hidden: true
  });

  root.append(svg, tools, zoomBar, ctx, labelInput);
  container.append(root);

  /* coordinates */
  function toWorld(e) {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.z, y: (e.clientY - r.top - view.y) / view.z };
  }
  const toScreen = p => ({ x: p.x * view.z + view.x, y: p.y * view.z + view.y });
  const nodeById = id => data.nodes.find(n => n.id === id) || null;
  const linkById = id => data.links.find(l => l.id === id) || null;
  function nodeAt(p, exceptId) {
    for (let i = data.nodes.length - 1; i >= 0; i--) {
      const n = data.nodes[i];
      if (n.id !== exceptId && p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h) return n;
    }
    return null;
  }

  /* ---------- history ---------- */
  const snapshot = () => JSON.stringify(data);
  function commitFrom(before) {
    if (before == null || snapshot() === before) return;
    undoStack.push(before);
    if (undoStack.length > HISTORY) undoStack.shift();
    redoStack.length = 0;
    onChange(getData());
  }
  function begin() { pendingBefore = snapshot(); }
  function commit() { commitFrom(pendingBefore); pendingBefore = null; }
  function change(fn) {
    const before = snapshot();
    fn();
    commitFrom(before);
    render();
  }
  function restore(json) {
    data = JSON.parse(json);
    selNodes = new Set([...selNodes].filter(id => nodeById(id)));
    if (selLink && !linkById(selLink)) selLink = null;
    hover = null;
    onChange(getData());
    render();
  }
  function undo() {
    finishEditing();
    finishLabel(true);
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
  }
  function redo() {
    finishEditing();
    finishLabel(true);
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
  }

  /* ---------- rendering ---------- */
  let frame = 0;
  function scheduleRender() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
  }

  const nodeEls = new Map();
  function makeNodeEl(n) {
    const g = svgEl("g", { class: "tc-node", "data-node": n.id });
    svgEl("rect", { class: "tc-shape tc-rect", rx: RADIUS, ry: RADIUS }, g);
    svgEl("ellipse", { class: "tc-shape tc-oval" }, g);
    const fo = svgEl("foreignObject", { class: "tc-fo" }, g);
    const box = htmlEl("div", { class: "tc-box" });
    const label = htmlEl("div", { class: "tc-label" });
    box.append(label);
    fo.append(box);
    g._rect = g.children[0];
    g._oval = g.children[1];
    g._fo = fo;
    g._label = label;
    return g;
  }
  function updateNodeEl(g, n) {
    const c = COLORS[n.color] || COLORS[0];
    const isOval = n.shape === "oval";
    g._rect.style.display = isOval ? "none" : "";
    g._oval.style.display = isOval ? "" : "none";
    const shape = isOval ? g._oval : g._rect;
    if (isOval) {
      shape.setAttribute("cx", n.x + n.w / 2);
      shape.setAttribute("cy", n.y + n.h / 2);
      shape.setAttribute("rx", n.w / 2);
      shape.setAttribute("ry", n.h / 2);
    } else {
      shape.setAttribute("x", n.x);
      shape.setAttribute("y", n.y);
      shape.setAttribute("width", n.w);
      shape.setAttribute("height", n.h);
    }
    shape.setAttribute("fill", c.fill);
    shape.setAttribute("stroke", c.stroke);
    const tb = textBox(n);
    g._fo.setAttribute("x", tb.x);
    g._fo.setAttribute("y", tb.y);
    g._fo.setAttribute("width", tb.w);
    g._fo.setAttribute("height", tb.h);
    // The shape being typed in manages its own text and size.
    if (editing && editing.node.id === n.id) return;
    if (g._label.textContent !== n.text) g._label.textContent = n.text;
    g._label.style.fontSize = fitFont(n.text, tb.w, tb.h) + "px";
  }
  function renderNodes() {
    const seen = new Set();
    data.nodes.forEach((n, i) => {
      seen.add(n.id);
      let g = nodeEls.get(n.id);
      if (!g) { g = makeNodeEl(n); nodeEls.set(n.id, g); }
      updateNodeEl(g, n);
      if (nodeLayer.children[i] !== g) nodeLayer.insertBefore(g, nodeLayer.children[i] || null);
    });
    for (const [id, g] of nodeEls) {
      if (!seen.has(id)) { g.remove(); nodeEls.delete(id); }
    }
  }

  function linkGeometry(l, override) {
    const a = nodeById(l.from.node), b = nodeById(l.to.node);
    let from = { node: a, side: l.from.side }, to = { node: b, side: l.to.side };
    if (override) {
      if (override.end === "from") from = override.target;
      else to = override.target;
    }
    const pa = from.node ? anchorPoint(from.node, from.side) : from.point;
    const pb = to.node ? anchorPoint(to.node, to.side) : to.point;
    // A loose end follows the pointer as a straight line until it lands.
    const style = from.node && to.node ? l.style : "straight";
    return routeD(style, pa, from.side, pb, to.side, from.node, to.node);
  }
  function renderLinks() {
    linkLayer.textContent = "";
    const hitWidth = 12 / view.z;
    for (const l of data.links) {
      const relinking = gesture && gesture.kind === "relink" && gesture.link === l.id ? gesture : null;
      const d = linkGeometry(l, relinking && relinking.target ? relinking : null);
      const selected = selLink === l.id;
      const g = svgEl("g", { class: "tc-link" + (selected ? " selected" : ""), "data-link": l.id }, linkLayer);
      svgEl("path", { d, class: "tc-link-hit", "stroke-width": hitWidth }, g);
      const marker = `url(#${ID}-arrow${selected ? "-sel" : ""})`;
      const line = svgEl("path", {
        d, class: "tc-link-line",
        "marker-end": l.arrow !== "none" ? marker : null,
        "marker-start": l.arrow === "both" ? marker : null
      }, g);
      if (l.label && !(labelEdit && labelEdit.link === l.id)) {
        const mid = line.getPointAtLength(line.getTotalLength() / 2);
        const lg = svgEl("g", { class: "tc-link-label" }, g);
        const bg = svgEl("rect", {}, lg);
        const t = svgEl("text", { x: mid.x, y: mid.y, "text-anchor": "middle", "dominant-baseline": "central" }, lg);
        t.textContent = l.label;
        const bb = t.getBBox();
        bg.setAttribute("x", bb.x - 5);
        bg.setAttribute("y", bb.y - 2);
        bg.setAttribute("width", bb.width + 10);
        bg.setAttribute("height", bb.height + 4);
        bg.setAttribute("rx", 4);
      }
    }
    if (gesture && gesture.kind === "connect") {
      const src = nodeById(gesture.from.node);
      const p1 = anchorPoint(src, gesture.from.side);
      const t = gesture.target;
      const d = t
        ? routeD("elbow", p1, gesture.from.side, anchorPoint(t.node, t.side), t.side, src, t.node)
        : `M${p1.x} ${p1.y} L${gesture.p.x} ${gesture.p.y}`;
      svgEl("path", { d, class: "tc-rubber" }, linkLayer);
    }
  }

  function renderOverlay() {
    overlay.textContent = "";
    const z = view.z;
    const busy = gesture && gesture.kind !== "marquee";

    for (const id of selNodes) {
      const n = nodeById(id);
      if (!n) continue;
      svgEl("rect", {
        class: "tc-sel", x: n.x - 3 / z, y: n.y - 3 / z, width: n.w + 6 / z, height: n.h + 6 / z,
        rx: n.shape === "oval" ? 0 : RADIUS + 2 / z
      }, overlay);
    }

    // Resize handles on a single selected shape.
    if (selNodes.size === 1 && !editing && (!gesture || gesture.kind === "resize")) {
      const n = nodeById([...selNodes][0]);
      if (n) {
        const s = 8 / z;
        const corners = { nw: [n.x, n.y], ne: [n.x + n.w, n.y], se: [n.x + n.w, n.y + n.h], sw: [n.x, n.y + n.h] };
        for (const [c, [x, y]] of Object.entries(corners)) {
          const h = svgEl("rect", {
            class: "tc-handle", "data-handle": c, x: x - s / 2, y: y - s / 2, width: s, height: s, rx: 1.5 / z
          }, overlay);
          h.style.cursor = c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize";
        }
      }
    }

    // Connection points and quick-add buttons on the shape under the pointer.
    const connectTarget = gesture && (gesture.kind === "connect" || gesture.kind === "relink") && gesture.target;
    const show = connectTarget ? connectTarget.node : (!busy ? hover : null);
    if (show && nodeById(show.id)) {
      for (const side of SIDES) {
        const a = anchorPoint(show, side);
        const hot = connectTarget && connectTarget.side === side;
        svgEl("circle", {
          class: "tc-anchor" + (hot ? " hot" : ""), "data-anchor": side, "data-node": show.id,
          cx: a.x, cy: a.y, r: (hot ? 6.5 : 5) / z
        }, overlay);
        if (connectTarget) continue;
        const [nx, ny] = NORMAL[side];
        const off = 26 / z;
        const pg = svgEl("g", { class: "tc-plus", "data-plus": side, "data-node": show.id }, overlay);
        svgEl("title", {}, pg).textContent = "Add a connected shape";
        const cx = a.x + nx * off, cy = a.y + ny * off, r = 8.5 / z, k = 4 / z;
        svgEl("circle", { cx, cy, r }, pg);
        svgEl("path", { d: `M${cx - k} ${cy} H${cx + k} M${cx} ${cy - k} V${cy + k}` }, pg);
      }
    }

    // The ends of a selected line can be dragged to another shape.
    if (selLink && !gesture) {
      const l = linkById(selLink);
      if (l) {
        for (const end of ["from", "to"]) {
          const n = nodeById(l[end].node);
          if (!n) continue;
          const p = anchorPoint(n, l[end].side);
          svgEl("circle", { class: "tc-end", "data-end": end, cx: p.x, cy: p.y, r: 6 / z }, overlay);
        }
      }
    }

    if (gesture && gesture.kind === "marquee") {
      const r = marqueeRect(gesture);
      svgEl("rect", { class: "tc-marquee", x: r.x, y: r.y, width: r.w, height: r.h }, overlay);
    }
  }

  function render() {
    world.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.z})`);
    gridRect.style.display = view.z < 0.45 ? "none" : "";
    renderLinks();
    renderNodes();
    renderOverlay();
    placeContextBar();
    root.classList.toggle("tc-placing", !!tool);
    rectTool.classList.toggle("on", tool === "rect");
    ovalTool.classList.toggle("on", tool === "oval");
    undoBtn.disabled = !undoStack.length;
    redoBtn.disabled = !redoStack.length;
    zoomLevel.textContent = Math.round(view.z * 100) + "%";
  }

  /* ---------- the floating toolbar ---------- */
  function buildCtx(kind) {
    ctx.textContent = "";
    ctxKind = kind;
    if (kind === "node") {
      COLORS.forEach((c, i) => ctx.append(htmlEl("button", {
        class: "tc-swatch", type: "button", title: c.name, "aria-label": c.name, "data-color": i,
        style: `background:${c.fill};border-color:${c.stroke}`,
        onmousedown: e => e.preventDefault(),
        onclick: () => setColor(i)
      })));
      ctx.append(sep(),
        btn(ICON.rect, "Rectangle", () => setShape("rect"), { "data-shape": "rect" }),
        btn(ICON.oval, "Oval", () => setShape("oval"), { "data-shape": "oval" }),
        sep(),
        btn(ICON.dup, "Duplicate", () => duplicate()),
        btn(ICON.front, "Bring to front", () => restack(true)),
        btn(ICON.back, "Send to back", () => restack(false)),
        sep(),
        btn(ICON.trash, "Delete", () => deleteSelection()));
    } else if (kind === "link") {
      ctx.append(
        btn(ICON.elbow, "Right-angled line", () => setLink({ style: "elbow" }), { "data-style": "elbow" }),
        btn(ICON.straight, "Straight line", () => setLink({ style: "straight" }), { "data-style": "straight" }),
        btn(ICON.curved, "Curved line", () => setLink({ style: "curved" }), { "data-style": "curved" }),
        sep(),
        btn(ICON.arrowEnd, "Arrow", () => setLink({ arrow: "end" }), { "data-arrow": "end" }),
        btn(ICON.arrowBoth, "Arrows at both ends", () => setLink({ arrow: "both" }), { "data-arrow": "both" }),
        btn(ICON.arrowNone, "Plain line", () => setLink({ arrow: "none" }), { "data-arrow": "none" }),
        btn(ICON.flip, "Flip direction", () => flipLink()),
        sep(),
        btn(ICON.label, "Label (or double-click the line)", () => { const l = linkById(selLink); if (l) startLabel(l); }),
        sep(),
        btn(ICON.trash, "Delete", () => deleteSelection()));
    }
  }
  function placeContextBar() {
    const kind = gesture && gesture.kind !== "marquee" ? null
      : selNodes.size ? "node" : selLink ? "link" : null;
    if (!kind || labelEdit) { ctx.hidden = true; return; }
    if (kind !== ctxKind) buildCtx(kind);
    ctx.hidden = false;

    let top, left, below;
    if (kind === "node") {
      const ns = [...selNodes].map(nodeById).filter(Boolean);
      const colors = new Set(ns.map(n => n.color)), shapes = new Set(ns.map(n => n.shape));
      ctx.querySelectorAll("[data-color]").forEach(b =>
        b.classList.toggle("on", colors.size === 1 && colors.has(+b.dataset.color)));
      ctx.querySelectorAll("[data-shape]").forEach(b =>
        b.classList.toggle("on", shapes.size === 1 && shapes.has(b.dataset.shape)));
      const x0 = Math.min(...ns.map(n => n.x)), x1 = Math.max(...ns.map(n => n.x + n.w));
      const y0 = Math.min(...ns.map(n => n.y)), y1 = Math.max(...ns.map(n => n.y + n.h));
      const a = toScreen({ x: (x0 + x1) / 2, y: y0 }), b = toScreen({ x: 0, y: y1 });
      // Clear of the + buttons, which sit just outside the shape.
      left = a.x; top = a.y - 44; below = b.y + 44;
    } else {
      const l = linkById(selLink);
      if (!l) { ctx.hidden = true; return; }
      ctx.querySelectorAll("[data-style]").forEach(b => b.classList.toggle("on", b.dataset.style === l.style));
      ctx.querySelectorAll("[data-arrow]").forEach(b => b.classList.toggle("on", b.dataset.arrow === l.arrow));
      const m = linkMid(l);
      left = m.x; top = m.y - 18; below = m.y + 18;
    }
    const h = ctx.offsetHeight, w = ctx.offsetWidth;
    const rw = root.clientWidth;
    const y = top - h < 8 ? below : top - h;
    ctx.style.top = Math.round(y) + "px";
    ctx.style.left = Math.round(clamp(left, w / 2 + 8, rw - w / 2 - 8)) + "px";
  }
  function linkMid(l) {
    const p = svgEl("path", { d: linkGeometry(l) }, linkLayer);
    const m = p.getPointAtLength(p.getTotalLength() / 2);
    p.remove();
    return toScreen(m);
  }

  /* ---------- editing operations ---------- */
  function setTool(t) {
    finishEditing();
    tool = tool === t ? null : t;
    render();
  }
  function selectOnly(n) {
    selNodes = new Set(n ? [n.id] : []);
    selLink = null;
  }
  function clearSelection() {
    selNodes = new Set();
    selLink = null;
  }
  function newNode(shape, x, y, like) {
    return {
      id: uid(), shape, x: snap(x), y: snap(y),
      w: like ? like.w : NEW_W, h: like ? like.h : NEW_H,
      color: like ? like.color : lastColor, text: ""
    };
  }
  function newLink(from, to) {
    return { id: uid(), from, to, style: "elbow", arrow: "end", label: "" };
  }
  function placeShape(shape, p) {
    const n = newNode(shape, p.x - NEW_W / 2, p.y - NEW_H / 2);
    tool = null;
    change(() => data.nodes.push(n));
    selectOnly(n);
    startEditing(n);
  }
  function freeSpot(r, except) {
    return !data.nodes.some(o => o !== except && overlaps(r, o, GRID - 1));
  }
  // The + beside a shape: a copy of it, one step away in that direction,
  // already connected. Sideways steps find room if the spot is taken.
  function quickAdd(src, side) {
    const [nx, ny] = NORMAL[side];
    const gap = GRID * 4;
    const base = { x: src.x + nx * (src.w + gap), y: src.y + ny * (src.h + gap) };
    const step = nx ? { x: 0, y: src.h + GRID * 2 } : { x: src.w + GRID * 2, y: 0 };
    let spot = { x: snap(base.x), y: snap(base.y), w: src.w, h: src.h };
    for (let i = 1; i <= 12 && !freeSpot(spot); i++) {
      const k = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
      spot = { x: snap(base.x + step.x * k), y: snap(base.y + step.y * k), w: src.w, h: src.h };
    }
    const n = newNode(src.shape, spot.x, spot.y, src);
    change(() => {
      data.nodes.push(n);
      data.links.push(newLink({ node: src.id, side }, { node: n.id, side: OPPOSITE[side] }));
    });
    selectOnly(n);
    startEditing(n);
  }
  function setColor(i) {
    lastColor = i;
    change(() => { for (const id of selNodes) { const n = nodeById(id); if (n) n.color = i; } });
  }
  function setShape(s) {
    change(() => { for (const id of selNodes) { const n = nodeById(id); if (n) n.shape = s; } });
  }
  function restack(toFront) {
    change(() => {
      const moving = data.nodes.filter(n => selNodes.has(n.id));
      const rest = data.nodes.filter(n => !selNodes.has(n.id));
      data.nodes = toFront ? [...rest, ...moving] : [...moving, ...rest];
    });
  }
  function duplicate() {
    const map = new Map();
    const copies = [];
    change(() => {
      for (const n of data.nodes.filter(x => selNodes.has(x.id))) {
        const c = Object.assign({}, n, { id: uid(), x: n.x + GRID * 2, y: n.y + GRID * 2 });
        map.set(n.id, c.id);
        copies.push(c);
      }
      data.nodes.push(...copies);
      // Lines between duplicated shapes come along; lines to the rest don't.
      for (const l of data.links.filter(x => map.has(x.from.node) && map.has(x.to.node))) {
        data.links.push(Object.assign({}, l, {
          id: uid(),
          from: { node: map.get(l.from.node), side: l.from.side },
          to: { node: map.get(l.to.node), side: l.to.side }
        }));
      }
    });
    selNodes = new Set(copies.map(c => c.id));
    render();
  }
  function deleteSelection() {
    if (!selNodes.size && !selLink) return;
    finishEditing();
    change(() => {
      if (selNodes.size) {
        data.nodes = data.nodes.filter(n => !selNodes.has(n.id));
        data.links = data.links.filter(l => !selNodes.has(l.from.node) && !selNodes.has(l.to.node));
      }
      if (selLink) data.links = data.links.filter(l => l.id !== selLink);
    });
    clearSelection();
    hover = null;
    render();
  }
  function setLink(patch) {
    change(() => { const l = linkById(selLink); if (l) Object.assign(l, patch); });
  }
  function flipLink() {
    change(() => {
      const l = linkById(selLink);
      if (l) [l.from, l.to] = [l.to, l.from];
    });
  }

  /* ---------- typing in a shape ---------- */
  function readText(label) {
    return label.innerText.replace(/\r/g, "").replace(/\n$/, "");
  }
  function startEditing(n) {
    finishEditing();
    finishLabel(true);
    render();
    const g = nodeEls.get(n.id);
    if (!g) return;
    editing = { node: n, label: g._label, fo: g._fo, before: snapshot() };
    g._fo.classList.add("editing");
    g._label.setAttribute("contenteditable", "plaintext-only");
    g._label.addEventListener("input", onEditInput);
    g._label.addEventListener("blur", onEditBlur);
    g._label.focus();
    const r = document.createRange();
    r.selectNodeContents(g._label);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    render();
  }
  function onEditInput() {
    if (!editing) return;
    const { node, label } = editing;
    node.text = readText(label);
    const tb = textBox(node);
    label.style.fontSize = fitFont(node.text, tb.w, tb.h) + "px";
  }
  // Clicking anywhere outside the text ends typing, on the canvas or off it.
  function onEditBlur() { finishEditing(); }
  function finishEditing() {
    if (!editing) return;
    const { node, label, fo, before } = editing;
    editing = null;
    label.removeEventListener("input", onEditInput);
    label.removeEventListener("blur", onEditBlur);
    const text = readText(label).replace(/\s+$/, "");
    label.removeAttribute("contenteditable");
    fo.classList.remove("editing");
    if (nodeById(node.id)) node.text = text;
    if (document.activeElement === label) root.focus({ preventScroll: true });
    commitFrom(before);
    render();
  }

  /* ---------- a line's label ---------- */
  function startLabel(l) {
    finishEditing();
    selLink = l.id;
    selNodes = new Set();
    labelEdit = { link: l.id, before: snapshot() };
    render();
    const m = linkMid(l);
    labelInput.style.left = m.x + "px";
    labelInput.style.top = m.y + "px";
    labelInput.value = l.label || "";
    labelInput.hidden = false;
    labelInput.focus();
    labelInput.select();
  }
  function finishLabel(keep) {
    if (!labelEdit) return;
    const { link, before } = labelEdit;
    labelEdit = null;
    labelInput.hidden = true;
    const l = linkById(link);
    if (l && keep) l.label = labelInput.value.trim().slice(0, 80);
    commitFrom(before);
    if (document.activeElement === labelInput) root.focus({ preventScroll: true });
    render();
  }
  labelInput.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); finishLabel(true); }
    else if (e.key === "Escape") { e.preventDefault(); finishLabel(false); }
  });
  labelInput.addEventListener("blur", () => finishLabel(true));

  /* ---------- zoom ---------- */
  function zoomAt(factor, sx, sy) {
    const z = clamp(view.z * factor, ZOOM_MIN, ZOOM_MAX);
    const k = z / view.z;
    view.x = sx - (sx - view.x) * k;
    view.y = sy - (sy - view.y) * k;
    view.z = z;
    scheduleRender();
  }
  function zoomCentre(factor) {
    zoomAt(factor, svg.clientWidth / 2, svg.clientHeight / 2);
  }
  function fit() {
    const w = svg.clientWidth || 800, h = svg.clientHeight || 500;
    if (!data.nodes.length) {
      view = { x: w / 2, y: h / 2, z: 1 };
      render();
      return;
    }
    const pad = 60;
    const x0 = Math.min(...data.nodes.map(n => n.x)), x1 = Math.max(...data.nodes.map(n => n.x + n.w));
    const y0 = Math.min(...data.nodes.map(n => n.y)), y1 = Math.max(...data.nodes.map(n => n.y + n.h));
    const z = clamp(Math.min((w - pad * 2) / (x1 - x0), (h - pad * 2) / (y1 - y0)), ZOOM_MIN, 1.25);
    view = { z, x: w / 2 - ((x0 + x1) / 2) * z, y: h / 2 - ((y0 + y1) / 2) * z };
    render();
  }

  /* ---------- pointer ---------- */
  function marqueeRect(g) {
    return {
      x: Math.min(g.p0.x, g.p1.x), y: Math.min(g.p0.y, g.p1.y),
      w: Math.abs(g.p1.x - g.p0.x), h: Math.abs(g.p1.y - g.p0.y)
    };
  }
  function hoverAt(p) {
    const m = 36 / view.z;
    for (let i = data.nodes.length - 1; i >= 0; i--) {
      const n = data.nodes[i];
      if (p.x >= n.x - m && p.x <= n.x + n.w + m && p.y >= n.y - m && p.y <= n.y + n.h + m) return n;
    }
    return null;
  }
  // Where a dragged line end would land: a connection point it's over,
  // else the nearest one on the shape it's over.
  function dropTarget(e, p, exceptId) {
    const dot = e.target.closest && e.target.closest("[data-anchor]");
    if (dot && dot.dataset.node !== exceptId) {
      const n = nodeById(dot.dataset.node);
      if (n) return { node: n, side: dot.dataset.anchor };
    }
    const n = nodeAt(p, exceptId);
    return n ? { node: n, side: nearestSide(n, p) } : null;
  }

  function capture(e) {
    try { svg.setPointerCapture(e.pointerId); } catch (_) {}
  }

  function onDown(e) {
    if (editing && editing.label.contains(e.target)) return; // clicking inside the text being typed
    root.focus({ preventScroll: true });
    finishEditing();
    finishLabel(true);
    const p = toWorld(e);

    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      gesture = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      root.classList.add("tc-panning");
      capture(e);
      return;
    }
    if (e.button !== 0) return;
    if (tool) { placeShape(tool, p); return; }

    const t = e.target;
    const plus = t.closest("[data-plus]");
    if (plus) { const n = nodeById(plus.dataset.node); if (n) quickAdd(n, plus.dataset.plus); return; }

    const anchor = t.closest("[data-anchor]");
    if (anchor) {
      gesture = { kind: "connect", from: { node: anchor.dataset.node, side: anchor.dataset.anchor }, p, start: p, target: null };
      capture(e);
      render();
      return;
    }
    const handle = t.closest("[data-handle]");
    if (handle) {
      const n = nodeById([...selNodes][0]);
      if (n) {
        begin();
        gesture = { kind: "resize", node: n, corner: handle.dataset.handle, start: { x: n.x, y: n.y, w: n.w, h: n.h } };
        capture(e);
      }
      return;
    }
    const endEl = t.closest("[data-end]");
    if (endEl && selLink) {
      gesture = { kind: "relink", link: selLink, end: endEl.dataset.end, p, target: null };
      capture(e);
      render();
      return;
    }
    const nodeEl = t.closest("[data-node]");
    if (nodeEl) {
      const n = nodeById(nodeEl.dataset.node);
      if (!n) return;
      if (e.shiftKey) {
        if (selNodes.has(n.id)) selNodes.delete(n.id); else selNodes.add(n.id);
        selLink = null;
      } else if (!selNodes.has(n.id)) {
        selectOnly(n);
      }
      begin();
      const starts = new Map();
      for (const id of selNodes) { const m = nodeById(id); if (m) starts.set(id, { x: m.x, y: m.y }); }
      gesture = { kind: "move", p0: p, grab: n, starts, moved: false };
      capture(e);
      render();
      return;
    }
    const linkEl = t.closest("[data-link]");
    if (linkEl) {
      selNodes = new Set();
      selLink = linkEl.dataset.link;
      render();
      return;
    }
    // Empty canvas: drag a box to select.
    gesture = { kind: "marquee", p0: p, p1: p, base: e.shiftKey ? new Set(selNodes) : new Set() };
    if (!e.shiftKey) clearSelection();
    capture(e);
    render();
  }

  function onMove(e) {
    const p = toWorld(e);
    if (!gesture) {
      const h = hoverAt(p);
      if (h !== hover) { hover = h; scheduleRender(); }
      return;
    }
    const g = gesture;
    if (g.kind === "pan") {
      view.x = g.vx + (e.clientX - g.sx);
      view.y = g.vy + (e.clientY - g.sy);
      scheduleRender();
    } else if (g.kind === "move") {
      const dx = p.x - g.p0.x, dy = p.y - g.p0.y;
      if (!g.moved && Math.hypot(dx, dy) * view.z < 3) return;
      g.moved = true;
      // Snap the shape that was grabbed; the rest keep their offsets to it.
      const s = g.starts.get(g.grab.id) || { x: g.grab.x, y: g.grab.y };
      const ddx = snap(s.x + dx) - s.x, ddy = snap(s.y + dy) - s.y;
      for (const [id, st] of g.starts) {
        const n = nodeById(id);
        if (n) { n.x = st.x + ddx; n.y = st.y + ddy; }
      }
      scheduleRender();
    } else if (g.kind === "resize") {
      const s = g.start, c = g.corner, n = g.node;
      let left = s.x, top = s.y, right = s.x + s.w, bottom = s.y + s.h;
      if (c.includes("w")) left = Math.min(snap(p.x), right - MIN_W);
      if (c.includes("e")) right = Math.max(snap(p.x), left + MIN_W);
      if (c.includes("n")) top = Math.min(snap(p.y), bottom - MIN_H);
      if (c.includes("s")) bottom = Math.max(snap(p.y), top + MIN_H);
      n.x = left; n.y = top; n.w = right - left; n.h = bottom - top;
      scheduleRender();
    } else if (g.kind === "connect") {
      g.p = p;
      g.target = dropTarget(e, p, g.from.node);
      scheduleRender();
    } else if (g.kind === "relink") {
      g.p = p;
      const l = linkById(g.link);
      const other = l && (g.end === "from" ? l.to.node : l.from.node);
      g.target = dropTarget(e, p, other) || { node: null, point: p, side: null };
      scheduleRender();
    } else if (g.kind === "marquee") {
      g.p1 = p;
      const r = marqueeRect(g);
      selNodes = new Set(g.base);
      for (const n of data.nodes) if (overlaps(r, n, 0)) selNodes.add(n.id);
      scheduleRender();
    }
  }

  function onUp(e) {
    const g = gesture;
    if (!g) return;
    gesture = null;
    try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
    root.classList.remove("tc-panning");
    const p = toWorld(e);

    if (g.kind === "move" && !g.moved && !e.shiftKey && selNodes.size > 1) {
      // A plain click on one of several selected shapes picks just that one.
      selectOnly(g.grab);
      commit();
    } else if (g.kind === "move" || g.kind === "resize") {
      commit();
    } else if (g.kind === "connect") {
      const src = nodeById(g.from.node);
      const target = dropTarget(e, p, g.from.node);
      if (src && target) {
        const l = newLink(g.from, { node: target.node.id, side: target.side });
        change(() => data.links.push(l));
      } else if (src && dist(p, g.start) * view.z > 30) {
        // Dropped on empty canvas: a new shape there, connected.
        const n = newNode(src.shape, p.x - src.w / 2, p.y - src.h / 2, src);
        change(() => {
          data.nodes.push(n);
          data.links.push(newLink(g.from, { node: n.id, side: sideFacing(n, anchorPoint(src, g.from.side)) }));
        });
        selectOnly(n);
        startEditing(n);
        return;
      }
    } else if (g.kind === "relink") {
      const l = linkById(g.link);
      const other = l && (g.end === "from" ? l.to.node : l.from.node);
      const target = dropTarget(e, p, other);
      if (l && target) change(() => { l[g.end] = { node: target.node.id, side: target.side }; });
    }
    render();
  }

  function onDouble(e) {
    const nodeEl = e.target.closest("[data-node]");
    if (nodeEl && !e.target.closest("[data-plus], [data-anchor]")) {
      const n = nodeById(nodeEl.dataset.node);
      if (n) { selectOnly(n); startEditing(n); }
      return;
    }
    const linkEl = e.target.closest("[data-link]");
    if (linkEl) {
      const l = linkById(linkEl.dataset.link);
      if (l) startLabel(l);
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(Math.exp(-dy * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }

  function onKey(e) {
    if (editing) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finishEditing(); }
      return;
    }
    if (e.target === labelInput) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z") { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && k === "y") { e.preventDefault(); e.stopPropagation(); redo(); }
    else if (e.key === "Delete" || e.key === "Backspace") {
      if (selNodes.size || selLink) { e.preventDefault(); e.stopPropagation(); deleteSelection(); }
    } else if (e.key === "Escape") {
      if (tool || selNodes.size || selLink) {
        e.preventDefault();
        e.stopPropagation();
        tool = null;
        clearSelection();
        render();
      }
    }
  }

  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);
  svg.addEventListener("pointerleave", () => { if (!gesture && hover) { hover = null; scheduleRender(); } });
  svg.addEventListener("dblclick", onDouble);
  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("contextmenu", e => e.preventDefault());
  root.addEventListener("keydown", onKey);
  const resizeObserver = new ResizeObserver(() => scheduleRender());
  resizeObserver.observe(root);

  /* ---------- public ---------- */
  function getData() { return JSON.parse(JSON.stringify(data)); }
  function setData(d) {
    finishEditing();
    finishLabel(false);
    data = normalize(d);
    clearSelection();
    hover = null;
    undoStack.length = 0;
    redoStack.length = 0;
    render();
  }
  function destroy() {
    resizeObserver.disconnect();
    if (frame) cancelAnimationFrame(frame);
    root.remove();
  }

  render();
  requestAnimationFrame(() => fit());
  return { getData, setData, fit, destroy, undo, redo, refresh: render, element: root };
}

window.TodoCanvas = { create, normalize, COLORS: COLORS.map(c => Object.assign({}, c)) };
})();
