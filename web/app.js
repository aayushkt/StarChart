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
  dpi: 96,   // nominal until loadCalibration() reads a measured value
  editing: false,
  panelsOff: new Set(),
  allPanels: { middle: [], rows: [] },
  baseConfig: null,
  hemispheres: [],
  panelBoxes: [],
  textBoxes: [],
  selection: null,
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

function updateDims() {
  const { width, height } = state.config.page;
  const inches = (mm) => (mm / 25.4).toFixed(mm / 25.4 % 1 < 0.05 ? 0 : 1);
  document.getElementById("dims").textContent =
    `${Math.round(width)} × ${Math.round(height)} mm · ${inches(width)}″ × ${inches(height)}″`;
}

function rerender() {
  const observer = state.observer ? atMinutes(state.observer, state.ui.minutes) : null;
  const keep = (names) => names.filter((n) => !state.panelsOff.has(n));
  const panels = state.config.panels && {
    ...state.config.panels,
    middle: keep(state.allPanels.middle ?? []),
    rows: (state.allPanels.rows ?? []).map(keep).filter((r) => r.length),
  };
  const built = buildChart({
    config: panels ? { ...state.config, panels } : state.config,
    theme: state.theme, data: state.data, observer, ui: state.ui,
  });
  const markup = built.markup;
  state.hemispheres = built.hemispheres;
  state.panelBoxes = built.panelBoxes;
  state.textBoxes = built.textBoxes;
  const wrap = document.getElementById("chart-wrap");
  wrap.innerHTML = markup;
  state.svg = wrap.querySelector("svg");
  state.svg.removeAttribute("width");
  state.svg.removeAttribute("height");
  state.svg.style.width = `${state.svg.viewBox.baseVal.width}px`;
  applyLayerVisibility();
  drawHandles();
  updateDims();
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
      { title: "The plates", fit: true, sliders: [
        ...(state.config?.layout?.fit_between_text
          ? [{ path: "config.layout.fit_clearance", label: "Spacing", min: 0, max: 120, step: 1, unit: "mm" }]
          : [{ path: "config.layout.radius", label: "Circle radius", min: 60, max: 300, step: 1, unit: "mm" },
             { path: "config.layout.top_offset", label: "Distance below the title", min: 0, max: 300, step: 1, unit: "mm" }]),
        { path: "config.layout.gap", label: "Gap between them", min: 0, max: 260, step: 1, unit: "mm" },
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
      { title: "Diagrams", panelsEnabled: true, panels: true },
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
    // Touching the layout would otherwise shift every diagram that is still
    // following the computed arrangement.
    if (isGeometry(spec.path) && !spec.path.startsWith("config.placement")) freezeDerived();
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
  const present = new Set([
    ...(state.allPanels.middle ?? []),
    ...(state.allPanels.rows ?? []).flat(),
  ]);
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

/* ---------- per-selection controls ----------
 *
 * With forty-odd controls on the sheet, showing all of them at once buries the
 * three that apply to the thing you just grabbed. Selecting an object narrows
 * the panel to that object; deselecting brings the global controls back.
 */

const PLATE_COLOURS = [
  ["plate.fill", "Plate"],
  ["plate.rim", "Inner rim"],
  ["plate.scale_fill", "Scale band"],
  ["plate.scale_text", "Scale numbers"],
  ["stars.fill", "Stars"],
  ["milkyway.fill", "Milky Way"],
  ["grid.stroke", "Graticule"],
  ["reference.stroke", "Tropics"],
  ["reference.ecliptic_stroke", "Ecliptic"],
  ["type.star_fill", "Star names"],
  ["type.constel_fill", "Constellation names"],
  ["horizon.stroke", "Horizon"],
];

function selectionPanel(sel) {
  if (sel.kind === "plate") {
    return [{
      title: "The plates",
      open: true,
      folders: [
        { title: "Position", sliders: [
          { path: "config.placement.plates.dx", label: "Move across", min: -300, max: 300, step: 1, unit: "mm" },
          { path: "config.placement.plates.dy", label: "Move down", min: -400, max: 400, step: 1, unit: "mm" },
        ] },
        { title: "Arrangement", fit: true, sliders: [
          ...(state.config.layout.fit_between_text
            ? [{ path: "config.layout.fit_clearance", label: "Spacing", min: 0, max: 120, step: 1, unit: "mm" }]
            : [{ path: "config.layout.radius", label: "Radius", min: 40, max: 300, step: 1, unit: "mm" },
               { path: "config.layout.top_offset", label: "Distance below the title", min: 0, max: 300, step: 1, unit: "mm" }]),
          { path: "config.layout.gap", label: "Gap between them", min: 0, max: 300, step: 1, unit: "mm" },
          { path: "config.layout.overlap_deg", label: "Reach past the equator", min: 0, max: 40, step: 0.5, unit: "°" },
          { path: "config.layout.ra_zero_deg", label: "Rotation", min: 0, max: 360, step: 1, unit: "°" },
          { path: "config.layout.hemi_label_deg", label: "Hemisphere label angle", min: -180, max: 180, step: 1, unit: "°" },
        ] },
        { title: "Features", layers: [
          "layer-plate", "layer-milkyway", "layer-grid", "layer-stars", "layer-star-halos",
          "layer-tropics", "layer-ecliptic", "layer-colures",
          "layer-constellation-labels", "layer-star-labels",
          "layer-rim", "layer-hemi-labels", "layer-sun", "layer-moon",
          "layer-moon-track", "layer-horizon",
        ] },
        { title: "Colours", colors: PLATE_COLOURS },
      ],
    }];
  }

  if (sel.kind === "panel") {
    const at = `config.placement.panels.${sel.name}`;
    const own = `panelStyles.${sel.name}`;
    return [{
      title: PANEL_LABELS[sel.name] ?? sel.name,
      open: true,
      folders: [
        { title: "Position & size", sliders: [
          { path: `${at}.x`, label: "Across the sheet", min: 0, max: 1200, step: 1, unit: "mm" },
          { path: `${at}.y`, label: "Down the sheet", min: 0, max: 1600, step: 1, unit: "mm" },
          { path: `${at}.w`, label: "Width", min: 30, max: 600, step: 1, unit: "mm" },
          { path: `${at}.h`, label: "Height", min: 20, max: 400, step: 1, unit: "mm" },
        ] },
        { title: "Show", diagram: sel.name },
        { title: "Heading", sliders: [
          { path: `${own}.title_size`, label: "Size", min: 1.5, max: 10, step: 0.1, unit: "mm" },
          { path: `${own}.title_tracking`, label: "Tracking", min: 0, max: 6, step: 0.05, unit: "mm" },
          { path: `${own}.title_gap`, label: "Gap above", min: 0, max: 16, step: 0.5, unit: "mm" },
          { path: `${own}.title_space`, label: "Gap below", min: 0, max: 20, step: 0.5, unit: "mm" },
        ], colors: [[`${own}.title_fill`, "Colour"]] },
        { title: "Rule above the heading", rule: sel.name, sliders: [
          { path: `${own}.rule_width`, label: "Weight", min: 0.1, max: 3, step: 0.05, unit: "mm" },
        ], colors: [[`${own}.rule_stroke`, "Colour"]] },
        { title: "Captions", sliders: [
          { path: `${own}.caption_size`, label: "Caption size", min: 1.2, max: 8, step: 0.1, unit: "mm" },
          { path: `${own}.tick_size`, label: "Small label size", min: 1.0, max: 6, step: 0.1, unit: "mm" },
        ] },
        { title: "Palette", colors: [
          [`${own}.ink`, "Ink"],
          [`${own}.sun`, "Sun"],
          [`${own}.earth`, "Earth"],
          [`${own}.moon`, "Moon, lit"],
          [`${own}.moon_dark`, "Moon, dark"],
          [`${own}.planet`, "Planets"],
          [`${own}.orbit`, "Orbits"],
          [`${own}.umbra`, "Shadow"],
          [`${own}.star_sample`, "Star samples"],
        ], sliders: [
          { path: `${own}.line_width`, label: "Line weight", min: 0.05, max: 2, step: 0.05, unit: "mm" },
          { path: `${own}.umbra_opacity`, label: "Shadow strength", min: 0, max: 1, step: 0.02, unit: "" },
        ] },
      ],
    }];
  }

  const at = `config.placement.texts.${sel.name}`;
  const isTitle = sel.name === "title";
  return [{
    title: isTitle ? "Title" : "Caption",
    open: true,
    folders: [
      { title: "Position", sliders: [
        { path: `${at}.x`, label: "Across the sheet", min: 0, max: 1200, step: 1, unit: "mm" },
        { path: `${at}.y`, label: "Down the sheet", min: 0, max: 1600, step: 1, unit: "mm" },
      ] },
      { title: "Type", sliders: isTitle ? [
        { path: "type.title_size", label: "Size", min: 6, max: 60, step: 0.5, unit: "mm" },
        { path: "type.title_tracking", label: "Tracking", min: 0, max: 18, step: 0.1, unit: "mm" },
      ] : [
        { path: "horizon.caption_size", label: "Size", min: 1.5, max: 12, step: 0.1, unit: "mm" },
      ], colors: isTitle ? [["type.title_fill", "Colour"]]
                         : [["horizon.caption_fill", "Colour"]] },
      { title: "Show", layers: [isTitle ? "layer-title" : "layer-caption"] },
    ],
  }];
}

/** Placement entries are created on demand, so a slider has something to bind
 *  to before the object has ever been dragged. */
function ensurePlacement(sel) {
  const p = state.config.placement ?? (state.config.placement = {});
  if (sel.kind === "plate") {
    p.plates = p.plates ?? { dx: 0, dy: 0 };
  } else if (sel.kind === "panel") {
    const entry = state.panelBoxes.find((b) => b.name === sel.name);
    p.panels = p.panels ?? {};
    if (entry) p.panels[sel.name] = p.panels[sel.name] ?? { ...entry.box };
    // Seeded from the shared defaults so every control has a value to bind to.
    // From here the diagram is styled on its own and no longer follows them.
    const styles = state.theme.panelStyles ?? (state.theme.panelStyles = {});
    styles[sel.name] = styles[sel.name] ?? { ...state.theme.panels };
  } else {
    const entry = state.textBoxes.find((b) => b.name === sel.name);
    p.texts = p.texts ?? {};
    if (entry) p.texts[sel.name] = p.texts[sel.name] ?? { x: entry.x, y: entry.y };
  }
}

function diagramRow(name) {
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
  wrap.appendChild(el("span", null, "Show this diagram"));
  return wrap;
}

/** A checkbox bound to a boolean anywhere in the config or theme. */
function togglePath(path, label) {
  const wrap = el("label", "check");
  const input = el("input");
  input.type = "checkbox";
  input.checked = Boolean(get(path));
  input.addEventListener("change", () => {
    if (isGeometry(path) && !path.startsWith("config.placement")) freezeDerived();
    set(path, input.checked);
    if (isGeometry(path)) rerender(); else restyle();
    buildControls();
  });
  wrap.appendChild(input);
  wrap.appendChild(el("span", "box"));
  wrap.appendChild(el("span", null, label));
  return wrap;
}

function ruleRow(name) {
  const path = `panelStyles.${name}.rule`;
  const wrap = el("label", "check");
  const input = el("input");
  input.type = "checkbox";
  input.checked = Boolean(get(path));
  input.addEventListener("change", () => {
    set(path, input.checked);
    rerender();
  });
  wrap.appendChild(input);
  wrap.appendChild(el("span", "box"));
  wrap.appendChild(el("span", null, "Draw the rule"));
  return wrap;
}

function buildControls() {
  const host = document.getElementById("controls");
  host.textContent = "";
  const labels = LAYER_LABELS();

  let groups = PANEL;
  if (state.selection) {
    ensurePlacement(state.selection);
    groups = selectionPanel(state.selection);
    const back = el("button", "btn back", "← All controls");
    back.addEventListener("click", () => select(null));
    host.appendChild(back);
  }

  for (const group of groups) {
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
      if (spec.fit) f.body.appendChild(togglePath(
        "config.layout.fit_between_text", "Fill the sheet between title and caption"));
      if (spec.panelsEnabled) f.body.appendChild(togglePath(
        "config.panels.enabled", "Show the diagrams"));
      if (spec.panels) panelRows().forEach((row) => f.body.appendChild(row));
      if (spec.diagram) f.body.appendChild(diagramRow(spec.diagram));
      if (spec.rule) f.body.appendChild(ruleRow(spec.rule));
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

/* ---------- printed size ----------
 *
 * A browser has no idea how large its pixels really are: CSS treats an inch as
 * 96 px whatever the display actually does, so on most hardware "1 inch" of CSS
 * is not an inch. The nominal value is the starting point and the ruler
 * calibrates it against a real one. Millimetres are the chart's own units, so
 * once the screen's true pixels-per-inch is known, scale is just a conversion.
 */

const NOMINAL_DPI = 96;
const dpi = () => state.dpi || NOMINAL_DPI;
const pxPerMm = () => dpi() / 25.4;

/** Storage is unavailable in some privacy modes, and throws rather than
 *  returning null, so every access is guarded. */
const remember = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* not fatal */ }
};
const recall = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};

function loadCalibration() {
  const saved = Number(recall("starchart.dpi"));
  state.dpi = Number.isFinite(saved) && saved > 20 ? saved : NOMINAL_DPI;
}

function actualSize() {
  const box = stage().getBoundingClientRect();
  const { w, h } = contentSize();
  state.view = {
    scale: pxPerMm(),
    tx: (box.width - w * pxPerMm()) / 2,
    ty: (box.height - h * pxPerMm()) / 2,
  };
  state.fitted = false;
  clamp(state.view);
  paint();
}

function paint() {
  const { scale, tx, ty } = state.view;
  wrap().style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  // Percentage of printed size, not of the fitted view: at 100% a millimetre on
  // screen is a millimetre on paper, which is the number that matters here.
  const percent = Math.round((scale / pxPerMm()) * 100);
  document.getElementById("zoom-level").textContent = `${percent}%`;
  document.getElementById("actual-size")?.classList.toggle("on", percent === 100);
}

function fit() {
  const box = stage().getBoundingClientRect();
  const { w, h } = contentSize();
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fitScale()));
  state.view = { scale, tx: (box.width - w * scale) / 2, ty: (box.height - h * scale) / 2 };
  state.fitted = true;
  paint();
}

/* ---------- layout handles ----------
 *
 * Outlines drawn over the chart while shift is held. They are also the hit
 * areas: the diagrams are mostly empty space, so a pointerdown between two
 * shapes inside one hits nothing and the drag falls through to a pan. Only the
 * first diagram appeared to work, because its Sun covers most of its box.
 *
 * Keeping them in an overlay the renderer knows nothing about means the
 * exported SVG stays clean, and the outline can travel with the drag.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

function handleBoxes() {
  const boxes = [];
  // One box around both plates: they are a single object, and their spacing is
  // the layout's business rather than something to nudge by hand.
  const plates = state.hemispheres ?? [];
  if (plates.length) {
    const band = state.theme.plate.scale_band ?? 0;
    const x0 = Math.min(...plates.map((h) => h.cx - h.radius - band));
    const x1 = Math.max(...plates.map((h) => h.cx + h.radius + band));
    const y0 = Math.min(...plates.map((h) => h.cy - h.radius - band));
    const y1 = Math.max(...plates.map((h) => h.cy + h.radius + band));
    boxes.push({ kind: "plate", name: "plates", label: "THE PLATES",
                 x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  for (const { name, box } of state.panelBoxes ?? []) {
    boxes.push({ kind: "panel", name, label: (PANEL_LABELS[name] ?? name).toUpperCase(), ...box });
  }
  for (const t of state.textBoxes ?? []) {
    // Text is anchored at its middle, so the box is estimated around it.
    const w = Math.max(60, (state.config.title?.length ?? 12) * t.size * 0.62);
    boxes.push({
      kind: "text", name: t.name, label: t.label,
      x: t.x - w / 2, y: t.y - t.size, w, h: t.size * 1.5,
    });
  }
  return boxes;
}

function drawHandles() {
  if (!state.svg) return;
  state.svg.querySelector("#layer-handles")?.remove();
  if (!state.editing) return;

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("id", "layer-handles");
  for (const box of handleBoxes()) {
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("data-handle", `${box.kind}:${box.name}`);
    const selected = state.selection &&
      state.selection.kind === box.kind && state.selection.name === box.name;
    group.setAttribute("class", selected ? "handle handle-selected" : "handle");

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", box.x.toFixed(2));
    rect.setAttribute("y", box.y.toFixed(2));
    rect.setAttribute("width", box.w.toFixed(2));
    rect.setAttribute("height", box.h.toFixed(2));
    rect.setAttribute("class", "handle-box");
    group.appendChild(rect);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", (box.x + 2.5).toFixed(2));
    label.setAttribute("y", (box.y + 5.5).toFixed(2));
    label.setAttribute("class", "handle-label");
    label.textContent = box.label;
    group.appendChild(label);

    // Sized in screen pixels rather than millimetres, so the grip stays the
    // same size to the hand at any zoom.
    const grip = 9 / (state.view.scale || 1);
    const knob = document.createElementNS(SVG_NS, "rect");
    knob.setAttribute("x", (box.x + box.w - grip / 2).toFixed(2));
    knob.setAttribute("y", (box.y + box.h - grip / 2).toFixed(2));
    knob.setAttribute("width", grip.toFixed(2));
    knob.setAttribute("height", grip.toFixed(2));
    knob.setAttribute("class", "handle-grip");
    knob.setAttribute("data-grip", `${box.kind}:${box.name}`);
    group.appendChild(knob);

    g.appendChild(group);
  }
  state.svg.appendChild(g);
}

function select(handle) {
  const same = state.selection && handle &&
    state.selection.kind === handle.kind && state.selection.name === handle.name;
  state.selection = handle ?? null;
  if (!same) buildControls();
  drawHandles();
}

/** Pin every object that is still following the computed arrangement.
 *
 * Without this, changing the plates -- moving them, scaling them, or touching a
 * layout slider -- drags the diagrams along with them, because the bands are
 * derived from where the lower plate ends. Once anything is arranged by hand,
 * everything holds still and only what is grabbed moves. Overlap is fine.
 */
function freezeDerived() {
  const p = state.config.placement ?? (state.config.placement = {});
  p.plates = p.plates ?? { dx: 0, dy: 0 };
  p.panels = p.panels ?? {};
  for (const { name, box } of state.panelBoxes ?? []) {
    p.panels[name] = p.panels[name] ?? { ...box };
  }
  p.texts = p.texts ?? {};
  for (const t of state.textBoxes ?? []) {
    p.texts[t.name] = p.texts[t.name] ?? { x: t.x, y: t.y };
  }
}

/** Scale an object about its top-left corner, then re-render from the config. */
function commitResize(handle, k, box) {
  if (!box || Math.abs(k - 1) < 1e-4) return;
  freezeDerived();
  const placement = state.config.placement;

  if (handle.kind === "plate") {
    const layout = state.config.layout;
    const hemi = state.hemispheres[0];
    // Sizing the plates by hand means taking over from the automatic fit --
    // otherwise the radius is derived and the drag would do nothing at all.
    if (layout.fit_between_text) {
      layout.fit_between_text = false;
      layout.radius = hemi.radius;
      layout.gap = state.hemispheres[1].cy - hemi.cy - 2 * hemi.radius;
      layout.top_offset = hemi.cy - hemi.radius - state.config.page.margin;
      const at = placement.plates ?? { dx: 0, dy: 0 };
      placement.plates = { dx: at.dx ?? 0, dy: at.dy ?? 0 };
    }
    // Radius and gap together, so the pair scales as one assembly. The top of
    // the bounding box does not depend on the radius, but its left edge does,
    // so only the horizontal offset needs correcting to hold the corner still.
    const before = layout.radius;
    layout.radius = Math.max(20, before * k);
    layout.gap = Math.max(0, layout.gap * k);
    const at = placement.plates ?? { dx: 0, dy: 0 };
    placement.plates = { dx: (at.dx ?? 0) + (layout.radius - before), dy: at.dy ?? 0 };
  } else if (handle.kind === "panel") {
    const entry = state.panelBoxes.find((b) => b.name === handle.name);
    if (!entry) return;
    placement.panels = placement.panels ?? {};
    placement.panels[handle.name] = {
      ...entry.box, w: Math.max(20, entry.box.w * k), h: Math.max(12, entry.box.h * k),
    };
  } else {
    // Text has no box of its own -- scaling it means scaling the type.
    const path = handle.name === "title" ? "type.title_size" : "horizon.caption_size";
    set(path, Math.max(1.5, get(path) * k));
    if (handle.name === "title") {
      set("type.title_tracking", Math.max(0, get("type.title_tracking") * k));
    }
  }
  buildControls();
  rerender();
}

/** Write a finished drag into the config, then re-render from it. */
function commitMove(handle, dx, dy) {
  freezeDerived();
  const placement = state.config.placement;
  if (handle.kind === "plate") {
    // An offset rather than absolute centres, so the layout sliders keep
    // working underneath: change the radius and the pair stays where you put it.
    const at = placement.plates ?? { dx: 0, dy: 0 };
    placement.plates = { dx: (at.dx ?? 0) + dx, dy: (at.dy ?? 0) + dy };
  } else if (handle.kind === "panel") {
    const entry = state.panelBoxes.find((b) => b.name === handle.name);
    if (!entry) return;
    placement.panels = placement.panels ?? {};
    placement.panels[handle.name] = {
      ...entry.box, x: entry.box.x + dx, y: entry.box.y + dy,
    };
  } else {
    const entry = state.textBoxes.find((b) => b.name === handle.name);
    if (!entry) return;
    placement.texts = placement.texts ?? {};
    placement.texts[handle.name] = { x: entry.x + dx, y: entry.y + dy };
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

  /* Which object a click lands on is decided geometrically rather than by what
   * the browser happens to hit. Relying on hit-testing means the topmost shape
   * wins, and "topmost" is just paint order -- the text handles are drawn last,
   * so they would beat a diagram they happen to sit over regardless of size.
   * Smallest-box-wins is what makes overlapping objects reachable: the big
   * thing underneath is still clickable everywhere the small one is not. */
  const chartPoint = (clientX, clientY) => {
    const box = el.getBoundingClientRect();
    return [
      (clientX - box.left - state.view.tx) / state.view.scale,
      (clientY - box.top - state.view.ty) / state.view.scale,
    ];
  };

  const handleFor = (target, clientX, clientY) => {
    const [x, y] = chartPoint(clientX, clientY);
    const hits = handleBoxes().filter(
      (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (!hits.length) return null;
    hits.sort((a, b) => a.w * a.h - b.w * b.h);
    return { kind: hits[0].kind, name: hits[0].name };
  };

  const piecesFor = (handle) => {
    const selector = handle.kind === "plate"
      ? `[data-plate]`
      : `[data-drag="${handle.kind}:${handle.name}"]`;
    return [
      ...state.svg.querySelectorAll(selector),
      // The outline travels with what it outlines.
      ...state.svg.querySelectorAll(`[data-handle="${handle.kind}:${handle.name}"]`),
    ];
  };

  const gripFor = (target) => {
    const knob = target.closest?.("[data-grip]");
    if (!knob) return null;
    const [kind, name] = knob.dataset.grip.split(":");
    return { kind, name };
  };

  el.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    // Layout editing is deliberately modal. Without it, every drag near a plate
    // is a coin toss between moving the poster and moving the view, and the
    // grabbable regions are invisible.
    const grip = event.shiftKey ? gripFor(event.target) : null;
    const handle = grip ??
      (event.shiftKey ? handleFor(event.target, event.clientX, event.clientY) : null);
    // Shift-clicking selects, whether or not a drag follows.
    if (event.shiftKey) select(handle);
    pointer = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      dx: 0, dy: 0, handle, resizing: Boolean(grip),
      box: handle ? handleBoxes().find(
        (b) => b.kind === handle.kind && b.name === handle.name) : null,
      pieces: handle ? piecesFor(handle) : [],
    };
    el.setPointerCapture(event.pointerId);
    el.classList.add(grip ? "resizing" : handle ? "moving" : "dragging");
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
    if (pointer.resizing) {
      // Aspect is locked, so one factor from both axes. Anchored at the box's
      // top-left, which is the corner opposite the grip.
      const b = pointer.box;
      const k = Math.max(0.2, 1 + (pointer.dx / b.w + pointer.dy / b.h) / 2);
      pointer.scale = k;
      const t = `translate(${b.x.toFixed(3)} ${b.y.toFixed(3)}) scale(${k.toFixed(4)}) ` +
                `translate(${(-b.x).toFixed(3)} ${(-b.y).toFixed(3)})`;
      for (const piece of pointer.pieces) piece.setAttribute("transform", t);
      return;
    }
    const shift = `translate(${pointer.dx.toFixed(3)} ${pointer.dy.toFixed(3)})`;
    for (const piece of pointer.pieces) piece.setAttribute("transform", shift);
  });

  const release = (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const { handle, dx, dy, resizing, scale, box } = pointer;
    pointer = null;
    el.classList.remove("dragging", "moving");
    if (!handle || (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01)) return;
    if (resizing) commitResize(handle, scale ?? 1, box);
    else commitMove(handle, dx, dy);
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);

  el.addEventListener("dblclick", fit);

  document.getElementById("actual-size").addEventListener("click", actualSize);

  /* Calibration: draw a bar of a known length at the currently assumed scale,
   * ask how long it really is, and scale the assumption by the ratio.
   *
   * The bar is as long as the window allows rather than a fixed 100 mm. The
   * error in reading a ruler is roughly constant -- half a millimetre or so,
   * however carefully anyone squints -- so the longer the bar, the smaller that
   * error is as a fraction, and the fraction is what the calibration inherits.
   */
  const TO_MM = { mm: 1, cm: 10, in: 25.4 };
  const panel = document.getElementById("ruler");
  const bar = document.getElementById("ruler-bar");
  const input = document.getElementById("ruler-mm");
  const unit = document.getElementById("ruler-unit");
  const nominalLabel = document.getElementById("ruler-nominal");

  /** A round number of millimetres that fits across the panel. */
  const referenceMm = () => {
    const available = (panel.clientWidth || stage().clientWidth || 800) - 48;
    return Math.max(50, Math.floor(available / pxPerMm() / 50) * 50);
  };

  const showNominal = () => {
    const mm = referenceMm();
    input.dataset.nominal = String(mm);
    bar.style.width = `${mm * pxPerMm()}px`;
    nominalLabel.textContent =
      `${mm} mm  ·  ${(mm / 10).toFixed(1)} cm  ·  ${(mm / 25.4).toFixed(2)} inches`;
    const u = unit.value;
    input.value = (mm / TO_MM[u]).toFixed(u === "mm" ? 1 : 2);
    input.step = u === "mm" ? 0.5 : u === "cm" ? 0.05 : 0.02;
  };

  const showRuler = (on) => {
    panel.hidden = !on;
    document.getElementById("calibrate").classList.toggle("on", on);
    if (on) {
      showNominal();
      input.focus();
      input.select?.();
    }
  };
  unit.addEventListener("change", showNominal);
  document.getElementById("calibrate")
    .addEventListener("click", () => showRuler(panel.hidden));
  document.getElementById("ruler-done").addEventListener("click", () => {
    const nominal = Number(input.dataset.nominal);
    const measured = Number(input.value) * TO_MM[unit.value];
    if (measured > 10 && nominal > 10) {
      state.dpi = dpi() * (nominal / measured);
      remember("starchart.dpi", String(state.dpi));
    }
    showRuler(false);
    actualSize();
  });

  /* Shift reveals the boxes and arms the drag. Tracked on the window so the
   * outlines appear wherever the pointer happens to be. */
  const setEditing = (on) => {
    if (state.editing === on) return;
    state.editing = on;
    el.classList.toggle("editing", on);
    drawHandles();
  };
  window.addEventListener("keydown", (e) => { if (e.key === "Shift") setEditing(true); });
  window.addEventListener("keyup", (e) => { if (e.key === "Shift") setEditing(false); });
  window.addEventListener("blur", () => setEditing(false));
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
    rows: (loaded.config.panels?.rows ?? []).map((r) => [...r]),
  };
  // Kept pristine so "Reset layout" can restore the numbers, not just clear the
  // drags -- moving a slider is a layout change too.
  state.baseConfig = structuredClone(loaded.config);
  state.ui.labelBucket = loaded.theme.labels.mag_bucket;
  if (state.observer) state.ui.minutes = state.observer.minutes;

  loadCalibration();
  rerender();
  updateDims();

  buildControls();
  initViewport();
  fit();
}

document.getElementById("download").addEventListener("click", download);
document.getElementById("reset-layout")?.addEventListener("click", () => {
  // Both kinds of layout change: the numbers and anything dragged.
  state.config = structuredClone(state.baseConfig);
  state.panelsOff.clear();
  buildControls();
  rerender();
});
document.getElementById("reset").addEventListener("click", () => {
  state.config = structuredClone(state.baseConfig);
  state.panelsOff.clear();
  state.ui = {
    starScale: 1, mwScale: 1, magLimit: 5,
    labelBucket: state.theme.labels.mag_bucket,
    minutes: state.observer ? state.observer.minutes : 720,
    hidden: new Set(),
  };
  applyPreset("Original");
  rerender();
});
boot();
