# Runtime frontend configuration (no rebuild)

This repo supports injecting frontend configuration at **runtime**
(container start) instead of baking values into the Vite build.

## Why

- You can deploy the _same_ frontend image to different
  domains/environments by changing Kubernetes values/env vars.
- Domain migrations (e.g. `domain1` → `domain2`) become much easier.

## How it works

- The frontend loads `/config.js` before the React app starts.
- `/config.js` defines `window.__RUNTIME_CONFIG__`.
- The app reads config via `getRuntimeConfig()` (`src/frontend/src/runtimeConfig.ts`).
- In Kubernetes, the chart runs a `frontend-assets` **initContainer** that:
  - syncs built assets into a shared volume
  - writes `/frontend_html/config.js` from env vars

## Notes

- If you use `.env` files in local dev, use Vite’s standard `VITE_*` prefixes:
  - `VITE_API_URL`
