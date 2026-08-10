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

const REPO = path.resolve(new URL("..", import.meta.url).pathname);
const WEB = path.join(REPO, "web");

const dom = new JSDOM(fs.readFileSync(path.join(WEB, "index.html"), "utf8"), {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const { window } = dom;

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
                   "PointerEvent", "MouseEvent", "Blob", "Node", "SVGElement"]) {
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

const chart = () => d.querySelector("#chart-wrap svg");
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

// --- restyling happens in place, without re-rendering
const styleText = () => chart().querySelector("style").textContent;
const before = styleText();
const plate = [...swatches].find((s) => s.dataset.path === "plate.fill");
plate.value = "#ff0000";
plate.dispatchEvent(new window.Event("input"));
styleText().includes(".plate-bg{fill:#ff0000}")
  ? ok("colour change rewrites the stylesheet") : fail("colour change did not apply");
styleText() !== before ? ok("stylesheet mutated in place") : fail("stylesheet unchanged");

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
const magSlider = [...sliders].find((s) => s.dataset.path === "ui.magLimit");
magSlider.value = "2";
magSlider.dispatchEvent(new window.Event("input"));
styleText().includes(".mag-3,.halo-3{display:none}")
  ? ok("magnitude filter hides faint classes") : fail("magnitude filter failed");

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
const radius = [...sliders].find((s) => s.dataset.path === "config.layout.radius");
radius ? ok("layout controls present") : fail("no layout sliders");
const plateR = () => chart().querySelector("#layer-plate circle").getAttribute("r");
const r0 = plateR();
radius.value = "120";
radius.dispatchEvent(new window.Event("input"));
plateR() !== r0 ? ok(`circle radius is editable (${r0} to ${plateR()})`) : fail("radius did nothing");
radius.value = String(r0);
radius.dispatchEvent(new window.Event("input"));

// --- diagrams
const panelIds = () => [...chart().querySelectorAll('g[id^="panel-"]')]
  .map((g) => g.id).filter((id) => !id.startsWith("panel-clip"));
const allPanels = panelIds();
allPanels.length === 7 ? ok(`${allPanels.length} diagrams drawn`) : fail(`${allPanels.length} diagrams`);

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
const stage = d.querySelector("#stage-scroll");
const view = () => {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/
    .exec(d.querySelector("#chart-wrap").style.transform);
  return m ? { tx: +m[1], ty: +m[2], scale: +m[3] } : null;
};
const wheel = (opts) => stage.dispatchEvent(new window.WheelEvent("wheel",
  { clientX: 700, clientY: 300, bubbles: true, cancelable: true, ...opts }));

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
  ? ok("drag pans one-to-one with the pointer") : fail("drag pan wrong");
stage.dispatchEvent(new window.PointerEvent("pointerup", { pointerId: 1, bubbles: true }));

stage.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
Math.abs(view().scale - fitted.scale) < 1e-6 ? ok("double-click refits") : fail("no refit");

d.querySelectorAll("[data-zoom]").length === 0
  ? ok("zoom buttons removed") : fail("zoom buttons still present");

errors.length === 0 ? ok("no runtime errors") : fail("runtime errors: " + errors.join("; "));
process.exitCode = failed ? 1 : 0;
