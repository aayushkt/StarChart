/* Reference circles: tropics, polar circles, ecliptic, colures.
 *
 * Mirrors starchart/reference.py. Constant-declination circles stay perfectly
 * round on this projection and are drawn as circles; the ecliptic is a tilted
 * great circle and needs a polyline; the colures pass through the pole and come
 * out as radial lines.
 */

import { CAP_HEIGHT, arcText } from "./lettering.js";
import { NORTH } from "./projection.js";
import { attrs, circle, fmt, line, path, polylineD } from "./svg.js";
import { curveRuns } from "./overlay.js";

/** Mean obliquity of the ecliptic at J2000 (IAU 2006). */
export const OBLIQUITY = 23.439291111;

export const SMALL_CIRCLES = [
  [OBLIQUITY, "TROPIC OF CANCER"],
  [-OBLIQUITY, "TROPIC OF CAPRICORN"],
  [90 - OBLIQUITY, "NORTH POLAR CIRCLE"],
  [-(90 - OBLIQUITY), "SOUTH POLAR CIRCLE"],
];

/** The ecliptic in equatorial coordinates, sampled by celestial longitude. */
export function ecliptic(samples = 720) {
  const eps = OBLIQUITY * (Math.PI / 180);
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const lon = ((i / samples) * 360) * (Math.PI / 180);
    const dec = Math.asin(Math.sin(eps) * Math.sin(lon));
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lon), Math.cos(lon));
    out.push([((ra * (180 / Math.PI)) % 360 + 360) % 360, dec * (180 / Math.PI)]);
  }
  return out;
}

export function drawSmallCircles(hemi, theme, labels) {
  const ref = theme.reference;
  const parts = [];
  for (const [dec, name] of SMALL_CIRCLES) {
    if (!hemi.visible(dec)) continue;
    const radius = hemi.radiusForDec(dec);
    if (radius < 4) continue;
    parts.push(circle(hemi.cx, hemi.cy, radius, { class_: "ref-circle" }));
    if (labels) {
      const size = ref.label_size;
      // Glyphs grow outward from the baseline on an outward-facing arc, so the
      // baseline is set from a clearance above the cap height. A raw offset
      // lets the ascenders cross the circle and be clipped by it.
      const baseline = radius - (CAP_HEIGHT * size + ref.label_clearance);
      if (baseline > size * 2) {
        parts.push(arcText(hemi.cx, hemi.cy, baseline, ref.small_circle_label_deg, name, {
          size, tracking: ref.label_tracking, class_: "ref-label",
        }));
      }
    }
  }
  return `<g>${parts.join("")}</g>`;
}

function rotatedLabel(x, y, angle, content, cls, dy) {
  let a = angle;
  if (a > 90 || a < -90) a += 180;
  return `<text ${attrs({
    x, y: y - dy, class_: cls, text_anchor: "middle",
    transform: `rotate(${fmt(a)} ${fmt(x)} ${fmt(y)})`,
  })}>${content}</text>`;
}

export function drawEcliptic(hemi, theme, labels) {
  const ref = theme.reference;
  const runs = curveRuns(hemi, ecliptic());
  if (!runs.length) return "<g></g>";
  const parts = [path(runs.map((r) => polylineD(r)).join(""), { class_: "ecliptic" })];

  if (labels) {
    const eps = OBLIQUITY * (Math.PI / 180);
    const at = (lonDeg) => {
      const lon = lonDeg * (Math.PI / 180);
      const dec = Math.asin(Math.sin(eps) * Math.sin(lon)) * (180 / Math.PI);
      const ra = ((Math.atan2(Math.cos(eps) * Math.sin(lon), Math.cos(lon)) *
        (180 / Math.PI)) % 360 + 360) % 360;
      return [ra, dec];
    };
    const [ra, dec] = at(ref.ecliptic_label_lon);
    if (hemi.visible(dec)) {
      const [x, y] = hemi.project(ra, dec);
      const [ra2, dec2] = at(ref.ecliptic_label_lon + 1);
      const [x2, y2] = hemi.project(ra2, dec2);
      const angle = Math.atan2(y2 - y, x2 - x) * (180 / Math.PI);
      parts.push(rotatedLabel(x, y, angle, "ECLIPTIC", "ecliptic-label", ref.label_clearance));
    }
  }
  return `<g>${parts.join("")}</g>`;
}

export function drawColures(hemi, theme, labels) {
  const ref = theme.reference;
  const inner = hemi.pole === NORTH ? -hemi.overlapDeg : hemi.overlapDeg;
  const poleDec = hemi.pole === NORTH ? 90 : -90;
  const parts = [];

  /* Each colure is one great circle drawn as two arms out of the pole, and both
   * arms used to carry the name -- so each colure was labelled twice. One
   * label each now, and which arm gets it is decided by where the arm ends up
   * rather than by its right ascension: the equinoctial takes whichever arm
   * runs highest up the sheet and the solstitial whichever runs furthest
   * right, so rotating the chart moves the labels with it instead of sending
   * them somewhere arbitrary. */
  const wanted = {
    "EQUINOCTIAL COLURE": ([, y]) => -y,
    "SOLSTITIAL COLURE": ([x]) => x,
  };
  const best = new Map();

  const arms = [[0, "EQUINOCTIAL COLURE"], [180, "EQUINOCTIAL COLURE"],
                [90, "SOLSTITIAL COLURE"], [270, "SOLSTITIAL COLURE"]]
    .map(([ra, name]) => {
      const from = hemi.project(ra, poleDec);
      const to = hemi.project(ra, inner);
      parts.push(line(from[0], from[1], to[0], to[1], { class_: "colure" }));
      return { name, from, to };
    });

  for (const arm of arms) {
    const score = wanted[arm.name](arm.to);
    if (!best.has(arm.name) || score > best.get(arm.name).score) {
      best.set(arm.name, { arm, score });
    }
  }

  if (labels) {
    for (const { arm } of best.values()) {
      const [x0, y0] = arm.from;
      const [x1, y1] = arm.to;
      const f = ref.colure_label_frac;
      const lx = x0 + (x1 - x0) * f;
      const ly = y0 + (y1 - y0) * f;
      const angle = Math.atan2(y1 - y0, x1 - x0) * (180 / Math.PI);
      parts.push(rotatedLabel(lx, ly, angle, arm.name, "ref-label",
                              ref.label_clearance * 0.8));
    }
  }
  return `<g>${parts.join("")}</g>`;
}
