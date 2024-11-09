import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import { setSelectedTaskDetailToViewOrthophoto } from '@Store/actions/droneOperatorTask';
import { useTypedSelector } from '@Store/hooks';
import { LngLatBoundsLike } from 'maplibre-gl';
import { useEffect, useMemo } from 'react';
import { useDispatch } from 'react-redux';

const { BASE_URL } = process.env;

const TaskOrthophotoPreview = () => {
  const dispatch = useDispatch();
  const taskOutline = useTypedSelector(
    state =>
      state.droneOperatorTask.selectedTaskDetailToViewOrthophoto?.outline,
  );
  const taskIdFromRedux = useTypedSelector(
    state => state.droneOperatorTask.selectedTaskDetailToViewOrthophoto?.taskId,
  );
  const pathname = window.location.pathname?.split('/');
  const projectId = pathname?.[2];
  const taskId = pathname?.[4] || taskIdFromRedux;

  const { map, isMapLoaded } = useMapLibreGLMap({
    containerId: 'dashboard-map',
    mapOptions: {
      zoom: 0,
      center: [0, 0],
    },
    disableRotation: true,
  });

  const orhtophotoSource: Record<string, any> = useMemo(
    () => ({
      source: {
        type: 'raster',
        tiles: [
          `${BASE_URL}/projects/orthophoto/{z}/{x}/{y}.png?project_id=${projectId}&task_id=${taskId}`,
        ],
        tileSize: 256,
      },
      layer: {
        id: 'ortho-photo',
        type: 'raster',
        source: 'ortho-photo',
        layout: {},
      },
    }),

    [projectId, taskId],
  );

  useEffect(() => {
    if (!map || !isMapLoaded || !taskOutline) return;
    const { bbox } = taskOutline.properties;
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 50, duration: 500 });
  }, [map, isMapLoaded, taskOutline]);

  useEffect(() => {
    if (
      !map ||
      !isMapLoaded ||
      !projectId ||
      !taskId ||
      !orhtophotoSource ||
      !taskOutline
    )
      return;

    // check if the map view intersects the bbox of task
    function isInOrthophotoBoundsAndZoom() {
      const bounds = map?.getBounds(); // Get the current map bounds (sw, ne)
      const zoom = map?.getZoom();
      if (!bounds || !zoom) return null;
      const { bbox } = taskOutline.properties; // tasks bbox
      return (
        bounds.getWest() < bbox[2] &&
        bounds.getEast() > bbox[0] &&
        bounds.getNorth() > bbox[1] &&
        bounds.getSouth() < bbox[3] &&
        zoom > 12
      );
    }

    function addOrthophotoLayerIfInBounds() {
      if (!map || !orhtophotoSource) return;
      if (isInOrthophotoBoundsAndZoom()) {
        if (!map.getSource('ortho-photo')) {
          map.addSource('ortho-photo', orhtophotoSource.source);
          map.addLayer(orhtophotoSource.layer);
        }
      } else {
        if (map.getLayer('ortho-photo')) {
          map.removeLayer('ortho-photo');
        }
        if (map.getSource('ortho-photo')) {
          map.removeSource('ortho-photo');
        }
      }
    }

    map.on('moveend', () => {
      addOrthophotoLayerIfInBounds();
    });

    map.on('zoomend', () => {
      addOrthophotoLayerIfInBounds();
    });
  }, [map, isMapLoaded, projectId, taskId, orhtophotoSource, taskOutline]);

  useEffect(() => {
    return () => {
      dispatch(setSelectedTaskDetailToViewOrthophoto(null));
    };
  }, [dispatch]);

  return (
    <div className="naxatw-h-[calc(100vh-180px)] naxatw-w-full naxatw-rounded-xl naxatw-bg-gray-200">
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
      </MapContainer>
    </div>
  );
};

export default TaskOrthophotoPreview;
