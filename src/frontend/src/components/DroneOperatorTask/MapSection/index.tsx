/* eslint-disable react/no-array-index-key */
import { useEffect } from 'react';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import { useParams } from 'react-router-dom';
import { FeatureCollection } from 'geojson';
import { useGetTaskWaypointQuery } from '@Api/tasks';
import getBbox from '@turf/bbox';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import right from '@Assets/images/rightArrow.png';

const MapSection = () => {
  const { projectId, taskId } = useParams();
  const { map, isMapLoaded } = useMapLibreGLMap({
    containerId: 'dashboard-map',
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  const { data: taskWayPoints }: any = useGetTaskWaypointQuery(
    projectId as string,
    taskId as string,
    {
      select: (data: any) => {
        // refine data and return geojson points and single line string
        const refinedData = data?.data?.reduce(
          (acc: any, curr: any) => {
            return {
              ...acc,
              geojsonListOfPoint: [
                ...acc.geojsonListOfPoint,
                {
                  type: 'FeatureCollection',
                  features: [
                    {
                      type: 'Feature',
                      properties: {
                        angle: curr?.angle,
                        gimbal_angle: curr.gimbal_angle,
                      },
                      geometry: {
                        type: 'Point',
                        coordinates: curr?.coordinates,
                      },
                    },
                  ],
                },
              ],
              combinedCoordinates: [
                ...acc.combinedCoordinates,
                curr?.coordinates,
              ],
            };
          },
          {
            combinedCoordinates: [],
            geojsonListOfPoint: [],
          },
        );
        const { geojsonListOfPoint, combinedCoordinates } = refinedData;
        return {
          geojsonListOfPoint,
          geojsonAsLineString: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: combinedCoordinates,
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
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25 });
  }, [map, taskWayPoints]);

  return (
    <>
      <div className="naxatw-h-[70vh] naxatw-w-full naxatw-rounded-xl naxatw-bg-gray-200">
        <MapContainer
          map={map}
          isMapLoaded={isMapLoaded}
          containerId="dashboard-map"
          style={{
            width: '100%',
            height: '100%',
          }}
        >
          {taskWayPoints && (
            <>
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
              />
              {taskWayPoints?.geojsonListOfPoint?.map(
                (point: any, index: number) => {
                  return (
                    <VectorLayer
                      key={`waypoint-points-vtLayer-${index}`}
                      map={map as Map}
                      isMapLoaded={isMapLoaded}
                      id={`waypoint-directions-${index}`}
                      geojson={point as GeojsonType}
                      visibleOnMap={!!taskWayPoints}
                      layerOptions={{
                        type: 'circle',
                        paint: {
                          'circle-color': index === 0 ? 'red' : '#176149',
                          'circle-opacity': 0.8,
                          'circle-radius': index === 0 ? 9 : 6,
                        },
                      }}
                    />
                  );
                },
              )}
            </>
          )}
          <BaseLayerSwitcher />
        </MapContainer>
      </div>
    </>
  );
};

export default MapSection;
