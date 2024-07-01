/* eslint-disable no-unused-vars */
/* eslint-disable no-param-reassign */
import { useEffect, useMemo, useRef } from 'react';
import { DrawMode, Map, Popup } from 'maplibre-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import StaticMode from '@mapbox/mapbox-gl-draw-static-mode';
import length from '@turf/length';
import area from '@turf/area';
import centroid from '@turf/centroid';
import { measureStyles } from '@Constants/map';

export interface IMeasureToolProps {
  map?: Map | null;
  isMapLoaded?: boolean;
  enable: boolean;
  drawMode?: DrawMode | null | undefined;
  styles?: Record<string, any>[];
  measureType: 'length' | 'area' | null;
  onDrawChange?: (props: { measurement: number; unit: string }) => void;
  onDrawComplete?: (data: Record<string, any>) => void;
}

const { modes } = MapboxDraw;
// @ts-ignore
modes.static = StaticMode;

const popup = new Popup({
  closeButton: false,
  closeOnClick: false,
  className: 'measure-tooltip',
});

export default function MeasureTool({
  map,
  isMapLoaded,
  enable = false,
  measureType = 'length',
  onDrawChange,
  onDrawComplete,
}: IMeasureToolProps) {
  const isMeasureCompleted = useRef(false);

  const draw = useMemo(
    () =>
      new MapboxDraw({
        displayControlsDefault: false,
        defaultMode: 'draw_polygon',
        // @ts-ignore
        modes,
        styles: measureStyles,
        drawControl: true,
      }),
    [],
  );

  useEffect(() => {
    // @ts-ignore
    if (!map || !isMapLoaded || !enable || map.hasControl(draw))
      return () => {};
    // @ts-ignore
    map.addControl(draw);
    draw.changeMode(
      // @ts-ignore
      measureType === 'length' ? 'draw_line_string' : 'draw_polygon',
    );
    return () => {
      // @ts-ignore
      map.removeControl(draw);
      isMeasureCompleted.current = false;
      popup.remove();
    };
  }, [map, isMapLoaded, enable, draw, measureType]);

  useEffect(() => {
    if (!map || !enable) return () => {};
    function handleDrawRender() {
      const data = draw.getAll();
      const geomType = data.features[0].geometry.type;
      const measurement =
        geomType === 'LineString'
          ? length(data, { units: 'meters' })
          : area(data);
      if (!measurement || !map) return;
      onDrawChange?.({
        measurement,
        unit: geomType === 'LineString' ? 'm' : 'm²',
      });
      onDrawComplete?.(data);
      if (geomType === 'Polygon') {
        // @ts-ignore
        const centroidGeojson = centroid(data);
        const { coordinates } = centroidGeojson.geometry;
        if (!coordinates) return;
        popup
          .setLngLat(coordinates as [number, number])
          .setHTML(`${measurement.toFixed(2)} m².`)
          .addTo(map);
      }
      if (geomType === 'LineString') {
        const { coordinates } = data.features[0].geometry;
        const lastPoint = coordinates[coordinates.length - 1];
        if (!lastPoint) return;
        popup
          .setLngLat(lastPoint as [number, number])
          .setHTML(`${measurement.toFixed(2)} m.`)
          .addTo(map);
      }
    }
    map.on('draw.render', handleDrawRender);
    return () => {
      map.off('draw.render', handleDrawRender);
    };
  }, [map, draw, enable]); // eslint-disable-line

  useEffect(() => {
    if (!map || !enable) return () => {};
    function handleDrawCreate() {
      if (!map) return;
      isMeasureCompleted.current = true;
    }
    map.on('draw.create', handleDrawCreate);
    return () => {
      map.off('draw.create', handleDrawCreate);
      isMeasureCompleted.current = false;
    };
  }, [map, draw, enable]);

  useEffect(() => {
    if (!map || !enable) return () => {};
    const handleMouseMove = () => {
      if (!map) return;
      if (isMeasureCompleted.current) {
        map.getCanvas().style.cursor = '';
      } else {
        map.getCanvas().style.cursor = 'crosshair';
      }
    };
    map.on('mousemove', handleMouseMove);
    return () => {
      map.off('mousemove', handleMouseMove);
      map.getCanvas().style.cursor = '';
    };
  }, [map, enable]);

  return null;
}
