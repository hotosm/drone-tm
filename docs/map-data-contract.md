# Map data contract — what to ask the pipeline team for

_Status: proposal, Jul 2026. Owner: Rob. Audience: HOT / DroneTM pipeline team._

## The problem in one line

The app is a **static site on a CDN** (no backend). The raw geodata that makes
auto-classification accurate — ODM's `dsm.tif` + `dtm.tif` — is **~2.5 GB each
decoded** (25,538 × 24,075 px, 32-bit float, 5 cm/px, UTM 28N). We cannot ship
that to a browser, and we don't need to.

## The principle

**Heavy geodata is preprocessed once into a small derived artifact; the static
app consumes the artifact.** Processing is an authoring/pipeline concern;
hosting is a runtime concern. They don't conflict. The 2.5 GB rasters never
leave the pipeline.

The only thing the app actually needs from the DSM/DTM is **"how high is this
surface above the bare ground?"** (nDSM = surface − terrain) at each of the
mesh's ~288k vertices. Sampling collapses **2.5 GB → ~1 MB**.

## How the app loads a map (the URL param)

A map is addressed by a single entry URL — a small **manifest JSON**:

```
https://app.example.org/?map=https://cdn.example.org/coconut/coconut.map.json
```

The manifest references the mesh + the derived surface data. Everything is
same-origin-relative to the manifest (or absolute), so a map is a folder on the
CDN.

```jsonc
{
  "schema": "dmt-map/1",
  "name": "Coconut Farm",
  "crs": "EPSG:32628",                 // UTM zone 28N (informational)

  "mesh": {
    "low":  "coconut-low.glb",         // canonical label substrate (~10 MB)
    "high": "coconut-high.glb"         // texture-streaming source (~60 MB)
  },

  // ONE of the two "surface" forms below (see Format A / Format B).
  "surface": { ... }
}
```

## The surface data — pick ONE format

Both keep the app static and give us real bare-earth height. Choose whichever
is cheaper for the pipeline.

### Format A — per-vertex attribute (PREFERRED: zero alignment risk)

The pipeline already has the mesh and the DSM/DTM **in the same coordinate
system**, so it can sample them at every mesh vertex and hand us the result
directly. No georeferencing math on our side, no chance of misalignment.

Deliver a flat binary array, **one value per mesh vertex, in the low-res GLB's
vertex order**:

```jsonc
"surface": {
  "format": "vertex-ndsm/1",
  "url": "coconut-ndsm.f32",           // raw little-endian Float32, length = vertexCount
  "vertexCount": 288342,               // MUST match coconut-low.glb
  "units": "metre",
  "noData": -9999                      // vertices with no raster coverage
}
```

- `ndsm[i]` = `surfaceElevation(vertex i) − terrainElevation(vertex i)` in metres
  (i.e. height above bare ground). ~288k × 4 B ≈ **1.1 MB**, gzips to a few
  hundred KB.
- Optional second array `material` (1 byte/vertex) if you also classify from the
  orthophoto (0=unknown,1=ground,2=building,3=vegetation,4=road,5=water).
- Requirement: the low-res GLB vertex order is **stable** and matches the array.
  (It already is — both GLBs share 130 identically-ordered tiles.)

### Format B — standalone terrain grid + georef (generic, we align)

If you'd rather ship a reusable terrain layer decoupled from a specific mesh
export, give us a **downsampled DTM** (bare earth) as a georeferenced raster:

```jsonc
"surface": {
  "format": "dtm-grid/1",
  "url": "coconut-dtm-1m.tif",         // GeoTIFF/COG, float32, ~1 m/px, deflate
  "crs": "EPSG:32628",
  // (geotransform is read from the GeoTIFF; no need to duplicate it here)

  // How to map mesh vertices into the CRS so we can sample the grid:
  "meshToCRS": {
    "offset": [696564, 937642, 0],     // odm_georeferencing/coords.txt
    "axis": "odm-local-z-up"           // GLB vertex + offset = UTM; Z is up
  },
  "noData": -9999
}
```

- **1 m/px is plenty** — the mesh geometry is coarse (a hut roof can be ~4
  triangles); classification is per-surface, not per-5-cm-pixel. The site is
  ~1278 × 1204 m → ~1.5 M cells → float32 ≈ 6 MB, COG/deflate ≈ **1–2 MB**.
  2 m/px (~380 KB) would also be fine.
- Generate from the full DTM in one GDAL step:
  `gdalwarp -tr 1 1 -r bilinear dtm.tif coconut-dtm-1m.tif`
  (add `-co TILED=YES -co COMPRESS=DEFLATE` for a COG).
- We read it in-browser with `geotiff.js`. **DSM not required** — we get the
  surface elevation from the mesh itself; we only need the bare-earth DTM.
- The one thing we MUST get right is `meshToCRS`: the transform from GLB vertex
  coordinates to the map CRS. Please confirm the exact offset used and the axis
  convention when the GLB was exported from the georeferenced model.

## Optional, phase 2 — orthophoto for material

`odm_orthophoto` is a clean top-down RGB of the whole site. A downsampled tile
(~1 m, JPEG/COG, a few MB) would let us tell asphalt from dirt and detect
vegetation by real colour — much better than sampling the mesh's janky
textures. Nice-to-have, not needed for the ground/building split.

## The minimal ask (if you only do one thing)

Per map, alongside the two GLBs, produce **either**:

- **A** — `coconut-ndsm.f32` (per-vertex height-above-ground, GLB vertex order), **or**
- **B** — `coconut-dtm-1m.tif` (1 m bare-earth DTM) + the `meshToCRS` offset,

plus a `coconut.map.json` manifest tying them together. ~1–2 MB total on top of
the mesh. That's the whole contract.

## What each side owns

| | Pipeline team | This app |
|---|---|---|
| Produce GLBs (as today) | ✅ | |
| Sample/downsample DSM–DTM → artifact (A or B) | ✅ | |
| Write `*.map.json` manifest | ✅ (or we script it) | |
| Host GLB + artifact + manifest on CDN | ✅ | |
| Load manifest via `?map=`, render, sample surface | | ✅ |
| Segment + classify + review UI | | ✅ |

## Why this is worth it

- Building-vs-ground stops being a **guess** (today we approximate the terrain
  from the bumpy mesh — that's why cliffs read as roofs and roofs as ground).
- With real bare-earth we can pre-run classification and open the app straight
  into **review** — maximal automation, humans verify rather than tag.
- The current in-app terrain approximation stays as the **fallback** for maps
  that ship without a surface artifact, and as a diagnostic (the 🔍 inspector).
- Scales to many maps with zero added runtime infrastructure.
