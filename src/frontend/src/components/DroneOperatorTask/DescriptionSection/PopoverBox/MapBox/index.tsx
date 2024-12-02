/* eslint-disable no-await-in-loop */
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { FlexColumn } from '@Components/common/Layouts';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import AsyncPopup from '@Components/common/MapLibreComponents/AsyncPopup';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import { Button } from '@Components/RadixComponents/Button';
import {
  resetFilesExifData,
  setFilesExifData,
} from '@Store/actions/droneOperatorTask';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import convertExifDataToGeoJson from '@Utils/exifDataToGeoJson';
import sortByDatetime from '@Utils/sortArrayUsingDate';
import { NavigationControl, AttributionControl, Map } from 'maplibre-gl';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import callApiSimultaneously from '@Utils/callApiSimultaneously';
import chunkArray from '@Utils/createChunksOfArray';
import { getImageUploadLink } from '@Services/droneOperator';
import { useMutation } from '@tanstack/react-query';
import { postTaskStatus } from '@Services/project';
import { postProcessImagery } from '@Services/tasks';
import widthCalulator from '@Utils/percentageCalculator';
import FilesUploadingPopOver from '../LoadingBox';

const ImageMapBox = () => {
  const dispatch = useTypedDispatch();
  const popupRef = useRef<HTMLDivElement | null>(null);

  const uploadedFilesNumber = useRef(0);
  const pathname = window.location.pathname?.split('/');
  const projectId = pathname?.[2];
  const taskId = pathname?.[4];

  const [progressBar, setProgressBar] = useState(false);
  const [loadingWidth, setLoadingWidth] = useState(0);
  const [imageFilesGeoJsonData, setImageFilesGeoJsonData] =
    useState<Record<string, any>>();
  const [imageFilesLineStringData, setImageFilesLineStringData] =
    useState<Record<string, any>>();
  const [popupData, setPopupData] = useState<Record<string, any>>();

  const uploadedImageType = useTypedSelector(
    state => state.droneOperatorTask.uploadedImagesType,
  );
  const filesExifData = useTypedSelector(
    state => state.droneOperatorTask.filesExifData,
  );
  const modalState = useTypedSelector(state => state.common.showModal);

  useEffect(() => {
    if (!modalState) {
      dispatch(setFilesExifData([]));
    }
  }, [dispatch, modalState]);

  useEffect(() => {
    if (filesExifData.length === 0) return;
    const imageFilesGeoData = convertExifDataToGeoJson(filesExifData);
    setImageFilesGeoJsonData(imageFilesGeoData);
    const sortedImageFiles = sortByDatetime(filesExifData);
    const imageFilesLineString = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            // get all coordinates
            coordinates: sortedImageFiles.map(fileLocation => [
              Number(fileLocation.coordinates.longitude) ?? 0,
              Number(fileLocation.coordinates.latitude) ?? 0,
            ]),
          },
        },
      ],
    };
    setImageFilesLineStringData(imageFilesLineString);
  }, [filesExifData]);

  const { map, isMapLoaded } = useMapLibreGLMap({
    containerId: 'image-upload-map',
    mapOptions: {
      zoom: 2,
      center: [0, 0],
      maxZoom: 25,
      renderWorldCopies: false, // Prevent rendering copies of the map outside the primary view
      refreshExpiredTiles: false,
    },
    disableRotation: true,
  });

  useEffect(() => {
    if (isMapLoaded && map) {
      map.addControl(new NavigationControl(), 'top-right');

      // Add attribution control
      map.addControl(
        new AttributionControl({
          compact: true, // Optional: make the attribution compact
        }),
        'bottom-right',
      );
    }
  }, [isMapLoaded, map]);

  const getPopupUI = useCallback(() => {
    return (
      <FlexColumn className="naxatw-items-start naxatw-gap-2">
        <FlexColumn className="naxatw-gap-1">
          <p className="naxatw-text-base naxatw-font-medium naxatw-text-black">
            {popupData?.name}
          </p>
          <p>
            {popupData?.coordinates?.lat?.toFixed(8)},&nbsp;
            {popupData?.coordinates?.lng?.toFixed(8)}{' '}
          </p>
        </FlexColumn>
        <img src={popupData?.fileBob} alt="Uploaded" />
      </FlexColumn>
    );
  }, [popupData]);

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
      const urls = urlsData.data.map(({ url }: { url: string }) => url);
      const chunkedUrls = chunkArray(urls, 4);
      const files = filesExifData.map(file => file.file);
      const chunkedFiles = chunkArray(files, 4);

      // this calls api simultaneously for each chunk of files
      // each chunk contains 4 files
      for (let index = 0; index < chunkedUrls.length; index++) {
        const urlChunk = chunkedUrls[index];

        await callApiSimultaneously(urlChunk, chunkedFiles[index]);
        uploadedFilesNumber.current += urlChunk.length;
        const width = widthCalulator(uploadedFilesNumber.current, files.length);
        setLoadingWidth(width);
      }
      startImageryProcess();
    },
    onSuccess: () => {
      resetFilesExifData();
    },
  });

  function handleSubmit() {
    setProgressBar(true);
    const filesData = {
      expiry: 5,
      task_id: taskId,
      image_name: filesExifData.map(file => file.file.name),
      project_id: projectId,
    };
    mutate(filesData);
  }

  return (
    <>
      <FlexColumn className="naxatw-h-[calc(100vh-220px)] naxatw-gap-5">
        <div className="naxatw-h-[calc(100vh-250px)] naxatw-w-full naxatw-bg-gray-200">
          <MapContainer
            map={map}
            isMapLoaded={isMapLoaded}
            containerId="image-upload-map"
            style={{
              width: '100%',
              height: '100%',
            }}
          >
            <BaseLayerSwitcherUI />
            <VectorLayer
              map={map as Map}
              isMapLoaded={isMapLoaded}
              id="image-points-map"
              geojson={imageFilesGeoJsonData as GeojsonType}
              visibleOnMap={!!imageFilesGeoJsonData}
              interactions={['feature']}
              layerOptions={{
                type: 'circle',
                paint: {
                  'circle-color': '#176149',
                  'circle-radius': 6,
                  'circle-stroke-width': 4,
                  'circle-stroke-color': 'red',
                  'circle-stroke-opacity': 1,
                  'circle-opacity': [
                    'match',
                    ['get', 'index'],
                    0,
                    0,
                    Number(
                      // eslint-disable-next-line no-unsafe-optional-chaining
                      imageFilesGeoJsonData?.features?.length - 1,
                    ),
                    0,
                    1,
                  ],
                },
              }}
              zoomToExtent
            />
            <VectorLayer
              map={map as Map}
              isMapLoaded={isMapLoaded}
              id="image-lines"
              geojson={imageFilesLineStringData as GeojsonType}
              visibleOnMap={!!imageFilesLineStringData}
              interactions={['feature']}
              layerOptions={{
                type: 'line',
                paint: {
                  'line-color': '#000000',
                  'line-width': 2,
                  // 'line-dasharray': [6, 3],
                },
              }}
              symbolPlacement="line"
              iconAnchor="center"
            />
            <AsyncPopup
              map={map as Map}
              showPopup={(feature: Record<string, any>) => {
                return feature?.source === 'image-points-map';
              }}
              popupUI={getPopupUI}
              fetchPopupData={(properties: Record<string, any>) => {
                setPopupData(properties);
              }}
              hideButton={false}
              getCoordOnProperties
              buttonText="Remove"
              handleBtnClick={fileData => {
                const newFilesData = filesExifData.filter(
                  filex => filex.file.name !== fileData.name,
                );
                dispatch(setFilesExifData(newFilesData));
                // dispatch(setIma)
                if (popupRef.current) {
                  const closeButton = popupRef.current?.querySelector(
                    '#close-popup',
                  ) as HTMLElement;
                  closeButton?.click();
                }
              }}
              ref={popupRef}
              title="Image Preview"
            />
          </MapContainer>
          <p className="naxatw-text-lg naxatw-font-medium">
            {filesExifData.length} Images Selected
          </p>
        </div>
        <div className="naxatw-mx-auto naxatw-w-fit">
          <Button
            variant="ghost"
            className="naxatw-mx-auto naxatw-w-fit naxatw-bg-[#D73F3F] naxatw-text-[#FFFFFF]"
            onClick={() => handleSubmit()}
            disabled={filesExifData.length === 0}
          >
            Upload
          </Button>
        </div>
      </FlexColumn>
      {/* ---------- loading popover-------------- */}
      <FilesUploadingPopOver
        show={progressBar}
        width={loadingWidth}
        filesLength={filesExifData.length}
        uploadedFiles={uploadedFilesNumber.current}
      />
    </>
  );
};

export default ImageMapBox;
