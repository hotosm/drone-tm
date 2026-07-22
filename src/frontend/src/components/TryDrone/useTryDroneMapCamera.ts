import { useCallback, useEffect, useRef } from 'react';
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
  INITIAL_MAP_ZOOM,
} from '@Constants/tryDrone';

type Params = {
  map: Map | null;
  // Wrapper Boolean to match useMapLibreGLMap's return type.
  isMapLoaded: Boolean;
  step: 1 | 2 | 3;
  // Center to fly to on load: the resumed session's saved center, or (fresh
  // start) the user's geolocation once resolved. `null` while still pending.
  initialCameraCenter: [number, number] | null;
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
  initialCameraCenter,
  polygon,
  grid,
  flightPlan,
  selectedTask,
}: Params) => {
  // Zoom-in animation on page load. Fires once, when both the map is loaded and
  // the initial center is known — for a fresh start that means waiting for the
  // geolocation lookup to resolve (or fail), so we fly straight to the user's
  // location instead of hopping via the [0,0] fallback.
  const flownInRef = useRef(false);
  useEffect(() => {
    if (!map || !isMapLoaded || !initialCameraCenter || flownInRef.current)
      return;
    flownInRef.current = true;
    map.flyTo({
      center: initialCameraCenter,
      zoom: INITIAL_MAP_ZOOM,
      essential: true,
    });
  }, [map, isMapLoaded, initialCameraCenter]);

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
