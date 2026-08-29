/* Booting the editor in jsdom.
 *
 * Extracted so it can be done twice. The session test needs a genuine second
 * page load -- localStorage seeded, module re-executed, boot() run again --
 * which is the only way to check that a reload actually restores a layout.
 * Doing that inside the smoke test's own window would repoint the globals out
 * from under the copy of app.js already running there.
 */

import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";

export const REPO = path.resolve(new URL("..", import.meta.url).pathname);
export const WEB = path.join(REPO, "web");

/** jsdom does no layout, so every box is 0x0 and the pan/zoom maths degenerates. */
export const STAGE = { x: 320, y: 40, width: 900, height: 700 };

let seq = 0;

/**
 * Load index.html, publish the browser globals app.js expects, import it, and
 * wait for the first render.
 *
 * `session` seeds localStorage before the import, which is what makes this a
 * reload rather than a first visit.
 */
export async function boot({ session = null, dpi = null } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(WEB, "index.html"), "utf8"), {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // The real stylesheet, inlined. Without it getComputedStyle sees nothing, and
  // a panel that never hides because a class rule outranks [hidden] looks
  // perfectly fine to a test that only reads the `hidden` property.
  const style = window.document.createElement("style");
  style.textContent = fs.readFileSync(path.join(WEB, "style.css"), "utf8");
  window.document.head.appendChild(style);

  window.Element.prototype.getBoundingClientRect = function () {
    if (this.id === "stage-scroll") {
      return { ...STAGE, left: STAGE.x, top: STAGE.y,
               right: STAGE.x + STAGE.width, bottom: STAGE.y + STAGE.height };
    }
    return { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
  };
  window.Element.prototype.setPointerCapture ||= function () {};
  window.Element.prototype.releasePointerCapture ||= function () {};
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
    return { ok: true, status: 200,
             json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
  };

  if (session) window.localStorage.setItem("starchart.session", session);
  if (dpi) window.localStorage.setItem("starchart.dpi", String(dpi));

  const errors = [];
  window.addEventListener("error", (e) => errors.push(e.message));

  // A fresh query string each time, so the module is re-executed rather than
  // served from the cache -- boot() has to run again for this to mean anything.
  await import(`${path.join(WEB, "app.js")}?load=${seq++}`);
  for (let i = 0; i < 100 && !window.document.querySelector("#chart-wrap svg"); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  return { window, document: window.document, errors };
}
