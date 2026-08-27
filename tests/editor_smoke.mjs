/* Headless smoke test for the editor.  Run:  node tests/editor_smoke.mjs
 *
 * Needs jsdom on the module path (npm i jsdom). Exercised from pytest by
 * test_editor_smoke, which skips when jsdom is not installed.
 *
 * The editor is a real ES module that imports the starchart library, so this
 * sets up browser globals and then imports it exactly as a page would --
 * meaning the test drives the shipped code path, not a copy of it.
 */

import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";

// Read from the same modules the page does, so adding a diagram or retuning
// the rim band does not fail a hand-copied number here.
import { defaultConfig } from "../web/starchart/index.js";
import portolan from "../web/starchart/themes/portolan.js";

const DIAGRAMS = defaultConfig.panels.order;
// The plates, the title and the caption are draggable alongside the diagrams.
const MOVABLE = DIAGRAMS.length + 3;

const REPO = path.resolve(new URL("..", import.meta.url).pathname);
const WEB = path.join(REPO, "web");

const dom = new JSDOM(fs.readFileSync(path.join(WEB, "index.html"), "utf8"), {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const { window } = dom;

// The real stylesheet, inlined. Without it getComputedStyle sees nothing, and a
// panel that never hides because a class rule outranks [hidden] looks perfectly
// fine to a test that only reads the `hidden` property.
{
  const style = window.document.createElement("style");
  style.textContent = fs.readFileSync(path.join(WEB, "style.css"), "utf8");
  window.document.head.appendChild(style);
}

// jsdom does no layout, so every box is 0x0 and the pan/zoom maths degenerates.
const STAGE = { x: 320, y: 40, width: 900, height: 700 };
window.Element.prototype.getBoundingClientRect = function () {
  if (this.id === "stage-scroll") {
    return { ...STAGE, left: STAGE.x, top: STAGE.y,
             right: STAGE.x + STAGE.width, bottom: STAGE.y + STAGE.height };
  }
  return { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
};
window.Element.prototype.setPointerCapture ||= function () {};
// jsdom has no PointerEvent; a MouseEvent carrying pointerId is close enough
// for the drag handlers, which only read the id and the coordinates.
if (typeof window.PointerEvent !== "function") {
  window.PointerEvent = class extends window.MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  };
}
window.Element.prototype.releasePointerCapture ||= function () {};

// Publish the browser globals the module expects, then serve its data from disk.
for (const key of ["window", "document", "Element", "Event", "WheelEvent",
                   "PointerEvent", "MouseEvent", "Blob", "Node", "SVGElement",
                   "localStorage", "KeyboardEvent"]) {
  globalThis[key] = window[key];
}
globalThis.URL.createObjectURL ||= () => "blob:test";
globalThis.URL.revokeObjectURL ||= () => {};
globalThis.fetch = async (url) => {
  const file = path.join(WEB, String(url).replace(/^\.\//, ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404 };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
};

const errors = [];
window.addEventListener("error", (e) => errors.push(e.message));

await import(path.join(WEB, "app.js"));
// boot() is async; give the data load and first render a turn to finish.
for (let i = 0; i < 50 && !window.document.querySelector("#chart-wrap svg"); i++) {
  await new Promise((r) => setTimeout(r, 20));
}

const d = window.document;
let failed = false;
const fail = (m) => { console.log("FAIL:", m); failed = true; };
const ok = (m) => console.log("  ok  ", m);

/* ---------- helpers ----------
 * All of them here rather than beside their first use: three separate runs of
 * this file failed on temporal-dead-zone errors as blocks got reordered, which
 * is a test breaking for its own reasons rather than the code's.
 */

const chart = () => d.querySelector("#chart-wrap svg");
const stage = d.querySelector("#stage-scroll");
const shift = (type) => window.dispatchEvent(new window.KeyboardEvent(type, { key: "Shift" }));

const view = () => {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/
    .exec(d.querySelector("#chart-wrap").style.transform);
  return m ? { tx: +m[1], ty: +m[2], scale: +m[3] } : null;
};

const wheel = (opts) => stage.dispatchEvent(new window.WheelEvent("wheel",
  { clientX: 700, clientY: 300, bubbles: true, cancelable: true, ...opts }));

const drag = (target, from, to, id = 1, shiftKey = true) => {
  target.dispatchEvent(new window.PointerEvent("pointerdown",
    { button: 0, pointerId: id, clientX: from[0], clientY: from[1], bubbles: true, shiftKey }));
  stage.dispatchEvent(new window.PointerEvent("pointermove",
    { pointerId: id, clientX: to[0], clientY: to[1], bubbles: true }));
  stage.dispatchEvent(new window.PointerEvent("pointerup", { pointerId: id, bubbles: true }));
};

const handleFor = (spec) => chart().querySelector(`[data-handle="${spec}"]`);

const toClient = (x, y) => {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/
    .exec(d.querySelector("#chart-wrap").style.transform);
  const [tx, ty, k] = [+m[1], +m[2], +m[3]];
  return [x * k + tx + STAGE.x, y * k + ty + STAGE.y];
};

const boxOf = (spec) => {
  const r = chart().querySelector(`[data-handle="${spec}"] rect`);
  return { x: +r.getAttribute("x"), y: +r.getAttribute("y"),
           w: +r.getAttribute("width"), h: +r.getAttribute("height") };
};

/** A point inside an object that no smaller object covers.
 *
 * Selection goes to the smallest box containing the point, so with the
 * diagrams switched on and overlapping the plates, an arbitrary point inside
 * the plates may well belong to a diagram instead. */
const insideOf = (spec) => {
  const b = boxOf(spec);
  const area = b.w * b.h;
  const others = [...chart().querySelectorAll("[data-handle] rect")]
    .map((r) => ({ x: +r.getAttribute("x"), y: +r.getAttribute("y"),
                   w: +r.getAttribute("width"), h: +r.getAttribute("height") }))
    .filter((o) => o.w * o.h < area);
  const covered = (x, y) =>
    others.some((o) => x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h);

  for (let fy = 0.15; fy < 1; fy += 0.1) {
    for (let fx = 0.15; fx < 1; fx += 0.1) {
      const x = b.x + b.w * fx;
      const y = b.y + b.h * fy;
      // Stay off the resize grip in the far corner.
      if (fx > 0.9 && fy > 0.9) continue;
      if (!covered(x, y)) return toClient(x, y);
    }
  }
  return toClient(b.x + b.w * 0.4, b.y + b.h * 0.4);
};

const gripAt = (spec) => {
  const b = boxOf(spec);
  return toClient(b.x + b.w, b.y + b.h);
};

const nudge = ([x, y], dx, dy) => [x + dx, y + dy];

const gripFor = (spec) => chart().querySelector(`[data-grip="${spec}"]`);

const checkbox = (label) => [...d.querySelectorAll(".check")]
  .find((c) => c.textContent.trim() === label)?.querySelector("input");

const setChecked = (label, on) => {
  const input = checkbox(label);
  if (input && input.checked !== on) {
    input.checked = on;
    input.dispatchEvent(new window.Event("change"));
  }
};

const resetLayout = () => {
  // The master switch lives in the global panel, so deselect before looking
  // for it -- a selection narrows the sidebar to that object alone.
  d.querySelector(".btn.back")?.click();
  d.querySelector("#reset-layout").click();
  setChecked("Show the diagrams", true);
  // Rebuilding the controls can drop the handle overlay, and every block that
  // follows a reset needs it back.
  shift("keydown");
};


chart() ? ok("chart rendered in the browser from the library") : fail("no chart rendered");

// --- panel structure
const sections = d.querySelectorAll(".section");
const folders = d.querySelectorAll(".folder");
sections.length >= 4 && folders.length >= 8
  ? ok(`${sections.length} sections, ${folders.length} folders`)
  : fail(`panel too flat: ${sections.length} sections, ${folders.length} folders`);

[...folders].every((f) => f.querySelector(".folder-body").children.length > 0)
  ? ok("no empty folders") : fail("a folder rendered with no controls");

// Every layer group in the document must be reachable as a toggle. Adding a
// layer to the renderer and forgetting to file it in the panel would otherwise
// leave it silently uncontrollable.
const layerIds = [...chart().querySelectorAll('g[id^="layer-"]')]
  .map((g) => g.id).filter((id) => id !== "layer-caption");
const toggled = new Set([...d.querySelectorAll("[data-layer]")].map((i) => i.dataset.layer));
const orphans = layerIds.filter((id) => !toggled.has(id));
orphans.length === 0
  ? ok(`all ${layerIds.length} layers have a toggle`)
  : fail(`layers with no toggle: ${orphans.join(", ")}`);

const swatches = d.querySelectorAll("input.swatch");
const sliders = d.querySelectorAll('input[type="range"]');
swatches.length >= 20 ? ok(`${swatches.length} colour pickers`) : fail(`swatches=${swatches.length}`);
sliders.length >= 15 ? ok(`${sliders.length} sliders`) : fail(`sliders=${sliders.length}`);

// --- the diagrams start switched off, and can be switched back on
const diagramsToggle = [...d.querySelectorAll(".check")]
  .find((c) => c.textContent.trim() === "Show the diagrams")?.querySelector("input");
diagramsToggle ? ok("the diagrams have a master switch") : fail("no diagrams switch");
chart().querySelectorAll('g[id^="panel-"]:not([id^="panel-clip"])').length === 0
  ? ok("they start off, since the plates fill the sheet") : fail("diagrams drawn by default");
// Switching them on must not move the canvas. The stage is overflow:hidden
// with the chart positioned by a transform, so a stray scrollTop -- which is
// what scroll anchoring produces when content changes -- leaves the canvas
// jammed off-screen with no scrollbar to recover it.
{
  const before = d.querySelector("#chart-wrap").style.transform;
  stage.scrollTop = 120;                       // as a browser might
  diagramsToggle.checked = true;
  diagramsToggle.dispatchEvent(new window.Event("change"));
  d.querySelector("#chart-wrap").style.transform === before
    ? ok("switching the diagrams on leaves the view alone")
    : fail("the view moved");
  stage.scrollTop === 0
    ? ok("a stray scroll on the stage is undone") : fail(`stage scrollTop ${stage.scrollTop}`);
}

// --- restyling happens in place, without re-rendering
const styleText = () => chart().querySelector("style").textContent;
const before = styleText();
const plate = [...swatches].find((s) => s.dataset.path === "plate.fill");
plate.value = "#ff0000";
plate.dispatchEvent(new window.Event("input"));
styleText().includes(".plate-bg{fill:#ff0000}")
  ? ok("colour change rewrites the stylesheet") : fail("colour change did not apply");
styleText() !== before ? ok("stylesheet mutated in place") : fail("stylesheet unchanged");

// --- sheets and palettes are two different things, which is the whole point
const chip = (label) => [...d.querySelectorAll(".preset")]
  .find((b) => b.textContent.trim() === label);
const handPaths = () => chart().querySelectorAll('[class~="hand"]').length;

const handBefore = handPaths();
handBefore > 0 ? ok(`the drawn sheet emits ${handBefore} hand-drawn paths`)
               : fail("nothing is drawn by hand");
chip("Blueprint").click();
styleText().includes("#0d3765") ? ok("a palette repaints") : fail("palette did not apply");
handPaths() === handBefore
  ? ok("a palette leaves the drawing alone") : fail("a palette changed the drawing");

chip("Cavallini").click();
handPaths() === 0 ? ok("the ruled sheet turns the hand off") : fail("hand survived the sheet");
chip("Portolan").click();
handPaths() > 0 ? ok("the drawn sheet turns it back on") : fail("hand did not return");

// Palettes can be saved and removed again.
const savedBefore = d.querySelectorAll(".preset.mine").length;
window.prompt = () => "My colours";
[...d.querySelectorAll(".btn")]
  .find((b) => b.textContent.includes("Save these colours")).click();
d.querySelectorAll(".preset.mine").length === savedBefore + 1
  ? ok("colours can be saved as a palette") : fail("save did nothing");
[...d.querySelectorAll(".preset.mine")]
  .find((b) => b.textContent.includes("My colours"))
  .dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
d.querySelectorAll(".preset.mine").length === savedBefore
  ? ok("and removed again") : fail("delete did nothing");
localStorage.removeItem("starchart.palettes");

// --- feature toggle
const checks = [...d.querySelectorAll(".check input")];
const mwToggle = checks.find((c) => c.parentElement.textContent.includes("Milky Way") &&
                                    !c.parentElement.textContent.includes("monthly"));
mwToggle.checked = false;
mwToggle.dispatchEvent(new window.Event("change"));
chart().querySelector("#layer-milkyway").style.display === "none"
  ? ok("feature toggle hides its layer") : fail("layer not hidden");
mwToggle.checked = true;
mwToggle.dispatchEvent(new window.Event("change"));

// --- magnitude and label thresholds are CSS only
// The magnitude control drops the classes from the drawing rather than hiding
// them with CSS: a star that is not going to be printed should not be in the
// file either.
const magSlider = [...sliders].find((s) => s.dataset.path === "config.stars.faintest_class");
magSlider ? ok("the magnitude control is present") : fail("no magnitude slider");
const drawn = (k) => chart().querySelectorAll(`.mag-${k}`).length;
drawn(5) === 0 ? ok("class 5 is not drawn by default") : fail(`${drawn(5)} faint stars drawn`);
drawn(4) > 100 ? ok(`${drawn(4)} class-4 stars drawn`) : fail("class 4 missing");
magSlider.value = "2";
magSlider.dispatchEvent(new window.Event("input"));
drawn(3) === 0 && drawn(2) > 0
  ? ok("lowering it drops the fainter classes from the drawing")
  : fail(`class 3 count ${drawn(3)}, class 2 count ${drawn(2)}`);
magSlider.value = "4";
magSlider.dispatchEvent(new window.Event("input"));

const labelSlider = [...sliders].find((s) => s.dataset.path === "ui.labelBucket");
const visibleNames = () => {
  const hidden = new Set([...styleText().matchAll(/\.(lbl-b\d+)\{display:none\}/g)]
    .map((m) => m[1]));
  return [...chart().querySelectorAll(".star-label")]
    .filter((n) => ![...n.classList].some((c) => hidden.has(c))).length;
};
const namesAtDefault = visibleNames();
namesAtDefault > 50 ? ok(`${namesAtDefault} star names placed`) : fail(`only ${namesAtDefault} names`);
labelSlider.value = "4";
labelSlider.dispatchEvent(new window.Event("input"));
const trimmed = visibleNames();
trimmed < namesAtDefault ? ok(`label threshold trims names (${namesAtDefault} to ${trimmed})`)
                         : fail("label threshold did nothing");
labelSlider.value = "17";
labelSlider.dispatchEvent(new window.Event("input"));

["layer-tropics", "layer-ecliptic", "layer-colures"].every((id) => chart().querySelector("#" + id))
  ? ok("tropics, ecliptic and colures are separate layers") : fail("reference layers missing");

// --- layout controls change geometry, not just style
const fitToggle = [...d.querySelectorAll(".check")]
  .find((c) => c.textContent.includes("Fill the sheet"))?.querySelector("input");
fitToggle ? ok("the fill-the-sheet mode has a toggle") : fail("no fit toggle");
fitToggle.checked = false;
fitToggle.dispatchEvent(new window.Event("change"));
const radius = [...d.querySelectorAll('input[type="range"]')]
  .find((s) => s.dataset.path === "config.layout.radius");
radius ? ok("switching the fit off exposes the radius slider") : fail("no radius slider");
const plateRadius = () => chart().querySelector("#layer-plate circle").getAttribute("r");
const r0 = plateRadius();
radius.value = "120";
radius.dispatchEvent(new window.Event("input"));
plateRadius() !== r0 ? ok(`circle radius is editable (${r0} to ${plateRadius()})`)
                     : fail("radius did nothing");
radius.value = String(r0);
radius.dispatchEvent(new window.Event("input"));

// --- diagrams
const panelIds = () => [...chart().querySelectorAll('g[id^="panel-"]')]
  .map((g) => g.id).filter((id) => !id.startsWith("panel-clip"));
const allPanels = panelIds();
allPanels.length === DIAGRAMS.length
  ? ok(`${allPanels.length} diagrams drawn`) : fail(`${allPanels.length} diagrams`);

const diagramToggle = [...d.querySelectorAll(".check")]
  .find((c) => c.textContent.trim() === "Eclipse of the Sun");
diagramToggle ? ok("per-diagram toggles present") : fail("no diagram toggles");
const input = diagramToggle.querySelector("input");
input.checked = false;
input.dispatchEvent(new window.Event("change"));
panelIds().length === allPanels.length - 1
  ? ok("switching a diagram off re-renders the band") : fail("diagram not removed");
input.checked = true;
input.dispatchEvent(new window.Event("change"));

// --- the plates fill the column between the title and the caption
{
  // Set up rather than inherit: an earlier check switches the fit off.
  const toggle = [...d.querySelectorAll(".check")]
    .find((c) => c.textContent.includes("Fill the sheet")).querySelector("input");
  if (!toggle.checked) { toggle.checked = true; toggle.dispatchEvent(new window.Event("change")); }
  setChecked("Show the diagrams", true);

  const band = portolan.plate.scale_band;
  const circles = [...chart().querySelectorAll("#layer-plate circle")]
    .map((c) => ({ cy: +c.getAttribute("cy"), r: +c.getAttribute("r"),
                   cx: +c.getAttribute("cx") }));
  const titleY = +chart().querySelector("#layer-title text").getAttribute("y");
  const capY = +chart().querySelector("#layer-caption text").getAttribute("y");
  const top = circles[0].cy - circles[0].r - band;
  const bottom = circles[1].cy + circles[1].r + band;
  const between = (circles[1].cy - circles[1].r - band) - (circles[0].cy + circles[0].r + band);
  const above = top - titleY, below = capY - bottom;
  Math.abs(above - below) < 0.01
    ? ok(`equal clearance above and below (${above.toFixed(1)} mm)`)
    : fail(`uneven: ${above.toFixed(1)} vs ${below.toFixed(1)}`);
  Math.abs(between) < 0.01
    ? ok("the two plates touch") : fail(`gap of ${between.toFixed(1)} mm between them`);
  Math.abs(circles[0].cx - 609.6 / 2) < 0.01 && Math.abs(circles[1].cx - 609.6 / 2) < 0.01
    ? ok("the plates are centred on the sheet") : fail("plates off centre");
  // The size itself is pinned by the three spacing checks above -- equal
  // clearance top and bottom, touching in the middle, fully determines it. This
  // only guards against a degenerate collapse, so it must not carry a number
  // tied to one sheet size.
  const spanned = (circles[1].cy + circles[1].r + band) - (circles[0].cy - circles[0].r - band);
  Math.abs(spanned - (capY - titleY - 2 * above)) < 0.01
    ? ok(`the plates fill the column (r ${circles[0].r.toFixed(1)} mm on this sheet)`)
    : fail(`spanned ${spanned.toFixed(1)} of ${(capY - titleY - 2 * above).toFixed(1)} mm`);
}

// --- the time slider re-renders the geometry
const timeSlider = [...sliders].find((s) => s.closest(".section")
  .querySelector("summary").textContent === "The moment");
timeSlider ? ok("time slider present") : fail("no time slider");

const horizonD = () => [...chart().querySelectorAll("#layer-horizon path")]
  .map((p) => p.getAttribute("d")).join("|");
const markerAt = (kind) => {
  const m = chart().querySelector(`#marker-${kind}-south`);
  return m ? m.getAttribute("transform") : null;
};

const h0 = horizonD();
const sun0 = markerAt("sun");
const moon0 = markerAt("moon");
h0.length > 100 ? ok("horizon drawn for the configured observer") : fail("no horizon path");
sun0 && moon0 ? ok("Sun and Moon drawn") : fail("bodies missing");

const t0 = Date.now();
timeSlider.value = String((parseInt(timeSlider.value, 10) + 360) % 1440);
timeSlider.dispatchEvent(new window.Event("input"));
const elapsed = Date.now() - t0;

horizonD() !== h0 ? ok(`moving the time re-renders the horizon (${elapsed} ms)`)
                  : fail("horizon did not move");
markerAt("moon") !== moon0 ? ok("Moon moves with the time") : fail("Moon did not move");
markerAt("sun") !== sun0 ? ok("Sun moves with the time") : fail("Sun did not move");
/[0-9]/.test(chart().querySelector("#layer-caption text").textContent)
  ? ok("caption follows the time") : fail("caption not updated");

// --- pan and zoom

const fitted = view();
fitted ? ok(`fits at ${fitted.scale.toFixed(3)}×`) : fail("no transform applied");

wheel({ deltaY: -100, ctrlKey: true });
view().scale > fitted.scale ? ok("pinch zooms in") : fail("pinch did not zoom");

const localX = 700 - STAGE.x;
const anchorBefore = (localX - view().tx) / view().scale;
wheel({ deltaY: -240, ctrlKey: true });
Math.abs((localX - view().tx) / view().scale - anchorBefore) < 0.5
  ? ok("zoom stays anchored under the cursor") : fail("anchor drifted");

const beforePan = view();
wheel({ deltaY: 60, deltaX: 40 });
const panned = view();
(panned.ty < beforePan.ty && panned.tx < beforePan.tx && panned.scale === beforePan.scale)
  ? ok("two-finger scroll pans without zooming") : fail("scroll did not pan");

const dragFrom = view();
stage.dispatchEvent(new window.PointerEvent("pointerdown",
  { button: 0, pointerId: 1, clientX: 500, clientY: 300, bubbles: true }));
stage.dispatchEvent(new window.PointerEvent("pointermove",
  { pointerId: 1, clientX: 560, clientY: 340, bubbles: true }));
const dragged = view();
(Math.abs(dragged.tx - dragFrom.tx - 60) < 0.001 && Math.abs(dragged.ty - dragFrom.ty - 40) < 0.001)
  ? ok("dragging the paper pans one-to-one") : fail("drag pan wrong");
stage.dispatchEvent(new window.PointerEvent("pointerup", { pointerId: 1, bubbles: true }));

stage.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
Math.abs(view().scale - fitted.scale) < 1e-6 ? ok("double-click refits") : fail("no refit");

// --- moving a plate and a diagram
const plateCx = () => Number(chart().querySelector("#layer-plate circle").getAttribute("cx"));
const plateRadiusNow = () => chart().querySelector("#layer-plate circle").getAttribute("r");
const panelX = () => Number(
  chart().querySelector('[data-drag="panel:solar-eclipse"] rect')?.getAttribute("x") ?? NaN);

// --- layout editing is modal: nothing moves unless shift is held
setChecked("Show the diagrams", true);
shift("keydown");
chart().querySelector("#layer-handles")
  ? ok("shift shows the layout handles") : fail("no handles on shift");
const handleCount = chart().querySelectorAll(".handle-box").length;
handleCount === MOVABLE
  ? ok(`${handleCount} handles (the plates + ${DIAGRAMS.length} diagrams + title + caption)`)
  : fail(`${handleCount} handles`);
shift("keyup");
!chart().querySelector("#layer-handles")
  ? ok("releasing shift hides them") : fail("handles stuck on");


// Every diagram must be grabbable, not just the one whose artwork happens to
// cover its box. The handle is the hit area precisely because the diagrams are
// mostly empty space.
shift("keydown");
const grabbable = DIAGRAMS.filter((n) => handleFor(`panel:${n}`));
grabbable.length === DIAGRAMS.length
  ? ok(`all ${DIAGRAMS.length} diagrams have a hit area`)
  : fail(`only ${grabbable.length} of ${DIAGRAMS.length} diagrams grabbable`);

// Both plates are one object: a single handle, and a drag moves the pair
// without changing their spacing.
const plateCentres = () => [...chart().querySelectorAll("#layer-plate circle")]
  .map((c) => [Number(c.getAttribute("cx")), Number(c.getAttribute("cy"))]);
const spacing = (cs) => Math.hypot(cs[1][0] - cs[0][0], cs[1][1] - cs[0][1]);

chart().querySelectorAll('[data-handle^="plate:"]').length === 1
  ? ok("the plates share one handle") : fail("plates still separate");
const platePieces = chart().querySelectorAll("[data-plate]").length;
platePieces > 10 ? ok(`the plates span ${platePieces} layer groups`)
                 : fail("plates not tagged across layers");

const centresBefore = plateCentres();
const plateBefore = centresBefore[0][0];
const platePoint = insideOf("plate:plates");
drag(handleFor("plate:plates"), platePoint, nudge(platePoint, 60, 40), 2, false);
Math.abs(plateCentres()[0][0] - plateBefore) < 0.001
  ? ok("without shift, dragging pans instead of moving")
  : fail("plates moved without shift");

// Recomputed: the pan above moved the view, so the earlier client coordinates
// no longer point at the same place on the chart.
const platePoint2 = insideOf("plate:plates");
drag(handleFor("plate:plates"), platePoint2, nudge(platePoint2, 60, 40), 2);
const centresAfter = plateCentres();
Math.abs(centresAfter[0][0] - plateBefore) > 1
  ? ok(`dragging moves the plates (cx ${plateBefore} to ${centresAfter[0][0]})`)
  : fail("plates did not move");
Math.abs(spacing(centresAfter) - spacing(centresBefore)) < 0.001
  ? ok("both plates move together, spacing unchanged")
  : fail(`spacing changed: ${spacing(centresBefore)} to ${spacing(centresAfter)}`);

// Every diagram, not just the first.
let moved = 0;
for (const name of grabbable) {
  const before = Number(
    chart().querySelector(`[data-handle="panel:${name}"] rect`).getAttribute("x"));
  const at = insideOf(`panel:${name}`);
  drag(handleFor(`panel:${name}`), at, nudge(at, 30, 20), 4);
  const after = Number(
    chart().querySelector(`[data-handle="panel:${name}"] rect`).getAttribute("x"));
  if (Math.abs(after - before) > 1) moved++;
}
moved === DIAGRAMS.length ? ok("every diagram can be dragged")
  : fail(`only ${moved} of ${DIAGRAMS.length} diagrams moved`);

// The outline travels with what it outlines.
const outlineX = () => Number(
  chart().querySelector('[data-handle="panel:solar-system"] rect').getAttribute("x"));
const beforeOutline = outlineX();
const target = handleFor("panel:solar-system");
const solarPoint = insideOf("panel:solar-system");
target.dispatchEvent(new window.PointerEvent("pointerdown",
  { button: 0, pointerId: 9, clientX: solarPoint[0], clientY: solarPoint[1],
    bubbles: true, shiftKey: true }));
stage.dispatchEvent(new window.PointerEvent("pointermove",
  { pointerId: 9, clientX: solarPoint[0] + 60, clientY: solarPoint[1], bubbles: true }));
const dragging = chart()
  .querySelector('[data-handle="panel:solar-system"]').getAttribute("transform");
dragging && /translate/.test(dragging)
  ? ok("the outline moves with the diagram during the drag") : fail("outline stayed put");
stage.dispatchEvent(new window.PointerEvent("pointerup", { pointerId: 9, bubbles: true }));

// Title and caption are objects too.
for (const name of ["title", "caption"]) {
  const sel = `[data-handle="text:${name}"]`;
  const before = Number(chart().querySelector(`${sel} rect`).getAttribute("x"));
  const at = insideOf(`text:${name}`);
  drag(handleFor(`text:${name}`), at, nudge(at, 40, 30), 10);
  Math.abs(Number(chart().querySelector(`${sel} rect`).getAttribute("x")) - before) > 1
    ? ok(`the ${name} can be dragged`) : fail(`${name} did not move`);
}

// --- scaling one thing leaves everything else alone
{
  shift("keydown");
  const otherBefore = boxOf("panel:moon-illumination");
  const pGrip0 = gripAt("panel:solar-system");
  drag(gripFor("panel:solar-system"), pGrip0, nudge(pGrip0, 50, 30), 30);
  const otherAfter = boxOf("panel:moon-illumination");
  Math.abs(otherAfter.x - otherBefore.x) < 0.01 && Math.abs(otherAfter.w - otherBefore.w) < 0.01
    ? ok("scaling a diagram leaves the others where they are")
    : fail(`neighbour moved: ${JSON.stringify(otherBefore)} -> ${JSON.stringify(otherAfter)}`);

  // The bands hang off the lower plate, so this is the case that used to drag
  // every diagram along with it.
  const diagramBefore = boxOf("panel:solar-eclipse");
  const plateGrip = gripAt("plate:plates");
  drag(gripFor("plate:plates"), plateGrip, nudge(plateGrip, -40, -30), 31);
  const diagramAfter = boxOf("panel:solar-eclipse");
  Math.abs(diagramAfter.x - diagramBefore.x) < 0.01 &&
  Math.abs(diagramAfter.y - diagramBefore.y) < 0.01
    ? ok("scaling the plates leaves the diagrams where they are")
    : fail(`diagram moved: ${JSON.stringify(diagramBefore)} -> ${JSON.stringify(diagramAfter)}`);

  resetLayout();
}

// --- overlapping objects: the smallest box wins, not the topmost
{
  shift("keydown");
  const plates = boxOf("plate:plates");
  // Put a diagram inside the plates' box so the two genuinely overlap.
  const at = insideOf("panel:magnitude-key");
  drag(handleFor("panel:magnitude-key"), at,
       toClient(plates.x + plates.w * 0.5, plates.y + plates.h * 0.5), 40);
  const overlap = boxOf("panel:magnitude-key");
  const point = toClient(overlap.x + overlap.w * 0.5, overlap.y + overlap.h * 0.5);
  handleFor("plate:plates").dispatchEvent(new window.PointerEvent("pointerdown",
    { button: 0, pointerId: 41, clientX: point[0], clientY: point[1],
      bubbles: true, shiftKey: true }));
  stage.dispatchEvent(new window.PointerEvent("pointerup", { pointerId: 41, bubbles: true }));
  const titles = [...d.querySelectorAll(".section > summary")].map((n) => n.textContent);
  titles[0] === "Magnitude key"
    ? ok("clicking overlapping objects selects the smaller one")
    : fail(`selected ${JSON.stringify(titles)} instead of the diagram`);
  resetLayout();
}

// --- corner grips resize, aspect locked, anchored at the opposite corner
shift("keydown");
chart().querySelectorAll("[data-grip]").length === MOVABLE
  ? ok("every handle has a resize grip") : fail("grips missing");

const panelBox = () => {
  const r = chart().querySelector('[data-handle="panel:earth-revolution"] rect');
  return { x: +r.getAttribute("x"), y: +r.getAttribute("y"),
           w: +r.getAttribute("width"), h: +r.getAttribute("height") };
};
const boxBefore = panelBox();
const eGrip = gripAt("panel:earth-revolution");
drag(gripFor("panel:earth-revolution"), eGrip, nudge(eGrip, 60, 40), 20);
const boxAfter = panelBox();
boxAfter.w > boxBefore.w * 1.05
  ? ok(`grip scales a diagram (${boxBefore.w.toFixed(0)} to ${boxAfter.w.toFixed(0)} mm wide)`)
  : fail("diagram did not scale");
Math.abs(boxAfter.w / boxBefore.w - boxAfter.h / boxBefore.h) < 0.02
  ? ok("aspect ratio is preserved") : fail("aspect changed");
Math.abs(boxAfter.x - boxBefore.x) < 0.01 && Math.abs(boxAfter.y - boxBefore.y) < 0.01
  ? ok("the opposite corner stays put") : fail("box drifted while scaling");

const plateR = () => Number(chart().querySelector("#layer-plate circle").getAttribute("r"));
const rBefore = plateR();
const cornerBefore = Number(
  chart().querySelector('[data-handle="plate:plates"] rect').getAttribute("x"));
const pGrip = gripAt("plate:plates");
drag(gripFor("plate:plates"), pGrip, nudge(pGrip, 40, 30), 21);
plateR() > rBefore * 1.02
  ? ok(`grip scales the plates (r ${rBefore} to ${plateR()})`) : fail("plates did not scale");
Math.abs(Number(chart().querySelector('[data-handle="plate:plates"] rect')
  .getAttribute("x")) - cornerBefore) < 0.5
  ? ok("the plates scale about their top-left corner") : fail("plates drifted while scaling");

const titleSize = () => Number(
  /font-size:([\d.]+)px/.exec(
    /\.title\{[^}]*\}/.exec(styleText())[0])[1]);
const sizeBefore = titleSize();
const tGrip = gripAt("text:title");
drag(gripFor("text:title"), tGrip, nudge(tGrip, 40, 20), 22);
titleSize() > sizeBefore
  ? ok(`grip scales the title type (${sizeBefore} to ${titleSize()} mm)`)
  : fail("title type did not scale");

resetLayout();

// Shift-clicking selects, and the sidebar narrows to what is selected.
const sectionTitles = () =>
  [...d.querySelectorAll(".section > summary")].map((n) => n.textContent);
const clickTarget = handleFor("panel:lunar-eclipse");
const lunarPoint = insideOf("panel:lunar-eclipse");
clickTarget.dispatchEvent(new window.PointerEvent("pointerdown",
  { button: 0, pointerId: 11, clientX: lunarPoint[0], clientY: lunarPoint[1],
    bubbles: true, shiftKey: true }));
stage.dispatchEvent(new window.PointerEvent("pointerup", { pointerId: 11, bubbles: true }));
const selectedTitles = sectionTitles();
selectedTitles.length === 1 && selectedTitles[0] === "Eclipse of the Moon"
  ? ok(`shift-click narrows the sidebar to "${selectedTitles[0]}"`)
  : fail(`sidebar shows ${JSON.stringify(selectedTitles)}`);
chart().querySelector('[data-handle="panel:lunar-eclipse"].handle-selected')
  ? ok("the selected outline is emphasised") : fail("no selected styling");

// --- a diagram's styling is its own
const sunOf = (name) => {
  const scoped = new RegExp(`#panel-${name} \\.panel-sun\\{fill:([^;}]+)`).exec(styleText());
  return scoped ? scoped[1] : /\.panel-sun\{fill:([^;}]+)/.exec(styleText())[1];
};
const sunSwatch = [...d.querySelectorAll("input.swatch")]
  .find((i) => i.dataset.path === "panelStyles.lunar-eclipse.sun");
sunSwatch ? ok("the diagram has its own palette") : fail("no per-diagram palette");
const otherBefore = sunOf("solar-eclipse");
sunSwatch.value = "#ff0000";
sunSwatch.dispatchEvent(new window.Event("input"));
sunOf("lunar-eclipse") === "#ff0000"
  ? ok("restyling one diagram takes effect") : fail("per-diagram colour ignored");
sunOf("solar-eclipse") === otherBefore
  ? ok("the other diagrams are unaffected") : fail("per-diagram colour leaked");

// --- the heading rule is toggleable per diagram
// The rule above each heading is off by default now, and switchable per diagram.
const ruleCount = (name) => chart().querySelectorAll(`#panel-${name} .panel-rule`).length;
const ruleToggle = [...d.querySelectorAll(".check")]
  .find((c) => c.textContent.trim() === "Draw the rule")?.querySelector("input");
ruleToggle ? ok("the heading rule has a toggle") : fail("no rule toggle");
ruleCount("lunar-eclipse") === 0 ? ok("no rule by default") : fail("rule drawn by default");
ruleToggle.checked = true;
ruleToggle.dispatchEvent(new window.Event("change"));
ruleCount("lunar-eclipse") > 0
  ? ok("switching the rule on draws it") : fail("rule not drawn when asked for");
ruleCount("solar-eclipse") === 0
  ? ok("other diagrams are unaffected") : fail("rule toggle leaked");
ruleToggle.checked = false;
ruleToggle.dispatchEvent(new window.Event("change"));

d.querySelector(".btn.back").click();
const restoredTitles = sectionTitles();
restoredTitles.includes("Colours") && restoredTitles.includes("Layout") &&
  restoredTitles.length > 3 && !d.querySelector(".btn.back")
  ? ok(`going back restores the global controls (${restoredTitles.length} sections)`)
  : fail(`back: ${JSON.stringify(restoredTitles)}`);

shift("keyup");

d.querySelector("#reset-layout").click();

// --- printed size
{
  const zoomLabel = () => d.querySelector("#zoom-level").textContent;
  const chartWidthPx = () => {
    const m = /scale\(([\d.]+)\)/.exec(d.querySelector("#chart-wrap").style.transform);
    return 609.6 * +m[1];
  };
  const chip = d.querySelector("#calibrate");
  !d.querySelector("#actual-size") ? ok("the separate 1:1 button is gone")
                                   : fail("1:1 button still present");

  // Calibrating for a denser screen must shrink the on-screen millimetre.
  const ruler = d.querySelector("#ruler");
  const rulerOpen = () => window.getComputedStyle(ruler).display !== "none";
  !rulerOpen() ? ok("the ruler starts closed") : fail("ruler visible before opening");
  chip.click();
  rulerOpen() ? ok("clicking Calibrate opens it") : fail("ruler did not appear");
  chip.click();
  !rulerOpen() ? ok("clicking it again closes it") : fail("ruler would not close");
  chip.click();

  const input = d.querySelector("#ruler-mm");
  const barPx = Number(input.dataset.px);
  const shown = Number(input.value);
  barPx > 100 && Math.abs(shown - barPx / (96 / 25.4)) < 0.2
    ? ok(`the bar is ${barPx} px, which it says is ${shown.toFixed(1)} mm`)
    : fail(`bar ${barPx} px reported as ${shown} mm`);

  // Report the bar as 20% short of what it claims.
  const measured = shown * 0.8;
  input.value = String(measured);
  d.querySelector("#ruler-unit").value = "mm";
  d.querySelector("#ruler-done").click();
  !rulerOpen() ? ok("Done closes the panel") : fail("panel stayed open");
  zoomLabel() === "100%" ? ok("Done scales to printed size") : fail(`reads ${zoomLabel()}`);
  chip.classList.contains("on") ? ok("the button lights when at printed size")
                                : fail("button not lit");
  const denser = chartWidthPx();
  Math.abs(denser - 24 * 96 * 1.25) < 2
    ? ok(`calibration scales it (now ${Math.round(denser)} px for the same 24 inches)`)
    : fail(`calibration off: ${denser}`);

  /* Repeating the same reading must land on the same number. Sizing the bar in
   * millimetres drew it through the assumption being calibrated, so each round
   * moved the ruler too and the scale ran away -- five rounds of one reading
   * walked 96 dpi to 174, oscillating on the way. */
  for (let i = 0; i < 4; i++) {
    d.querySelector("#calibrate").click();
    d.querySelector("#ruler-mm").value = String(measured);
    d.querySelector("#ruler-unit").value = "mm";
    d.querySelector("#ruler-done").click();
  }
  Math.abs(chartWidthPx() - denser) < 1
    ? ok("calibrating five times with one reading does not run away")
    : fail(`ran away: ${Math.round(denser)} px to ${Math.round(chartWidthPx())} px`);

  // Zooming away from printed size puts the light out again.
  wheel({ deltaY: -100, ctrlKey: true });
  !chip.classList.contains("on") && zoomLabel() !== "100%"
    ? ok(`zooming clears it (now ${zoomLabel()})`) : fail("button stayed lit after zooming");
  chip.click();
  d.querySelector("#ruler-done").click();
  chip.classList.contains("on") ? ok("recalibrating lights it again") : fail("not relit");

  // And the bar now reports the length that was measured.
  d.querySelector("#calibrate").click();
  Math.abs(Number(d.querySelector("#ruler-mm").value) - measured) < 0.15
    ? ok("the bar reports the length it was told it was")
    : fail(`bar says ${d.querySelector("#ruler-mm").value}, told ${measured}`);
  d.querySelector("#ruler-done").click();
  zoomLabel() === "100%" ? ok("still reads 100% after calibrating") : fail("readout drifted");

  // Reading the bar correctly, in inches, must leave the scale alone -- which
  // is only true if the unit conversion round-trips.
  const beforeInches = chartWidthPx();
  d.querySelector("#calibrate").click();
  d.querySelector("#ruler-unit").value = "in";
  d.querySelector("#ruler-unit").dispatchEvent(new window.Event("change"));
  d.querySelector("#ruler-done").click();
  // Within a tenth of a percent: the inch reading is shown to two decimals,
  // which is already finer than a ruler can be read, so that rounding is the
  // floor on this comparison rather than a defect.
  const drift = Math.abs(chartWidthPx() - beforeInches) / beforeInches;
  drift < 0.001
    ? ok(`measuring in inches round-trips (${(drift * 100).toFixed(3)}% drift)`)
    : fail(`unit conversion is off by ${(drift * 100).toFixed(2)}%`);
  Number(localStorage.getItem("starchart.dpi")) > 96
    ? ok("the measurement is remembered") : fail("calibration not stored");
  localStorage.removeItem("starchart.dpi");
}

d.querySelectorAll("[data-zoom]").length === 0
  ? ok("zoom buttons removed") : fail("zoom buttons still present");

errors.length === 0 ? ok("no runtime errors") : fail("runtime errors: " + errors.join("; "));
process.exitCode = failed ? 1 : 0;
