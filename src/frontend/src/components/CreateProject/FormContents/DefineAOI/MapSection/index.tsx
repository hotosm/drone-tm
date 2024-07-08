import { useEffect } from 'react';
import { useTypedSelector, useTypedDispatch } from '@Store/hooks';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import { FlexRow } from '@Components/common/Layouts';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import { FeatureCollection } from 'geojson';
import getBbox from '@turf/bbox';
import MapTools from '../MapTools';

export default function MapSection() {
  const dispatch = useTypedDispatch();
  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  const uploadedGeojson = useTypedSelector(
    state => state.createproject.uploadedGeojson,
  );

  useEffect(() => {
    if (!uploadedGeojson) return;
    const bbox = getBbox(uploadedGeojson as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25 });
  }, [map, uploadedGeojson]);

  return (
    <MapContainer
      map={map}
      isMapLoaded={isMapLoaded}
      style={{
        width: '100%',
        height: '448px',
      }}
    >
      <MapTools />
      <VectorLayer
        map={map as Map}
        isMapLoaded={isMapLoaded}
        id="uploaded-area"
        geojson={uploadedGeojson as GeojsonType}
        visibleOnMap={!!uploadedGeojson}
      />
      <BaseLayerSwitcher />
    </MapContainer>
  );
}
