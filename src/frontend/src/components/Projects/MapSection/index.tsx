import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import getBbox from '@turf/bbox';
import centroid from '@turf/centroid';
import { FeatureCollection } from 'geojson';
import { useGetProjectsListQuery } from '@Api/projects';
import { useTypedSelector } from '@Store/hooks';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import AsyncPopup from '@Components/common/MapLibreComponents/AsyncPopup';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import VectorLayerWithCluster from './VectorLayerWithCluster';

const ProjectsMapSection = () => {
  const projectsFilterByOwner = useTypedSelector(
    state => state.createproject.ProjectsFilterByOwner,
  );
  const [projectProperties, setProjectProperties] = useState<
    Record<string, any>
  >({});
  const navigate = useNavigate();
  const { map, isMapLoaded } = useMapLibreGLMap({
    containerId: 'dashboard-map',
    mapOptions: {
      zoom: 0,
      center: [0, 0],
      maxZoom: 19,
    },
    disableRotation: true,
  });
  const { data: projectsList, isLoading }: Record<string, any> =
    useGetProjectsListQuery(projectsFilterByOwner, {
      select: (data: any) => {
        // find all polygons centroid and set to geojson save to single geojson
        const combinedGeojson = data?.data?.reduce(
          (acc: Record<string, any>, current: Record<string, any>) => {
            return {
              ...acc,
              features: [
                ...acc.features,
                {
                  ...centroid(current.outline),
                  properties: {
                    id: current?.id,
                    name: current?.name,
                    slug: current?.slug,
                  },
                },
              ],
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
    if (!projectsList || !projectsList?.features?.length) return;
    const bbox = getBbox(projectsList as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 100, duration: 500 });
  }, [projectsList, map]);

  const getPopupUI = useCallback(() => {
    return (
      <div>
        <h3>{projectProperties?.name}</h3>
      </div>
    );
  }, [projectProperties]);

  return (
    <MapContainer
      map={map}
      isMapLoaded={isMapLoaded}
      containerId="dashboard-map"
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '8px',
      }}
    >
      <BaseLayerSwitcher />

      {projectsList && (
        <VectorLayerWithCluster
          map={map}
          visibleOnMap={!isLoading}
          mapLoaded={isMapLoaded}
          sourceId="clustered-projects"
          geojson={projectsList}
        />
      )}

      <AsyncPopup
        map={map as Map}
        title={projectProperties?.slug}
        showPopup={(feature: Record<string, any>) =>
          feature?.layer?.id === 'unclustered-point'
        }
        popupUI={getPopupUI}
        fetchPopupData={(properties: Record<string, any>) => {
          setProjectProperties(properties);
        }}
        buttonText="Go To Project"
        handleBtnClick={() => navigate(`./${projectProperties?.id}`)}
        getCoordOnProperties
      />
    </MapContainer>
  );
};

export default hasErrorBoundary(ProjectsMapSection);
