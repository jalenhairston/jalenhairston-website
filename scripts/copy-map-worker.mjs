// MapLibre's web worker must be served as a plain static file; Next's bundler can't resolve it.
import fs from "node:fs";
fs.mkdirSync("public/vendor", { recursive: true });
fs.copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/vendor/maplibre-gl-worker.mjs");
