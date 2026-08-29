/* The ornamental diagrams the original prints around its plates.
 *
 * The planets are to true relative size and true relative orbital distance, and
 * the Moon phases are geometric rather than drawn by eye. The eclipse diagrams
 * are schematic in their proportions -- at true scale the Sun would be four
 * hundred times further away than the panel is wide -- but the construction is
 * honest: the Moon is placed so its umbra converges exactly on the Earth's
 * surface, which is the fact the diagram exists to show.
 *
 * Each panel draws inside a box it is handed, so the layout can move and resize
 * them without any panel knowing where it sits.
 */

import { phasePoints } from "./bodies.js";
import { arcText, textWidth } from "./lettering.js";
import * as sketch from "./sketch.js";
import { circle, fmt, line, path, polylineD, text } from "./svg.js";

const RAD = Math.PI / 180;

/** Letter-spacing on a diagram's small caps, in the same units as the size.
 *
 * Exported because style.js emits it and this file measures against it. Kept in
 * one place after a measured label overlapped its neighbour: the measurement
 * left the tracking out, so two names that visibly collided were calculated to
 * clear each other by a millimetre. */
export const TICK_TRACKING = 0.3;

/** A diagram's own styling, over the shared defaults.
 *
 * Every panel reads its style through this, so overriding one value for one
 * diagram does not require touching any of the drawing code. */
export const panelStyle = (theme, name) => ({
  ...theme.panels,
  ...(theme.panelStyles?.[name] ?? {}),
});

/** Equatorial radius in km, semi-major axis in AU. */
export const PLANETS = [
  { name: "MERCURY", km: 2440, au: 0.3871 },
  { name: "VENUS", km: 6052, au: 0.7233 },
  { name: "EARTH", km: 6371, au: 1.0 },
  { name: "MARS", km: 3390, au: 1.5237 },
  { name: "JUPITER", km: 69911, au: 5.2034 },
  { name: "SATURN", km: 58232, au: 9.5371 },
  { name: "URANUS", km: 25362, au: 19.1913 },
  { name: "NEPTUNE", km: 24622, au: 30.069 },
];
export const SUN_KM = 696000;
const AU_MILLION_MILES = 92.956;

/* ---------------------------------------------------------------- the pen
 *
 * Every diagram draws through this rather than calling the SVG primitives, so
 * the difference between a ruled chart and a drawn one is one number in the
 * theme. At `hand: 0` it emits exactly what it always did -- crisp circles and
 * flat fills -- which is what makes the slider able to go back.
 *
 * Above zero, filled shapes become outline plus hatching. That is the part that
 * matters: wobbling the outline of a flat fill just gives you a wobbly flat
 * fill, and flat fill is most of what reads as machine-made.
 */

function pen(theme) {
  const hand = theme.panels.hand ?? 0;
  const on = hand > 0.001;
  const stroke = (d, cls, w) =>
    `<path d="${d}" class="${cls} hand" stroke-width="${fmt(w)}"/>`;

  return {
    on,
    hand,

    /** An outline, filled by nobody. */
    ring(cx, cy, r, cls, weight = 1) {
      if (!on) return circle(cx, cy, r, { class_: cls, fill: "none" });
      return stroke(sketch.circle(cx, cy, r, { amount: hand }),
                    cls, theme.panels.line_width * 1.9 * weight);
    },

    /** A body: a flat fill, or an outline with shading inside it. */
    disc(cx, cy, r, cls, { angle = -38, density = 1.9 } = {}) {
      if (!on) return circle(cx, cy, r, { class_: cls });
      const gap = Math.max(0.55, density * (0.6 + 0.4 / Math.max(0.4, hand)));
      return (
        stroke(sketch.hatchCircle(cx, cy, r, { angle, density: gap, amount: hand }),
               cls, theme.panels.line_width * 1.15) +
        stroke(sketch.circle(cx, cy, r, { amount: hand }),
               cls, theme.panels.line_width * 2.1)
      );
    },

    line(x1, y1, x2, y2, cls, weight = 1) {
      if (!on) return line(x1, y1, x2, y2, { class_: cls });
      return stroke(sketch.line(x1, y1, x2, y2, { amount: hand }),
                    cls, theme.panels.line_width * 1.5 * weight);
    },

    /** A closed run of points, optionally shaded. */
    shape(points, cls, { hatch = null, density = 1.7 } = {}) {
      if (!on) return path(polylineD(points, true), { class_: cls });
      let out = "";
      if (hatch !== null) {
        out += stroke(
          sketch.hatchPolygon(points, { angle: hatch, density, amount: hand }),
          cls, theme.panels.line_width * 1.1);
      }
      return out + stroke(sketch.polyline(points, { amount: hand, close: true }),
                          cls, theme.panels.line_width * 1.9);
    },

    /** An open run of points -- an orbit, a curve. */
    curve(points, cls, weight = 1) {
      if (!on) return path(polylineD(points), { class_: cls });
      return stroke(sketch.polyline(points, { amount: hand }),
                    cls, theme.panels.line_width * 1.6 * weight);
    },
  };
}

/** An ellipse as points, so the pen can draw it like anything else. */
function ellipsePoints(cx, cy, rx, ry, samples = 72) {
  const out = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return out;
}

/* -------------------------------------------------------------- helpers */

let clipSeq = 0;

function frame(box, title, theme, body) {
  const p = theme.panels;   // already resolved for this diagram by drawBand
  // Each panel is clipped to its own box. Several of these diagrams are only
  // legible because something runs off the edge -- the Sun's limb especially --
  // and without a clip that overflow lands on the rest of the poster.
  const id = `panel-clip-${clipSeq++}`;
  const parts = [];
  if (p.rule) {
    parts.push(line(box.x, box.y, box.x + box.w, box.y, { class_: "panel-rule" }));
  }
  // Some of these carry no heading at all -- an equation and a construction,
  // the way a page of working looks.
  if (title) {
    parts.push(text(box.x + box.w / 2, box.y + p.title_size + p.title_gap, title,
      { class_: "panel-title" }));
  }
  // Drawing first, heading over it: the Sun's limb in the size panel reaches
  // across where the title sits, and would otherwise paint over its first letter.
  return `<g class="panel">` +
    `<clipPath id="${id}">` +
    `<rect x="${fmt(box.x)}" y="${fmt(box.y)}" width="${fmt(box.w)}" height="${fmt(box.h)}"/>` +
    `</clipPath>` +
    `<g clip-path="url(#${id})">${body}</g>` +
    parts.join("") + `</g>`;
}

/** The drawing area below a panel's heading. */
const inner = (box, theme, titled = true) => {
  const p = theme.panels;
  const top = titled ? box.y + p.title_size + p.title_gap + p.title_space : box.y + 2;
  return { x: box.x, y: top, w: box.w, h: box.y + box.h - top,
           cx: box.x + box.w / 2, cy: (top + box.y + box.h) / 2 };
};

const caption = (x, y, s, cls = "panel-caption") =>
  text(x, y, s, { class_: cls });

/* ------------------------------------------------- comparative sizes */

function planetSizes(box, theme, ctx) {
  const a = inner(box, theme, false);
  // Everything is to one true scale, which is the whole point: at a size where
  // Jupiter is a visible disc, the Sun is ten times wider than the panel. So the
  // Sun appears as a limb sweeping through the left of the box, exactly as the
  // original prints "One Half of the Sun's Disk".
  // Two constraints, not one: Jupiter has to fit the panel's height, and the
  // whole row has to fit its width. Scaling off height alone overflows the box
  // as soon as the rows get taller, which silently clips the outer planets.
  const gap = 3.2;
  const spanKm = PLANETS.reduce((t, p) => t + 2 * p.km, 0);
  const byHeight = (a.h * 0.34) / PLANETS[4].km;
  const byWidth = (a.w * 0.74 - gap * (PLANETS.length - 1)) / spanKm;
  const scale = Math.min(byHeight, byWidth);
  const sunR = SUN_KM * scale;

  const P = pen(theme);
  const parts = [];
  const sunCx = a.x - sunR + a.w * 0.17;
  const sunCy = a.cy;
  parts.push(P.disc(sunCx, sunCy, sunR, "panel-sun", { angle: -34, density: 2.4 }));
  parts.push(caption(a.x + a.w * 0.07, a.cy, "THE SUN", "panel-note"));

  // Planets in a row, true to each other and to that same Sun.
  let x = a.x + a.w * 0.24;
  let lastRight = -Infinity;
  for (const planet of PLANETS) {
    const r = Math.max(0.28, planet.km * scale);
    x += r;
    // Below a millimetre a hatched disc is just a smudge, so the small ones
    // stay as marks.
    parts.push(r > 1.6 ? P.disc(x, a.cy, r, "panel-planet", { angle: -50, density: 1.4 })
                       : circle(x, a.cy, r, { class_: "panel-planet" }));
    /* Only the giants have room for a name beside them, and even then not
     * always: Uranus and Neptune are nearly the same size and sit next to each
     * other, so their names ran together into one word. Measured rather than
     * guessed -- a name that would not clear the last one drops to a second
     * line instead. */
    if (r > 2.2) {
      const half = textWidth(planet.name, theme.panels.tick_size, TICK_TRACKING) / 2;
      const low = x - half < lastRight + 2;
      parts.push(caption(x, a.cy + r + (low ? 7.6 : 3.4), planet.name, "panel-tick"));
      if (!low) lastRight = x + half;
    }
    x += r + gap;
  }
  parts.push(caption(a.x + a.w * 0.6, a.y + a.h - 0.5,
    `SUN ${(SUN_KM * 2).toLocaleString("en")} KM ACROSS · ` +
    `EARTH ${(PLANETS[2].km * 2).toLocaleString("en")} KM`, "panel-note"));

  return frame(box, "", theme, parts.join(""));
}

/* ------------------------------------------------------ magnitude key */

function magnitudeKey(box, theme, ctx) {
  const a = inner(box, theme, false);
  const radii = theme.stars.radii;
  const parts = [];

  parts.push(caption(a.cx, a.y + 3.5, "THE MAGNITUDES OF STARS ARE SHOWN THUS", "panel-note"));

  const step = Math.min(a.w / (radii.length + 2), 13);
  const first = a.cx - (step * (radii.length - 1)) / 2;
  const rowY = a.y + 12;
  radii.forEach((r, i) => {
    const x = first + i * step;
    if (i < theme.stars.halo_classes) {
      parts.push(circle(x, rowY, r * theme.stars.halo_scale, { class_: "star-halo" }));
    }
    parts.push(circle(x, rowY, r, { class_: "star" }));
    parts.push(caption(x, rowY + 6.5, ["1ST", "2ND", "3RD", "4TH", "5TH"][i], "panel-tick"));
  });

  // How the plate distinguishes the two kinds of name -- set in the faces the
  // chart actually uses, so the key is a true sample rather than a description.
  const col = a.w / 4;
  const noteY = rowY + 17;
  parts.push(caption(a.cx - col, noteY, "CONSTELLATIONS THUS", "panel-tick"));
  parts.push(text(a.cx - col, noteY + 7, "CANCER",
    { class_: "constel-label", text_anchor: "middle" }));
  parts.push(caption(a.cx + col, noteY, "STARS THUS", "panel-tick"));
  parts.push(text(a.cx + col, noteY + 7, "Altair",
    { class_: "star-label", text_anchor: "middle" }));

  return frame(box, "", theme, parts.join(""));
}

/* ------------------------------------------------------- solar system */

function solarSystem(box, theme, ctx) {
  const a = inner(box, theme, false);
  const cy = a.cy;
  const maxR = Math.min(a.w * 0.46, a.h * 0.46);
  const scale = maxR / PLANETS[PLANETS.length - 1].au;
  const parts = [];

  // A plan view, orbits true to scale. That crowds the inner four into a knot
  // at the centre, which is not a flaw in the drawing -- it is what the solar
  // system looks like, and the scale bar is what makes it readable.
  const P = pen(theme);
  for (const planet of PLANETS) {
    const r = planet.au * scale;
    parts.push(P.ring(a.cx, cy, r, "panel-orbit", 0.7));
    parts.push(circle(a.cx + r, cy, planet.au >= 5 ? 1.0 : 0.6, { class_: "panel-planet" }));
  }
  parts.push(circle(a.cx, cy, 1.6, { class_: "panel-sun" }));

  // Radii of the giants differ by only a few millimetres here, so the names
  // alternate above and below the line rather than sitting on top of each other.
  PLANETS.slice(4).forEach((planet, i) => {
    const r = planet.au * scale;
    const dy = i % 2 === 0 ? -2.4 : 4.4;
    parts.push(caption(a.cx + r, cy + dy, planet.name.slice(0, 3), "panel-tick"));
  });

  // A distance scale, which is what makes the crowding legible.
  const barR = 10 * scale;
  const barY = a.y + a.h - 1.5;
  parts.push(P.line(a.cx - barR / 2, barY, a.cx + barR / 2, barY, "panel-scale"));
  for (const dx of [-barR / 2, barR / 2]) {
    parts.push(P.line(a.cx + dx, barY - 1.4, a.cx + dx, barY + 1.4, "panel-scale"));
  }
  parts.push(caption(a.cx, barY - 2.6,
    `${Math.round(10 * AU_MILLION_MILES)} MILLION MILES`, "panel-tick"));

  return frame(box, "", theme, parts.join(""));
}

/* ----------------------------------------------------------- eclipses */

/** Shared construction: a lit body, an occulter, and the shadow cone it casts. */
function shadowCone(sunX, sunR, bodyX, bodyR, cy) {
  // Outer tangents from the Sun's limb past the body converge at the umbra tip.
  const t = (sunR - bodyR) === 0 ? 1e6 : (bodyX - sunX) * bodyR / (sunR - bodyR);
  const tipX = bodyX + t;
  return {
    tipX,
    upper: [[sunX, cy - sunR], [tipX, cy]],
    lower: [[sunX, cy + sunR], [tipX, cy]],
  };
}

function solarEclipse(box, theme, ctx) {
  const a = inner(box, theme, false);
  const cy = a.cy;
  const sunR = a.h * 0.34;
  // Clear of the edge by its own radius: the half-Sun belongs to the size
  // comparison, where running off the panel is the point. Here it just looks
  // clipped.
  const sunX = a.x + sunR + 1.5;
  const earthR = sunR * 0.42;
  const earthX = a.x + a.w - earthR - 2;
  const moonR = earthR * 0.27;

  // Place the Moon so the umbra converges on the Earth's surface rather than
  // somewhere short of it. A shadow that stops in mid-air would show the
  // opposite of what the panel is for -- totality happens precisely because the
  // cone just reaches us, which is also why the track of totality is narrow.
  const k = moonR / (sunR - moonR);
  const moonX = (earthX - earthR + sunX * k) / (1 + k);

  const cone = shadowCone(sunX, sunR, moonX, moonR, cy);
  const P = pen(theme);
  const parts = [
    P.disc(sunX, cy, sunR, "panel-sun", { angle: -34, density: 2.2 }),
    // The umbra, narrowing to a point that just reaches the Earth -- which is
    // why totality is only ever seen from a narrow track.
    P.shape([[moonX, cy - moonR], [cone.tipX, cy], [moonX, cy + moonR]],
      "panel-umbra", { hatch: 4, density: 1.3 }),
    P.line(sunX, cy - sunR, cone.tipX, cy, "panel-ray"),
    P.line(sunX, cy + sunR, cone.tipX, cy, "panel-ray"),
    P.disc(earthX, cy, earthR, "panel-earth", { angle: -52, density: 1.5 }),
    P.disc(moonX, cy, moonR, "panel-moon", { angle: 24, density: 0.9 }),
    caption(sunX, cy - sunR - 2.4, "SUN", "panel-tick"),
    caption(moonX, cy - moonR - 2.4, "MOON", "panel-tick"),
    caption(earthX, cy - earthR - 2.4, "EARTH", "panel-tick"),
  ];
  return frame(box, "", theme, parts.join(""));
}

function lunarEclipse(box, theme, ctx) {
  const a = inner(box, theme, false);
  const cy = a.cy;
  const sunR = a.h * 0.34;
  const sunX = a.x + sunR + 1.5;
  const earthR = sunR * 0.42;
  // Off what is left to the right of the Sun, not off the whole panel, or
  // moving the Sun in pushes the shadow cone out through the far edge.
  const earthX = sunX + (a.x + a.w - sunX) * 0.42;
  const moonR = earthR * 0.27;

  const cone = shadowCone(sunX, sunR, earthX, earthR, cy);
  const moonX = earthX + (cone.tipX - earthX) * 0.55;
  const P = pen(theme);

  const parts = [
    P.disc(sunX, cy, sunR, "panel-sun", { angle: -34, density: 2.2 }),
    P.shape([[earthX, cy - earthR], [cone.tipX, cy], [earthX, cy + earthR]],
      "panel-umbra", { hatch: 6, density: 1.5 }),
    P.line(sunX, cy - sunR, cone.tipX, cy, "panel-ray"),
    P.line(sunX, cy + sunR, cone.tipX, cy, "panel-ray"),
    P.disc(earthX, cy, earthR, "panel-earth", { angle: -52, density: 1.5 }),
    P.disc(moonX, cy, moonR, "panel-moon-dark", { angle: 18, density: 0.85 }),
    caption(sunX, cy - sunR - 2.4, "SUN", "panel-tick"),
    caption(earthX, cy - earthR - 2.4, "EARTH", "panel-tick"),
    caption(moonX, cy + moonR + 4.6, "MOON", "panel-tick"),
  ];
  return frame(box, "", theme, parts.join(""));
}

/* -------------------------------------------------- earth's revolution */

function earthRevolution(box, theme, ctx) {
  const a = inner(box, theme, false);
  const rx = a.w * 0.40;
  const ry = a.h * 0.24;
  const cy = a.cy;
  const earthR = Math.min(a.h * 0.11, 4.2);

  const P = pen(theme);
  const parts = [
    P.on
      ? P.shape(ellipsePoints(a.cx, cy, rx, ry), "panel-orbit")
      : path(`M${fmt(a.cx - rx)},${fmt(cy)}a${fmt(rx)},${fmt(ry)} 0 1 0 ${fmt(2 * rx)},0` +
             `a${fmt(rx)},${fmt(ry)} 0 1 0 ${fmt(-2 * rx)},0`, { class_: "panel-orbit" }),
    P.disc(a.cx, cy, 2.6, "panel-sun", { angle: -40, density: 1.1 }),
  ];

  // The four stations, in the positions the original gives them.
  const stations = [
    [-1, 0, "21-03"],
    [0, -1, "21-06"],
    [1, 0, "23-09"],
    [0, 1, "21-12"],
  ];
  for (const [dx, dy, when] of stations) {
    const x = a.cx + dx * rx;
    const y = cy + dy * ry;
    parts.push(P.disc(x, y, earthR, "panel-earth", { angle: -48, density: 1.2 }));
    // Axial tilt, drawn because it is the whole reason the seasons happen.
    parts.push(P.line(x - earthR * 0.4, y - earthR * 1.5,
                      x + earthR * 0.4, y + earthR * 1.5, "panel-axis"));
    // Both lines sit above the globe at the bottom station; below it there is
    // no room before the panel edge.
    const ty = dy > 0 ? y + earthR + 5.2 : y - earthR - 3.4;
    parts.push(caption(x, ty, when, "panel-tick"));
  }
  return frame(box, "", theme, parts.join(""));
}

/* ------------------------------------------------ illumination of moon */

function moonIllumination(box, theme, ctx) {
  const a = inner(box, theme, false);
  const ring = Math.min(a.w * 0.34, a.h * 0.36);
  const moonR = Math.max(2.0, ring * 0.17);
  const parts = [];

  // Sunlight arrives from the left; the lit limbs all facing that way say so
  // without a bundle of stray lines and a label to explain them.
  const P = pen(theme);

  parts.push(P.ring(a.cx, a.cy, ring, "panel-orbit", 0.8));
  parts.push(P.disc(a.cx, a.cy, Math.max(2.4, moonR * 1.3), "panel-earth",
                    { angle: -48, density: 1.2 }));

  // Eight stations round the orbit. Illumination is geometric: the fraction lit
  // as seen from Earth depends only on the angle from the Sun.
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * 360;
    const t = angle * RAD;
    const x = a.cx - ring * Math.cos(t);   // new moon sits toward the Sun
    const y = a.cy + ring * Math.sin(t);
    const lit = (1 - Math.cos(t)) / 2;
    // Position angle of the Sun as seen from this station.
    const pa = (Math.atan2(a.cy - y, a.x - x) * 180) / Math.PI;
    // The dark limb is hatched and the lit part left as paper -- which is how
    // the phase is shown in every engraving of this, and reads far better than
    // two flat tones.
    const body = P.on
      ? P.ring(0, 0, moonR, "panel-moon-dark", 0.9) +
        P.shape(phasePoints(moonR, 1 - lit).map(([px, py]) => [-px, py]),
                "panel-moon-dark", { hatch: 30, density: 0.75 })
      : circle(0, 0, moonR, { class_: "panel-moon-dark" }) +
        path(polylineD(phasePoints(moonR, lit), true), { class_: "panel-moon" });
    parts.push(
      `<g transform="translate(${fmt(x)},${fmt(y)}) rotate(${fmt(pa)})">${body}</g>`);
  }

  const label = (dx, dy, s) => caption(a.cx + dx, a.cy + dy, s, "panel-tick");
  parts.push(label(-ring - 6, -2, "NEW"));
  parts.push(label(ring + 6, -2, "FULL"));
  parts.push(label(0, -ring - 3.4, "FIRST QR"));
  parts.push(label(0, ring + 5.6, "LAST QR"));

  return frame(box, "", theme, parts.join(""));
}

/* ----------------------------------------------- physics, in the margins
 *
 * These carry no captions -- an equation and a construction, the way a page of
 * working looks. Notation is set in italic serif rather than a label typeface,
 * because it is meant to read as something written, not something printed.
 */

const eq = (x, y, content, size, cls = "panel-eq") =>
  `<text x="${fmt(x)}" y="${fmt(y)}" class="${cls}" ` +
  `font-size="${fmt(size)}" text-anchor="middle">${content}</text>`;

/* A block of working, set as a page rather than a table.
 *
 * The lines are left-aligned but not flush: each is nudged a fraction of a
 * millimetre sideways, dropped a hair off its baseline and rotated a fraction
 * of a degree. That irregularity is most of the difference between working and
 * a list of results. It is seeded from the block's own position, so a re-render
 * after moving a slider does not reshuffle the page.
 *
 * A line is a string, or an object: `indent` in ems, `scale` against the base
 * size, `rule` to underline it the way a result gets underlined. An empty
 * string is a half-line of air.
 */
function scrawl(x, y, lines, size, theme, { lead = 1.6, wander = 1 } = {}) {
  const r = sketch.rng(sketch.seedFrom([x, y, lines.length]));
  const P = pen(theme);
  const out = [];
  let cy = y;

  for (const raw of lines) {
    const l = typeof raw === "string" ? { text: raw } : raw;
    if (!l.text) { cy += size * lead * 0.5; continue; }
    const s = size * (l.scale ?? 1);
    const lx = x + (l.indent ?? 0) * size + (r() - 0.5) * wander * 1.5;
    const ly = cy + (r() - 0.5) * wander * 0.8;
    const tilt = (r() - 0.5) * wander * 1.5;
    out.push(
      `<text x="${fmt(lx)}" y="${fmt(ly)}" class="panel-eq" font-size="${fmt(s)}" ` +
      `transform="rotate(${fmt(tilt)} ${fmt(lx)} ${fmt(ly)})">${l.text}</text>`);
    if (l.rule) {
      // Measured off the text with its markup stripped -- close enough for a
      // line drawn under it by hand, which is not meant to be flush anyway.
      const w = textWidth(l.text.replace(/<[^>]*>/g, ""), s);
      out.push(P.line(lx - s * 0.15, ly + s * 0.42, lx + w * 0.98, ly + s * 0.42,
                      "panel-axis", 0.75));
    }
    cy += size * lead * (l.scale ?? 1);
  }
  return out.join("");
}

/** Euler's formula, with the unit circle it is a statement about. */
function euler(box, theme, ctx) {
  const a = inner(box, theme, false);
  const P = pen(theme);
  const size = theme.panels.caption_size * 1.15;
  const R = Math.min(a.w * 0.2, a.h * 0.34);
  const cx = a.x + a.w * 0.22;
  const cy = a.cy + a.h * 0.02;
  const th = 52 * RAD;
  const px = cx + R * Math.cos(th);
  const py = cy - R * Math.sin(th);
  const parts = [];

  parts.push(P.ring(cx, cy, R, "panel-orbit", 0.7));
  parts.push(P.line(cx - R * 1.14, cy, cx + R * 1.18, cy, "panel-axis", 0.6));
  parts.push(P.line(cx, cy + R * 1.14, cx, cy - R * 1.18, "panel-axis", 0.6));
  // The radius, and the two legs it is the hypotenuse of: cos on the real
  // axis, sin up the imaginary one. That is the whole content of the formula.
  parts.push(P.line(cx, cy, px, py, "panel-ray", 1.1));
  parts.push(P.line(px, py, px, cy, "panel-axis", 0.55));
  parts.push(P.line(cx, py, px, py, "panel-axis", 0.55));
  parts.push(circle(px, py, 0.75, { class_: "panel-planet" }));
  // The angle itself, as a short arc at the origin.
  const arc = [];
  for (let i = 0; i <= 14; i++) {
    const t = (th * i) / 14;
    arc.push([cx + R * 0.3 * Math.cos(t), cy - R * 0.3 * Math.sin(t)]);
  }
  parts.push(P.curve(arc, "panel-axis", 0.5));
  parts.push(eq(cx + R * 0.44, cy - R * 0.14, "θ", size));

  parts.push(scrawl(a.x + a.w * 0.46, a.y + a.h * 0.2, [
    "e<tspan baseline-shift=\"super\" font-size=\"70%\">iθ</tspan> = Σ (iθ)<tspan baseline-shift=\"super\" font-size=\"70%\">n</tspan>⁄ n!",
    { text: "= (1 − θ²⁄2! + θ⁴⁄4! − …)", indent: 0.9 },
    { text: "+ i (θ − θ³⁄3! + θ⁵⁄5! − …)", indent: 0.9 },
    "",
    "e<tspan baseline-shift=\"super\" font-size=\"70%\">iθ</tspan> = cos θ + i sin θ",
    { text: "z(t) = a e<tspan baseline-shift=\"super\" font-size=\"70%\">iωt</tspan>", indent: 0.9 },
    "",
    { text: "θ = π :", indent: 0 },
    { text: "e<tspan baseline-shift=\"super\" font-size=\"70%\">iπ</tspan> + 1 = 0",
      indent: 1.2, scale: 1.25, rule: true },
  ], size, theme));
  return frame(box, "", theme, parts.join(""));
}

/** The Gaussian integral, done the only way it can be: in polar coordinates. */
function gaussian(box, theme, ctx) {
  const a = inner(box, theme, false);
  const P = pen(theme);
  const size = theme.panels.caption_size * 1.15;
  const cx = a.x + a.w * 0.21;
  const base = a.y + a.h * 0.78;
  const half = Math.min(a.w * 0.17, a.h * 0.42);
  const height = a.h * 0.5;
  const parts = [];

  // The curve is the actual e^(-x^2), sampled -- a drawn bell would be a
  // different function, and this diagram is about that one.
  const bell = [];
  for (let i = 0; i <= 72; i++) {
    const x = -2.6 + (5.2 * i) / 72;
    bell.push([cx + (x / 2.6) * half, base - Math.exp(-x * x) * height]);
  }
  parts.push(P.curve(bell, "panel-orbit", 0.8));
  parts.push(P.line(cx - half * 1.15, base, cx + half * 1.15, base, "panel-axis", 0.6));
  parts.push(P.line(cx, base + 2.5, cx, base - height * 1.08, "panel-axis", 0.6));
  // Shaded, because the quantity being computed is the area under it. Through
  // the pen rather than around it: hatching it directly meant the ruled sheet
  // still emitted hand-drawn strokes, which is the one thing hand:0 promises
  // it will not do.
  parts.push(P.shape(bell.concat([[cx + half, base], [cx - half, base]]),
                     "panel-umbra", { hatch: -62, density: 2.1 }));

  parts.push(scrawl(a.x + a.w * 0.44, a.y + a.h * 0.19, [
    "I = ∫<tspan baseline-shift=\"sub\" font-size=\"65%\">−∞</tspan><tspan baseline-shift=\"super\" font-size=\"65%\">∞</tspan> e<tspan baseline-shift=\"super\" font-size=\"70%\">−x²</tspan> dx",
    "",
    "I² = ∫∫ e<tspan baseline-shift=\"super\" font-size=\"70%\">−(x²+y²)</tspan> dx dy",
    { text: "= ∫<tspan baseline-shift=\"sub\" font-size=\"65%\">0</tspan><tspan baseline-shift=\"super\" font-size=\"65%\">2π</tspan> ∫<tspan baseline-shift=\"sub\" font-size=\"65%\">0</tspan><tspan baseline-shift=\"super\" font-size=\"65%\">∞</tspan> e<tspan baseline-shift=\"super\" font-size=\"70%\">−r²</tspan> r dr dθ",
      indent: 1.0 },
    { text: "= 2π · ½ = π", indent: 1.0 },
    "",
    { text: "I = √π", indent: 0.6, scale: 1.25, rule: true },
  ], size, theme));
  return frame(box, "", theme, parts.join(""));
}

/** Epicycles: a Fourier series is the Ptolemaic construction, exactly.
 *
 * Not a loose analogy. A sum of terms c_n e^(i n omega t) is a circle whose
 * centre rides a circle whose centre rides a circle, which is the deferent and
 * epicycle drawing verbatim -- and the retrograde loop it makes is the one Mars
 * appears to trace.
 */
function epicycles(box, theme, ctx) {
  const a = inner(box, theme, false);
  const P = pen(theme);
  const size = theme.panels.caption_size * 1.15;
  const cx = a.x + a.w * 0.2;
  const cy = a.cy + a.h * 0.02;
  const R = Math.min(a.w * 0.15, a.h * 0.36);
  // A deferent and one epicycle. Three terms drew a rosette that read as
  // ornament; two draw the retrograde loops, which is the thing being claimed.
  const terms = [[R, 1], [R * 0.38, 6]];
  const parts = [];

  parts.push(P.ring(cx, cy, R, "panel-axis", 0.5));
  const at = (t) => {
    let x = cx, y = cy;
    for (const [r, k] of terms) { x += r * Math.cos(k * t); y += r * Math.sin(k * t); }
    return [x, y];
  };
  const traced = [];
  for (let i = 0; i <= 400; i++) traced.push(at((i / 400) * Math.PI * 2));
  parts.push(P.curve(traced, "panel-orbit", 0.75));

  // One instant frozen: the chain of radii that puts the body where it is.
  const t0 = 0.62;
  let px = cx, py = cy;
  for (const [r, k] of terms) {
    const nx = px + r * Math.cos(k * t0);
    const ny = py + r * Math.sin(k * t0);
    if (r < R) parts.push(P.ring(px, py, r, "panel-axis", 0.4));
    parts.push(P.line(px, py, nx, ny, "panel-ray", 0.9));
    parts.push(circle(px, py, 0.5, { class_: "panel-planet" }));
    px = nx; py = ny;
  }
  parts.push(circle(px, py, 1.0, { class_: "panel-planet" }));

  parts.push(scrawl(a.x + a.w * 0.42, a.y + a.h * 0.2, [
    "z(t) = Σ c<tspan baseline-shift=\"sub\" font-size=\"65%\">n</tspan> e<tspan baseline-shift=\"super\" font-size=\"70%\">i n ω t</tspan>",
    { text: "= c<tspan baseline-shift=\"sub\" font-size=\"65%\">1</tspan> e<tspan baseline-shift=\"super\" font-size=\"70%\">iωt</tspan> + c<tspan baseline-shift=\"sub\" font-size=\"65%\">2</tspan> e<tspan baseline-shift=\"super\" font-size=\"70%\">2iωt</tspan> + …",
      indent: 0.9 },
    "",
    "c<tspan baseline-shift=\"sub\" font-size=\"65%\">n</tspan> = <tspan font-size=\"85%\">1⁄2π</tspan> ∫<tspan baseline-shift=\"sub\" font-size=\"65%\">0</tspan><tspan baseline-shift=\"super\" font-size=\"65%\">2π</tspan> z(t) e<tspan baseline-shift=\"super\" font-size=\"70%\">−i n ω t</tspan> dt",
    "",
    { text: "deferent + epicycle = Σ", rule: true },
  ], size, theme));
  return frame(box, "", theme, parts.join(""));
}

/** Kepler's equation, with the construction that defines the eccentric anomaly.
 *
 * The transcendental one: given where a body is in time, M follows immediately
 * and E does not, and there is no closed form for it. The iteration below is
 * what everybody actually runs, and it converges in three or four passes at
 * eccentricities like this one.
 */
function keplerEquation(box, theme, ctx) {
  const a = inner(box, theme, false);
  const P = pen(theme);
  const size = theme.panels.caption_size * 1.15;
  const ecc = 0.6;
  const A = Math.min(a.w * 0.17, a.h * 0.4);
  const B = A * Math.sqrt(1 - ecc * ecc);
  const cx = a.x + a.w * 0.21;
  const cy = a.cy + a.h * 0.02;
  const fx = cx - A * ecc;          // the occupied focus
  const E = 58 * RAD;
  const qx = cx + A * Math.cos(E), qy = cy - A * Math.sin(E);
  const px = qx, py = cy - B * Math.sin(E);
  const parts = [];

  // The auxiliary circle, and the orbit inscribed in it. The eccentric anomaly
  // is an angle on the circle, not on the ellipse -- which is the entire reason
  // the circle is drawn at all.
  parts.push(P.ring(cx, cy, A, "panel-axis", 0.5));
  parts.push(P.curve(ellipsePoints(cx, cy, A, B, 72).concat([[cx + A, cy]]),
                     "panel-orbit", 0.8));
  parts.push(P.line(cx - A * 1.08, cy, cx + A * 1.08, cy, "panel-axis", 0.5));
  parts.push(P.line(cx, cy, qx, qy, "panel-ray", 0.9));
  // The ordinate that carries the circle's point down onto the ellipse.
  parts.push(P.line(qx, qy, qx, cy, "panel-axis", 0.45));
  parts.push(P.line(fx, cy, px, py, "panel-ray", 0.9));
  parts.push(circle(qx, qy, 0.6, { class_: "panel-planet" }));
  parts.push(circle(px, py, 1.0, { class_: "panel-planet" }));
  parts.push(P.disc(fx, cy, A * 0.08, "panel-sun", { angle: -40, density: 0.9 }));
  parts.push(eq(cx + A * 0.32, cy - A * 0.11, "E", size));
  parts.push(eq(fx + A * 0.36, cy - A * 0.1, "ν", size));

  parts.push(scrawl(a.x + a.w * 0.44, a.y + a.h * 0.19, [
    "M = <tspan font-size=\"85%\">2π⁄T</tspan> (t − t<tspan baseline-shift=\"sub\" font-size=\"65%\">0</tspan>)",
    "",
    { text: "M = E − e sin E", scale: 1.2, rule: true },
    "",
    { text: "no closed form for E :", indent: 0 },
    { text: "E ← E − <tspan font-size=\"90%\">(E − e sin E − M)⁄(1 − e cos E)</tspan>",
      indent: 0.8 },
    "",
    { text: "tan <tspan font-size=\"85%\">ν⁄2</tspan> = √<tspan font-size=\"85%\">((1+e)⁄(1−e))</tspan> tan <tspan font-size=\"85%\">E⁄2</tspan>",
      indent: 0 },
  ], size, theme));
  return frame(box, "", theme, parts.join(""));
}

/** The middle of a run of points, lifted clear of the line it labels. */
function midOf(points) {
  const m = points[Math.floor(points.length / 2)];
  return [m[0], m[1] - 1.6];
}

/** The spherical triangle this chart draws its own horizon with.
 *
 * Pole, zenith and star. The law of cosines on that triangle is what turns a
 * declination and an hour angle into an altitude, which is the calculation
 * behind the horizon curve on the plates above -- so the poster carries its own
 * working in the margin.
 */
function spherical(box, theme, ctx) {
  const a = inner(box, theme, false);
  const P = pen(theme);
  const size = theme.panels.caption_size * 1.15;
  const R = Math.min(a.w * 0.19, a.h * 0.42);
  const cx = a.x + a.w * 0.21;
  const cy = a.cy + a.h * 0.02;
  const parts = [];

  const norm = (v) => { const m = Math.hypot(...v); return v.map((c) => c / m); };
  const proj = ([x, y]) => [cx + R * x, cy - R * y];
  // Three vertices, all on the near face of the sphere.
  const Pole = norm([-0.12, 0.82, 0.56]);
  const Zen = norm([-0.62, 0.3, 0.72]);
  const Star = norm([0.52, -0.22, 0.83]);

  /* Great-circle arcs, by slerp and orthographic projection. A straight line
   * between the two projected points is the wrong curve, and on a triangle this
   * open the difference is plainly visible. */
  const arc = (u, v, n = 28) => {
    const dot = Math.max(-1, Math.min(1, u.reduce((t, c, i) => t + c * v[i], 0)));
    const om = Math.acos(dot);
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const s1 = Math.sin((1 - t) * om) / Math.sin(om);
      const s2 = Math.sin(t * om) / Math.sin(om);
      out.push(proj([u[0] * s1 + v[0] * s2, u[1] * s1 + v[1] * s2]));
    }
    return out;
  };

  parts.push(P.ring(cx, cy, R, "panel-axis", 0.5));
  // The equator seen near edge-on, so the sphere reads as one.
  parts.push(P.curve(ellipsePoints(cx, cy, R, R * 0.3, 60).concat([[cx + R, cy]]),
                     "panel-axis", 0.35));
  for (const [u, v] of [[Pole, Zen], [Pole, Star], [Zen, Star]]) {
    parts.push(P.curve(arc(u, v), "panel-orbit", 0.85));
  }
  for (const [v, label, dx, dy] of [[Pole, "P", 0, -2.6], [Zen, "Z", -2.8, -1.2],
                                    [Star, "S", 2.6, 1.6]]) {
    const [x, y] = proj(v);
    parts.push(circle(x, y, 0.8, { class_: "panel-planet" }));
    parts.push(eq(x + dx, y + dy, label, size));
  }
  // The sides, named for what they are: the co-latitude, the polar distance,
  // and the zenith distance the whole calculation is after.
  parts.push(eq(...midOf(arc(Pole, Zen)), "90−φ", size * 0.8));
  parts.push(eq(...midOf(arc(Pole, Star)), "90−δ", size * 0.8));
  parts.push(eq(...midOf(arc(Zen, Star)), "90−h", size * 0.8));

  parts.push(scrawl(a.x + a.w * 0.44, a.y + a.h * 0.2, [
    "cos c = cos a cos b + sin a sin b cos C",
    "",
    { text: "a = 90−φ,  b = 90−δ,  C = H :", indent: 0 },
    { text: "sin h = sin φ sin δ + cos φ cos δ cos H", scale: 1.1, indent: 0.4,
      rule: true },
    "",
    { text: "h = 0  ⇒  the horizon", indent: 0.4 },
  ], size, theme));
  return frame(box, "", theme, parts.join(""));
}

/** Newton's law of gravitation, with the two masses that motivate it. */
function gravitation(box, theme, ctx) {
  const a = inner(box, theme, false);
  const P = pen(theme);
  const cy = a.cy + a.h * 0.04;
  const bigR = a.h * 0.13;
  const smallR = a.h * 0.075;
  const bigX = a.x + a.w * 0.24;
  const smallX = a.x + a.w * 0.76;
  const parts = [];

  /* The inverse square, drawn: rings of field thinning with distance. Sized to
   * the room actually available rather than to a multiple of the mass -- the
   * outermost was two thirds of the panel height across and left through three
   * of its four sides. */
  const room = Math.min(bigX - a.x, cy - a.y, a.y + a.h - cy) - 2;
  const rings = 5;
  for (let i = 1; i <= rings; i++) {
    parts.push(P.ring(bigX, cy, bigR + ((room - bigR) * i) / rings,
                      "panel-orbit", 0.5));
  }
  parts.push(P.disc(bigX, cy, bigR, "panel-planet", { angle: -42, density: 1.5 }));
  parts.push(P.disc(smallX, cy, smallR, "panel-planet", { angle: 38, density: 1.1 }));

  // Equal and opposite.
  const gap = smallX - bigX;
  const arrow = (from, dir) => {
    const tip = from + dir * gap * 0.12;
    return P.line(from, cy - bigR * 1.9, tip, cy - bigR * 1.9, "panel-ray") +
      P.line(tip, cy - bigR * 1.9, tip - dir * gap * 0.035, cy - bigR * 1.9 - gap * 0.02, "panel-ray") +
      P.line(tip, cy - bigR * 1.9, tip - dir * gap * 0.035, cy - bigR * 1.9 + gap * 0.02, "panel-ray");
  };
  parts.push(arrow(bigX + gap * 0.28, 1));
  parts.push(arrow(smallX - gap * 0.28, -1));
  for (const x of [bigX, smallX]) {
    parts.push(P.line(x, cy + bigR * 1.45, x, cy + bigR * 1.95, "panel-scale"));
  }
  parts.push(P.line(bigX, cy + bigR * 1.7, smallX, cy + bigR * 1.7, "panel-scale"));
  parts.push(eq((bigX + smallX) / 2, cy + bigR * 1.7 + theme.panels.tick_size * 1.5,
    "r", theme.panels.tick_size * 1.4));
  parts.push(eq(a.cx, a.y + theme.panels.caption_size * 1.6,
    "F = G M m / r²", theme.panels.caption_size * 1.5));
  return frame(box, "", theme, parts.join(""));
}

/** The rubber sheet: a grid drawn down into a well. */
function spacetime(box, theme, ctx) {
  const a = inner(box, theme, false);
  const P = pen(theme);
  const cx = a.cx;
  const cy = a.cy + a.h * 0.12;
  const depth = a.h * 0.42;
  const half = Math.min(a.w, a.h * 2.4) * 0.46;
  const squash = 0.42;
  const parts = [];

  // A mass deforms the sheet as 1/r, softened at the centre so it stays drawn
  // rather than going to infinity.
  const well = (x, y) => {
    const r = Math.hypot(x, y);
    return -depth / (1 + (r / (half * 0.34)) ** 2);
  };
  const project = (x, y) => [cx + x, cy + y * squash + well(x, y)];

  const lines = 9;
  for (let i = 0; i <= lines; i++) {
    const t = -half + (2 * half * i) / lines;
    const along = [], across = [];
    for (let j = 0; j <= 40; j++) {
      const u = -half + (2 * half * j) / 40;
      along.push(project(u, t));
      across.push(project(t, u));
    }
    parts.push(P.curve(along, "panel-orbit", 0.55));
    parts.push(P.curve(across, "panel-orbit", 0.55));
  }
  parts.push(P.disc(cx, cy + well(0, 0) + depth * 0.06, a.h * 0.055, "panel-planet",
    { angle: -40, density: 1.0 }));
  parts.push(eq(a.cx, a.y + theme.panels.caption_size * 1.5,
    "G<tspan baseline-shift=\"sub\" font-size=\"70%\">μν</tspan> = 8πG T" +
    "<tspan baseline-shift=\"sub\" font-size=\"70%\">μν</tspan> / c⁴",
    theme.panels.caption_size * 1.4));
  return frame(box, "", theme, parts.join(""));
}

/** Horizon, photon sphere, disc, and light that does not get away. */
function blackHole(box, theme, ctx) {
  const a = inner(box, theme, false);
  const P = pen(theme);
  const cx = a.cx;
  // Sized so the rays have somewhere to be: the horizon has to be small enough
  // that a few impact parameters still fit above the disc and inside the box.
  const cy = a.cy + a.h * 0.16;
  const rs = Math.min(a.w, a.h) * 0.11;
  const parts = [];

  // The accretion disc, edge on.
  for (const k of [2.6, 3.4, 4.2]) {
    const pts = [];
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * Math.PI * 2;
      pts.push([cx + rs * k * Math.cos(t), cy + rs * k * 0.26 * Math.sin(t)]);
    }
    parts.push(P.curve(pts.concat([pts[0]]), "panel-orbit", 0.55));
  }
  // Photon sphere at 1.5 rs, then the horizon itself, filled with nothing.
  parts.push(P.ring(cx, cy, rs * 1.5, "panel-ray", 0.6));
  parts.push(P.disc(cx, cy, rs, "panel-planet", { angle: -45, density: 0.8 }));

  /* Light bending past, closer rays bent harder. The deflection is 4GM/c²b --
   * twice what Newton would give -- which is 2rs/b in these units, and the
   * curve is straight on the way in and leaves at that angle rather than
   * bowing symmetrically, which is the shape the geometry actually has.
   *
   * Scaled *down*, not up: at impact parameters this close the weak-field
   * formula would ask for a 115-degree bend, which it is nowhere near valid
   * for. The factor buys a legible angle, not a claimed one. */
  const exaggerate = 0.52;
  for (const k of [1.7, 2.4, 3.3, 4.4]) {
    const impact = rs * k;
    const alpha = ((2 * rs) / impact) * exaggerate;
    const soften = impact * 0.85;
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const x = -a.w * 0.47 + (a.w * 0.94 * i) / 60;
      // Horizontal as x goes to minus infinity, sloping by alpha as it leaves.
      const drop = (alpha / 2) * (x + Math.sqrt(x * x + soften * soften) - soften);
      pts.push([cx + x, cy - impact + drop]);
    }
    parts.push(P.curve(pts, "panel-ray", 0.5));
  }
  parts.push(eq(a.cx, a.y + theme.panels.caption_size * 1.5,
    "r<tspan baseline-shift=\"sub\" font-size=\"70%\">s</tspan> = 2GM / c²",
    theme.panels.caption_size * 1.4));
  return frame(box, "", theme, parts.join(""));
}

/** Kepler's second law: equal areas in equal times.
 *
 * The two sectors are solved to be equal rather than eyeballed. That is the
 * whole claim of the picture, and a drawing where they visibly are not makes
 * the opposite one.
 */
function equalAreas(box, theme, ctx) {
  const a = inner(box, theme, false);
  const P = pen(theme);
  // Eccentricity is chosen, not inherited from the panel's proportions. Taking
  // it from the box gave e = 0.9 in a wide panel, which is a comet rather than
  // a planet and collapses both sectors into slivers.
  const ecc = 0.55;
  const semi = Math.min(a.w * 0.4, a.h * 0.42 / Math.sqrt(1 - ecc * ecc));
  const minor = semi * Math.sqrt(1 - ecc * ecc);
  const cy = a.cy + a.h * 0.06;
  const c = semi * ecc;
  const fx = a.cx - c;

  // Position at true anomaly, measured from the focus, perihelion to the left.
  const at = (theta) => {
    const r = (semi * (1 - ecc * ecc)) / (1 + ecc * Math.cos(theta));
    return [fx - r * Math.cos(theta), cy + r * Math.sin(theta)];
  };
  // Area swept from the focus, by the same formula the orbit is drawn with.
  const area = (from, to, steps = 240) => {
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      const t = from + ((to - from) * (i + 0.5)) / steps;
      const r = (semi * (1 - ecc * ecc)) / (1 + ecc * Math.cos(t));
      sum += 0.5 * r * r * ((to - from) / steps);
    }
    return sum;
  };

  const parts = [];
  const orbit = [];
  for (let i = 0; i <= 96; i++) orbit.push(at((i / 96) * Math.PI * 2));
  parts.push(P.shape(orbit, "panel-orbit"));
  parts.push(P.disc(fx, cy, a.h * 0.05, "panel-sun", { angle: -40, density: 1.0 }));

  // A short fat sweep at perihelion, then solve for the long thin one at
  // aphelion that covers the same ground.
  const near = 0.62;
  const target = area(-near, near);
  let lo = 0.02, hi = Math.PI - 0.02;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (area(Math.PI - mid, Math.PI + mid) < target) lo = mid; else hi = mid;
  }
  const far = (lo + hi) / 2;

  for (const [from, to, hatch] of [[-near, near, -40], [Math.PI - far, Math.PI + far, 40]]) {
    const sector = [[fx, cy]];
    for (let i = 0; i <= 28; i++) sector.push(at(from + ((to - from) * i) / 28));
    parts.push(P.shape(sector, "panel-umbra", { hatch, density: 1.5 }));
  }
  parts.push(eq(a.cx, a.y + theme.panels.caption_size * 1.5,
    "dA/dt = constant", theme.panels.caption_size * 1.4));
  return frame(box, "", theme, parts.join(""));
}

/** The outer system: eccentric, inclined, and mostly empty. */
function kuiper(box, theme, ctx) {
  const a = inner(box, theme, false);
  const P = pen(theme);
  const cy = a.cy + a.h * 0.04;
  const maxR = Math.min(a.w * 0.44, a.h * 0.42);
  const parts = [];

  parts.push(P.disc(a.cx, cy, a.h * 0.035, "panel-sun", { angle: -40, density: 0.9 }));
  // Neptune, circular; then a scatter of resonant and detached orbits.
  parts.push(P.ring(a.cx, cy, maxR * 0.42, "panel-orbit", 0.6));
  const orbits = [
    [0.58, 0.24, 12], [0.66, 0.31, -28], [0.74, 0.12, 48],
    [0.86, 0.44, -8], [0.97, 0.22, 70],
  ];
  for (const [scale, ecc, tilt] of orbits) {
    // `scale` is the aphelion distance from the Sun, not the semi-major axis:
    // scaling the axis instead let the far end of the eccentric orbits reach
    // 1.2 maxR and run off the panel. Semi-minor is the real b = a sqrt(1-e²).
    const rx = (maxR * scale) / (1 + ecc);
    const ry = rx * Math.sqrt(1 - ecc * ecc);
    const pts = ellipsePoints(0, 0, rx, ry, 64).map(([x, y]) => {
      const t = tilt * RAD;
      return [a.cx + x * Math.cos(t) - y * Math.sin(t) + rx * ecc * Math.cos(t),
              cy + x * Math.sin(t) + y * Math.cos(t) + rx * ecc * Math.sin(t)];
    });
    parts.push(P.curve(pts.concat([pts[0]]), "panel-orbit", 0.5));
    parts.push(circle(pts[8][0], pts[8][1], 0.7, { class_: "panel-planet" }));
  }
  parts.push(eq(a.cx, a.y + theme.panels.caption_size * 1.5,
    "T² ∝ a³", theme.panels.caption_size * 1.4));
  return frame(box, "", theme, parts.join(""));
}

/* ------------------------------------------------- pages of working
 *
 * Notation and nothing else. These exist to fill the patches of paper the
 * drawings leave behind, and a construction in them would only compete with the
 * plates -- so they are set as a page of working torn out and laid down.
 */

/** A diagram that is only its notation, centred in its box. */
const working = (lines, { size = 1.25 } = {}) => (box, theme) => {
  const a = inner(box, theme, false);
  const px = theme.panels.caption_size * size;
  // Centred vertically on what the lines will actually occupy, so a block of
  // four and a block of eight both sit properly in their boxes.
  const height = lines.reduce((t, l) => t + px * 1.6 * (l.text === "" ? 0.5
    : ((typeof l === "string" ? 1 : l.scale) ?? 1)), 0);
  return frame(box, "", theme,
    scrawl(a.x + a.w * 0.06, a.cy - height / 2 + px, lines, px, theme));
};

const sub = (t) => `<tspan baseline-shift="sub" font-size="65%">${t}</tspan>`;
const sup = (t) => `<tspan baseline-shift="super" font-size="65%">${t}</tspan>`;

/** The two-body problem, as the four relations that actually get used. */
const visViva = working([
  `ε = <tspan font-size="88%">v²⁄2</tspan> − <tspan font-size="88%">GM⁄r</tspan> = − <tspan font-size="88%">GM⁄2a</tspan>`,
  "",
  { text: `v² = GM (<tspan font-size="88%">2⁄r</tspan> − <tspan font-size="88%">1⁄a</tspan>)`,
    scale: 1.2, rule: true },
  "",
  `h = r × v = √(GM a (1 − e²))`,
  `v${sub("esc")} = √(<tspan font-size="88%">2GM⁄r</tspan>)`,
  "",
  { text: `circular:  v = √(<tspan font-size="88%">GM⁄r</tspan>),  T = 2π √(<tspan font-size="88%">a³⁄GM</tspan>)`,
    indent: 0 },
]);

/** Sidereal time: why the stars rise four minutes earlier each night. */
const sidereal = working([
  `θ(t) = θ${sub("0")} + ω (t − t${sub("0")}),   ω = <tspan font-size="88%">2π⁄T</tspan>${sub("sid")}`,
  "",
  { text: `<tspan font-size="88%">1⁄T</tspan>${sub("sid")} = <tspan font-size="88%">1⁄T</tspan>${sub("sol")} + <tspan font-size="88%">1⁄T</tspan>${sub("yr")}`,
    scale: 1.15 },
  { text: `⇒  T${sub("sid")} ≈ T${sub("sol")} − 4 min`, indent: 0.8 },
  "",
  `LST = θ + λ`,
  { text: `H = LST − α`, scale: 1.2, rule: true },
]);

/** The magnitude scale the stars on the plates are sized by. */
const magnitudes = working([
  `F = <tspan font-size="88%">L⁄4πd²</tspan>`,
  "",
  `m${sub("1")} − m${sub("2")} = − 2.5 log (F${sub("1")} ⁄ F${sub("2")})`,
  { text: `⇒  Δm = 5  is  ×100 in flux`, indent: 0.8 },
  "",
  { text: `m − M = 5 log (<tspan font-size="88%">d⁄10 pc</tspan>)`, scale: 1.2, rule: true },
  "",
  `d = <tspan font-size="88%">1⁄p</tspan>  pc,   p in arcsec`,
]);

/** The far end of the same scale. */
const redshift = working([
  `1 + z = <tspan font-size="88%">λ</tspan>${sub("obs")} ⁄ <tspan font-size="88%">λ</tspan>${sub("emit")} = <tspan font-size="88%">a(t</tspan>${sub("0")}<tspan font-size="88%">)⁄a(t</tspan>${sub("emit")}<tspan font-size="88%">)</tspan>`,
  "",
  { text: `v = H${sub("0")} d`, scale: 1.25, rule: true },
  "",
  `(<tspan font-size="88%">ȧ⁄a</tspan>)² = <tspan font-size="88%">8πGρ⁄3</tspan> − <tspan font-size="88%">kc²⁄a²</tspan> + <tspan font-size="88%">Λc²⁄3</tspan>`,
  "",
  { text: `<tspan font-size="88%">1⁄H</tspan>${sub("0")} ≈ 14 Gyr`, indent: 0.8 },
]);

/* ------------------------------------------------------------ registry */

/** What each diagram wants to be, in millimetres.
 *
 * Chosen for the drawing rather than for whatever space is left over: the
 * eclipses are long and low because they are a row of bodies on a line, the
 * moon wheel is square because it is a circle, the size comparison is wide
 * because it is a queue of planets. Splitting a leftover band between them made
 * every one of them the wrong shape.
 */
export const PANEL_SIZES = {
  // Ten millimetres shorter than they were, which is the band the heading used
  // to take. The drawing inside each keeps exactly the room it was drawn for.
  "planet-sizes": { w: 210, h: 52 },
  "magnitude-key": { w: 130, h: 52 },
  "solar-system": { w: 130, h: 85 },
  "solar-eclipse": { w: 165, h: 48 },
  "lunar-eclipse": { w: 165, h: 48 },
  "earth-revolution": { w: 185, h: 75 },
  "moon-illumination": { w: 120, h: 90 },
  "gravitation": { w: 150, h: 78 },
  "spacetime": { w: 145, h: 95 },
  "black-hole": { w: 150, h: 88 },
  "equal-areas": { w: 140, h: 82 },
  "kuiper": { w: 128, h: 108 },
  // The working blocks are wide and short: a page of notation beside a small
  // construction, which is the shape that reading them wants.
  "euler": { w: 168, h: 76 },
  "epicycles": { w: 172, h: 82 },
  "kepler-equation": { w: 178, h: 84 },
  "spherical": { w: 180, h: 82 },
  "gaussian": { w: 168, h: 76 },
  // Notation only, so they are sized by the longest line rather than by a
  // drawing, and they are the ones to reach for when a gap needs filling.
  "vis-viva": { w: 132, h: 72 },
  "sidereal": { w: 138, h: 62 },
  "magnitudes": { w: 130, h: 66 },
  "redshift": { w: 146, h: 60 },
};

export const PANELS = {
  "planet-sizes": planetSizes,
  "magnitude-key": magnitudeKey,
  "solar-system": solarSystem,
  "solar-eclipse": solarEclipse,
  "lunar-eclipse": lunarEclipse,
  "earth-revolution": earthRevolution,
  "moon-illumination": moonIllumination,
  "gravitation": gravitation,
  "spacetime": spacetime,
  "black-hole": blackHole,
  "equal-areas": equalAreas,
  "kuiper": kuiper,
  "euler": euler,
  "epicycles": epicycles,
  "kepler-equation": keplerEquation,
  "spherical": spherical,
  "gaussian": gaussian,
  "vis-viva": visViva,
  "sidereal": sidereal,
  "magnitudes": magnitudes,
  "redshift": redshift,
};

/** Flow the diagrams across the sheet at their own sizes, wrapping.
 *
 * They are allowed to land on the plates. Nothing is resized to dodge a
 * collision -- a diagram squeezed into a leftover gap reads worse than one
 * sitting on top of something, and anything can be dragged or scaled after.
 */
export function layoutPanels(names, area, gutter) {
  const boxes = [];
  let x = area.x;
  let y = area.y;
  let rowHeight = 0;

  for (const name of names) {
    const size = PANEL_SIZES[name];
    if (!size) continue;
    if (x > area.x && x + size.w > area.x + area.w) {
      x = area.x;
      y += rowHeight + gutter;
      rowHeight = 0;
    }
    boxes.push({ name, box: { x, y, w: size.w, h: size.h } });
    x += size.w + gutter;
    rowHeight = Math.max(rowHeight, size.h);
  }
  return boxes;
}

export function drawPanels(names, area, theme, ctx) {
  /* Restart the clip numbering. It is a module-level counter, so without this
   * the same chart built twice carries different clip ids -- which breaks the
   * one property everything else here leans on, that a re-render after moving
   * a slider produces byte-identical output. It went unnoticed while the
   * diagrams were off by default, because then nothing ever called frame(). */
  clipSeq = 0;
  const gutter = ctx.config.panels?.gutter ?? 10;
  return layoutPanels(names, area, gutter).map(({ name, box: flowed }) => {
    const draw = PANELS[name];
    if (!draw) return "";
    // The flow gives each diagram a place; a dragged position replaces it.
    const box = { ...flowed, ...(ctx.placed?.[name] ?? {}) };
    ctx.boxes?.push({ name, box });
    // Each diagram draws against its own resolved style, so headings, rules and
    // palettes are independent without any panel knowing that.
    const scoped = { ...theme, panels: panelStyle(theme, name) };
    return `<g id="panel-${name}" data-drag="panel:${name}">${draw(box, scoped, ctx)}</g>`;
  }).join("");
}
