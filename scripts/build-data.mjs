/* Trim the vendored catalogues down to what the renderer actually reads.
 *
 *     node scripts/build-data.mjs
 *
 * The d3-celestial files carry cross-index identifiers, variable-star
 * designations and translations into a dozen languages, none of which this
 * chart uses. Shipping them is 410 KB gzipped of mostly dead weight; keeping
 * only the fields that are read, and rounding to the precision a poster
 * resolves, cuts that to a third.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "data", "d3-celestial");
const OUT = path.join(ROOT, "web", "starchart", "data");

// A poster resolves about 0.01 degrees at the sizes we print; three decimals is
// an order of magnitude finer than that.
const COORD_PLACES = 3;
const MW_PLACES = 2;
// The Milky Way outline is sampled at roughly 0.12 degrees, which is 0.2 mm at
// plate scale -- far finer than a soft translucent band can show.
const MW_MIN_STEP = 0.15;

const read = (name) => JSON.parse(fs.readFileSync(path.join(SRC, name), "utf8"));
const round = (v, p) => Number(v.toFixed(p));

function thin(ring, minStep = MW_MIN_STEP) {
  const out = [ring[0]];
  for (const [x, y] of ring.slice(1)) {
    const [px, py] = out[out.length - 1];
    if (Math.abs(x - px) >= minStep || Math.abs(y - py) >= minStep) out.push([x, y]);
  }
  return out.length < 4 ? ring : out;
}

const starFeatures = read("stars.6.json").features.filter((f) => f.properties.mag <= 6);
const nameTable = read("starnames.json");

const payload = {
  // [ra, dec, magnitude] -- the renderer reads nothing else.
  stars: starFeatures.map((f) => [
    round(f.geometry.coordinates[0], COORD_PLACES),
    round(f.geometry.coordinates[1], COORD_PLACES),
    round(f.properties.mag, 2),
  ]),
  // Index into `stars` -> proper name. Only a tenth of the catalogue has one.
  starNames: Object.fromEntries(
    starFeatures
      .map((f, i) => [i, nameTable[String(f.id)]?.name])
      .filter(([, name]) => name)
  ),
  constellations: read("constellations.json").features.map((f) => [
    round(f.geometry.coordinates[0], 2),
    round(f.geometry.coordinates[1], 2),
    (f.properties.en || f.properties.name).replace(/ /g, " "),
    f.properties.la || f.properties.name,
  ]),
  milkyWay: ["ol1", "ol2", "ol3", "ol4", "ol5"].map((id) => {
    const feature = read("mw.json").features.find((f) => f.id === id);
    const rings = [];
    for (const polygon of feature.geometry.coordinates) {
      for (const ring of polygon) {
        rings.push(thin(ring).map(([x, y]) => [round(x, MW_PLACES), round(y, MW_PLACES)]));
      }
    }
    return rings;
  }),
};

fs.mkdirSync(OUT, { recursive: true });
let totalRaw = 0, totalGz = 0;
for (const [name, value] of Object.entries(payload)) {
  const blob = Buffer.from(JSON.stringify(value));
  fs.writeFileSync(path.join(OUT, `${name}.json`), blob);
  const gz = zlib.gzipSync(blob, { level: 9 }).length;
  totalRaw += blob.length;
  totalGz += gz;
  console.log(`  ${(name + ".json").padEnd(22)}${String(Math.round(blob.length / 1024)).padStart(6)} KB` +
              `${String(Math.round(gz / 1024)).padStart(8)} KB gzipped`);
}
console.log(`  ${"TOTAL".padEnd(22)}${String(Math.round(totalRaw / 1024)).padStart(6)} KB` +
            `${String(Math.round(totalGz / 1024)).padStart(8)} KB gzipped`);
