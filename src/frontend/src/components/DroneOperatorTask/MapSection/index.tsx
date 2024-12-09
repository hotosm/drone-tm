/* eslint-disable react/no-array-index-key */
import { useGetTaskAssetsInfo, useGetTaskWaypointQuery } from '@Api/tasks';
import marker from '@Assets/images/marker.png';
import right from '@Assets/images/rightArrow.png';
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import AsyncPopup from '@Components/common/MapLibreComponents/AsyncPopup';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import LocateUser from '@Components/common/MapLibreComponents/LocateUser';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import { Button } from '@Components/RadixComponents/Button';
import { postTaskWaypoint } from '@Services/tasks';
import { toggleModal } from '@Store/actions/common';
import {
  setSelectedTakeOffPoint,
  setSelectedTakeOffPointOption,
  setSelectedTaskDetailToViewOrthophoto,
} from '@Store/actions/droneOperatorTask';
import { useTypedSelector } from '@Store/hooks';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import getBbox from '@turf/bbox';
import { point } from '@turf/helpers';
import { coordAll } from '@turf/meta';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import { FeatureCollection } from 'geojson';
import {
  GeoJSONSource,
  LngLatBoundsLike,
  Map,
  RasterSourceSpecification,
} from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useParams } from 'react-router-dom';
import ToolTip from '@Components/RadixComponents/ToolTip';
import Skeleton from '@Components/RadixComponents/Skeleton';
import rotateGeoJSON from '@Utils/rotateGeojsonData';
import COGOrthophotoViewer from '@Components/common/MapLibreComponents/COGOrthophotoViewer';
import {
  calculateAngle,
  calculateCentroid,
  // calculateCentroidFromCoordinates,
} from '@Utils/index';
import { useGetProjectsDetailQuery } from '@Api/projects';
import { toast } from 'react-toastify';
import GetCoordinatesOnClick from './GetCoordinatesOnClick';
import ShowInfo from './ShowInfo';

const { COG_URL } = process.env;

const MapSection = ({ className }: { className?: string }) => {
  const dispatch = useDispatch();
  const [rotationDegree, setRotationDegree] = useState<number>(0);
  const bboxRef = useRef<number[]>();
  const mapRef = useRef<Map>();
  const rotatedTaskWayPointsRef = useRef<Record<string, any>>();
  const [taskWayPoints, setTaskWayPoints] = useState<Record<
    string,
    any
  > | null>();
  const draggingRef = useRef(false);
  const { projectId, taskId } = useParams();
  const centeroidRef = useRef<[number, number]>();
  const queryClient = useQueryClient();
  const [popupData, setPopupData] = useState<Record<string, any>>({});
  const [showOrthoPhotoLayer, setShowOrthoPhotoLayer] = useState(true);
  const [showTakeOffPoint, setShowTakeOffPoint] = useState(true);
  const [isRotationEnabled, setIsRotationEnabled] = useState(false);
  const { map, isMapLoaded } = useMapLibreGLMap({
    containerId: 'dashboard-map',
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });
  const newTakeOffPoint = useTypedSelector(
    state => state.droneOperatorTask.selectedTakeOffPoint,
  );

  useEffect(() => {
    if (!map || !isMapLoaded) return;
    mapRef.current = map;
  }, [map, isMapLoaded]);

  const {
    data: taskDataPolygon,
    // isFetching: isProjectDataFetching,
  }: Record<string, any> = useGetProjectsDetailQuery(projectId as string, {
    select: (projectRes: any) => {
      const taskPolygon = projectRes.data.tasks.find(
        (task: Record<string, any>) => task.id === taskId,
      );
      const { geometry } = taskPolygon.outline;
      return {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry,
            properties: {},
          },
        ],
      };
    },
  });
  const { data: taskWayPointsData }: any = useGetTaskWaypointQuery(
    projectId as string,
    taskId as string,
    {
      select: (data: any) => {
        const modifiedTaskWayPointsData = {
          geojsonListOfPoint: data.data,
          geojsonAsLineString: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  // get all coordinates
                  coordinates: coordAll(data.data),
                },
              },
            ],
          },
        };
        centeroidRef.current =
          modifiedTaskWayPointsData?.geojsonListOfPoint?.features[0]?.geometry?.coordinates;
        return modifiedTaskWayPointsData;
      },
    },
  );

  const { mutate: postWaypoint, isLoading: isUpdatingTakeOffPoint } =
    useMutation<any, any, any, unknown>({
      mutationFn: postTaskWaypoint,
      onSuccess: async data => {
        // update task cached waypoint data with response
        queryClient.setQueryData(['task-waypoints'], () => {
          return data;
        });
        dispatch(setSelectedTakeOffPoint(null));
        dispatch(setSelectedTakeOffPointOption('current_location'));
      },
      onError: (err: any) => {
        toast.error(err?.response?.data?.detail || err.message);
        dispatch(setSelectedTakeOffPoint(null));
      },
    });

  // zoom to task (waypoint)
  useEffect(() => {
    if (!taskWayPoints?.geojsonAsLineString || !isMapLoaded || !map) return;
    const { geojsonAsLineString } = taskWayPoints;
    let bbox = null;
    // calculate bbox with with updated take-off point
    if (newTakeOffPoint && newTakeOffPoint !== 'place_on_map') {
      const combinedFeatures: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          // @ts-ignore
          ...geojsonAsLineString.features,
          newTakeOffPoint,
        ],
      };
      bbox = getBbox(combinedFeatures);
    } else {
      bbox = getBbox(geojsonAsLineString as FeatureCollection);
    }
    bboxRef.current = bbox;
    if (!isRotationEnabled) {
      map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25, duration: 500 });
    }
  }, [map, taskWayPoints, newTakeOffPoint, isMapLoaded, isRotationEnabled]);

  const getPopupUI = useCallback(() => {
    return (
      <div>
        <center>
          <h3>{popupData?.index}</h3>
          <p>
            {popupData?.coordinates?.lat?.toFixed(8)},&nbsp;
            {popupData?.coordinates?.lng?.toFixed(8)}{' '}
          </p>
        </center>
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
          <p className="naxatw-text-base">Speed: {popupData?.speed} m/s</p>
          {popupData?.elevation && (
            <p className="naxatw-text-base">
              Elevation (Sea Level): {popupData?.elevation} meter{' '}
            </p>
          )}
          <p className="naxatw-text-base">
            Take Photo: {popupData?.take_photo ? 'True' : 'False'}
          </p>
          <p className="naxatw-text-base">
            Gimble angle: {popupData?.gimbal_angle} degree
          </p>
          {popupData?.altitude && (
            <p className="naxatw-text-base">
              Altitude: {popupData?.altitude} meter
            </p>
          )}
        </div>
      </div>
    );
  }, [popupData]);

  const handleSaveStartingPoint = () => {
    const { geometry } = newTakeOffPoint as Record<string, any>;
    const [lng, lat] = geometry.coordinates;
    postWaypoint({
      projectId,
      taskId,
      data: {
        longitude: lng,
        latitude: lat,
      },
    });
  };
  const orthophotoSource: RasterSourceSpecification = useMemo(
    () => ({
      type: 'raster',
      url: `cog://${COG_URL}/dtm-data/projects/${projectId}/${taskId}/orthophoto/odm_orthophoto.tif`,
      tileSize: 256,
    }),

    [projectId, taskId],
  );

  useEffect(
    () => () => {
      dispatch(setSelectedTaskDetailToViewOrthophoto(null));
      dispatch(setSelectedTakeOffPoint(null));
      dispatch(setSelectedTakeOffPointOption('current_location'));
    },
    [dispatch],
  );

  function handleOtrhophotoLayerView() {
    if (!map || !isMapLoaded) return;
    map.setLayoutProperty(
      'task-orthophoto',
      'visibility',
      `${!showOrthoPhotoLayer ? 'visible' : 'none'}`,
    );
    setShowOrthoPhotoLayer(!showOrthoPhotoLayer);
  }

  function handleTaskWayPoint() {
    if (!map || !isMapLoaded) return;
    map.setLayoutProperty(
      'waypoint-points-layer',
      'visibility',
      `${!showTakeOffPoint ? 'visible' : 'none'}`,
    );
    map.setLayoutProperty(
      'waypoint-points-image-layer',
      'visibility',
      `${!showTakeOffPoint ? 'visible' : 'none'}`,
    );
    map.setLayoutProperty(
      'waypoint-line-layer',
      'visibility',
      `${!showTakeOffPoint ? 'visible' : 'none'}`,
    );
    map.setLayoutProperty(
      'waypoint-points-image-image/logo',
      'visibility',
      `${!showTakeOffPoint ? 'visible' : 'none'}`,
    );
    map.setLayoutProperty(
      'waypoint-line-image/logo',
      'visibility',
      `${!showTakeOffPoint ? 'visible' : 'none'}`,
    );
    setShowTakeOffPoint(!showTakeOffPoint);
  }

  const rotateLayerGeoJSON = (
    layerIds: string[],
    rotationDegreeParam: number,
  ) => {
    if (!mapRef.current) return;

    layerIds.forEach(layerId => {
      const source = mapRef.current?.getSource(layerId);

      if (source && source instanceof GeoJSONSource) {
        // eslint-disable-next-line no-underscore-dangle
        const geojsonData = source._data;
        // @ts-ignore
        const rotatedGeoJSON = rotateGeoJSON(geojsonData, rotationDegreeParam);
        source.setData(rotatedGeoJSON);
      }
    });
  };

  const {
    data: taskAssetsInformation,
    isFetching: taskAssetsInfoLoading,
  }: Record<string, any> = useGetTaskAssetsInfo(
    projectId as string,
    taskId as string,
  );

  useEffect(() => {
    setTaskWayPoints(taskWayPointsData);
  }, [taskWayPointsData]);

  const rotatedTaskWayPoints = useMemo(() => {
    if (!taskWayPointsData) return null;
    return {
      geojsonListOfPoint: taskWayPointsData.geojsonListOfPoint,

      geojsonAsLineString: taskWayPointsData.geojsonAsLineString,
    };
  }, [taskWayPointsData]);

  useEffect(() => {
    if (!rotatedTaskWayPoints) return;
    rotatedTaskWayPointsRef.current = rotatedTaskWayPoints;
  }, [rotatedTaskWayPoints]);

  // function that handles drag and calculates rotation
  const handleDrag = useCallback((event: any) => {
    if (!draggingRef.current) {
      draggingRef.current = true;
    }
    const { originalCoordinates } = event;
    const centroidCoordinates = calculateCentroid(bboxRef.current || []);

    const calculatedAngleFromCoordinates = calculateAngle(
      [originalCoordinates[0], originalCoordinates[1]],
      [event.lngLat?.lng, event.lngLat?.lat],
      [centroidCoordinates.lng, centroidCoordinates.lat],
    );
    // Update rotation continuously while dragging
    setRotationDegree(calculatedAngleFromCoordinates);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getGeoJSONDataFromMap(sourceIds: string[]) {
    const geojsonData: Record<string, any> = {};

    if (!mapRef.current) return geojsonData;
    sourceIds.forEach(sourceId => {
      const source = mapRef.current?.getSource(sourceId);
      if (source && source instanceof GeoJSONSource) {
        // eslint-disable-next-line no-underscore-dangle
        geojsonData[sourceId] = source._data;
      }
    });

    return geojsonData;
  }

  // function to handle end of drag
  const handleDragEnd = useCallback(() => {
    const dataRetrieved = getGeoJSONDataFromMap([
      'rotated-waypoint-line',
      'rotated-waypoint-points',
      'rotated-waypoint-points-image',
    ]);
    const newTaskGeoJson = {
      geojsonAsLineString: dataRetrieved['rotated-waypoint-line'],
      geojsonListOfPoint: dataRetrieved['rotated-waypoint-points'],
    };
    setTaskWayPoints(newTaskGeoJson);
    if (draggingRef.current) {
      draggingRef.current = false; // Reset dragging state
    }
  }, []);

  function handleRotationToggle() {
    if (!map || !isMapLoaded) return;
    setIsRotationEnabled(!isRotationEnabled);
    if (!isRotationEnabled) {
      map.dragPan.disable();
    } else {
      map.dragPan.enable();
    }
  }

  // Call the function to update rotation for each layer
  rotateLayerGeoJSON(
    [
      'rotated-waypoint-line',
      'rotated-waypoint-points',
      'rotated-waypoint-points-image',
    ],
    rotationDegree,
  );

  return (
    <>
      <div
        className={`naxatw-h-[calc(100vh-180px)] naxatw-w-full naxatw-rounded-xl naxatw-bg-gray-200 ${className}`}
      >
        <MapContainer
          map={map}
          ref={mapRef}
          isMapLoaded={isMapLoaded}
          containerId="dashboard-map"
          style={{
            width: '100%',
            height: '100%',
          }}
        >
          <BaseLayerSwitcherUI />
          <LocateUser isMapLoaded={isMapLoaded} />

          {taskWayPoints && (
            <>
              {/* render line */}
              <VectorLayer
                map={map as Map}
                isMapLoaded={isMapLoaded}
                id="waypoint-line"
                geojson={taskWayPoints?.geojsonAsLineString as GeojsonType}
                visibleOnMap={!!taskWayPoints}
                layerOptions={{
                  type: 'line',
                  paint: {
                    'line-color': '#000000',
                    'line-width': 1,
                    'line-dasharray': [6, 3],
                  },
                }}
                hasImage
                image={right}
                symbolPlacement="line"
                iconAnchor="center"
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
                needDragEvent={isRotationEnabled}
              />
              {/* render points */}
              <VectorLayer
                map={map as Map}
                isMapLoaded={isMapLoaded}
                id="waypoint-points"
                geojson={taskWayPoints?.geojsonListOfPoint as GeojsonType}
                visibleOnMap={!!taskWayPoints}
                interactions={['feature']}
                layerOptions={{
                  type: 'circle',
                  paint: {
                    'circle-color': '#176149',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': 'red',
                    'circle-stroke-opacity': 1,
                    'circle-opacity': [
                      'match',
                      ['get', 'index'],
                      0,
                      0,
                      Number(
                        // @ts-ignore
                        // eslint-disable-next-line no-unsafe-optional-chaining
                        taskWayPoints?.geojsonListOfPoint?.features?.length - 1,
                      ),
                      0,
                      1,
                    ],
                  },
                }}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
                needDragEvent={isRotationEnabled}
              />
              {/* render image and only if index is 0 */}
              <VectorLayer
                map={map as Map}
                isMapLoaded={isMapLoaded}
                id="waypoint-points-image"
                geojson={taskWayPoints?.geojsonListOfPoint as GeojsonType}
                visibleOnMap={!!taskWayPoints}
                layerOptions={{}}
                hasImage
                image={marker}
                iconAnchor="bottom"
                imageLayerOptions={{
                  filter: ['==', 'index', 0],
                }}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
              />
            </>
          )}
          {isRotationEnabled && draggingRef.current && (
            <>
              {/* render line */}
              <VectorLayer
                map={map as Map}
                isMapLoaded={isMapLoaded}
                id="rotated-waypoint-line"
                geojson={
                  rotatedTaskWayPoints?.geojsonAsLineString as GeojsonType
                }
                visibleOnMap={!!taskWayPoints}
                layerOptions={{
                  type: 'line',
                  paint: {
                    'line-color': '#000000',
                    'line-width': 1,
                    'line-dasharray': [6, 3],
                  },
                }}
                hasImage
                image={right}
                symbolPlacement="line"
                iconAnchor="center"
              />
              {/* render points */}
              <VectorLayer
                map={map as Map}
                isMapLoaded={isMapLoaded}
                id="rotated-waypoint-points"
                geojson={
                  rotatedTaskWayPoints?.geojsonListOfPoint as GeojsonType
                }
                visibleOnMap={!!taskWayPoints}
                interactions={['feature']}
                layerOptions={{
                  type: 'circle',
                  paint: {
                    'circle-color': '#176149',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': 'red',
                    'circle-stroke-opacity': 1,
                    'circle-opacity': [
                      'match',
                      ['get', 'index'],
                      0,
                      0,
                      Number(
                        // @ts-ignore
                        // eslint-disable-next-line no-unsafe-optional-chaining
                        rotatedTaskWayPoints?.geojsonListOfPoint?.features
                          ?.length - 1,
                      ),
                      0,
                      1,
                    ],
                  },
                }}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
              />
              {/* render image and only if index is 0 */}
              <VectorLayer
                map={map as Map}
                isMapLoaded={isMapLoaded}
                id="rotated-waypoint-points-image"
                geojson={
                  rotatedTaskWayPoints?.geojsonListOfPoint as GeojsonType
                }
                visibleOnMap={!!taskWayPoints}
                layerOptions={{}}
                hasImage
                image={marker}
                iconAnchor="bottom"
                imageLayerOptions={{
                  filter: ['==', 'index', 0],
                }}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
              />
            </>
          )}

          <VectorLayer
            map={map as Map}
            id="task-polygon"
            visibleOnMap={taskDataPolygon}
            geojson={taskDataPolygon as GeojsonType}
            interactions={['feature']}
            layerOptions={{
              type: 'fill',
              paint: {
                'fill-color': '#98BBC8',
                'fill-outline-color': '#484848',
                'fill-opacity': 0.6,
              },
            }}
            // layerOptions={getLayerOptionsByStatus(
            //   taskStatusObj?.[`${task?.id}`],
            // )}
            // hasImage={
            //   taskStatusObj?.[`${task?.id}`] === 'LOCKED_FOR_MAPPING' || false
            // }
            // image={lock}
          />
          <div className="naxatw-absolute naxatw-bottom-3 naxatw-right-[calc(50%-5.4rem)] naxatw-z-30 naxatw-h-fit lg:naxatw-right-3 lg:naxatw-top-3">
            <Button
              withLoader
              leftIcon="place"
              className="naxatw-w-[11.8rem] naxatw-bg-red"
              onClick={() => {
                if (newTakeOffPoint) {
                  handleSaveStartingPoint();
                } else {
                  dispatch(toggleModal('update-flight-take-off-point'));
                }
              }}
              isLoading={isUpdatingTakeOffPoint}
            >
              {newTakeOffPoint
                ? 'Save Take off Point'
                : 'Change Take off Point'}
            </Button>
          </div>
          <div className="naxatw-absolute naxatw-left-[0.575rem] naxatw-top-[5.75rem] naxatw-z-30 naxatw-h-fit">
            <Button
              variant="ghost"
              className={`naxatw-grid naxatw-h-[1.85rem] naxatw-place-items-center naxatw-border naxatw-bg-[#F5F5F5] !naxatw-px-[0.315rem] ${isRotationEnabled ? 'naxatw-border-red' : 'naxatw-border-gray-400'}`}
              onClick={() => handleRotationToggle()}
            >
              <ToolTip
                name="rotate_90_degrees_cw"
                message="Enable Rotation"
                symbolType="material-icons"
                iconClassName="!naxatw-text-xl !naxatw-text-black"
                className="naxatw-mt-[-4px]"
              />
            </Button>
          </div>

          <div className="naxatw-absolute naxatw-left-[0.575rem] naxatw-top-[8.25rem] naxatw-z-30 naxatw-h-fit">
            <Button
              variant="ghost"
              className={`naxatw-grid naxatw-h-[1.85rem] naxatw-place-items-center naxatw-border naxatw-bg-[#F5F5F5] ${showTakeOffPoint ? 'naxatw-border-red' : 'naxatw-border-gray-400'} !naxatw-px-[0.315rem]`}
              onClick={() => handleTaskWayPoint()}
            >
              <ToolTip
                name="flight_take_off"
                message="Show Flight Plan"
                symbolType="material-icons"
                iconClassName="!naxatw-text-xl !naxatw-text-black naxatw-w-[1.25rem]"
                className="naxatw-mt-[-4px]"
              />
            </Button>
          </div>

          {taskAssetsInfoLoading ? (
            <Skeleton className="naxatw-h-[0.5rem] naxatw-w-[0.5rem] naxatw-rounded-sm" />
          ) : (
            taskAssetsInformation?.assets_url && (
              <div className="naxatw-absolute naxatw-left-[0.575rem] naxatw-top-[10.75rem] naxatw-z-30 naxatw-h-fit">
                <Button
                  variant="ghost"
                  className={`naxatw-grid naxatw-h-[1.85rem] naxatw-place-items-center naxatw-border naxatw-bg-[#F5F5F5] !naxatw-px-[0.315rem] ${showOrthoPhotoLayer ? 'naxatw-border-red' : 'naxatw-border-gray-400'}`}
                  onClick={() => handleOtrhophotoLayerView()}
                >
                  <ToolTip
                    name="visibility"
                    message="Show Orthophoto"
                    symbolType="material-icons"
                    iconClassName="!naxatw-text-xl !naxatw-text-black"
                    className="naxatw-mt-[-4px]"
                  />
                </Button>
              </div>
            )
          )}
          <div className="naxatw-absolute naxatw-bottom-3 naxatw-right-[calc(50%-5.4rem)] naxatw-z-30 naxatw-h-fit lg:naxatw-right-3 lg:naxatw-top-3">
            <Button
              withLoader
              leftIcon="place"
              className="naxatw-w-[11.8rem] naxatw-bg-red"
              onClick={() => {
                if (newTakeOffPoint) {
                  handleSaveStartingPoint();
                } else {
                  dispatch(toggleModal('update-flight-take-off-point'));
                }
              }}
              isLoading={isUpdatingTakeOffPoint}
            >
              {newTakeOffPoint
                ? 'Save Take off Point'
                : 'Change Take off Point'}
            </Button>
          </div>

          {newTakeOffPoint && (
            <VectorLayer
              map={map as Map}
              isMapLoaded={isMapLoaded}
              id="newtakeOffPoint"
              geojson={newTakeOffPoint as GeojsonType}
              visibleOnMap
              layerOptions={{}}
              hasImage
              image={marker}
              iconAnchor="bottom"
            />
          )}

          {taskAssetsInformation?.assets_url && (
            <COGOrthophotoViewer
              id="task-orthophoto"
              source={orthophotoSource}
              visibleOnMap
              zoomToLayer
            />
          )}

          {newTakeOffPoint === 'place_on_map' && (
            <GetCoordinatesOnClick
              getCoordinates={(coordinates: Record<string, any>) =>
                dispatch(
                  setSelectedTakeOffPoint(
                    point([coordinates.lng, coordinates?.lat]),
                  ),
                )
              }
            />
          )}

          {newTakeOffPoint === 'place_on_map' && (
            <ShowInfo
              heading="Choose starting point"
              message="Click on map to update starting point and press save starting point button."
            />
          )}

          <AsyncPopup
            map={map as Map}
            showPopup={(feature: Record<string, any>) =>
              feature?.source === 'waypoint-points' ||
              feature?.source === 'waypoint-points-image'
            }
            popupUI={getPopupUI}
            fetchPopupData={(properties: Record<string, any>) => {
              setPopupData(properties);
            }}
            hideButton
            getCoordOnProperties
          />
        </MapContainer>
      </div>
    </>
  );
};

export default hasErrorBoundary(MapSection);
