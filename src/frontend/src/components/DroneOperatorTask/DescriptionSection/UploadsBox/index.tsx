/* eslint-disable no-await-in-loop */
/* eslint-disable no-console */
/* eslint-disable no-unused-vars */
import { Button } from '@Components/RadixComponents/Button';
import { toggleModal } from '@Store/actions/common';
import { setFiles } from '@Store/actions/droneOperatorTask';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';

const UploadsBox = () => {
  const dispatch = useTypedDispatch();
  const files = useTypedSelector(state => state.droneOperatorTask.files);
  const handleFileChange = (event: any) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles) return;
    const selectedFilesArray = Array.from(selectedFiles);
    dispatch(setFiles(selectedFilesArray));
    dispatch(toggleModal('raw-image-preview'));
  };

  return (
    <>
      <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-gap-5">
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
          <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
            Upload Raw Image
          </p>
        </div>
        <input
          type="file"
          // @ts-ignore
          webkitDirectory=""
          directory=""
          multiple
          onChange={handleFileChange}
        />
        {files.length > 0 && (
          <Button
            variant="ghost"
            className="naxatw-mx-auto naxatw-w-fit naxatw-bg-[#D73F3F] naxatw-text-[#FFFFFF]"
            onClick={() => dispatch(toggleModal('raw-image-preview'))}
          >
            Upload
          </Button>
        )}
      </div>
    </>
  );
};
export default UploadsBox;
