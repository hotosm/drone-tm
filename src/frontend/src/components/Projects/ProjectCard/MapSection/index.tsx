import { useEffect } from 'react';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import getBbox from '@turf/bbox';
import { FeatureCollection } from 'geojson';
import hasErrorBoundary from '@Utils/hasErrorBoundary';

const MapSection = ({
  containerId,
  geojson,
}: {
  containerId: string;
  geojson: GeojsonType;
}) => {
  const { map, isMapLoaded } = useMapLibreGLMap({
    containerId,
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  useEffect(() => {
    if (!geojson) return;
    const bbox = getBbox(geojson as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 30 });
  }, [geojson, map]);

  return (
    <MapContainer
      containerId={containerId}
      map={map}
      isMapLoaded={isMapLoaded}
      style={{
        width: '100%',
        height: '150px',
      }}
    >
      {geojson && (
        <VectorLayer
          map={map as Map}
          isMapLoaded={isMapLoaded}
          id={containerId}
          geojson={geojson}
          visibleOnMap={!!geojson}
        />
      )}
      <BaseLayerSwitcher />
    </MapContainer>
  );
};

export default hasErrorBoundary(MapSection);
