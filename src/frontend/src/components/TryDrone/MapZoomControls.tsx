import { useState } from "react";
import { Map } from "maplibre-gl";
import ToolTip from "@Components/RadixComponents/ToolTip";
import BaseLayerSwitcher from "@Components/common/MapLibreComponents/BaseLayerSwitcher";
import { useMap } from "@Components/common/MapLibreComponents/MapContext";
import baseLayersData from "@Components/common/MapLibreComponents/BaseLayerSwitcher/baseLayers";
import RadioButton from "@Components/common/RadioButton";

interface MapZoomControlsProps {
  map: Map | null;
  onFitToBounds: (() => void) | null;
}

// Try Drone offers just two basemaps: OpenStreetMap and Esri satellite imagery
// (`satellite` = ArcGIS World_Imagery in baseLayers).
const layerOptions = [
  { name: "baseLayer", value: "osm", label: "OpenStreetMap" },
  { name: "baseLayer", value: "satellite", label: "Satellite (Esri)" },
];

const btnBase =
  "naxatw-flex naxatw-h-8 naxatw-w-8 naxatw-items-center naxatw-justify-center naxatw-bg-white naxatw-border-0 naxatw-cursor-pointer hover:naxatw-bg-grey-50";
const btnDisabled = "naxatw-opacity-40 naxatw-cursor-not-allowed hover:naxatw-bg-white";
const divider = "naxatw-h-px naxatw-bg-grey-300";

export default function MapZoomControls({ map, onFitToBounds }: MapZoomControlsProps) {
  const { isMapLoaded } = useMap();
  const [selectedBaseLayer, setSelectedBaseLayer] = useState("osm");
  const [layersOpen, setLayersOpen] = useState(false);

  return (
    <div className="naxatw-absolute naxatw-top-3 naxatw-right-3 naxatw-z-50 naxatw-flex naxatw-flex-col naxatw-rounded-md naxatw-border naxatw-border-grey-300 naxatw-bg-white naxatw-shadow-xl naxatw-overflow-visible">
      <ToolTip message="Zoom in" side="left">
        <button
          type="button"
          className={`${btnBase} naxatw-rounded-t-md naxatw-border-b naxatw-border-grey-300 ${!map ? btnDisabled : ""}`}
          onClick={() => map?.zoomIn()}
          disabled={!map}
          aria-label="Zoom in"
        >
          <span className="naxatw-text-lg naxatw-font-bold naxatw-leading-none naxatw-text-grey-700">+</span>
        </button>
      </ToolTip>

      <ToolTip message="Zoom out" side="left">
        <button
          type="button"
          className={`${btnBase} naxatw-border-b naxatw-border-grey-300 ${!map ? btnDisabled : ""}`}
          onClick={() => map?.zoomOut()}
          disabled={!map}
          aria-label="Zoom out"
        >
          <span className="naxatw-text-lg naxatw-font-bold naxatw-leading-none naxatw-text-grey-700">−</span>
        </button>
      </ToolTip>

      <ToolTip message="Zoom to bounds" side="left">
        <button
          type="button"
          className={`${btnBase} ${!onFitToBounds ? btnDisabled : ""}`}
          onClick={() => onFitToBounds?.()}
          disabled={!onFitToBounds}
          aria-label="Zoom to bounds"
        >
          <i className="material-icons-outlined naxatw-text-base naxatw-text-grey-700">zoom_out_map</i>
        </button>
      </ToolTip>

      <div className={divider} />

      <div className="naxatw-relative">
        <ToolTip message={layersOpen ? undefined : "Layers"} side="left">
          <button
            type="button"
            className={`${btnBase} naxatw-rounded-b-md ${layersOpen ? "naxatw-bg-grey-100" : ""}`}
            onClick={() => setLayersOpen((v) => !v)}
            aria-label="Toggle layer switcher"
            aria-expanded={layersOpen}
          >
            <i className="material-icons-outlined naxatw-text-base naxatw-text-grey-700">layers</i>
          </button>
        </ToolTip>

        {layersOpen && (
          <div className="naxatw-absolute naxatw-bottom-0 naxatw-right-full naxatw-mr-2 naxatw-z-50 naxatw-rounded-md naxatw-bg-white naxatw-px-3 naxatw-py-3 naxatw-shadow-xl naxatw-border naxatw-border-grey-300 naxatw-min-w-[150px]">
            <p className="naxatw-text-xs naxatw-font-semibold naxatw-text-grey-600 naxatw-mb-2 naxatw-uppercase naxatw-tracking-wide">
              Basemap
            </p>
            <RadioButton
              options={layerOptions}
              direction="column"
              onChangeData={(value) => {
                setSelectedBaseLayer(value);
                setLayersOpen(false);
              }}
              value={selectedBaseLayer}
              name="baseLayer"
              className="naxatw-text-sm naxatw-capitalize"
            />
          </div>
        )}
      </div>

      <BaseLayerSwitcher
        activeLayer={selectedBaseLayer}
        baseLayers={baseLayersData}
        map={map}
        isMapLoaded={isMapLoaded}
      />
    </div>
  );
}
