/* eslint-disable import/prefer-default-export */
import gjv from "geojson-validation";
// import shpjs from 'shpjs';

// export function convertSHPToGeoJSON(file: File) {
//   return new Promise((resolve, reject) => {
//     const reader = new FileReader();
//     reader.onloadend = function loadReader() {
//       function convertToLayer(buffer) {
//         shpjs(buffer)
//           .then(geojson => {
//             resolve(geojson);
//           })
//           .catch(err => reject(err));
//       }
//       if (reader.readyState < 2 || reader.error) {
//         // eslint-disable-next-line no-console
//         console.log(reader.error);
//       } else {
//         convertToLayer(reader.result);
//       }
//     };
//     reader.readAsArrayBuffer(file);
//   });
// }

export function convertGeojsonToFile(geojson: Record<string, any> | null) {
  const dataExtractBlob = new Blob([JSON.stringify(geojson)], {
    type: "application/json",
  });
  const dataExtractFile = new File([dataExtractBlob], "extract.json", {
    type: "application/json",
  });
  return dataExtractFile;
}

// export function convertKMLToGeoJSON(file: File) {
//   return new Promise((resolve, reject) => {
//     const reader = new FileReader();
//     reader.readAsText(file);
//     reader.onloadend = () => {
//       const parsedXML = new DOMParser().parseFromString(
//         reader.result,
//         'text/xml',
//       );
//       const geojson = toGeoJSON.kml(parsedXML);
//       resolve(geojson);
//     };
//   });
// }

export function validateGeoJSON(file: File) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsText(file);
    reader.onloadend = () => {
      const geojson = reader.result;
      if (gjv.valid(JSON.parse(geojson as string))) {
        resolve(JSON.parse(geojson as string));
      } else {
        reject(new Error("Invalid geojson"));
      }
    };
  });
}

/**
 * `crs` member values that still mean WGS84 longitude/latitude.
 *
 * RFC 7946 dropped the `crs` member entirely and mandates WGS84, but GIS
 * exports often keep the GeoJSON 2008 form, sometimes naming 4326 explicitly.
 */
const WGS84_CRS_NAMES = [
  "urn:ogc:def:crs:ogc:1.3:crs84",
  "urn:ogc:def:crs:ogc::crs84",
  "urn:ogc:def:crs:epsg::4326",
  "epsg:4326",
  "crs84",
  "wgs84",
];

/**
 * Return the file's declared CRS when it is not WGS84 longitude/latitude.
 *
 * Files exported from desktop GIS are frequently in a projected CRS with
 * coordinates in metres. Turf measures assuming degrees, so such a file is
 * silently mismeasured by orders of magnitude rather than rejected.
 *
 * @returns the declared CRS name, or null when the file is WGS84 or says nothing.
 */
export function getNonWgs84Crs(geojson: Record<string, any>): string | null {
  const crsName = geojson?.crs?.properties?.name;
  if (typeof crsName !== "string" || !crsName) return null;
  return WGS84_CRS_NAMES.includes(crsName.toLowerCase()) ? null : crsName;
}

/** Render a CRS identifier for display, e.g. "urn:ogc:def:crs:EPSG::32736" -> "EPSG:32736". */
export function formatCrsName(crsName: string): string {
  const epsg = crsName.match(/EPSG:{1,2}(\d+)/i);
  return epsg ? `EPSG:${epsg[1]}` : crsName;
}

function positionsOutOfRange(coordinates: any): boolean {
  if (!Array.isArray(coordinates)) return false;
  if (typeof coordinates[0] === "number") {
    const [lon, lat] = coordinates;
    return Math.abs(lon) > 180 || Math.abs(lat) > 90;
  }
  return coordinates.some(positionsOutOfRange);
}

/**
 * Detect coordinates that cannot be longitude/latitude degrees.
 *
 * Catches projected files that omit the `crs` member, which
 * {@link getNonWgs84Crs} cannot see.
 */
export function hasOutOfRangeCoordinates(geojson: Record<string, any>): boolean {
  const geometries: any[] = [];
  const collect = (node: any) => {
    if (!node) return;
    if (Array.isArray(node.features)) node.features.forEach(collect);
    else if (Array.isArray(node.geometries)) node.geometries.forEach(collect);
    else if (node.geometry) collect(node.geometry);
    else if (node.coordinates) geometries.push(node.coordinates);
  };
  collect(geojson);
  return geometries.some(positionsOutOfRange);
}
