import useOutsideClick from "@Hooks/useOutsideClick";
import { useState } from "react";
import RadioButton from "@Components/common/RadioButton";
import { m } from "@/paraglide/messages";
import BaseLayerSwitcher from "../MapLibreComponents/BaseLayerSwitcher";
import baseLayersData from "../MapLibreComponents/BaseLayerSwitcher/baseLayers";
import { useMap } from "../MapLibreComponents/MapContext";

const getBaseLayerLabel = (key: string) => {
  const labels: Record<string, string> = {
    osm: m.common_basemap_osm(),
    "osm-light": m.common_basemap_osm_light(),
    satellite: m.common_basemap_satellite(),
    topo: m.common_basemap_topo(),
    hybrid: m.common_basemap_hybrid(),
  };
  return labels[key] || key;
};

const BaseLayerSwitcherUI = () => {
  const { map, isMapLoaded } = useMap();
  const [selectedBaseLayer, setSelectedBaseLayer] = useState("osm");
  // eslint-disable-next-line no-unused-vars
  const [_, toggle, handleToggle]: any = useOutsideClick("single");
  const baseLayerList = baseLayersData;

  const layerOptions = Object.keys(baseLayerList).map((key) => ({
    name: "baseLayer",
    value: key,
    label: getBaseLayerLabel(key),
  }));

  return (
    <>
      <div
        className="naxatw-absolute naxatw-left-2 naxatw-top-3 naxatw-z-50 naxatw-flex naxatw-h-[29px] naxatw-w-[29px] naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-md naxatw-border naxatw-bg-white naxatw-py-1 naxatw-shadow-xl hover:naxatw-bg-[#f5f5f5]"
        onClick={() => {
          handleToggle();
        }}
        role="presentation"
        title={m.common_map_layer_switcher()}
      >
        <i className="material-icons-outlined naxatw-text-xl naxatw-font-black">layers</i>
      </div>
      {toggle && (
        <div className="naxatw-absolute naxatw-left-10 naxatw-top-3 naxatw-z-50 naxatw-gap-1 naxatw-rounded-md naxatw-bg-white naxatw-px-2 naxatw-py-2">
          <RadioButton
            options={layerOptions}
            direction="column"
            onChangeData={(value) => {
              setSelectedBaseLayer(value);
              handleToggle();
            }}
            value={selectedBaseLayer}
            name="baseLayer"
            className="naxatw-text-sm naxatw-capitalize"
          />
        </div>
      )}

      <BaseLayerSwitcher
        activeLayer={selectedBaseLayer}
        baseLayers={baseLayerList}
        map={map}
        isMapLoaded={isMapLoaded}
      />
    </>
  );
};

export default BaseLayerSwitcherUI;
