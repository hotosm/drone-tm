/* eslint-disable react/no-array-index-key */
import { useGetTaskWaypointQuery } from '@Api/tasks';
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
import { toggleModal } from '@Store/actions/common';
import { setSelectedTakeOffPoint } from '@Store/actions/droneOperatorTask';
import { useTypedSelector } from '@Store/hooks';
import getBbox from '@turf/bbox';
import { point } from '@turf/helpers';
import { coordAll } from '@turf/meta';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import { FeatureCollection } from 'geojson';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import { useCallback, useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useParams } from 'react-router-dom';
import GetCoordinatesOnClick from './GetCoordinatesOnClick';
import ShowInfo from './ShowInfo';

const MapSection = ({ className }: { className?: string }) => {
  const dispatch = useDispatch();
  const { projectId, taskId } = useParams();
  const [popupData, setPopupData] = useState<Record<string, any>>({});
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

  const { data: taskWayPoints }: any = useGetTaskWaypointQuery(
    projectId as string,
    taskId as string,
    {
      select: (data: any) => {
        return {
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
      },
    },
  );

  // zoom to task
  useEffect(() => {
    if (!taskWayPoints?.geojsonAsLineString) return;
    const { geojsonAsLineString } = taskWayPoints;
    const bbox = getBbox(geojsonAsLineString as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25, duration: 500 });
  }, [map, taskWayPoints]);

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

  return (
    <>
      <div
        className={`naxatw-h-[calc(100vh-180px)] naxatw-w-full naxatw-rounded-xl naxatw-bg-gray-200 ${className}`}
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

          <div className="naxatw-absolute naxatw-bottom-3 naxatw-right-[calc(50%-5.4rem)] naxatw-z-30 lg:naxatw-right-3 lg:naxatw-top-3">
            <Button
              withLoader
              leftIcon="place"
              className="naxatw-w-[11.8rem] naxatw-bg-red"
              onClick={() => {
                if (newTakeOffPoint) {
                  // console.log('hit api with above take off point');
                  dispatch(setSelectedTakeOffPoint(null));
                } else {
                  dispatch(toggleModal('update-flight-take-off-point'));
                }
              }}
            >
              {newTakeOffPoint
                ? 'Save Starting Point'
                : 'Change Starting Point'}
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

          {newTakeOffPoint && (
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
