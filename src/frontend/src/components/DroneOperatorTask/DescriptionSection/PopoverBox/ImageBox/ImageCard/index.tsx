/* eslint-disable jsx-a11y/interactive-supports-focus */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useState } from 'react';

import {
  setSelectedImage,
  unCheckImages,
} from '@Store/actions/droneOperatorTask';
import { useTypedDispatch } from '@Store/hooks';
import Skeleton from '@Components/RadixComponents/Skeleton';

interface IImageCardProps {
  image: string;
  imageName: string;
  checked: boolean;
  deselectImages?: number;
}
const ImageCard = ({
  image,
  imageName,
  checked,
  deselectImages,
}: IImageCardProps) => {
  const dispatch = useTypedDispatch();
  const [loading, setLoading] = useState(true);

  const handleLoad = () => {
    setLoading(false);
  };
  return (
    <>
      {loading && (
        <Skeleton className="naxatw-h-[8.75rem] naxatw-w-[8.75rem]" />
      )}
      <div
        className={`naxatw-flex naxatw-w-[8.75rem] naxatw-flex-col naxatw-gap-1 ${loading ? 'naxatw-hidden' : 'naxatw-block'}`}
      >
        <div className="naxatw-w-full naxatw-overflow-hidden naxatw-rounded-[0.25rem]">
          <img
            src={image}
            onLoad={handleLoad}
            alt=""
            className="naxatw-h-[8.75rem] naxatw-w-full naxatw-cursor-pointer naxatw-rounded-[0.25rem] naxatw-transition hover:naxatw-scale-150"
            onClick={() => dispatch(setSelectedImage(image))}
          />
        </div>
        <div
          role="button"
          className="naxatw-flex naxatw-w-full naxatw-cursor-pointer naxatw-items-center naxatw-gap-2 naxatw-overflow-hidden"
          onClick={() => dispatch(unCheckImages(deselectImages))}
        >
          <input
            type="checkbox"
            checked={checked}
            className="naxatw-cursor-pointer"
          />
          <p className="naxatw-truncate naxatw-text-nowrap naxatw-text-[0.875rem] naxatw-leading-normal naxatw-text-black">
            {imageName}
          </p>
        </div>
      </div>
    </>
  );
};

export default ImageCard;
