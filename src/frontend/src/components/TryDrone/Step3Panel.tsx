import { Button } from "@Components/RadixComponents/Button";
import Select from "@Components/common/FormUI/Select";
import { droneModelOptions } from "@Constants/taskDescription";
import { formatAreaKm2 } from "@Constants/tryDrone";
import { m } from "@/paraglide/messages";

// Output file format the backend produces for each drone (see flightplan_output.py).
const droneFileLabel: Record<string, string> = {
  DJI_MINI_4_PRO: "KMZ (DJI)",
  DJI_MINI_5_PRO: "KMZ (DJI)",
  DJI_AIR_3: "KMZ (DJI)",
  POTENSIC_ATOM_1: "Potensic (.db)",
  POTENSIC_ATOM_2: "Potensic (.zip)",
  LITCHI: "Litchi (.csv)",
  QGROUNDCONTROL: "QGC (.plan)",
};

interface Task {
  id: string;
  area_m2: number;
}

interface Step3PanelProps {
  selectedTask: Task;
  droneModel: string;
  onDroneModelChange: (model: string) => void;
  hasFlightPlan: boolean;
  onBack: () => void;
  onDownload: () => void;
  onDownloadGeojson: () => void;
  onDownloadAll: () => void;
  downloadingAll: boolean;
}

export default function Step3Panel({
  selectedTask,
  droneModel,
  onDroneModelChange,
  hasFlightPlan,
  onBack,
  onDownload,
  onDownloadGeojson,
  onDownloadAll,
  downloadingAll,
}: Step3PanelProps) {
  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-5 naxatw-p-5">
      <h2 className="naxatw-text-xl naxatw-font-bold naxatw-text-grey-800">Flight plan</h2>

      <div className="naxatw-rounded-md naxatw-border naxatw-border-grey-300 naxatw-p-3">
        <p className="naxatw-text-sm naxatw-font-semibold naxatw-text-grey-800">
          {m.processing_dialog_table_task()} {selectedTask.id}
        </p>
        <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-grey-600">
          {formatAreaKm2(selectedTask.area_m2)}
        </p>
      </div>

      <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
        <label className="naxatw-text-sm naxatw-font-medium naxatw-text-grey-800">
          {m.flight_gap_drone_model_label()}
        </label>
        <Select
          options={droneModelOptions}
          selectedOption={droneModel}
          onChange={(value) => onDroneModelChange(value)}
          direction="top"
        />
      </div>

      {/* actions */}
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
        {hasFlightPlan && (
          <>
            <Button
              variant="default"
              leftIcon="download"
              onClick={onDownload}
              className="naxatw-w-full naxatw-bg-red !naxatw-text-landing-white"
            >
              {m.drone_task_download()} {droneFileLabel[droneModel] ?? "flight file"}
            </Button>
            <Button
              variant="outline"
              leftIcon="download"
              onClick={onDownloadGeojson}
              className="naxatw-w-full naxatw-border-red !naxatw-text-landing-red"
            >
              {m.trydrone_step3_download_geojson()}
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
          </>
        )}

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
