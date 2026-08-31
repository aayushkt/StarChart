/* The Sun and Moon: where they were, and the paths they traced.
 *
 * Mirrors starchart/bodies.py, with astronomy-engine standing in for Skyfield.
 * That swap is what makes the chart runnable in a browser at all: Skyfield
 * needs a 16 MB JPL binary, while astronomy-engine compiles a truncated VSOP87
 * into 116 KB of source with no data files. Checked against Skyfield for this
 * chart's instant, the two agree to 0.02 degrees in right ascension and exactly
 * in declination -- about 0.03 mm on the plate.
 *
 * A body's path across one day is its circle of constant declination: the Earth
 * spins underneath it and carries it round the pole. On this projection that is
 * exactly concentric with the plate's centre, and where it crosses the horizon
 * curve is where the body rose and set.
 */

import * as Astronomy from "./vendor/astronomy.js";
import { CAP_HEIGHT, arcText } from "./lettering.js";
import { circle, fmt, line, path, polylineD } from "./svg.js";
import { curveRuns } from "./overlay.js";

const BODIES = ["sun", "moon"];
const NAME = { sun: "Sun", moon: "Moon" };

/** Sun and Moon as seen from the observer, at their instant. */
export function states(observer) {
  const t = Astronomy.MakeTime(observer.utc);
  const site = new Astronomy.Observer(observer.latitude, observer.longitude, 0);
  const illum = Astronomy.Illumination("Moon", t);
  const sunEcl = Astronomy.Ecliptic(Astronomy.GeoVector("Sun", t, true));
  const moonEcl = Astronomy.Ecliptic(Astronomy.GeoVector("Moon", t, true));

  const out = {};
  for (const key of BODIES) {
    // J2000, not equator-of-date: the star catalogue is J2000, and mixing the
    // two puts the Sun a precession-worth of arc off the ecliptic it defines.
    const eq = Astronomy.Equator(NAME[key], t, site, false, true);
    // Refraction off: this is geometry, not what the eye would have seen, and
    // the refracted value disagrees with the true altitude by a third of a
    // degree for a body well below the horizon.
    const hor = Astronomy.Horizon(t, site, eq.ra, eq.dec, null);
    out[key] = {
      name: key,
      ra: eq.ra * 15,
      dec: eq.dec,
      altitude: hor.altitude,
      illuminated: key === "sun" ? 1 : illum.phase_fraction,
      elongation: key === "sun" ? 0 : ((moonEcl.elon - sunEcl.elon) % 360 + 360) % 360,
    };
  }
  return out;
}

/** Sample the bodies across the observer's local day, for the time slider. */
export function dayTrack(observer, stepMinutes = 30) {
  const steps = (24 * 60) / stepMinutes;
  const out = { sun: [], moon: [] };
  for (let i = 0; i <= steps; i++) {
    const when = new Date(observer.midnightUtc.getTime() + i * stepMinutes * 60000);
    const t = Astronomy.MakeTime(when);
    for (const key of BODIES) {
      // Geocentric, so no Observer -- and J2000 to match the catalogue.
      const eq = Astronomy.EquatorFromVector(Astronomy.GeoVector(NAME[key], t, true));
      out[key].push([
        Number((eq.ra * 15).toFixed(4)),
        Number(eq.dec.toFixed(4)),
      ]);
    }
  }
  return out;
}

/** The Moon's path against the stars over one synodic month. */
/** Where the Moon is against the stars, in degrees of RA and declination. */
function moonAt(ms) {
  const t = Astronomy.MakeTime(new Date(ms));
  const eq = Astronomy.EquatorFromVector(Astronomy.GeoVector("Moon", t, true));
  return [eq.ra * 15, eq.dec];
}

/** Angular distance between two RA/dec pairs, near enough at these separations. */
function apart([ra1, dec1], [ra2, dec2]) {
  const dra = ((ra1 - ra2 + 540) % 360) - 180;
  return Math.hypot(dra * Math.cos((dec1 * Math.PI) / 180), dec1 - dec2);
}

/** The mean sidereal month, in days. */
const SIDEREAL_MONTH = 27.321661;

/**
 * How long the Moon takes to come back to where it started, for this date.
 *
 * Not the synodic month. 29.53 days is the period of the *phases*, new moon to
 * new moon, and this track is a position among the stars -- which repeats on
 * the sidereal month instead. Drawing a synodic month ran 2.2 days too long, so
 * the end of the track came back over its own beginning and lay there as a
 * second strand nearly thirty degrees long.
 *
 * The sidereal month alone is not enough either: it is a mean, and the Moon's
 * orbit is eccentric and perturbed, so the true return moves either side of it
 * by a few tenths of a day -- still a degree or more of visible overlap. This
 * searches for the moment the Moon is nearest to where it began, which closes
 * the loop for the date actually being drawn.
 */
function siderealReturn(fromMs) {
  const start = moonAt(fromMs);
  const gap = (days) => apart(moonAt(fromMs + days * 86400000), start);
  // Golden-section on a window wide enough to hold any real return.
  let lo = SIDEREAL_MONTH - 0.9, hi = SIDEREAL_MONTH + 0.9;
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = hi - phi * (hi - lo), d = lo + phi * (hi - lo);
  let fc = gap(c), fd = gap(d);
  for (let i = 0; i < 40 && hi - lo > 1e-4; i++) {
    if (fc < fd) { hi = d; d = c; fd = fc; c = hi - phi * (hi - lo); fc = gap(c); }
    else { lo = c; c = d; fc = fd; d = lo + phi * (hi - lo); fd = gap(d); }
  }
  return (lo + hi) / 2;
}

/** The Moon's path against the stars, one revolution centred on the instant. */
export function moonMonth(observer, days = null, samples = 240) {
  // The period depends on where the track starts and the start on the period,
  // so it is estimated with the mean once and then solved from there. A second
  // pass moves it by under a minute.
  const span = days ?? siderealReturn(
    observer.utc.getTime() - (SIDEREAL_MONTH / 2) * 86400000);
  const start = observer.utc.getTime() - (span / 2) * 86400000;
  const out = [];
  for (let i = 0; i <= samples; i++) {
    out.push(moonAt(start + (span * i * 86400000) / samples));
  }
  return out;
}

/* ---------------------------------------------------------------- drawing */

/** Outline of the lit part of a disc, lit side toward +x. */
export function phasePoints(radius, illuminated, samples = 48) {
  const k = Math.min(1, Math.max(0, illuminated));
  const d = 1 - 2 * k;            // +1 at new, 0 at quarter, -1 at full
  const limb = [], term = [];
  for (let i = 0; i < samples; i++) {
    const a = (Math.PI * i) / (samples - 1);
    limb.push([radius * Math.sin(a), -radius * Math.cos(a)]);
    term.unshift([d * radius * Math.sin(a), -radius * Math.cos(a)]);
  }
  return limb.concat(term);
}

export function drawSunMarker(theme) {
  const b = theme.bodies;
  const r = b.sun_size;
  const spread = b.sun_ray_spread * (Math.PI / 180);
  const reach = r * (1 + b.sun_ray_length);
  const rays = [];
  for (let i = 0; i < b.sun_rays; i++) {
    const a = (2 * Math.PI * i) / b.sun_rays;
    rays.push(path(polylineD([
      [Math.sin(a - spread) * r * 0.96, -Math.cos(a - spread) * r * 0.96],
      [Math.sin(a) * reach, -Math.cos(a) * reach],
      [Math.sin(a + spread) * r * 0.96, -Math.cos(a + spread) * r * 0.96],
    ], true), { class_: "sun-ray" }));
  }
  return `<g>${rays.join("")}${circle(0, 0, r, { class_: "sun-disc" })}` +
         `${circle(0, 0, r, { class_: "sun-limb" })}</g>`;
}

export function drawMoonMarker(theme, illuminated, positionAngle) {
  const r = theme.bodies.moon_size;
  return `<g transform="rotate(${fmt(positionAngle)})">` +
    circle(0, 0, r, { class_: "moon-dark" }) +
    path(polylineD(phasePoints(r, illuminated), true), { class_: "moon-lit" }) +
    circle(0, 0, r, { class_: "moon-limb" }) +
    "</g>";
}

export function drawBody(hemi, state, theme, sunXY = null) {
  const b = theme.bodies;
  const kind = state.name;
  const visible = hemi.visible(state.dec);
  const parts = [];

  const radius = visible ? hemi.radiusForDec(state.dec) : 0;
  parts.push(circle(hemi.cx, hemi.cy, radius, {
    class_: `day-circle day-circle-${kind}`, id: `day-circle-${kind}-${hemi.pole}`,
  }));

  if (b.label_day_circle && visible) {
    const size = b.label_size;
    const baseline = radius - (CAP_HEIGHT * size + b.label_clearance);
    if (baseline > size * 2) {
      parts.push(arcText(hemi.cx, hemi.cy, baseline, b[`${kind}_label_deg`],
        `${kind.toUpperCase()}'S PATH THIS DAY`,
        { size, tracking: b.label_tracking, class_: `body-label body-label-${kind}` }));
    }
  }

  const [x, y] = hemi.project(state.ra, state.dec);
  let angle = 0;
  if (kind === "moon" && sunXY) angle = Math.atan2(sunXY[1] - y, sunXY[0] - x) * (180 / Math.PI);
  const marker = kind === "sun" ? drawSunMarker(theme)
                                : drawMoonMarker(theme, state.illuminated, angle);
  parts.push(`<g class="body-marker" id="marker-${kind}-${hemi.pole}" ` +
             `transform="translate(${fmt(x)},${fmt(y)})">${marker}</g>`);

  // Emitted even when off this plate, so the time slider can reveal a body that
  // crosses over during the day.
  const style = visible ? "" : ' style="display:none"';
  return `<g id="body-${kind}-${hemi.pole}"${style}>${parts.join("")}</g>`;
}

export function drawMoonTrack(hemi, observer, theme) {
  const runs = curveRuns(hemi, moonMonth(observer));
  if (!runs.length) return "<g></g>";
  return `<g>${path(runs.map((r) => polylineD(r)).join(""), { class_: "moon-track" })}</g>`;
}
