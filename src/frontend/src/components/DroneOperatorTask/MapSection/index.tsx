/* eslint-disable no-param-reassign */
/* eslint-disable no-underscore-dangle */
/* eslint-disable prefer-destructuring */
/* eslint-disable react/no-array-index-key */
import {
  useGetIndividualTaskQuery,
  // useGetTaskAssetsInfo,
  useGetTaskWaypointQuery,
} from '@Api/tasks';
import marker from '@Assets/images/marker.png';
import right from '@Assets/images/rightArrow.png';
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import LocateUser from '@Components/common/MapLibreComponents/LocateUser';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import { Button } from '@Components/RadixComponents/Button';
import { postRotatedTaskWayPoint, postTaskWaypoint } from '@Services/tasks';
import AsyncPopup from '@Components/common/MapLibreComponents/NewAsyncPopup';
import { toggleModal } from '@Store/actions/common';
import {
  setSelectedTakeOffPoint,
  setSelectedTakeOffPointOption,
  setSelectedTaskDetailToViewOrthophoto,
  setWaypointMode,
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
// import Skeleton from '@Components/RadixComponents/Skeleton';
import rotateGeoJSON from '@Utils/rotateGeojsonData';
import COGOrthophotoViewer from '@Components/common/MapLibreComponents/COGOrthophotoViewer';
import { toast } from 'react-toastify';
import { FlexColumn } from '@Components/common/Layouts';
import RotatingCircle from '@Components/common/RotationCue';
import { mapLayerIDs } from '@Constants/droneOperator';
import SwitchTab from '@Components/common/SwitchTab';
import { findNearestCoordinate, swapFirstAndLast } from '@Utils/index';
import { waypointModeOptions } from '@Constants/taskDescription';
import GetCoordinatesOnClick from './GetCoordinatesOnClick';
import ShowInfo from './ShowInfo';

const { COG_URL } = process.env;

const MapSection = ({ className }: { className?: string }) => {
  const dispatch = useDispatch();
  const bboxRef = useRef<number[]>();
  const [taskWayPoints, setTaskWayPoints] = useState<Record<
    string,
    any
  > | null>();
  const { projectId, taskId } = useParams();
  const takeOffPointRef = useRef<[number, number]>();
  const queryClient = useQueryClient();
  const [popupData, setPopupData] = useState<Record<string, any>>({});
  const [showOrthoPhotoLayer, setShowOrthoPhotoLayer] = useState(true);
  const [showTakeOffPoint, setShowTakeOffPoint] = useState(true);
  const [isRotationEnabled, setIsRotationEnabled] = useState(false);
  const [rotationAngle, setRotationAngle] = useState(0);
  const [dragging, setDragging] = useState(false);
  const centroidRef = useRef();
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
  const waypointMode = useTypedSelector(
    state => state.droneOperatorTask.waypointMode,
  );
  const taskAssetsInformation = useTypedSelector(
    state => state.droneOperatorTask.taskAssetsInformation,
  );

  function setVisibilityOfLayers(layerIds: string[], visibility: string) {
    layerIds.forEach(layerId => {
      map?.setLayoutProperty(layerId, 'visibility', visibility);
    });
  }

  const {
    data: taskDataPolygon,
    isFetching: taskDataPolygonIsFetching,
  }: Record<string, any> = useGetIndividualTaskQuery(taskId as string, {
    select: (projectRes: any) => {
      const taskPolygon = projectRes.data;
      centroidRef.current = taskPolygon.centroid.coordinates;
      const { geometry } = taskPolygon.outline;
      return {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: geometry.coordinates,
            },
            properties: {},
          },
        ],
      };
    },
    onSuccess: () => {
      if (map) {
        const layers = map.getStyle().layers;
        if (layers && layers.length > 0) {
          const firstLayerId = layers[4].id; // Get the first layer
          map.moveLayer('task-polygon-layer', firstLayerId); // Move the layer before the first layer
        }
      }
    },
  });
  const { data: taskWayPointsData }: any = useGetTaskWaypointQuery(
    projectId as string,
    taskId as string,
    waypointMode as string,
    {
      select: ({ data }: any) => {
        const modifiedTaskWayPointsData = {
          geojsonListOfPoint: data.results,
          geojsonAsLineString: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  // get all coordinates
                  coordinates: coordAll(data.results),
                },
              },
            ],
          },
        };
        takeOffPointRef.current =
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
    let bbox = null;
    // calculate bbox with with updated take-off point
    if (newTakeOffPoint && newTakeOffPoint !== 'place_on_map') {
      const combinedFeatures: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          // @ts-ignore
          ...taskDataPolygon.features,
          newTakeOffPoint,
        ],
      };
      bbox = getBbox(combinedFeatures);
    } else {
      bbox = getBbox(taskDataPolygon as FeatureCollection);
    }
    bboxRef.current = bbox;
    if (!isRotationEnabled) {
      map?.fitBounds(bbox as LngLatBoundsLike, { padding: 105, duration: 500 });
    }
  }, [
    map,
    taskWayPoints,
    taskDataPolygon,
    newTakeOffPoint,
    isMapLoaded,
    isRotationEnabled,
  ]);

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
          <p className="naxatw-text-base">Heading: {popupData?.heading}</p>
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
    const { geometry: startingPonyGeometry } = newTakeOffPoint as Record<
      string,
      any
    >;
    const [lng, lat] = startingPonyGeometry.coordinates;
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
    setVisibilityOfLayers(
      mapLayerIDs,
      `${!showTakeOffPoint ? 'visible' : 'none'}`,
    );
    setShowTakeOffPoint(!showTakeOffPoint);
  }

  const rotateLayerGeoJSON = (
    layerIds: string[],
    rotationDegreeParam: number,
    baseLayerIds: string[],
    excludeFirstFeature?: boolean,
  ) => {
    if (!map || !isMapLoaded) return;

    baseLayerIds.forEach((baseLayerId, index) => {
      const source = map?.getSource(baseLayerId);
      const sourceToRotate = map?.getSource(layerIds[index]);

      if (source && source instanceof GeoJSONSource) {
        const baseGeoData = source._data;
        if (!baseGeoData) return;
        const [firstFeature, ...restFeatures] = (
          baseGeoData as Record<string, any>
        ).features;
        if (firstFeature.geometry.type === 'Point') {
          const pointRotatedGeoJson = rotateGeoJSON(
            // @ts-ignore
            {
              ...(baseGeoData as object),
              features: excludeFirstFeature
                ? restFeatures
                : [firstFeature, ...restFeatures],
            },
            rotationDegreeParam,
            centroidRef.current,
          );
          if (sourceToRotate && sourceToRotate instanceof GeoJSONSource) {
            // @ts-ignore
            sourceToRotate.setData(pointRotatedGeoJson);
          }
        }
        if (firstFeature.geometry.type === 'LineString') {
          const [firstCoordinate, ...restCoordinates] =
            firstFeature.geometry.coordinates;
          const rotatedGeoJson = rotateGeoJSON(
            {
              features: [
                // @ts-ignore
                {
                  type: 'Feature',
                  geometry: {
                    type: 'LineString',
                    coordinates: excludeFirstFeature
                      ? restCoordinates
                      : [firstCoordinate, ...restCoordinates],
                  },
                },
              ],
              type: 'FeatureCollection',
            },
            rotationDegreeParam,
            centroidRef.current,
          );
          if (sourceToRotate && sourceToRotate instanceof GeoJSONSource) {
            // @ts-ignore
            sourceToRotate.setData(rotatedGeoJson);
          }
        }
      }
    });
  };

  // const {
  //   data: taskAssetsInformation,
  //   isFetching: taskAssetsInfoLoading,
  // }: Record<string, any> = useGetTaskAssetsInfo(
  //   projectId as string,
  //   taskId as string,
  // );

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

  function updateLayerCoordinates(
    layerIds: Record<string, any>[],
    coordinate: [number, number],
  ) {
    // Iterate over the array of layer IDs
    if (!map || !isMapLoaded) return;
    layerIds.forEach(layerId => {
      // Check if the layer is of type 'symbol' (or any other type)
      const source = map.getSource(layerId.id); // Get the source of the layer

      // Update the feature on the map

      if (source && source instanceof GeoJSONSource) {
        const geoJsonData = source._data;
        // @ts-ignore
        const { features, ...restGeoData } = geoJsonData;
        const coordinates = features[0].geometry.coordinates;
        if (layerId.type === 'MultiString') {
          const nearestCoordinate = findNearestCoordinate(
            coordinates[0],
            coordinates[coordinates.length - 1],
            takeOffPointRef.current || [0, 0],
          );
          let indexToReplace = 0;
          if (nearestCoordinate === 'second') {
            indexToReplace = coordinates.length;
          }
          features[0].geometry.coordinates[indexToReplace] = coordinate;
          const updatedLineStringData = features[0].geometry.coordinates;
          if (indexToReplace !== 0) {
            updatedLineStringData.reverse().pop();
          }
          source.setData({ features, ...restGeoData });
        }
        if (layerId.type === 'Points') {
          const nearestPoint = findNearestCoordinate(
            coordinates,
            features[features.length - 1].geometry.coordinates,
            takeOffPointRef.current || [0, 0],
          );
          let pointIndexToReplace = 0;
          if (nearestPoint === 'second') {
            pointIndexToReplace = features.length;
          }
          if (pointIndexToReplace !== 0) {
            features.push({
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [],
              },
              properties: {},
            });
          }
          features[pointIndexToReplace].geometry.coordinates = coordinate;
          const rotatedFeatures = features;
          if (pointIndexToReplace !== 0) {
            swapFirstAndLast(rotatedFeatures);
            features.pop();
          }
          source.setData({ features, ...restGeoData });
        }
      }
    });
  }

  useEffect(() => {
    if (!dragging) {
      rotateLayerGeoJSON(
        ['waypoint-line', 'waypoint-points'],
        rotationAngle,
        ['waypoint-line', 'waypoint-points'],
        false,
      );
      updateLayerCoordinates(
        [
          { id: 'waypoint-line', type: 'MultiString' },
          { id: 'waypoint-points', type: 'Points' },
        ],
        takeOffPointRef.current || [0, 0],
      );

      return;
    }
    rotateLayerGeoJSON(
      ['rotated-waypoint-line', 'rotated-waypoint-points'],
      rotationAngle,
      ['waypoint-line', 'waypoint-points'],
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationAngle, dragging]);

  function handleRotationToggle() {
    if (!map || !isMapLoaded) return;
    setIsRotationEnabled(!isRotationEnabled);
  }
  useEffect(() => {
    if (!map || !isMapLoaded) return;

    if (!dragging) {
      setVisibilityOfLayers(mapLayerIDs, 'visible');
      return;
    }
    setVisibilityOfLayers(mapLayerIDs, 'none');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, isMapLoaded, map]);

  const { mutate: postRotatedFlightPlan, isLoading: flighplanIsUpdating } =
    useMutation({
      mutationFn: postRotatedTaskWayPoint,
      onSuccess: () => {
        toast.success('Flight plan rotated successfully');
        queryClient.invalidateQueries(['task-waypoints']);
      },
      onError: (err: any) => {
        toast.error(err?.response?.data?.detail || err.message);
      },
    });

  function handeSaveRotatedFlightPlan() {
    if (!map || !isMapLoaded) return;
    const pointsSource = map.getSource('waypoint-points');

    if (pointsSource && pointsSource instanceof GeoJSONSource) {
      const pointsData = pointsSource?._data;
      postRotatedFlightPlan({
        taskId,
        data: JSON.stringify(pointsData),
      });
    }
  }

  return (
    <>
      <div
        className={`naxatw-relative naxatw-h-[calc(100vh-180px)] naxatw-w-full naxatw-rounded-xl naxatw-bg-gray-200 ${className}`}
      >
        <MapContainer
          map={map}
          isMapLoaded={isMapLoaded}
          containerId="dashboard-map"
          style={{
            width: '100%',
            height: '100%',
          }}
        >
          <BaseLayerSwitcherUI />
          <LocateUser isMapLoaded={isMapLoaded} />

          {taskWayPoints && !taskDataPolygonIsFetching && (
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
              />
            </>
          )}
          {isRotationEnabled && dragging && (
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
              />
            </>
          )}

          {isRotationEnabled && (
            <div className="naxatw-absolute naxatw-bottom-3 naxatw-right-[calc(50%-5.4rem)] naxatw-z-50 naxatw-h-fit naxatw-cursor-pointer lg:naxatw-right-3 lg:naxatw-top-3">
              <Button
                withLoader
                leftIcon="save"
                className="naxatw-w-[10.8rem] naxatw-bg-red"
                isLoading={flighplanIsUpdating}
                disabled={rotationAngle === 0}
                onClick={() => handeSaveRotatedFlightPlan()}
              >
                <FlexColumn className="naxatw-gap-1">
                  <p className="naxatw-leading-3 naxatw-tracking-wide">
                    Save Rotated Flight Plan
                  </p>
                  {/* <p className="naxatw-font-normal naxatw-leading-3">
                  Rotated: {rotationAngle.toFixed(2)}°
                </p> */}
                </FlexColumn>
              </Button>
            </div>
          )}
          <div className="naxatw-absolute naxatw-left-[0.575rem] naxatw-top-[5.75rem] naxatw-z-30 naxatw-h-fit">
            <Button
              variant="ghost"
              className={`naxatw-grid naxatw-h-[1.85rem] naxatw-place-items-center naxatw-border !naxatw-px-[0.315rem] ${isRotationEnabled ? 'naxatw-border-red naxatw-bg-[#ffe0e0]' : 'naxatw-border-gray-400 naxatw-bg-[#F5F5F5]'}`}
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

          <div className="naxatw-absolute naxatw-left-[0.575rem] naxatw-top-[8.25rem] naxatw-z-30 naxatw-h-fit naxatw-overflow-hidden naxatw-pb-1 naxatw-pr-1">
            <Button
              variant="ghost"
              className={`naxatw-grid naxatw-h-[1.85rem] naxatw-place-items-center naxatw-border !naxatw-px-[0.315rem] ${showTakeOffPoint ? 'naxatw-border-red naxatw-bg-[#ffe0e0]' : 'naxatw-border-gray-400 naxatw-bg-[#F5F5F5]'}`}
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

          {taskAssetsInformation?.assets_url && (
            <div className="naxatw-absolute naxatw-left-[0.575rem] naxatw-top-[10.75rem] naxatw-z-30 naxatw-h-fit">
              <Button
                variant="ghost"
                className={`naxatw-grid naxatw-h-[1.85rem] naxatw-place-items-center naxatw-border !naxatw-px-[0.315rem] ${showOrthoPhotoLayer ? 'naxatw-border-red naxatw-bg-[#ffe0e0]' : 'naxatw-border-gray-400 naxatw-bg-[#F5F5F5]'}`}
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
          )}
          {!isRotationEnabled && (
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
          )}

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
          {isRotationEnabled && (
            <div className="naxatw-absolute naxatw-bottom-10 naxatw-right-[calc(50%-5.4rem)] naxatw-z-30 lg:naxatw-right-2 lg:naxatw-top-10">
              <RotatingCircle
                setRotation={setRotationAngle}
                rotation={rotationAngle}
                dragging={dragging}
                setDragging={setDragging}
              />
            </div>
          )}

          {taskAssetsInformation?.assets_url && (
            <COGOrthophotoViewer
              id="task-orthophoto"
              source={orthophotoSource}
              visibleOnMap
              zoomToLayer
            />
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
          />

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

          <div className="naxatw-absolute naxatw-right-3 naxatw-top-3 naxatw-z-10 lg:naxatw-right-64">
            <SwitchTab
              activeClassName="naxatw-bg-red naxatw-text-white"
              options={waypointModeOptions}
              labelKey="label"
              valueKey="value"
              selectedValue={waypointMode}
              onChange={(value: Record<string, any>) => {
                dispatch(setWaypointMode(value.value));
              }}
            />
          </div>
        </MapContainer>
      </div>
    </>
  );
};

export default hasErrorBoundary(MapSection);
