# DroneTM Flight Planner

A standalone, offline-capable flight plan generator for
[plan.drone.hotosm.org](https://plan.drone.hotosm.org). Pilots can draw or
upload an area, configure a flight, fetch terrain data, and export `.kmz`,
`.wpml`, or `.geojson` mission files.

Terrain data is cached in the browser and can be shared by every task in a
DroneTM project. Once downloaded, plans can be generated and regenerated
offline.

## Development

```bash
cd src/flight-planner
pnpm install
pnpm dev        # http://localhost:3050
pnpm test
pnpm build      # static output in dist/
```

The planner is a separate pnpm workspace, outside `src/pnpm-workspace.yaml`.

## Configuration

`VITE_MAIN_SITE_URL` sets the target of the header's **Main site** link. It
defaults to `https://drone.hotosm.org` and can be set at build time:

```bash
VITE_MAIN_SITE_URL=https://example.org pnpm build
```

## URL Parameters

The planner accepts these optional query parameters:

| Parameter     | Purpose                                                         |
| ------------- | --------------------------------------------------------------- |
| `aoi`         | URL of a single-polygon GeoJSON flight area                     |
| `params`      | URL of a `params.json` file with flight settings                |
| `project`     | DroneTM project ID stored with the plan                         |
| `task`        | DroneTM task ID, also used to name the plan                     |
| `project_aoi` | URL of the project outline used to size shared terrain coverage |

Fetched data is saved locally for offline use. When `project_aoi` is
not provided, terrain coverage is based on a 25 km buffer around the flight
area.

## Architecture and deployment

The planner is a static Vite/TypeScript application with no backend of its own.
It reuses the flight-planning JavaScript from `src/qfield-plugin/` through
`plugins/vite-plugin-qmljs.ts`; the Python `drone-flightplan` package remains
the canonical implementation.

Terrain sampling mirrors the backend's Copernicus GLO-30 grid logic. Plans and
terrain data are stored locally in OPFS.

The frontend image builds the planner and serves it at `/plan`. The main
frontend links to it through `VITE_FLIGHT_PLANNER_URL`, which defaults to
`/plan/`.
