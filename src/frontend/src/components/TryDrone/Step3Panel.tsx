import { Button } from '@Components/RadixComponents/Button';
import Select from '@Components/common/FormUI/Select';
import { droneModelOptions } from '@Constants/taskDescription';

interface Task {
  id: string;
  area_m2: number;
}

interface Step3PanelProps {
  selectedTask: Task;
  droneModel: string;
  onDroneModelChange: (model: string) => void;
  flightPlanLoading: boolean;
  hasFlightPlan: boolean;
  onBack: () => void;
  onDownload: () => void;
}

export default function Step3Panel({
  selectedTask,
  droneModel,
  onDroneModelChange,
  flightPlanLoading,
  hasFlightPlan,
  onBack,
  onDownload,
}: Step3PanelProps) {
  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-5 naxatw-p-5">
      <h2 className="naxatw-text-xl naxatw-font-bold naxatw-text-grey-800">
        Flight plan
      </h2>

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
          options={droneModelOptions}
          selectedOption={droneModel}
          onChange={opt => onDroneModelChange(opt.value)}
          direction="top"
        />
      </div>

      {flightPlanLoading && (
        <p className="naxatw-text-sm naxatw-text-grey-500">
          Generating flight plan…
        </p>
      )}
      <div className="naxatw-flex naxatw-flex-col">
        {hasFlightPlan && (
          <Button
            variant="outline"
            leftIcon="download"
            onClick={onDownload}
            className="naxatw-w-full !naxatw-border-landing-red !naxatw-bg-landing-red !naxatw-text-white"
          >
            Fly this task
          </Button>
        )}

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
