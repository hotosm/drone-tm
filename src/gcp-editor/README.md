# Ground Control Point Editor

## Install

```bash
npm install @hotosm/gcp-editor
```

## Usage

```html
<!doctype html>
<html lang="en">
  <head>
    <script type="module">
      import '@hotosm/gcp-editor';
      import '@hotosm/gcp-editor/style.css';
    </script>
  </head>
  <body>
    <gcp-editor></gcp-editor>
  </body>
</html>
```

## Project Goals

- Load TIFF imagery, either via COG URL, or uploading a file.
- Load GCP coordinates from a file.
- Pinpoint on the tiff imagery exactly where the GCPs are located.
- Output a GCP `.txt` file for use in ODM and other tools (this file
  links real world coordinates to x/y pixel coordinates on an image).

## The GCP TXT File Output

- In the end we have the GCP `.txt` file and all photos in EPSG:4326 projection.
- These files are sent to NodeODM for processing via ODM 'split merge' mode.
- ODM decides on best way to divide up the photos for efficient processing.
- The GCPs are used to georeference the images.
- The images are combined into one large orthomosaic.

## Implementation

**Note** this info below is now outdated 18/12/2024!

- The most suitable candidate for this is a Web Component.
- A Web Component can be standalone, easily embedded anywhere on the web.
- We have an image georeferenced by a drone in EPSG:4326.
- Ideally we need to reproject EPSG:4326 to a cartesian UTM projection,
  allowing us to accurately extract pixel coordinates from the image
  and pair them with lat/lon coords in real life.
- By far the best candidate for this is OpenLayers, the mapping library
  with the best projection support.
- We may also need to use [geotiff.js](https://github.com/geotiffjs/geotiff.js)
  for low level calculations / math to achieve what we need.
- An example using both can be found at <https://github.com/geotiffjs/cog-explorer>

> Note that MapLibre has a new
> [COG protocol extension](https://github.com/geomatico/maplibre-cog-protocol),
> but this only supports EPSG:3857 images and we do not wish to introduce
> that inaccuracy when dealing with precise GCP.

Related forum post that will influence our decisions here:
<https://community.opendronemap.org/t/passing-different-output-projections-to-odm-eg-a-proj-flag/22460>
