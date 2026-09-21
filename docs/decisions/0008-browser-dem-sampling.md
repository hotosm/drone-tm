# Serving DEM data for terrain following

## Context and Problem Statement

We need global elevation data in two places:

- The backend uses it to add terrain following to flightplans. It currently
  scrapes JAXA AW3D30 tiles, joins them, and stores a `dem.tif` for each project.
- A standalone flightplan site needs to generate the same plans in the browser.
  Terrain data is the only part it cannot yet access directly.

The new source must work worldwide, support browser access, avoid unnecessary
resampling in the backend, and replace the JAXA scraper.

Copernicus GLO-30 is a good fit. It has the same 30 m resolution as AW3D30 and
generally better vertical accuracy. Its Cloud Optimized GeoTIFFs (COGs) are
publicly available on AWS, but the bucket does not allow browser access through
CORS. The complete dataset is also about 549 GiB, so copying or converting it
would add storage and maintenance work.

## Considered Options

### 1. Serve the official COGs through TiTiler

Add the existing GLO-30 STAC records to our pgSTAC database. Our TiTiler service
can then read the official COGs directly and return either a GeoTIFF crop or
browser-friendly terrain tiles. This needs no copy of the source data.

### 2. Copy the COGs to our own S3 bucket

This would let the browser read the files with `geotiff.js`, but it would
duplicate about 549 GiB of public data. It also offers no clear benefit to the
backend over TiTiler.

### 3. Use Mapterhorn terrain tiles for display

[Mapterhorn](https://mapterhorn.com/) already runs the
[open-source pipeline](https://github.com/mapterhorn/mapterhorn) to combine the
best available DEM per region. It provides global 30 m and higher resolution
regional coverage as 512 px Terrarium WebP tiles through
`https://tiles.mapterhorn.com/{z}/{x}/{y}.webp` and downloadable
[PMTiles archives](https://mapterhorn.com/data-access/), which we can self-host
if needed. These tiles are useful as a terrain surface for draping an
orthophoto in MapLibre, but not for flightplan elevation sampling: they combine
different DEM sources, quantise elevation, and use a different projection and
grid from GLO-30.

## Decision Outcome

Use **option 1 for both the backend and the browser**. Index GLO-30 in pgSTAC
and serve it through our existing TiTiler; both clients request a GeoTIFF crop
from it for flightplan generation. Mapterhorn is only used by MapLibre to
display terrain and drape orthophotos; it is never an elevation input to a
flightplan.

- The backend will request a GeoTIFF crop for the project area and pass it to
  the existing elevation code, writing it to the same per-project `dem.tif` so
  every downstream consumer is unchanged and still works offline.
- GLO-30 becomes the default rather than the only option. Project creation
  takes a `dem_source` of `GLO30`, `JAXA` or `UPLOAD`, with the last two behind
  the advanced toggle. The JAXA scraper has served us well and is kept as a
  fallback for as long as it keeps working.
- For GLO-30 projects, the browser requests the same GeoTIFF crop and caches it
  per plan, so it samples the same grid as the backend.
- Mapterhorn Terrarium tiles are used only for MapLibre terrain display and
  orthophoto draping. They do not affect generated waypoint altitudes.

Fetching per project avoids downloading the same tiles again for each task,
because tasks are subdivisions of the project area.

This keeps the backend data in its native projection and adds no DEM conversion
pipeline of our own. TiTiler resamples onto whatever grid the requested bbox
describes, so the backend must snap its bbox to the 1/3600 degree source grid
and pass the matching `width` and
`height`; done that way the crop is pixel-identical to reading the COGs
directly, including where two tiles are mosaicked across a 1 degree seam. A
crop takes a few seconds cold and is cached warm, which is acceptable for a
once-per-project request.

## Consequences

- GLO-30 becomes the default elevation source and should improve accuracy.
  AW3D30 stays selectable, so a project can fall back if GLO-30 has a void
  or the OAM raster service is down.
- For GLO-30 projects, browser and backend sample the same grid. JAXA and
  uploaded DEM overrides are outside this parity guarantee.
- The browser depends on the same OAM raster service as the backend. Crops are
  cached in the browser, so a project already downloaded keeps working when it
  is unavailable, and a pilot can upload their own DEM instead.
- MapLibre terrain display depends on Mapterhorn, but flightplan generation
  does not.
- If the public dataset becomes unavailable, we can copy the same COGs to our
  own bucket without changing the backend.
