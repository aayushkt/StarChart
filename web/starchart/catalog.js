/* Loading the catalogues.
 *
 * The files are trimmed by scripts/build_web_data.py to exactly the fields the
 * renderer reads -- 132 KB gzipped for the whole sky, down from 410 KB of the
 * upstream d3-celestial data. See NOTICE for attribution.
 */

const FILES = ["stars", "starNames", "milkyWay"];

export async function loadCatalogues(base = ".") {
  const loaded = await Promise.all(
    FILES.map((name) =>
      fetch(`${base}/data/${name}.json`).then((r) => {
        if (!r.ok) throw new Error(`starchart: cannot load ${name}.json (${r.status})`);
        return r.json();
      })
    )
  );
  const [stars, starNames, milkyWay] = loaded;
  return { stars, starNames, milkyWay };
}
