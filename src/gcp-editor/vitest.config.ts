import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Plugin to resolve the virtual 'maplibre-gl-css' module used in map-section.ts
const maplibreCssPlugin = {
  name: 'maplibre-gl-css',
  resolveId(id: string) {
    if (id === 'maplibre-gl-css') return '\0maplibre-gl-css';
    return null;
  },
  load(id: string) {
    if (id === '\0maplibre-gl-css') {
      try {
        const cssPath = resolve(__dirname, 'node_modules/maplibre-gl/dist/maplibre-gl.css');
        const css = readFileSync(cssPath, 'utf8');
        return `export default ${JSON.stringify(css)};`;
      } catch {
        return 'export default "";';
      }
    }
    return null;
  },
};

export default defineConfig({
  plugins: [maplibreCssPlugin],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
