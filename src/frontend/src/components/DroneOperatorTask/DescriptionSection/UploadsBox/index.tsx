/* eslint-disable no-await-in-loop */
/* eslint-disable no-console */
/* eslint-disable no-unused-vars */
import { Button } from '@Components/RadixComponents/Button';
import { toggleModal } from '@Store/actions/common';
import { setFiles } from '@Store/actions/droneOperatorTask';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';

const UploadsBox = ({ label = 'Upload Raw Image' }: { label?: string }) => {
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
            {label}
          </p>
        </div>

        <label
          htmlFor="file-input"
          className="naxatw-relative naxatw-flex naxatw-h-20 naxatw-items-center naxatw-justify-center naxatw-rounded-lg naxatw-border naxatw-border-dashed naxatw-border-gray-700"
        >
          <div className="n naxatw-flex naxatw-flex-col naxatw-items-center">
            <span className="material-icons-outlined naxatw-text-red">
              cloud_upload
            </span>
            <p className="naxatw-text-sm">
              The supported file formats are .jpg, .jpeg, .png
            </p>
            {files.length > 0 && (
              <p className="naxatw-text-sm naxatw-text-green-700">
                {files.length} items selected
              </p>
            )}
          </div>
          <input
            id="file-input"
            type="file"
            // @ts-ignore
            webkitDirectory=""
            directory=""
            multiple
            onChange={handleFileChange}
            className="naxatw-absolute naxatw-opacity-0"
          />
        </label>
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
