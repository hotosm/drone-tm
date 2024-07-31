import { useEffect, useState } from 'react';
import { Map } from 'maplibre-gl';
import { IMapOptionsProps, MapInstanceType } from '../types';

export default function useMapLibreGLMap({
  containerId = 'maplibre-gl-map',
  mapOptions,
  enable3D = false,
  disableRotation = false,
}: IMapOptionsProps) {
  const [map, setMap] = useState<MapInstanceType | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState<Boolean>(false);

  // setup map instance
  useEffect(() => {
    const mapInstance = new Map({
      container: containerId,
      style: { version: 8, sources: {}, layers: [] },
      center: [0, 0],
      zoom: 1,
      attributionControl: false,
      ...mapOptions,
    });
    setMap(mapInstance);

    mapInstance.on('load', () => {
      setIsMapLoaded(true);
    });
    // return () => mapInstance.setTarget(undefined);
  }, []); // eslint-disable-line

  // add terrain source for 3D
  useEffect(() => {
    if (!map) return;
    map.on('load', () => {
      map.addSource('terrainSource', {
        type: 'raster-dem',
        tiles: ['https://vtc-cdn.maptoolkit.net/terrainrgb/{z}/{x}/{y}.webp'],
        encoding: 'mapbox',
        maxzoom: 14,
        minzoom: 4,
      });
      setIsMapLoaded(true);
    });
  }, [map]);

  // add 3D terrain
  useEffect(() => {
    if (!map || !isMapLoaded) return;
    if (enable3D) {
      map.setTerrain({ source: 'terrainSource', exaggeration: 0.6 });
    } else {
      // @ts-ignore
      map.setTerrain();
    }
  }, [map, isMapLoaded, enable3D]);

  // disable map pane rotation
  useEffect(() => {
    if (!map || !disableRotation) return;
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
  }, [map, disableRotation]);

  return { map, isMapLoaded };
}
