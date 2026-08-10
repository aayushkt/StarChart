/* StarChart editor.
 *
 * A thin shell over the starchart module: it owns the control panel and the
 * viewport, and nothing else. All geometry, styling and astronomy live in
 * ./starchart/, which is the same code a website would import -- so the editor
 * is also the proof that the library runs in a browser.
 *
 * Colour and weight changes rewrite the embedded stylesheet in place, which is
 * instant. Anything that moves geometry -- the time slider -- re-renders the
 * whole chart, which measures about 35 ms.
 */

import {
  BUCKET_COUNT, bucketMagnitude, buildChart, clockLabel, loadChart,
} from "./starchart/index.js";
import { atMinutes } from "./starchart/index.js";
import { stylesheet } from "./starchart/style.js";

const state = {
  svg: null,
  config: null,
  theme: null,
  base: null,      // pristine theme, for Reset
  data: null,
  observer: null,
  layers: [],
  ui: { starScale: 1, mwScale: 1, magLimit: 5, minutes: 720, labelBucket: 11,
        hidden: new Set() },
  view: { scale: 1, tx: 0, ty: 0 },
  fitted: true,
  panelsOff: new Set(),
  allPanels: { middle: [], bottom: [] },
  hemispheres: [],
  panelBoxes: [],
};

const round = (v, p) => Number(v.toFixed(p));

/* ---------- applying changes ----------
 *
 * Two paths, deliberately. Restyling rewrites one <style> element on the
 * chart that is already in the DOM. Re-rendering rebuilds the markup, and is
 * only reached when geometry actually moves.
 */

function restyle() {
  state.svg.querySelector("style").textContent = stylesheet(state.theme, state.ui);
  applyLayerVisibility();
}

function applyLayerVisibility() {
  for (const { id } of state.layers) {
    const el = state.svg.querySelector("#" + id);
    if (el) el.style.display = state.ui.hidden.has(id) ? "none" : "";
  }
}

function rerender() {
  const observer = state.observer ? atMinutes(state.observer, state.ui.minutes) : null;
  const panels = state.config.panels && {
    ...state.config.panels,
    middle: (state.allPanels.middle ?? []).filter((n) => !state.panelsOff.has(n)),
    bottom: (state.allPanels.bottom ?? []).filter((n) => !state.panelsOff.has(n)),
  };
  const built = buildChart({
    config: panels ? { ...state.config, panels } : state.config,
    theme: state.theme, data: state.data, observer, ui: state.ui,
  });
  const markup = built.markup;
  state.hemispheres = built.hemispheres;
  state.panelBoxes = built.panelBoxes;
  const wrap = document.getElementById("chart-wrap");
  wrap.innerHTML = markup;
  state.svg = wrap.querySelector("svg");
  state.svg.removeAttribute("width");
  state.svg.removeAttribute("height");
  state.svg.style.width = `${state.svg.viewBox.baseVal.width}px`;
  applyLayerVisibility();
  paint();
}

/* Control paths carry their own destination. `ui.` is editor-only state,
 * `config.` is geometry and forces a re-render, anything else is theme and only
 * needs the stylesheet rewritten. */
const rootFor = (path) =>
  path.startsWith("ui.") ? state.ui : path.startsWith("config.") ? state.config : state.theme;
const keysFor = (path) =>
  (path.startsWith("ui.") || path.startsWith("config.")) ? path.split(".").slice(1)
                                                         : path.split(".");

const get = (path) => keysFor(path).reduce((o, k) => (o == null ? o : o[k]), rootFor(path));
const set = (path, v) => {
  const keys = keysFor(path);
  const last = keys.pop();
  keys.reduce((o, k) => o[k], rootFor(path))[last] = v;
};
const isGeometry = (path) => path.startsWith("config.");

/* ---------- panel layout ----------
 *
 * Folders, because a flat list of forty controls is unusable. Each entry is a
 * top-level section; `folders` nest one level below it. Nesting deeper would
 * cost more in clicks than it saves in scrolling.
 */

const PRESETS = {
  "Original": null,   // restored from the pristine embedded theme
  "Midnight": {
    page: { background: "#0f1c24", frame: "#8fb4c4" },
    plate: { fill: "#060f16", rim: "#8fb4c4", scale_fill: "#132530", scale_text: "#8fb4c4" },
    stars: { fill: "#ffe9a8", halo_fill: "#ffe9a8" },
    milkyway: { fill: "#7fa8bd" },
    grid: { stroke: "#3f6d84", accent_stroke: "#6f9db4" },
    reference: { stroke: "#5f8ea3", ecliptic_stroke: "#9fc39a", colure_stroke: "#4d7a8f",
                 label_fill: "#a8c6d2" },
    type: { title_fill: "#e6dcbd", hemi_fill: "#e6dcbd", star_fill: "#dfe6d8",
            constel_fill: "#eee4c8", constel_alt: "#9fbecb" },
  },
  "Blueprint": {
    page: { background: "#12457e", frame: "#dbe8f5" },
    plate: { fill: "#0d3765", rim: "#dbe8f5", scale_fill: "#12457e", scale_text: "#dbe8f5" },
    stars: { fill: "#ffffff", halo_fill: "#ffffff" },
    milkyway: { fill: "#a9c8ea" },
    grid: { stroke: "#94b6dc", accent_stroke: "#dbe8f5" },
    reference: { stroke: "#a9c8ea", ecliptic_stroke: "#dbe8f5", colure_stroke: "#7ba3d0",
                 label_fill: "#dbe8f5" },
    type: { title_fill: "#ffffff", hemi_fill: "#ffffff", star_fill: "#dbe8f5",
            constel_fill: "#ffffff", constel_alt: "#a9c8ea" },
  },
  "Sepia": {
    page: { background: "#efe3cc", frame: "#4a3520" },
    plate: { fill: "#3d2c1a", rim: "#efe3cc", scale_fill: "#e6d8bd", scale_text: "#4a3520" },
    stars: { fill: "#f0cc7e", halo_fill: "#f0cc7e" },
    milkyway: { fill: "#c9ab7c" },
    grid: { stroke: "#8f7350", accent_stroke: "#bda07a" },
    reference: { stroke: "#b09267", ecliptic_stroke: "#d8c08a", colure_stroke: "#8f7350",
                 label_fill: "#e2d2b0" },
    type: { title_fill: "#4a3520", hemi_fill: "#4a3520", star_fill: "#f2e6c9",
            constel_fill: "#f7edd6", constel_alt: "#cdb489" },
  },
};

const PANEL = [
  { title: "The moment", open: true, kind: "time" },
  { title: "Presets", open: true, kind: "presets" },
  {
    title: "Features", open: true, folders: [
      { title: "Plate", layers: ["layer-plate", "layer-milkyway", "layer-grid",
                                 "layer-stars", "layer-star-halos"] },
      { title: "Reference lines", layers: ["layer-tropics", "layer-ecliptic",
                                           "layer-colures"] },
      { title: "Names", layers: ["layer-constellation-labels", "layer-star-labels"] },
      { title: "Sun & Moon", layers: ["layer-sun", "layer-moon", "layer-moon-track"] },
      { title: "Your sky", layers: ["layer-horizon"] },
      { title: "Page", layers: ["layer-frame", "layer-title", "layer-rim",
                                "layer-hemi-labels", "layer-panels"] },
    ],
  },
  {
    title: "Layout", folders: [
      { title: "The plates", sliders: [
        { path: "config.layout.radius", label: "Circle radius", min: 60, max: 260, step: 1, unit: "mm" },
        { path: "config.layout.gap", label: "Gap between them", min: 0, max: 260, step: 1, unit: "mm" },
        { path: "config.layout.top_offset", label: "Distance below the title", min: 0, max: 220, step: 1, unit: "mm" },
        { path: "config.layout.overlap_deg", label: "Reach past the equator", min: 0, max: 40, step: 0.5, unit: "°" },
        { path: "config.layout.ra_zero_deg", label: "Rotation", min: 0, max: 360, step: 1, unit: "°" },
        { path: "config.layout.hemi_label_deg", label: "Hemisphere label angle", min: -180, max: 180, step: 1, unit: "°" },
      ] },
      { title: "The sheet", sliders: [
        { path: "config.page.width", label: "Page width", min: 200, max: 1200, step: 5, unit: "mm" },
        { path: "config.page.height", label: "Page height", min: 300, max: 1600, step: 5, unit: "mm" },
        { path: "config.page.margin", label: "Margin", min: 10, max: 120, step: 1, unit: "mm" },
        { path: "config.panels.gutter", label: "Gap between diagrams", min: 0, max: 40, step: 1, unit: "mm" },
      ] },
      { title: "Diagrams", panels: true },
    ],
  },
  {
    title: "Colours", folders: [
      { title: "Page & plate", colors: [
        ["page.background", "Paper"],
        ["page.frame", "Border & rules"],
        ["plate.fill", "Plate"],
        ["plate.rim", "Inner rim"],
        ["plate.scale_fill", "Scale band"],
        ["plate.scale_text", "Scale numbers"],
      ] },
      { title: "Stars & Milky Way", colors: [
        ["stars.fill", "Stars"],
        ["stars.halo_fill", "Star halo"],
        ["milkyway.fill", "Milky Way"],
      ] },
      { title: "Lines", colors: [
        ["grid.stroke", "Graticule"],
        ["grid.accent_stroke", "Equator & polar circle"],
        ["reference.stroke", "Tropics & polar circles"],
        ["reference.ecliptic_stroke", "Ecliptic"],
        ["reference.colure_stroke", "Colures"],
      ] },
      { title: "Names", colors: [
        ["type.title_fill", "Title"],
        ["type.hemi_fill", "Hemisphere labels"],
        ["type.star_fill", "Star names"],
        ["type.constel_fill", "Constellation names"],
        ["type.constel_alt", "Constellation, Latin"],
        ["reference.label_fill", "Reference labels"],
      ] },
      { title: "Sun, Moon & horizon", colors: [
        ["bodies.sun_fill", "Sun"],
        ["bodies.sun_ray", "Sun's rays"],
        ["bodies.day_circle_sun", "Sun's day circle"],
        ["bodies.moon_lit", "Moon, lit"],
        ["bodies.moon_dark", "Moon, dark"],
        ["bodies.day_circle_moon", "Moon's day circle"],
        ["bodies.moon_track", "Moon's monthly path"],
        ["horizon.stroke", "Horizon & zenith"],
      ] },
    ],
  },
  {
    title: "Adjustments", folders: [
      { title: "Stars", sliders: [
        { path: "ui.starScale", label: "Star size", min: 0.3, max: 2.5, step: 0.05, unit: "×" },
        { path: "ui.magLimit", label: "Faintest magnitude class", min: 1, max: 5, step: 1, unit: "" },
        { path: "stars.halo_opacity", label: "Halo strength", min: 0, max: 0.5, step: 0.01, unit: "" },
        { path: "ui.mwScale", label: "Milky Way strength", min: 0, max: 3, step: 0.05, unit: "×" },
      ] },
      { title: "Names", sliders: [
        { path: "ui.labelBucket", label: "Label stars brighter than", min: 0, max: 17, step: 1,
          unit: "", format: (b) => `mag ${bucketMagnitude(b).toFixed(1)}` },
        { path: "type.star_size", label: "Star name size", min: 1.2, max: 5, step: 0.1, unit: "mm" },
        { path: "type.constel_size", label: "Constellation name size", min: 1.5, max: 7, step: 0.1, unit: "mm" },
        { path: "reference.label_size", label: "Reference label size", min: 1.2, max: 5, step: 0.1, unit: "mm" },
      ] },
      { title: "Lines", sliders: [
        { path: "grid.opacity", label: "Graticule opacity", min: 0, max: 1, step: 0.02, unit: "" },
        { path: "grid.width", label: "Graticule weight", min: 0.05, max: 1.2, step: 0.01, unit: "mm" },
        { path: "reference.width", label: "Tropics weight", min: 0.05, max: 1.5, step: 0.01, unit: "mm" },
        { path: "reference.ecliptic_width", label: "Ecliptic weight", min: 0.05, max: 2, step: 0.01, unit: "mm" },
        { path: "reference.colure_width", label: "Colure weight", min: 0, max: 1.5, step: 0.01, unit: "mm" },
        { path: "plate.rim_width", label: "Rim weight", min: 0, max: 4, step: 0.1, unit: "mm" },
        { path: "horizon.width", label: "Horizon weight", min: 0.1, max: 3, step: 0.05, unit: "mm" },
      ] },
      { title: "Sun & Moon", sliders: [
        { path: "bodies.sun_size", label: "Sun size", min: 1, max: 8, step: 0.1, unit: "mm" },
        { path: "bodies.sun_rays", label: "Ray count", min: 4, max: 24, step: 1, unit: "" },
        { path: "bodies.sun_ray_length", label: "Ray length", min: 0.1, max: 1.5, step: 0.05, unit: "×" },
        { path: "bodies.moon_size", label: "Moon size", min: 1, max: 8, step: 0.1, unit: "mm" },
        { path: "bodies.day_circle_width", label: "Day circle weight", min: 0.1, max: 2, step: 0.05, unit: "mm" },
      ] },
      { title: "Title", sliders: [
        { path: "type.title_size", label: "Title size", min: 8, max: 44, step: 0.5, unit: "mm" },
        { path: "type.title_tracking", label: "Title tracking", min: 0, max: 14, step: 0.1, unit: "mm" },
        { path: "type.hemi_size", label: "Hemisphere label size", min: 3, max: 16, step: 0.2, unit: "mm" },
      ] },
    ],
  },
];

const LAYER_LABELS = () => Object.fromEntries(state.layers.map((l) => [l.id, l.label]));

/* ---------- control building ---------- */

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

function section(title, open = false) {
  const d = el("details", "section");
  d.open = open;
  d.appendChild(el("summary", null, title));
  const body = el("div", "section-body");
  d.appendChild(body);
  return { root: d, body };
}

function colorRow(path, label) {
  const row = el("div", "row");
  row.appendChild(el("label", null, label));
  const input = el("input", "swatch");
  input.type = "color";
  input.value = get(path);
  input.addEventListener("input", () => { set(path, input.value); restyle(); });
  input.dataset.path = path;
  row.appendChild(input);
  return row;
}

function sliderRow(spec) {
  const read = () => get(spec.path);

  const wrap = el("div", "slider-row");
  const head = el("div", "slider-head");
  head.appendChild(el("label", null, spec.label));
  const val = el("span");
  head.appendChild(val);
  wrap.appendChild(head);

  const input = el("input");
  input.type = "range";
  Object.assign(input, { min: spec.min, max: spec.max, step: spec.step, value: read() });
  const show = () => {
    val.textContent = spec.format ? spec.format(read()) : `${read()}${spec.unit}`;
  };
  input.addEventListener("input", () => {
    set(spec.path, parseFloat(input.value));
    show();
    if (isGeometry(spec.path)) rerender(); else restyle();
  });
  input.dataset.path = spec.path;
  show();
  wrap.appendChild(input);
  return wrap;
}

function checkRow(id, label) {
  const lab = el("label", "check");
  const input = el("input");
  input.type = "checkbox";
  // Tagged so the layer/toggle invariant can be checked exactly, rather than by
  // counting checkboxes and hoping none of the others drifted in.
  input.dataset.layer = id;
  input.checked = !state.ui.hidden.has(id);
  input.addEventListener("change", () => {
    if (input.checked) state.ui.hidden.delete(id); else state.ui.hidden.add(id);
    restyle();
  });
  lab.appendChild(input);
  lab.appendChild(el("span", "box"));
  lab.appendChild(el("span", null, label));
  return lab;
}

function timeRow() {
  const obs = state.observer;
  const wrap = el("div", "slider-row");
  const head = el("div", "slider-head");
  head.appendChild(el("label", null, "Local time"));
  const val = el("span");
  head.appendChild(val);
  wrap.appendChild(head);

  const input = el("input");
  input.type = "range";
  Object.assign(input, { min: 0, max: 1439, step: 1, value: state.ui.minutes });
  const show = () => { val.textContent = clockLabel(state.ui.minutes); };
  input.addEventListener("input", () => {
    state.ui.minutes = parseInt(input.value, 10);
    show();
    rerender();
  });
  show();
  wrap.appendChild(input);

  const note = el("p", "sub",
    `${obs.place || "observer"} · ${Math.abs(obs.latitude).toFixed(2)}°` +
    `${obs.latitude >= 0 ? "N" : "S"} ${Math.abs(obs.longitude).toFixed(2)}°` +
    `${obs.longitude >= 0 ? "E" : "W"} · ${obs.localDate}`);
  wrap.appendChild(note);
  return wrap;
}

function folder(title) {
  const d = el("details", "folder");
  d.open = true;
  d.appendChild(el("summary", null, title));
  const body = el("div", "folder-body");
  d.appendChild(body);
  return { root: d, body };
}

const PANEL_LABELS = {
  "planet-sizes": "Comparative sizes",
  "magnitude-key": "Magnitude key",
  "solar-system": "Solar system",
  "solar-eclipse": "Eclipse of the Sun",
  "lunar-eclipse": "Eclipse of the Moon",
  "earth-revolution": "Earth's revolution",
  "moon-illumination": "Illumination of the Moon",
};

/** One checkbox per diagram. Switching one off re-renders, so the rest of the
 *  band spreads out to fill the space rather than leaving a hole. */
function panelRows() {
  const bands = ["middle", "bottom"];
  const present = new Set(bands.flatMap((b) => state.config.panels?.[b] ?? []));
  return Object.entries(PANEL_LABELS)
    .filter(([name]) => present.has(name) || state.panelsOff.has(name))
    .map(([name, label]) => {
      const wrap = el("label", "check");
      const input = el("input");
      input.type = "checkbox";
      input.checked = !state.panelsOff.has(name);
      input.addEventListener("change", () => {
        if (input.checked) state.panelsOff.delete(name); else state.panelsOff.add(name);
        rerender();
      });
      wrap.appendChild(input);
      wrap.appendChild(el("span", "box"));
      wrap.appendChild(el("span", null, label));
      return wrap;
    });
}

function buildControls() {
  const host = document.getElementById("controls");
  host.textContent = "";
  const labels = LAYER_LABELS();

  for (const group of PANEL) {
    if (group.kind === "time" && !state.observer) continue;
    const sec = section(group.title, group.open ?? false);

    if (group.kind === "time") {
      sec.body.appendChild(timeRow());
    } else if (group.kind === "presets") {
      const bar = el("div", "presets");
      Object.keys(PRESETS).forEach((name) => {
        const b = el("button", "preset", name);
        b.addEventListener("click", () => applyPreset(name));
        bar.appendChild(b);
      });
      sec.body.appendChild(bar);
    }

    for (const spec of group.folders ?? []) {
      const f = folder(spec.title);
      (spec.layers ?? [])
        .filter((id) => id in labels)
        .forEach((id) => f.body.appendChild(checkRow(id, labels[id])));
      (spec.colors ?? [])
        .filter(([path]) => hasPath(path))
        .forEach(([path, label]) => f.body.appendChild(colorRow(path, label)));
      (spec.sliders ?? [])
        .filter((s) => s.path.startsWith("ui.") || hasPath(s.path))
        .forEach((s) => f.body.appendChild(sliderRow(s)));
      if (spec.panels) panelRows().forEach((row) => f.body.appendChild(row));
      if (f.body.children.length) sec.body.appendChild(f.root);
    }
    if (sec.body.children.length) host.appendChild(sec.root);
  }
}

function hasPath(path) {
  return get(path) !== undefined;
}

function deepMerge(target, patch) {
  Object.entries(patch).forEach(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v)) deepMerge(target[k], v);
    else target[k] = v;
  });
}

function applyPreset(name) {
  const patch = PRESETS[name];
  state.theme = structuredClone(state.base);
  if (patch) deepMerge(state.theme, patch);
  restyle();
  buildControls();
}

/* ---------- pan & zoom ----------
 *
 * The chart is laid out once at 1 unit = 1 px and then moved with a CSS
 * transform, so panning and zooming are just three numbers. Scrollbars and
 * their centring quirks never enter into it, and SVG stays vector-crisp at any
 * scale.
 *
 * Gestures follow the convention every canvas tool uses: a trackpad pinch
 * arrives as a wheel event with ctrlKey set and zooms; a plain two-finger
 * scroll pans; dragging pans; double-click refits.
 */

const MIN_SCALE = 0.04;
const MAX_SCALE = 16;
const PAD = 28;        // breathing room around the chart when fitted
const KEEP_VISIBLE = 90;  // px of chart that must stay on screen when panning

const stage = () => document.getElementById("stage-scroll");
const wrap = () => document.getElementById("chart-wrap");

function contentSize() {
  const vb = state.svg.viewBox.baseVal;
  return { w: vb.width, h: vb.height };
}

function fitScale() {
  const box = stage().getBoundingClientRect();
  const { w, h } = contentSize();
  return Math.min((box.width - PAD * 2) / w, (box.height - PAD * 2) / h);
}

/** Keep at least a corner of the chart within the stage. */
function clamp(view) {
  const box = stage().getBoundingClientRect();
  const { w, h } = contentSize();
  const cw = w * view.scale;
  const ch = h * view.scale;
  view.tx = Math.min(box.width - KEEP_VISIBLE, Math.max(KEEP_VISIBLE - cw, view.tx));
  view.ty = Math.min(box.height - KEEP_VISIBLE, Math.max(KEEP_VISIBLE - ch, view.ty));
  return view;
}

function paint() {
  const { scale, tx, ty } = state.view;
  wrap().style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  document.getElementById("zoom-level").textContent =
    `${Math.round((scale / fitScale()) * 100)}%`;
}

function fit() {
  const box = stage().getBoundingClientRect();
  const { w, h } = contentSize();
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fitScale()));
  state.view = { scale, tx: (box.width - w * scale) / 2, ty: (box.height - h * scale) / 2 };
  state.fitted = true;
  paint();
}

/** Write a finished drag into the config, then re-render from it. */
function commitMove(handle, dx, dy) {
  const placement = state.config.placement ?? (state.config.placement = {});
  if (handle.kind === "plate") {
    const hemi = state.hemispheres.find((h) => h.pole === handle.name);
    if (!hemi) return;
    placement.plates = placement.plates ?? {};
    placement.plates[handle.name] = { cx: hemi.cx + dx, cy: hemi.cy + dy };
  } else {
    const entry = state.panelBoxes.find((b) => b.name === handle.name);
    if (!entry) return;
    placement.panels = placement.panels ?? {};
    placement.panels[handle.name] = {
      ...entry.box, x: entry.box.x + dx, y: entry.box.y + dy,
    };
  }
  rerender();
}

function panBy(dx, dy) {
  state.view.tx += dx;
  state.view.ty += dy;
  state.fitted = false;
  clamp(state.view);
  paint();
}

/** Scale by `factor`, holding the point under (clientX, clientY) still. */
function zoomAt(factor, clientX, clientY) {
  const box = stage().getBoundingClientRect();
  const x = clientX - box.left;
  const y = clientY - box.top;
  const v = state.view;

  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  if (next === v.scale) return;

  // The content point currently under the cursor must stay under the cursor.
  v.tx = x - ((x - v.tx) / v.scale) * next;
  v.ty = y - ((y - v.ty) / v.scale) * next;
  v.scale = next;

  state.fitted = false;
  clamp(v);
  paint();
}

function initViewport() {
  const el = stage();

  // Lay the chart out at 1:1 so the transform is the only scaling in play.
  state.svg.style.width = `${contentSize().w}px`;

  el.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
    } else {
      // Trackpads report line and page deltas as well as pixels.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      panBy(-event.deltaX * unit, -event.deltaY * unit);
    }
  }, { passive: false });

  /* Left-drag moves whatever is under the pointer, and pans only when that is
   * nothing. A plate is spread across every layer group, so it is found by its
   * data-plate tag and all its pieces move together; a diagram is a single
   * group. During the drag the pieces are translated with a CSS transform,
   * which is instant, and the position is committed to the config on release --
   * re-rendering on every pointermove would be a 35 ms frame. */
  let pointer = null;

  const handleFor = (target) => {
    const panel = target.closest?.("[data-drag]");
    if (panel) return { kind: "panel", name: panel.dataset.drag.split(":")[1] };
    const plate = target.closest?.("[data-plate]");
    if (plate) return { kind: "plate", name: plate.dataset.plate };
    return null;
  };

  const piecesFor = (handle) =>
    handle.kind === "plate"
      ? [...state.svg.querySelectorAll(`[data-plate="${handle.name}"]`)]
      : [...state.svg.querySelectorAll(`[data-drag="panel:${handle.name}"]`)];

  el.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const handle = state.locked ? null : handleFor(event.target);
    pointer = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      dx: 0, dy: 0, handle,
      pieces: handle ? piecesFor(handle) : [],
    };
    el.setPointerCapture(event.pointerId);
    el.classList.add(handle ? "moving" : "dragging");
  });

  el.addEventListener("pointermove", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;

    if (!pointer.handle) {
      panBy(dx, dy);
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      return;
    }
    // Screen pixels to chart millimetres.
    pointer.dx += dx / state.view.scale;
    pointer.dy += dy / state.view.scale;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const shift = `translate(${pointer.dx.toFixed(3)} ${pointer.dy.toFixed(3)})`;
    for (const piece of pointer.pieces) piece.setAttribute("transform", shift);
  });

  const release = (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const { handle, dx, dy } = pointer;
    pointer = null;
    el.classList.remove("dragging", "moving");
    if (!handle || (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01)) return;
    commitMove(handle, dx, dy);
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);

  el.addEventListener("dblclick", fit);
  window.addEventListener("resize", () => { if (state.fitted) fit(); });
}

/* ---------- download ---------- */

function download() {
  // Re-render at the current settings rather than scraping the DOM: the markup
  // the library produces is already exactly what is on screen, and CSS `r` on
  // the stars would otherwise be lost on renderers that ignore it.
  const observer = state.observer ? atMinutes(state.observer, state.ui.minutes) : null;
  let { markup } = buildChart({
    config: state.config, theme: state.theme, data: state.data, observer, ui: state.ui,
  });
  // Hidden layers are removed outright rather than left as display:none.
  for (const id of state.ui.hidden) {
    markup = markup.replace(
      new RegExp(`<g id="${id}">.*?</g>(?=<g id="layer-|<g id="layer-caption"|</svg>)`, "s"),
      "");
  }

  const blob = new Blob([markup], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "celestial-chart.svg";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- boot ---------- */

async function boot() {
  // A local config, if there is one, overrides the neutral public defaults.
  // Absence is the normal case, so a failed import is not an error.
  let config;
  try {
    config = (await import("./starchart/config.local.js")).default;
  } catch {
    config = undefined;
  }

  let loaded;
  try {
    loaded = await loadChart({ base: "./starchart", ...(config ? { config } : {}) });
  } catch (err) {
    document.getElementById("controls").innerHTML =
      `<p class="loading">Could not load the chart data.<br><br><code>${err.message}</code>` +
      "<br><br>Serve this directory over HTTP rather than opening the file directly:" +
      "<br><br><code>python3 -m starchart.dev</code></p>";
    return;
  }

  state.config = loaded.config;
  state.theme = loaded.theme;
  state.base = structuredClone(loaded.theme);
  state.data = loaded.data;
  state.observer = loaded.observer;
  state.layers = loaded.layers;
  state.allPanels = {
    middle: [...(loaded.config.panels?.middle ?? [])],
    bottom: [...(loaded.config.panels?.bottom ?? [])],
  };
  state.ui.labelBucket = loaded.theme.labels.mag_bucket;
  if (state.observer) state.ui.minutes = state.observer.minutes;

  rerender();
  document.getElementById("dims").textContent =
    `${Math.round(state.config.page.width)} × ${Math.round(state.config.page.height)} mm`;

  buildControls();
  initViewport();
  fit();
}

document.getElementById("download").addEventListener("click", download);
document.getElementById("reset-layout")?.addEventListener("click", () => {
  delete state.config.placement;
  rerender();
});
document.getElementById("reset").addEventListener("click", () => {
  delete state.config.placement;
  state.ui = {
    starScale: 1, mwScale: 1, magLimit: 5,
    labelBucket: state.theme.labels.mag_bucket,
    minutes: state.observer ? state.observer.local_minutes : 720,
    hidden: new Set(),
  };
  applyPreset("Original");
  rerender();
});
boot();
