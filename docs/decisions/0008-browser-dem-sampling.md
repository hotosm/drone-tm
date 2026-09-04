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

### 3. Build a global terrain-RGB PMTiles archive

A single archive would work well with MapLibre, but building it means converting
more than 26,000 source tiles and handling seams, oceans, and missing data. It
would also reproject the data to EPSG:3857. At zoom 12 this is about 38 m per
pixel at the equator, which is coarser than the 30 m source data.

## Decision Outcome

Use **option 1**. Index GLO-30 in pgSTAC and serve it through our existing
TiTiler, which already sends `Access-Control-Allow-Origin: *`. There is no CDN
in front of it today; adding one would help the browser tile path but the
backend does not need it.

- The backend will request a GeoTIFF crop for the project area and pass it to
  the existing elevation code, writing it to the same per-project `dem.tif` so
  every downstream consumer is unchanged and still works offline.
- GLO-30 becomes the default rather than the only option. Project creation
  takes a `dem_source` of `GLO30`, `JAXA` or `UPLOAD`, with the last two behind
  the advanced toggle. The JAXA scraper has served us well and is kept as a
  fallback for as long as it keeps working.
- The browser will request Terrarium tiles and cache them per project. The same
  tiles can be used by MapLibre for terrain display.

Fetching per project avoids downloading the same tiles again for each task,
because tasks are subdivisions of the project area.

This approach uses one service for both clients, keeps the backend data in its
native projection, and adds no DEM storage or conversion pipeline. TiTiler
resamples onto whatever grid the requested bbox describes, so the backend must
snap its bbox to the 1/3600 degree source grid and pass the matching `width` and
`height`; done that way the crop is pixel-identical to reading the COGs
directly, including where two tiles are mosaicked across a 1 degree seam. A
crop takes a few seconds cold and is cached warm, which is acceptable for a
once-per-project request.

## Consequences

- GLO-30 becomes the default elevation source and should improve accuracy.
  AW3D30 stays selectable, so a project can fall back if GLO-30 has a void
  or the OAM raster service is down.
- Generated flightplans may differ slightly from existing plans. Elevation is
  measured relative to the takeoff point, so datum differences should mostly
  cancel and remain within the current 5 m AGL threshold.
- The static site will depend on our TiTiler service and the public AWS dataset.
- If the public dataset becomes unavailable, we can copy the same COGs to our
  own bucket without changing either client.
