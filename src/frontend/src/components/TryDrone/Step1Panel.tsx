import { Button } from "@Components/RadixComponents/Button";
import Icon from "@Components/common/Icon";
import { m } from "@/paraglide/messages";

const ALTITUDE_OPTIONS = [70, 100, 120];
const GRID_DIMENSION_OPTIONS = [200, 300, 550, 1000];

const GRID_DIMENSION_LEGENDS: Record<number, () => string> = {
  200: m.trydrone_dimension_legend_200,
  300: m.trydrone_dimension_legend_300,
  550: m.trydrone_dimension_legend_550,
  1000: m.trydrone_dimension_legend_1000,
};

interface Step1PanelProps {
  altitude: number;
  setAltitude: (v: number) => void;
  gridDimension: number;
  setGridDimension: (v: number) => void;
  areaKm2: number;
  setAreaKm2: (v: number) => void;
  onContinue: () => void;
  loading: boolean;
}

export default function Step1Panel({
  altitude,
  setAltitude,
  gridDimension,
  setGridDimension,
  areaKm2,
  setAreaKm2,
  onContinue,
  loading,
}: Step1PanelProps) {
  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-5 naxatw-p-5">
      <h2 className="naxatw-text-xl naxatw-font-bold naxatw-text-grey-800">Instructions</h2>

      <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
        <div className="naxatw-flex naxatw-items-center naxatw-justify-between">
          <label className="naxatw-text-base naxatw-font-medium naxatw-text-grey-800">
            
            {m.proj_desc_label_flight_altitude()} (m)
          </label>
          <span className="naxatw-text-primary-400 naxatw-text-sm naxatw-font-semibold">
            {altitude} m
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={ALTITUDE_OPTIONS.length - 1}
          step={1}
          value={Math.max(0, ALTITUDE_OPTIONS.indexOf(altitude))}
          onChange={(e) => setAltitude(ALTITUDE_OPTIONS[Number(e.target.value)])}
          className="naxatw-accent-primary-400 naxatw-w-full"
        />
        <div className="naxatw-flex naxatw-justify-between naxatw-text-xs naxatw-text-grey-500">
          {ALTITUDE_OPTIONS.map((option) => (
            <span key={option}>{option} m</span>
          ))}
        </div>
      </div>
      
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
        <div className="naxatw-flex naxatw-items-center naxatw-justify-between">
          <label className="naxatw-text-base naxatw-font-medium naxatw-text-grey-800">
            Coverage area
          </label>
          <span className="naxatw-text-primary-400 naxatw-text-sm naxatw-font-semibold">
            {areaKm2.toFixed(2)} km²
          </span>
        </div>
        <input
          type="range"
          min={0.10}
          max={1.50}
          step={0.01}
          value={areaKm2}
          onChange={(e) => setAreaKm2(Number(e.target.value))}
          className="naxatw-accent-primary-400 naxatw-w-full"
        />
        <div className="naxatw-flex naxatw-justify-between naxatw-text-xs naxatw-text-grey-500">
          <span>0.10 km²</span>
          <span>1.50 km²</span>
        </div>
      </div>

      <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
        <div className="naxatw-flex naxatw-items-center naxatw-justify-between">
          <label className="naxatw-text-base naxatw-font-medium naxatw-text-grey-800">
            {m.create_generate_dimension_label()}
          </label>
          <span className="naxatw-text-primary-400 naxatw-text-sm naxatw-font-semibold">
            {gridDimension} m
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={GRID_DIMENSION_OPTIONS.length - 1}
          step={1}
          value={Math.max(0, GRID_DIMENSION_OPTIONS.indexOf(gridDimension))}
          onChange={(e) =>
            setGridDimension(GRID_DIMENSION_OPTIONS[Number(e.target.value)])
          }
          className="naxatw-accent-primary-400 naxatw-w-full"
        />
        <div className="naxatw-flex naxatw-justify-between naxatw-text-xs naxatw-text-grey-500">
          {GRID_DIMENSION_OPTIONS.map((option) => (
            <span key={option}>{option}</span>
          ))}
        </div>
        <div className="naxatw-mt-1 naxatw-flex naxatw-items-start naxatw-gap-2 naxatw-rounded-md naxatw-text-xs naxatw-text-grey-700">
          <Icon
            name="info"
            className="naxatw-text-primary-400 naxatw-text-xs"
          />
          <span className="naxatw-text-xs">{GRID_DIMENSION_LEGENDS[gridDimension]?.()}</span>
        </div>
      </div>

      <Button
        variant="default"
        onClick={onContinue}
        disabled={loading}
        className="naxatw-w-full !naxatw-bg-grey-900"
      >
        {loading ? "Loading…" : "Continue"}
      </Button>
    </div>
  );
}
