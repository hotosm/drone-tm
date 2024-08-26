import {
  setSelectedImage,
  unCheckImages,
} from '@Store/actions/droneOperatorTask';
import { useTypedDispatch } from '@Store/hooks';

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

  return (
    <>
      <div
        className="naxatw-flex naxatw-h-24 naxatw-w-[6.75rem] naxatw-flex-col naxatw-gap-1 naxatw-rounded-lg naxatw-bg-gray-100 naxatw-px-1 hover:naxatw-bg-gray-300"
        role="presentation"
        onClick={() => dispatch(setSelectedImage(image))}
      >
        <div className="naxatw-flex naxatw-h-16 naxatw-w-full naxatw-cursor-pointer naxatw-items-center naxatw-justify-center">
          {/* <img
            src={image}1
            onLoad={handleLoad}
            alt=""
            className="naxatw-h-[8.75rem] naxatw-w-full naxatw-cursor-pointer naxatw-rounded-[0.25rem] naxatw-transition hover:naxatw-scale-150"
            onClick={() => dispatch(setSelectedImage(image))}
          /> */}
          <i className="material-icons naxatw-text-[65px] naxatw-text-gray-400">
            image
          </i>
        </div>
        <div
          role="presentation"
          className="naxatw-flex naxatw-w-full naxatw-cursor-pointer naxatw-items-center naxatw-gap-2 naxatw-overflow-hidden"
          onClick={e => {
            e.stopPropagation();
            dispatch(unCheckImages(deselectImages));
          }}
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
