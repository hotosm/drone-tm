import { useEffect } from 'react';
import { useTypedSelector } from '@Store/hooks';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import { FeatureCollection } from 'geojson';
import getBbox from '@turf/bbox';

export default function MapSection() {
  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  const uploadedProjectArea = useTypedSelector(
    state => state.createproject.uploadedProjectArea,
  );
  const uploadedNoFlyZone = useTypedSelector(
    state => state.createproject.uploadedNoFlyZone,
  );

  useEffect(() => {
    if (!uploadedProjectArea) return;
    const bbox = getBbox(uploadedProjectArea as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25 });
  }, [map, uploadedProjectArea]);

  return (
    <MapContainer
      map={map}
      isMapLoaded={isMapLoaded}
      style={{
        width: '100%',
        height: '448px',
      }}
    >
      <VectorLayer
        map={map as Map}
        isMapLoaded={isMapLoaded}
        id="uploaded-project-area"
        geojson={uploadedProjectArea as GeojsonType}
        visibleOnMap={!!uploadedProjectArea}
        layerOptions={{
          type: 'fill',
          paint: {
            'fill-color': '#328ffd',
            'fill-outline-color': '#D33A38',
            'fill-opacity': 0.2,
          },
        }}
      />
      <VectorLayer
        map={map as Map}
        isMapLoaded={isMapLoaded}
        id="uploaded-no-fly-zone"
        geojson={uploadedNoFlyZone as GeojsonType}
        visibleOnMap={!!uploadedNoFlyZone}
        layerOptions={{
          type: 'fill',
          paint: {
            'fill-color': '#404040',
            'fill-outline-color': '#D33A38',
            'fill-opacity': 0.5,
          },
        }}
      />
      <BaseLayerSwitcher />
    </MapContainer>
  );
}
