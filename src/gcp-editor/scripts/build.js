#!/usr/bin/env node

import esbuild from "esbuild";
import { tailwindPlugin } from "esbuild-plugin-tailwindcss";
import { readFileSync } from "fs";
import { createRequire } from "module";

// Plugin to inline maplibre-gl CSS as a text module (needed for shadow DOM)
const inlineMaplibreCssPlugin = {
  name: "inline-maplibre-css",
  setup(build) {
    build.onResolve({ filter: /^maplibre-gl-css$/ }, () => ({
      path: "maplibre-gl-css",
      namespace: "maplibre-css",
    }));
    build.onLoad({ filter: /.*/, namespace: "maplibre-css" }, () => {
      const require = createRequire(import.meta.url);
      const cssPath = require.resolve("maplibre-gl/dist/maplibre-gl.css");
      const cssContent = readFileSync(cssPath, "utf8");
      return {
        contents: `export default ${JSON.stringify(cssContent)};`,
        loader: "js",
      };
    });
  },
};

esbuild
  .build({
    entryPoints: ["src/gcp-editor.ts"],
    outdir: "dist",
    bundle: true,
    minify: true,
    splitting: true,
    treeShaking: true,
    format: "esm",
    loader: {
      ".png": "dataurl",
      ".svg": "dataurl",
      ".gif": "dataurl",
      ".csv": "dataurl",
    },
    external: [
      "maplibre-gl",
      "@geomatico/maplibre-cog-protocol",
      "lit*",
      "@lit/*",
      "@hotosm/ui",
      "@hotosm/ui/*",
      "@awesome.me/*",
    ],
    plugins: [inlineMaplibreCssPlugin, tailwindPlugin()],
  })
  .catch(() => process.exit(1));
