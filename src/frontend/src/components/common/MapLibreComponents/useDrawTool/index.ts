/* eslint-disable no-param-reassign */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Popup } from 'maplibre-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import StaticMode from '@mapbox/mapbox-gl-draw-static-mode';
import CutLineMode from 'mapbox-gl-draw-cut-line-mode';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import DirectionArrow from '@Assets/images/navigation-image.png';
import { DrawModeTypes, IUseDrawToolProps } from '../types';
import reverseLineString from '../helpers/reverseLineString';

const { modes } = MapboxDraw;
// @ts-ignore
modes.static = StaticMode;
// @ts-ignore
modes.cut_line = CutLineMode;

const popup = new Popup({
  closeButton: false,
  closeOnClick: false,
  className: 'map-tooltip',
  offset: 12,
});

const lineStringTypes = ['LineString', 'MultiLineString'];

export default function useDrawTool({
  map,
  enable,
  drawMode,
  styles,
  geojson,
  onDrawEnd,
}: IUseDrawToolProps) {
  const [isFeatureSelected, setIsFeatureSelected] = useState(false);
  const [isDrawLayerAdded, setIsDrawLayerAdded] = useState(false);
  const [drawStates, setDrawStates] = useState<any[]>([]);
  const [redoStates, setRedoStates] = useState<any[]>([]);

  // create draw instance
  const draw = useMemo(
    () =>
      new MapboxDraw({
        displayControlsDefault: false,
        styles,
        defaultMode: 'draw_polygon',
        // @ts-ignore
        modes,
        drawControl: true,
      }),
    [], // eslint-disable-line
  );

  // check if draw layer is added to map
  useEffect(() => {
    if (!map) return () => {};
    function handleSourceDataAdd(e: any) {
      if (e.sourceId !== 'mapbox-gl-draw-cold') return;
      setIsDrawLayerAdded(true);
    }
    map.on('sourcedata', handleSourceDataAdd);
    return () => {
      map.off('sourcedata', handleSourceDataAdd);
    };
  }, [map]);

  // add control to map & geojson to draw
  useEffect(() => {
    if (!map || !enable || !drawMode) return;
    // @ts-ignore
    if (!map.hasControl(draw)) {
      // @ts-ignore
      map.addControl(draw);
      // @ts-ignore
      draw.changeMode(drawMode);
      // @ts-ignore
      if (geojson) {
        // @ts-ignore
        draw.add(geojson);
      }
    }
  }, [map, draw, enable, drawMode, geojson]);

  // draw event listener
  useEffect(() => {
    if (!map || !enable) return () => {};
    function handleDrawEnd() {
      const data = draw.getAll();
      onDrawEnd(data);
      setDrawStates(prev => [...prev, data]);
    }
    map.on('draw.create', handleDrawEnd);
    map.on('draw.delete', handleDrawEnd);
    map.on('draw.update', handleDrawEnd);
    map.on('draw.resetDraw', handleDrawEnd);
    return () => {
      map.off('draw.create', handleDrawEnd);
      map.off('draw.delete', handleDrawEnd);
      map.off('draw.update', handleDrawEnd);
      map.off('draw.resetDraw', handleDrawEnd);
    };
  }, [map, draw, enable, onDrawEnd]);

  useEffect(() => {
    if (!map || !enable) return () => {};
    function handleDrawEnd() {
      const selectedIds = draw.getSelectedIds();
      setIsFeatureSelected(!!selectedIds.length);
    }
    map.on('draw.selectionchange', handleDrawEnd);
    return () => {
      map.off('draw.selectionchange', handleDrawEnd);
    };
  }, [map, enable, draw]);

  // add start/end circle marker to lineStringTypes
  useEffect(() => {
    if (!map || !geojson || !enable || !isDrawLayerAdded || isFeatureSelected)
      return () => {};
    const featureCollection = draw.getAll();
    const { geometry } = featureCollection.features[0];
    if (!lineStringTypes.includes(geometry.type)) return () => {};
    // @ts-ignore
    const coordinates = featureCollection.features[0].geometry?.coordinates;
    const firstCoords = coordinates[0];
    const lastCoords = coordinates[coordinates.length - 1];
    map.addSource('line-start-point', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: firstCoords,
        },
      },
    });
    map.addSource('line-end-point', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: lastCoords,
        },
      },
    });
    map.addLayer({
      id: 'line-start-point',
      type: 'circle',
      source: 'line-start-point',
      paint: {
        'circle-radius': 6,
        'circle-color': '#0088F8',
      },
    });
    map.addLayer({
      id: 'line-end-point',
      type: 'circle',
      source: 'line-end-point',
      paint: {
        'circle-radius': 6,
        'circle-color': '#e55e5e',
      },
    });
    return () => {
      map.removeLayer('line-start-point');
      map.removeLayer('line-end-point');
      map.removeSource('line-start-point');
      map.removeSource('line-end-point');
    };
  }, [map, draw, geojson, enable, isDrawLayerAdded, isFeatureSelected]);

  // add direction arrow to lineStringTypes
  useEffect(() => {
    if (!map || !enable || !geojson || !isDrawLayerAdded || isFeatureSelected)
      return () => {};
    const featureCollection = draw.getAll();
    const { geometry } = featureCollection.features[0];
    if (!lineStringTypes.includes(geometry.type)) return () => {};
    map.loadImage(DirectionArrow, (err, image) => {
      if (err) return;
      if (map.getLayer('arrowId')) return;
      // @ts-ignore
      map.addImage('arrow', image);
      map.addLayer({
        id: 'arrowId',
        type: 'symbol',
        source: 'mapbox-gl-draw-cold',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 100,
          'icon-allow-overlap': false,
          'icon-image': 'arrow',
          'icon-size': 0.5,
          visibility: 'visible',
          'icon-rotate': 90,
        },
      });
    });
    return () => {
      if (map.getLayer('arrowId')) {
        map.removeImage('arrow');
        map.removeLayer('arrowId');
      }
    };
  }, [map, draw, geojson, enable, isDrawLayerAdded, isFeatureSelected]);

  // add tooltip before draw start
  useEffect(() => {
    if (!map || !drawMode?.includes('draw') || isDrawLayerAdded)
      return () => {};
    const handleMouseMove = (e: any) => {
      // map.getCanvas().style.cursor = 'crosshair';
      map.getCanvas().style.cursor = '';
      const description = 'Click to start drawing shape';
      popup.setLngLat(e.lngLat).setHTML(description).addTo(map);
    };
    map.on('mousemove', handleMouseMove);
    return () => {
      map.off('mousemove', handleMouseMove);
      // map.getCanvas().style.cursor = '';
      map.getCanvas().style.cursor = 'crosshair';
      popup.remove();
    };
  }, [map, drawMode, isDrawLayerAdded]);

  // remove draw control on unmount
  useEffect(() => {
    if (!map) return () => {};
    return () => {
      // @ts-ignore
      if (map.hasControl(draw)) {
        // @ts-ignore
        map.removeControl(draw);
        setIsDrawLayerAdded(false);
        setIsFeatureSelected(false);
        setDrawStates([]);
        setRedoStates([]);
      }
    };
  }, [map, draw, enable, drawMode, geojson]);

  // reset draw function
  const resetDraw = useCallback(() => {
    if (!map) return;
    // @ts-ignore
    if (map.hasControl(draw)) {
      // remove arrow layer before removing control
      if (map.getLayer('arrowId')) {
        map.removeImage('arrow');
        map.removeLayer('arrowId');
      }
      // @ts-ignore
      map.removeControl(draw);
    }
    // @ts-ignore
    map.addControl(draw);
    // @ts-ignore
    if (drawMode) {
      // @ts-ignore
      if (geojson) {
        draw.changeMode('static');
        // setIsDrawLayerAdded(true);
      } else {
        // @ts-ignore
        draw.changeMode(drawMode);
      }
    }
    onDrawEnd(null);
    setDrawStates([]);
    setIsDrawLayerAdded(false);
  }, [map, draw, drawMode, geojson]); // eslint-disable-line

  // set draw mode
  const setDrawMode = useCallback(
    (mode: DrawModeTypes) => {
      if (!map || !enable || !mode) {
        // @ts-ignore
        if (map?.hasControl(draw)) {
          // @ts-ignore
          map?.removeControl(draw);
          return;
        }
        return;
      }
      // @ts-ignore
      if (map.hasControl(draw)) {
        // @ts-ignore
        if (geojson) {
          draw.changeMode('static');
        } else {
          // @ts-ignore
          draw.changeMode(drawMode);
        }
      }
    },
    [map, draw, enable, geojson, drawMode],
  );

  // console.log(geojson, 'geojson');

  // Function to undo the last drawn coordinate
  const undo = useCallback(() => {
    if (drawStates.length <= 1) {
      const lastLine = drawStates[drawStates.length - 1];
      if (lastLine) {
        const { coordinates } = lastLine.features[0].geometry;
        if (coordinates.length > 1) {
          const updatedCoordinates = coordinates.slice(0, -1); // Remove the last coordinate
          const updatedLine = {
            ...lastLine,
            features: [
              {
                ...lastLine.features[0],
                geometry: {
                  ...lastLine.features[0].geometry,
                  coordinates: updatedCoordinates,
                },
              },
            ],
          };
          setRedoStates([...redoStates, lastLine]); // Track the undone state for redo
          setDrawStates(prev => [...prev.slice(0, -1), updatedLine]); // Update the line history with the modified line
          draw.delete(lastLine.features[0].id); // Delete the last drawn line from the map
          draw.add(updatedLine); // Add the updated line back to the map
          onDrawEnd(updatedLine);
        } else {
          setRedoStates([...redoStates, lastLine]); // Track the undone state for redo
          setDrawStates(prev => prev.slice(0, -1)); // Remove the line from the line history
          draw.delete(lastLine.features[0].id); // Delete the last drawn line from the map
        }
      }
    } else {
      const nextStates = drawStates.slice(0, -1);
      setRedoStates([...redoStates, drawStates[drawStates.length - 1]]); // Track the undone state for redo
      if (drawStates.length >= 1) {
        draw.deleteAll();
      }
      const currentState = nextStates[nextStates.length - 1];
      draw.add(currentState);
      onDrawEnd(currentState);
      setDrawStates(nextStates);
    }
  }, [drawStates, draw, onDrawEnd, redoStates]);

  const redo = useCallback(() => {
    const nextState = redoStates[redoStates.length - 1];
    if (nextState) {
      setDrawStates(prev => [...prev, nextState]); // Add the next state to drawStates
      setRedoStates(prev => prev.slice(0, -1)); // Remove the next state from redoStates
      draw.deleteAll();
      draw.add(nextState);
      onDrawEnd(nextState);
    }
  }, [redoStates, draw, onDrawEnd]);

  // useEffect to handle undo and redo events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undo();
      } else if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [undo, redo]);

  // reverse line geometry
  const reverseLineGeometry = useCallback(() => {
    const reversedLineString = reverseLineString(draw.getAll());
    draw.set(reversedLineString);
    onDrawEnd(reversedLineString);
    setIsFeatureSelected(false);
    setIsDrawLayerAdded(false);
  }, [draw, onDrawEnd]);

  return { draw, resetDraw, setDrawMode, reverseLineGeometry, undo, redo };
}
