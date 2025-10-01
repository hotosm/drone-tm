/* eslint-disable no-underscore-dangle */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useParams } from 'react-router-dom';
import { FeatureCollection } from 'geojson';
import { toast } from 'react-toastify';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GeoJSONSource,
  LngLatBoundsLike,
  Map,
  RasterSourceSpecification,
} from 'maplibre-gl';
import getBbox from '@turf/bbox';
import { point } from '@turf/helpers';
import { coordAll } from '@turf/meta';
import { useTypedSelector } from '@Store/hooks';
import {
  useGetIndividualTaskQuery,
  useGetTaskAssetsInfo,
  useGetTaskWaypointQuery,
} from '@Api/tasks';
import { postTaskWaypoint } from '@Services/tasks';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { waypointModeOptions, droneModelOptions, gimbalAngleOptions } from '@Constants/taskDescription';
import {
  setRotationAngle as setFinalRotationAngle,
  setRotatedFlightPlan,
  setSelectedTakeOffPoint,
  setSelectedTakeOffPointOption,
  setTaskAreaPolygon,
  setTaskAssetsInformation,
  setWaypointMode,
  setDroneModel,
  setGimbalAngle,
} from '@Store/actions/droneOperatorTask';
import rotateGeoJSON from '@Utils/rotateGeojsonData';
import { findNearestCoordinate, swapFirstAndLast } from '@Utils/index';
import RotatingCircle from '@Components/common/RotationCue';
import marker from '@Assets/images/marker.png';
import right from '@Assets/images/rightArrow.png';
import areaIcon from '@Assets/images/area-icon.png';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import { toggleModal } from '@Store/actions/common';
import { mapLayerIDs } from '@Constants/droneOperator';
import { Button } from '@Components/RadixComponents/Button';
import AsyncPopup from '@Components/common/MapLibreComponents/NewAsyncPopup';
import SwitchTab from '@Components/common/SwitchTab';
import ToolTip from '@Components/RadixComponents/ToolTip';
import LocateUser from '@Components/common/MapLibreComponents/LocateUser';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import COGOrthophotoViewer from '@Components/common/MapLibreComponents/COGOrthophotoViewer';
import GetCoordinatesOnClick from './GetCoordinatesOnClick';
import ShowInfo from './ShowInfo';

const { COG_URL } = process.env;

const MapSection = ({ className }: { className?: string }) => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const { projectId, taskId } = useParams();
  const [popupData, setPopupData] = useState<Record<string, any>>({});
  const [showFlightPlan, setShowFlightPlan] = useState(true);
  const [showTaskArea, setShowTaskArea] = useState(true);
  const [showOrthophoto, setShowOrthophoto] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [isRotationEnabled, setIsRotationEnabled] = useState(false);
  const [rotationAngle, setRotationAngle] = useState(0);
  const [initialWaypointData, setInitialWaypointData] = useState<Record<
    string,
    any
  > | null>();

  const centroidRef = useRef<[number, number]>(null);
  const takeOffPointRef = useRef<[number, number]>(null);

  const waypointMode = useTypedSelector(
    state => state.droneOperatorTask.waypointMode,
  );
  const droneModel = useTypedSelector(
    state => state.droneOperatorTask.droneModel,
  );
  const gimbalAngle = useTypedSelector(
    state => state.droneOperatorTask.gimbalAngle,
  );
  const newTakeOffPoint = useTypedSelector(
    state => state.droneOperatorTask.selectedTakeOffPoint,
  );
  // const taskAssetsInformation = useTypedSelector(
  //   state => state.droneOperatorTask.taskAssetsInformation,
  // );
  const rotatedFlightPlanData = useTypedSelector(
    state => state.droneOperatorTask.rotatedFlightPlan,
  );
  const finalRotationAngle = useTypedSelector(
    state => state.droneOperatorTask.rotationAngle,
  );

  const { map, isMapLoaded }: any = useMapLibreGLMap({
    containerId: 'dashboard-map',
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  const orthophotoSource: RasterSourceSpecification = useMemo(
    () => ({
      type: 'raster',
      url: `cog://${COG_URL}/dtm-data/projects/${projectId}/${taskId}/orthophoto/odm_orthophoto.tif`,
      tileSize: 256,
    }),
    [projectId, taskId],
  );

  const { data: taskWayPointsData, isLoading: taskWayPointsLoading }: any =
    useGetTaskWaypointQuery(
      projectId as string,
      taskId as string,
      waypointMode as string,
      droneModel as string,
      finalRotationAngle,
      gimbalAngle as string,
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

  const {
    data: taskAssetsInformation,
    // isFetching: taskAssetsInfoLoading,
  }: Record<string, any> = useGetTaskAssetsInfo(
    projectId as string,
    taskId as string,
  );

  const { mutate: postWaypoint, isPending: isUpdatingTakeOffPoint } =
    useMutation<any, any, any, unknown>({
      mutationFn: postTaskWaypoint,
      onSuccess: async () => {
        queryClient.invalidateQueries({ queryKey: ['task-waypoints'] });
        dispatch(setSelectedTakeOffPoint(null));
        dispatch(setSelectedTakeOffPointOption('current_location'));
      },
      onError: (err: any) => {
        toast.error(err?.response?.data?.detail || err.message);
        dispatch(setSelectedTakeOffPoint(null));
      },
    });

  const {
    data: taskDataPolygon,
    isFetching: taskDataPolygonIsFetching,
  }: Record<string, any> = useGetIndividualTaskQuery(taskId as string, {
    select: (projectRes: any) => {
      const taskPolygon = projectRes.data;
      const { geometry } = taskPolygon.outline;
      const taskAreaPolygon = {
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
      dispatch(setTaskAreaPolygon(taskAreaPolygon));
      return taskAreaPolygon;
    },
  });

  useEffect(() => {
    if (taskDataPolygon && map) {
      const layers = map.getStyle()?.layers;
      if (layers && layers.length > 0) {
        const firstLayerId = layers[4]?.id; // Get the first layer
        if (firstLayerId) {
          map.moveLayer('task-polygon-layer', firstLayerId); // Move the layer before the first layer
        }
      }
    }
  }, [taskDataPolygon, map]);

  useEffect(() => {
    if (!map || !isMapLoaded || (!taskWayPointsData && !taskDataPolygon))
      return;

    if (taskWayPointsData) {
      const bbox = getBbox(
        taskWayPointsData.geojsonAsLineString as FeatureCollection,
      ) as LngLatBoundsLike;
      map?.fitBounds(bbox as LngLatBoundsLike, {
        padding: 105,
        duration: 500,
      });
      return;
    }
    if (taskDataPolygon) {
      const bbox = getBbox(
        taskDataPolygon as FeatureCollection,
      ) as LngLatBoundsLike;
      map?.fitBounds(bbox as LngLatBoundsLike, {
        padding: 105,
        duration: 500,
      });
    }
  }, [map, isMapLoaded, taskWayPointsData, taskDataPolygon]);

  // rotation***start**************************
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
        // eslint-disable-next-line prefer-destructuring
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
    if (rotationAngle === finalRotationAngle) return;

    if (!dragging) {
      rotateLayerGeoJSON(
        ['waypoint-line', 'waypoint-points'],
        rotationAngle - finalRotationAngle,
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
      rotationAngle - finalRotationAngle,
      ['waypoint-line', 'waypoint-points'],
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationAngle, dragging]);

  useEffect(() => {
    if (!taskWayPointsData || initialWaypointData) return;
    setInitialWaypointData(taskWayPointsData);
  }, [initialWaypointData, taskWayPointsData]);

  // to set bulk of ids (waypoint, way line and arrow symbols )
  function setVisibilityOfLayers(layerIds: string[], visibility: string) {
    layerIds.forEach(layerId => {
      map?.setLayoutProperty(layerId, 'visibility', visibility);
    });
  }

  useEffect(() => {
    if (!map || !isMapLoaded) return;

    if (!dragging) {
      setVisibilityOfLayers(mapLayerIDs, 'visible');
      if (rotationAngle !== finalRotationAngle)
        dispatch(setFinalRotationAngle(rotationAngle));
      return;
    }
    setVisibilityOfLayers(mapLayerIDs, 'none');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, isMapLoaded, map]);

  useEffect(() => {
    if (!taskWayPointsData) return;
    dispatch(
      setRotatedFlightPlan({
        geojsonListOfPoint: taskWayPointsData.geojsonListOfPoint,
        geojsonAsLineString: taskWayPointsData.geojsonAsLineString,
      }),
    );
  }, [taskWayPointsData, dispatch]);

  // *********rotation end *******************

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

  // toggle layers

  function handleRotationToggle() {
    if (!map || !isMapLoaded) return;
    setIsRotationEnabled(!isRotationEnabled);
  }

  const handleToggleFlightPlan = () => {
    if (!map || !isMapLoaded) return;
    setVisibilityOfLayers(
      mapLayerIDs,
      `${!showFlightPlan ? 'visible' : 'none'}`,
    );
    setShowFlightPlan(!showFlightPlan);
  };

  const handleToggleTaskArea = () => {
    map?.setLayoutProperty(
      'task-polygon-layer',
      'visibility',
      showTaskArea ? 'none' : 'visible',
    );
    setShowTaskArea(!showTaskArea);

    if (taskDataPolygon && !showTaskArea && map) {
      const bbox = getBbox(
        taskDataPolygon as FeatureCollection,
      ) as LngLatBoundsLike;
      map?.fitBounds(bbox as LngLatBoundsLike, {
        padding: 105,
        duration: 500,
      });
    }
  };

  const handleToggleOrthophoto = () => {
    map?.setLayoutProperty(
      'task-orthophoto',
      'visibility',
      showOrthophoto ? 'none' : 'visible',
    );
    setShowOrthophoto(!showOrthophoto);
    if (!showOrthophoto) {
      map.fitBounds(
        map.getSource(map.getLayer('task-orthophoto').source).bounds,
      );
    }
  };
  // end toggle layers

  const zoomToExtent = () => {
    if (taskWayPointsData) {
      const bbox = getBbox(
        taskWayPointsData.geojsonAsLineString as FeatureCollection,
      ) as LngLatBoundsLike;
      map?.fitBounds(bbox as LngLatBoundsLike, {
        padding: 105,
        duration: 500,
      });
    }
  };

  const handleSaveStartingPoint = () => {
    const { geometry: startingPonyGeometry } = newTakeOffPoint as Record<
      string,
      any
    >;
    const [lng, lat] = startingPonyGeometry.coordinates;
    postWaypoint({
      projectId,
      taskId,
      mode: waypointMode,
      rotationAngle: finalRotationAngle,
      droneModel: droneModel,
      takeOffPoint: {
        longitude: lng,
        latitude: lat,
      },
    });
  };

  // Clean up on unmount
  useEffect(
    () => () => {
      dispatch(setSelectedTakeOffPoint(null));
      dispatch(setSelectedTakeOffPointOption('current_location'));
      dispatch(setFinalRotationAngle(0));
      dispatch(
        setTaskAssetsInformation({
          total_image_uploaded: 0,
          assets_url: '',
          state: '',
        }),
      );
    },
    [dispatch],
  );

  return (
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

        <VectorLayer
          map={map as Map}
          id="task-polygon"
          visibleOnMap={taskDataPolygon && !taskDataPolygonIsFetching}
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

        {/* task waypoints/way lines plot */}
        {taskWayPointsData && !taskWayPointsLoading && (
          <>
            {/* render line */}
            <VectorLayer
              map={map}
              isMapLoaded={isMapLoaded}
              id="waypoint-line"
              geojson={taskWayPointsData?.geojsonAsLineString as GeojsonType}
              visibleOnMap={!!taskWayPointsData}
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
              geojson={taskWayPointsData?.geojsonListOfPoint as GeojsonType}
              visibleOnMap={!!taskWayPointsData}
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
                      taskWayPointsData?.geojsonListOfPoint?.features?.length -
                        1,
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
              geojson={taskWayPointsData?.geojsonListOfPoint as GeojsonType}
              visibleOnMap={!!taskWayPointsData}
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

        {/* end of waypoint/way line plot */}

        {/* Visible only on rotation */}
        {isRotationEnabled && dragging && (
          <>
            {/* render line */}
            <VectorLayer
              map={map as Map}
              isMapLoaded={isMapLoaded}
              id="rotated-waypoint-line"
              geojson={
                rotatedFlightPlanData?.geojsonAsLineString as GeojsonType
              }
              visibleOnMap={!!taskWayPointsData}
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
              geojson={rotatedFlightPlanData?.geojsonListOfPoint as GeojsonType}
              visibleOnMap={!!taskWayPointsData}
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
                      rotatedFlightPlanData?.geojsonListOfPoint?.features
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

        {/* rotation ends */}

        {/* Update take off point */}
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
            {newTakeOffPoint ? 'Save Take off Point' : 'Change Take off Point'}
          </Button>
        </div>
        {newTakeOffPoint && (
          <VectorLayer
            map={map as Map}
            isMapLoaded={isMapLoaded}
            id="new-take-Off-Point"
            geojson={newTakeOffPoint as GeojsonType}
            visibleOnMap
            layerOptions={{}}
            hasImage
            image={marker}
            iconAnchor="bottom"
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
        {/* Update take off end */}

        {/* Ortho-photo visualization */}
        {taskAssetsInformation?.assets_url && (
          <COGOrthophotoViewer
            id="task-orthophoto"
            source={orthophotoSource}
            visibleOnMap
            zoomToLayer
          />
        )}
        {/* Ortho-photo visualization end */}

        {/* rotating tool */}
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

        {isRotationEnabled && (
          <div className="naxatw-absolute naxatw-bottom-3 naxatw-right-[calc(50%-5.4rem)] naxatw-z-30 naxatw-h-fit lg:naxatw-right-3 lg:naxatw-top-3">
            <Button
              withLoader
              leftIcon="rotate_90_degrees_cw"
              className="naxatw-w-[11.8rem] naxatw-bg-red"
              onClick={() => {
                setIsRotationEnabled(false);
              }}
              isLoading={isUpdatingTakeOffPoint}
            >
              Save Rotation
            </Button>
          </div>
        )}

        {/* rotating tool end */}

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

        <div className="naxatw-absolute naxatw-top-3 naxatw-right-3 lg:naxatw-right-64 naxatw-z-10 flex gap-3 lg:gap-6">
          <SwitchTab
            activeClassName="naxatw-bg-red naxatw-text-white"
            options={droneModelOptions}
            labelKey="label"
            valueKey="value"
            selectedValue={droneModel}
            onChange={(value: Record<string, any>) => {
              dispatch(setDroneModel(value.value));
            }}
          />

          <SwitchTab
            activeClassName="naxatw-bg-red naxatw-text-white"
            options={gimbalAngleOptions}
            labelKey="label"
            valueKey="value"
            selectedValue={gimbalAngle}
            onChange={(value: Record<string, any>) => {
              dispatch(setGimbalAngle(value.value));
            }}
          />

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

        {/* additional controls */}
        <div className="naxatw-absolute naxatw-left-[0.575rem] naxatw-top-[5.75rem] naxatw-z-30 naxatw-flex naxatw-h-fit naxatw-w-fit naxatw-flex-col naxatw-gap-3">
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
          <Button
            variant="ghost"
            className={`naxatw-grid naxatw-h-[1.85rem] naxatw-place-items-center naxatw-border !naxatw-px-[0.315rem] ${showFlightPlan ? 'naxatw-border-red naxatw-bg-[#ffe0e0]' : 'naxatw-border-gray-400 naxatw-bg-[#F5F5F5]'}`}
            onClick={() => handleToggleFlightPlan()}
          >
            <ToolTip
              name="flight_take_off"
              message="Show Flight Plan"
              symbolType="material-icons"
              iconClassName="!naxatw-text-xl !naxatw-text-black naxatw-w-[1.25rem]"
              className="naxatw-mt-[-4px]"
            />
          </Button>

          <Button
            variant="ghost"
            className={`naxatw-flex naxatw-h-[1.85rem] naxatw-w-[] naxatw-items-center naxatw-justify-center naxatw-border !naxatw-px-[0.315rem] ${showTaskArea ? 'naxatw-border-red naxatw-bg-[#ffe0e0]' : 'naxatw-border-gray-400 naxatw-bg-[#F5F5F5]'}`}
            onClick={() => handleToggleTaskArea()}
            title="Task area"
          >
            <div className="naxatw-h-4 naxatw-w-4">
              <img src={areaIcon} alt="area-icon" />
            </div>
          </Button>

          <Button
            variant="ghost"
            className="naxatw-grid naxatw-h-[1.85rem] naxatw-place-items-center naxatw-border naxatw-border-gray-400 naxatw-bg-[#F5F5F5] !naxatw-px-[0.315rem]"
            onClick={() => zoomToExtent()}
          >
            <ToolTip
              name="zoom_out_map"
              message="Zoom to task area"
              symbolType="material-icons"
              iconClassName="!naxatw-text-xl !naxatw-text-black naxatw-w-[1.25rem]"
              className="naxatw-mt-[-4px]"
            />
          </Button>

          {taskAssetsInformation?.assets_url && (
            <Button
              variant="ghost"
              className={`naxatw-grid naxatw-h-[1.85rem] naxatw-place-items-center naxatw-border !naxatw-px-[0.315rem] ${showOrthophoto ? 'naxatw-border-red naxatw-bg-[#ffe0e0]' : 'naxatw-border-gray-400 naxatw-bg-[#F5F5F5]'}`}
              onClick={() => handleToggleOrthophoto()}
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
        </div>
      </MapContainer>
    </div>
  );
};

export default hasErrorBoundary(MapSection);
