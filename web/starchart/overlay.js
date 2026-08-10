/* The date-and-place overlay: horizon and zenith.
 *
 * Mirrors starchart/overlay.py. The plate underneath is eternal; everything
 * here belongs to one observer at one moment and is drawn on top.
 */

import { horizonCurve, zenith } from "./horizon.js";
import { circle, line, path, polylineD } from "./svg.js";

/**
 * Project a closed curve and split it where it leaves the plate.
 *
 * Without the split the path jumps straight across the plate wherever the
 * curve dips out and back.
 */
export function curveRuns(hemi, points, margin = 1.0) {
  const runs = [];
  let run = [];
  let firstIn = false, lastIn = false;

  points.forEach(([ra, dec], i) => {
    const [x, y] = hemi.project(ra, dec);
    const inside = Math.hypot(x - hemi.cx, y - hemi.cy) <= hemi.radius + margin;
    if (i === 0) firstIn = inside;
    if (i === points.length - 1) lastIn = inside;
    if (inside) run.push([x, y]);
    else if (run.length) { runs.push(run); run = []; }
  });
  if (run.length) runs.push(run);
  // The curve is closed, so a run ending at the last sample continues into the
  // one starting at the first.
  if (runs.length > 1 && firstIn && lastIn) runs[0] = runs.pop().concat(runs[0]);
  return runs.filter((r) => r.length > 1);
}

export function drawOverlay(hemi, observer, theme) {
  const parts = [];
  const runs = curveRuns(hemi, horizonCurve(observer.latitude, observer.lstDeg, 1440));
  if (runs.length) {
    parts.push(path(runs.map((r) => polylineD(r)).join(""), { class_: "horizon" }));
  }

  const [zRa, zDec] = zenith(observer.latitude, observer.lstDeg);
  if (hemi.visible(zDec)) {
    const [zx, zy] = hemi.project(zRa, zDec);
    const r = theme.horizon.zenith_size;
    const marks = [
      circle(zx, zy, r, { fill: "none" }),
      line(zx - r * 1.9, zy, zx - r * 0.6, zy),
      line(zx + r * 0.6, zy, zx + r * 1.9, zy),
      line(zx, zy - r * 1.9, zx, zy - r * 0.6),
      line(zx, zy + r * 0.6, zx, zy + r * 1.9),
    ];
    parts.push(`<g class="zenith">${marks.join("")}</g>`);
  }
  return `<g>${parts.join("")}</g>`;
}

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
  "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

export function clockLabel(minutes) {
  const h24 = Math.floor(minutes / 60);
  const mm = String(Math.round(minutes) % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}

/** One line describing the moment, for under the plates. */
export function caption(observer) {
  const lat = `${Math.abs(observer.latitude).toFixed(2)}°${observer.latitude >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(observer.longitude).toFixed(2)}°${observer.longitude >= 0 ? "E" : "W"}`;
  const [y, m, d] = observer.localDate.split("-").map(Number);
  const where = observer.place && observer.showPlace ? `${observer.place.toUpperCase()} · ` : "";
  return `${d} ${MONTHS[m - 1]} ${y} · ${clockLabel(observer.minutes)} · ${where}${lat} ${lon}`;
}
