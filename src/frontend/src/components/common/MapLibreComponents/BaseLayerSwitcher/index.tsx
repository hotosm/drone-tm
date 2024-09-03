import { useEffect, useRef } from 'react';
import { IBaseLayerSwitcher } from '../types';
import baseLayersData from './baseLayers';

export default function BaseLayerSwitcher({
  map,
  baseLayers = baseLayersData,
  activeLayer = 'osm',
}: IBaseLayerSwitcher) {
  const previouslyActiveLayer = useRef(activeLayer);

  // add all base layers to map
  useEffect(() => {
    if (!map) return;
    Object.entries(baseLayers).forEach(([key, { layer, source }]) => {
      map.addSource(key, source);
      map.addLayer(layer);
    });
    if (!map.getLayer(activeLayer)) return;
    map.setLayoutProperty(activeLayer, 'visibility', 'visible');
    previouslyActiveLayer.current = activeLayer;
  }, [map, baseLayers]); // eslint-disable-line

  // change visibility layout property based on active layer
  useEffect(() => {
    if (!map) return;
    map.setLayoutProperty(previouslyActiveLayer.current, 'visibility', 'none');
    if (!map.getLayer(activeLayer)) return;
    map.setLayoutProperty(activeLayer, 'visibility', 'visible');
    previouslyActiveLayer.current = activeLayer;
  }, [map, activeLayer]);

  return null;
}
