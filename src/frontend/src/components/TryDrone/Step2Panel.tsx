import { Button } from '@Components/RadixComponents/Button';

interface Task {
  id: string;
  area_m2: number;
}

interface Step2PanelProps {
  selectedTask: Task | null;
  onSelectTask: () => void;
  onBack: () => void;
}

export default function Step2Panel({
  selectedTask,
  onSelectTask,
  onBack,
}: Step2PanelProps) {
  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-5 naxatw-p-5">
      <h2 className="naxatw-text-xl naxatw-font-bold naxatw-text-grey-800">
        Select a task
      </h2>

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
          <div className="naxatw-flex naxatw-flex-col">
            <Button
              variant="outline"
              rightIcon="chevron_right"
              onClick={onSelectTask}
              className="naxatw-w-full !naxatw-border-landing-red !naxatw-bg-landing-red !naxatw-text-white"
            >
              Select task
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
      ) : (
        <div className="naxatw-rounded-md naxatw-border naxatw-border-dashed naxatw-border-grey-400 naxatw-p-6 naxatw-text-center naxatw-text-sm naxatw-text-grey-500">
          Click a cell on the map to see task details
        </div>
      )}
    </div>
  );
}
