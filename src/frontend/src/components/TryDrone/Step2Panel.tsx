import { Polygon } from "geojson";
import { Button } from "@Components/RadixComponents/Button";
import Select from "@Components/common/FormUI/Select";
import { droneModelOptions } from "@Constants/taskDescription";
import { postWaypointKmz } from "@Services/tryDrone";

const SUPPORTED_DRONES = droneModelOptions;

interface Task {
  id: string;
  geometry: Polygon;
  area_m2: number;
}

interface Step2PanelProps {
  selectedTask: Task | null;
  droneModel: string;
  setDroneModel: (v: string) => void;
  altitude: number;
  onFlyTask: () => void;
  flightPlanLoading: boolean;
  hasFlightPlan: boolean;
}

export default function Step2Panel({
  selectedTask,
  droneModel,
  setDroneModel,
  altitude,
  onFlyTask,
  flightPlanLoading,
  hasFlightPlan,
}: Step2PanelProps) {
  const handleDownloadKmz = () => {
    if (!selectedTask) return;
    postWaypointKmz(selectedTask.geometry, altitude, droneModel).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flightplan-${selectedTask.id}.kmz`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-5 naxatw-p-5">
      <h2 className="naxatw-text-xl naxatw-font-bold naxatw-text-grey-800">Select a task</h2>

      {selectedTask ? (
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-4">
          <div className="naxatw-rounded-md naxatw-border naxatw-border-grey-300 naxatw-p-3">
            <p className="naxatw-text-sm naxatw-font-semibold naxatw-text-grey-800">
              Task {selectedTask.id}
            </p>
            <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-grey-600">
              {selectedTask.area_m2.toLocaleString()} m²
            </p>
          </div>

          <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
            <label className="naxatw-text-sm naxatw-font-medium naxatw-text-grey-800">
              Drone model
            </label>
            <Select
              options={SUPPORTED_DRONES}
              selectedOption={droneModel}
              onChange={(opt) => setDroneModel(opt.value)}
              direction="top"
            />
          </div>

          <Button
            variant="outline"
            withLoader
            isLoading={flightPlanLoading}
            onClick={onFlyTask}
            className="naxatw-w-full !naxatw-border-landing-red !naxatw-bg-landing-red !naxatw-text-white"
          >
            Fly this task &rsaquo;
          </Button>

          {hasFlightPlan && (
            <button
              type="button"
              onClick={handleDownloadKmz}
              className="naxatw-text-sm naxatw-text-landing-red hover:naxatw-underline"
            >
              Download .kmz
            </button>
          )}
        </div>
      ) : (
        <div className="naxatw-rounded-md naxatw-border naxatw-border-dashed naxatw-border-grey-400 naxatw-p-6 naxatw-text-center naxatw-text-sm naxatw-text-grey-500">
          Click a cell on the map to see task details
        </div>
      )}
    </div>
  );
}
