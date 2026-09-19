import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
// Only replace this project's generated output, never an arbitrary path.
if (!dist.startsWith(root + sep) || dist === root)
  throw new Error("Invalid output directory");
await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "assets"), { recursive: true });
await cp(resolve(root, "public"), dist, { recursive: true });
const hash = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);
const model = await readFile(resolve(root, "src/model.js"), "utf8");
const modelName = `model-${hash(model)}.js`;
const app = (await readFile(resolve(root, "src/app.js"), "utf8")).replace(
  "./model.js",
  `./${modelName}`,
);
const appName = `app-${hash(app)}.js`;
const styles = await readFile(resolve(root, "src/styles.css"), "utf8");
const stylesName = `styles-${hash(styles)}.css`;
await writeFile(resolve(dist, "assets", modelName), model);
await writeFile(resolve(dist, "assets", appName), app);
await writeFile(resolve(dist, "assets", stylesName), styles);
const html = (await readFile(resolve(root, "index.html"), "utf8"))
  .replace("./src/app.js", `./assets/${appName}`)
  .replace("./src/styles.css", `./assets/${stylesName}`);
await writeFile(resolve(dist, "index.html"), html);
await writeFile(resolve(dist, ".nojekyll"), "");
const data = JSON.parse(
  await readFile(resolve(dist, "data/updates.json"), "utf8"),
);
if (
  !Array.isArray(data.items) ||
  !Array.isArray(data.sources) ||
  !data.generatedAt
)
  throw new Error("Collect updates before building.");
console.log(
  `Built Elsewhere: ${data.sources.length} sources, ${data.items.length} updates. Versioned assets and relative paths are ready for GitHub Pages.`,
);
