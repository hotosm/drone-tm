import { Button } from "@Components/RadixComponents/Button";
import Input from "@Components/common/FormUI/Input";

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

      <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
        <label className="naxatw-text-sm naxatw-font-medium naxatw-text-grey-800">
          Flying altitude (m)
        </label>
        <Input
          type="number"
          value={altitude}
          onChange={(e) => setAltitude(Number(e.target.value))}
          onBlur={(e) => {
            const value = Number(e.target.value);
            setAltitude(Math.min(120, Math.max(70, value)));
          }}
          min={70}
          max={120}
          className="naxatw-w-full"
        />
      </div>

      <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
        <label className="naxatw-text-sm naxatw-font-medium naxatw-text-grey-800">
          Dimension of squares (M)
        </label>
        <Input
          type="number"
          value={gridDimension}
          onChange={(e) => setGridDimension(Number(e.target.value))}
          onBlur={(e) => {
            const value = Number(e.target.value);
            setGridDimension(Math.min(1000, Math.max(50, value)));
          }}
          min={50}
          max={1000}
          className="naxatw-w-full"
        />
        <p className="naxatw-text-xs naxatw-text-grey-500">Recommended: 50-1000</p>
      </div>

      <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
        <div className="naxatw-flex naxatw-items-center naxatw-justify-between">
          <label className="naxatw-text-sm naxatw-font-medium naxatw-text-grey-800">
            Coverage area
          </label>
          <span className="naxatw-text-primary-400 naxatw-text-sm naxatw-font-semibold">
            {areaKm2.toFixed(2)} km²
          </span>
        </div>
        <input
          type="range"
          min={0.09}
          max={1.44}
          step={0.09}
          value={areaKm2}
          onChange={(e) => setAreaKm2(Number(e.target.value))}
          className="naxatw-accent-primary-400 naxatw-w-full"
        />
        <div className="naxatw-flex naxatw-justify-between naxatw-text-xs naxatw-text-grey-500">
          <span>0.09 km²</span>
          <span>1.44 km²</span>
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
