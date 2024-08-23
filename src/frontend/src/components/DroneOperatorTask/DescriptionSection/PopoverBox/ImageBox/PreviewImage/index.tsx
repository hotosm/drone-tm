import { useTypedSelector } from '@Store/hooks';

const PreviewImage = () => {
  const clickedImage = useTypedSelector(
    state => state.droneOperatorTask.clickedImage,
  );
  return (
    <img
      src={clickedImage}
      className={`naxatw-aspect-[3/4] naxatw-w-full naxatw-rounded-[0.25rem] naxatw-object-cover ${clickedImage ? 'naxatw-block' : 'naxatw-hidden'}`}
      alt=""
    />
  );
};

export default PreviewImage;
