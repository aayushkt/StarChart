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
export function moonMonth(observer, days = 29.53, samples = 240) {
  const start = observer.utc.getTime() - (days / 2) * 86400000;
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const t = Astronomy.MakeTime(new Date(start + (days * i * 86400000) / samples));
    const eq = Astronomy.EquatorFromVector(Astronomy.GeoVector("Moon", t, true));
    out.push([eq.ra * 15, eq.dec]);
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
