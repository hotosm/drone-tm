/* eslint-disable no-nested-ternary */
/* eslint-disable no-unused-vars */
import { useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { useTypedSelector, useTypedDispatch } from '@Store/hooks';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import AsyncPopup from '@Components/common/MapLibreComponents/AsyncPopup';
import getBbox from '@turf/bbox';
import { FeatureCollection } from 'geojson';
import { GeolocateControl, LngLatBoundsLike, Map } from 'maplibre-gl';
import { setProjectState } from '@Store/actions/project';
import {
  useGetProjectsDetailQuery,
  useGetTaskStatesQuery,
  useGetUserDetailsQuery,
} from '@Api/projects';
import lock from '@Assets/images/lock.png';
import { postTaskStatus } from '@Services/project';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import baseLayersData from '@Components/common/MapLibreComponents/BaseLayerSwitcher/baseLayers';
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import LocateUser from '@Components/common/MapLibreComponents/LocateUser';
import Legend from './Legend';

const MapSection = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useTypedDispatch();
  const [taskStatusObj, setTaskStatusObj] = useState<Record<
    string,
    any
  > | null>(null);
  const [lockedUser, setLockedUser] = useState<Record<string, any> | null>(
    null,
  );
  const { data: userDetails }: Record<string, any> = useGetUserDetailsQuery();

  const { data: projectData }: Record<string, any> = useGetProjectsDetailQuery(
    id as string,
  );

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
  const projectArea = useTypedSelector(state => state.project.projectArea);

  const { data: taskStates } = useGetTaskStatesQuery(id as string, {
    enabled: !!tasksData,
  });

  const { mutate: lockTask } = useMutation<any, any, any, unknown>({
    mutationFn: postTaskStatus,
    onSuccess: (res: any) => {
      setTaskStatusObj({
        ...taskStatusObj,
        [res.data.task_id]:
          projectData?.requires_approval_from_manager_for_locking
            ? 'REQUEST_FOR_MAPPING'
            : 'LOCKED_FOR_MAPPING',
      });
      if (projectData?.requires_approval_from_manager_for_locking) {
        toast.success('Task Requested for Mapping');
      } else {
        toast.success('Task Locked for Mapping');
        setLockedUser({ name: userDetails?.name, id: userDetails?.id });
      }
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  useEffect(() => {
    if (!map || !taskStates) return;
    // @ts-ignore
    const taskStatus: Record<string, any> = taskStates?.reduce(
      (acc: Record<string, any>, task: Record<string, any>) => {
        acc[task.task_id] = task.state;
        return acc;
      },
      {},
    );
    setTaskStatusObj(taskStatus);
  }, [map, taskStates]);

  // zoom to layer in the project area
  useEffect(() => {
    if (!tasksData) return;
    const tasksCollectiveGeojson = tasksData?.reduce(
      (acc, curr) => {
        return {
          ...acc,
          features: [...acc.features, curr.outline],
        };
      },
      {
        type: 'FeatureCollection',
        features: [],
      },
    );
    const bbox = getBbox(tasksCollectiveGeojson as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25 });
  }, [map, tasksData]);

  const getPopupUI = useCallback(
    (properties: Record<string, any>) => {
      const status = taskStatusObj?.[properties?.id];
      const popupText = (taskStatus: string) => {
        switch (taskStatus) {
          case 'UNLOCKED_TO_MAP':
            return 'This task is available for mapping';
          case 'REQUEST_FOR_MAPPING':
            return `This task is Requested for mapping ${properties.locked_user_name ? `by ${userDetails?.id === properties?.locked_user_id ? 'you' : properties?.locked_user_name}` : ''}`;
          case 'LOCKED_FOR_MAPPING':
            return `This task is locked for mapping ${properties.locked_user_name ? `by ${userDetails?.id === properties?.locked_user_id ? 'you' : properties?.locked_user_name}` : ''}`;
          case 'UNFLYABLE_TASK':
            return 'This task is not flyable';
          case 'COMPLETED':
            return 'This Task is completed';
          default:
            return '';
        }
      };
      return <h6>{popupText(status)}</h6>;
    },
    [taskStatusObj, userDetails],
  );

  const handleTaskLockClick = () => {
    lockTask({
      projectId: id,
      taskId: selectedTaskId,
      data: { event: 'request' },
    });
  };

  return (
    <MapContainer
      map={map}
      isMapLoaded={isMapLoaded}
      style={{
        width: '100%',
        height: '100%',
      }}
    >
      <BaseLayerSwitcherUI isMapLoaded={isMapLoaded} />
      <LocateUser isMapLoaded={isMapLoaded} />

      {projectArea && (
        <VectorLayer
          map={map as Map}
          id="project-area"
          visibleOnMap
          geojson={
            {
              type: 'FeatureCollection',
              features: [projectArea],
            } as GeojsonType
          }
          layerOptions={{
            type: 'line',
            paint: {
              'line-color': '#D73F3F',
              'line-width': 2,
            },
          }}
        />
      )}

      {projectData?.no_fly_zones_geojson && (
        <VectorLayer
          map={map as Map}
          id="no-fly-zone-area"
          visibleOnMap
          geojson={
            {
              type: 'FeatureCollection',
              features: [projectData?.no_fly_zones_geojson],
            } as GeojsonType
          }
          layerOptions={{
            type: 'fill',
            paint: {
              'fill-color': '#9EA5AD',
              'fill-outline-color': '#484848',
              'fill-opacity': 0.8,
            },
          }}
        />
      )}

      {taskStatusObj &&
        tasksData &&
        tasksData?.map((task: Record<string, any>) => {
          return (
            <VectorLayer
              key={task?.id}
              map={map as Map}
              id={`tasks-layer-${task?.id}-${taskStatusObj?.[task?.id]}`}
              visibleOnMap={task?.id && taskStatusObj}
              geojson={task.outline as GeojsonType}
              interactions={['feature']}
              layerOptions={
                taskStatusObj?.[`${task?.id}`] === 'LOCKED_FOR_MAPPING'
                  ? {
                      type: 'fill',
                      paint: {
                        'fill-color': '#98BBC8',
                        'fill-outline-color': '#484848',
                        'fill-opacity': 0.8,
                      },
                    }
                  : taskStatusObj?.[`${task?.id}`] === 'REQUEST_FOR_MAPPING'
                    ? {
                        type: 'fill',
                        paint: {
                          'fill-color': '#F3C5C5',
                          'fill-outline-color': '#484848',
                          'fill-opacity': 0.7,
                        },
                      }
                    : taskStatusObj?.[`${task?.id}`] === 'UNLOCKED_TO_VALIDATE'
                      ? {
                          type: 'fill',
                          paint: {
                            'fill-color': '#176149',
                            'fill-outline-color': '#484848',
                            'fill-opacity': 0.5,
                          },
                        }
                      : {
                          type: 'fill',
                          paint: {
                            'fill-color': '#ffffff',
                            'fill-outline-color': '#484848',
                            'fill-opacity': 0.8,
                          },
                        }
              }
              hasImage={
                taskStatusObj?.[`${task?.id}`] === 'LOCKED_FOR_MAPPING' || false
              }
              image={lock}
            />
          );
        })}

      <AsyncPopup
        map={map as Map}
        popupUI={getPopupUI}
        title={`Task #${selectedTaskId}`}
        showPopup={(feature: Record<string, any>) =>
          feature?.source?.includes('tasks-layer')
        }
        fetchPopupData={(properties: Record<string, any>) => {
          dispatch(setProjectState({ selectedTaskId: properties.id }));
          setLockedUser({
            id: properties?.locked_user_id || '',
            name: properties?.locked_user_name || '',
          });
        }}
        hideButton={
          !(
            taskStatusObj?.[selectedTaskId] === 'UNLOCKED_TO_MAP' ||
            (taskStatusObj?.[selectedTaskId] === 'LOCKED_FOR_MAPPING' &&
              lockedUser?.id === userDetails?.id)
          )
        }
        buttonText={
          taskStatusObj?.[selectedTaskId] === 'UNLOCKED_TO_MAP'
            ? 'Lock Task'
            : 'Go To Task'
        }
        handleBtnClick={() =>
          taskStatusObj?.[selectedTaskId] === 'UNLOCKED_TO_MAP'
            ? handleTaskLockClick()
            : navigate(`/projects/${id}/tasks/${selectedTaskId}`)
        }
      />
      <Legend />
    </MapContainer>
  );
};

export default hasErrorBoundary(MapSection);
