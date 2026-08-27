/* The chart's stylesheet, embedded inside the SVG.
 *
 * Mirrors starchart/style.py, and a test diffs the two byte for byte. Every
 * colour and weight reaches the document through a CSS class rather than a
 * presentation attribute, which is what lets the editor restyle a finished
 * chart without regenerating it.
 *
 * Plain class selectors, not custom properties: librsvg does not implement
 * var(), and drops the whole declaration rather than falling back.
 */

import { BUCKET_COUNT } from "./labels.js";
import { fmt } from "./svg.js";

const n = (v) => fmt(Number(v), 6);

export const LAYERS = [
  ["layer-frame", "Border"],
  ["layer-title", "Title"],
  ["layer-plate", "Plate"],
  ["layer-milkyway", "Milky Way"],
  ["layer-grid", "Graticule"],
  ["layer-stars", "Stars"],
  ["layer-star-halos", "Star halos"],
  ["layer-rim", "Degree scale"],
  ["layer-hemi-labels", "Hemisphere labels"],
  ["layer-tropics", "Tropics & polar circles"],
  ["layer-ecliptic", "Ecliptic"],
  ["layer-colures", "Colures"],
  ["layer-constellation-labels", "Constellation names"],
  ["layer-star-labels", "Star names"],
  ["layer-moon-track", "Moon's monthly path"],
  ["layer-sun", "Sun & its day circle"],
  ["layer-moon", "Moon & its day circle"],
  ["layer-horizon", "Horizon & zenith"],
  ["layer-panels", "Diagrams"],
];

/** The rules a diagram can override, as [selector suffix, declarations]. */
function panelRules(pn, st, ty) {
  return [
    [".panel-rule", `stroke:${pn.rule_stroke};stroke-width:${n(pn.rule_width)}`],
    [".panel-title", `fill:${pn.title_fill};font-family:${ty.display};` +
      `font-size:${n(pn.title_size)}px;letter-spacing:${n(pn.title_tracking)}px;` +
      `text-anchor:middle`],
    [".panel-caption", `fill:${pn.ink};font-family:${ty.body};` +
      `font-size:${n(pn.caption_size)}px;text-anchor:middle`],
    [".panel-note", `fill:${pn.ink};font-family:${ty.body};` +
      `font-size:${n(pn.caption_size)}px;font-style:italic;text-anchor:middle`],
    [".panel-tick", `fill:${pn.ink};font-family:${ty.body};` +
      `font-size:${n(pn.tick_size)}px;letter-spacing:0.3px;text-anchor:middle`],
    // Both fill and stroke: a shape is a flat fill when ruled and a set of
    // strokes when drawn, and it should be the same colour either way.
    [".panel-sun", `fill:${pn.sun};stroke:${pn.sun}`],
    [".panel-earth", `fill:${pn.earth};stroke:${pn.ink}`],
    [".panel-moon", `fill:${pn.moon};stroke:${pn.moon}`],
    [".panel-moon-dark", `fill:${pn.moon_dark};stroke:${pn.moon_dark}`],
    [".panel-planet", `fill:${pn.planet};stroke:${pn.planet}`],
    [".panel-orbit", `stroke:${pn.orbit};stroke-width:${n(pn.line_width)}`],
    [".panel-axis", `stroke:${pn.ink};stroke-width:${n(pn.line_width)}`],
    [".panel-ray", `stroke:${pn.ink};stroke-width:${n(pn.line_width * 0.8)}`],
    [".panel-scale", `stroke:${pn.ink};stroke-width:${n(pn.line_width)}`],
    [".panel-umbra", `fill:${pn.umbra};fill-opacity:${n(pn.umbra_opacity)};` +
      `stroke:${pn.umbra}`],
    [".star", `fill:${pn.star_sample}`],
    [".star-halo", `fill:${pn.star_sample};fill-opacity:${n(st.halo_opacity)}`],
    [".constel-label,.panel .star-label", `fill:${pn.ink}`],
  ];
}

export function stylesheet(theme, ui = {}) {
  const pg = theme.page, pl = theme.plate, st = theme.stars;
  const mw = theme.milkyway, gr = theme.grid, ty = theme.type;
  const hz = theme.horizon, rf = theme.reference, lb = theme.labels, bd = theme.bodies;
  const pn = theme.panels;

  const rules = [
    `.page-bg{fill:${pg.background}}`,
    `.paper-over{opacity:${n(pg.age?.paper ?? 0)}}`,
    `.paper-under{opacity:${n((pg.age?.paper ?? 0) * (pg.age?.under ?? 0.5))}}`,
    `.age-wear{opacity:${n(pg.age?.wear ?? 0)}}`,
    `.frame{fill:none;stroke:${pg.frame};stroke-width:${n(pg.frame_width)}}`,
    `.frame-inner{fill:none;stroke:${pg.frame};stroke-width:${n(pg.frame_inner_width)}}`,
    `.plate-bg{fill:${pl.fill}}`,
    `.rim-band{fill:${pl.scale_fill}}`,
    `.rim-inner{fill:none;stroke:${pl.rim};stroke-width:${n(pl.rim_width)}}`,
    `.rim-outer{fill:none;stroke:${pg.frame};stroke-width:${n(pl.rim_width)}}`,
    `.scale-tick{stroke:${pl.scale_tick};stroke-width:0.3}`,
    `.scale-label{fill:${pl.scale_text};font-family:${ty.body};` +
      `font-size:${n(ty.scale_size)}px;text-anchor:middle}`,
    `.mw{fill:${mw.fill};stroke:none}`,
    `.grid{fill:none;stroke:${gr.stroke};stroke-width:${n(gr.width)};` +
      `stroke-opacity:${n(gr.opacity)}}`,
    `.grid-accent{stroke:${gr.accent_stroke};stroke-width:${n(gr.accent_width)}}`,
    `.star{fill:${st.fill}}`,
    `.star-halo{fill:${st.halo_fill};fill-opacity:${n(st.halo_opacity)}}`,
    `.title{fill:${ty.title_fill};font-family:${ty.display};` +
      `font-size:${n(ty.title_size)}px;letter-spacing:${n(ty.title_tracking)}px;` +
      `text-anchor:middle}`,
    `.hemi-label{fill:${ty.hemi_fill};font-family:${ty.display};` +
      `font-size:${n(ty.hemi_size)}px}`,
    `.horizon{fill:none;stroke:${hz.stroke};stroke-width:${n(hz.width)};` +
      `stroke-dasharray:${hz.dash};stroke-opacity:${n(hz.opacity)};stroke-linecap:round}`,
    `.zenith{fill:none;stroke:${hz.zenith_stroke};` +
      `stroke-width:${n(hz.zenith_width)};stroke-opacity:${n(hz.opacity)}}`,
    `.caption{fill:${hz.caption_fill};font-family:${ty.body};` +
      `font-size:${n(hz.caption_size)}px;letter-spacing:0.6px;text-anchor:middle}`,
    `.ref-circle{fill:none;stroke:${rf.stroke};stroke-width:${n(rf.width)};` +
      `stroke-dasharray:${rf.dash}}`,
    `.ecliptic{fill:none;stroke:${rf.ecliptic_stroke};stroke-width:${n(rf.ecliptic_width)}}`,
    `.colure{fill:none;stroke:${rf.colure_stroke};stroke-width:${n(rf.colure_width)}}`,
    `.ref-label,.ecliptic-label{fill:${rf.label_fill};font-family:${ty.body};` +
      `font-size:${n(rf.label_size)}px;font-style:italic}`,
    `.star-label{fill:${ty.star_fill};font-family:${ty.label};` +
      `font-size:${n(ty.star_size)}px;font-style:italic}`,
    `.constel-label{fill:${ty.constel_fill};font-family:${ty.label};` +
      `font-size:${n(ty.constel_size)}px}`,
    `.constel-label-alt{fill:${ty.constel_alt};font-family:${ty.label};` +
      `font-size:${n(ty.constel_size * (ty.constel_alt_scale ?? 0.78))}px;font-style:italic}`,
    `.sun-disc{fill:${bd.sun_fill}}`,
    `.sun-ray{fill:${bd.sun_ray};stroke:none}`,
    `.sun-limb{fill:none;stroke:${bd.sun_limb};stroke-width:0.35}`,
    `.moon-dark{fill:${bd.moon_dark}}`,
    `.moon-lit{fill:${bd.moon_lit}}`,
    `.moon-limb{fill:none;stroke:${bd.moon_limb};stroke-width:0.35}`,
    `.day-circle{fill:none;stroke-width:${n(bd.day_circle_width)};` +
      `stroke-dasharray:${bd.day_circle_dash}}`,
    `.day-circle-sun{stroke:${bd.day_circle_sun}}`,
    `.day-circle-moon{stroke:${bd.day_circle_moon}}`,
    `.moon-track{fill:none;stroke:${bd.moon_track};` +
      `stroke-width:${n(bd.moon_track_width)};stroke-dasharray:${bd.moon_track_dash}}`,
    `.body-label{font-family:${ty.body};font-size:${n(bd.label_size)}px;font-style:italic}`,
    `.body-label-sun{fill:${bd.day_circle_sun}}`,
    `.body-label-moon{fill:${bd.day_circle_moon}}`,
  ];

  // The same rules the per-diagram overrides use, unscoped. Emitting both from
  // one function is the only way they stay in step.
  for (const [suffix, decls] of panelRules(pn, st, ty)) rules.push(`${suffix}{${decls}}`);

  mw.opacities.forEach((o, i) =>
    rules.push(`.mw-${i + 1}{fill-opacity:${n(o * (ui.mwScale ?? 1))}}`));
  st.radii.forEach((r, i) => {
    rules.push(`.mag-${i + 1}{r:${n(r * (ui.starScale ?? 1))}px}`);
    rules.push(`.halo-${i + 1}{r:${n(r * (ui.starScale ?? 1) * st.halo_scale)}px}`);
  });

  // Drawn strokes carry a colour class for the colour and this for the rest.
  // It has to sit after them all: `fill:none` is what stops a hatched shape
  // being a filled one with lines on top, and it wins on order, not weight.
  rules.push(".hand{fill:none;stroke-linecap:round;stroke-linejoin:round}");

  // A diagram with its own styling gets the same rules again, scoped to their id,
  // which is enough to win on specificity.
  for (const [name, override] of Object.entries(theme.panelStyles ?? {})) {
    if (!override || !Object.keys(override).length) continue;
    const own = { ...pn, ...override };
    for (const [suffix, decls] of panelRules(own, st, ty)) {
      rules.push(`#panel-${name} ${suffix}{${decls}}`);
    }
    rules.push(`#panel-${name} .hand{fill:none}`);
  }

  for (let k = (ui.labelBucket ?? lb.mag_bucket) + 1; k < BUCKET_COUNT; k++) {
    rules.push(`.lbl-b${k}{display:none}`);
  }
  for (let m = (ui.magLimit ?? 5) + 1; m <= 5; m++) {
    rules.push(`.mag-${m},.halo-${m}{display:none}`);
  }
  return rules.join("\n");
}
