/* The observer's horizon.
 *
 * Mirrors starchart/horizon.py, and a test diffs the two over a grid of
 * latitudes and sidereal times. See that file for why the horizon is a
 * polyline here and not a circle -- and why stereographic would have kept it
 * circular, which is what astrolabes are built on.
 */

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/** Equatorial coordinates of the horizon: [[ra, dec], ...] once around. */
export function horizonCurve(latitude, lstDeg, samples = 720) {
  const phi = latitude * RAD;
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const az = (i / samples) * 2 * Math.PI;
    const dec = Math.asin(Math.cos(phi) * Math.cos(az));
    // Both components keep their common factor of 1/cos(dec) so it cancels in
    // atan2. Normalising one and not the other skews the angle by degrees.
    const hourAngle = Math.atan2(-Math.sin(az), -Math.sin(phi) * Math.cos(az));
    out.push([(((lstDeg - hourAngle * DEG) % 360) + 360) % 360, dec * DEG]);
  }
  return out;
}

/** The point directly overhead: right ascension equals sidereal time. */
export function zenith(latitude, lstDeg) {
  return [((lstDeg % 360) + 360) % 360, latitude];
}

/** Greenwich mean sidereal time in degrees (IAU 1982 polynomial). */
export function gmstDeg(julianDay) {
  const T = (julianDay - 2451545.0) / 36525.0;
  const g =
    280.46061837 +
    360.98564736629 * (julianDay - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000.0;
  return ((g % 360) + 360) % 360;
}

/** Local sidereal time for a UTC Date and an east-positive longitude. */
export function lstFor(date, longitude) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  return ((gmstDeg(jd) + longitude) % 360 + 360) % 360;
}
