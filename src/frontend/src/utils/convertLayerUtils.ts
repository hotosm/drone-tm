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
