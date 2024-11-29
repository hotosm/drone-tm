/* eslint-disable no-param-reassign */
import { useEffect, useMemo, useRef } from 'react';
import { LngLatLike, MapMouseEvent } from 'maplibre-gl';
import bbox from '@turf/bbox';
import { toast } from 'react-toastify';
import { Feature, FeatureCollection } from 'geojson';
// import { v4 as uuidv4 } from 'uuid';
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
  zoomToExtent = false,
}: IVectorLayer) {
  const sourceId = useMemo(() => id.toString(), [id]);
  const hasInteractions = useRef(false);
  const firstRender = useRef(true);
  const imageId = `${sourceId}-image/logo`;

  useEffect(() => {
    hasInteractions.current = !!interactions.length;
  }, [interactions]);

  useEffect(() => {
    if (!map || !isMapLoaded || !geojson) return;

    if (map?.getSource(sourceId)) {
      if (map?.getLayer(sourceId)) map?.removeLayer(sourceId);
      if (map?.getLayer(imageId)) map?.removeLayer(imageId);
      if (map?.getLayer(`${sourceId}-layer`))
        map?.removeLayer(`${sourceId}-layer`);
      map?.removeSource(sourceId);
    }

    map.addSource(sourceId, {
      type: 'geojson',
      data: geojson,
    });
  }, [sourceId, isMapLoaded, map, geojson, imageId]);

  useEffect(() => {
    if (!map || !isMapLoaded) return;
    if (visibleOnMap) {
      map.addLayer({
        id: `${sourceId}-layer`,
        type: 'line',
        source: sourceId,
        layout: {},
        ...layerOptions,
      });

      if (hasImage) {
        // map.loadImage(image, (error, img: any) => {
        //   if (error) throw error;
        //   // Add the loaded image to the style's sprite with the ID 'kitten'.
        //   map.addImage(imageId, img);
        // });

        // changes on map libre 4
        map.loadImage(image).then(({ data }) => {
          if (!map.hasImage(imageId)) {
            map.addImage(imageId, data);
          }
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

  useEffect(() => {
    if (!map || !geojson || !zoomToExtent) return;
    if (!firstRender.current) return;
    firstRender.current = false;

    const handleZoom = () => {
      if (!map || !geojson || !zoomToExtent) return;
      let parsedGeojson: Feature | FeatureCollection;

      // Parse GeoJSON if it's a string
      if (typeof geojson === 'string') {
        try {
          parsedGeojson = JSON.parse(geojson) as Feature | FeatureCollection;
        } catch (error) {
          toast.error(
            'Invalid GeoJSON string:',
            (error as Record<string, any>)?.message,
          );
          return;
        }
      } else {
        parsedGeojson = geojson as Feature | FeatureCollection;
      }
      const [minLng, minLat, maxLng, maxLat] = bbox(parsedGeojson);
      const bounds: [LngLatLike, LngLatLike] = [
        [minLng, minLat], // Southwest corner
        [maxLng, maxLat], // Northeast corner
      ];

      // Zoom to the bounds
      map.fitBounds(bounds, {
        padding: 20,
        maxZoom: 14,
        zoom: 18,
        // animate: false,
        duration: 300,
      });
      map.off('idle', handleZoom);
    };

    map.on('idle', handleZoom);
    // eslint-disable-next-line consistent-return
    return () => {
      map.off('idle', handleZoom);
    };
  }, [map, geojson, zoomToExtent]);

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
        if (map?.getLayer(sourceId)) map?.removeLayer(sourceId);
        if (map?.getLayer(imageId)) map?.removeLayer(imageId);
        if (map?.getLayer(`${sourceId}-layer`))
          map?.removeLayer(`${sourceId}-layer`);
        map?.removeSource(sourceId);
      }
    },
    [map, sourceId, imageId],
  );

  return null;
}
