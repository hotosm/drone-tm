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
TiTiler, with CloudFront caching and CORS enabled.

- The backend will request a GeoTIFF crop for the project area and pass it to
  the existing elevation code. This replaces the JAXA scraper, its background
  job, and the stored per-project `dem.tif` files.
- The browser will request Terrarium tiles and cache them per project. The same
  tiles can be used by MapLibre for terrain display.

Fetching per project avoids downloading the same tiles again for each task,
because tasks are subdivisions of the project area.

This approach uses one service for both clients, keeps the backend data in its
native projection, and adds no DEM storage or conversion pipeline. Tests against
the public TiTiler demo returned a small GeoTIFF crop in 2.4 seconds cold and
0.17 seconds warm, which is acceptable for a once-per-project request.

## Consequences

- GLO-30 replaces AW3D30 as the elevation source and should improve accuracy.
- Generated flightplans may differ slightly from existing plans. Elevation is
  measured relative to the takeoff point, so datum differences should mostly
  cancel and remain within the current 5 m AGL threshold.
- The static site will depend on our TiTiler service and the public AWS dataset.
- If the public dataset becomes unavailable, we can copy the same COGs to our
  own bucket without changing either client.
