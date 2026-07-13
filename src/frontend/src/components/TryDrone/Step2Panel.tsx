import { Button } from "@Components/RadixComponents/Button";
import { droneModelOptions } from "@Constants/taskDescription";

interface Task {
  id: string;
  area_m2: number;
}

interface Step2PanelProps {
  selectedTask: Task | null;
  droneModel: string;
  onSelectTask: () => void;
  onDownloadAll: () => void;
  onBack: () => void;
}

export default function Step2Panel({
  selectedTask,
  droneModel,
  onSelectTask,
  onDownloadAll,
  onBack,
}: Step2PanelProps) {
  const droneModelLabel =
    droneModelOptions.find((option) => option.value === droneModel)?.label ?? droneModel;

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-5 naxatw-p-5">
      <h2 className="naxatw-text-xl naxatw-font-bold naxatw-text-grey-800">Select a task</h2>

      <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
        <p className="naxatw-text-sm naxatw-font-medium naxatw-text-grey-800">Drone model</p>
        <p className="naxatw-text-sm naxatw-text-grey-600">{droneModelLabel}</p>
      </div>

      {selectedTask ? (
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-4">
          <div className="naxatw-rounded-md naxatw-border naxatw-border-grey-300 naxatw-p-3">
            <p className="naxatw-text-sm naxatw-font-semibold naxatw-text-grey-800">
              Task {selectedTask.id}
            </p>
            <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-grey-600">
              {Math.round(selectedTask.area_m2).toLocaleString()} m²
            </p>
          </div>
          <Button
            variant="outline"
            rightIcon="chevron_right"
            onClick={onSelectTask}
            className="naxatw-w-full !naxatw-border-landing-red !naxatw-bg-landing-red !naxatw-text-white"
          >
            Select task
          </Button>
        </div>
      ) : (
        <div className="naxatw-rounded-md naxatw-border naxatw-border-dashed naxatw-border-grey-400 naxatw-p-6 naxatw-text-center naxatw-text-sm naxatw-text-grey-500">
          Click a cell on the map to see task details
        </div>
      )}

      <div className="naxatw-flex naxatw-flex-col">
        <Button
          variant="ghost"
          leftIcon="download"
          onClick={onDownloadAll}
          className="naxatw-w-full !naxatw-text-landing-red"
        >
          Download all tasks
        </Button>
        <Button
          variant="ghost"
          leftIcon="chevron_left"
          className="!naxatw-text-red"
          onClick={onBack}
        >
          Back
        </Button>
      </div>
    </div>
  );
}
