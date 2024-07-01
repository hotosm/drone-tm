import { useCallback, useEffect, useMemo } from 'react';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import StaticMode from '@mapbox/mapbox-gl-draw-static-mode';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { DrawModeTypes, IUseDrawToolProps } from '../types';

const { modes } = MapboxDraw;
// @ts-ignore
modes.static = StaticMode;

export default function useDrawTool({
  map,
  enable,
  drawMode,
  styles,
  geojson,
  onDrawEnd,
}: IUseDrawToolProps) {
  const draw = useMemo(
    () =>
      new MapboxDraw({
        displayControlsDefault: false,
        // controls: {
        //   polygon: true,
        //   trash: true,
        // },
        styles,
        defaultMode: 'draw_polygon',
        // @ts-ignore
        modes,
      }),
    [], // eslint-disable-line
  );

  useEffect(() => {
    if (!map) return;
    if (!enable || !drawMode) {
      // @ts-ignore
      if (map.hasControl(draw)) {
        // @ts-ignore
        map.removeControl(draw);
      }
      return;
    }
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
        draw.changeMode('static');
      }
    }
  }, [map, draw, enable, drawMode, geojson]);

  // useEffect(() => {
  //   if (!enable || !drawMode) return;
  //   // @ts-ignore
  //   if (map?.hasControl(draw)) {
  //     // @ts-ignore
  //     draw.changeMode(drawMode);
  //   }
  // }, [map, enable, draw, drawMode]);

  useEffect(() => {
    if (!map) return () => {};
    function handleDrawEnd() {
      const data = draw.getAll();
      onDrawEnd(data);
      // draw.changeMode('static');
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
  }, [map, draw, onDrawEnd]);

  const resetDraw = useCallback(() => {
    if (!map) return;
    // @ts-ignore
    if (map.hasControl(draw)) {
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
      } else {
        // @ts-ignore
        draw.changeMode(drawMode);
      }
    }
    onDrawEnd(null);
    // draw.changeMode('static');
  }, [map, draw, drawMode, geojson]); // eslint-disable-line

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

  return { draw, resetDraw, setDrawMode };
}
