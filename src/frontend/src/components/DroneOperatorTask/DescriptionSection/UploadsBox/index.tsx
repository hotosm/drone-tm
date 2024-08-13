/* eslint-disable no-await-in-loop */
/* eslint-disable no-console */
/* eslint-disable no-unused-vars */
import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { Button } from '@Components/RadixComponents/Button';
import { getImageUploadLink } from '@Services/droneOperator';

import FilesUploadingPopOver from '../PopoverBox';

const UploadsBox = () => {
  const projectId = '9deb9a04-374a-40ab-ae81-3d44812b27ec';
  const taskId = 'f2c7fde5-33d3-4a84-aa34-413a62409df2';

  const [files, setFiles] = useState<any[]>([]);
  const [loadingWidth, setLoadingWidth] = useState(0);
  const [imageList, setImageList] = useState<any[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const uploadedFilesNumber = useRef(0);

  const handleFileChange = (event: any) => {
    const selectedFiles = event.target.files;
    const selectedFilesArray = Array.from(selectedFiles);
    setFiles(selectedFilesArray);
    const imagesArray = selectedFilesArray?.map((file: any) => file.name);
    setImageList(imagesArray);
  };

  // function that calls the api simultaneously
  async function callApiSimultaneously(urls: any, data: any) {
    const promises = urls.map((url: any, index: any) =>
      axios.put(url, data[index]),
    );
    const responses = await Promise.all(promises);
    return responses;
  }

  // function that delays the execution of the next chunk of files
  // eslint-disable-next-line no-promise-executor-return
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // function that divides response into chunks of 4
  function chunkArray(array: any[], chunkSize: number) {
    const result = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      result.push(array.slice(i, i + chunkSize));
    }
    return result;
  }

  // function to calculate the width of the progress bar according to the number of files uploaded
  function widthCalulator(uploadedFiles: number, filesLength: number) {
    return (uploadedFiles / filesLength) * 100;
  }

  const { mutate } = useMutation({
    mutationFn: async (data: any) => {
      const urlsData = await getImageUploadLink(data);

      // urls fromm array of objects is retrieved and stored in value
      const urls = urlsData.data.map((url: any) => url.url);
      const chunkedUrls = chunkArray(urls, 4);
      const chunkedFiles = chunkArray(files, 4);

      // this calls api simultaneously for each chunk of files
      // each chunk contains 4 files
      for (let index = 0; index < chunkedUrls.length; index++) {
        const urlChunk = chunkedUrls[index];

        await callApiSimultaneously(urlChunk, chunkedFiles[index]);
        uploadedFilesNumber.current += urlChunk.length;
        const width = widthCalulator(uploadedFilesNumber.current, files.length);
        setLoadingWidth(width);

        // to call api in chunks of 4 with a delay of 2 seconds
        if (index < chunkedUrls.length - 1) {
          await delay(2000);
        }
      }
    },
    onSuccess: data => {
      console.log('uploaded', data);
    },
    onError: error => {
      console.error('Error creating user:', error);
    },
  });

  function handleSubmit() {
    setPopoverOpen(true);
    const filesData = {
      expiry: 5,
      task_id: taskId,
      image_name: imageList,
      project_id: projectId,
    };
    mutate(filesData);
  }

  return (
    <>
      <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-gap-5">
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
          <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
            Upload Raw Image
          </p>
          {/* <Controller
            control={control}
            name="image_folder"
            render={() => {
              return (
                <FileUpload
                  name="outline_geojson"
                  data={[]}
                  fileAccept=".jpg, ."
                  placeholder="*The supported file formats are jpeg,pn"
                  register={register}
                  multiple
                />
              );
            }}
          /> */}
        </div>
        <input
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
          onClick={() => handleSubmit()}
        >
          Save
        </Button>
        <FilesUploadingPopOver
          show={popoverOpen}
          width={loadingWidth}
          filesLength={files.length}
          uploadedFiles={uploadedFilesNumber.current}
        />
      </div>
    </>
  );
};
export default UploadsBox;
