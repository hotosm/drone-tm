/* eslint-disable no-nested-ternary */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import getBbox from '@turf/bbox';
import { FeatureCollection } from 'geojson';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import AsyncPopup from '@Components/common/MapLibreComponents/AsyncPopup';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import VectorLayerWithCluster from './VectorLayerWithCluster';

const ProjectsMapSection = ({
  projectCentroidList,
}: {
  projectCentroidList: Record<string, any>[];
}) => {
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

  const projectsCentroidGeojson: any = useMemo(() => {
    if (!projectCentroidList || !projectCentroidList?.length) return [];
    // find all polygons centroid and set to geojson save to single geojson
    const combinedGeojson = projectCentroidList?.reduce(
      (acc: Record<string, any>, current: Record<string, any>) => {
        return {
          ...acc,
          features: [
            ...acc.features,
            {
              geometry: current?.centroid,
              properties: {
                id: current?.id,
                name: current?.name,
                slug: current?.slug,
                colorCode:
                  current?.status === 'not-started'
                    ? '#808080'
                    : current?.status === 'completed'
                      ? '#028a0f'
                      : '#11b4da',
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
  }, [projectCentroidList]);

  useEffect(() => {
    if (
      !projectsCentroidGeojson ||
      !projectsCentroidGeojson?.features?.length ||
      !map ||
      !isMapLoaded
    )
      return;
    const bbox = getBbox(projectsCentroidGeojson as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 100, duration: 500 });
  }, [projectsCentroidGeojson, map, isMapLoaded]);

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

      {projectsCentroidGeojson && (
        <VectorLayerWithCluster
          map={map}
          visibleOnMap
          mapLoaded={isMapLoaded}
          sourceId="clustered-projects"
          geojson={projectsCentroidGeojson}
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
