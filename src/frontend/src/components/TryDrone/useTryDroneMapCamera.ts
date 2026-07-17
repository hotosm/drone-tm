import { useCallback, useEffect } from 'react';
import { LngLatBoundsLike, Map } from 'maplibre-gl';
import { Polygon } from 'geojson';
import getBbox from '@turf/bbox';
import { featureBbox, geometriesBbox } from '@Utils/geometry';
import { FlightPlanData, FlightPreviewTask } from '@Services/tryDrone';
import {
  FIT_DURATION,
  FIT_PADDING_FLIGHT,
  FIT_PADDING_GRID,
  GLYPHS_URL,
  INITIAL_MAP_CENTER,
  INITIAL_MAP_ZOOM,
} from '@Constants/tryDrone';

type Params = {
  map: Map | null;
  // Wrapper Boolean to match useMapLibreGLMap's return type.
  isMapLoaded: Boolean;
  step: 1 | 2 | 3;
  polygon: Polygon;
  grid: FlightPreviewTask[];
  flightPlan: FlightPlanData | null;
  selectedTask: FlightPreviewTask | null;
};

/**
 * Camera side-effects for the try-drone map: the load-in zoom, glyph setup for
 * label rendering, and the fitBounds passes when the grid or flight plan
 * appears. Also returns a manual "fit to current step" handler for the zoom UI.
 */
export const useTryDroneMapCamera = ({
  map,
  isMapLoaded,
  step,
  polygon,
  grid,
  flightPlan,
  selectedTask,
}: Params) => {
  // Zoom-in animation on page load
  useEffect(() => {
    if (!map || !isMapLoaded) return;
    map.flyTo({
      center: INITIAL_MAP_CENTER,
      zoom: INITIAL_MAP_ZOOM,
      essential: true,
    });
  }, [map, isMapLoaded]);

  // Glyphs are required for maplibre to render text symbol layers (grid cell labels)
  useEffect(() => {
    if (!map || !isMapLoaded) return;
    map.setGlyphs(GLYPHS_URL);
  }, [map, isMapLoaded]);

  // Zoom to grid extent when entering step 2
  useEffect(() => {
    if (step !== 2 || !map || !grid.length) return;
    map.fitBounds(
      geometriesBbox(grid.map(t => t.geometry)) as LngLatBoundsLike,
      {
        padding: FIT_PADDING_GRID,
        duration: FIT_DURATION,
      },
    );
  }, [step, map, grid]);

  // Zoom to the flight line once a flight plan is generated
  useEffect(() => {
    if (!map || !flightPlan) return;
    map.fitBounds(getBbox(flightPlan.geojsonAsLineString) as LngLatBoundsLike, {
      padding: FIT_PADDING_FLIGHT,
      duration: FIT_DURATION,
    });
  }, [map, flightPlan]);

  const handleFitToBounds = useCallback(() => {
    if (!map) return;
    let bbox: ReturnType<typeof getBbox> | null = null;
    if (step === 1) {
      bbox = featureBbox(polygon);
    } else if (step === 2 && grid.length) {
      bbox = geometriesBbox(grid.map(t => t.geometry));
    } else if (step === 3 && flightPlan) {
      bbox = getBbox(flightPlan.geojsonAsLineString);
    } else if (step === 3 && selectedTask) {
      bbox = featureBbox(selectedTask.geometry);
    }
    if (bbox)
      map.fitBounds(bbox as LngLatBoundsLike, {
        padding: FIT_PADDING_GRID,
        duration: FIT_DURATION,
      });
  }, [map, step, polygon, grid, flightPlan, selectedTask]);

  return { handleFitToBounds };
};
