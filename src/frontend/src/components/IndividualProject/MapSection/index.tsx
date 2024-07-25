import { useEffect } from 'react';
import { useTypedSelector } from '@Store/hooks';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import getBbox from '@turf/bbox';
import { FeatureCollection } from 'geojson';

export default function MapSection() {
  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  const tasksGeojson = useTypedSelector(state => state.project.tasksGeojson);
  const projectArea = useTypedSelector(state => state.project.projectArea);

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
        height: '582px',
      }}
    >
      {tasksGeojson?.map(singleTask => (
        <VectorLayer
          map={map as Map}
          key={singleTask.id}
          id={singleTask.id}
          visibleOnMap={!!singleTask?.outline_geojson}
          geojson={singleTask?.outline_geojson}
          interactions={['feature']}
          layerOptions={{
            type: 'fill',
            paint: {
              'fill-color': '#328ffd',
              'fill-outline-color': '#484848',
              'fill-opacity': 0.5,
            },
          }}
        />
      ))}
      <BaseLayerSwitcher />
    </MapContainer>
  );
}
