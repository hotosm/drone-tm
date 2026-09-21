# DroneTM Flight Planner

An offline-capable flight plan generator, served at
[drone.hotosm.org/plan](https://drone.hotosm.org/plan). Pilots can draw or
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

`VITE_MAIN_SITE_URL` sets the target of the header's **Main site** link. It is
read at runtime from the deployment's `/config.js`, falling back to the build's
own env:

```bash
VITE_MAIN_SITE_URL=https://example.org pnpm build
```

Unset, the planner works it out from where it is served: under the main app at
`/plan/` it links back to that origin, so a local stack links to localhost
rather than production. Served from a root of its own, with nothing configured,
it can only link back to that same root - set `VITE_MAIN_SITE_URL` there.

Arriving with a `project` parameter, the link becomes **Back to project** and
points at that project page.

## URL Parameters

The planner accepts these optional query parameters:

| Parameter      | Purpose                                                         |
| -------------- | --------------------------------------------------------------- |
| `aoi`          | URL of a single-polygon GeoJSON flight area                     |
| `params`       | URL of a `params.json` file with flight settings                |
| `tasks`        | URL of the project's task areas: saves one plan per task        |
| `project`      | DroneTM project ID; plans are stored in a folder of its own     |
| `project_name` | Project name, for the heading its plans are grouped under       |
| `task`         | Project task number, which names and identifies the plan        |
| `project_aoi`  | URL of the project outline used to size shared terrain coverage |

Fetched data is saved locally for offline use. When `project_aoi` is
not provided, terrain coverage is based on a 25 km buffer around the flight
area.

With `tasks`, the planner saves every task area, then downloads one terrain
crop covering the project - the pilot is still online at that point, and that
single crop is what every task inside it samples. A project too large for one
crop (over 2048 px, roughly 60 km across) gets as much as fits around its
middle, and says so; the tasks outside that need their own download while
there is still a signal.

Re-opening the link tops the project up: new tasks are added, tasks saved
earlier and not opened since are refreshed from the project, and any the pilot
has worked on are left alone (only their project labelling is updated). A task
removed from the project keeps its local plan. Once the import succeeds the
fetch parameters are dropped from the URL, so a later reload opens the saved
project instead of retrying the network.

While a project is open, its other tasks are drawn on the map with their
numbers. Tapping one - the number or the area - opens that task's plan, as does
picking it from **Saved plans**. With no project in play none of this appears
and the planner behaves exactly as it does standalone.

## Architecture and deployment

The planner is a static Vite/TypeScript application with no backend of its own.
It reuses the flight-planning JavaScript from `src/qfield-plugin/` through
`plugins/vite-plugin-qmljs.ts`; the Python `drone-flightplan` package remains
the canonical implementation.

Terrain sampling mirrors the backend's Copernicus GLO-30 grid logic. Plans and
terrain data are stored locally in OPFS:

```text
plans/{project-id}/{plan-id}/   one folder per project, so two projects'
plans/unassigned/{plan-id}/     "Task 3" never collide; hand-drawn plans here
dems/{key}.tif                  crops, shared by every plan they cover
```

Plans saved before this layout are moved into it on startup, and are still
listed if that move has not run.

Generated flightplans are not stored. Everything needed to rebuild one - the
area, the settings and the terrain - is local, so a plan is generated on demand
and held in memory until it is downloaded.

The frontend image builds the planner and serves it at `/plan`, on the main
app's origin. That is what makes the handoff work: the URL parameters above
point at the DroneTM API, and the planner authenticates those fetches with the
session token the React app keeps in `localStorage`, reading the API origin
from the `/config.js` the deployment generates.

Serving it there is a deployment invariant, not a convenience: the session
token is scoped to the DroneTM origin, so a planner on an origin of its own
could not authenticate the handoff fetches at all. Without `/config.js` the
planner trusts no origin and sends no token, so handoff links degrade to
drawing the area by hand - everything else, terrain included, works the same.
