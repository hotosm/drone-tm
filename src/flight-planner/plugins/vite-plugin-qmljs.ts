import { readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Rewrite a QML JavaScript resource into an ES module. */
export function transformQmlJs(src: string): string {
  return (
    src
      // Preserve the newline so source line numbers remain aligned.
      .replace(/^\.pragma[ \t]+library[ \t]*$/gm, "")
      .replace(
        /^\.import[ \t]+"([^"]+)"[ \t]+as[ \t]+(\w+)[ \t]*$/gm,
        (_m, file: string, ns: string) => `import * as ${ns} from "./${file}";`,
      )
      // Only top-level declarations belong to the QML module's public surface.
      .replace(/^function\s+(\w+)\s*\(/gm, "export function $1(")
      .replace(/^var\s+(\w+)\s*=/gm, "export var $1 =")
  );
}

const QML_JS_DIRS = ["generate", "output"];

export function qmlJs(pluginRoot: string): Plugin {
  const root = path.resolve(pluginRoot);

  const isQmlJs = (id: string) => {
    const resolved = path.resolve(id.split("?")[0]);
    if (!resolved.startsWith(root + path.sep)) return false;
    if (!resolved.endsWith(".js")) return false;
    const rel = path.relative(root, resolved);
    return QML_JS_DIRS.includes(rel.split(path.sep)[0]);
  };

  const loadQmlJs = (id: string) => transformQmlJs(readFileSync(id.split("?")[0], "utf-8"));

  return {
    name: "vite-plugin-qmljs",
    enforce: "pre",

    // Vite's dependency scanner bypasses load(), so apply the transform there too.
    config(userConfig) {
      // Setting fs.allow replaces Vite's default, so include both roots.
      const appRoot = path.resolve(userConfig.root ?? process.cwd());
      return {
        server: { fs: { allow: [appRoot, root] } },
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              {
                name: "qmljs-scan",
                setup(build) {
                  build.onLoad({ filter: /\.js$/ }, ({ path: id }) => {
                    if (!isQmlJs(id)) return null;
                    return { contents: loadQmlJs(id), loader: "js" };
                  });
                },
              },
            ],
          },
        },
      };
    },

    load(id) {
      if (!isQmlJs(id)) return null;
      return { code: loadQmlJs(id), map: null };
    },
  };
}

export default qmlJs;
