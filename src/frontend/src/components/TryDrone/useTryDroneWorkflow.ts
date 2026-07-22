import { useEffect, useMemo, useRef, useState } from 'react';
import { Polygon } from 'geojson';
import { coordAll } from '@turf/meta';
import { buildSquareKm2, polygonBboxCenter } from '@Utils/geometry';
import { useFlightPreviewMutation, useFlightPlanMutation } from '@Api/tryDrone';
import { useUserLocation } from '@Components/TryDrone/useUserLocation';
import {
  FlightPlanData,
  FlightPlanResponse,
  FlightPreviewTask,
} from '@Services/tryDrone';
import {
  DEFAULT_ALTITUDE,
  DEFAULT_AREA_KM2,
  DEFAULT_DRONE_MODEL,
  DEFAULT_GRID_DIMENSION,
  INITIAL_MAP_CENTER,
  PREVIEW_DEBOUNCE_MS,
  STORAGE_KEY,
} from '@Constants/tryDrone';

// The slice of workflow state persisted to localStorage (current step + inputs).
type PersistedState = {
  step: 1 | 2 | 3;
  altitude: number;
  gridDimension: number;
  areaKm2: number;
  droneModel: string;
  selectedTaskId: string | null;
  center: [number, number];
};

// Bump when the persisted shape changes so stale blobs are discarded on read.
const STATE_VERSION = 1;

const DEFAULT_STATE: PersistedState = {
  step: 1,
  altitude: DEFAULT_ALTITUDE,
  gridDimension: DEFAULT_GRID_DIMENSION,
  areaKm2: DEFAULT_AREA_KM2,
  droneModel: DEFAULT_DRONE_MODEL,
  selectedTaskId: null,
  center: INITIAL_MAP_CENTER,
};

// Read the persisted slice, falling back to defaults on a missing/corrupt/
// version-mismatched value. Clamps `step` in case it's out of range.
// `hydrated` reports whether a valid persisted blob was found, so the workflow
// can tell a resumed session (keep its saved center) apart from a fresh start
// (center on the user's geolocation instead).
function readPersistedState(): { state: PersistedState; hydrated: boolean } {
  const fresh = { state: DEFAULT_STATE, hydrated: false };
  if (typeof localStorage === 'undefined') return fresh;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return fresh;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState> & {
      version?: number;
    };
    if (parsed.version !== STATE_VERSION) return fresh;
    return {
      hydrated: true,
      state: {
        step: parsed.step === 2 || parsed.step === 3 ? parsed.step : 1,
        altitude: parsed.altitude ?? DEFAULT_STATE.altitude,
        gridDimension: parsed.gridDimension ?? DEFAULT_STATE.gridDimension,
        areaKm2: parsed.areaKm2 ?? DEFAULT_STATE.areaKm2,
        droneModel: parsed.droneModel ?? DEFAULT_STATE.droneModel,
        selectedTaskId: parsed.selectedTaskId ?? null,
        center:
          Array.isArray(parsed.center) && parsed.center.length === 2
            ? (parsed.center as [number, number])
            : DEFAULT_STATE.center,
      },
    };
  } catch {
    return fresh;
  }
}

function writePersistedState(state: PersistedState) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: STATE_VERSION, ...state }),
  );
}

// Build the derived flight-plan state from a raw flight-plan API response: the
// waypoints as-is plus a LineString view of the same path.
function toFlightPlanData(data: FlightPlanResponse): FlightPlanData {
  return {
    droneMetadata: data.drone_metadata,
    geojsonListOfPoints: data,
    geojsonAsLineString: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: coordAll(data),
          },
        },
      ],
    },
  };
}

// The task selected by default when none is restored: the first grid cell,
// which the backend labels "A1" (row A, column 1 — the northmost, westmost
// cell). Falls back to the first task in case the A1 label is ever absent.
const defaultTaskId = (tasks: FlightPreviewTask[]): string | null =>
  (tasks.find(t => t.id === 'A1') ?? tasks[0])?.id ?? null;

/**
 * Owns the "Fly My Drone" step state machine and all the form state it drives.
 *
 * Form state and the workflow are kept together because they're tightly
 * coupled: `generateFlightPlan` needs the altitude/model, and the polygon
 * rebuild + debounced preview effects are gated on the current step.
 *
 * The step and input values are persisted to localStorage so a reload resumes
 * where the user left off; grid/flightPlan are re-fetched on mount instead
 * (see the rehydration effect below).
 */
export const useTryDroneWorkflow = () => {
  // Read the persisted slice once; each field seeds its own state below.
  // `hydrated` distinguishes a resumed session from a fresh start.
  const [{ state: initialState, hydrated }] = useState(readPersistedState);

  const [step, setStep] = useState<1 | 2 | 3>(initialState.step);
  const [altitude, setAltitude] = useState(initialState.altitude);
  const [gridDimension, setGridDimension] = useState(
    initialState.gridDimension,
  );
  const [areaKm2, setAreaKm2] = useState(initialState.areaKm2);
  const [mapCenter, setMapCenter] =
    useState<[number, number]>(initialState.center);
  const [polygon, setPolygon] = useState<Polygon>(() =>
    buildSquareKm2(initialState.center, initialState.areaKm2),
  );
  const [grid, setGrid] = useState<FlightPreviewTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    initialState.selectedTaskId,
  );
  const [droneModel, setDroneModel] = useState(initialState.droneModel);
  const [flightPlan, setFlightPlan] = useState<FlightPlanData | null>(null);

  // Persist the whole slice as one blob whenever any part changes.
  useEffect(() => {
    writePersistedState({
      step,
      altitude,
      gridDimension,
      areaKm2,
      droneModel,
      selectedTaskId,
      center: mapCenter,
    });
  }, [
    step,
    altitude,
    gridDimension,
    areaKm2,
    droneModel,
    selectedTaskId,
    mapCenter,
  ]);

  // On a fresh start, center the initial AOI on the user's geolocation; a
  // resumed session keeps its saved center, so we skip the request entirely.
  const { location: userLocation, status: locationStatus } =
    useUserLocation(!hydrated);

  // Apply the resolved location once to the (default) center so the step-1
  // polygon effect rebuilds the AOI there.
  const locationAppliedRef = useRef(false);
  useEffect(() => {
    if (hydrated || locationAppliedRef.current || !userLocation) return;
    locationAppliedRef.current = true;
    setMapCenter(userLocation);
  }, [hydrated, userLocation]);

  // The one-shot center the camera should fly to on load. A resumed session
  // knows it immediately (its saved center); a fresh start holds at `null`
  // while geolocation is pending, then resolves to the user location on success
  // or the [0,0] fallback on error/unavailable — so the camera never jumps to
  // the fallback and back.
  const initialCameraCenter = useMemo<[number, number] | null>(() => {
    if (hydrated) return initialState.center;
    if (locationStatus === 'success' && userLocation) return userLocation;
    if (locationStatus === 'error') return INITIAL_MAP_CENTER;
    return null;
  }, [hydrated, locationStatus, userLocation, initialState.center]);

  const { mutate: fetchFlightPreview, isPending: loading } =
    useFlightPreviewMutation();
  const { mutate: fetchFlightPlan, isPending: flightPlanLoading } =
    useFlightPlanMutation();

  // Recompute preview polygon whenever center or area changes (step 1 only)
  useEffect(() => {
    if (step === 1) setPolygon(buildSquareKm2(mapCenter, areaKm2));
  }, [mapCenter, areaKm2, step]);

  // Live grid preview in step 1: refetch the task grid whenever the AOI or grid
  // size changes, so the map shows how the area splits before continuing.
  // Clear the old grid immediately so it never lingers misaligned over the
  // resized AOI while the (debounced) refetch is in flight; it redraws on
  // success. Debounced because dragging / sliding updates the polygon on every
  // frame.
  useEffect(() => {
    if (step !== 1) return undefined;
    setGrid([]);
    const timer = setTimeout(() => {
      fetchFlightPreview(
        { polygon, cellSizeMeters: gridDimension },
        { onSuccess: data => setGrid(data.tasks) },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [step, polygon, gridDimension, fetchFlightPreview]);

  // One-time rehydration: a persisted step past step 1 has no grid (and, for
  // step 3, no flight plan) since those aren't persisted — refetch them on
  // mount so a reload resumes faithfully. Falls back to step 2 if the restored
  // task is no longer present in the rebuilt grid.
  const rehydratedRef = useRef(false);
  useEffect(() => {
    if (rehydratedRef.current) return;
    rehydratedRef.current = true;
    if (step < 2) return;
    const restoredPolygon = buildSquareKm2(mapCenter, areaKm2);
    setPolygon(restoredPolygon);
    fetchFlightPreview(
      { polygon: restoredPolygon, cellSizeMeters: gridDimension },
      {
        onSuccess: data => {
          setGrid(data.tasks);
          // Keep the restored selection if it's still in the rebuilt grid,
          // otherwise default to A1 — step 2+ always has a task selected.
          const restored = selectedTaskId
            ? data.tasks.find(t => t.id === selectedTaskId)
            : null;

          if (step !== 3) {
            if (!restored) setSelectedTaskId(defaultTaskId(data.tasks));
            return;
          }

          if (!restored) {
            // Restored task is gone — drop to step 2 with the default selection.
            setStep(2);
            setSelectedTaskId(defaultTaskId(data.tasks));
            return;
          }
          fetchFlightPlan(
            { geometry: restored.geometry, altitude, droneModel },
            { onSuccess: fp => setFlightPlan(toFlightPlanData(fp)) },
          );
        },
      },
    );
    // Mount-only: rehydrate from the restored (initial) values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTask = grid.find(t => t.id === selectedTaskId) ?? null;

  // All grid cells as one FeatureCollection — used for the non-interactive
  // step-1 preview so the whole grid renders from a single source.
  const gridFeatureCollection = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: grid.map(task => ({
        type: 'Feature' as const,
        geometry: task.geometry,
        properties: { id: task.id },
      })),
    }),
    [grid],
  );

  // Label each cell with its backend-assigned task id (already A1-style) so the
  // map labels match the id shown in the side panel — don't re-derive them here.
  const gridLabelPoints = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: grid.map(task => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: polygonBboxCenter(task.geometry),
        },
        properties: { label: task.id },
      })),
    }),
    [grid],
  );

  const generateFlightPlan = (model: string) => {
    if (!selectedTask) return;
    fetchFlightPlan(
      { geometry: selectedTask.geometry, altitude, droneModel: model },
      {
        onSuccess: data => setFlightPlan(toFlightPlanData(data)),
      },
    );
  };

  const handleContinue = () => {
    fetchFlightPreview(
      { polygon, cellSizeMeters: gridDimension },
      {
        onSuccess: data => {
          setGrid(data.tasks);
          setSelectedTaskId(defaultTaskId(data.tasks));
          setFlightPlan(null);
          setStep(2);
        },
      },
    );
  };

  const handleSelectTask = () => {
    setFlightPlan(null);
    setStep(3);
    generateFlightPlan(droneModel);
  };

  const handleDroneModelChange = (model: string) => {
    setDroneModel(model);
    setFlightPlan(null);
    generateFlightPlan(model);
  };

  const handleBackToStep2 = () => {
    setFlightPlan(null);
    setStep(2);
  };

  return {
    step,
    setStep,
    altitude,
    setAltitude,
    gridDimension,
    setGridDimension,
    areaKm2,
    setAreaKm2,
    mapCenter,
    setMapCenter,
    initialCameraCenter,
    polygon,
    grid,
    selectedTaskId,
    setSelectedTaskId,
    droneModel,
    setDroneModel,
    flightPlan,
    setFlightPlan,
    loading,
    flightPlanLoading,
    selectedTask,
    gridFeatureCollection,
    gridLabelPoints,
    handleContinue,
    handleSelectTask,
    handleDroneModelChange,
    handleBackToStep2,
  };
};
