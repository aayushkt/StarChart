/* Tests for the parts that can break silently.
 *
 *     node --test tests/
 *
 * Two kinds. Property tests check the geometry against facts that are true
 * independently of this code -- known star positions, the defining property of
 * the horizon, the spacing that makes the projection equidistant. Then a golden
 * snapshot guards the whole rendered document against drift.
 *
 * The snapshot was taken while a second, independent Python implementation
 * still existed, and was verified against it element by element: 7,586 elements
 * and 108,556 numbers agreeing to 0.002 mm. That comparison is what the fixture
 * carries forward now that only one implementation remains.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { states } from "../web/starchart/bodies.js";
import { horizonCurve, zenith } from "../web/starchart/horizon.js";
import { defaultConfig, defaultTheme, makeObserver } from "../web/starchart/index.js";
import { textWidth } from "../web/starchart/lettering.js";
import { Hemisphere, NORTH, SOUTH } from "../web/starchart/projection.js";
import { buildChart } from "../web/starchart/render.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const RADIUS = 166;
const read = (n) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, "web/starchart/data", `${n}.json`), "utf8"));

const data = {
  stars: read("stars"), starNames: read("starNames"),
  constellations: read("constellations"), milkyWay: read("milkyWay"),
};
const north = new Hemisphere({ pole: NORTH, cx: 0, cy: 0, radius: RADIUS, overlapDeg: 15 });

const starByName = (name) => {
  const index = Object.entries(data.starNames).find(([, n]) => n === name)?.[0];
  assert.ok(index !== undefined, `no star named ${name}`);
  return data.stars[Number(index)];
};

describe("projection", () => {
  it("puts the pole at the centre", () => {
    const [x, y] = north.project(123, 90);
    assert.ok(Math.hypot(x, y) < 1e-9);
  });

  it("spaces declination rings evenly", () => {
    // The defining property of equidistant, and the reason the grid reads as
    // ruled. Stereographic would fail this.
    const radii = [];
    for (let d = 80; d > -20; d -= 10) radii.push(north.radiusForDec(d));
    const steps = radii.slice(1).map((r, i) => r - radii[i]);
    for (const s of steps) assert.ok(Math.abs(s - steps[0]) < 1e-9);
  });

  it("reaches past the celestial equator", () => {
    // Both plates carry a little of the far hemisphere, as the original does.
    assert.ok(north.radiusForDec(0) < RADIUS);
    assert.ok(Math.abs(north.radiusForDec(-15) - RADIUS) < 1e-9);
    assert.ok(!north.visible(-15.001));
  });

  it("round-trips", () => {
    const [ra, dec] = [123.4, 41.2];
    const [x, y] = north.project(ra, dec);
    const z = (Math.hypot(x, y) / RADIUS) * north.zMax;
    assert.ok(Math.abs(90 - z - dec) < 1e-9);
    assert.ok(Math.abs(((-Math.atan2(x, -y) * 180) / Math.PI + 360) % 360 - ra) < 1e-9);
  });

  it("places Polaris within 2 mm of the centre", () => {
    const [ra, dec] = starByName("Polaris");
    const [x, y] = north.project(ra, dec);
    assert.ok(Math.hypot(x, y) < 2);
  });

  for (const [name, pole, visible] of [
    ["Betelgeuse", NORTH, true],   // dec +7, inside the northern rim
    ["Sirius", NORTH, false],      // dec -17, past it
    ["Sirius", SOUTH, true],
    ["Vega", NORTH, true],
    ["Acrux", NORTH, false],
    ["Canopus", SOUTH, true],
  ]) {
    it(`puts ${name} on the ${visible ? "" : "other "}${pole}ern plate`, () => {
      const hemi = new Hemisphere({ pole, cx: 0, cy: 0, radius: RADIUS, overlapDeg: 15 });
      assert.equal(hemi.visible(starByName(name)[1]), visible);
    });
  }
});

const altitude = (ra, dec, lat, lst) => {
  const phi = (lat * Math.PI) / 180, d = (dec * Math.PI) / 180;
  const h = ((lst - ra) * Math.PI) / 180;
  return (Math.asin(Math.sin(d) * Math.sin(phi) +
    Math.cos(d) * Math.cos(phi) * Math.cos(h)) * 180) / Math.PI;
};

describe("horizon", () => {
  for (const lat of [-70, -38.25, 0, 20, 38.25, 51.5, 66.5, 90]) {
    for (const lst of [0, 97.3, 200, 349.51]) {
      it(`is at altitude zero at ${lat}° / LST ${lst}°`, () => {
        // The property worth testing directly. Checking only the declination
        // range or the polar case is not enough: a mis-scaled hour angle leaves
        // both correct while putting the curve degrees off at mid latitudes.
        for (const [ra, dec] of horizonCurve(lat, lst, 720)) {
          assert.ok(Math.abs(altitude(ra, dec, lat, lst)) < 1e-9);
        }
      });
    }
  }

  it("sits 90 degrees from the zenith", () => {
    const [lat, lst] = [38.25, 349.5103];
    const unit = (a, d) => {
      const [A, D] = [(a * Math.PI) / 180, (d * Math.PI) / 180];
      return [Math.cos(D) * Math.cos(A), Math.cos(D) * Math.sin(A), Math.sin(D)];
    };
    const z = unit(...zenith(lat, lst));
    for (const [ra, dec] of horizonCurve(lat, lst, 720)) {
      const p = unit(ra, dec);
      const dot = z[0] * p[0] + z[1] * p[1] + z[2] * p[2];
      assert.ok(Math.abs((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI - 90) < 1e-9);
    }
  });

  it("becomes the celestial equator at the pole", () => {
    // The one latitude where the horizon really is a circle -- and it coincides
    // with the rim's own reference circle.
    for (const [, dec] of horizonCurve(90, 0)) assert.ok(Math.abs(dec) < 1e-9);
  });

  it("reaches both plates from a mid latitude", () => {
    const decs = horizonCurve(40.7, 0).map(([, d]) => d);
    assert.ok(Math.abs(Math.max(...decs) - 49.3) < 0.1);
    assert.ok(Math.abs(Math.min(...decs) + 49.3) < 0.1);
  });
});

describe("bodies", () => {
  // The reference values below were produced by Skyfield against the JPL DE421
  // kernel, so the instant is pinned here rather than taken from the shipped
  // config -- this is a test of the ephemeris, not of the defaults.
  const REFERENCE = {
    ...defaultConfig,
    time: {
      enabled: true, datetime: "2002-01-08T16:48:00", tz: "America/New_York",
      latitude: 38.25, longitude: -85.76, place: "", show_place: false,
    },
  };

  it("agrees with Skyfield for a known instant", () => {
    const s = states(makeObserver(REFERENCE));
    const expected = {
      sun: { ra: 289.95, dec: -22.17, altitude: 7.77 },
      moon: { ra: 230.92, dec: -16.21, altitude: -32.24 },
    };
    for (const [key, want] of Object.entries(expected)) {
      assert.ok(Math.abs(s[key].ra - want.ra) < 0.01, `${key} ra`);
      assert.ok(Math.abs(s[key].dec - want.dec) < 0.01, `${key} dec`);
      assert.ok(Math.abs(s[key].altitude - want.altitude) < 0.05, `${key} altitude`);
    }
    assert.ok(Math.abs(s.moon.illuminated - 0.219) < 0.005);
  });

  it("puts the Sun above the horizon and the Moon below, that evening", () => {
    const s = states(makeObserver(REFERENCE));
    assert.ok(s.sun.altitude > 0);
    assert.ok(s.moon.altitude < 0);
  });
});

describe("lettering", () => {
  it("measures set widths consistently", () => {
    assert.ok(Math.abs(textWidth("TROPIC OF CANCER", 2.4, 0.45) - 30.462) < 1e-3);
    assert.ok(Math.abs(textWidth("Betelgeuse", 2.3) - 11.155) < 1e-3);
    assert.equal(textWidth("", 3), 0);
  });
});

describe("document", () => {
  const { markup } = buildChart({
    config: defaultConfig, theme: defaultTheme, data,
    observer: makeObserver(defaultConfig),
  });

  it("carries its real print size", () => {
    assert.match(markup, /width="609.6mm" height="1066.8mm"/);
  });

  it("has every layer the panel knows about", async () => {
    const { LAYERS } = await import("../web/starchart/style.js");
    for (const [id] of LAYERS) assert.ok(markup.includes(`id="${id}"`), id);
  });

  it("emits no CDATA", () => {
    // CDATA cannot exist in an HTML document, so importNode throws and the
    // editor fails to load the chart.
    assert.ok(!markup.includes("<![CDATA["));
  });

  it("draws every diagram once, when they are switched on", () => {
    // Off by default: with the plates filling the sheet there is no room under
    // them. Ask for them explicitly.
    const { markup: withPanels } = buildChart({
      config: { ...defaultConfig, panels: { ...defaultConfig.panels, enabled: true } },
      theme: defaultTheme, data, observer: makeObserver(defaultConfig),
    });
    const ids = [...withPanels.matchAll(/id="(panel-[a-z-]+)"/g)]
      .map((m) => m[1]).filter((id) => !id.startsWith("panel-clip"));
    assert.equal(ids.length, new Set(ids).size, "a diagram was emitted twice");
    assert.equal(ids.length, 7);
  });

  it("fills the column between the title and the caption", () => {
    // Equal clearance above and below, and whatever gap is asked for between --
    // zero by default, so the two rims touch. The degree-scale band counts as
    // part of a plate's extent.
    const band = defaultTheme.plate.scale_band;
    const { hemispheres } = buildChart({
      config: defaultConfig, theme: defaultTheme, data,
      observer: makeObserver(defaultConfig),
    });
    const [n, s] = hemispheres;
    const titleY = defaultConfig.page.margin + 34;
    const capY = defaultConfig.page.height - defaultConfig.page.margin - 3;
    const above = (n.cy - n.radius - band) - titleY;
    const between = (s.cy - s.radius - band) - (n.cy + n.radius + band);
    const below = capY - (s.cy + s.radius + band);
    assert.ok(Math.abs(above - defaultConfig.layout.fit_clearance) < 1e-6, `above ${above}`);
    assert.ok(Math.abs(below - defaultConfig.layout.fit_clearance) < 1e-6, `below ${below}`);
    assert.ok(Math.abs(between - defaultConfig.layout.gap) < 1e-6, `between ${between}`);
    assert.ok(Math.abs(between) < 1e-6, "the plates should be touching by default");
    assert.equal(n.cx, defaultConfig.page.width / 2);
    assert.equal(s.cx, defaultConfig.page.width / 2);
  });

  it("uses true relative sizes and distances in the diagrams", async () => {
    const { PLANETS, SUN_KM } = await import("../web/starchart/panels.js");
    // Guard the figures themselves: a diagram that silently drifts from real
    // numbers is worse than one that is obviously schematic.
    assert.equal(SUN_KM, 696000);
    assert.equal(PLANETS.find((p) => p.name === "EARTH").km, 6371);
    assert.equal(PLANETS.find((p) => p.name === "JUPITER").km, 69911);
    assert.ok(Math.abs(PLANETS.find((p) => p.name === "NEPTUNE").au - 30.069) < 1e-6);
    // Ordered outward, which several panels rely on.
    for (let i = 1; i < PLANETS.length; i++) assert.ok(PLANETS[i].au > PLANETS[i - 1].au);
  });

  it("matches the golden snapshot", () => {
    const golden = fs.readFileSync(path.join(ROOT, "tests/golden/chart.svg"), "utf8");
    if (markup !== golden) {
      let i = 0;
      while (i < Math.min(markup.length, golden.length) && markup[i] === golden[i]) i++;
      assert.fail(
        `output drifted at character ${i}\n` +
        `  golden: ...${golden.slice(Math.max(0, i - 60), i + 40)}\n` +
        `  built:  ...${markup.slice(Math.max(0, i - 60), i + 40)}\n` +
        `If the change is intended, rebaseline with: node scripts/rebaseline.mjs`
      );
    }
  });
});
