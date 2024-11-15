import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import COGOrthophotoViewer from '@Components/common/MapLibreComponents/COGOrthophotoViewer';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import { setSelectedTaskDetailToViewOrthophoto } from '@Store/actions/droneOperatorTask';
import { useTypedSelector } from '@Store/hooks';
import { LngLatBoundsLike, RasterSourceSpecification } from 'maplibre-gl';
import { useEffect, useMemo } from 'react';
import { useDispatch } from 'react-redux';

const { S3_ENDPOINT } = process.env;

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
    containerId: 'orthophoto-map',
    mapOptions: {
      zoom: 21,
      center: [0, 0],
    },
    disableRotation: true,
  });

  const orthophotoSource: RasterSourceSpecification = useMemo(
    () => ({
      type: 'raster',
      url: `cog://${S3_ENDPOINT}/dtm-data/projects/${projectId}/${taskId}/orthophoto/odm_orthophoto.tif`,
      tileSize: 256,
    }),

    [projectId, taskId],
  );

  useEffect(() => {
    if (!map || !isMapLoaded || !taskOutline) return;
    const { bbox } = taskOutline.properties;
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 50, duration: 500 });
  }, [map, isMapLoaded, taskOutline]);

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
        containerId="orthophoto-map"
        style={{
          width: '100%',
          height: '100%',
        }}
      >
        <BaseLayerSwitcherUI />
        <COGOrthophotoViewer
          id="task-orthophoto"
          source={orthophotoSource}
          visibleOnMap
        />
      </MapContainer>
    </div>
  );
};

export default TaskOrthophotoPreview;
