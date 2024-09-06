import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import { useGetProjectsListQuery } from '@Api/projects';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import centroid from '@turf/centroid';
import getBbox from '@turf/bbox';
import { useEffect } from 'react';
import { FeatureCollection } from 'geojson';
import { LngLatBoundsLike } from 'maplibre-gl';
import VectorLayerWithCluster from './VectorLayerWithCluster';

const ProjectsMapSection = () => {
  const { map, isMapLoaded } = useMapLibreGLMap({
    containerId: 'dashboard-map',
    mapOptions: {
      zoom: 0,
      center: [0, 0],
      maxZoom: 19,
    },
    disableRotation: true,
  });
  const { data: projectsList, isLoading } = useGetProjectsListQuery({
    select: (data: any) => {
      // find all polygons centroid and set to geojson save to single geojson
      const combinedGeojson = data?.data?.reduce(
        (acc: Record<string, any>, current: Record<string, any>) => {
          return {
            ...acc,
            features: [...acc.features, centroid(current.outline)],
          };
        },
        {
          type: 'FeatureCollection',
          features: [],
        },
      );
      return combinedGeojson;
    },
  });

  useEffect(() => {
    if (!projectsList) return;
    const bbox = getBbox(projectsList as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 100 });
  }, [projectsList, map]);

  return (
    <MapContainer
      map={map}
      isMapLoaded={isMapLoaded}
      containerId="dashboard-map"
      style={{
        width: '100%',
        height: '100%',
      }}
    >
      <BaseLayerSwitcher />

      <VectorLayerWithCluster
        map={map}
        visibleOnMap={!isLoading}
        mapLoaded={isMapLoaded}
        sourceId="clustered-projects"
        geojson={projectsList}
      />
    </MapContainer>
  );
};

export default hasErrorBoundary(ProjectsMapSection);
