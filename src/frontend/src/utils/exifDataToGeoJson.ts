import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import { IFilesExifData } from '@Store/slices/droneOperartorTask';

export default function convertExifDataToGeoJson(data: IFilesExifData[]): {
  type: string;
  features: GeojsonType[];
} {
  const features: GeojsonType[] = data.map((item, index) => {
    const { file, dateTime, coordinates } = item;
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          Number(coordinates.longitude) ?? 0,
          Number(coordinates.latitude) ?? 0,
        ], // Defaulting to 0 if coordinates are null
      },
      properties: {
        id: String(index + 1),
        name: file.name,
        fileBob: URL.createObjectURL(file),
        description: `This file was taken at ${dateTime}`, // Description can be customized
        dateTime,
      },
    };
  });

  return {
    type: 'FeatureCollection',
    features,
  };
}
