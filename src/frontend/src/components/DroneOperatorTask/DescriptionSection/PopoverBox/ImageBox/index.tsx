/* eslint-disable no-await-in-loop */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import { Button } from '@Components/RadixComponents/Button';
import { getImageUploadLink } from '@Services/droneOperator';
import { useMutation } from '@tanstack/react-query';
import {
  checkAllImages,
  setCheckedImages,
  unCheckAllImages,
} from '@Store/actions/droneOperatorTask';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import callApiSimultaneously from '@Utils/callApiSimultaneously';
import chunkArray from '@Utils/createChunksOfArray';
import delay from '@Utils/createDelay';
import widthCalulator from '@Utils/percentageCalculator';
import { postProcessImagery } from '@Services/tasks';
import { postTaskStatus } from '@Services/project';
import FilesUploadingPopOver from '../LoadingBox';
import ImageCard from './ImageCard';
import PreviewImage from './PreviewImage';

const ImageBoxPopOver = () => {
  const dispatch = useTypedDispatch();
  const pathname = window.location.pathname?.split('/');
  const projectId = pathname?.[2];
  const taskId = pathname?.[4];

  const uploadedFilesNumber = useRef(0);
  const [imageObject, setImageObject] = useState<any[]>([]);
  const [progressBar, setProgressBar] = useState(false);
  const [imagesNames, setImagesNames] = useState<string[]>([]);
  const [loadingWidth, setLoadingWidth] = useState(0);
  const [files, setFiles] = useState<any[]>([]);
  const imageFiles = useTypedSelector(state => state.droneOperatorTask.files);
  const clickedImage = useTypedSelector(
    state => state.droneOperatorTask.clickedImage,
  );
  const checkedImages = useTypedSelector(
    state => state.droneOperatorTask.checkedImages,
  );
  const uploadedImageType = useTypedSelector(
    state => state.droneOperatorTask.uploadedImagesType,
  );

  const { mutate: updateStatus } = useMutation<any, any, any, unknown>({
    mutationFn: postTaskStatus,
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const { mutate: startImageryProcess } = useMutation({
    mutationFn: () => postProcessImagery(projectId, taskId),
    onSuccess: () => {
      updateStatus({
        projectId,
        taskId,
        data: { event: 'image_upload', updated_at: new Date().toISOString() },
      });
      toast.success('Image processing started');
    },
  });

  // function that gets the signed urls for the images and again puts them in chunks of 4
  const { mutate } = useMutation({
    mutationFn: async (data: any) => {
      const urlsData = await getImageUploadLink(
        uploadedImageType === 'replace',
        data,
      );

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
          await delay(500);
        }
      }
      startImageryProcess();
    },
  });

  useEffect(() => {
    // creates objectsurl of images
    const uploadedFiles = imageFiles?.map(file =>
      // @ts-ignore
      URL.createObjectURL(file),
    );

    setImageObject(uploadedFiles);

    // sets the initial state of checked images i.e. true
    const initialState: { [key: number]: boolean } = {};
    uploadedFiles.forEach((_, index) => {
      initialState[index] = true;
    });
    dispatch(setCheckedImages(initialState));
  }, [dispatch, imageFiles]);

  // filters out the selected images and sets the selected images in the state
  useEffect(() => {
    // filters the checked images names
    const selectedImagesNames = imageFiles
      ?.map((file, index) => {
        if (checkedImages[index]) {
          return file.name;
        }
        return null;
      })
      .filter(name => name !== null);
    setImagesNames(selectedImagesNames);

    // set the selected image's binary file in the state
    const selectedBinaryFiles = imageFiles.filter(file =>
      selectedImagesNames.includes(file.name),
    );
    setFiles(selectedBinaryFiles);
  }, [imageFiles, checkedImages]);

  function handleSubmit() {
    setProgressBar(true);
    const filesData = {
      expiry: 5,
      task_id: taskId,
      image_name: imagesNames,
      project_id: projectId,
    };
    mutate(filesData);
  }
  function handleDeselectAllImages() {
    if (Object.values(checkedImages).every(value => value === false)) {
      return;
    }
    dispatch(unCheckAllImages());
  }
  function handleSelectAllImages() {
    if (Object.values(checkedImages).every(Boolean)) {
      return;
    }
    dispatch(checkAllImages());
  }
  const variants = {
    visible: { opacity: 1, x: 0 },
    hidden: { opacity: 0, x: '100%' },
  };
  return (
    <>
      {/* ------------------ image section ----------------- */}
      <div
        className={`naxatw-grid naxatw-gap-4 ${clickedImage ? 'naxatw-grid-cols-[70%_auto]' : 'naxatw-grid-cols-1'}`}
      >
        <div
          className={`scrollbar-images-grid naxatw-grid naxatw-h-[28rem] naxatw-gap-4 naxatw-overflow-y-auto ${clickedImage ? 'naxatw-grid-cols-2 md:naxatw-grid-cols-5' : 'naxatw-grid-cols-3 md:naxatw-grid-cols-6'}`}
        >
          {imageObject?.map((image, index) => (
            <ImageCard
              image={image}
              key={image}
              imageName={imageFiles[index].name}
              checked={checkedImages[index]}
              deselectImages={index}
            />
          ))}
        </div>

        {/* ----------------- preview Image --------------------- */}
        <motion.div
          animate={clickedImage ? 'visible' : 'hidden'}
          className="naxatw-w-full"
          variants={variants}
        >
          <PreviewImage />
        </motion.div>
      </div>

      {/* ------------------ buttons section ----------------- */}
      <div className="naxatw-flex naxatw-w-full naxatw-items-center naxatw-justify-between">
        <div className="naxatw-flex naxatw-gap-6">
          <div
            role="presentation"
            className="naxatw-flex naxatw-w-full naxatw-items-center naxatw-gap-2 naxatw-overflow-hidden"
            onClick={handleSelectAllImages}
          >
            <input
              type="checkbox"
              checked={Object.values(checkedImages).every(Boolean)}
            />
            <p className="naxatw-text-nowrap naxatw-text-[0.875rem] naxatw-leading-normal naxatw-text-black">
              Select All
            </p>
          </div>
          <div
            role="presentation"
            className="naxatw-flex naxatw-w-full naxatw-items-center naxatw-gap-2"
            onClick={handleDeselectAllImages}
          >
            <input
              type="checkbox"
              checked={Object.values(checkedImages).every(
                value => value === false,
              )}
            />
            <p className="naxatw-text-nowrap naxatw-text-[0.875rem] naxatw-leading-normal naxatw-text-black">
              Deselect All
            </p>
          </div>
        </div>
        <div className="naxatw-w-fit">
          <Button
            variant="ghost"
            className="naxatw-mx-auto naxatw-w-fit naxatw-bg-[#D73F3F] naxatw-text-[#FFFFFF]"
            onClick={() => handleSubmit()}
          >
            Upload Selected
          </Button>
        </div>
      </div>
      {/* ---------- loading popover-------------- */}
      <FilesUploadingPopOver
        show={progressBar}
        width={loadingWidth}
        filesLength={files.length}
        uploadedFiles={uploadedFilesNumber.current}
      />
    </>
  );
};

export default ImageBoxPopOver;
