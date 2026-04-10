import BaseLayerSwitcherUI from "@Components/common/BaseLayerSwitcher";
import { useMapLibreGLMap } from "@Components/common/MapLibreComponents";
import COGOrthophotoViewer from "@Components/common/MapLibreComponents/COGOrthophotoViewer";
import MapContainer from "@Components/common/MapLibreComponents/MapContainer";
import { setSelectedTaskDetailToViewOrthophoto } from "@Store/actions/droneOperatorTask";
import { useTypedSelector } from "@Store/hooks";
import hasErrorBoundary from "@Utils/hasErrorBoundary";
import { RasterSourceSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { useDispatch } from "react-redux";
import { useGetTaskAssetsInfo } from "@Api/tasks";

const TaskOrthophotoPreview = () => {
  const dispatch = useDispatch();
  const taskIdFromRedux = useTypedSelector(
    (state) => state.droneOperatorTask.selectedTaskDetailToViewOrthophoto?.taskId,
  );
  const pathname = window.location.pathname?.split("/");
  const projectId = pathname?.[2];
  const taskId = pathname?.[4] || taskIdFromRedux;

  const { data: taskAssetsInformation }: Record<string, any> = useGetTaskAssetsInfo(
    projectId as string,
    taskId as string,
    { enabled: !!(projectId && taskId) } as any,
  );

  const { map, isMapLoaded } = useMapLibreGLMap({
    containerId: "orthophoto-map",
    mapOptions: {
      zoom: 5,
      center: [0, 0],
    },
    disableRotation: true,
  });

  const orthophotoSource: RasterSourceSpecification | null = useMemo(() => {
    const signed = taskAssetsInformation?.orthophoto_url;
    if (signed) return { type: "raster", url: `cog://${signed}`, tileSize: 256 };

    return null;
  }, [taskAssetsInformation?.orthophoto_url]);

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
          width: "100%",
          height: "100%",
        }}
      >
        <BaseLayerSwitcherUI />
        {isMapLoaded && orthophotoSource && (
          <COGOrthophotoViewer
            id="task-orthophoto"
            source={orthophotoSource}
            visibleOnMap
            zoomToLayer
          />
        )}
      </MapContainer>
    </div>
  );
};

export default hasErrorBoundary(TaskOrthophotoPreview);
