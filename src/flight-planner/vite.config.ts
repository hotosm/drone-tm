import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { qmlJs } from "./plugins/vite-plugin-qmljs";

const qfieldPlugin = fileURLToPath(new URL("../qfield-plugin/", import.meta.url));

export default defineConfig({
  base: "./",

  plugins: [
    qmlJs(qfieldPlugin),
    VitePWA({
      registerType: "prompt",
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Include the large map and UI chunks in the offline app shell.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            // DEM crops use OPFS; cache only basemap tiles here.
            urlPattern: ({ url }) => /\/tiles?\//.test(url.pathname) || /tile\./.test(url.hostname),
            handler: "CacheFirst",
            options: {
              cacheName: "basemap-tiles",
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "DroneTM Flight Planner",
        short_name: "DroneTM Plan",
        description: "Generate drone flightplans with terrain following, offline, in your browser.",
        theme_color: "#d43f3f",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],

  resolve: {
    alias: { "@qfield": qfieldPlugin.replace(/\/$/, "") },
  },

  build: {
    target: "esnext",
    rollupOptions: {
      // Circular chunks can evaluate against uninitialised bindings at startup.
      onwarn(warning, defaultHandler) {
        if (warning.code === "CIRCULAR_CHUNK") throw new Error(warning.message);
        defaultHandler(warning);
      },
      output: {
        manualChunks(id) {
          if (id.includes("@awesome.me/webawesome")) return "webawesome";
          if (id.includes("maplibre-gl")) return "maplibre";
          if (id.includes("geotiff")) return "geotiff";
          return undefined;
        },
      },
    },
  },

  server: { host: true, port: 3050, allowedHosts: [".test", ".ts.net"] },
});
