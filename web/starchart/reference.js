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

  for (const [ra, name] of [[0, "EQUINOCTIAL COLURE"], [180, "EQUINOCTIAL COLURE"],
                            [90, "SOLSTITIAL COLURE"], [270, "SOLSTITIAL COLURE"]]) {
    const [x0, y0] = hemi.project(ra, poleDec);
    const [x1, y1] = hemi.project(ra, inner);
    parts.push(line(x0, y0, x1, y1, { class_: "colure" }));
    if (labels) {
      const f = ref.colure_label_frac;
      const lx = x0 + (x1 - x0) * f;
      const ly = y0 + (y1 - y0) * f;
      const angle = Math.atan2(y1 - y0, x1 - x0) * (180 / Math.PI);
      parts.push(rotatedLabel(lx, ly, angle, name, "ref-label", ref.label_clearance * 0.8));
    }
  }
  return `<g>${parts.join("")}</g>`;
}
