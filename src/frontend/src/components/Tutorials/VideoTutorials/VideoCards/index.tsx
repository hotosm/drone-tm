/* eslint-disable jsx-a11y/media-has-caption */
import Icon from '@Components/common/Icon';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import { useState } from 'react';

export interface IVideoCardProps {
  title: string;
  onClick: () => void;
  thumbnail?: string;
}

export const RowVideoCards = ({
  title,
  onClick,
  thumbnail,
}: IVideoCardProps) => {
  const [hover, setHover] = useState(false);

  return (
    <>
      <FlexRow
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="naxatw-h-fit naxatw-w-full naxatw-cursor-pointer naxatw-items-stretch naxatw-justify-center naxatw-gap-4 naxatw-px-4"
        onClick={() => onClick()}
      >
        <div className="naxatw-grid naxatw-grid-cols-[40%_60%] naxatw-gap-4">
          <div className="naxatw-relative naxatw-h-full">
            <img
              src={thumbnail}
              alt="Thumbnail"
              className="naxatw-min-h-[7rem] naxatw-w-full naxatw-rounded-lg naxatw-border-2 naxatw-bg-[#2625253b] naxatw-object-cover naxatw-shadow-sm"
            />
            <Icon
              name="play_arrow"
              className={`naxatw-absolute naxatw-left-1/2 naxatw-top-1/2 naxatw-z-50 naxatw-translate-x-[-50%] naxatw-translate-y-[-50%] !naxatw-text-[3rem] ${hover ? '' : '!naxatw-hidden'} naxatw-text-white`}
              iconSymbolType="material-icons"
            />
          </div>
          <FlexColumn className="naxatw-h-full naxatw-items-start naxatw-gap-2">
            <div className="naxatw-flex naxatw-w-full naxatw-justify-between">
              <p className="naxatw-text-primary-700 naxatw-text-base naxatw-font-semibold">
                {title}
              </p>
            </div>
          </FlexColumn>
        </div>
      </FlexRow>
    </>
  );
};

export const ColumnVideoCards = ({
  title,
  onClick,
  thumbnail,
}: IVideoCardProps) => {
  const [hover, setHover] = useState(false);

  return (
    <>
      <FlexColumn
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="naxatw-group naxatw-relative naxatw-w-full naxatw-flex-1 naxatw-cursor-pointer naxatw-items-start naxatw-gap-4 naxatw-overflow-hidden naxatw-rounded-lg naxatw-border naxatw-bg-white naxatw-shadow-sm hover:naxatw-shadow-lg sm:naxatw-h-full sm:naxatw-min-h-[15rem]"
        onClick={() => onClick()}
      >
        <div className="naxatw-relative naxatw-h-[14rem] naxatw-w-full sm:naxatw-h-[12rem]">
          <img
            src={thumbnail}
            alt="Thumbnail"
            className="naxatw-h-[14rem] naxatw-w-full naxatw-self-stretch naxatw-rounded-lg naxatw-border-2 naxatw-bg-[#2625253b] naxatw-object-cover naxatw-shadow-sm group-hover:naxatw-grayscale-[0.6] sm:naxatw-h-[12rem]"
          />
          <Icon
            name="play_arrow"
            className={`naxatw-absolute naxatw-left-1/2 naxatw-top-1/2 naxatw-z-50 naxatw-translate-x-[-50%] naxatw-translate-y-[-50%] !naxatw-text-[3rem] ${hover ? '' : '!naxatw-hidden'} naxatw-text-white`}
            iconSymbolType="material-icons"
          />
        </div>
        <FlexColumn className="naxatw-min-h-[2rem] naxatw-w-full naxatw-items-start naxatw-gap-2 naxatw-px-3 naxatw-pb-3 naxatw-pt-0">
          <div className="naxatw-flex naxatw-w-full naxatw-justify-between">
            <p className="naxatw-text-primary-700 naxatw-text-base naxatw-font-semibold">
              {title}
            </p>
          </div>
        </FlexColumn>
      </FlexColumn>
    </>
  );
};
