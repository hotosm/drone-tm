import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { qmlJs } from "./plugins/vite-plugin-qmljs";

const qfieldPlugin = fileURLToPath(new URL("../qfield-plugin/", import.meta.url));

export default defineConfig({
  plugins: [qmlJs(qfieldPlugin)],
  resolve: { alias: { "@qfield": qfieldPlugin.replace(/\/$/, "") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
