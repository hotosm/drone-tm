/* eslint-disable no-unused-vars */
import { useEffect } from 'react';
import { useTypedSelector, useTypedDispatch } from '@Store/hooks';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import { FeatureCollection } from 'geojson';
import getBbox from '@turf/bbox';
import useDrawTool from '@Components/common/MapLibreComponents/useDrawTool';
import { drawStyles } from '@Constants/map';
import { setCreateProjectState } from '@Store/actions/createproject';
import hasErrorBoundary from '@Utils/hasErrorBoundary';

const MapSection = ({
  onResetButtonClick,
  handleDrawProjectAreaClick,
}: {
  onResetButtonClick: (reset: any) => void;
  handleDrawProjectAreaClick: any;
}) => {
  const dispatch = useTypedDispatch();

  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  const drawProjectAreaEnable = useTypedSelector(
    state => state.createproject.drawProjectAreaEnable,
  );
  const drawNoFlyZoneEnable = useTypedSelector(
    state => state.createproject.drawNoFlyZoneEnable,
  );
  const drawnNoFlyZone = useTypedSelector(
    state => state.createproject.drawnNoFlyZone,
  );
  const noFlyZone = useTypedSelector(state => state.createproject.noFlyZone);

  const handleDrawEnd = (geojson: GeojsonType | null) => {
    if (!geojson) return;
    if (drawProjectAreaEnable) {
      dispatch(setCreateProjectState({ drawnProjectArea: geojson }));
    } else {
      const collectiveGeojson: any = drawnNoFlyZone
        ? {
            // @ts-ignore
            ...drawnNoFlyZone,
            features: [
              // @ts-ignore
              ...(drawnNoFlyZone?.features || []),
              // @ts-ignore
              ...(geojson?.features || []),
            ],
          }
        : geojson;
      dispatch(setCreateProjectState({ drawnNoFlyZone: collectiveGeojson }));
    }
  };

  const { resetDraw } = useDrawTool({
    map,
    enable: drawProjectAreaEnable || drawNoFlyZoneEnable,
    drawMode: 'draw_polygon',
    styles: drawStyles,
    onDrawEnd: handleDrawEnd,
  });

  useEffect(() => {
    onResetButtonClick(resetDraw);
  }, [onResetButtonClick, resetDraw]);

  const projectArea = useTypedSelector(
    state => state.createproject.projectArea,
  );

  useEffect(() => {
    if (!projectArea) return;
    const bbox = getBbox(projectArea as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25 });
  }, [map, projectArea]);

  const drawSaveFromMap = () => {
    if (drawProjectAreaEnable) {
      handleDrawProjectAreaClick();
    } else {
      resetDraw();
    }
  };

  return (
    <MapContainer
      map={map}
      isMapLoaded={isMapLoaded}
      style={{
        width: '100%',
        height: '448px',
        position: 'relative',
      }}
    >
      {(drawNoFlyZoneEnable || drawProjectAreaEnable) && (
        <div className="naxatw-absolute naxatw-right-[calc(50%_-_75px)] naxatw-top-2 naxatw-z-50 naxatw-flex naxatw-h-9 naxatw-w-[150px] naxatw-rounded-lg naxatw-bg-white">
          <div className="naxatw-flex naxatw-w-full naxatw-items-center naxatw-justify-evenly">
            <i
              className="material-icons-outlined naxatw-w-full naxatw-cursor-pointer naxatw-rounded-l-md naxatw-border-r naxatw-text-center hover:naxatw-bg-gray-100"
              role="presentation"
              onClick={() => drawSaveFromMap()}
            >
              save
            </i>
            <i
              className="material-icons-outlined naxatw-w-full naxatw-cursor-pointer naxatw-text-center hover:naxatw-bg-gray-100"
              role="presentation"
              onClick={() => {
                dispatch(setCreateProjectState({ drawnNoFlyZone: noFlyZone }));
                resetDraw();
              }}
            >
              restart_alt
            </i>
          </div>
        </div>
      )}
      <VectorLayer
        map={map as Map}
        isMapLoaded={isMapLoaded}
        id="uploaded-project-area"
        geojson={projectArea as GeojsonType}
        visibleOnMap={!!projectArea}
        layerOptions={{
          type: 'fill',
          paint: {
            'fill-color': '#328ffd',
            'fill-outline-color': '#D33A38',
            'fill-opacity': 0.2,
          },
        }}
      />
      <VectorLayer
        map={map as Map}
        isMapLoaded={isMapLoaded}
        id="uploaded-no-fly-zone"
        geojson={noFlyZone as GeojsonType}
        visibleOnMap={!!noFlyZone}
        layerOptions={{
          type: 'fill',
          paint: {
            'fill-color': '#404040',
            'fill-outline-color': '#D33A38',
            'fill-opacity': 0.5,
          },
        }}
      />

      <VectorLayer
        map={map as Map}
        isMapLoaded={isMapLoaded}
        id="uploaded-no-fly-zone-ongoing"
        geojson={drawnNoFlyZone as GeojsonType}
        visibleOnMap={!!drawnNoFlyZone}
        layerOptions={{
          type: 'fill',
          paint: {
            'fill-color': '#404040',
            'fill-outline-color': '#D33A38',
            'fill-opacity': 0.3,
          },
        }}
      />

      <BaseLayerSwitcher />
    </MapContainer>
  );
};

export default hasErrorBoundary(MapSection);
