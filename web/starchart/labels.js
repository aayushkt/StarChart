/* Placing star names without them colliding.
 *
 * Greedy by brightness: the brightest star gets first choice of position, and
 * anything that cannot find clear space is dropped rather than allowed to
 * overlap.
 */

import { textWidth } from "./lettering.js";
import { text } from "./svg.js";

export const BUCKET_MIN = -2.0;
export const BUCKET_STEP = 0.5;
export const BUCKET_COUNT = 18;

export const bucketFor = (mag) =>
  Math.max(0, Math.min(BUCKET_COUNT - 1, Math.floor((mag - BUCKET_MIN) / BUCKET_STEP)));
export const bucketMagnitude = (bucket) => BUCKET_MIN + (bucket + 1) * BUCKET_STEP;

const overlaps = (a, b, pad) =>
  !(a.x1 + pad < b.x0 || b.x1 + pad < a.x0 || a.y1 + pad < b.y0 || b.y1 + pad < a.y0);

/** Rectangles already spoken for, bucketed into a grid so lookups stay local. */
export class Placer {
  constructor(cell = 24, pad = 0.7) {
    this.cell = cell;
    this.pad = pad;
    this.grid = new Map();
  }

  *cells(r) {
    const i0 = Math.floor((r.x0 - this.pad) / this.cell);
    const i1 = Math.floor((r.x1 + this.pad) / this.cell);
    const j0 = Math.floor((r.y0 - this.pad) / this.cell);
    const j1 = Math.floor((r.y1 + this.pad) / this.cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) yield `${i},${j}`;
  }

  free(rect) {
    for (const key of this.cells(rect)) {
      for (const other of this.grid.get(key) ?? []) {
        if (overlaps(rect, other, this.pad)) return false;
      }
    }
    return true;
  }

  take(rect) {
    for (const key of this.cells(rect)) {
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(rect);
    }
  }
}

// Right and left first: the original sets most star names beside their star.
const CANDIDATES = [
  [1, 0.35, "start"], [-1, 0.35, "end"],
  [1, -0.9, "start"], [-1, -0.9, "end"],
  [1, 1.5, "start"], [-1, 1.5, "end"],
  [0, -1.1, "middle"], [0, 1.75, "middle"],
];

const onPlate = (hemi, box) =>
  [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].every(
    ([x, y]) => Math.hypot(x - hemi.cx, y - hemi.cy) <= hemi.radius - 1.0
  );

/** entries: [x, y, name, magnitude]. Brightest placed first. */
export function placeStarLabels(hemi, entries, theme, placer) {
  const size = theme.type.star_size;
  const gap = theme.labels.star_gap;
  const parts = [];

  for (const [x, y, name, mag] of [...entries].sort((a, b) => a[3] - b[3])) {
    const width = textWidth(name, size);
    for (const [dx, dy, anchor] of CANDIDATES) {
      const tx = x + dx * gap;
      const ty = y + dy * size;
      const top = ty - size * 0.78;
      const bottom = ty + size * 0.24;
      const box =
        anchor === "start" ? { x0: tx, y0: top, x1: tx + width, y1: bottom }
        : anchor === "end" ? { x0: tx - width, y0: top, x1: tx, y1: bottom }
        : { x0: tx - width / 2, y0: top, x1: tx + width / 2, y1: bottom };

      if (!onPlate(hemi, box) || !placer.free(box)) continue;
      placer.take(box);
      parts.push(text(tx, ty, name, {
        class_: `star-label lbl-b${bucketFor(mag)}`, text_anchor: anchor,
      }));
      break;
    }
  }
  return `<g>${parts.join("")}</g>`;
}

function arcBBox(hemi, radius, centreDeg, width, size) {
  const sweep = (width / radius) * (180 / Math.PI);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 7; i++) {
    const a = (centreDeg - sweep / 2 + (sweep * i) / 6) * (Math.PI / 180);
    const x = hemi.cx + radius * Math.sin(a);
    const y = hemi.cy - radius * Math.cos(a);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0: x0 - size * 0.3, y0: y0 - size * 0.9, x1: x1 + size * 0.3, y1: y1 + size * 0.6 };
}
