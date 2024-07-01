/* eslint-disable no-param-reassign */
import { useEffect, useMemo } from 'react';
import type { MapMouseEvent } from 'maplibre-gl';
import { IVectorTileLayer } from '../types';

export default function VectorTileLayer({
  map,
  id,
  url,
  isMapLoaded,
  layerOptions,
  visibleOnMap = true,
  interactions = [],
  onFeatureSelect,
}: IVectorTileLayer) {
  const sourceId = useMemo(() => id.toString(), [id]);

  // add source to map
  useEffect(() => {
    if (!map || !isMapLoaded) return;
    map.addSource(sourceId, {
      type: 'vector',
      tiles: [url],
    });
  }, [isMapLoaded, map, url, sourceId]);

  // add layer to map
  useEffect(() => {
    if (!map || !isMapLoaded) return;
    if (visibleOnMap) {
      map.addLayer({
        id: sourceId,
        type: 'fill',
        source: sourceId,
        'source-layer': 'default',
        layout: {},
        ...layerOptions,
      });
    } else if (map.getLayer(sourceId)) {
      map.removeLayer(sourceId);
    }
  }, [map, isMapLoaded, layerOptions, visibleOnMap, sourceId]);

  // change cursor to pointer on feature hover
  useEffect(() => {
    if (!map) return () => {};
    function onMouseOver() {
      if (!map) return;
      map.getCanvas().style.cursor = 'pointer';
    }
    function onMouseLeave() {
      if (!map) return;
      map.getCanvas().style.cursor = '';
    }
    map.on('mouseover', sourceId, onMouseOver);
    map.on('mouseleave', sourceId, onMouseLeave);

    // remove event handlers on unmount
    return () => {
      map.off('mouseover', onMouseOver);
      map.off('mouseleave', onMouseLeave);
    };
  }, [map, sourceId]);

  // add select interaction & return properties on feature select
  useEffect(() => {
    if (!map || !interactions.includes('select')) return () => {};
    function handleSelectInteraction(event: MapMouseEvent) {
      if (!map) return;
      map.getCanvas().style.cursor = 'pointer';
      // @ts-ignore
      const { features } = event;
      if (!features?.length) return;
      const { properties } = features[0];
      onFeatureSelect?.(properties);
    }
    map.on('click', sourceId, handleSelectInteraction);
    return () => map.off('click', sourceId, handleSelectInteraction);
  }, [map, interactions, sourceId]); // eslint-disable-line

  return null;
}
