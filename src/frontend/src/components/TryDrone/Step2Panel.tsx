import { Button } from "@Components/RadixComponents/Button";
import { droneModelOptions } from "@Constants/taskDescription";
import { Select } from "../common/FormUI";
import { m } from "@/paraglide/messages";

interface Task {
  id: string;
  area_m2: number;
}

interface Step2PanelProps {
  selectedTask: Task | null;
  droneModel: string;
  onDroneModelChange: (model: string) => void;
  onSelectTask: () => void;
  onDownloadAll: () => void;
  downloadingAll: boolean;
  onBack: () => void;
}

export default function Step2Panel({
  selectedTask,
  droneModel,
  onDroneModelChange,
  onSelectTask,
  onDownloadAll,
  downloadingAll,
  onBack,
}: Step2PanelProps) {
  
  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-5 naxatw-p-5">
      <h2 className="naxatw-text-xl naxatw-font-bold naxatw-text-grey-800">{m.trydrone_step2_select_task_title()}</h2>

      {selectedTask ? (
          <div className="naxatw-rounded-md naxatw-border naxatw-border-grey-300 naxatw-p-3 naxatw-h-18">
            <p className="naxatw-text-sm naxatw-font-semibold naxatw-text-grey-800">
              Task {selectedTask.id}
            </p>
            <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-grey-600">
              {Math.round(selectedTask.area_m2).toLocaleString()} m²
            </p>
          </div>
      ) : (
        <div className="naxatw-rounded-md naxatw-border naxatw-border-grey-300 naxatw-p-3 naxatw-h-18">
          <span className="naxatw-text-grey-500">
            {m.trydrone_step2_task_hint()}
          </span>
        </div>
      )}
      
      {/* As download all button was added, we need to be able to select drone in this step */}
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
             <label className="naxatw-text-sm naxatw-font-medium naxatw-text-grey-800">
               {m.flight_gap_drone_model_label()}
             </label>
             <Select
               options={droneModelOptions}
               selectedOption={droneModel}
               onChange={(value) => onDroneModelChange(value)}
             />
           </div>

      <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
        <Button
            variant="outline"
            rightIcon="chevron_right"
            onClick={onSelectTask}
            disabled={!selectedTask}
            className="naxatw-text-white !naxatw-bg-black hover:!naxatw-bg-grey-900 hover:!naxatw-no-underline"
          >
            {m.common_continue()}
        </Button>
        
        <div className="naxatw-flex naxatw-items-center naxatw-gap-3 naxatw-py-1">
          <span className="naxatw-h-px naxatw-flex-1 naxatw-bg-grey-300" />
          <span className="naxatw-text-xs naxatw-uppercase naxatw-text-grey-500">
            {m.auth_or()}
          </span>
          <span className="naxatw-h-px naxatw-flex-1 naxatw-bg-grey-300" />
        </div>
          
        <Button
          variant="outline"
          leftIcon="download"
          onClick={onDownloadAll}
          disabled={downloadingAll}
          isLoading={downloadingAll}
          className="naxatw-w-full naxatw-border-red !naxatw-text-landing-red"
        >
          {downloadingAll
            ? m.trydrone_step2_downloading()
            : m.trydrone_step2_download_all()}
        </Button>
        <Button
          variant="ghost"
          leftIcon="chevron_left"
          onClick={onBack}
          className="naxatw-text-gray-700"
        >
          {m.trydrone_tour_back()}
        </Button>
      </div>
    </div>
  );
}
