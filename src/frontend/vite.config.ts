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
        manualChunks: {
          // Split large vendor dependencies into separate cacheable chunks
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-redux": ["@reduxjs/toolkit", "react-redux", "redux-persist"],
          "vendor-map": ["maplibre-gl"],
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
