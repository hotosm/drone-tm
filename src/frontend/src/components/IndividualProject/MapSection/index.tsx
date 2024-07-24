/* eslint-disable object-shorthand */
import { useEffect, useState } from 'react';
import { useTypedSelector } from '@Store/hooks';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import getBbox from '@turf/bbox';
import { FeatureCollection } from 'geojson';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';

export default function MapSection() {
  const [tasksBoundaryLayer, setTasksBoundaryLayer] = useState<Record<
    string,
    any
  > | null>(null);

  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  const tasksData = useTypedSelector(state => state.project.tasksData);
  const projectArea = useTypedSelector(state => state.project.projectArea);

  // create combined geojson from individual tasks from the API
  useEffect(() => {
    if (!map || !tasksData) return;
    const features = tasksData?.map(taskObj => {
      return {
        type: 'Feature',
        geometry: { ...taskObj.outline_geojson.geometry },
        properties: {
          ...taskObj.outline_geojson.properties,
          locked_by_user: taskObj?.locked_by_uid,
        },
        id: `${taskObj.id}_${taskObj.task_status}`,
      };
    });
    const taskBoundariesFeatcol = {
      type: 'FeatureCollection',
      SRID: {
        type: 'name',
        properties: {
          name: 'EPSG:3857',
        },
      },
      features: features,
    };
    setTasksBoundaryLayer(taskBoundariesFeatcol);
  }, [map, tasksData]);

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
      {tasksBoundaryLayer && (
        <VectorLayer
          map={map as Map}
          id="tasks-layer"
          visibleOnMap={!!tasksBoundaryLayer}
          geojson={tasksBoundaryLayer as GeojsonType}
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
      )}
      <BaseLayerSwitcher />
    </MapContainer>
  );
}
