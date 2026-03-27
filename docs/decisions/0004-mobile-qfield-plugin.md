# Use a QField plugin for offline mobile flightplan generation

## Context and Problem Statement

Drone operators need to generate flightplans in the field, often in remote
areas with no internet connectivity. The flightplan generation requires:

- Selecting a task area polygon from the project.
- Configuring flight parameters (drone model, gimbal angle, flight mode).
- Generating waypoints with correct spacing based on overlap and altitude/GSD.
- Sampling a bundled DEM raster for terrain-following elevation adjustments.
- Outputting the flightplan in a format the drone's flight controller accepts
  (e.g. DJI WPML).

Previously, DroneTM had a native Kotlin Android app for this. However, this
only worked on Android, was a significant effort to maintain, and duplicated
functionality already available in geospatial tools. We needed a cross-platform
solution that could work entirely offline, leverage existing geospatial
capabilities, and be sustainable for a small team to maintain.

## Considered Options

### 1. Native Mobile App (Kotlin/Swift or Flutter)

**Approach**: build a dedicated DroneTM mobile app, either platform-native
(Kotlin for Android, Swift for iOS) or cross-platform (Flutter/React Native).

Pros:

- Full control over UI/UX, can tailor the experience exactly.
- Can bundle manufacturer SDKs for direct drone communication (see
  [ADR 0002](0002-flightplan-upload.md)).
- No dependency on third-party app ecosystems.

Cons:

- Requires maintaining two codebases (or a cross-platform framework with its
  own complexity).
- Must implement all geospatial operations from scratch: CRS reprojection,
  polygon operations, raster sampling.
- DEM elevation sampling requires bundling a raster library (e.g. GDAL), which
  is non-trivial on mobile.
- High ongoing maintenance cost: OS updates, device compatibility, app store
  submissions.
- Duplicates effort already available in the QGIS/QField ecosystem.

### 2. Progressive Web App (PWA)

**Approach**: build the flightplan generation as a web app that can work
offline via service workers.

Pros:

- Single codebase for all platforms.
- Web technologies are widely known; easier to find contributors.
- No app store approval process.

Cons:

- Limited filesystem access: cannot write flightplan files to arbitrary
  locations (e.g. DJI controller external storage). The Web File System
  Access API is not available on mobile browsers.
- No access to device USB for pushing files to connected flight controllers.
- DEM raster sampling in the browser requires loading the entire raster into
  memory via JavaScript (e.g. GeoTIFF.js), which is slow and memory-intensive
  for the 30-50MB DEMs typical in our projects.
- Cannot leverage QGIS expression engine or existing geospatial infrastructure.
- Offline support via service workers is fragile and hard to debug.

### 3. QField Plugin (QML + JavaScript)

**Approach**: write a plugin for [QField](https://qfield.org), the mobile
companion app for QGIS. The plugin uses QML for UI and JavaScript for the
flightplan generation logic, ported from our existing Python
`drone-flightplan` package.

Pros:

- Works on Android and iOS with a single codebase.
- Full access to the QGIS engine: CRS reprojection, raster value sampling
  (via `ExpressionEvaluator` and `raster_value()`), vector layer queries,
  geometry operations.
- DEM elevation sampling is handled natively by QGIS, no need to bundle
  a raster library.
- QField already has external storage permissions on Android and app sandbox
  write access on iOS.
- QField is already used in related HOT workflows (FieldTM), so operators
  only need one app installed.
- The QField project file (`.qgz`) bundles everything needed: task area
  polygons, DEM raster, basemap, and plugin. Project managers configure
  flight parameters (GSD, overlaps) via QGIS project variables when
  creating the project, so field operators just select a task and generate.
- We maintain only the plugin, not the entire app. QField handles map
  rendering, GPS, offline sync, and platform-specific concerns.
- Plugin is distributed inside the QField project itself, no app store
  submission needed for updates.
- Supports QFieldCloud for project distribution and status synchronisation.
- The 3D map rendering in QField allows visualising flightplans over terrain,
  similar to professional flight planning software.

Cons:

- QField's plugin API is relatively new and not extensively documented.
  Development requires working closely with the QField team and reading
  source code.
- QML JavaScript engine is not full ES6+: no `let`/`const`, no arrow
  functions, no modules (uses `.pragma library` with `.import` instead).
- Flightplan logic currently exists in two implementations: the Python
  `drone-flightplan` package used by the backend and a JavaScript port used
  by the QField plugin. This increases maintenance cost and drift risk unless
  we later consolidate around a single implementation.
- Limited control over UI compared to a fully custom app. Must work within
  QField's dialog and toolbar conventions.
- File writing from plugins requires workarounds: `XMLHttpRequest` PUT to
  `file://` URLs works on Android/iOS but is blocked on desktop Qt by default.
  Multiple fallback methods are needed for robustness.
- Cannot directly access USB-connected devices (e.g. DJI flight controllers)
  from within the plugin. Flightplan files are saved to device storage and
  must be manually transferred or pushed via WebADB from the web app.
- Depends on QField continuing to support the plugin API. However, the
  QField team (opengisch) are responsive and have actively assisted with
  this integration.

### 4. QGIS Desktop Plugin Only

**Approach**: build the flightplan generation as a standard QGIS desktop
plugin in Python, and have operators use QGIS on a laptop in the field.

Pros:

- Full Python environment with all libraries available (Shapely, pyproj,
  rasterio).
- Well-documented plugin API with large community.
- No need to port code to JavaScript.

Cons:

- Requires carrying a laptop into the field, which is impractical for many
  of our deployment contexts (remote areas, hiking to launch sites).
- QGIS does not run on phones or tablets.
- Doesn't integrate with the mobile-first workflow that operators already use.

## Decision Outcome

We chose **option 3: QField plugin**, because it provides the best balance of
capability, maintainability, and cross-platform support for our constraints.

The primary decision factors were:

1. **Offline-first**: everything the operator needs is bundled in the QField
   project file. No internet required in the field.
2. **DEM sampling without custom raster code**: QGIS handles raster value
   extraction natively via expressions, which was a hard requirement.
3. **Cross-platform from a single codebase**: Android and iOS support without
   maintaining separate apps.
4. **Minimal maintenance surface**: we maintain ~1000 lines of QML/JS plugin
   code, not an entire mobile application.
5. **Ecosystem fit**: QField is already part of the HOT toolchain, and
   QFieldCloud provides a natural distribution and sync mechanism.
6. **Manager-configured, operator-simple**: flight parameters (GSD, overlaps)
   are injected as QGIS project variables via pyQGIS when the project is
   created. The field operator's dialog only shows task selection, drone
   model, and generate button.

### Architecture

The plugin consists of:

- **QML UI**: toolbar button, task selection dialog, configuration form.
- **JavaScript modules**: flightplan generation algorithm ported from
  `src/backend/packages/drone-flightplan/`, organised as:
  - `flightplan/core.js` - entry point and orchestration.
  - `flightplan/grid.js` - grid generation, snake-path creation, wayline
    simplification.
  - `flightplan/geometry.js` - pure JS geometry: Web Mercator projection,
    point-in-polygon, convex hull, minimum rotated rectangle.
  - `flightplan/parameters.js` - flight parameter calculation from overlaps
    and altitude/GSD.
  - `flightplan/terrain.js` - terrain-following elevation adjustments.
  - `flightplan/drone_specs.js` - drone sensor specifications.
  - `output/dji.js` - DJI WPML XML generation.
- **DEM sampling**: uses QField's `ExpressionEvaluator` with
  `raster_value()` QGIS expressions, sampling the bundled DEM raster at
  each waypoint coordinate.
- **Project variable injection**: flight parameters are set via
  `QgsExpressionContextUtils.setProjectVariable()` in pyQGIS when the
  DroneTM backend creates the QField project bundle.

### Workflow

1. Project manager creates a DroneTM project with task areas and flight
   parameters via the web UI.
2. DroneTM backend generates a QField project bundle (`.qgz` + layers +
   DEM + plugin), with parameters stored as project variables.
3. Operator syncs the project to their device via QFieldCloud, or receives
   it as a file.
4. In the field, operator opens QField, navigates to a task area, taps
   the DroneTM toolbar button, selects the task, and generates.
5. The plugin generates the flightplan entirely offline, outputs `.wpml`
   and `.geojson` files to the project's `flightplans/` directory, and
   adds a visualisation layer to the map.
6. Operator transfers the `.wpml` file to their drone's flight controller.

### Consequences

- ✅ Works offline on Android and iOS from a single codebase.
- ✅ Leverages QGIS engine for DEM sampling and geospatial operations.
- ✅ Very low maintenance overhead compared to a native mobile app.
- ✅ Operators only need one app (QField) for field mapping and flight
  planning.
- ✅ Flight parameters are manager-controlled, simplifying the operator
  experience.
- ❌ Plugin API is young and sparsely documented; requires close
  collaboration with QField developers.
- ❌ JavaScript engine limitations require careful coding (no modern JS
  features).
- ❌ Maintaining both the Python `drone-flightplan` code and the QField
  plugin's JavaScript port increases the risk of behavioural drift until
  we consolidate around one implementation.
- ❌ File writing requires platform-specific workarounds and fallbacks.
- ❌ Cannot push flightplans directly to USB-connected flight controllers
  from within the plugin.

We may revisit this if QField's plugin API evolves significantly, or if a
need arises that cannot be met within this architecture.
