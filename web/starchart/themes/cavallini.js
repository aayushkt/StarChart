/* Visual theme for the plate. Everything here is styling only -- changing any of
 * it restyles the chart without re-running any astronomy.
 *
 * Colours are eyeballed from the puzzle scan and meant to be tuned. The two that
 * carry the whole look are `plate.fill` (the deep petrol blue of the circles)
 * and `stars.fill` (the pale gold the stars are engraved in).
 *
 * A module rather than JSON so the comments survive: most of what is worth
 * knowing about these numbers is why they are what they are.
 */

export default {
  name: "cavallini",

  // Per-diagram overrides of `panels`, keyed by diagram name. Empty by default:
  // the editor fills one in the moment a diagram is styled on its own.
  panelStyles: {},

  page: {
    // Paper is a pale aged sage, not white -- the original has a green cast.
    background: "#e2e6dc",
    frame: "#1d3a49",
    frame_width: 1.4,
    frame_inset: 10.0,
    // The thin second rule inside the frame, as on the original.
    frame_inner_gap: 3.0,
    frame_inner_width: 0.5,
    // Age, generated in the file rather than photographed into it: broad damp
    // blotches, a finer mottle, tooth in the fibre, and darker edges. All of it
    // behind the line work, except the edge wear, which falls over everything.
    // The lithograph is printed on clean stock: no scan, no wear.
    age: { paper: 0, wear: 0 },
  },

  plate: {
    fill: "#1c3d52",
    rim: "#f2efe2",
    rim_width: 1.2,
    // Width of the pale band between the rim circles carrying the degree scale.
    scale_band: 16.5,
    scale_fill: "#f2efe2",
    scale_text: "#1d3a49",
    scale_tick: "#1d3a49",
  },

  stars: {
    fill: "#f5cf63",
    // Drawn radius in mm for magnitude classes 1 through 5.
    radii: [1.55, 1.2, 0.92, 0.68, 0.46],
    // The brightest classes get a faint halo, as the engraving does.
    halo_classes: 2,
    halo_fill: "#f5cf63",
    halo_opacity: 0.12,
    halo_scale: 2.6,
  },

  milkyway: {
    // Five nested contours, painted brightest-last so they stack into a band.
    fill: "#a9c6cf",
    opacities: [0.13, 0.13, 0.14, 0.15, 0.16],
  },

  grid: {
    stroke: "#7ba0b2",
    width: 0.28,
    opacity: 0.55,
    dec_step: 10.0,
    ra_step: 10.0,
    // Meridians stop this far from the pole, leaving a clear polar circle.
    hub_deg: 10.0,
    // A fraction of the diagrams' hand: scribed, not sketched.
    hand: 0.0,
    // Emphasised circles: the equator and the polar circle.
    accent_stroke: "#a8c4d2",
    accent_width: 0.5,
  },

  reference: {
    // Tropics, polar circles, ecliptic and colures. Paler than the star field so
    // they read as ruling rather than content.
    stroke: "#9dc0cf",
    width: 0.45,
    dash: "none",
    ecliptic_stroke: "#c8d8b8",
    ecliptic_width: 0.7,
    colure_stroke: "#8fb2c2",
    colure_width: 0.4,
    label_fill: "#cfe0e6",
    label_size: 5.4,
    label_tracking: 0.675,
    // Gap between the tops of the letters and the circle they sit inside. The
    // baseline is derived from this, because glyphs grow outward from the
    // baseline on an outward-facing arc -- a raw offset instead lets the
    // ascenders cross the circle and be clipped by it.
    label_clearance: 1.725,
    // Where each kind of label sits, clockwise from straight up.
    small_circle_label_deg: 150.0,
    ecliptic_label_lon: 300.0,
    colure_label_frac: 0.62,
  },

  labels: {
    // Gap between a star and its name, in mm.
    star_gap: 2.85,
    constellation_tracking: 0.825,
    // Curved along each constellation's own declination circle, as the
    // lithograph this sheet is after actually sets them.
    constellation_angle: null,
    // Faintest bucket whose labels are shown; see labels.js.
    mag_bucket: 11,
  },

  bodies: {
    // The Sun and Moon at the configured instant, and the circles they trace
    // that day. A body's day path is its declination circle -- concentric with
    // the plate, so a real circle here.
    sun_fill: "#f0b429",
    sun_ray: "#f0b429",
    sun_limb: "#cfd8d0",
    sun_size: 2.6,
    // Shallow filled triangles, bases tucked under the disc.
    sun_rays: 12,
    sun_ray_spread: 14.0,
    sun_ray_length: 0.3,
    moon_size: 2.4,
    moon_lit: "#f4efdc",
    moon_dark: "#2a4a5e",
    moon_limb: "#cfd8d0",
    day_circle_sun: "#f0b429",
    day_circle_moon: "#bcd2dc",
    day_circle_width: 0.6,
    day_circle_dash: "1.6 1.8",
    moon_track: "#9fb9c6",
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
    // The diagrams around the plates. Drawn in the frame's ink on the paper, so
    // they read as engraving on the sheet rather than as part of a plate.
    // How much of a hand to draw with. 0 is ruled and flat-filled; about 1 is a
    // working hand; past 2 it reads as a shaky one. Per diagram, like
    // everything else here.
    hand: 0.0,
    rule: false,
    rule_stroke: "#1d3a49",
    rule_width: 0.4,
    title_size: 4.8,
    title_tracking: 1.65,
    title_gap: 4.0,
    title_space: 3.0,
    title_fill: "#1d3a49",
    caption_size: 3.45,
    tick_size: 3,
    ink: "#1d3a49",
    line_width: 0.35,
    sun: "#f0b429",
    earth: "#7ea9a2",
    moon: "#f4efdc",
    moon_dark: "#2a4a5e",
    umbra: "#1d3a49",
    umbra_opacity: 0.24,
    orbit: "#6d8a97",
    planet: "#1d3a49",
    // Stars in the key sit on paper, not on a plate, so they take the ink.
    star_sample: "#c99a1e",
  },

  horizon: {
    // The observer's overlay. Warmer than everything else on the plate so it
    // reads as an annotation laid over the chart rather than part of it.
    stroke: "#e8734a",
    width: 0.9,
    dash: "3.2 2.2",
    opacity: 0.95,
    zenith_stroke: "#e8734a",
    zenith_width: 0.7,
    zenith_size: 2.2,
    caption_fill: "#1d3a49",
    caption_size: 7.5,
  },

  type: {
    // System stacks -- no webfont fetching, and these are what the original's
    // engraved lettering most resembles among faces likely to be installed.
    display: "Didot, 'Bodoni 72', 'Bodoni MT', Georgia, serif",
    body: "'Iowan Old Style', Palatino, 'Palatino Linotype', Georgia, serif",
    label: "'Iowan Old Style', Palatino, Georgia, serif",

    title_size: 30,
    title_tracking: 6.3,
    title_fill: "#1d3a49",
    hemi_size: 10.5,
    hemi_tracking: 3.9,
    hemi_fill: "#1d3a49",
    scale_size: 5.4,
    // The smallest type on the plate; nothing else goes below it.
    constel_size: 5.1,
    // The Latin name under the English one. Set to the same size rather than
    // stepped down, so nothing on the plate is smaller than a constellation
    // name -- the italic already tells the two lines apart.
    constel_alt_scale: 1.0,
    constel_fill: "#eee9d6",
    star_size: 5.4,
    star_fill: "#f0ead7",
    constel_alt: "#cfe0e6",
  },
};
