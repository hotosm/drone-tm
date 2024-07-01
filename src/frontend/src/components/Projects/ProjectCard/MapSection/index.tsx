import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';

export default function MapSection({ containerId }: { containerId: string }) {
  const { map, isMapLoaded } = useMapLibreGLMap({
    containerId,
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });
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
      <BaseLayerSwitcher />
    </MapContainer>
  );
}
