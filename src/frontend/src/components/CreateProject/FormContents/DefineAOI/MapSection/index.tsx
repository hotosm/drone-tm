/* eslint-disable no-unused-vars */
import { useEffect, useState } from 'react';
import { useTypedSelector, useTypedDispatch } from '@Store/hooks';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
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
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import LocateUser from '@Components/common/MapLibreComponents/LocateUser';

const MapSection = ({ selectedTab }: { selectedTab: string }) => {
  const dispatch = useTypedDispatch();
  const [bufferGeojson, setBufferGeojson] = useState<GeojsonType | null>(null);
  const [drawEnabled, setDrawEnabled] = useState(false);

  const projectArea = useTypedSelector(
    state => state.createproject.projectArea,
  );

  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: {
      zoom: 5,
      center: [289.927139, 18.542117],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  const handleDrawEnd = (geojson: GeojsonType | null) => {
    if (!geojson) return;
    if (projectArea) {
      setBufferGeojson(geojson);
    } else {
      dispatch(setCreateProjectState({ projectArea: geojson }));
      setDrawEnabled(false);
    }
  };

  const { resetDraw } = useDrawTool({
    map,
    enable: drawEnabled,
    styles: drawStyles,
    drawMode: projectArea ? 'simple_select' : 'draw_polygon',
    onDrawEnd: handleDrawEnd,
    geojson: projectArea || null,
  });

  useEffect(() => {
    if (!projectArea) return;
    const bbox = getBbox(projectArea as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 150, duration: 500 });
  }, [map, projectArea]);

  return (
    <MapContainer
      map={map}
      isMapLoaded={isMapLoaded}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
      }}
    >
      <BaseLayerSwitcherUI />
      <LocateUser isMapLoaded={isMapLoaded} />
      <div className="naxatw-absolute naxatw-left-2 naxatw-top-24 naxatw-z-50 naxatw-flex naxatw-h-fit naxatw-w-9 naxatw-flex-col naxatw-gap-2 naxatw-rounded-lg">
        {!projectArea && (
          <>
            <i
              className={`material-icons-outlined naxatw-flex naxatw-h-8 naxatw-w-full naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-md naxatw-text-center hover:naxatw-bg-gray-100 ${
                drawEnabled
                  ? 'naxatw-border-2 naxatw-border-gray-500 naxatw-bg-gray-100'
                  : 'naxatw-bg-white'
              }`}
              role="presentation"
              onClick={() => {
                setDrawEnabled(true);
              }}
              title="Draw"
            >
              draw
            </i>
            {drawEnabled && (
              <i
                className={`material-icons-outlined naxatw-flex naxatw-h-8 naxatw-w-full naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-md naxatw-text-center hover:naxatw-bg-gray-100 ${'naxatw-bg-white'}`}
                role="presentation"
                onClick={() => {
                  resetDraw();
                }}
                title="reset"
              >
                replay
              </i>
            )}
          </>
        )}
        {projectArea && (
          <div className="naxatw-relative">
            <i
              className={`material-icons-outlined naxatw-flex naxatw-h-8 naxatw-w-full naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-md naxatw-text-center hover:naxatw-bg-gray-100 ${
                drawEnabled
                  ? 'naxatw-border-2 naxatw-border-gray-500 naxatw-bg-gray-100'
                  : 'naxatw-bg-white'
              }`}
              role="presentation"
              onClick={() => {
                setDrawEnabled(true);
              }}
              title="Edit"
            >
              edit
            </i>
            {drawEnabled && (
              <div className="naxatw-absolute naxatw-left-11 naxatw-top-0 naxatw-flex naxatw-w-[100px] naxatw-justify-center naxatw-gap-1 naxatw-rounded-md naxatw-bg-white naxatw-px-2 naxatw-py-2">
                <div className="naxatw-naxatw-w-0 naxatw-absolute naxatw-left-[-16px] naxatw-top-2.5 naxatw-h-0 naxatw-border-8 naxatw-border-solid naxatw-border-transparent naxatw-border-r-white"></div>
                <div
                  className="naxatw-w-[50px] naxatw-cursor-pointer hover:naxatw-underline"
                  onClick={() => {
                    if (!bufferGeojson) return;
                    dispatch(
                      setCreateProjectState({ projectArea: bufferGeojson }),
                    );
                    setDrawEnabled(false);
                  }}
                >
                  Save
                </div>
                <div
                  className="naxatw-w-[50px] naxatw-cursor-pointer hover:naxatw-underline"
                  onClick={() => {
                    setDrawEnabled(false);
                    resetDraw();
                    setBufferGeojson(null);
                  }}
                >
                  Cancel
                </div>
              </div>
            )}
          </div>
        )}
        {projectArea && (
          <i
            className="material-icons-outlined naxatw-flex naxatw-h-8 naxatw-w-full naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-md naxatw-bg-white naxatw-text-center hover:naxatw-bg-gray-100"
            role="presentation"
            onClick={() => {
              dispatch(setCreateProjectState({ projectArea: null }));
              resetDraw();
              setDrawEnabled(false);
            }}
            title="Delete"
          >
            delete
          </i>
        )}
      </div>

      {(selectedTab !== 'project' || !drawEnabled) && (
        <VectorLayer
          map={map as Map}
          isMapLoaded={isMapLoaded}
          id="uploaded-project-area"
          geojson={projectArea as GeojsonType}
          visibleOnMap={!!projectArea}
          layerOptions={{
            type: 'fill',
            paint: {
              'fill-color': '#D33A38',
              'fill-outline-color': '#000',
              'fill-opacity': 0.3,
            },
          }}
        />
      )}
    </MapContainer>
  );
};

export default hasErrorBoundary(MapSection);

// <VectorLayer
//         map={map as Map}
//         isMapLoaded={isMapLoaded}
//         id="uploaded-project-area"
//         geojson={projectArea as GeojsonType}
//         visibleOnMap={!!projectArea}
//         layerOptions={{
//           type: 'fill',
//           paint: {
//             'fill-color': '#328ffd',
//             'fill-outline-color': '#D33A38',
//             'fill-opacity': 0.2,
//           },
//         }}
//       />
//       <VectorLayer
//         map={map as Map}
//         isMapLoaded={isMapLoaded}
//         id="uploaded-no-fly-zone"
//         geojson={noFlyZone as GeojsonType}
//         visibleOnMap={!!noFlyZone}
//         layerOptions={{
//           type: 'fill',
//           paint: {
//             'fill-color': '#404040',
//             'fill-outline-color': '#D33A38',
//             'fill-opacity': 0.5,
//           },
//         }}
//       />

//       <VectorLayer
//         map={map as Map}
//         isMapLoaded={isMapLoaded}
//         id="uploaded-no-fly-zone-ongoing"
//         geojson={drawnNoFlyZone as GeojsonType}
//         visibleOnMap={!!drawnNoFlyZone}
//         layerOptions={{
//           type: 'fill',
//           paint: {
//             'fill-color': '#404040',
//             'fill-outline-color': '#D33A38',
//             'fill-opacity': 0.3,
//           },
//         }}
//       />

// const drawProjectAreaEnable = useTypedSelector(
//   state => state.createproject.drawProjectAreaEnable,
// );
// const drawNoFlyZoneEnable = useTypedSelector(
//   state => state.createproject.drawNoFlyZoneEnable,
// );
// const drawnNoFlyZone = useTypedSelector(
//   state => state.createproject.drawnNoFlyZone,
// );
// const noFlyZone = useTypedSelector(state => state.createproject.noFlyZone);

// function filterDuplicateFeature(
//   featuresData: any[],
//   geojsonFeatureObject: Record<string, any>,
// ) {
//   if (!geojsonFeatureObject) return [];
//   if (!featuresData) return [geojsonFeatureObject];
//   return featuresData.filter(
//     feature => feature.id !== geojsonFeatureObject.id,
//   );
// }

// const handleDrawEnd = (geojson: GeojsonType | null) => {
//   if (!geojson) return;
//   if (drawProjectAreaEnable) {
//     dispatch(setCreateProjectState({ drawnProjectArea: geojson }));
//   } else {
//     // @ts-ignore
//     let combindFeatures = geojson?.features;
//     // @ts-ignore
//     if (drawnNoFlyZone?.features) {
//       combindFeatures = filterDuplicateFeature(
//         // @ts-ignore
//         drawnNoFlyZone?.features,
//         // @ts-ignore
//         geojson?.features[0],
//       );
//     }
//     const collectiveGeojson: any = drawnNoFlyZone
//       ? {
//           // @ts-ignore
//           ...drawnNoFlyZone,
//           features: [
//             ...(combindFeatures || []),
//             // @ts-ignore
//             ...(geojson?.features || []),
//           ],
//         }
//       : geojson;
//     dispatch(setCreateProjectState({ drawnNoFlyZone: collectiveGeojson }));
//   }
// };

// const { resetDraw } = useDrawTool({
//   map,
//   enable: drawProjectAreaEnable || drawNoFlyZoneEnable,
//   drawMode: 'draw_polygon',
//   styles: drawStyles,
//   onDrawEnd: handleDrawEnd,
// });

// useEffect(() => {
//   onResetButtonClick(resetDraw);
// }, [onResetButtonClick, resetDraw]);

// const projectArea = useTypedSelector(
//   state => state.createproject.projectArea,
// );

// useEffect(() => {
//   if (!projectArea) return;
//   const bbox = getBbox(projectArea as FeatureCollection);
//   map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25, duration: 500 });
// }, [map, projectArea]);

// const drawSaveFromMap = () => {
//   if (drawProjectAreaEnable) {
//     handleDrawProjectAreaClick();
//   } else {
//     resetDraw();
//   }
// };
