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
import { circle, fmt, line, path, polylineD, text } from "./svg.js";

const RAD = Math.PI / 180;

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
  parts.push(text(box.x + box.w / 2, box.y + p.title_size + p.title_gap, title,
    { class_: "panel-title" }));
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
const inner = (box, theme) => {
  const p = theme.panels;
  const top = box.y + p.title_size + p.title_gap + p.title_space;
  return { x: box.x, y: top, w: box.w, h: box.y + box.h - top,
           cx: box.x + box.w / 2, cy: (top + box.y + box.h) / 2 };
};

const caption = (x, y, s, cls = "panel-caption") =>
  text(x, y, s, { class_: cls });

/* ------------------------------------------------- comparative sizes */

function planetSizes(box, theme, ctx) {
  const a = inner(box, theme);
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

  const parts = [];
  const sunCx = a.x - sunR + a.w * 0.17;
  const sunCy = a.cy;
  parts.push(circle(sunCx, sunCy, sunR, { class_: "panel-sun" }));
  parts.push(caption(a.x + a.w * 0.07, a.cy, "THE SUN", "panel-note"));

  // Planets in a row, true to each other and to that same Sun.
  let x = a.x + a.w * 0.24;
  for (const planet of PLANETS) {
    const r = Math.max(0.28, planet.km * scale);
    x += r;
    parts.push(circle(x, a.cy, r, { class_: "panel-planet" }));
    // Only the giants have room for a name beside them.
    if (r > 2.2) {
      parts.push(caption(x, a.cy + r + 3.4, planet.name, "panel-tick"));
    }
    x += r + gap;
  }
  parts.push(caption(a.x + a.w * 0.6, a.y + a.h - 0.5,
    `SUN ${(SUN_KM * 2).toLocaleString("en")} KM ACROSS · ` +
    `EARTH ${(PLANETS[2].km * 2).toLocaleString("en")} KM`, "panel-note"));

  return frame(box, "COMPARATIVE SIZE OF THE SUN AND PLANETS", theme, parts.join(""));
}

/* ------------------------------------------------------ magnitude key */

function magnitudeKey(box, theme, ctx) {
  const a = inner(box, theme);
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

  return frame(box, "EXPLANATION", theme, parts.join(""));
}

/* ------------------------------------------------------- solar system */

function solarSystem(box, theme, ctx) {
  const a = inner(box, theme);
  const cy = a.cy;
  const maxR = Math.min(a.w * 0.46, a.h * 0.46);
  const scale = maxR / PLANETS[PLANETS.length - 1].au;
  const parts = [];

  // A plan view, orbits true to scale. That crowds the inner four into a knot
  // at the centre, which is not a flaw in the drawing -- it is what the solar
  // system looks like, and the scale bar is what makes it readable.
  for (const planet of PLANETS) {
    const r = planet.au * scale;
    parts.push(circle(a.cx, cy, r, { class_: "panel-orbit" }));
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
  parts.push(line(a.cx - barR / 2, barY, a.cx + barR / 2, barY, { class_: "panel-scale" }));
  for (const dx of [-barR / 2, barR / 2]) {
    parts.push(line(a.cx + dx, barY - 1.4, a.cx + dx, barY + 1.4, { class_: "panel-scale" }));
  }
  parts.push(caption(a.cx, barY - 2.6,
    `${Math.round(10 * AU_MILLION_MILES)} MILLION MILES`, "panel-tick"));

  return frame(box, "THE SOLAR SYSTEM · ORBITS TO SCALE", theme, parts.join(""));
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
  const a = inner(box, theme);
  const cy = a.cy;
  const sunR = a.h * 0.34;
  const sunX = a.x + sunR * 0.5;
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
  const parts = [
    circle(sunX, cy, sunR, { class_: "panel-sun" }),
    // The umbra, narrowing to a point that just reaches the Earth -- which is
    // why totality is only ever seen from a narrow track.
    path(polylineD([[moonX, cy - moonR], [cone.tipX, cy], [moonX, cy + moonR]], true),
      { class_: "panel-umbra" }),
    line(sunX, cy - sunR, cone.tipX, cy, { class_: "panel-ray" }),
    line(sunX, cy + sunR, cone.tipX, cy, { class_: "panel-ray" }),
    circle(earthX, cy, earthR, { class_: "panel-earth" }),
    circle(moonX, cy, moonR, { class_: "panel-moon" }),
    caption(sunX, cy - sunR - 2.4, "SUN", "panel-tick"),
    caption(moonX, cy - moonR - 2.4, "MOON", "panel-tick"),
    caption(earthX, cy - earthR - 2.4, "EARTH", "panel-tick"),
  ];
  return frame(box, "ECLIPSE OF THE SUN", theme, parts.join(""));
}

function lunarEclipse(box, theme, ctx) {
  const a = inner(box, theme);
  const cy = a.cy;
  const sunR = a.h * 0.34;
  const sunX = a.x + sunR * 0.5;
  const earthR = sunR * 0.42;
  const earthX = sunX + (a.w - sunR) * 0.45;
  const moonR = earthR * 0.27;

  const cone = shadowCone(sunX, sunR, earthX, earthR, cy);
  const moonX = earthX + (cone.tipX - earthX) * 0.55;

  const parts = [
    circle(sunX, cy, sunR, { class_: "panel-sun" }),
    path(polylineD([[earthX, cy - earthR], [cone.tipX, cy], [earthX, cy + earthR]], true),
      { class_: "panel-umbra" }),
    line(sunX, cy - sunR, cone.tipX, cy, { class_: "panel-ray" }),
    line(sunX, cy + sunR, cone.tipX, cy, { class_: "panel-ray" }),
    circle(earthX, cy, earthR, { class_: "panel-earth" }),
    circle(moonX, cy, moonR, { class_: "panel-moon-dark" }),
    caption(sunX, cy - sunR - 2.4, "SUN", "panel-tick"),
    caption(earthX, cy - earthR - 2.4, "EARTH", "panel-tick"),
    caption(moonX, cy + moonR + 4.6, "MOON", "panel-tick"),
  ];
  return frame(box, "ECLIPSE OF THE MOON", theme, parts.join(""));
}

/* -------------------------------------------------- earth's revolution */

function earthRevolution(box, theme, ctx) {
  const a = inner(box, theme);
  const rx = a.w * 0.40;
  const ry = a.h * 0.24;
  const cy = a.cy;
  const earthR = Math.min(a.h * 0.11, 4.2);

  const parts = [
    path(`M${fmt(a.cx - rx)},${fmt(cy)}a${fmt(rx)},${fmt(ry)} 0 1 0 ${fmt(2 * rx)},0` +
         `a${fmt(rx)},${fmt(ry)} 0 1 0 ${fmt(-2 * rx)},0`, { class_: "panel-orbit" }),
    circle(a.cx, cy, 2.6, { class_: "panel-sun" }),
  ];

  // The four stations, in the positions the original gives them.
  const stations = [
    [-1, 0, "21 MARCH", "VERNAL EQUINOX"],
    [0, -1, "21 JUNE", "SUMMER SOLSTICE"],
    [1, 0, "23 SEPTEMBER", "AUTUMNAL EQUINOX"],
    [0, 1, "21 DECEMBER", "WINTER SOLSTICE"],
  ];
  for (const [dx, dy, when, what] of stations) {
    const x = a.cx + dx * rx;
    const y = cy + dy * ry;
    parts.push(circle(x, y, earthR, { class_: "panel-earth" }));
    // Axial tilt, drawn because it is the whole reason the seasons happen.
    parts.push(line(x - earthR * 0.4, y - earthR * 1.5, x + earthR * 0.4, y + earthR * 1.5,
      { class_: "panel-axis" }));
    // Both lines sit above the globe at the bottom station; below it there is
    // no room before the panel edge.
    const above = dy > 0 ? false : true;
    const ty = above ? y - earthR - 7.2 : y + earthR + 4.4;
    parts.push(caption(x, ty, when, "panel-tick"));
    parts.push(caption(x, ty + 4.0, what, "panel-note"));
  }
  return frame(box, "REVOLUTION OF THE EARTH AROUND THE SUN", theme, parts.join(""));
}

/* ------------------------------------------------ illumination of moon */

function moonIllumination(box, theme, ctx) {
  const a = inner(box, theme);
  const ring = Math.min(a.w * 0.34, a.h * 0.36);
  const moonR = Math.max(2.0, ring * 0.17);
  const parts = [];

  // Sunlight arrives from the left, so the lit limb always faces that way.
  for (let i = 0; i < 5; i++) {
    const y = a.cy - ring + (i * 2 * ring) / 4;
    parts.push(line(a.x + 1, y, a.x + 8, y, { class_: "panel-ray" }));
  }
  parts.push(caption(a.x + 11, a.cy - ring - 3, "SUN'S RAYS", "panel-tick"));

  parts.push(circle(a.cx, a.cy, ring, { class_: "panel-orbit" }));
  parts.push(circle(a.cx, a.cy, Math.max(2.4, moonR * 1.3), { class_: "panel-earth" }));

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
    parts.push(
      `<g transform="translate(${fmt(x)},${fmt(y)}) rotate(${fmt(pa)})">` +
      circle(0, 0, moonR, { class_: "panel-moon-dark" }) +
      path(polylineD(phasePoints(moonR, lit), true), { class_: "panel-moon" }) +
      `</g>`);
  }

  const label = (dx, dy, s) => caption(a.cx + dx, a.cy + dy, s, "panel-tick");
  parts.push(label(-ring - 6, -2, "NEW"));
  parts.push(label(ring + 6, -2, "FULL"));
  parts.push(label(0, -ring - 3.4, "FIRST QR"));
  parts.push(label(0, ring + 5.6, "LAST QR"));

  return frame(box, "ILLUMINATION OF THE MOON", theme, parts.join(""));
}

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
  "planet-sizes": { w: 210, h: 62 },
  "magnitude-key": { w: 130, h: 62 },
  "solar-system": { w: 130, h: 95 },
  "solar-eclipse": { w: 165, h: 58 },
  "lunar-eclipse": { w: 165, h: 58 },
  "earth-revolution": { w: 185, h: 85 },
  "moon-illumination": { w: 120, h: 100 },
};

export const PANELS = {
  "planet-sizes": planetSizes,
  "magnitude-key": magnitudeKey,
  "solar-system": solarSystem,
  "solar-eclipse": solarEclipse,
  "lunar-eclipse": lunarEclipse,
  "earth-revolution": earthRevolution,
  "moon-illumination": moonIllumination,
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
