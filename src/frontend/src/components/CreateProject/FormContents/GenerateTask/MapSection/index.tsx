import { useCallback, useEffect } from 'react';
import { useTypedSelector } from '@Store/hooks';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import BaseLayerSwitcher from '@Components/common/MapLibreComponents/BaseLayerSwitcher';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import getBbox from '@turf/bbox';
import { FeatureCollection } from 'geojson';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import { useTypedDispatch } from '@UserModule/store/hooks';
import {
  saveProjectImageFile,
  setCreateProjectState,
} from '@Store/actions/createproject';

const MapSection = () => {
  const dispatch = useTypedDispatch();
  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
      preserveDrawingBuffer: true,
    },
    disableRotation: true,
  });

  const projectArea = useTypedSelector(
    state => state.createproject.projectArea,
  );
  const splitGeojson = useTypedSelector(
    state => state.createproject.splitGeojson,
  );
  const capturedProjectMap = useTypedSelector(
    state => state.createproject.capturedProjectMap,
  );

  useEffect(() => {
    if (!projectArea) return;
    const bbox = getBbox(projectArea as FeatureCollection);
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25, duration: 500 });
  }, [map, projectArea]);

  // eslint-disable-next-line no-unused-vars
  const takeScreenshot = useCallback(async () => {
    if (!map || !isMapLoaded || !splitGeojson) return;
    // const data = map.getCanvas().toDataURL('image/jpeg', 0.95);
    map.getCanvas().toBlob(
      (blob: any) => {
        const file = new File([blob], 'project.png', { type: blob.type });
        dispatch(
          saveProjectImageFile({
            projectMapImage: file,
          }),
        );
        dispatch(
          setCreateProjectState({
            capturedProjectMap: true,
          }),
        );
      },
      'image/png',
      0.95,
    );
  }, [map, dispatch, isMapLoaded, splitGeojson]);

  useEffect(() => {
    if (!map || !isMapLoaded || !splitGeojson || capturedProjectMap)
      return () => {};
    // wait 1sec for split geojson is loaded and visible on map and capture
    const captureTimeout = setTimeout(() => {
      takeScreenshot();
    }, 1000);

    return () => clearTimeout(captureTimeout);
  }, [map, takeScreenshot, isMapLoaded, splitGeojson, capturedProjectMap]);

  return (
    <MapContainer
      map={map}
      isMapLoaded={isMapLoaded}
      style={{
        width: '100%',
        height: '100%',
      }}
    >
      <BaseLayerSwitcher />
      {!splitGeojson && (
        <VectorLayer
          map={map as Map}
          isMapLoaded={isMapLoaded}
          id="uploaded-project-area"
          geojson={projectArea}
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
      )}
      <VectorLayer
        map={map as Map}
        isMapLoaded={isMapLoaded}
        id="split-area"
        geojson={splitGeojson as GeojsonType}
        visibleOnMap={!!splitGeojson}
        layerOptions={{
          type: 'fill',
          paint: {
            'fill-color': '#328ffd',
            'fill-opacity': 0.2,
          },
        }}
      />
      <VectorLayer
        map={map as Map}
        isMapLoaded={isMapLoaded}
        id="split-area-outline"
        geojson={splitGeojson as GeojsonType}
        visibleOnMap={!!splitGeojson}
        layerOptions={{
          type: 'line',
          paint: {
            'line-color': '#D33A38',
            'line-width': 1,
          },
        }}
      />
    </MapContainer>
  );
};

export default hasErrorBoundary(MapSection);
