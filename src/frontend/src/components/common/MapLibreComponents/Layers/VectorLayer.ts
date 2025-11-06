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
  onDrag,
  onDragEnd,
  needDragEvent = false,
  imageLayoutOptions = {},
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

        map.setGlyphs('https://fonts.openmaptiles.org/{fontstack}/{range}.pbf');

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
            ...imageLayoutOptions,
          },
          ...imageLayerOptions,
        });
      }
    } else if (map.getLayer(`${sourceId}-layer`)) {
      map.removeLayer(`${sourceId}-layer`);
    }

    // eslint-disable-next-line consistent-return
  }, [map, isMapLoaded, visibleOnMap, sourceId, geojson, layerOptions]); // eslint-disable-line

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

    map.on('click', `${sourceId}-layer`, handleSelectInteraction);
    return () => {
      map.off('click', `${sourceId}-layer`, handleSelectInteraction);
    };
  }, [map, interactions, sourceId, onFeatureSelect]);

  useEffect(() => {
    if (!map || !geojson || !onDrag || !onDragEnd || !needDragEvent)
      return () => {};

    let isDragging = false;
    // let startCoordinates: [number, number] | null = null;
    let originalCoordinates: [number, number] | null = null;

    const onMouseDown = (event: MapMouseEvent) => {
      originalCoordinates = [event.lngLat.lng, event.lngLat.lat];
      // const features = map.queryRenderedFeatures(event.point, {
      //   layers: [`${sourceId}-layer`],
      // });
      // if (!features.length) return;

      isDragging = true;
      // startCoordinates = [event.lngLat.lng, event.lngLat.lat];
      map.getCanvas().style.cursor = 'grab';
    };

    const onMouseMove = (event: MapMouseEvent) => {
      if (!isDragging || !originalCoordinates) return;

      // Call the provided onDrag function with the angle
      onDrag({ originalCoordinates, ...event, isDragging });
    };

    const onMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        map.getCanvas().style.cursor = '';
      }
      onDragEnd();
    };

    map.on('mousedown', `${sourceId}-layer`, onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);

    return () => {
      map.off('mousedown', `${sourceId}-layer`, onMouseDown);
      map.off('mousemove', onMouseMove);
      map.off('mouseup', onMouseUp);
    };
  }, [map, geojson, sourceId, onDrag, onDragEnd, needDragEvent]);

  useEffect(
    () => () => {
      if (map?.getSource(sourceId)) {
        if (map?.getLayer(sourceId)) map?.removeLayer(sourceId);
        if (map?.getLayer(imageId)) map?.removeLayer(imageId);
        if (map?.getLayer(`${sourceId}-layer`))
          map?.removeLayer(`${sourceId}-layer`);
        if (map?.getLayer(`${sourceId}-image/logo`))
          map?.removeLayer(`${sourceId}-image/logo`);
        map?.removeSource(sourceId);
      }
    },
    [map, sourceId, imageId],
  );

  return null;
}
