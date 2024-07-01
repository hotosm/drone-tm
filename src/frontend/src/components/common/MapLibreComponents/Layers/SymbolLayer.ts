import { useEffect, useMemo } from 'react';
import { IVectorTileLayer } from '../types';

export default function SymbolLayer({
  map,
  id,
  url,
  isMapLoaded,
  layerOptions,
  visibleOnMap = true,
}: IVectorTileLayer) {
  const sourceId = useMemo(() => id.toString(), [id]);

  useEffect(() => {
    if (!map || !isMapLoaded) return;
    map.setGlyphs(
      'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    );
  }, [isMapLoaded, map]);

  useEffect(() => {
    if (!map || !isMapLoaded) return;
    map.addSource(sourceId, {
      type: 'vector',
      tiles: [url],
    });
  }, [isMapLoaded, map, url, sourceId]);

  useEffect(() => {
    if (!map || !isMapLoaded) return;
    if (visibleOnMap) {
      map.addLayer({
        id: sourceId,
        type: 'symbol',
        source: sourceId,
        'source-layer': 'default',
        ...layerOptions,
      });
    } else if (map.getLayer(sourceId)) {
      map.removeLayer(sourceId);
    }
  }, [map, isMapLoaded, layerOptions, visibleOnMap, sourceId]);

  return null;
}
