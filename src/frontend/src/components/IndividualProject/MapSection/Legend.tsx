import area from '@Assets/images/area-icon.png';
import lock from '@Assets/images/lock.png';
import { FlexColumn } from '@Components/common/Layouts';
import { useState } from 'react';

const Legend = () => {
  const [showLegendItems, setShowLegendItems] = useState<Boolean>(true);
  return (
    <div className="naxatw-absolute naxatw-bottom-2 naxatw-left-3 naxatw-z-50 naxatw-w-52 naxatw-rounded-sm naxatw-bg-white naxatw-p-3">
      <FlexColumn className="naxatw-gap-2">
        <div className="naxatw-flex naxatw-justify-between">
          <div className="naxatw-text-base naxatw-font-semibold">Legend</div>
          <i
            className="material-icons naxatw-cursor-pointer naxatw-rounded-full hover:naxatw-bg-redlight"
            role="presentation"
            onClick={() => setShowLegendItems(!showLegendItems)}
          >
            {showLegendItems ? 'expand_more' : 'expand_less'}
          </i>
        </div>
        {showLegendItems && (
          <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
            {/* REQUEST_FOR_MAPPING */}
            <div className="naxatw-flex naxatw-gap-2">
              <div className="naxatw-h-5 naxatw-w-5 naxatw-bg-[#F3C5C5]" />
              <p className="naxatw-text-sm">Flight Requested</p>
            </div>
            {/* LOCKED_FOR_MAPPING */}
            <div className="naxatw-flex naxatw-gap-2">
              <div className="naxatw-h-5 naxatw-w-5 naxatw-bg-[#98BBC8]">
                <img src={lock} alt="area-icon" className="naxatw-p-0.5" />
              </div>
              <p className="naxatw-text-sm">Locked Tasks</p>
            </div>
            {/* IMAGE_UPLOADED */}
            <div className="naxatw-flex naxatw-gap-2">
              <div className="naxatw-h-5 naxatw-w-5 naxatw-bg-[#9ec7ff]" />
              <p className="naxatw-text-sm">Ready To Process</p>
            </div>
            {/* IMAGE_PROCESSING_STARTED */}
            <div className="naxatw-flex naxatw-gap-2">
              <div className="naxatw-h-5 naxatw-w-5 naxatw-bg-[#9C77B2] naxatw-opacity-60" />
              <p className="naxatw-text-sm">Image Processing Started</p>
            </div>
            {/* IMAGE_PROCESSING_FAILED */}
            <div className="naxatw-flex naxatw-gap-2">
              <div className="naxatw-h-5 naxatw-w-5 naxatw-bg-[#D73F3F] naxatw-opacity-60" />
              <p className="naxatw-text-sm">Image Processing Failed</p>
            </div>
            {/* IMAGE_PROCESSING_FINISHED */}
            <div className="naxatw-flex naxatw-gap-2">
              <div className="naxatw-h-5 naxatw-w-5 naxatw-bg-[#ACD2C4]" />
              <p className="naxatw-text-sm">Finished Tasks</p>
            </div>
            {/* UNLOCKED_TO_MAP */}
            <div className="naxatw-flex naxatw-gap-2">
              <div className="naxatw-h-5 naxatw-w-5 naxatw-border naxatw-border-[#68707F]" />
              <p className="naxatw-text-sm">Not Started</p>
            </div>
            <div className="naxatw-flex naxatw-gap-2">
              <div className="naxatw-h-5 naxatw-w-5">
                <img src={area} alt="area-icon" />
              </div>
              <p className="naxatw-text-sm">Project Area</p>
            </div>
            <div className="naxatw-flex naxatw-gap-2">
              <div className="naxatw-h-5 naxatw-w-5 naxatw-bg-[#68707F] naxatw-opacity-60" />
              <p className="naxatw-text-sm">Unflyable Areas</p>
            </div>
          </div>
        )}
      </FlexColumn>
    </div>
  );
};

export default Legend;
