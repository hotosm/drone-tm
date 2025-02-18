/* eslint-disable no-nested-ternary */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LngLatBoundsLike, Map, RasterSourceSpecification } from 'maplibre-gl';
import { FeatureCollection } from 'geojson';
import { toast } from 'react-toastify';
import { useGetTaskStatesQuery, useGetUserDetailsQuery } from '@Api/projects';
import lock from '@Assets/images/lock.png';
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import AsyncPopup from '@Components/common/MapLibreComponents/AsyncPopup';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import LocateUser from '@Components/common/MapLibreComponents/LocateUser';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import { postTaskStatus } from '@Services/project';
import { setProjectState } from '@Store/actions/project';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { useMutation } from '@tanstack/react-query';
import getBbox from '@turf/bbox';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import COGOrthophotoViewer from '@Components/common/MapLibreComponents/COGOrthophotoViewer';
import {
  getLayerOptionsByStatus,
  showPrimaryButton,
} from '@Constants/projectDescription';
import { Button } from '@Components/RadixComponents/Button';
import ToolTip from '@Components/RadixComponents/ToolTip';
import Legend from './Legend';
import ProjectPromptDialog from '../ModalContent';
import UnlockTaskPromptDialog from '../ModalContent/UnlockTaskPromptDialog';

const MapSection = ({ projectData }: { projectData: Record<string, any> }) => {
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
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);

  const [showOverallOrthophoto, setShowOverallOrthophoto] = useState(false);
  const { data: userDetails }: Record<string, any> = useGetUserDetailsQuery();

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
  const taskClickedOnTable = useTypedSelector(
    state => state.project.taskClickedOnTable,
  );
  const visibleTaskOrthophoto = useTypedSelector(
    state => state.project.visibleOrthophotoList,
  );

  const { data: taskStates } = useGetTaskStatesQuery(id as string, {
    enabled: !!tasksData,
  });
  const signedInAs = localStorage.getItem('signedInAs');

  const { mutate: lockTask } = useMutation<any, any, any, unknown>({
    mutationFn: postTaskStatus,
    onSuccess: (res: any) => {
      setTaskStatusObj({
        ...taskStatusObj,
        [res.data.task_id]:
          projectData?.requires_approval_from_manager_for_locking &&
          userDetails?.id !== projectData?.author_id
            ? 'REQUEST_FOR_MAPPING'
            : 'LOCKED_FOR_MAPPING',
      });
      if (
        projectData?.requires_approval_from_manager_for_locking &&
        userDetails?.id !== projectData?.author_id
      ) {
        toast.success('Task Requested for Mapping');
      } else {
        toast.success('Task Locked for Mapping');
        setLockedUser({ name: userDetails?.name, id: userDetails?.id });
      }
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || err?.message || '');
    },
  });

  const { mutate: unLockTask } = useMutation<any, any, any, unknown>({
    mutationFn: postTaskStatus,
    onSuccess: (res: any) => {
      setTaskStatusObj({
        ...taskStatusObj,
        [res.data.task_id]: 'UNLOCKED_TO_MAP',
      });
      toast.success('Task Unlocked Successfully');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || err?.message || '');
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
  const bbox = useMemo(() => {
    if (!tasksData) return null;
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
    return getBbox(tasksCollectiveGeojson as FeatureCollection);
  }, [tasksData]);

  useEffect(() => {
    if (!bbox) return;
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25, duration: 500 });
  }, [map, bbox]);

  // end zoom to layer

  const getPopupUI = useCallback(
    (properties: Record<string, any>) => {
      const status = taskStatusObj?.[properties?.id];
      const popupText = (taskStatus: string) => {
        if (projectData?.regulator_approval_status === 'PENDING')
          return `Unable to proceed, local regulator's approval is pending.`;
        if (projectData?.regulator_approval_status === 'REJECTED')
          return 'Unable to proceed, local regulators rejected the project';
        switch (taskStatus) {
          case 'UNLOCKED_TO_MAP':
            return 'This task is available for mapping';
          case 'REQUEST_FOR_MAPPING':
            return `This task is Requested for mapping ${properties.locked_user_name ? `by ${userDetails?.id === properties?.locked_user_id ? 'you' : properties?.locked_user_name}` : ''}`;
          case 'LOCKED_FOR_MAPPING':
            return `This task is locked for mapping ${properties.locked_user_name ? `by ${userDetails?.id === properties?.locked_user_id ? 'you' : properties?.locked_user_name}` : ''}`;
          case 'UNFLYABLE_TASK':
            return 'This task is not flyable';
          case 'IMAGE_UPLOADED':
            return `This task's Images has been uploaded ${properties.locked_user_name ? `by ${userDetails?.id === properties?.locked_user_id ? 'you' : properties?.locked_user_name}` : ''}`;
          case 'IMAGE_PROCESSING_STARTED':
            return `This task is started ${properties.locked_user_name ? `by ${userDetails?.id === properties?.locked_user_id ? 'you' : properties?.locked_user_name}` : ''}`;
          case 'IMAGE_PROCESSING_FINISHED':
            return `This task is completed ${properties.locked_user_name ? `by ${userDetails?.id === properties?.locked_user_id ? 'you' : properties?.locked_user_name}` : ''}`;
          case 'IMAGE_PROCESSING_FAILED':
            return `The image processing task started ${userDetails?.id === properties?.locked_user_id ? 'by you' : `by ${properties?.locked_user_name}`} has failed.`;
          default:
            return '';
        }
      };
      return <h6>{popupText(status)}</h6>;
    },
    [taskStatusObj, userDetails, projectData],
  );

  const projectOrthophotoSource: RasterSourceSpecification = useMemo(
    () => ({
      type: 'raster',
      url: `cog://${projectData?.orthophoto_url}`,
      tileSize: 256,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectData?.orthophoto_url, id],
  );

  const handleTaskLockClick = () => {
    lockTask({
      projectId: id,
      taskId: selectedTaskId,
      data: { event: 'request', updated_at: new Date().toISOString() },
    });
  };

  const handleTaskUnLockClick = () => {
    unLockTask({
      projectId: id,
      taskId: selectedTaskId,
      data: { event: 'unlock', updated_at: new Date().toISOString() },
    });
  };

  const handleToggleOverallOrthophoto = () => {
    map?.setLayoutProperty(
      'project-orthophoto',
      'visibility',
      showOverallOrthophoto ? 'none' : 'visible',
    );
    setShowOverallOrthophoto(!showOverallOrthophoto);
  };

  const handleZoomToExtent = () => {
    if (!bbox) return;
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25, duration: 500 });
  };

  return (
    <>
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
                layerOptions={getLayerOptionsByStatus(
                  taskStatusObj?.[`${task?.id}`],
                )}
                hasImage={
                  taskStatusObj?.[`${task?.id}`] === 'LOCKED_FOR_MAPPING' ||
                  false
                }
                image={lock}
              />
            );
          })}
        {/* visualize tasks orthophoto */}
        {visibleTaskOrthophoto?.map(orthophotoDetails => (
          <COGOrthophotoViewer
            key={orthophotoDetails.taskId}
            id={orthophotoDetails.taskId}
            source={orthophotoDetails.source}
            visibleOnMap
            zoomToLayer
          />
        ))}
        {/* visualize tasks orthophoto end */}
        {/* visualize overall project orthophoto */}
        {projectData?.orthophoto_url && (
          <COGOrthophotoViewer
            id="project-orthophoto"
            source={projectOrthophotoSource}
            visibleOnMap
            zoomToLayer
          />
        )}
        {/* visualize tasks orthophoto end */}
        {/* additional controls */}
        <div className="naxatw-absolute naxatw-left-[0.575rem] naxatw-top-[5.75rem] naxatw-z-30 naxatw-flex naxatw-h-fit naxatw-w-fit naxatw-flex-col naxatw-gap-3">
          <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
            {projectData?.orthophoto_url && (
              <Button
                variant="ghost"
                className={`naxatw-grid naxatw-h-[1.85rem] naxatw-place-items-center naxatw-border !naxatw-px-[0.315rem] ${showOverallOrthophoto ? 'naxatw-border-red naxatw-bg-[#ffe0e0]' : 'naxatw-border-gray-400 naxatw-bg-[#F5F5F5]'}`}
                onClick={() => handleToggleOverallOrthophoto()}
              >
                <ToolTip
                  name="visibility"
                  message="Show Orthophoto"
                  symbolType="material-icons"
                  iconClassName="!naxatw-text-xl !naxatw-text-black"
                  className="naxatw-mt-[-4px]"
                />
              </Button>
            )}
            <Button
              variant="ghost"
              className="naxatw-grid naxatw-h-[1.85rem] naxatw-place-items-center naxatw-border naxatw-border-gray-400 naxatw-bg-[#F5F5F5] !naxatw-px-[0.315rem]"
              onClick={() => handleZoomToExtent()}
            >
              <ToolTip
                name="zoom_out_map"
                message="Zoom to project area"
                symbolType="material-icons"
                iconClassName="!naxatw-text-xl !naxatw-text-black"
                className="naxatw-mt-[-4px]"
              />
            </Button>
          </div>
        </div>
        {/*  additional controls */}
        <AsyncPopup
          map={map as Map}
          popupUI={getPopupUI}
          title={`Task #${selectedTaskId}`}
          showPopup={(feature: Record<string, any>) => {
            if (!userDetails) return false;

            return (
              feature?.source?.includes('tasks-layer') &&
              !(
                (
                  (userDetails?.role?.length === 1 &&
                    userDetails?.role?.includes('REGULATOR')) ||
                  signedInAs === 'REGULATOR'
                ) // Don't show popup if user role is regulator any and no other roles
              )
            );
          }}
          fetchPopupData={(properties: Record<string, any>) => {
            dispatch(
              setProjectState({
                taskClickedOnTable: null,
              }),
            );
            dispatch(setProjectState({ selectedTaskId: properties.id }));
            setLockedUser({
              id: properties?.locked_user_id || userDetails?.id || '',
              name: properties?.locked_user_name || userDetails?.name || '',
            });
          }}
          hideButton={
            !showPrimaryButton(
              taskStatusObj?.[selectedTaskId],
              lockedUser?.id,
              userDetails?.id,
              projectData?.author_id,
            ) ||
            projectData?.regulator_approval_status === 'REJECTED' || // Don't task lock button if regulator rejected the approval
            projectData?.regulator_approval_status === 'PENDING'
          }
          buttonText={
            taskStatusObj?.[selectedTaskId] === 'UNLOCKED_TO_MAP' ||
            !taskStatusObj?.[selectedTaskId]
              ? 'Lock Task'
              : 'Go To Task'
          }
          handleBtnClick={() =>
            taskStatusObj?.[selectedTaskId] === 'UNLOCKED_TO_MAP'
              ? handleTaskLockClick()
              : navigate(`/projects/${id}/tasks/${selectedTaskId}`)
          }
          hasSecondaryButton={
            taskStatusObj?.[selectedTaskId] === 'LOCKED_FOR_MAPPING' &&
            (lockedUser?.id === userDetails?.id ||
              projectData?.author_id === userDetails?.id) // enable task unlock to the project author
          }
          secondaryButtonText="Unlock Task"
          handleSecondaryBtnClick={() => setShowUnlockDialog(true)}
          // trigger from popup outside
          openPopupFor={
            projectData?.regulator_approval_status === 'REJECTED' // ignore click if the regulator rejected the approval
              ? null
              : taskClickedOnTable
          }
          popupCoordinate={taskClickedOnTable?.centroidCoordinates}
          onClose={() =>
            dispatch(
              setProjectState({
                taskClickedOnTable: null,
              }),
            )
          }
        />
        <Legend />
      </MapContainer>

      <ProjectPromptDialog
        title="Task Unlock"
        show={showUnlockDialog}
        onClose={() => setShowUnlockDialog(false)}
      >
        <UnlockTaskPromptDialog
          handleUnlockTask={handleTaskUnLockClick}
          setShowUnlockDialog={setShowUnlockDialog}
        />
      </ProjectPromptDialog>
    </>
  );
};

export default hasErrorBoundary(MapSection);
