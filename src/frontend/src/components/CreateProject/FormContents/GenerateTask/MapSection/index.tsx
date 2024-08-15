import { useEffect } from 'react';
import { useTypedSelector } from '@Store/hooks';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import getBbox from '@turf/bbox';
import { FeatureCollection } from 'geojson';
import hasErrorBoundary from '@Utils/hasErrorBoundary';

const MapSection = () => {
  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  const projectArea = useTypedSelector(
    state => state.createproject.projectArea,
  );
  const splitGeojson = useTypedSelector(
    state => state.createproject.splitGeojson,
  );

  useEffect(() => {
    if (!projectArea) return;
    const bbox = getBbox(projectArea as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25 });
  }, [map, projectArea]);

  return (
    <MapContainer
      map={map}
      isMapLoaded={isMapLoaded}
      style={{
        width: '100%',
        height: '448px',
      }}
    >
      {!splitGeojson && (
        <VectorLayer
          map={map as Map}
          isMapLoaded={isMapLoaded}
          id="uploaded-project-area"
          geojson={projectArea}
          visibleOnMap={!!projectArea}
          layerOptions={{
            type: 'fill',
            paint: {
              'fill-color': '#328ffd',
              'fill-outline-color': '#D33A38',
              'fill-opacity': 0.2,
            },
          }}
        />
      )}
      <VectorLayer
        map={map as Map}
        isMapLoaded={isMapLoaded}
        id="split-area"
        geojson={splitGeojson as GeojsonType}
        visibleOnMap={!!splitGeojson}
        layerOptions={{
          type: 'fill',
          paint: {
            'fill-color': '#328ffd',
            'fill-outline-color': '#D33A38',
            'fill-opacity': 0.2,
          },
        }}
      />
      <BaseLayerSwitcher />
    </MapContainer>
  );
};

export default hasErrorBoundary(MapSection);
