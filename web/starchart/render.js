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
import { drawPanels } from "./panels.js";
import * as sketch from "./sketch.js";
import { PAPER_A, PAPER_B } from "./textures.js";
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

/* The diagrams go down first, so the plates cover them where they overlap: a
 * plate is the subject and a diagram is marginalia, and marginalia does not sit
 * on top of the subject. Selection is unaffected -- it picks the smallest box
 * containing the point, which has nothing to do with paint order, so a diagram
 * mostly hidden under a plate is still the thing you grab. */
const LAYER_ORDER = [
  "layer-panels",
  "layer-plate", "layer-milkyway", "layer-grid", "layer-tropics", "layer-ecliptic",
  "layer-colures", "layer-moon-track", "layer-star-halos", "layer-stars",
  // The horizon goes under the names, not over them. It is a broken red line
  // crossing the whole plate, and on top it cut through every label it met.
  "layer-horizon",
  "layer-constellation-labels", "layer-star-labels", "layer-rim",
  "layer-hemi-labels", "layer-sun", "layer-moon",
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
  // A ruled grid drawn by hand is still ruled -- it wants a fraction of what
  // the diagrams get, enough to read as scribed rather than sketched.
  const hand = gr.hand ?? 0;
  const ring = (r) => hand > 0
    ? svg.path(sketch.circle(hemi.cx, hemi.cy, r, { amount: hand, passes: 1 }), {})
    : null;
  const innerDec = hemi.pole === NORTH ? -hemi.overlapDeg : hemi.overlapDeg;
  // Meridians stop against a small clear polar circle rather than colliding at
  // the pole, as on the original.
  const hubDec = hemi.pole === NORTH ? 90 - gr.hub_deg : gr.hub_deg - 90;

  for (let d = -80; d <= 80 + 1e-9; d += gr.dec_step) {
    if (!hemi.visible(d) || hemi.radiusForDec(d) <= 0.01) continue;
    const equator = Math.abs(d) < 1e-6;
    const r = hemi.radiusForDec(d);
    const cls = equator ? { class_: "grid-accent" } : {};
    parts.push(hand > 0
      ? svg.path(sketch.circle(hemi.cx, hemi.cy, r, { amount: hand, passes: 1 }), cls)
      : svg.circle(hemi.cx, hemi.cy, r, cls));
  }
  const hubR = hemi.radiusForDec(hubDec);
  parts.push(hand > 0
    ? svg.path(sketch.circle(hemi.cx, hemi.cy, hubR, { amount: hand, passes: 1 }),
        { class_: "grid-accent" })
    : svg.circle(hemi.cx, hemi.cy, hubR, { class_: "grid-accent" }));

  for (let ra = 0; ra < 360 - 1e-9; ra += gr.ra_step) {
    const [x0, y0] = hemi.project(ra, hubDec);
    const [x1, y1] = hemi.project(ra, innerDec);
    parts.push(hand > 0
      ? svg.path(sketch.line(x0, y0, x1, y1, { amount: hand, passes: 1 }), {})
      : svg.line(x0, y0, x1, y1));
  }
  return `<g class="grid">${parts.join("")}</g>`;
}

function drawStars(hemi, theme, data, faintest) {
  const st = theme.stars;
  const halos = [], bodies = [];
  for (const [ra, dec, mag] of data.stars) {
    if (magClass(mag) > faintest || !hemi.visible(dec)) continue;
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
  // Never name a star that is not drawn.
  const faintest = config.stars?.faintest_class ?? 5;
  const entries = [];
  data.stars.forEach(([ra, dec, mag], i) => {
    const name = data.starNames[String(i)];
    if (!name || mag > limit || magClass(mag) > faintest || !hemi.visible(dec)) return;
    const [x, y] = hemi.project(ra, dec);
    entries.push([x, y, name, mag]);
  });
  return [constGroup, placeStarLabels(hemi, entries, theme, placer)];
}

/** Build the whole document. Returns SVG markup. */
export function buildChart({ config, theme, data, observer = null, ui = {} }) {
  const page = config.page, layout = config.layout, ty = theme.type, pg = theme.page;

  const bodyStates = observer && config.bodies?.enabled ? states(observer) : null;
  // Anything the reader has dragged wins over the computed arrangement. The
  // defaults stay derived, so the layout sliders keep working until something
  // is moved.
  const placed = config.placement ?? {};

  const defs = [`<style>${stylesheet(theme, ui)}</style>`];
  const body = [];

  body.push(svg.rect(0, 0, page.width, page.height, { class_: "page-bg" }));

  /* Paper.
   *
   * This was simulated for a while -- turbulence at several scales, mapped into
   * the alpha of two browns. It was a decent imitation and still read as one.
   * Ageing is the accumulated history of a physical object, and the honest way
   * to have it is to photograph paper that already has it.
   *
   * Two scans, mirror-tiled. A single tile repeats visibly however good it is;
   * mirroring makes any tile seamless without touching a pixel, at the cost of
   * a symmetry that is itself readable. So the second scan sits underneath at a
   * different size and turned ninety degrees: the two periods do not share a
   * factor, so nothing lines up anywhere on the sheet.
   */
  const age = pg.age ?? {};
  const paperTile = (id, href, size, aspect, rotate, seedShift) => {
    const w = size;
    const h = size * aspect;
    const quad = `<image href="${href}" x="0" y="0" width="${svg.fmt(w)}" ` +
      `height="${svg.fmt(h)}" preserveAspectRatio="none"/>`;
    return (
      `<pattern id="${id}" patternUnits="userSpaceOnUse" ` +
      `width="${svg.fmt(w * 2)}" height="${svg.fmt(h * 2)}" ` +
      `patternTransform="rotate(${svg.fmt(rotate)}) translate(${svg.fmt(seedShift)},0)">` +
      quad +
      `<g transform="translate(${svg.fmt(w * 2)},0) scale(-1,1)">${quad}</g>` +
      `<g transform="translate(0,${svg.fmt(h * 2)}) scale(1,-1)">${quad}</g>` +
      `<g transform="translate(${svg.fmt(w * 2)},${svg.fmt(h * 2)}) scale(-1,-1)">${quad}</g>` +
      `</pattern>`
    );
  };

  if ((age.paper ?? 0) > 0) {
    defs.push(paperTile("paper-under", PAPER_B, age.under_tile ?? 139, 1.0, 90, 31));
    defs.push(paperTile("paper-over", PAPER_A, age.tile ?? 203, 1.46, 0, 0));
    body.push(
      svg.rect(0, 0, page.width, page.height,
        { class_: "paper-under", fill: "url(#paper-under)" }),
      svg.rect(0, 0, page.width, page.height,
        { class_: "paper-over", fill: "url(#paper-over)" }));
  }

  const inset = pg.frame_inset;
  const gap = inset + pg.frame_inner_gap;
  body.push(`<g id="layer-frame">` +
    svg.rect(inset, inset, page.width - 2 * inset, page.height - 2 * inset, { class_: "frame" }) +
    svg.rect(gap, gap, page.width - 2 * gap, page.height - 2 * gap, { class_: "frame-inner" }) +
    `</g>`);

  const titleAt = placed.texts?.title ?? {};
  const titleBaseline = titleAt.y ?? page.margin + 34;
  body.push(`<g id="layer-title" data-drag="text:title">` +
    svg.text(titleAt.x ?? page.width / 2, titleBaseline, config.title,
      { class_: "title" }) + `</g>`);

  /* "between-text" sizes the pair to fill the column the title and caption
   * leave, with equal clearance above and below, and centres it on the sheet.
   * The radius is whatever fits -- limited by that column, or by the sheet's
   * width, whichever runs out first. */
  let radius = layout.radius;
  let plateGap = layout.gap;
  let plateTop = page.margin + layout.top_offset;
  if (layout.fit_between_text) {
    const clearance = layout.fit_clearance ?? 26;
    const capY = observer
      ? (placed.texts?.caption?.y ?? page.height - page.margin - 3)
      : page.height - page.margin;
    // The degree-scale band sits outside the plate radius, so it counts toward
    // the space used -- sizing on the radius alone eats into the clearance.
    // The degree-scale band sits outside the plate radius, so it counts toward
    // the space used -- sizing on the radius alone eats into the clearance. In
    // this mode `gap` is the gap you can see between the two bands, not the
    // distance between the circles inside them, so the slider means what it
    // looks like.
    const band = theme.plate.scale_band ?? 0;
    const column = (capY - clearance) - (titleBaseline + clearance);
    const byHeight = (column - layout.gap - 4 * band) / 4;
    const byWidth = (page.width - 2 * page.margin) / 2 - band;
    radius = Math.max(20, Math.min(byHeight, byWidth));
    plateGap = layout.gap + 2 * band;
    const slack = column - (4 * radius + plateGap + 2 * band);
    plateTop = titleBaseline + clearance + band + slack / 2;
  }

  let [north, south] = stackedPair({
    width: page.width,
    topY: plateTop,
    radius,
    gap: plateGap,
    overlapDeg: layout.overlap_deg,
    raZeroDeg: layout.ra_zero_deg,
  });

  // The pair moves as one object. Their spacing is the layout's business --
  // radius, gap and top offset -- and dragging only shifts the whole assembly,
  // so the two never drift out of register with each other.
  const shift = placed.plates ?? { dx: 0, dy: 0 };
  const move = (hemi) => (shift.dx || shift.dy)
    ? new Hemisphere({ ...hemi, cx: hemi.cx + (shift.dx ?? 0), cy: hemi.cy + (shift.dy ?? 0) })
    : hemi;
  north = move(north);
  south = move(south);

  const layers = Object.fromEntries(LAYER_ORDER.map((k) => [k, []]));
  const labelsOn = config.labels?.enabled ?? true;
  const faintestClass = config.stars?.faintest_class ?? 5;

  for (const [hemi, name] of [[north, "NORTHERN HEMISPHERE"], [south, "SOUTHERN HEMISPHERE"]]) {
    const clipId = `clip-${hemi.pole}`;
    defs.push(`<clipPath id="${clipId}">${svg.circle(hemi.cx, hemi.cy, hemi.radius)}</clipPath>`);
    // Every layer's contribution for either plate carries the same tag, so a
    // drag moves the pair -- rims, stars, labels and all -- while the layer
    // groups stay intact for the toggles.
    const tag = `data-plate="plates"`;
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

    const [halos, stars] = drawStars(hemi, theme, data, faintestClass);
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
    // One flow area across the whole sheet. The diagrams keep their own sizes
    // and are allowed to overlap the plates -- the alternative was fitting them
    // into whatever space the plates left, which produced bands of negative
    // height once the plates filled the sheet.
    const area = {
      x: page.margin,
      y: page.margin + (config.panels.start_offset ?? 60),
      w: page.width - 2 * page.margin,
      h: page.height - 2 * page.margin,
    };
    layers["layer-panels"].push(drawPanels(
      config.panels.order ?? [], area, theme,
      { config, observer, placed: placed.panels ?? {}, boxes: panelBoxes }));
  }

  for (const key of LAYER_ORDER) {
    body.push(`<g id="${key}">${layers[key].join("")}</g>`);
  }

  // Wear at the edges, above everything: a sheet is handled by its border, and
  // the darkening there falls on whatever happens to be printed under it.
  if ((age.wear ?? 0) > 0) {
    const warm = age.colour ?? "#6b4a22";
    const seed = age.seed ?? 7;
    defs.push(
      `<radialGradient id="age-wear-fill" cx="50%" cy="50%" ` +
      `r="${svg.fmt(age.wear_reach ?? 70)}%">` +
      `<stop offset="${svg.fmt(age.wear_start ?? 45)}%" stop-color="${warm}" stop-opacity="0"/>` +
      `<stop offset="100%" stop-color="${warm}" stop-opacity="1"/>` +
      `</radialGradient>`,
      // Displacing a gradient is safe in a way displacing line work is not:
      // there is no edge to smear and nothing to blur, so the boundary just
      // goes ragged.
      `<filter id="age-wear" x="-15%" y="-15%" width="130%" height="130%">` +
      `<feTurbulence type="fractalNoise" baseFrequency="${svg.fmt(age.wear_frequency ?? 0.011, 5)}" ` +
      `numOctaves="4" seed="${seed + 53}" result="n"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="n" ` +
      `scale="${svg.fmt(age.wear_ragged ?? 55)}" ` +
      `xChannelSelector="R" yChannelSelector="G"/>` +
      `</filter>`);
    // Painted well past the sheet: the displacement pulls colour in from
    // outside, and if there is nothing out there it pulls in transparency and
    // leaves a hard band along the edge it sampled from.
    const bleed = (age.wear_ragged ?? 55) * 1.6;
    body.push(svg.rect(-bleed, -bleed, page.width + bleed * 2, page.height + bleed * 2,
      { class_: "age-wear", fill: "url(#age-wear-fill)", filter: "url(#age-wear)" }));
  }

  if (observer) {
    const capAt = placed.texts?.caption ?? {};
    body.push(`<g id="layer-caption" data-drag="text:caption">` +
      svg.text(capAt.x ?? page.width / 2, capAt.y ?? page.height - page.margin - 3,
        caption(observer), { class_: "caption" }) + `</g>`);
  }

  const textBoxes = [
    { name: "title", x: titleAt.x ?? page.width / 2, y: titleBaseline,
      size: ty.title_size, label: "TITLE" },
  ];
  if (observer) {
    const capAt = placed.texts?.caption ?? {};
    textBoxes.push({
      name: "caption", x: capAt.x ?? page.width / 2,
      y: capAt.y ?? page.height - page.margin - 3,
      size: theme.horizon.caption_size, label: "CAPTION",
    });
  }

  return { markup: svg.document_(page.width, page.height, defs.join(""), body.join("")),
           hemispheres: [north, south], panelBoxes, textBoxes, bodyStates };
}
