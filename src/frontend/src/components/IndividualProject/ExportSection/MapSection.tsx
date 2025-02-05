import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import getBbox from '@turf/bbox';
import { useTypedSelector } from '@Store/hooks';
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { useEffect } from 'react';
import { FeatureCollection } from 'geojson';
import hasErrorBoundary from '@Utils/hasErrorBoundary';

interface IMapSectionProps {
  projectData: Record<string, any>;
}

const MapSection = ({ projectData }: IMapSectionProps) => {
  const tasksData = useTypedSelector(state => state.project.tasksData);
  const projectArea = useTypedSelector(state => state.project.projectArea);

  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });

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
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25, duration: 500 });
  }, [map, tasksData]);

  return (
    <div className="naxatw-h-[375px] naxatw-w-full">
      <MapContainer
        map={map}
        isMapLoaded={isMapLoaded}
        style={{
          width: '100%',
          height: '100%',
        }}
      >
        <BaseLayerSwitcherUI isMapLoaded={isMapLoaded} />

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

        {tasksData &&
          tasksData?.map((task: Record<string, any>) => {
            return (
              <VectorLayer
                key={task?.id}
                map={map as Map}
                id={`tasks-layer-${task?.id}`}
                visibleOnMap={task?.id}
                geojson={task.outline as GeojsonType}
                interactions={['feature']}
                layerOptions={{
                  type: 'fill',
                  paint: {
                    'fill-color': '#ffffff',
                    'fill-outline-color': '#484848',
                    'fill-opacity': 0.5,
                  },
                }}
              />
            );
          })}
      </MapContainer>
    </div>
  );
};

export default hasErrorBoundary(MapSection);
