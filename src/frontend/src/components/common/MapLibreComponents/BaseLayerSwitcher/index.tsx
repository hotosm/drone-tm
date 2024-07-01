import { useCallback, useEffect } from 'react';
import { IBaseLayerSwitcher } from '../types';
import baseLayersData from './baseLayers';

let layersCache = {};

export default function BaseLayerSwitcher({
  map,
  baseLayers = baseLayersData,
  activeLayer = 'osm',
}: IBaseLayerSwitcher) {
  const changeStyle = useCallback(() => {
    if (!map?.isStyleLoaded || !map.getStyle()) return;
    const { sources, layers } = map.getStyle();
    if (activeLayer in sources || !(activeLayer in baseLayers)) return;
    layersCache = sources;
    layers.forEach(layer => {
      // @ts-ignore
      if (!layersCache[layer.id]) return;
      // @ts-ignore
      layersCache[layer.id].layer = layer;
    });
    // @ts-ignore
    map.setStyle(baseLayers[activeLayer]);
    Object.keys(layersCache).forEach(key => {
      // @ts-ignore
      const { type, data, layer } = layersCache[key];
      if (!data || !layer) return;
      map.addSource(key, { type, data });
      map.addLayer({ id: key, ...layer });
      map.off('style.load', changeStyle);
    });
  }, [map, baseLayers, activeLayer]);

  useEffect(() => {
    if (!map) return () => {};
    map.once('style.load', changeStyle);
    return () => map.off('style.load', changeStyle);
  }, [map, activeLayer, baseLayers, changeStyle]);

  useEffect(() => {
    if (!map || !map.isStyleLoaded) return;
    changeStyle();
  }, [map, activeLayer, changeStyle]);

  return null;
}
