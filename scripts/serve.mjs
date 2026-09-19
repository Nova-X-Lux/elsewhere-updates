import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(
  import.meta.dirname,
  "..",
  process.argv.includes("--dist") ? "dist" : ".",
);
const port = Number(process.env.PORT || 4175);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};
http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      // A prefixed path exercises the same relative URLs as a Pages project site.
      const requested =
        pathname.replace(/^\/elsewhere(?=\/)/, "").replace(/^\/+/, "") ||
        "index.html";
      let target = resolve(root, requested);
      if (target !== root && !target.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      if (
        !process.argv.includes("--dist") &&
        (requested.startsWith("data/") ||
          ["favicon.svg", "manifest.webmanifest"].includes(requested))
      )
        target = resolve(root, "public", requested);
      if ((await stat(target)).isDirectory())
        target = resolve(target, "index.html");
      const contents = await readFile(target);
      res.writeHead(200, {
        "Content-Type": types[extname(target)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(contents);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Elsewhere is at http://127.0.0.1:${port}/elsewhere/`),
  );
