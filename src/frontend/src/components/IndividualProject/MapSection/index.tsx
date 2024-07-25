/* eslint-disable no-unused-vars */
import { useParams } from 'react-router-dom';
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
import { useGetTaskStatesQuery } from '@Api/projects';

export default function MapSection() {
  const { id } = useParams();
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

  const { data: taskStates } = useGetTaskStatesQuery(id as string, {
    enabled: !!tasksData,
  });

  // create combined geojson from individual tasks from the API
  useEffect(() => {
    if (!map || !tasksData) return;

    // @ts-ignore
    const taskStatus: Record<string, any> = taskStates?.reduce(
      (acc: Record<string, any>, task: Record<string, any>) => {
        acc[task.task_id] = task.state;
        return acc;
      },
      {},
    );
    const features = tasksData?.map(taskObj => {
      return {
        type: 'Feature',
        geometry: { ...taskObj.outline_geojson.geometry },
        properties: {
          ...taskObj.outline_geojson.properties,
          state: taskStatus?.[`${taskObj.id}`] || null,
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
  }, [map, taskStates, tasksData]);

  // zoom to layer in the project area
  useEffect(() => {
    if (!tasksBoundaryLayer) return;
    const bbox = getBbox(tasksBoundaryLayer as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25 });
  }, [map, tasksBoundaryLayer]);

  const getPopUpButtonText = (taskState: string) => {
    if (taskState === 'UNLOCKED_FOR_MAP') return 'Request for Mapping';
    if (taskState === '') return '';
    return 'nothing';
  };

  const getPopupUI = useCallback((properties: Record<string, any>) => {
    return (
      <PopupUI
        data={{
          GSD: 3,
          altitude: 100,
          gimble_angle: -90,
          TASK_STATUS: properties?.state,
        }}
      />
    );
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
