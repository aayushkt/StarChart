/* Rewrite the golden snapshot after an intended change.
 *
 *     node scripts/rebaseline.mjs
 *
 * Look at the rendered chart before running this. The snapshot is the only
 * thing standing between a deliberate change and a silent regression.
 */

import fs from "node:fs";
import path from "node:path";

import { defaultConfig, defaultTheme, makeObserver } from "../web/starchart/index.js";
import { buildChart } from "../web/starchart/render.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const read = (n) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, "web/starchart/data", `${n}.json`), "utf8"));

const { markup } = buildChart({
  config: defaultConfig, theme: defaultTheme,
  data: { stars: read("stars"), starNames: read("starNames"),
          milkyWay: read("milkyWay") },
  observer: makeObserver(defaultConfig),
});
fs.writeFileSync(path.join(ROOT, "tests/golden/chart.svg"), markup);
console.log(`golden snapshot rewritten (${(markup.length / 1024).toFixed(0)} KB)`);
