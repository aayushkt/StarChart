/* Drawing a line the way a hand would.
 *
 * A generated chart is straight because a machine drew it, and that is exactly
 * what makes it read as generated. The references for this project are notebook
 * pages and portolan charts: the lines bow, they are gone over twice, corners
 * overshoot, and shading is hatched rather than filled. None of that is noise
 * for its own sake -- it is what a pen does.
 *
 * Everything here is deterministic. The randomness comes from a seeded
 * generator keyed to each shape's own coordinates, so the same chart drawn
 * twice is identical down to the byte: the golden snapshot still holds, and a
 * re-render after moving a slider does not reshuffle every line on the sheet.
 *
 * The output is ordinary path data. No filters, no raster, no blend modes --
 * it prints at whatever resolution the printer has, which a displacement filter
 * would not.
 */

import { fmt } from "./svg.js";

/** Mulberry32: small, fast, and good enough for wobble. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed from a shape's own numbers, so its wobble never changes. */
function seedFrom(numbers) {
  let h = 2166136261;
  for (const n of numbers) {
    const v = Math.round(n * 64);
    h = Math.imul(h ^ (v & 0xff), 16777619);
    h = Math.imul(h ^ ((v >>> 8) & 0xff), 16777619);
    h = Math.imul(h ^ ((v >>> 16) & 0xff), 16777619);
  }
  return h >>> 0;
}

/**
 * A single hand-drawn stroke between two points.
 *
 * The ends land slightly off target and the middle bows, which is the whole
 * effect: a ruler holds the ends and the hand fails in between.
 */
function stroke(x1, y1, x2, y2, r, amount) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  // Long lines wander more than short ones, but not proportionally -- a hand
  // steadies over distance.
  const wobble = amount * Math.min(6, Math.sqrt(length) * 0.55);
  const off = () => (r() - 0.5) * wobble;

  const sx = x1 + off() * 0.5;
  const sy = y1 + off() * 0.5;
  const ex = x2 + off() * 0.5;
  const ey = y2 + off() * 0.5;
  // Control points at a third and two thirds, pushed off the line.
  const nx = -dy / length;
  const ny = dx / length;
  const b1 = off();
  const b2 = off();
  return (
    `M${fmt(sx)},${fmt(sy)}C` +
    `${fmt(x1 + dx / 3 + nx * b1)},${fmt(y1 + dy / 3 + ny * b1)} ` +
    `${fmt(x1 + (dx * 2) / 3 + nx * b2)},${fmt(y1 + (dy * 2) / 3 + ny * b2)} ` +
    `${fmt(ex)},${fmt(ey)}`
  );
}

/** A line, gone over twice as a pen does when it matters. */
export function line(x1, y1, x2, y2, { amount = 1, passes = 2 } = {}) {
  const r = rng(seedFrom([x1, y1, x2, y2]));
  let d = "";
  for (let i = 0; i < passes; i++) d += stroke(x1, y1, x2, y2, r, amount);
  return d;
}

/** A closed curve through the given points, bowed between them. */
export function polyline(points, { amount = 1, passes = 2, close = false } = {}) {
  if (points.length < 2) return "";
  const r = rng(seedFrom([points.length, ...points[0], ...points[points.length - 1]]));
  let d = "";
  for (let pass = 0; pass < passes; pass++) {
    const list = close ? [...points, points[0]] : points;
    d += `M${fmt(list[0][0])},${fmt(list[0][1])}`;
    for (let i = 1; i < list.length; i++) {
      const [x1, y1] = list[i - 1];
      const [x2, y2] = list[i];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const bow = (r() - 0.5) * amount * Math.min(2.2, len * 0.22);
      d += `Q${fmt(x1 + dx / 2 + nx * bow)},${fmt(y1 + dy / 2 + ny * bow)} ${fmt(x2)},${fmt(y2)}`;
    }
  }
  return d;
}

/**
 * A circle traced by hand.
 *
 * Radius is modulated by a few sine terms at random phase rather than by
 * per-point noise: a hand drifts smoothly, so the deviation has to be smooth
 * too, or the result looks like a machine pretending. Each pass starts and ends
 * at a different angle so the seam is not always in the same place, and
 * overshoots slightly, which is what closing a circle actually looks like.
 */
export function circle(cx, cy, radius, { amount = 1, passes = 2, samples = 64 } = {}) {
  const r = rng(seedFrom([cx, cy, radius]));
  const wobble = amount * Math.min(1.4, 0.05 + radius * 0.012);
  let d = "";

  for (let pass = 0; pass < passes; pass++) {
    const phases = [r() * Math.PI * 2, r() * Math.PI * 2, r() * Math.PI * 2];
    const weights = [0.55, 0.3, 0.15];
    const start = r() * Math.PI * 2;
    const sweep = Math.PI * 2 + (0.06 + r() * 0.14);   // overshoot the join
    const points = [];
    for (let i = 0; i <= samples; i++) {
      const t = start + (sweep * i) / samples;
      const dr =
        wobble *
        (weights[0] * Math.sin(2 * t + phases[0]) +
         weights[1] * Math.sin(3 * t + phases[1]) +
         weights[2] * Math.sin(5 * t + phases[2]));
      points.push([cx + (radius + dr) * Math.cos(t), cy + (radius + dr) * Math.sin(t)]);
    }
    d += `M${fmt(points[0][0])},${fmt(points[0][1])}`;
    for (let i = 1; i < points.length; i++) d += `L${fmt(points[i][0])},${fmt(points[i][1])}`;
  }
  return d;
}

/**
 * Hatching across a circle, as shading rather than a fill.
 *
 * `density` is the gap between strokes in the same units as the radius, so it
 * stays visually constant as a diagram is scaled.
 */
export function hatchCircle(cx, cy, radius, {
  angle = -35, density = 1.6, amount = 1, passes = 1, inset = 0.2,
} = {}) {
  const r = rng(seedFrom([cx, cy, radius, angle]));
  const a = angle * (Math.PI / 180);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const reach = radius - inset;
  let d = "";

  for (let offset = -reach; offset <= reach; offset += density) {
    // Chord half-length at this distance from the centre.
    const half = Math.sqrt(Math.max(0, reach * reach - offset * offset));
    if (half < density * 0.35) continue;
    // Ends pulled in by a random amount, so the edge of the shading breathes.
    const trim = half * (0.02 + r() * 0.1);
    const x1 = cx + ca * (-half + trim) - sa * offset;
    const y1 = cy + sa * (-half + trim) + ca * offset;
    const x2 = cx + ca * (half - trim) - sa * offset;
    const y2 = cy + sa * (half - trim) + ca * offset;
    d += line(x1, y1, x2, y2, { amount: amount * 0.6, passes });
  }
  return d;
}

/** Hatching across an arbitrary polygon, by scanline. */
export function hatchPolygon(points, {
  angle = -35, density = 1.6, amount = 1, passes = 1,
} = {}) {
  if (points.length < 3) return "";
  const a = angle * (Math.PI / 180);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  // Work in a frame where the hatch direction is horizontal.
  const local = points.map(([x, y]) => [x * ca + y * sa, -x * sa + y * ca]);
  const ys = local.map((p) => p[1]);
  const r = rng(seedFrom([points.length, ...points[0], angle]));
  let d = "";

  for (let y = Math.min(...ys) + density; y < Math.max(...ys); y += density) {
    const xs = [];
    for (let i = 0; i < local.length; i++) {
      const [x1, y1] = local[i];
      const [x2, y2] = local[(i + 1) % local.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const span = xs[i + 1] - xs[i];
      if (span < density * 0.3) continue;
      const trim = span * (0.03 + r() * 0.08);
      const back = ([lx, ly]) => [lx * ca - ly * sa, lx * sa + ly * ca];
      const [ax, ay] = back([xs[i] + trim, y]);
      const [bx, by] = back([xs[i + 1] - trim, y]);
      d += line(ax, ay, bx, by, { amount: amount * 0.6, passes });
    }
  }
  return d;
}
