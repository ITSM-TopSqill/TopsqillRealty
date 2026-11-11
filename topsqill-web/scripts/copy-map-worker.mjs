// MapLibre draws the map in a Web Worker loaded from its own file, which the
// bundler doesn't copy. Browsers only run same-origin workers, so the file is
// served from /vendor. This runs before every build and dev start, so it
// always matches the installed maplibre-gl version.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json"));
const src = readFileSync(join(dist, "dist", "maplibre-gl-worker.mjs"), "utf8").replace(/\n\/\/# sourceMappingURL=.*$/m, "");
mkdirSync(new URL("../public/vendor/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/vendor/maplibre-gl-worker.js", import.meta.url), src);
console.log("map worker copied");
