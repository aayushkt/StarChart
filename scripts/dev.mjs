/* Serve the editor.
 *
 *     node scripts/dev.mjs [--port 8000]
 *
 * Nothing here is dynamic -- the editor is a static page. A server is needed
 * only because browsers refuse to fetch from a file:// page.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const WEB = path.join(ROOT, "web");

const DEFAULT_PORT = 8000;
const PORT_SEARCH = 20;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg",
};

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const explicit = portArg !== -1;
const wanted = explicit ? Number(args[portArg + 1]) : DEFAULT_PORT;

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (rel.endsWith("/")) rel += "index.html";

  const file = path.join(WEB, rel);
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

/* Port 8000 is a popular default and often already taken. An unspecified port
 * walks forward to the next free one; a requested port stays an error. */
function listen(port, attemptsLeft) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && !explicit && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
    } else if (err.code === "EADDRINUSE") {
      console.error(`port ${port} is already in use; pass a different --port`);
      process.exit(1);
    } else {
      throw err;
    }
  });
  server.listen(port, "127.0.0.1", () => {
    if (port !== wanted) console.log(`port ${wanted} was busy, using ${port}`);
    console.log(`editor at http://127.0.0.1:${port}/   (ctrl-c to stop)`);
  });
}

listen(wanted, explicit ? 0 : PORT_SEARCH);
