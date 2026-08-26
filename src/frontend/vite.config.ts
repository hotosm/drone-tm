import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { domToCodePlugin } from "dom-to-code/vite";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  base: "/",
  plugins: [
    react(),
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      strategy: ["localStorage", "preferredLanguage", "baseLocale"],
      emitTsDeclarations: true,
    }),
    process.env.NODE_ENV !== "production"
      ? domToCodePlugin({
          mode: "react",
        })
      : undefined,
    // Dev server: serve the pre-built drone-mesh viewer at /mesh. Baked into
    // the dev image at /app/mesh-dist (MESH_DIST_DIR); on host it falls back to
    // ../drone-mesh/dist. Prod serves it from dist/mesh instead (see
    // frontend/Dockerfile mesh-build stage).
    {
      name: "serve-drone-mesh",
      configureServer(server) {
        const meshDir =
          process.env.MESH_DIST_DIR ?? new URL("../drone-mesh/dist/", import.meta.url).pathname;
        const mime: Record<string, string> = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".map": "application/json",
          ".svg": "image/svg+xml",
          ".wasm": "application/wasm",
          ".ico": "image/x-icon",
        };
        server.middlewares.use("/mesh", (req, res, next) => {
          let rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
          if (rel === "" || rel === "/") rel = "/index.html";
          const file = path.join(meshDir, rel);
          if (!file.startsWith(meshDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            next();
            return;
          }
          res.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
          fs.createReadStream(file).pipe(res);
        });
      },
    },
    // Self-host the DRACO and KTX2 decoders shipped with three.js so the 3D
    // model viewer doesn't depend on an external CDN at runtime.
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/three/examples/jsm/libs/draco/*",
          dest: "three-libs/draco",
        },
        {
          src: "node_modules/three/examples/jsm/libs/basis/*",
          dest: "three-libs/basis",
        },
      ],
    }),
  ],
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
    },
  },
  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx"],
    alias: {
      "@": new URL("./src/", import.meta.url).pathname,
      "@Assets": new URL("./src/assets/", import.meta.url).pathname,
      "@Utils": new URL("./src/utils/", import.meta.url).pathname,
      "@Store": new URL("./src/store/", import.meta.url).pathname,
      "@Schemas": new URL("./src/schemas/", import.meta.url).pathname,
      "@Hooks": new URL("./src/hooks/", import.meta.url).pathname,
      "@Api": new URL("./src/api/", import.meta.url).pathname,
      "@Services": new URL("./src/services/", import.meta.url).pathname,
      "@Constants": new URL("./src/constants/", import.meta.url).pathname,
      "@Queries": new URL("./src/api/queries/", import.meta.url).pathname,
      "@Routes": new URL("./src/routes/", import.meta.url).pathname,
      "@Views": new URL("./src/views/", import.meta.url).pathname,
      "@Components": new URL("./src/components/", import.meta.url).pathname,
      "@UserModule": new URL("./src/modules/user-auth-module/src/", import.meta.url).pathname,
    },
  },
  build: {
    target: "esnext",
    sourcemap: process.env.NODE_ENV === "development",
    rollupOptions: {
      output: {
        // Split large vendor dependencies into separate cacheable chunks
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@awesome.me/webawesome")) return "vendor-webawesome";
          if (id.includes("maplibre-gl")) return "vendor-map";
          if (
            id.includes("@reduxjs/toolkit") ||
            id.includes("react-redux") ||
            id.includes("redux-persist")
          ) {
            return "vendor-redux";
          }
          if (
            id.includes("react-router-dom") ||
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "vendor-react";
          }
          return undefined;
        },
      },
    },
  },
  define: {
    "process.env": {
      VITE_API_URL: process.env.VITE_API_URL,
    },
  },
  server: {
    open: false,
    port: 3040,
    host: "0.0.0.0",
    strictPort: true,
    allowedHosts: ["dronetm.hotosm.test", "localhost", "127.0.0.1", ".test"],
    hmr: {
      clientPort: 443,
      host: "dronetm.hotosm.test",
    },
  },
});
