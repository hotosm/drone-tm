import { useEffect, useMemo, useState } from 'react';
import { Polygon } from 'geojson';
import { coordAll } from '@turf/meta';
import { buildSquareKm2, polygonBboxCenter } from '@Utils/geometry';
import { useFlightPreviewMutation, useFlightPlanMutation } from '@Api/tryDrone';
import { FlightPlanData, FlightPreviewTask } from '@Services/tryDrone';
import {
  DEFAULT_ALTITUDE,
  DEFAULT_AREA_KM2,
  DEFAULT_DRONE_MODEL,
  DEFAULT_GRID_DIMENSION,
  INITIAL_MAP_CENTER,
  PREVIEW_DEBOUNCE_MS,
} from '@Constants/tryDrone';

/**
 * Owns the "Fly My Drone" step state machine and all the form state it drives.
 *
 * Form state and the workflow are kept together because they're tightly
 * coupled: `generateFlightPlan` needs the altitude/model, and the polygon
 * rebuild + debounced preview effects are gated on the current step.
 */
export const useTryDroneWorkflow = () => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [altitude, setAltitude] = useState(DEFAULT_ALTITUDE);
  const [gridDimension, setGridDimension] = useState(DEFAULT_GRID_DIMENSION);
  const [areaKm2, setAreaKm2] = useState(DEFAULT_AREA_KM2);
  const [mapCenter, setMapCenter] =
    useState<[number, number]>(INITIAL_MAP_CENTER);
  const [polygon, setPolygon] = useState<Polygon>(() =>
    buildSquareKm2(INITIAL_MAP_CENTER, DEFAULT_AREA_KM2),
  );
  const [grid, setGrid] = useState<FlightPreviewTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [droneModel, setDroneModel] = useState(DEFAULT_DRONE_MODEL);
  const [flightPlan, setFlightPlan] = useState<FlightPlanData | null>(null);

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
  // Debounced because dragging / sliding updates the polygon on every frame.
  useEffect(() => {
    if (step !== 1) return undefined;
    const timer = setTimeout(() => {
      fetchFlightPreview(
        { polygon, cellSizeMeters: gridDimension },
        { onSuccess: data => setGrid(data.tasks) },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [step, polygon, gridDimension, fetchFlightPreview]);

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
        onSuccess: data => {
          setFlightPlan({
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
          });
        },
      },
    );
  };

  const handleContinue = () => {
    fetchFlightPreview(
      { polygon, cellSizeMeters: gridDimension },
      {
        onSuccess: data => {
          setGrid(data.tasks);
          setSelectedTaskId(null);
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
