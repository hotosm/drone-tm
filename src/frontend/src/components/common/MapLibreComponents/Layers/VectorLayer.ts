/* eslint-disable no-param-reassign */
import { useEffect, useMemo, useRef } from 'react';
import { MapMouseEvent } from 'maplibre-gl';
import { v4 as uuidv4 } from 'uuid';
import { IVectorLayer } from '../types';

export default function VectorLayer({
  map,
  id,
  geojson,
  isMapLoaded,
  interactions = [],
  layerOptions,
  onFeatureSelect,
  visibleOnMap = true,
  hasImage = false,
  image,
  symbolPlacement = 'point',
  iconAnchor = 'center',
  imageLayerOptions,
}: IVectorLayer) {
  const sourceId = useMemo(() => id.toString(), [id]);
  const hasInteractions = useRef(false);

  useEffect(() => {
    hasInteractions.current = !!interactions.length;
  }, [interactions]);

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

      if (hasImage) {
        const imageId = uuidv4();
        map.loadImage(image, (error, img: any) => {
          if (error) throw error;
          // Add the loaded image to the style's sprite with the ID 'kitten'.
          map.addImage(imageId, img);
        });
        map.addLayer({
          id: imageId,
          type: 'symbol',
          source: sourceId,
          layout: {
            'symbol-placement': symbolPlacement,
            'icon-image': imageId,
            'icon-size': 0.8,
            'icon-overlap': 'always',
            'icon-anchor': iconAnchor,
          },
          ...imageLayerOptions,
        });
      }
    } else if (map.getLayer(sourceId)) {
      map.removeLayer(sourceId);
    }
  }, [map, isMapLoaded, visibleOnMap, sourceId, geojson]); // eslint-disable-line

  // change cursor to pointer on feature hover
  useEffect(() => {
    if (!map) return () => {};
    function onMouseOver() {
      if (!map || !hasInteractions.current) return;
      map.getCanvas().style.cursor = 'pointer';
    }
    function onMouseLeave() {
      if (!map || !hasInteractions.current) return;
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
    if (!map || !interactions.includes('feature')) return () => {};
    function handleSelectInteraction(event: MapMouseEvent) {
      if (!map) return;
      map.getCanvas().style.cursor = 'pointer';
      // @ts-ignore
      const { features } = event;
      if (!features?.length) return;
      const { properties, layer } = features[0];
      onFeatureSelect?.({ ...properties, layer: layer?.id });
    }
    map.on('click', sourceId, handleSelectInteraction);
    return () => map.off('click', sourceId, handleSelectInteraction);
  }, [map, interactions, sourceId, onFeatureSelect]);

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
