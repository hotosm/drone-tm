import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useAuth from "@Hooks/useAuth";
import { Map, LngLatBoundsLike } from "maplibre-gl";
import { FeatureCollection, Polygon } from "geojson";
import getBbox from "@turf/bbox";
import { coordAll } from "@turf/meta";
import { useMapLibreGLMap } from "@Components/common/MapLibreComponents";
import VectorLayer from "@Components/common/MapLibreComponents/Layers/VectorLayer";
import MapContainer from "@Components/common/MapLibreComponents/MapContainer";
import hasErrorBoundary from "@Utils/hasErrorBoundary";
import { buildSquareKm2, polygonBboxCenter } from "@Utils/geometry";
import Step1Panel from "@Components/TryDrone/Step1Panel";
import Step2Panel from "@Components/TryDrone/Step2Panel";
import Step3Panel from "@Components/TryDrone/Step3Panel";
import TryDroneSidePanel from "@Components/TryDrone/SidePanel";
import { DraggablePolygon } from "@Components/TryDrone/DraggablePolygon";
import { GridOffScreenNudge } from "@Components/TryDrone/GridOffScreenNudge";
import { useGeometryVisibility } from "@Components/TryDrone/useGeometryVisibility";
import DroneFlightAnimation from "@Components/TryDrone/DroneFlightAnimation";
import TutorialTour from "@Components/TryDrone/TutorialTour";
import MapZoomControls from "@Components/TryDrone/MapZoomControls";
import { useFlightPreviewMutation, useFlightPlanMutation } from "@Api/tryDrone";
import {
  DroneMetadata,
  FlightPreviewTask,
  postAllTaskFiles,
  postWaypointKmz,
} from "@Services/tryDrone";
import FlightPlanLayers from "@Components/common/MapLibreComponents/Layers/FlightPlanLayers";
import { brandRed, taskFillColor, taskOutlineColor } from "@Constants/map";
import SectionHeader from "@/components/common/SectionHeader";

interface FlightPlanData {
  geojsonListOfPoints: FeatureCollection;
  geojsonAsLineString: FeatureCollection;
  droneMetadata?: DroneMetadata;
}

const INITIAL_MAP_CENTER: [number, number] = [-13.2317, 8.4657];
const INITIAL_MAP_ZOOM = 15;

const FlyMyDronePage = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const handleAuth = () => navigate("/projects", { replace: true });
    document.addEventListener("hanko-login", handleAuth);
    return () => document.removeEventListener("hanko-login", handleAuth);
  }, [navigate]);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [altitude, setAltitude] = useState(70);
  const [gridDimension, setGridDimension] = useState(200);
  const [areaKm2, setAreaKm2] = useState(0.16);
  const [mapCenter, setMapCenter] = useState<[number, number]>(INITIAL_MAP_CENTER);
  const [polygon, setPolygon] = useState<Polygon>(() => buildSquareKm2(INITIAL_MAP_CENTER, 0.16));
  const [grid, setGrid] = useState<FlightPreviewTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [droneModel, setDroneModel] = useState("DJI_MINI_4_PRO");
  const [flightPlan, setFlightPlan] = useState<FlightPlanData | null>(null);
  const [tourOn, setTourOn] = useState(
    () => typeof localStorage !== "undefined" && !localStorage.getItem("tryDroneTourSeen"),
  );
  const { mutate: fetchFlightPreview, isPending: loading } = useFlightPreviewMutation();
  const { mutate: fetchFlightPlan, isPending: flightPlanLoading } = useFlightPlanMutation();

  const mapContainerRef = useRef<HTMLDivElement>(null);

  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: { zoom: 2, center: [0, 20] },
    disableRotation: true,
  });

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
    map.setGlyphs("https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf");
  }, [map, isMapLoaded]);

  // Recompute preview polygon whenever center or area changes (step 1 only)
  useEffect(() => {
    if (step === 1) setPolygon(buildSquareKm2(mapCenter, areaKm2));
  }, [mapCenter, areaKm2, step]);

  // Live grid preview in step 1: refetch the task grid whenever the AOI or grid
  // size changes, so the map shows how the area splits before continuing.
  // Debounced because dragging / sliding updates the polygon on every frame.
  useEffect(() => {
    if (step !== 1) return;
    const timer = setTimeout(() => {
      fetchFlightPreview(
        { polygon, cellSizeMeters: gridDimension },
        { onSuccess: (data) => setGrid(data.tasks) },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [step, polygon, gridDimension, fetchFlightPreview]);

  // Zoom to grid extent when entering step 2
  useEffect(() => {
    if (step !== 2 || !map || !grid.length) return;
    const fc = {
      type: "FeatureCollection" as const,
      features: grid.map((t) => ({
        type: "Feature" as const,
        geometry: t.geometry,
        properties: {},
      })),
    };
    map.fitBounds(getBbox(fc) as LngLatBoundsLike, {
      padding: 40,
      duration: 500,
    });
  }, [step, map, grid]);

  // Zoom to the flight line once a flight plan is generated
  useEffect(() => {
    if (!map || !flightPlan) return;
    map.fitBounds(getBbox(flightPlan.geojsonAsLineString) as LngLatBoundsLike, {
      padding: 105,
      duration: 500,
    });
  }, [map, flightPlan]);

  const handleContinue = () => {
    fetchFlightPreview(
      { polygon, cellSizeMeters: gridDimension },
      {
        onSuccess: (data) => {
          setGrid(data.tasks);
          setSelectedTaskId(null);
          setFlightPlan(null);
          setStep(2);
        },
      },
    );
  };

  const selectedTask = grid.find((t) => t.id === selectedTaskId) ?? null;

  // All grid cells as one FeatureCollection — used for the non-interactive
  // step-1 preview so the whole grid renders from a single source.
  const gridFeatureCollection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: grid.map((task) => ({
        type: "Feature" as const,
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
      type: "FeatureCollection" as const,
      features: grid.map((task) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
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
        onSuccess: (data) => {
          setFlightPlan({
            droneMetadata: data.drone_metadata,
            geojsonListOfPoints: data,
            geojsonAsLineString: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "LineString",
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

  const handleDownloadAllTasks = () => {
    postAllTaskFiles(polygon, altitude, droneModel, gridDimension).then(({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const handleDownloadKmz = () => {
    if (!selectedTask) return;
    postWaypointKmz(selectedTask.geometry, altitude, droneModel, selectedTask.id).then(
      ({ blob, filename }) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      },
    );
  };

  // GeoJSON of the flight plan — handy to preview in any map viewer
  // (geojson.io, QGIS, Google Earth) without loading it onto a drone.
  // Includes both the flight path (LineString) and the waypoints (Points).
  const handleDownloadGeojson = () => {
    if (!flightPlan || !selectedTask) return;
    const featureCollection = {
      type: "FeatureCollection" as const,
      ...(flightPlan.droneMetadata ? { drone_metadata: flightPlan.droneMetadata } : {}),
      features: [
        ...flightPlan.geojsonAsLineString.features,
        ...flightPlan.geojsonListOfPoints.features,
      ],
    };
    const blob = new Blob([JSON.stringify(featureCollection)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flightplan-${selectedTask.id}-${droneModel}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFitToBounds = useCallback(() => {
    if (!map) return;
    let bbox: ReturnType<typeof getBbox> | null = null;
    if (step === 1) {
      bbox = getBbox({ type: "Feature", geometry: polygon, properties: {} });
    } else if (step === 2 && grid.length) {
      bbox = getBbox({
        type: "FeatureCollection",
        features: grid.map((t) => ({
          type: "Feature",
          geometry: t.geometry,
          properties: {},
        })),
      });
    } else if (step === 3 && flightPlan) {
      bbox = getBbox(flightPlan.geojsonAsLineString);
    } else if (step === 3 && selectedTask) {
      bbox = getBbox({
        type: "Feature",
        geometry: selectedTask.geometry,
        properties: {},
      });
    }
    if (bbox) map.fitBounds(bbox as LngLatBoundsLike, { padding: 40, duration: 500 });
  }, [map, step, polygon, grid, flightPlan, selectedTask]);

  // Nudge to bring the AOI box back when it's been panned off-screen (step 1).
  // The box is a fixed AOI that doesn't follow the camera, so it can get lost.
  const boxVisibility = useGeometryVisibility({
    map,
    mapContainerRef,
    bbox:
      step === 1
        ? (getBbox({
            type: "Feature",
            geometry: polygon,
            properties: {},
          }) as [number, number, number, number])
        : null,
    disabled: step !== 1,
  });

  const handleBringBoxToView = useCallback(() => {
    if (!map) return;
    const c = map.getCenter();
    // Updating the center triggers the step-1 effect that rebuilds `polygon`.
    setMapCenter([c.lng, c.lat]);
  }, [map]);

  return (
    <div className="naxatw-flex naxatw-h-screen-nav naxatw-flex-col naxatw-overflow-hidden">
      <SectionHeader>
        <span className="naxatw-flex naxatw-h-12 naxatw-items-center naxatw-justify-between">
          <span className="naxatw-flex naxatw-items-center naxatw-gap-2">
            <h3>Fly My Drone</h3>
            <button
              type="button"
              title="Tutorial"
              className="naxatw-flex naxatw-h-6 naxatw-w-6 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-border naxatw-border-grey-400 naxatw-text-xs naxatw-font-bold naxatw-text-grey-600 hover:naxatw-border-landing-red hover:naxatw-text-landing-red"
              onClick={() => setTourOn(true)}
            >
              ?
            </button>
          </span>
          {!isAuthenticated() && (
            <button
              type="button"
              className="naxatw-text-primary-400 naxatw-text-sm hover:naxatw-underline"
              onClick={() => navigate("/", { state: { from: "/try-drone" } })}
            >
              Log in to save your work
            </button>
          )}
        </span>
      </SectionHeader>

      <div className="naxatw-relative naxatw-flex naxatw-flex-1 naxatw-overflow-hidden">
        {/* Map fills the left side */}
        <div data-tour="map" className="naxatw-flex-1" style={{ height: "100%" }}>
          <MapContainer
            ref={mapContainerRef}
            map={map}
            isMapLoaded={isMapLoaded}
            style={{ width: "100%", height: "100%" }}
          >
            <MapZoomControls
              map={isMapLoaded ? map : null}
              onFitToBounds={isMapLoaded ? handleFitToBounds : null}
            />

            {step === 1 && isMapLoaded && (
              <DraggablePolygon
                map={map as Map}
                mapContainerRef={mapContainerRef}
                polygon={polygon}
                onCenterChange={setMapCenter}
              />
            )}

            {step === 1 && isMapLoaded && (
              <GridOffScreenNudge visibility={boxVisibility} onBringToView={handleBringBoxToView} />
            )}

            {/* Step 1: non-interactive preview of how the AOI splits into tasks.
                While a fresh grid is being fetched (box resized/moved) the grid
                is hidden entirely, then shown again when the API responds. */}
            {step === 1 && grid.length > 0 && (
              <>
                <VectorLayer
                  map={map as Map}
                  id="preview-grid-fill"
                  visibleOnMap
                  geojson={gridFeatureCollection}
                  layerOptions={{
                    type: "fill",
                    paint: { "fill-color": taskFillColor, "fill-opacity": loading ? 0.0 : 0.15 },
                  }}
                />
                <VectorLayer
                  map={map as Map}
                  id="preview-grid-outline"
                  visibleOnMap
                  geojson={gridFeatureCollection}
                  layerOptions={{
                    type: "line",
                    paint: {
                      "line-color": taskOutlineColor,
                      "line-width": 1,
                      "line-opacity": loading ? 0 : 1,
                    },
                  }}
                />
              </>
            )}

            {step === 2 &&
              grid.map((task) => (
                <VectorLayer
                  key={task.id}
                  map={map as Map}
                  id={`task-${task.id}`}
                  visibleOnMap
                  geojson={{
                    type: "Feature",
                    geometry: task.geometry,
                    properties: { id: task.id, area_m2: task.area_m2 },
                  }}
                  interactions={["feature"]}
                  onFeatureSelect={(props) => {
                    setSelectedTaskId(props.id);
                    setFlightPlan(null);
                  }}
                  layerOptions={{
                    type: "fill",
                    paint: { "fill-color": taskFillColor, "fill-opacity": 0.2 },
                  }}
                />
              ))}
            {step === 2 &&
              grid.map((task) => (
                <VectorLayer
                  key={`outline-${task.id}`}
                  map={map as Map}
                  id={`task-outline-${task.id}`}
                  visibleOnMap
                  geojson={{
                    type: "Feature",
                    geometry: task.geometry,
                    properties: {},
                  }}
                  layerOptions={{
                    type: "line",
                    paint: { "line-color": taskOutlineColor, "line-width": 1 },
                  }}
                />
              ))}
            {/* Selected task highlight — re-keyed on selection change to force re-mount */}
            {step === 2 && selectedTaskId && selectedTask && (
              <VectorLayer
                key={`selected-${selectedTaskId}`}
                map={map as Map}
                id="task-selected-highlight"
                visibleOnMap
                geojson={{
                  type: "Feature",
                  geometry: selectedTask.geometry,
                  properties: {},
                }}
                layerOptions={{
                  type: "fill",
                  paint: { "fill-color": brandRed, "fill-opacity": 0.45 },
                }}
              />
            )}

            {/* Grid cell labels — A1, A2, B1, B2, ... */}
            {(step === 1 || step === 2) && grid.length > 0 && (
              <VectorLayer
                map={map as Map}
                id="task-grid-labels"
                visibleOnMap
                geojson={gridLabelPoints}
                layerOptions={{
                  type: "symbol",
                  layout: {
                    "text-field": ["get", "label"],
                    "text-size": 12,
                    "text-anchor": "center",
                    "text-justify": "center",
                    "text-offset": [0, 0],
                    "text-allow-overlap": true,
                  },
                  paint: {
                    "text-color": "#1f2937",
                    "text-halo-color": "#ffffff",
                    "text-halo-width": 1.5,
                    "text-opacity": step === 1 && loading ? 0 : 1,
                  },
                }}
              />
            )}

            {/* Step 3: only the selected task */}
            {step === 3 && selectedTask && (
              <>
                <VectorLayer
                  key={`step3-fill-${selectedTaskId}`}
                  map={map as Map}
                  id="step3-task-fill"
                  visibleOnMap
                  geojson={{
                    type: "Feature",
                    geometry: selectedTask.geometry,
                    properties: {},
                  }}
                  layerOptions={{
                    type: "fill",
                    paint: { "fill-color": brandRed, "fill-opacity": 0.2 },
                  }}
                />
                <VectorLayer
                  key={`step3-outline-${selectedTaskId}`}
                  map={map as Map}
                  id="step3-task-outline"
                  visibleOnMap
                  geojson={{
                    type: "Feature",
                    geometry: selectedTask.geometry,
                    properties: {},
                  }}
                  layerOptions={{
                    type: "line",
                    paint: { "line-color": brandRed, "line-width": 2 },
                  }}
                />
              </>
            )}

            {step === 3 && flightPlan && (
              <FlightPlanLayers
                geojsonListOfPoints={flightPlan.geojsonListOfPoints}
                geojsonAsLineString={flightPlan.geojsonAsLineString}
              />
            )}

            {step === 3 && flightPlan && selectedTask && (
              <DroneFlightAnimation
                map={map as Map}
                waypoints={flightPlan.geojsonListOfPoints}
                geometry={selectedTask.geometry}
              />
            )}
          </MapContainer>
        </div>

        <TryDroneSidePanel collapseSignal={step}>
          {step === 1 && (
            <Step1Panel
              altitude={altitude}
              setAltitude={setAltitude}
              gridDimension={gridDimension}
              setGridDimension={setGridDimension}
              areaKm2={areaKm2}
              setAreaKm2={setAreaKm2}
              onContinue={handleContinue}
              loading={loading}
            />
          )}
          {step === 2 && (
            <Step2Panel
              selectedTask={selectedTask}
              droneModel={droneModel}
              onSelectTask={handleSelectTask}
              onDownloadAll={handleDownloadAllTasks}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && selectedTask && (
            <Step3Panel
              selectedTask={selectedTask}
              droneModel={droneModel}
              onDroneModelChange={handleDroneModelChange}
              flightPlanLoading={flightPlanLoading}
              hasFlightPlan={!!flightPlan}
              onBack={handleBackToStep2}
              onDownload={handleDownloadKmz}
              onDownloadGeojson={handleDownloadGeojson}
              onDownloadAll={handleDownloadAllTasks}
            />
          )}
        </TryDroneSidePanel>
      </div>

      {tourOn && (
        <TutorialTour
          step={step}
          hasSelection={step === 2 && !!selectedTask}
          map={map}
          bbox={(() => {
            try {
              if (step === 1)
                return getBbox({
                  type: "Feature",
                  geometry: polygon,
                  properties: {},
                });
              if (step === 2 && grid.length)
                return getBbox({
                  type: "FeatureCollection",
                  features: grid.map((t) => ({
                    type: "Feature",
                    geometry: t.geometry,
                    properties: {},
                  })),
                });
              if (step === 3 && selectedTask)
                return getBbox({
                  type: "Feature",
                  geometry: selectedTask.geometry,
                  properties: {},
                });
            } catch {
              /* noop */
            }
            return null;
          })()}
          onClose={() => {
            setTourOn(false);
            if (typeof localStorage !== "undefined") localStorage.setItem("tryDroneTourSeen", "1");
          }}
        />
      )}
    </div>
  );
};

export default hasErrorBoundary(FlyMyDronePage);
