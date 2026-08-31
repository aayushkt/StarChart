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

import { moonMonth, states } from "../web/starchart/bodies.js";
import { horizonCurve, zenith } from "../web/starchart/horizon.js";
import { defaultConfig, defaultTheme, makeObserver } from "../web/starchart/index.js";
import { textWidth } from "../web/starchart/lettering.js";
import { PANELS } from "../web/starchart/panels.js";
import { Hemisphere, NORTH, SOUTH } from "../web/starchart/projection.js";
import { buildChart } from "../web/starchart/render.js";
import { stylesheet } from "../web/starchart/style.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const RADIUS = 166;
const read = (n) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, "web/starchart/data", `${n}.json`), "utf8"));

const data = {
  stars: read("stars"), starNames: read("starNames"),
  milkyWay: read("milkyWay"),
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
    assert.match(markup, /width="609.6mm" height="914.4mm"/);
  });

  it("has every layer the panel knows about", async () => {
    const { LAYERS } = await import("../web/starchart/style.js");
    for (const [id] of LAYERS) assert.ok(markup.includes(`id="${id}"`), id);
  });

  it("keeps the star names the smallest type on the plate", () => {
    // Everything drawn inside a plate sits at or above the star name size.
    const t = defaultTheme.type;
    const floor = t.star_size;
    const onPlate = {
      "star names": t.star_size,
      "degree numbers": t.scale_size,
      "reference labels": defaultTheme.reference.label_size,
      "body path labels": defaultTheme.bodies.label_size,
    };
    for (const [what, size] of Object.entries(onPlate)) {
      assert.ok(size >= floor, `${what} is ${size} mm, below the ${floor} mm floor`);
    }
  });

  it("draws only the magnitude classes asked for", () => {
    // The old setting was a magnitude, was read by nothing at all, and could
    // not express this anyway: class boundaries are inclusive, so a star of
    // magnitude exactly 4.5 is class 5 and "brighter than 4.5" leaks it in.
    assert.equal(defaultConfig.stars.faintest_class, 4);
    assert.ok(data.stars.some(([, , m]) => m >= 4.5), "test data has no faint stars");
    assert.ok(!/class="mag-5"/.test(markup), "class 5 drawn despite the limit");
    assert.ok(!/class="halo-5"/.test(markup), "class 5 halo drawn despite the limit");
    assert.ok(/class="mag-4"/.test(markup), "class 4 should still be drawn");
  });

  it("draws by hand deterministically", async () => {
    // Every wobble is seeded from the shape's own coordinates, so the same
    // chart twice is identical. Unseeded, a slider nudge would reshuffle every
    // line on the sheet, which is why the golden snapshot can exist at all.
    const again = buildChart({
      config: defaultConfig, theme: defaultTheme, data,
      observer: makeObserver(defaultConfig),
    });
    assert.equal(again.markup, markup);

    // Ids included: the clip paths are numbered from a counter, and a counter
    // that is not reset per build makes two identical charts differ.
    const ids = (m) => [...m.matchAll(/id="(panel-clip-\d+)"/g)].map((x) => x[1]);
    assert.deepEqual(ids(again.markup), ids(markup));
    assert.ok(ids(markup).length > 0, "no clip paths to compare");

    const sketch = await import("../web/starchart/sketch.js");
    assert.equal(sketch.circle(10, 20, 30), sketch.circle(10, 20, 30));
    assert.notEqual(sketch.circle(10, 20, 30), sketch.circle(10, 20, 31));
  });

  it("falls back to ruled output when the hand is zero", async () => {
    const { cavalliniTheme } = await import("../web/starchart/index.js");
    assert.equal(cavalliniTheme.panels.hand, 0);
    assert.equal(cavalliniTheme.grid.hand, 0);
    const ruled = buildChart({
      config: { ...defaultConfig, panels: { ...defaultConfig.panels, enabled: true } },
      theme: cavalliniTheme, data, observer: makeObserver(defaultConfig),
    }).markup;
    assert.ok(!ruled.includes('class="panel-sun hand"'), "hand paths in a ruled sheet");
    assert.ok(/<circle[^>]*class="panel-sun"/.test(ruled), "no plain filled sun");
  });

  it("papers the sheet with a scan rather than a simulation", () => {
    // Simulating age was a decent imitation and read as one. Two scans,
    // mirror-tiled at sizes that share no factor, so nothing lines up.
    assert.ok(markup.includes('id="paper-over"'), "no paper tiling");
    assert.ok(markup.includes('id="paper-under"'), "no second scan");
    assert.ok(markup.includes("data:image/jpeg;base64,"), "the scans are not embedded");
    // Mirrored quadrants are what makes any tile seamless without editing it.
    const tile = markup.slice(markup.indexOf('id="paper-over"'));
    assert.ok(tile.includes("scale(-1,1)") && tile.includes("scale(1,-1)") &&
              tile.includes("scale(-1,-1)"), "the tile is not mirrored");
    const { age } = defaultTheme.page;
    assert.ok(Math.abs(age.tile / age.under_tile - Math.round(age.tile / age.under_tile)) > 0.1,
      "the two tile sizes share a factor, so their seams will line up");
  });

  it("emits no CDATA", () => {
    // CDATA cannot exist in an HTML document, so importNode throws and the
    // editor fails to load the chart.
    assert.ok(!markup.includes("<![CDATA["));
  });

  it("draws every diagram once", () => {
    const { markup: withPanels } = buildChart({
      config: defaultConfig, theme: defaultTheme, data,
      observer: makeObserver(defaultConfig),
    });
    const ids = [...withPanels.matchAll(/id="(panel-[a-z-]+)"/g)]
      .map((m) => m[1]).filter((id) => !id.startsWith("panel-clip"));
    assert.equal(ids.length, new Set(ids).size, "a diagram was emitted twice");
    // Counted from the registry, not written down here: a hand-copied number
    // just fails every time a diagram is added, which says nothing.
    assert.equal(ids.length, Object.keys(PANELS).length);
    assert.equal(new Set(ids).size, new Set(defaultConfig.panels.order).size);
  });

  it("draws the horizon under the names, not through them", () => {
    // It is a broken red line crossing the whole plate. Painted last it cut
    // through every label it met, which at poster size is most of them.
    const { markup } = buildChart({
      config: defaultConfig, theme: defaultTheme, data,
      observer: makeObserver(defaultConfig),
    });
    const at = (id) => markup.indexOf(`id="${id}"`);
    assert.ok(at("layer-horizon") > 0, "no horizon layer");
    assert.ok(at("layer-star-labels") > 0, "no star label layer");
    assert.ok(at("layer-horizon") < at("layer-star-labels"),
      "the horizon paints over the star names");
    // Still over the stars themselves, which it has to cross to mean anything.
    assert.ok(at("layer-stars") < at("layer-horizon"),
      "the horizon went under the stars too");
  });

  it("keeps the diagrams' styling inside the diagrams", () => {
    /* The diagrams reuse .star and .star-halo for their own samples. Those
     * rules were emitted unscoped and after the chart's own, so with equal
     * weight they won on order and every star on both plates took the
     * diagrams' sample colour. The Stars swatch appeared to do nothing at
     * all. */
    const css = stylesheet(defaultTheme);
    const rule = (selector) => {
      const hit = css.split("\n").filter((l) => l.startsWith(`${selector}{`));
      return hit.length === 1 ? hit[0] : `${hit.length} rules`;
    };
    assert.ok(rule(".star").includes(defaultTheme.stars.fill),
      "the plate's stars are painted by the diagrams");
    assert.ok(rule(".star-halo").includes(defaultTheme.stars.halo_fill),
      "the halos are painted by the diagrams");
    // Every selector in a group has to carry the scope, not just the first --
    // prefixing the string would leave everything after the comma loose.
    for (const line of css.split("\n")) {
      if (!line.includes(".panel ") && !line.startsWith("#panel-")) continue;
      const selectors = line.slice(0, line.indexOf("{")).split(",");
      assert.ok(selectors.every((sel) => /^(\.panel |#panel-)/.test(sel.trim())),
        `a diagram rule escaped its scope: ${line}`);
    }
  });

  it("lets the hand rule beat the colours that share its scope", () => {
    /* A hatched shape is an outline plus strokes, and `fill:none` is the only
     * thing stopping it being a flat fill with lines drawn over it. That rule
     * carries one class and wins on order -- so the moment the colour rules
     * were scoped to `.panel` and went up to two classes, they outranked it and
     * every diagram came back solid. Caught by eye, which is not a method. */
    const css = stylesheet(defaultTheme).split("\n");
    const spec = (sel) => [(sel.match(/#/g) ?? []).length,
                           (sel.match(/\./g) ?? []).length];
    const beats = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] >= b[1];

    for (const [i, line] of css.entries()) {
      const at = line.indexOf("{");
      const decls = line.slice(at + 1, -1);
      if (!/(^|;)fill:(?!none)/.test(decls)) continue;
      const selectors = line.slice(0, at).split(",");
      for (const sel of selectors) {
        const prefix = sel.trim().startsWith("#panel-")
          ? sel.trim().split(" ")[0] : sel.trim().startsWith(".panel ") ? ".panel" : null;
        if (!prefix) continue;
        const guard = css.findIndex((l, j) =>
          j > i && l.startsWith(`${prefix} .hand{`) && l.includes("fill:none"));
        assert.ok(guard !== -1,
          `nothing stops "${sel.trim()}" filling a hatched shape`);
        assert.ok(beats(spec(`${prefix} .hand`), spec(sel.trim())),
          `"${sel.trim()}" outranks its own hand rule`);
      }
    }
  });

  it("closes the Moon's monthly path", () => {
    /* The track is a position among the stars, so it repeats on the sidereal
     * month. It was drawn over a synodic month -- 29.53 days, the period of the
     * phases -- which is 2.2 days too long, so the end ran back over the
     * beginning and lay there as a second strand. */
    const apart = ([ra1, dec1], [ra2, dec2]) => {
      const dra = ((ra1 - ra2 + 540) % 360) - 180;
      return Math.hypot(dra * Math.cos((dec1 * Math.PI) / 180), dec1 - dec2);
    };
    for (const datetime of ["2000-01-01T00:00:00", "2002-01-08T21:48:00",
                            "2024-06-30T12:00:00"]) {
      const cfg = { ...defaultConfig, time: { ...defaultConfig.time, datetime } };
      const track = moonMonth(makeObserver(cfg));
      const gap = apart(track[0], track[track.length - 1]);
      /* Not zero, and it cannot be: the Moon's orbit precesses, so the track
       * genuinely does not close on itself for any period. The residual runs
       * about 0.1 degrees and reaches 0.23 across two years of start dates --
       * 0.37 mm on the plate, narrower than the 0.5 mm line drawing it. */
      assert.ok(gap < 0.35, `the track misses its own start by ${gap.toFixed(2)}° on ${datetime}`);
      // And a synodic month really would show: assert the bad case is bad, so
      // the tolerance above is known to be doing work.
      const synodic = moonMonth(makeObserver(cfg), 29.53);
      assert.ok(apart(synodic[0], synodic[synodic.length - 1]) > 5,
        "a synodic month closed too, so this test proves nothing");
    }
  });

  it("labels each colure once", () => {
    /* A colure is one great circle drawn as two arms out of the pole, and both
     * arms carried the name -- so each colure was named twice on each plate.
     * Which arm keeps it is decided by where the arm ends up, not by its right
     * ascension, so rotating the chart carries the labels with it. */
    const { markup } = buildChart({
      config: defaultConfig, theme: defaultTheme, data,
      observer: makeObserver(defaultConfig),
    });
    const from = markup.indexOf('id="layer-colures"');
    const body = markup.slice(from, markup.indexOf('id="layer-', from + 10));
    const named = (name) =>
      [...body.matchAll(new RegExp(`>${name}</text>`, "g"))].length;
    assert.equal(named("EQUINOCTIAL COLURE"), 2, "not one per plate");
    assert.equal(named("SOLSTITIAL COLURE"), 2, "not one per plate");
    // Top and right respectively, which is the whole point of choosing by
    // position: the equinoctial label sits above the pole, the solstitial to
    // the right of it.
    const pole = [...body.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)"/g)][0];
    const [px, py] = [Number(pole[1]), Number(pole[2])];
    const at = (name) => {
      const m = new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"[^>]*>${name}<`).exec(body);
      return [Number(m[1]), Number(m[2])];
    };
    assert.ok(at("EQUINOCTIAL COLURE")[1] < py, "the equinoctial label is not above the pole");
    assert.ok(at("SOLSTITIAL COLURE")[0] > px, "the solstitial label is not right of the pole");
  });

  it("puts no percentage font sizes in the document", () => {
    /* SVG 1.1 resolves a percentage font-size against the viewport and CSS
     * against the parent. librsvg does the second, browsers the first -- so
     * `font-size="88%"` on a tspan came out around 680 user units in a browser,
     * drawing the fragment enormous and shoving the rest of its line off the
     * sheet. It looked perfect in every render here and was broken on screen,
     * which is exactly why this is checked on the output rather than by eye. */
    const { markup } = buildChart({
      config: defaultConfig, theme: defaultTheme, data,
      observer: makeObserver(defaultConfig),
    });
    const found = markup.match(/font-size="[^"]*%"/g) ?? [];
    assert.deepEqual(found, [], `percentage font sizes reached the document`);
    // The notation is still stepped -- a subscript is smaller than its line --
    // so this is not passing by having flattened everything to one size.
    const sizes = new Set([...markup.matchAll(/<tspan font-size="([\d.]+)"/g)]
      .map((m) => m[1]));
    assert.ok(sizes.size > 3, "the notation lost its size steps");
  });

  it("gives the diagrams no headings", () => {
    // Labelling inside a diagram earns its place -- which body is which, what
    // the scale bar measures. A heading over the top of it does not; the
    // drawing already says what it is.
    const { markup } = buildChart({
      config: defaultConfig, theme: defaultTheme, data,
      observer: makeObserver(defaultConfig),
    });
    const panels = markup.slice(markup.indexOf('id="layer-panels"'));
    assert.ok(!panels.includes('class="panel-title"'), "a diagram still has a heading");
    // The seasons wheel names its four stations by date, in that form.
    for (const day of ["21-03", "21-06", "23-09", "21-12"]) {
      assert.ok(panels.includes(`>${day}<`), `no ${day} on the seasons wheel`);
    }
    assert.ok(!panels.includes("EQUINOX"), "the long season names came back");
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

  it("draws each diagram at its own size rather than a share of a band", async () => {
    const { PANEL_SIZES, layoutPanels } = await import("../web/starchart/panels.js");
    const names = defaultConfig.panels.order;
    for (const name of names) {
      assert.ok(PANEL_SIZES[name], `${name} has no size of its own`);
    }
    const boxes = layoutPanels(names, { x: 46, y: 106, w: 517, h: 800 }, 10);
    assert.equal(boxes.length, names.length);
    // Each keeps the shape it asked for -- the eclipses long and low, the moon
    // wheel square -- rather than whatever a divided band would have given it.
    for (const { name, box } of boxes) {
      assert.equal(box.w, PANEL_SIZES[name].w, `${name} width`);
      assert.equal(box.h, PANEL_SIZES[name].h, `${name} height`);
    }
    // And the flow wraps rather than running off the sheet.
    for (const { box } of boxes) assert.ok(box.x + box.w <= 46 + 517 + 1e-9);
    assert.ok(new Set(boxes.map((b) => b.box.y)).size > 1, "everything on one line");
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
