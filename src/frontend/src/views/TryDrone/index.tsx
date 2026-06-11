import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuth from '@Hooks/useAuth';
import { Map, LngLatBoundsLike } from 'maplibre-gl';
import { Polygon } from 'geojson';
import getBbox from '@turf/bbox';
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import LocateUser from '@Components/common/MapLibreComponents/LocateUser';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import { buildSquareKm2 } from '@Utils/geometry';
import Step1Panel from '@Components/TryDrone/Step1Panel';
import Step2Panel from '@Components/TryDrone/Step2Panel';
import TryDroneSidePanel from '@Components/TryDrone/SidePanel';
import { DraggablePolygon } from '@Components/TryDrone/DraggablePolygon';
import { useFlightPreviewMutation } from '@Api/tryDrone';
import { FlightPreviewTask } from '@Services/tryDrone';
import SectionHeader from '@/components/common/SectionHeader';
import { brandRed, taskFillColor, taskOutlineColor } from '@Constants/map';

const INITIAL_MAP_CENTER: [number, number] = [-13.2317, 8.4657];
const INITIAL_MAP_ZOOM = 13;

const FlyMyDronePage = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [altitude, setAltitude] = useState(70);
  const [areaKm2, setAreaKm2] = useState(0.2);
  const [mapCenter, setMapCenter] =
    useState<[number, number]>(INITIAL_MAP_CENTER);
  const [polygon, setPolygon] = useState<Polygon>(() =>
    buildSquareKm2(INITIAL_MAP_CENTER, 0.2),
  );
  const [grid, setGrid] = useState<FlightPreviewTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [droneModel, setDroneModel] = useState('DJI_MINI_4_PRO');
  const { mutate: fetchFlightPreview, isPending: loading } =
    useFlightPreviewMutation();

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

  // Recompute preview polygon whenever center or area changes (step 1 only)
  useEffect(() => {
    if (step === 1) setPolygon(buildSquareKm2(mapCenter, areaKm2));
  }, [mapCenter, areaKm2, step]);

  // Zoom to grid extent when entering step 2
  useEffect(() => {
    if (step !== 2 || !map || !grid.length) return;
    const fc = {
      type: 'FeatureCollection' as const,
      features: grid.map(t => ({
        type: 'Feature' as const,
        geometry: t.geometry,
        properties: {},
      })),
    };
    map.fitBounds(getBbox(fc) as LngLatBoundsLike, {
      padding: 40,
      duration: 500,
    });
  }, [step, map, grid]);

  const handleContinue = () => {
    fetchFlightPreview(
      { polygon },
      {
        onSuccess: data => {
          setGrid(data.tasks);
          setSelectedTaskId(null);
          setStep(2);
        },
      },
    );
  };

  const selectedTask = grid.find(t => t.id === selectedTaskId) ?? null;

  return (
    <div className="naxatw-flex naxatw-h-screen-nav naxatw-flex-col naxatw-overflow-hidden">
      <SectionHeader>
        <span className="naxatw-flex naxatw-h-12 naxatw-items-center naxatw-justify-between">
          <h3>Fly My Drone</h3>
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
        <div className="naxatw-flex-1" style={{ height: '100%' }}>
          <MapContainer
            ref={mapContainerRef}
            map={map}
            isMapLoaded={isMapLoaded}
            style={{ width: '100%', height: '100%' }}
          >
            <BaseLayerSwitcherUI />
            <LocateUser />

            {step === 1 && isMapLoaded && (
              <DraggablePolygon
                map={map as Map}
                mapContainerRef={mapContainerRef}
                polygon={polygon}
                onCenterChange={setMapCenter}
              />
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
                  onFeatureSelect={props => setSelectedTaskId(props.id)}
                  layerOptions={{
                    type: 'fill',
                    paint: { 'fill-color': taskFillColor, 'fill-opacity': 0.2 },
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
                    paint: { 'line-color': taskOutlineColor, 'line-width': 1 },
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
                  paint: { 'fill-color': brandRed, 'fill-opacity': 0.45 },
                }}
              />
            )}
          </MapContainer>
        </div>

        <TryDroneSidePanel>
          {step === 1 ? (
            <Step1Panel
              altitude={altitude}
              setAltitude={setAltitude}
              areaKm2={areaKm2}
              setAreaKm2={setAreaKm2}
              onContinue={handleContinue}
              loading={loading}
            />
          ) : (
            <Step2Panel
              selectedTask={selectedTask}
              droneModel={droneModel}
              setDroneModel={setDroneModel}
              altitude={altitude}
            />
          )}
        </TryDroneSidePanel>
      </div>
    </div>
  );
};

export default hasErrorBoundary(FlyMyDronePage);
