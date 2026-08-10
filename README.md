# StarChart

A vintage celestial chart, generated from real catalogue data as print-ready
SVG. It reproduces the Cavallini "Celestial Chart" puzzle — with the two
hemispheres **stacked vertically** rather than printed side by side — and can
mark a specific moment in time.

![preview](docs/preview.png)

## Running it

```sh
npm install          # jsdom, for the headless editor test
npm run dev          # serves the editor at http://127.0.0.1:8000
```

No build step and no backend. The renderer is plain ES modules; `npm install`
is only for the test harness.

## Using it on a website

The renderer is also a dependency-free ES module. Jekyll, plain HTML, anything
static — copy `web/starchart/` in and import it. No build step, no npm.

```html
<script type="module">
  import { renderChart } from '/starchart/index.js';
  document.querySelector('#chart').innerHTML =
    await renderChart({ base: '/starchart' });
</script>
```

`renderChart` takes config overrides for the date, place and layout; `loadChart`
returns the pieces separately if you want to drive it yourself, as the editor
does. A full chart renders in about 35 ms.

The browser build ships **132 KB gzipped** of catalogue data — the upstream
d3-celestial files trimmed to the fields actually read and rounded to the
precision a poster resolves, down from 410 KB. Rebuild it with
`npm run build-data` after changing the upstream catalogues.

Ephemeris comes from [astronomy-engine](https://github.com/cosinekitty/astronomy)
(MIT, 116 KB, no data files) rather than Skyfield's 16 MB JPL kernel. Asked for
the same J2000 frame as the star catalogue, the two agree to 0.004° — about
0.006 mm on the plate.

## The editor

A static page for picking colours, switching features on and off, tuning weights
and sizes, and sliding the time across the day, with a **Download SVG** button.

It is a thin shell over the module — the same code a website imports — so the
editor is also the proof that the library runs in a browser. There is no
backend; the only reason a server is involved at all is that browsers refuse to
`fetch` from `file://`.

Two update paths, deliberately. Colours and weights rewrite the chart's embedded
stylesheet in place, which is instant. Anything that moves geometry — the time
slider — re-renders, which measures about 35 ms.

## How it works

**The projection is azimuthal equidistant, centred on the celestial poles**
(`web/starchart/projection.js`). Distance from the centre is linear in angular
distance, `r = R·z/z_max`, so declination rings come out evenly spaced — that
even spacing is what gives the original its ruled, instrument-like grid.

This is deliberately *not* the stereographic projection that star-map generators
normally use. Those centre the map on the observer's zenith and clip at the
horizon, so the map **is** a view: change the hour and you get a different
picture. This chart maps the whole celestial sphere and takes no date, time, or
latitude at all. Both circles reach a little past the celestial equator, so they
overlap — as the original does, which carries Virgo and Sextans on both.

**Time therefore enters as an overlay, not as a projection setting.** The fixed
stars don't move on a human timescale: precession is about 1° per 72 years, and
the fastest proper motion in the sky is ~10 arcseconds a year — both far below
what a poster can show. What *is* specific to a date are the planets, Sun, and
Moon, and which part of the sphere was above the horizon at a given place. Those
are drawn on top of a plate that is otherwise unchanging.

**There are no constellation figure lines**, because the original has none. It
carries names in curved italic over a bare star field, and that restraint is a
large part of the look.

**Curved lettering places one glyph at a time** (`web/starchart/lettering.js`)
rather than using SVG `<textPath>`. librsvg — which backs a lot of SVG tooling —
silently drops `textPath`, which would mean labels vanishing with no error.

### Layout

```
starchart/
  projection.py   azimuthal equidistant, N and S hemispheres
  catalog.py      star / name / Milky Way / constellation loading
  lettering.py    text set along an arc, glyph by glyph
  horizon.py      the observer's horizon as a computed curve
  overlay.py      the date-and-place overlay
  reference.py    ecliptic, tropics, polar circles, colures
  labels.py       collision-avoiding label placement
  bodies.py       Sun and Moon: positions, day circles, phase
  style.py        the stylesheet embedded in the SVG
  svg.py          minimal dependency-free SVG writer
  render.py       assembly
  dev.py          render + serve the editor
web/starchart/    the browser library (ES modules, no build step)
  data/           trimmed catalogues, built by scripts/
  vendor/         astronomy-engine (MIT)
web/              the editor: index.html, app.js, style.css
themes/           visual themes
data/d3-celestial/  vendored catalogues (BSD-3, see NOTICE)
```

## Tests

```sh
npm test
```

Property tests check the geometry against facts that hold independently of this
code: known star positions, the even ring spacing that makes the projection
equidistant, the horizon sitting at altitude zero and ninety degrees from the
zenith, the Sun and Moon against Skyfield's values for the configured instant.
Then a golden snapshot guards the whole rendered document, and a headless run of
the editor drives the real shipped module in jsdom.

The snapshot was taken while a second, independent Python implementation still
existed, and was verified against it element by element — 7,586 elements and
108,556 numbers agreeing to 0.002 mm. That comparison is what the fixture
carries forward. Rebaseline an intended change with `npm run rebaseline`, after
looking at the chart.

## Status

Working: projection, star field by magnitude class, Milky Way, graticule, rim
degree scale, curved hemisphere labels, tropics and polar circles, the ecliptic
and colures, star and constellation names with collision avoidance, the
date/place overlay, and the editor.

The Sun and Moon are plotted for the configured instant, each with the circle it
traced that day. That day circle is the body's circle of constant declination:
over a single day the Earth's rotation carries it round the pole at a fixed
declination, so on this projection the path is exactly concentric with the
plate's centre. Where it crosses the horizon curve is where the body rose and
set. The Moon also carries its month-long path against the stars, which shows
the roughly five-degree tilt of its orbit against the ecliptic.

All seven diagrams from the original are drawn around the plates: comparative
sizes of the Sun and planets, the magnitude key, the solar system to scale, both
eclipses, Earth's revolution, and the illumination of the Moon. They are
generated from real figures rather than traced — the planets are to true
relative size and true relative orbital distance, and the Moon phases are
geometric. The eclipse diagrams are schematic in their proportions, because at
true scale the Sun would be four hundred times further away than the panel is
wide, but the construction is honest: the Moon is placed so its umbra converges
exactly on the Earth's surface, which is the fact the panel exists to show.

Next: planets plotted on the plates themselves.

## Data

Catalogues are from [d3-celestial](https://github.com/ofrohn/d3-celestial)
(BSD-3-Clause, Olaf Frohn). See [NOTICE](NOTICE) for full attribution.
