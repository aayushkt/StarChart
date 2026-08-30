/* Ink on aged parchment, after the portolan charts and the notebook pages.
 *
 * The Cavallini theme is a printed lithograph: pale sage paper, deep petrol
 * plates, everything crisp. This one is the other tradition — a working chart
 * drawn in iron-gall ink on a sheet that has been handled. Three things carry
 * it, and they are worth stating because tuning any one of them alone will pull
 * the whole thing off:
 *
 *   The ground is warm and mottled rather than flat and cool, so every colour
 *   above it is a brown or an ochre. There is no true black and no true white
 *   anywhere in this file; the darkest value is a soot brown and the lightest a
 *   bone cream, because ink and paper never reach either end.
 *
 *   The plates stay dark, but as a soot-brown wash rather than a blue — the
 *   composition depends on the two discs reading as solid, and turning them to
 *   parchment would lose the whole structure of the sheet.
 *
 *   The line work sits closer in value to its ground than the printed theme
 *   does. Ink on paper has less contrast than ink on plate, and matching the
 *   lithograph's separation here reads as a modern overlay rather than
 *   something drawn.
 */

export default {
  name: "portolan",

  panelStyles: {},

  page: {
    // Tea-stained rag paper. Warm enough that the sepia sits in it rather than
    // on it.
    background: "#ddcdaa",
    frame: "#4a3722",
    frame_width: 1.4,
    frame_inset: 10.0,
    frame_inner_gap: 3.0,
    frame_inner_width: 0.5,
    // Age, generated in the file rather than photographed into it: broad damp
    // blotches, a finer mottle, tooth in the fibre, and darker edges. All of it
    // behind the line work, except the edge wear, which falls over everything.
    age: {
      // Scanned paper, mirror-tiled at two sizes. See textures.js.
      paper: 1.0,
      under: 0.55,
      // Big enough that only a couple of mirror axes fall on the sheet;
      // small enough that the scan still carries about 170 pixels per inch.
      tile: 203,
      under_tile: 139,
      // Edge darkening on top, with a torn boundary.
      wear: 0.32,
      colour: "#6b4a22",
      wear_start: 48,
      wear_reach: 72,
      wear_ragged: 48,
      wear_frequency: 0.011,
      seed: 7,
    },
  },

  plate: {
    // Soot brown, not black: an ink wash laid thick still shows its colour.
    fill: "#2b2317",
    rim: "#e5d8b8",
    rim_width: 1.2,
    scale_band: 16.5,
    scale_fill: "#e2d3ae",
    scale_text: "#4a3722",
    scale_tick: "#4a3722",
  },

  stars: {
    // Bone, warmed. Gold on brown goes muddy, so the stars are lifted toward
    // cream and left to carry their brightness by size instead.
    fill: "#f0e0b4",
    radii: [1.55, 1.2, 0.92, 0.68, 0.46],
    halo_classes: 2,
    halo_fill: "#f0e0b4",
    halo_opacity: 0.1,
    halo_scale: 2.6,
  },

  milkyway: {
    fill: "#c4b087",
    opacities: [0.11, 0.11, 0.12, 0.13, 0.14],
  },

  grid: {
    // Faint, like a ruling laid down before the drawing and never meant to be
    // read on its own.
    stroke: "#9a8358",
    width: 0.28,
    opacity: 0.5,
    dec_step: 10.0,
    ra_step: 10.0,
    hub_deg: 10.0,
    // A fraction of the diagrams' hand: scribed, not sketched.
    hand: 0.35,
    accent_stroke: "#c0aa78",
    accent_width: 0.5,
  },

  reference: {
    stroke: "#b09767",
    width: 0.45,
    dash: "none",
    ecliptic_stroke: "#d8c48b",
    ecliptic_width: 0.7,
    colure_stroke: "#9a8358",
    colure_width: 0.4,
    label_fill: "#e0d0a6",
    label_size: 5.4,
    label_tracking: 0.675,
    label_clearance: 1.725,
    small_circle_label_deg: 150.0,
    ecliptic_label_lon: 300.0,
    colure_label_frac: 0.62,
  },

  labels: {
    star_gap: 2.85,
    constellation_tracking: 0.825,
    // Degrees clockwise from horizontal, applied to every constellation name
    // on both plates. null sets them curved along their own declination
    // circle instead, as the original does -- which is more faithful but lays
    // each name directly along a graticule ring.
    constellation_angle: -30.0,
    mag_bucket: 11,
  },

  bodies: {
    sun_fill: "#c98f2e",
    sun_ray: "#c98f2e",
    sun_limb: "#e5d8b8",
    sun_size: 2.6,
    sun_rays: 12,
    sun_ray_spread: 14.0,
    sun_ray_length: 0.3,
    moon_size: 2.4,
    moon_lit: "#efe2c0",
    moon_dark: "#4a3d28",
    moon_limb: "#e5d8b8",
    day_circle_sun: "#c98f2e",
    day_circle_moon: "#c8b78e",
    day_circle_width: 0.6,
    day_circle_dash: "1.6 1.8",
    moon_track: "#b5a179",
    moon_track_width: 0.5,
    moon_track_dash: "0.9 1.6",
    label_day_circle: true,
    label_size: 5.4,
    label_tracking: 0.675,
    label_clearance: 1.65,
    sun_label_deg: 205.0,
    moon_label_deg: 335.0,
  },

  panels: {
    // The diagrams sit on the paper, so they are drawn in the ink itself.
    // How much of a hand to draw with. 0 is ruled and flat-filled; about 1 is a
    // working hand; past 2 it reads as a shaky one. Per diagram, like
    // everything else here.
    hand: 1.0,
    rule: false,
    rule_stroke: "#4a3722",
    rule_width: 0.4,
    title_size: 4.8,
    title_tracking: 1.65,
    title_gap: 4.0,
    title_space: 3.0,
    title_fill: "#4a3722",
    caption_size: 3.45,
    tick_size: 3,
    ink: "#4a3722",
    line_width: 0.35,
    sun: "#c98f2e",
    earth: "#8a7f5c",
    moon: "#efe2c0",
    moon_dark: "#4a3d28",
    umbra: "#4a3722",
    umbra_opacity: 0.22,
    orbit: "#7a6743",
    planet: "#4a3722",
    star_sample: "#a8801f",
  },

  horizon: {
    // Rubricated: the one warm red on the sheet, as a corrector's line would be.
    stroke: "#a8412a",
    width: 0.9,
    dash: "3.2 2.2",
    opacity: 0.92,
    zenith_stroke: "#a8412a",
    zenith_width: 0.7,
    zenith_size: 2.2,
    caption_fill: "#4a3722",
    caption_size: 7.5,
  },

  type: {
    display: "Didot, 'Bodoni 72', 'Bodoni MT', Georgia, serif",
    body: "'Iowan Old Style', Palatino, 'Palatino Linotype', Georgia, serif",
    label: "'Iowan Old Style', Palatino, Georgia, serif",

    title_size: 30,
    title_tracking: 6.3,
    title_fill: "#4a3722",
    hemi_size: 10.5,
    hemi_tracking: 3.9,
    hemi_fill: "#4a3722",
    scale_size: 5.4,
    constel_size: 5.1,
    constel_alt_scale: 1.0,
    constel_fill: "#efe3c4",
    star_size: 5.4,
    star_fill: "#e8dab6",
    constel_alt: "#c8b78e",
  },
};
