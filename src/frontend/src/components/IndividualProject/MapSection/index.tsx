/* eslint-disable no-unused-vars */
import { useCallback, useEffect, useState } from 'react';
import { useTypedSelector, useTypedDispatch } from '@Store/hooks';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import AsyncPopup from '@Components/common/MapLibreComponents/AsyncPopup';
import getBbox from '@turf/bbox';
import { FeatureCollection } from 'geojson';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import PopupUI from '@Components/common/MapLibreComponents/PopupUI';
import { setProjectState } from '@Store/actions/project';

export default function MapSection() {
  const dispatch = useTypedDispatch();

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

  const selectedTaskId = useTypedSelector(
    state => state.project.selectedTaskId,
  );
  const tasksData = useTypedSelector(state => state.project.tasksData);

  // create combined geojson from individual tasks from the API
  useEffect(() => {
    if (!map || !tasksData) return;
    const features = tasksData?.map(taskObj => {
      return {
        type: 'Feature',
        geometry: { ...taskObj.outline_geojson.geometry },
        properties: {
          ...taskObj.outline_geojson.properties,
        },
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
      features,
    };
    setTasksBoundaryLayer(taskBoundariesFeatcol);
  }, [map, tasksData]);

  // zoom to layer in the project area
  useEffect(() => {
    if (!tasksBoundaryLayer) return;
    const bbox = getBbox(tasksBoundaryLayer as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25 });
  }, [map, tasksBoundaryLayer]);

  const getPopupUI = useCallback((properties: Record<string, any>) => {
    return <PopupUI data={{ GSD: 3, altitude: 100, gimble_angle: -90 }} />;
  }, []);

  return (
    <MapContainer
      map={map}
      isMapLoaded={isMapLoaded}
      style={{
        width: '100%',
        height: '100%',
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
      <AsyncPopup
        map={map as Map}
        popupUI={getPopupUI}
        title={`Task #${selectedTaskId}`}
        fetchPopupData={(properties: Record<string, any>) => {
          dispatch(setProjectState({ selectedTaskId: properties.id }));
        }}
        buttonText="Lock For Mapping"
      />
      <BaseLayerSwitcher />
    </MapContainer>
  );
}
