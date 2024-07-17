import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import { useEffect } from 'react';
import { LngLatBoundsLike } from 'maplibre-gl';
import { FeatureCollection } from 'geojson';
import getBbox from '@turf/bbox';

export default function MapSection({ data }: { data: any }) {
  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  useEffect(() => {
    if (!data?.outline_geojson) return;
    const bbox = getBbox(data?.outline_geojson as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25 });
  }, [data?.outline_geojson, map]);

  return (
    <MapContainer
      map={map}
      isMapLoaded={isMapLoaded}
      style={{
        width: '100%',
        height: '582px',
      }}
    >
      {data?.outline_geojson && (
        <VectorLayer
          id="outline-layer"
          geojson={data.outline_geojson}
          style={{
            type: 'fill',
            paint: {
              'fill-color': '#328ffd',
              'fill-outline-color': '#D33A38',
              'fill-opacity': 0.2,
            },
          }}
        />
      )}
      <BaseLayerSwitcher />
    </MapContainer>
  );
}
