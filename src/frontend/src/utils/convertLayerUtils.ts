/* eslint-disable import/prefer-default-export */
import gjv from 'geojson-validation';
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
    type: 'application/json',
  });
  const dataExtractFile = new File([dataExtractBlob], 'extract.json', {
    type: 'application/json',
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

export function ensurePolygonGeometry(geojson: any) {
  if (!geojson || !geojson.features) return { valid: true, data: geojson };

  const errors: string[] = [];

  const processedFeatures = geojson.features.map((feature: any, index: number) => {
    const geomType = feature.geometry?.type;

    if (geomType === 'LineString') {
      const coords = feature.geometry.coordinates;

      // Validate LineString has at least 2 points
      if (!coords || coords.length < 2) {
        errors.push(`Feature ${index + 1}: LineString must have at least 2 points`);
        return feature;
      }

      // Check if LineString is closed (first and last points are the same)
      const firstPoint = coords[0];
      const lastPoint = coords[coords.length - 1];
      const isClosed =
        firstPoint[0] === lastPoint[0] && firstPoint[1] === lastPoint[1];

      if (!isClosed) {
        errors.push(
          `Feature ${index + 1}: LineString must be closed (first and last points must be identical) to create a valid Polygon`
        );
        return feature;
      }

      // Convert to Polygon (LineString is already closed)
      return {
        ...feature,
        geometry: {
          type: 'Polygon',
          coordinates: [coords],
        },
      };
    }

    return feature;
  });

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      data: geojson,
    };
  }

  return {
    valid: true,
    data: {
      ...geojson,
      features: processedFeatures,
    },
  };
}

export function validateGeoJSON(file: File) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsText(file);
    reader.onloadend = () => {
      const geojson = reader.result;
      if (gjv.valid(JSON.parse(geojson as string))) {
        resolve(JSON.parse(geojson as string));
      } else {
        reject(new Error('Invalid geojson'));
      }
    };
  });
}
