/* Azimuthal equidistant projection, centred on a celestial pole.
 *
 * Mirrors starchart/projection.py. See that file for why this projection and
 * not the stereographic one star-map generators normally use.
 */

export const NORTH = "north";
export const SOUTH = "south";

const RAD = Math.PI / 180;

export class Hemisphere {
  constructor({ pole, cx, cy, radius, overlapDeg = 15, raZeroDeg = 0, clockwise = false }) {
    Object.assign(this, { pole, cx, cy, radius, overlapDeg, raZeroDeg, clockwise });
  }

  /** Angular distance from the rim to this circle's pole, in degrees. */
  get zMax() {
    return 90 + this.overlapDeg;
  }

  /** Angular distance of a declination from this circle's pole. */
  polarDistance(dec) {
    return this.pole === NORTH ? 90 - dec : 90 + dec;
  }

  /** Project equatorial coordinates to millimetres. Returns [x, y]. */
  project(ra, dec) {
    const r = (this.radius * this.polarDistance(dec)) / this.zMax;
    const t = (ra - this.raZeroDeg) * RAD * (this.clockwise ? 1 : -1);
    return [this.cx + r * Math.sin(t), this.cy - r * Math.cos(t)];
  }

  /** Is this declination inside the rim? */
  visible(dec, marginDeg = 0) {
    return this.polarDistance(dec) <= this.zMax + marginDeg;
  }

  /** Radius of the declination ring at `dec`, in millimetres. */
  radiusForDec(dec) {
    return (this.radius * this.polarDistance(dec)) / this.zMax;
  }
}

/** North above south, the one structural change from the original plate. */
export function stackedPair({ width, topY, radius, gap, ...rest }) {
  const cx = width / 2;
  return [
    new Hemisphere({ pole: NORTH, cx, cy: topY + radius, radius, ...rest }),
    new Hemisphere({ pole: SOUTH, cx, cy: topY + radius + gap + 2 * radius, radius, ...rest }),
  ];
}
