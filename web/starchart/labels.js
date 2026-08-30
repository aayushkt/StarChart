/* Placing star and constellation names without them colliding.
 *
 * Mirrors starchart/labels.py. Greedy by brightness: the brightest star gets
 * first choice of position and anything that cannot find clear space is
 * dropped rather than allowed to overlap. Constellations are placed first --
 * they are large, curved, and have far less freedom about where they can sit.
 */

import { arcText, textWidth } from "./lettering.js";
import { fmt, text } from "./svg.js";

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

/** The axis-aligned bounds of a rotated line of text, centred on (cx, cy). */
function tiltedBBox(cx, cy, width, size, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const hw = width / 2;
  const top = -size * 0.78, bottom = size * 0.24;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [u, v] of [[-hw, top], [hw, top], [-hw, bottom], [hw, bottom]]) {
    const x = cx + u * c - v * s;
    const y = cy + u * s + v * c;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

/* Set at one angle across the whole plate, rather than curved along the
 * declination circle the constellation sits on.
 *
 * The curve is the more faithful choice and it is what the original does, but
 * a name's own declination circle is a graticule ring that gets drawn -- so
 * every name sat along a line -- and near the pole it lays them flat, in the
 * busiest part of the plate. A constant tilt lifts them clear and keeps them
 * parallel, which reads as deliberate rather than as a near miss.
 */
function tiltedConstellations(hemi, entries, theme, placer, angle) {
  const size = theme.type.constel_size;
  const tracking = theme.labels.constellation_tracking;
  const altScale = theme.type.constel_alt_scale ?? 0.78;
  const rad = angle * (Math.PI / 180);
  const parts = [];

  for (const [ra, dec, primary, secondary] of entries) {
    if (!hemi.visible(dec)) continue;
    const [cx, cy] = hemi.project(ra, dec);
    const lines = secondary ? [[primary, size], [`(${secondary})`, size * altScale]]
                            : [[primary, size]];

    const boxes = [], drawn = [];
    for (let i = 0; i < lines.length; i++) {
      const [content, sz] = lines[i];
      /* Stacked along the text's own normal, so a two-line name stays square to
       * itself at any angle. Rotating by t sends (u, v) to
       * (u cos t - v sin t, u sin t + v cos t), so "down the page" in text
       * space, v = 1, is (-sin t, cos t) on screen. */
      const drop = i * sz * 1.25;
      const lx = cx - drop * Math.sin(rad);
      const ly = cy + drop * Math.cos(rad);
      const width = textWidth(content, sz, tracking);
      const box = tiltedBBox(lx, ly, width, sz, rad);
      /* Deliberately not checked against the line above it. Two tilted lines
       * one leading apart have axis-aligned bounds that always overlap, and
       * rejecting on that threw away every English-and-Latin pair -- 44 of
       * them. They cannot collide with each other anyway, being placed at
       * exactly the leading they want. */
      if (!onPlate(hemi, box) || !placer.free(box)) break;
      boxes.push(box);
      drawn.push(text(lx, ly, content, {
        class_: i === 0 ? "constel-label" : "constel-label-alt",
        text_anchor: "middle",
        letter_spacing: tracking,
        transform: `rotate(${fmt(angle)} ${fmt(lx)} ${fmt(ly)})`,
      }));
    }
    // The Latin line is worth having but not worth losing the name over: if it
    // will not fit, the name still goes down without it.
    if (!drawn.length) continue;
    boxes.forEach((b) => placer.take(b));
    parts.push(...drawn);
  }
  return `<g>${parts.join("")}</g>`;
}

/** entries: [ra, dec, primary, secondary]. Tilted, or curved along their own
 *  declination circle when `labels.constellation_angle` is null. */
export function placeConstellationLabels(hemi, entries, theme, placer) {
  const angle = theme.labels.constellation_angle;
  if (angle !== null && angle !== undefined) {
    return tiltedConstellations(hemi, entries, theme, placer, angle);
  }
  const size = theme.type.constel_size;
  const tracking = theme.labels.constellation_tracking;
  const parts = [];

  for (const [ra, dec, primary, secondary] of entries) {
    if (!hemi.visible(dec)) continue;
    const radius = hemi.radiusForDec(dec);
    if (radius < size * 2) continue;

    const centre = (hemi.clockwise ? 1 : -1) * (ra - hemi.raZeroDeg);
    const altScale = theme.type.constel_alt_scale ?? 0.78;
    const lines = secondary ? [[primary, size], [`(${secondary})`, size * altScale]]
                            : [[primary, size]];

    const boxes = [], drawn = [];
    let ok = true;
    lines.forEach(([content, sz], i) => {
      if (!ok) return;
      const r = radius - i * sz * 1.25;
      const width = textWidth(content, sz, tracking);
      if (width > 2 * Math.PI * r * 0.4) { ok = false; return; }
      const box = arcBBox(hemi, r, centre, width, sz);
      if (!onPlate(hemi, box) || !placer.free(box) ||
          boxes.some((b) => overlaps(box, b, placer.pad))) { ok = false; return; }
      boxes.push(box);
      drawn.push(arcText(hemi.cx, hemi.cy, r, centre, content, {
        size: sz, tracking, class_: i === 0 ? "constel-label" : "constel-label-alt",
      }));
    });
    if (!ok) continue;
    boxes.forEach((b) => placer.take(b));
    parts.push(...drawn);
  }
  return `<g>${parts.join("")}</g>`;
}
