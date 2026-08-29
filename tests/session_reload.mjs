/* Does a reload actually bring the layout back?
 *
 * The smoke test covers the save and the file round trip, but both run inside
 * one page. The thing worth arranging a poster for is that closing the tab and
 * coming back costs nothing -- and that path runs at boot, in code no in-page
 * test reaches. So this boots the editor three times: once to arrange and save,
 * once from cold with only what storage carries over, and once with nothing
 * stored at all.
 */

import { boot } from "./harness.mjs";

let failed = false;
const fail = (m) => { console.log("FAIL:", m); failed = true; };
const ok = (m) => console.log("  ok  ", m);

/* Long enough for a debounced save to have fired. It matters between visits as
 * well as within one: these all share a process, so a save still queued from
 * the last page would land in the next page's storage and look like a leak. */
const settle = () => new Promise((r) => setTimeout(r, 400));
const panelX = (d) => Number(
  d.querySelector('[data-drag="panel:solar-eclipse"] rect')?.getAttribute("x") ?? NaN);
const styleOf = (d) =>
  d.querySelector("#chart-wrap svg style")?.textContent ?? "";

// ---- first visit: change a colour, and let it be saved
const first = await boot();
const home = panelX(first.document);
Number.isFinite(home) ? ok("the editor came up") : fail("no diagram on the sheet");

first.document.querySelector(".btn.back")?.click();
const swatch = first.document.querySelector('[data-path="page.background"]');
swatch.value = "#123456";
swatch.dispatchEvent(new first.window.Event("input"));
await settle();

const saved = first.window.localStorage.getItem("starchart.session");
saved ? ok("the first visit saved a session") : fail("nothing was saved");
JSON.parse(saved).theme.page.background === "#123456"
  ? ok("with the changed colour in it") : fail("the colour was not saved");

// A moved diagram, written into the same session. Placing it here rather than
// dragging keeps this file about the reload; the drag itself is the smoke
// test's business.
const moved = { ...JSON.parse(saved) };
moved.config.placement = moved.config.placement ?? {};
moved.config.placement.panels = { "solar-eclipse": { x: home + 61, y: 300, w: 165, h: 48 } };

// ---- second visit: cold, with only storage carried across
const second = await boot({ session: JSON.stringify(moved) });
styleOf(second.document).includes("#123456")
  ? ok("a reload restores the colours without being asked")
  : fail("the reload came up with the defaults");
Math.abs(panelX(second.document) - (home + 61)) < 0.01
  ? ok("and puts the diagram back where it was dragged to")
  : fail(`the diagram came back at ${panelX(second.document)}, not ${home + 61}`);
await settle();

// ---- and a cold start with nothing stored is untouched by any of it
const third = await boot();
!styleOf(third.document).includes("#123456")
  ? ok("a browser with no saved session gets the defaults")
  : fail("a session leaked into a fresh visit");
Math.abs(panelX(third.document) - home) < 0.01
  ? ok("including the diagram's own place in the flow")
  : fail(`a fresh visit put the diagram at ${panelX(third.document)}`);

for (const [name, run] of [["first", first], ["reload", second], ["fresh", third]]) {
  if (run.errors.length) fail(`the ${name} visit raised: ${run.errors.join("; ")}`);
}
if (!failed) ok("no runtime errors across the three visits");
process.exitCode = failed ? 1 : 0;
