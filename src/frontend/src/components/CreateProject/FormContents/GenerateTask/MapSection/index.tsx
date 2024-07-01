import { useTypedSelector } from '@Store/hooks';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import { Map } from 'maplibre-gl';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';

export default function MapSection() {
  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  const splitGeojson = useTypedSelector(
    state => state.createproject.splitGeojson,
  );

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
        id="split-area"
        geojson={splitGeojson as GeojsonType}
        visibleOnMap={!!splitGeojson}
      />
      <BaseLayerSwitcher />
    </MapContainer>
  );
}
