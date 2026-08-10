/* A minimal SVG writer.
 *
 * Builds markup as strings rather than DOM nodes, for the same reason the
 * Python does: the output has to be comparable between the two implementations
 * so a differential test can prove the port is faithful, and a string is what
 * gets written to a file or handed to `innerHTML` either way.
 *
 * Mirrors starchart/svg.py. Number formatting matches it exactly, because a
 * stray trailing zero would show up as a diff on every coordinate.
 */

/** Format a number the way starchart/svg.py does: fixed places, zeros trimmed. */
export function fmt(value, places = 3) {
  let s = Number(value).toFixed(places);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "" || s === "-0" ? "0" : s;
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ESCAPES[c]);

/** Turn a camelCase / trailing-underscore key into an SVG attribute name. */
function attrName(key) {
  return key
    .replace(/_+$/, "")
    .replace(/__/g, ":")
    .replace(/_/g, "-");
}

export function attrs(obj) {
  const parts = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    const v = typeof value === "number" ? fmt(value) : value;
    parts.push(`${attrName(key)}="${escape(v)}"`);
  }
  return parts.join(" ");
}

const tag = (name) => (attrObj) => `<${name} ${attrs(attrObj)}/>`;

export const circle = (cx, cy, r, rest = {}) => tag("circle")({ cx, cy, r, ...rest });
export const rect = (x, y, width, height, rest = {}) =>
  tag("rect")({ x, y, width, height, ...rest });
export const path = (d, rest = {}) => tag("path")({ d, ...rest });
export const line = (x1, y1, x2, y2, rest = {}) =>
  tag("line")({ x1, y1, x2, y2, ...rest });

export function text(x, y, content, rest = {}) {
  return `<text ${attrs({ x, y, ...rest })}>${escape(content)}</text>`;
}

export function group(children, rest = {}) {
  const a = attrs(rest);
  return `<g${a ? " " + a : ""}>${children.join("")}</g>`;
}

/** Path data from an iterable of [x, y]. */
export function polylineD(points, close = false) {
  if (!points.length) return "";
  const parts = [`M${fmt(points[0][0])},${fmt(points[0][1])}`];
  for (let i = 1; i < points.length; i++) {
    parts.push(`L${fmt(points[i][0])},${fmt(points[i][1])}`);
  }
  if (close) parts.push("Z");
  return parts.join("");
}

/** A ring wound for even-odd fill, as two circles. */
export function annulusD(cx, cy, outer, inner) {
  const ring = (r) =>
    `M${fmt(cx - r)},${fmt(cy)}` +
    `a${fmt(r)},${fmt(r)} 0 1 0 ${fmt(2 * r)},0` +
    `a${fmt(r)},${fmt(r)} 0 1 0 ${fmt(-2 * r)},0`;
  return ring(outer) + ring(inner);
}

/** Wrap a finished document. Units are millimetres, so it prints at real size. */
export function document_(width, height, defs, body) {
  const head = attrs({
    xmlns: "http://www.w3.org/2000/svg",
    "xmlns:xlink": "http://www.w3.org/1999/xlink",
    width: `${fmt(width)}mm`,
    height: `${fmt(height)}mm`,
    viewBox: `0 0 ${fmt(width)} ${fmt(height)}`,
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg ${head}><defs>${defs}</defs>${body}</svg>\n`;
}
