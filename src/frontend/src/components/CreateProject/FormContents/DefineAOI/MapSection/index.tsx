import { useTypedSelector, useTypedDispatch } from '@Store/hooks';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import MeasureTool from '@Components/common/MapLibreComponents/MeasureTool';
import { setCreateProjectState } from '@Store/actions/createproject';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import { Map } from 'maplibre-gl';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';

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
  const measureType = useTypedSelector(
    state => state.createproject.measureType,
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
        id="uploaded-area"
        geojson={uploadedGeojson as GeojsonType}
        visibleOnMap={!!uploadedGeojson}
      />
      <MeasureTool
        enable={!!measureType}
        measureType={measureType}
        onDrawComplete={geojson => {
          dispatch(setCreateProjectState({ uploadedGeojson: geojson }));
        }}
      />
      <BaseLayerSwitcher />
    </MapContainer>
  );
}
