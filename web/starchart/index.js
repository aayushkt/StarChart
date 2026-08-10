/* Public entry point.
 *
 * Plain ES modules, no build step -- drop the folder into a static site and
 * import it:
 *
 *     import { renderChart } from '/starchart/index.js';
 *     const svg = await renderChart({ base: '/starchart' });
 *     document.querySelector('#chart').innerHTML = svg;
 */

import { dayTrack, states } from "./bodies.js";
import { loadCatalogues } from "./catalog.js";
import defaultConfig from "./config.js";
import defaultTheme from "./themes/cavallini.js";
import { buildChart } from "./render.js";
import { LAYERS } from "./style.js";

export { LAYERS, stylesheet } from "./style.js";
export { buildChart } from "./render.js";
export { loadCatalogues } from "./catalog.js";
export { default as defaultConfig } from "./config.js";
export { default as defaultTheme } from "./themes/cavallini.js";
export { bucketMagnitude, BUCKET_COUNT } from "./labels.js";
export { clockLabel, caption } from "./overlay.js";

/** Minutes a zone is offset from UTC on a given local date. */
export function offsetMinutes(localISO, timeZone) {
  const naive = new Date(localISO + "Z");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(naive);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"),
    get("hour") % 24, get("minute"), get("second"));
  // Formatting the instant *in* the zone and reading it back as UTC shifts it
  // by exactly the zone's offset, so the difference is the offset itself --
  // negative west of Greenwich. Negating here is the classic sign slip.
  return (asUTC - naive.getTime()) / 60000;
}

/** Build the observer the renderer wants from the `[time]` config table. */
export function makeObserver(config) {
  const t = config.time;
  if (!t?.enabled) return null;

  const [datePart, timePart] = t.datetime.split("T");
  const [hh, mm] = timePart.split(":").map(Number);
  const minutes = hh * 60 + mm;
  const offset = offsetMinutes(t.datetime, t.tz ?? "UTC");
  const [y, m, d] = datePart.split("-").map(Number);

  const midnightUtc = new Date(Date.UTC(y, m - 1, d) - offset * 60000);
  const utc = new Date(midnightUtc.getTime() + minutes * 60000);

  const observer = {
    latitude: t.latitude, longitude: t.longitude,
    place: t.place ?? "", showPlace: t.show_place ?? true,
    localDate: datePart, minutes, offsetMinutes: offset,
    midnightUtc, utc,
    get lstDeg() {
      const jd = this.utc.getTime() / 86400000 + 2440587.5;
      const T = (jd - 2451545.0) / 36525.0;
      const g = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
        + 0.000387933 * T * T - (T * T * T) / 38710000.0;
      return (((g + this.longitude) % 360) + 360) % 360;
    },
  };
  return observer;
}

/** Move an observer to a different minute of the same local day. */
export function atMinutes(observer, minutes) {
  return {
    ...observer, minutes,
    utc: new Date(observer.midnightUtc.getTime() + minutes * 60000),
    get lstDeg() {
      const jd = this.utc.getTime() / 86400000 + 2440587.5;
      const T = (jd - 2451545.0) / 36525.0;
      const g = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
        + 0.000387933 * T * T - (T * T * T) / 38710000.0;
      return (((g + this.longitude) % 360) + 360) % 360;
    },
  };
}

/** Load everything and render. Returns SVG markup. */
export async function renderChart({ base = ".", config: override, theme = defaultTheme, ui = {} } = {}) {
  const data = await loadCatalogues(base);
  const config = { ...defaultConfig, ...(override ?? {}) };
  const { markup } = buildChart({ config, theme, data, observer: makeObserver(config), ui });
  return markup;
}

/** Everything the editor needs in one call. */
export async function loadChart({ base = ".", config = defaultConfig, theme = defaultTheme } = {}) {
  const data = await loadCatalogues(base);
  const observer = makeObserver(config);
  return {
    config, theme, data, observer,
    layers: LAYERS.map(([id, label]) => ({ id, label })),
    bodies: observer && config.bodies?.enabled
      ? { track: dayTrack(observer), state: states(observer) }
      : null,
  };
}
