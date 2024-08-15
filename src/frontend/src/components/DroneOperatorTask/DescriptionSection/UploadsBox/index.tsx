/* eslint-disable no-await-in-loop */
/* eslint-disable no-console */
/* eslint-disable no-unused-vars */
import { useState } from 'react';

import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import {
  setSelectedImage,
  showPopover,
} from '@Store/actions/droneOperatorTask';
import { Button } from '@Components/RadixComponents/Button';

import ImageBoxPopOver from '../PopoverBox/ImageBox';

const UploadsBox = () => {
  const dispatch = useTypedDispatch();
  const { popOver } = useTypedSelector(state => state.droneOperatorTask);

  const [files, setFiles] = useState<any[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const handleFileChange = (event: any) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles) return;
    const selectedFilesArray = Array.from(selectedFiles);
    setFiles(selectedFilesArray);
    dispatch(showPopover());
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
            onClick={() => dispatch(showPopover())}
          >
            Upload
          </Button>
        )}
      </div>
      <ImageBoxPopOver show={popOver} imageFiles={files} />
    </>
  );
};
export default UploadsBox;
