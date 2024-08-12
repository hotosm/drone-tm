// import { useState } from 'react';
// import FileUpload from '@Components/common/UploadArea';
// import { Button } from '@Components/RadixComponents/Button';
// import Popover from '@Components/RadixComponents/Popover';
// import FilesUploadingPopOver from '../PopoverBox';

const UploadsBox = () => {
  // const [files, setFiles] = useState([]);
  // const [popoverOpen, setPopoverOpen] = useState(false);

  // const handleFileChange = (event: any) => {
  //   const selectedFiles = event.target.files;
  //   // Convert FileList to an array
  //   const filesArray = Array.from(selectedFiles);
  //   setFiles(filesArray);
  // };
  return (
    <>
      <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-gap-5">
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
          <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
            Upload Raw Image
          </p>
          {/* <FileUpload
            name="outline_geojson"
            data={[]}
            // onChange={handleProjectAreaFileChange}
            fileAccept=".jpg, ."
            placeholder="*The supported file formats are jpeg,pn"
            // isValid={validateAreaOfFileUpload}
            // {...formProps}
            webkitdirectory=""
            directory=""
            multiple
            control={() => {}}
            register={() => {}}
          /> */}
        </div>
        {/* <input
          type="file"
          // @ts-ignore
          webkitDirectory=""
          directory=""
          multiple
          onChange={handleFileChange}
        />
        <Button
          variant="ghost"
          className="naxatw-mx-auto naxatw-w-fit naxatw-bg-[#D73F3F] naxatw-text-[#FFFFFF]"
          onClick={() => setPopoverOpen(true)}
        >
          Save
        </Button>
        <FilesUploadingPopOver show={popoverOpen} /> */}
      </div>
    </>
  );
};
export default UploadsBox;
