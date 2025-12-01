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

const MapSection = ({
  selectedTab,
  setValue,
}: {
  selectedTab: string;
  setValue: any;
}) => {
  const dispatch = useTypedDispatch();
  const [bufferGeojson, setBufferGeojson] = useState<GeojsonType | null>(null);
  const [drawMode, setDrawMode] = useState<
    'static' | 'draw_polygon' | 'simple_select'
  >('static');

  const projectArea = useTypedSelector(
    state => state.createproject.projectArea,
  );
  const noFlyZone = useTypedSelector(state => state.createproject.noFlyZone);
  const activeDraw = drawMode === 'draw_polygon';
  const activeDrawEdit = drawMode === 'simple_select';

  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: {
      zoom: 0,
      center: [0, 0],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  const handleDrawEnd = (geojson: GeojsonType | null) => {
    if (!geojson) return;
    if (selectedTab === 'project') {
      if (projectArea && drawMode === 'simple_select') {
        setBufferGeojson(geojson);
      } else {
        dispatch(setCreateProjectState({ projectArea: geojson }));
        setDrawMode('static');
        setValue('outline', geojson);
      }
    } else if (noFlyZone && projectArea && drawMode === 'simple_select') {
      setBufferGeojson(geojson);
    } else {
      dispatch(setCreateProjectState({ noFlyZone: geojson }));
      setDrawMode('static');
      setValue('outline', geojson);
    }
  };

  const { resetDraw, draw } = useDrawTool({
    map,
    enable: drawMode === 'draw_polygon' || drawMode === 'simple_select',
    styles: drawStyles,
    drawMode,
    onDrawEnd: handleDrawEnd,
    geojson:
      selectedTab === 'project' ? projectArea || null : noFlyZone || null,
  });

  useEffect(() => {
    if (!projectArea || !map || !isMapLoaded) return;
    const bbox = getBbox(projectArea as FeatureCollection);
    map.fitBounds(bbox as LngLatBoundsLike, { padding: 150, duration: 500 });
  }, [map, projectArea, isMapLoaded]);

  const showDrawButton = () => {
    if (selectedTab === 'project') {
      if (!projectArea) return true;
      return false;
    }
    return true;
  };

  const showEditButton = () => {
    if (selectedTab === 'project' && projectArea) return true;
    if (selectedTab === 'no_fly_zone' && noFlyZone) return true;
    return false;
  };

  const handleEditCancel = () => {
    setBufferGeojson(null);
    setDrawMode('static');
    resetDraw();
  };
  const handleEditSave = () => {
    if (selectedTab === 'project') {
      dispatch(setCreateProjectState({ projectArea: bufferGeojson }));
      setValue('outline', bufferGeojson);
    } else {
      dispatch(setCreateProjectState({ noFlyZone: bufferGeojson }));
      setValue('no_fly_zone', bufferGeojson);
    }
    setDrawMode('static');
    setBufferGeojson(null);
  };

  const handleDelete = () => {
    const selectedFeatureIds = draw.getSelectedIds();
    let finalFeatureList = [];
    if (selectedTab === 'project') {
      // @ts-ignore
      finalFeatureList = projectArea?.features?.filter(
        (feature: any) => !selectedFeatureIds.includes(feature?.id),
      );
    } else {
      // @ts-ignore
      finalFeatureList = noFlyZone?.features?.filter(
        (feature: any) => !selectedFeatureIds.includes(feature?.id),
      );
    }
    if (finalFeatureList?.length) {
      setBufferGeojson({
        type: 'FeatureCollection',
        features: finalFeatureList,
      });
    } else {
      setBufferGeojson(null);
    }
    draw.delete(draw.getSelectedIds());
  };

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
      <LocateUser />
      <div className="naxatw-absolute naxatw-left-2 naxatw-top-24 naxatw-z-50 naxatw-flex naxatw-h-fit naxatw-w-9 naxatw-flex-col naxatw-gap-2 naxatw-rounded-lg">
        {showDrawButton() && (
          <>
            <i
              className={`material-icons-outlined naxatw-flex naxatw-h-8 naxatw-w-full naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-md naxatw-text-center hover:naxatw-bg-gray-100 ${
                activeDraw
                  ? 'naxatw-border-2 naxatw-border-gray-500 naxatw-bg-gray-100'
                  : 'naxatw-bg-white'
              }`}
              role="presentation"
              onClick={() => {
                setDrawMode('draw_polygon');
              }}
              title="Draw"
            >
              draw
            </i>
            {drawMode === 'draw_polygon' && (
              <i
                className={`material-icons-outlined naxatw-flex naxatw-h-8 naxatw-w-full naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-md naxatw-text-center hover:naxatw-bg-gray-100 ${'naxatw-bg-white'}`}
                role="presentation"
                onClick={() => {
                  setDrawMode('static');
                  resetDraw();
                }}
                title="reset"
              >
                replay
              </i>
            )}
          </>
        )}
        {showEditButton() && (
          <div className="naxatw-relative">
            <i
              className={`material-icons-outlined naxatw-flex naxatw-h-8 naxatw-w-full naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-md naxatw-text-center hover:naxatw-bg-gray-100 ${
                activeDrawEdit
                  ? 'naxatw-border-2 naxatw-border-gray-500 naxatw-bg-gray-100'
                  : 'naxatw-bg-white'
              }`}
              role="presentation"
              onClick={() => {
                setDrawMode('simple_select');
              }}
              title="Edit"
            >
              edit
            </i>
            {activeDrawEdit && (
              <div className="naxatw-absolute naxatw-left-11 naxatw-top-0 naxatw-flex naxatw-w-[100px] naxatw-justify-center naxatw-gap-1 naxatw-rounded-md naxatw-bg-white naxatw-px-2 naxatw-py-2">
                <div className="naxatw-naxatw-w-0 naxatw-absolute naxatw-left-[-16px] naxatw-top-2.5 naxatw-h-0 naxatw-border-8 naxatw-border-solid naxatw-border-transparent naxatw-border-r-white" />
                <div
                  className="naxatw-w-[50px] naxatw-cursor-pointer hover:naxatw-underline"
                  role="presentation"
                  onClick={() => {
                    handleEditSave();
                  }}
                  onKeyDown={() => {
                    handleEditSave();
                  }}
                >
                  Save
                </div>
                <div
                  className="naxatw-w-[50px] naxatw-cursor-pointer hover:naxatw-underline"
                  role="presentation"
                  onClick={() => {
                    handleEditCancel();
                  }}
                  onKeyDown={() => {
                    handleEditCancel();
                  }}
                >
                  Cancel
                </div>
              </div>
            )}
          </div>
        )}
        {activeDrawEdit && (
          <i
            className="material-icons-outlined naxatw-flex naxatw-h-8 naxatw-w-full naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-md naxatw-bg-white naxatw-text-center hover:naxatw-bg-gray-100"
            role="presentation"
            onClick={() => {
              handleDelete();
            }}
            title="Delete"
          >
            delete
          </i>
        )}
      </div>

      {projectArea && (selectedTab !== 'project' || drawMode === 'static') && (
        <VectorLayer
          map={map as Map}
          isMapLoaded={isMapLoaded}
          id="project-area"
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

      {noFlyZone &&
        (selectedTab !== 'no_fly_zone' ||
          drawMode === 'static' ||
          drawMode === 'draw_polygon') && (
          <VectorLayer
            map={map as Map}
            isMapLoaded={isMapLoaded}
            id="no-fly-zone-area"
            geojson={noFlyZone as GeojsonType}
            visibleOnMap={!!noFlyZone}
            layerOptions={{
              type: 'fill',
              paint: {
                'fill-color': '#bbbcb6',
                'fill-outline-color': '#000',
                'fill-opacity': 0.8,
              },
            }}
          />
        )}
    </MapContainer>
  );
};

export default hasErrorBoundary(MapSection);
