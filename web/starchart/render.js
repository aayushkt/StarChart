/* Assembly of the plate into a single SVG document.
 *
 * Mirrors starchart/render.py. A differential test renders the same chart
 * through both and compares every coordinate, so this file and its Python twin
 * are held to producing the same drawing.
 */

import { drawBody, drawMoonTrack, states } from "./bodies.js";
import { Placer, bucketFor, placeConstellationLabels, placeStarLabels } from "./labels.js";
import { arcText } from "./lettering.js";
import { caption, drawOverlay } from "./overlay.js";
import { drawBand } from "./panels.js";
import { Hemisphere, NORTH, stackedPair } from "./projection.js";
import { drawColures, drawEcliptic, drawSmallCircles } from "./reference.js";
import { LAYERS, stylesheet } from "./style.js";
import * as svg from "./svg.js";

/** Engraved magnitude classes, as on the plate's own key. */
const MAG_CLASS_BOUNDS = [1.5, 2.5, 3.5, 4.5];
const magClass = (mag) => {
  let k = 0;
  while (k < MAG_CLASS_BOUNDS.length && mag >= MAG_CLASS_BOUNDS[k]) k++;
  return k + 1;
};

const LAYER_ORDER = [
  "layer-plate", "layer-milkyway", "layer-grid", "layer-tropics", "layer-ecliptic",
  "layer-colures", "layer-moon-track", "layer-star-halos", "layer-stars",
  "layer-constellation-labels", "layer-star-labels", "layer-rim",
  "layer-hemi-labels", "layer-sun", "layer-moon", "layer-horizon",
  "layer-panels",
];

function drawMilkyWay(hemi, data) {
  const parts = [];
  data.milkyWay.forEach((contour, i) => {
    const d = contour
      .map((ring) => svg.polylineD(ring.map(([ra, dec]) => hemi.project(ra, dec)), true))
      .join("");
    if (d) parts.push(svg.path(d, { class_: `mw mw-${i + 1}`, fill_rule: "evenodd" }));
  });
  return `<g>${parts.join("")}</g>`;
}

function drawGrid(hemi, theme) {
  const gr = theme.grid;
  const parts = [];
  const innerDec = hemi.pole === NORTH ? -hemi.overlapDeg : hemi.overlapDeg;
  // Meridians stop against a small clear polar circle rather than colliding at
  // the pole, as on the original.
  const hubDec = hemi.pole === NORTH ? 90 - gr.hub_deg : gr.hub_deg - 90;

  for (let d = -80; d <= 80 + 1e-9; d += gr.dec_step) {
    if (!hemi.visible(d) || hemi.radiusForDec(d) <= 0.01) continue;
    const equator = Math.abs(d) < 1e-6;
    parts.push(svg.circle(hemi.cx, hemi.cy, hemi.radiusForDec(d),
      equator ? { class_: "grid-accent" } : {}));
  }
  parts.push(svg.circle(hemi.cx, hemi.cy, hemi.radiusForDec(hubDec), { class_: "grid-accent" }));

  for (let ra = 0; ra < 360 - 1e-9; ra += gr.ra_step) {
    const [x0, y0] = hemi.project(ra, hubDec);
    const [x1, y1] = hemi.project(ra, innerDec);
    parts.push(svg.line(x0, y0, x1, y1));
  }
  return `<g class="grid">${parts.join("")}</g>`;
}

function drawStars(hemi, theme, data) {
  const st = theme.stars;
  const halos = [], bodies = [];
  for (const [ra, dec, mag] of data.stars) {
    if (!hemi.visible(dec)) continue;
    const [x, y] = hemi.project(ra, dec);
    const k = magClass(mag);
    const r = st.radii[k - 1];
    if (k <= st.halo_classes) {
      halos.push(svg.circle(x, y, r * st.halo_scale, { class_: `halo-${k}` }));
    }
    bodies.push(svg.circle(x, y, r, { class_: `mag-${k}` }));
  }
  return [`<g class="star-halo">${halos.join("")}</g>`, `<g class="star">${bodies.join("")}</g>`];
}

function drawRim(hemi, theme) {
  const band = theme.plate.scale_band;
  const outer = hemi.radius + band;
  const parts = [
    svg.path(svg.annulusD(hemi.cx, hemi.cy, outer, hemi.radius),
      { class_: "rim-band", fill_rule: "evenodd" }),
    svg.circle(hemi.cx, hemi.cy, hemi.radius, { class_: "rim-inner" }),
    svg.circle(hemi.cx, hemi.cy, outer, { class_: "rim-outer" }),
  ];

  const ticks = [], labels = [];
  const sign = hemi.clockwise ? 1 : -1;
  for (let ra = 0; ra < 360; ra += 10) {
    const t = sign * (ra - hemi.raZeroDeg) * (Math.PI / 180);
    const sx = Math.sin(t), sy = -Math.cos(t);
    ticks.push(svg.line(
      hemi.cx + sx * hemi.radius, hemi.cy + sy * hemi.radius,
      hemi.cx + sx * (hemi.radius + band * 0.28), hemi.cy + sy * (hemi.radius + band * 0.28)));
    const lr = hemi.radius + band * 0.62;
    labels.push(svg.text(hemi.cx + sx * lr,
      hemi.cy + sy * lr + theme.type.scale_size * 0.36, String(ra || 360)));
  }
  parts.push(`<g class="scale-tick">${ticks.join("")}</g>`);
  parts.push(`<g class="scale-label">${labels.join("")}</g>`);
  return `<g>${parts.join("")}</g>`;
}

function drawLabels(hemi, config, theme, data) {
  const cfg = config.labels ?? {};
  const placer = new Placer();

  // Constellations first: large, curved, and with far less freedom about where
  // they can sit, so they claim space before the star names crowd them out.
  const style = cfg.constellation_names ?? "both";
  const constellations = data.constellations.map(([ra, dec, english, latin]) => {
    const primary = style === "latin" ? latin : english;
    const secondary = style === "both" && latin !== english ? latin : "";
    return [ra, dec, primary, secondary];
  });
  const constGroup = placeConstellationLabels(hemi, constellations, theme, placer);

  const limit = cfg.star_mag_limit ?? 4;
  const entries = [];
  data.stars.forEach(([ra, dec, mag], i) => {
    const name = data.starNames[String(i)];
    if (!name || mag > limit || !hemi.visible(dec)) return;
    const [x, y] = hemi.project(ra, dec);
    entries.push([x, y, name, mag]);
  });
  return [constGroup, placeStarLabels(hemi, entries, theme, placer)];
}

/** Build the whole document. Returns SVG markup. */
export function buildChart({ config, theme, data, observer = null, ui = {} }) {
  const page = config.page, layout = config.layout, ty = theme.type, pg = theme.page;

  const bodyStates = observer && config.bodies?.enabled ? states(observer) : null;

  const defs = [`<style>${stylesheet(theme, ui)}</style>`];
  const body = [];

  body.push(svg.rect(0, 0, page.width, page.height, { class_: "page-bg" }));

  const inset = pg.frame_inset;
  const gap = inset + pg.frame_inner_gap;
  body.push(`<g id="layer-frame">` +
    svg.rect(inset, inset, page.width - 2 * inset, page.height - 2 * inset, { class_: "frame" }) +
    svg.rect(gap, gap, page.width - 2 * gap, page.height - 2 * gap, { class_: "frame-inner" }) +
    `</g>`);

  body.push(`<g id="layer-title">` +
    svg.text(page.width / 2, page.margin + 34, config.title, { class_: "title" }) + `</g>`);

  let [north, south] = stackedPair({
    width: page.width,
    topY: page.margin + layout.top_offset,
    radius: layout.radius,
    gap: layout.gap,
    overlapDeg: layout.overlap_deg,
    raZeroDeg: layout.ra_zero_deg,
  });

  // Anything the reader has dragged wins over the computed arrangement. The
  // default stays derived so the sliders keep working until something is moved.
  const placed = config.placement ?? {};
  const reposition = (hemi, at) => at
    ? new Hemisphere({ ...hemi, cx: at.cx ?? hemi.cx, cy: at.cy ?? hemi.cy })
    : hemi;
  north = reposition(north, placed.plates?.north);
  south = reposition(south, placed.plates?.south);

  const layers = Object.fromEntries(LAYER_ORDER.map((k) => [k, []]));
  const labelsOn = config.labels?.enabled ?? true;

  for (const [hemi, name] of [[north, "NORTHERN HEMISPHERE"], [south, "SOUTHERN HEMISPHERE"]]) {
    const clipId = `clip-${hemi.pole}`;
    defs.push(`<clipPath id="${clipId}">${svg.circle(hemi.cx, hemi.cy, hemi.radius)}</clipPath>`);
    // Every layer's contribution for this plate carries the same tag, so
    // dragging moves the whole plate -- rim, stars, labels and all -- while the
    // layer groups stay intact for the toggles.
    const tag = `data-plate="${hemi.pole}"`;
    const clip = (markup) =>
      `<g ${tag} clip-path="url(#${clipId})">${markup}</g>`;
    const loose = (markup) => `<g ${tag}>${markup}</g>`;

    layers["layer-plate"].push(loose(svg.circle(hemi.cx, hemi.cy, hemi.radius,
      { class_: "plate-bg" })));
    layers["layer-milkyway"].push(clip(drawMilkyWay(hemi, data)));
    layers["layer-grid"].push(clip(drawGrid(hemi, theme)));
    layers["layer-tropics"].push(clip(drawSmallCircles(hemi, theme, labelsOn)));
    layers["layer-ecliptic"].push(clip(drawEcliptic(hemi, theme, labelsOn)));
    layers["layer-colures"].push(clip(drawColures(hemi, theme, labelsOn)));

    const [halos, stars] = drawStars(hemi, theme, data);
    layers["layer-star-halos"].push(clip(halos));
    layers["layer-stars"].push(clip(stars));

    if (labelsOn) {
      const [constGroup, starGroup] = drawLabels(hemi, config, theme, data);
      layers["layer-constellation-labels"].push(clip(constGroup));
      layers["layer-star-labels"].push(clip(starGroup));
    }

    if (bodyStates) {
      let sunXY = null;
      if (hemi.visible(bodyStates.sun.dec)) {
        sunXY = hemi.project(bodyStates.sun.ra, bodyStates.sun.dec);
      }
      layers["layer-sun"].push(clip(drawBody(hemi, bodyStates.sun, theme)));
      layers["layer-moon"].push(clip(drawBody(hemi, bodyStates.moon, theme, sunXY)));
      if (config.bodies?.moon_track ?? true) {
        layers["layer-moon-track"].push(clip(drawMoonTrack(hemi, observer, theme)));
      }
    }

    if (observer) layers["layer-horizon"].push(clip(drawOverlay(hemi, observer, theme)));

    layers["layer-rim"].push(loose(drawRim(hemi, theme)));
    layers["layer-hemi-labels"].push(loose(arcText(
      hemi.cx, hemi.cy,
      hemi.radius + theme.plate.scale_band + ty.hemi_size * 0.75,
      layout.hemi_label_deg, name,
      { size: ty.hemi_size, tracking: ty.hemi_tracking, class_: "hemi-label" })));
  }

  const panelBoxes = [];
  if (config.panels?.enabled) {
    const gutter = config.panels.gutter ?? 10;
    const bands = [];
    // Between the plates, and below the lower one -- the two places the
    // stacked layout leaves free.
    if (config.panels.middle?.length) {
      bands.push([config.panels.middle, {
        x: page.margin, y: north.cy + north.radius + gutter,
        w: page.width - 2 * page.margin,
        h: (south.cy - south.radius) - (north.cy + north.radius) - 2 * gutter,
      }]);
    }
    if (config.panels.bottom?.length) {
      const top = south.cy + south.radius + gutter;
      bands.push([config.panels.bottom, {
        x: page.margin, y: top,
        w: page.width - 2 * page.margin,
        h: (page.height - page.margin - (observer ? 14 : 0)) - top,
      }]);
    }
    layers["layer-panels"].push(
      bands.map(([names, band]) =>
        drawBand(names, band, theme,
          { config, observer, placed: placed.panels ?? {}, boxes: panelBoxes })
      ).join(""));
  }

  for (const key of LAYER_ORDER) {
    body.push(`<g id="${key}">${layers[key].join("")}</g>`);
  }

  if (observer) {
    body.push(`<g id="layer-caption">` +
      svg.text(page.width / 2, page.height - page.margin - 3, caption(observer),
        { class_: "caption" }) + `</g>`);
  }

  return { markup: svg.document_(page.width, page.height, defs.join(""), body.join("")),
           hemispheres: [north, south], panelBoxes, bodyStates };
}
