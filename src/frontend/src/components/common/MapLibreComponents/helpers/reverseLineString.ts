export default function reverseLineString(geojson: any) {
  const geometry = geojson?.features ? geojson.features[0].geometry : geojson;
  if (!geometry) return geojson;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          ...geometry,
          coordinates: [...geometry.coordinates].reverse(),
        },
      },
    ],
  };
}
