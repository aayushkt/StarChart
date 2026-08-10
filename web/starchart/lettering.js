/* Text set along a circular arc, one glyph at a time.
 *
 * Mirrors starchart/lettering.py, including the advance-width table, so the two
 * implementations place letters identically. SVG's <textPath> is deliberately
 * unused: librsvg drops it silently, which would mean hundreds of labels
 * vanishing with no error anywhere.
 */

import { attrs, fmt } from "./svg.js";

const DEFAULT_UPPER = 0.72;
const DEFAULT_LOWER = 0.5;

/** Cap height as a fraction of font size, for insetting labels off a circle. */
export const CAP_HEIGHT = 0.72;

export const ADVANCE = (() => {
  const table = {};
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") table[c] = DEFAULT_UPPER;
  for (const c of "abcdefghijklmnopqrstuvwxyz") table[c] = DEFAULT_LOWER;
  for (const c of "0123456789") table[c] = 0.5;
  for (const c of "MW") table[c] = 0.9;
  Object.assign(table, {
    I: 0.39, J: 0.48, L: 0.61, P: 0.58, S: 0.58, E: 0.61, F: 0.58,
    l: 0.28, i: 0.28, j: 0.28, t: 0.35, f: 0.35, r: 0.38,
    m: 0.78, w: 0.7, ".": 0.25, ",": 0.25, "'": 0.24, "-": 0.33,
    " ": 0.26, "(": 0.33, ")": 0.33, "°": 0.4,
  });
  return table;
})();

const isUpper = (c) => c !== c.toLowerCase() && c === c.toUpperCase();

export function advance(char, size) {
  const w = ADVANCE[char];
  return (w === undefined ? (isUpper(char) ? DEFAULT_UPPER : DEFAULT_LOWER) : w) * size;
}

export function textWidth(s, size, tracking = 0) {
  if (!s) return 0;
  let total = 0;
  for (const c of s) total += advance(c, size);
  return total + tracking * (s.length - 1);
}

/**
 * Set `content` centred on `centreDeg` along a circle, measured clockwise from
 * straight up -- the same convention the projection uses.
 */
export function arcText(cx, cy, radius, centreDeg, content, {
  size, tracking = 0, inward = false, ...rest
}) {
  const total = textWidth(content, size, tracking);
  if (total <= 0) return "";

  // Letters are laid out by arc length, so spacing stays even at any radius.
  const sweep = (total / radius) * (180 / Math.PI);
  const direction = inward ? -1 : 1;
  let cursor = centreDeg - (direction * sweep) / 2;

  const base = attrs(rest);
  const parts = [];
  for (const ch of content) {
    const step = (advance(ch, size) / radius) * (180 / Math.PI);
    const angle = cursor + (direction * step) / 2;
    const t = angle * (Math.PI / 180);
    const x = cx + radius * Math.sin(t);
    const y = cy - radius * Math.cos(t);
    const rot = inward ? angle + 180 : angle;

    if (ch.trim()) {
      parts.push(
        `<text ${base} x="${fmt(x)}" y="${fmt(y)}" text-anchor="middle" ` +
        `transform="rotate(${fmt(rot)} ${fmt(x)} ${fmt(y)})">${ch}</text>`
      );
    }
    cursor += direction * (step + (tracking / radius) * (180 / Math.PI));
  }
  return `<g>${parts.join("")}</g>`;
}
