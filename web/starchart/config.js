/* What to draw. Layout and content live here; colours and type live in the
 * theme (web/starchart/themes/). A module rather than JSON so the reasoning
 * stays attached to the numbers.
 */

export default {
  title: "CELESTIAL CHART",

  page: {
    // 24 x 36 inches, in millimetres. SVG user units are millimetres throughout,
    // so the file carries its real print size.
    width: 609.6,
    height: 914.4,
    margin: 46.0,
  },

  layout: {
    // North circle on top, south below -- the one structural change from the
    // original, which prints them side by side.
    radius: 166.0,
    gap: 26.0,
    // First circle starts this far below the top margin, leaving room for the title.
    top_offset: 92.0,
    // How far past the celestial equator each circle reaches. The original
    // overlaps: both of its circles carry Virgo and Sextans.
    overlap_deg: 15.0,
    // Right ascension placed at the top of each circle.
    ra_zero_deg: 0.0,
    // Angle of the curved "NORTHERN HEMISPHERE" label, clockwise from up.
    hemi_label_deg: -40.0,
  },

  stars: {
    limiting_mag: 6.0,
  },

  labels: {
    enabled: true,
    // Stars brighter than this get a name placed at render time. The editor's
    // threshold slider then hides and reveals them without re-rendering, so this
    // is the ceiling rather than the setting.
    star_mag_limit: 5.0,
    // "english", "latin", or "both" -- the original carries both, English over
    // Latin in parentheses.
    constellation_names: "both",
  },

  bodies: {
    // Plot the Sun and Moon for the configured instant, with the circle each
    // traced that day.
    enabled: true,
    moon_track: true,
  },

  time: {
    // The plate itself is time-independent; this drives the overlay -- the Sun,
    // Moon and horizon for one observer at one moment.
    //
    // These are neutral defaults: midnight at Greenwich on the J2000 epoch. To
    // chart your own moment, copy this file to config.local.js and edit it --
    // the editor picks that up automatically and it is not committed.
    enabled: true,
    datetime: "2000-01-01T00:00:00",
    tz: "UTC",
    latitude: 51.4779,
    longitude: -0.0015,
    place: "Greenwich",
    // The place name is used in the editor for orientation. Set false to keep it
    // off the printed poster, which then carries the coordinates alone.
    show_place: false,
  },
};
