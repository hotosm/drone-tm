import { useEffect, useMemo } from 'react';
import { IVectorLayer } from '../types';

export default function VectorLayer({
  map,
  id,
  geojson,
  isMapLoaded,
  layerOptions,
  visibleOnMap = true,
}: IVectorLayer) {
  const sourceId = useMemo(() => id.toString(), [id]);

  useEffect(() => {
    if (!map || !isMapLoaded || !geojson) return;
    if (map.getSource(sourceId)) {
      map?.removeLayer(sourceId);
      map?.removeSource(sourceId);
    }
    map.addSource(sourceId, {
      type: 'geojson',
      data: geojson,
    });
  }, [sourceId, isMapLoaded, map, geojson]);

  useEffect(() => {
    if (!map || !isMapLoaded) return;
    if (visibleOnMap) {
      map.addLayer({
        id: sourceId,
        type: 'line',
        source: sourceId,
        layout: {},
        ...layerOptions,
      });
    } else if (map.getLayer(sourceId)) {
      map.removeLayer(sourceId);
    }
  }, [map, isMapLoaded, visibleOnMap, sourceId, geojson]); // eslint-disable-line

  useEffect(
    () => () => {
      if (map?.getSource(sourceId)) {
        map?.removeLayer(sourceId);
        map?.removeSource(sourceId);
      }
    },
    [map, sourceId],
  );

  return null;
}
