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
    // Serve pre-built standalone apps during development.
    {
      name: "serve-sub-apps",
      configureServer(server) {
        const subApps = {
          "/mesh":
            process.env.MESH_DIST_DIR ?? new URL("../drone-mesh/dist/", import.meta.url).pathname,
          "/plan":
            process.env.PLAN_DIST_DIR ??
            new URL("../flight-planner/dist/", import.meta.url).pathname,
        };
        const mime: Record<string, string> = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".webmanifest": "application/manifest+json",
          ".map": "application/json",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".wasm": "application/wasm",
          ".ico": "image/x-icon",
        };
        for (const [route, dir] of Object.entries(subApps)) {
          const root = path.resolve(dir);
          server.middlewares.use(route, (req, res, next) => {
            let rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
            if (rel === "" || rel === "/") rel = "/index.html";
            const file = path.resolve(root, `.${rel}`);
            if (
              !file.startsWith(`${root}${path.sep}`) ||
              !fs.existsSync(file) ||
              !fs.statSync(file).isFile()
            ) {
              next();
              return;
            }
            res.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
            fs.createReadStream(file).pipe(res);
          });
        }
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
      // Chunks importing each other evaluate against uninitialised bindings and
      // blank the page (2026.9.3). Rollup warns; make it fatal.
      // TODO replace with circularChunkGuard() from @hotosm/ui/vite on 2.2.0.
      onwarn(warning, defaultHandler) {
        if (warning.code === "CIRCULAR_CHUNK") throw new Error(warning.message);
        defaultHandler(warning);
      },
      output: {
        manualChunks(id: string) {
          // keep WebAwesome cached independently of app deploys
          if (id.includes("@awesome.me/webawesome")) return "webawesome";
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
