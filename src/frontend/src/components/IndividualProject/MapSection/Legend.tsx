import area from '@Assets/images/area-icon.png';
import lock from '@Assets/images/lock.png';
import { useState } from 'react';

const Legend = () => {
  const [showLegendItems, setShowLegendItems] = useState<Boolean>(false);
  return (
    <div className="naxatw-absolute naxatw-bottom-2 naxatw-left-3 naxatw-z-50 naxatw-w-40 naxatw-rounded-sm naxatw-bg-white naxatw-p-3">
      <div className="naxatw-flex naxatw-justify-between">
        <div className="naxatw-text-base naxatw-font-semibold">Legend</div>
        <i
          className="material-icons naxatw-cursor-pointer naxatw-rounded-full hover:naxatw-bg-redlight"
          role="presentation"
          onClick={() => setShowLegendItems(!showLegendItems)}
        >
          {showLegendItems ? 'expand_less' : 'expand_more'}
        </i>
      </div>
      {showLegendItems && (
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
          <div className="naxatw-flex naxatw-gap-2">
            <div className="naxatw-h-5 naxatw-w-5 naxatw-bg-[#ACD2C4]" />
            <div className="naxatw-text-sm">Finished Tasks</div>
          </div>
          <div className="naxatw-flex naxatw-gap-2">
            <div className="naxatw-h-5 naxatw-w-5 naxatw-bg-[#F3C5C5]" />
            <div className="naxatw-text-sm">Requested Tasks</div>
          </div>
          <div className="naxatw-flex naxatw-gap-2">
            <div className="naxatw-h-5 naxatw-w-5 naxatw-bg-[#98BBC8]">
              <img src={lock} alt="area-icon" className="naxatw-p-0.5" />
            </div>
            <div className="naxatw-text-sm">Locked Tasks</div>
          </div>
          <div className="naxatw-flex naxatw-gap-2">
            <div className="naxatw-h-5 naxatw-w-5 naxatw-border naxatw-border-[#68707F]" />
            <div className="naxatw-text-sm">Remaining Task</div>
          </div>
          <div className="naxatw-flex naxatw-gap-2">
            <div className="naxatw-h-5 naxatw-w-5">
              <img src={area} alt="area-icon" />
            </div>
            <div className="naxatw-text-sm">Project Area</div>
          </div>
          <div className="naxatw-flex naxatw-gap-2">
            <div className="naxatw-h-5 naxatw-w-5 naxatw-bg-[#68707F] naxatw-opacity-60" />
            <div className="naxatw-text-sm">Unflyable Areas</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Legend;
