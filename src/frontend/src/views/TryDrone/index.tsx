import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuth from '@Hooks/useAuth';
import { Map } from 'maplibre-gl';
import { featureBbox, geometriesBbox } from '@Utils/geometry';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import Step1Panel from '@Components/TryDrone/Step1Panel';
import Step2Panel from '@Components/TryDrone/Step2Panel';
import Step3Panel from '@Components/TryDrone/Step3Panel';
import TryDroneSidePanel from '@Components/TryDrone/SidePanel';
import { DraggablePolygon } from '@Components/TryDrone/DraggablePolygon';
import { GridOffScreenNudge } from '@Components/TryDrone/GridOffScreenNudge';
import { useGeometryVisibility } from '@Components/TryDrone/useGeometryVisibility';
import { useTryDroneWorkflow } from '@Components/TryDrone/useTryDroneWorkflow';
import { useTryDroneDownloads } from '@Components/TryDrone/useTryDroneDownloads';
import { useTryDroneMapCamera } from '@Components/TryDrone/useTryDroneMapCamera';
import TutorialTour from '@Components/TryDrone/TutorialTour';
import MapZoomControls from '@Components/TryDrone/MapZoomControls';
import FlightPlanLayers from '@Components/common/MapLibreComponents/Layers/FlightPlanLayers';
import { brandRed } from '@Constants/map';
import { TOUR_SEEN_KEY, TRY_DRONE_MAP_STYLE } from '@Constants/tryDrone';
import SectionHeader from '@/components/common/SectionHeader';

const FlyMyDronePage = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const mapContainerRef = useRef<HTMLDivElement>(null);

  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: { zoom: 2, center: [0, 20] },
    disableRotation: true,
  });

  const {
    step,
    setStep,
    altitude,
    setAltitude,
    gridDimension,
    setGridDimension,
    areaKm2,
    setAreaKm2,
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
  } = useTryDroneWorkflow();

  const { handleFitToBounds } = useTryDroneMapCamera({
    map,
    isMapLoaded,
    step,
    initialCameraCenter,
    polygon,
    grid,
    flightPlan,
    selectedTask,
  });

  const {
    downloadingAll,
    handleDownloadAllTasks,
    handleDownloadKmz,
    handleDownloadGeojson,
  } = useTryDroneDownloads({
    polygon,
    altitude,
    droneModel,
    gridDimension,
    selectedTask,
    flightPlan,
  });

  const [tourOn, setTourOn] = useState(
    () =>
      typeof localStorage !== 'undefined' &&
      !localStorage.getItem(TOUR_SEEN_KEY),
  );

  // Nudge to bring the AOI box back when it's been panned off-screen (step 1).
  // The box is a fixed AOI that doesn't follow the camera, so it can get lost.
  const boxVisibility = useGeometryVisibility({
    map,
    mapContainerRef,
    bbox:
      step === 1
        ? (featureBbox(polygon) as [number, number, number, number])
        : null,
    disabled: step !== 1,
  });

  const handleBringBoxToView = useCallback(() => {
    if (!map) return;
    const c = map.getCenter();
    // Updating the center triggers the step-1 effect that rebuilds `polygon`.
    setMapCenter([c.lng, c.lat]);
  }, [map, setMapCenter]);

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
              onClick={() => navigate('/', { state: { from: '/try-drone' } })}
            >
              Log in to save your work
            </button>
          )}
        </span>
      </SectionHeader>

      <div className="naxatw-relative naxatw-flex naxatw-flex-1 naxatw-overflow-hidden">
        {/* Map fills the left side */}
        <div
          data-tour="map"
          className="naxatw-flex-1"
          style={{ height: '100%' }}
        >
          <MapContainer
            ref={mapContainerRef}
            map={map}
            isMapLoaded={isMapLoaded}
            style={{ width: '100%', height: '100%' }}
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
              <GridOffScreenNudge
                visibility={boxVisibility}
                onBringToView={handleBringBoxToView}
              />
            )}

            {/* Step 1: non-interactive preview of how the AOI splits into tasks.
                The grid is cleared the instant the AOI / grid size changes (see
                useTryDroneWorkflow) so it never lingers misaligned, then redraws
                when the refetch resolves. */}
            {step === 1 && grid.length > 0 && (
              <>
                <VectorLayer
                  map={map as Map}
                  id="preview-grid-fill"
                  visibleOnMap
                  geojson={gridFeatureCollection}
                  layerOptions={{
                    type: 'fill',
                    paint: {
                      'fill-color': brandRed,
                      'fill-opacity': TRY_DRONE_MAP_STYLE.gridPreview.fillOpacity,
                    },
                  }}
                />
                <VectorLayer
                  map={map as Map}
                  id="preview-grid-outline"
                  visibleOnMap
                  geojson={gridFeatureCollection}
                  layerOptions={{
                    type: 'line',
                    paint: {
                      'line-color': brandRed,
                      'line-width': TRY_DRONE_MAP_STYLE.gridPreview.lineWidth,
                      'line-opacity': 1,
                    },
                  }}
                />
              </>
            )}

            {step === 2 &&
              grid.map(task => (
                <VectorLayer
                  key={task.id}
                  map={map as Map}
                  id={`task-${task.id}`}
                  visibleOnMap
                  geojson={{
                    type: 'Feature',
                    geometry: task.geometry,
                    properties: { id: task.id, area_m2: task.area_m2 },
                  }}
                  interactions={['feature']}
                  onFeatureSelect={props => {
                    setSelectedTaskId(props.id);
                    setFlightPlan(null);
                  }}
                  layerOptions={{
                    type: 'fill',
                    paint: {
                      'fill-color': brandRed,
                      'fill-opacity': TRY_DRONE_MAP_STYLE.task.fillOpacity,
                    },
                  }}
                />
              ))}
            {step === 2 &&
              grid.map(task => (
                <VectorLayer
                  key={`outline-${task.id}`}
                  map={map as Map}
                  id={`task-outline-${task.id}`}
                  visibleOnMap
                  geojson={{
                    type: 'Feature',
                    geometry: task.geometry,
                    properties: {},
                  }}
                  layerOptions={{
                    type: 'line',
                    paint: {
                      'line-color': brandRed,
                      'line-width': TRY_DRONE_MAP_STYLE.task.lineWidth,
                    },
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
                  type: 'Feature',
                  geometry: selectedTask.geometry,
                  properties: {},
                }}
                layerOptions={{
                  type: 'fill',
                  paint: {
                    'fill-color': brandRed,
                    'fill-opacity':
                      TRY_DRONE_MAP_STYLE.task.selectedFillOpacity,
                  },
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
                  type: 'symbol',
                  layout: {
                    'text-field': ['get', 'label'],
                    'text-size': TRY_DRONE_MAP_STYLE.label.textSize,
                    'text-anchor': 'center',
                    'text-justify': 'center',
                    'text-offset': [0, 0],
                    'text-allow-overlap': true,
                  },
                  paint: {
                    'text-color': TRY_DRONE_MAP_STYLE.label.textColor,
                    'text-halo-color': TRY_DRONE_MAP_STYLE.label.haloColor,
                    'text-halo-width': TRY_DRONE_MAP_STYLE.label.haloWidth,
                    'text-opacity': 1,
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
                    type: 'Feature',
                    geometry: selectedTask.geometry,
                    properties: {},
                  }}
                  layerOptions={{
                    type: 'fill',
                    paint: {
                      'fill-color': brandRed,
                      'fill-opacity': TRY_DRONE_MAP_STYLE.step3Task.fillOpacity,
                    },
                  }}
                />
                <VectorLayer
                  key={`step3-outline-${selectedTaskId}`}
                  map={map as Map}
                  id="step3-task-outline"
                  visibleOnMap
                  geojson={{
                    type: 'Feature',
                    geometry: selectedTask.geometry,
                    properties: {},
                  }}
                  layerOptions={{
                    type: 'line',
                    paint: {
                      'line-color': brandRed,
                      'line-width': TRY_DRONE_MAP_STYLE.step3Task.lineWidth,
                    },
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
          {step === 2 && selectedTask && (
            <Step2Panel
              selectedTask={selectedTask}
              droneModel={droneModel}
              onDroneModelChange={setDroneModel}
              onSelectTask={handleSelectTask}
              onDownloadAll={handleDownloadAllTasks}
              downloadingAll={downloadingAll}
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
              downloadingAll={downloadingAll}
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
              if (step === 1) return featureBbox(polygon);
              if (step === 2 && grid.length)
                return geometriesBbox(grid.map(t => t.geometry));
              if (step === 3 && selectedTask)
                return featureBbox(selectedTask.geometry);
            } catch {
              /* noop */
            }
            return null;
          })()}
          onClose={() => {
            setTourOn(false);
            if (typeof localStorage !== 'undefined')
              localStorage.setItem(TOUR_SEEN_KEY, '1');
          }}
        />
      )}
    </div>
  );
};

export default hasErrorBoundary(FlyMyDronePage);
