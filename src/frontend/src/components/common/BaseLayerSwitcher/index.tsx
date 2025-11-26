import useOutsideClick from '@Hooks/useOutsideClick';
import { useState } from 'react';
import BaseLayerSwitcher from '../MapLibreComponents/BaseLayerSwitcher';
import baseLayersData from '../MapLibreComponents/BaseLayerSwitcher/baseLayers';
import { useMap } from '../MapLibreComponents/MapContext';

const BaseLayerSwitcherUI = () => {
  const { map, isMapLoaded } = useMap();
  const [selectedBaseLayer, setSelectedBaseLayer] = useState('osm');
  // eslint-disable-next-line no-unused-vars
  const [_, toggle, handleToggle]: any = useOutsideClick('single');
  const baseLayerList = baseLayersData;

  return (
    <>
      <div
        className="naxatw-absolute naxatw-left-2 naxatw-top-3 naxatw-z-50 naxatw-flex naxatw-h-[29px] naxatw-w-[29px] naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-md naxatw-border naxatw-bg-white naxatw-py-1 naxatw-shadow-xl hover:naxatw-bg-[#f5f5f5]"
        onClick={() => {
          handleToggle();
        }}
        role="presentation"
        title="Layer Switcher"
      >
        <i className="material-icons-outlined naxatw-text-xl naxatw-font-black">
          layers
        </i>
      </div>
      {toggle && (
        <div className="naxatw-absolute naxatw-left-10 naxatw-top-3 naxatw-z-50 naxatw-gap-1 naxatw-rounded-md naxatw-bg-white naxatw-px-2 naxatw-py-2">
          {Object.entries(baseLayerList)?.map(([key]) => (
            <div className="naxatw-flex naxatw-gap-1" key={key}>
              <input
                id={key}
                type="radio"
                value={key}
                checked={selectedBaseLayer === key}
                className="naxatw-cursor-pointer"
                onChange={e => {
                  setSelectedBaseLayer(e.target.value);
                  handleToggle();
                }}
              />
              <label
                htmlFor={key}
                className="naxatw-cursor-pointer naxatw-text-sm naxatw-capitalize hover:naxatw-underline"
              >
                {key}
              </label>
            </div>
          ))}
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
