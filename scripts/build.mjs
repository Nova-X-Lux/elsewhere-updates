import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
await mkdir(resolve(root, "dist"), { recursive: true });
await cp(resolve(root, "public"), resolve(root, "dist"), { recursive: true });
await cp(resolve(root, "src"), resolve(root, "dist/src"), { recursive: true });
await cp(resolve(root, "index.html"), resolve(root, "dist/index.html"));
await writeFile(resolve(root, "dist/.nojekyll"), "");
const data = JSON.parse(
  await readFile(resolve(root, "dist/data/updates.json"), "utf8"),
);
if (
  !Array.isArray(data.items) ||
  !Array.isArray(data.sources) ||
  !data.generatedAt
)
  throw new Error("Collect updates before building.");
console.log(
  `Built Elsewhere: ${data.sources.length} sources, ${data.items.length} updates. All asset paths are relative for GitHub Pages.`,
);
