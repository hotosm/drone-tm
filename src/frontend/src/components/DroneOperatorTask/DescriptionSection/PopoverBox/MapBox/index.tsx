/* eslint-disable no-await-in-loop */
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { FlexColumn } from '@Components/common/Layouts';
import { useMapLibreGLMap } from '@Components/common/MapLibreComponents';
import AsyncPopup from '@Components/common/MapLibreComponents/NewAsyncPopup';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import { Button } from '@Components/RadixComponents/Button';
import {
  resetFilesExifData,
  setFilesExifData,
  setUploadProgress,
} from '@Store/actions/droneOperatorTask';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import convertExifDataToGeoJson from '@Utils/exifDataToGeoJson';
import sortByDatetime from '@Utils/sortArrayUsingDate';
import { NavigationControl, AttributionControl, Map } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import callApiSimultaneously from '@Utils/callApiSimultaneously';
import chunkArray from '@Utils/createChunksOfArray';
import { getImageUploadLink } from '@Services/droneOperator';
import { useMutation } from '@tanstack/react-query';
import { postTaskStatus } from '@Services/project';
import widthCalulator from '@Utils/percentageCalculator';
import { point } from '@turf/helpers';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import FilesUploadingPopOver from '../LoadingBox';

const ImageMapBox = () => {
  const dispatch = useTypedDispatch();
  const uploadedFilesNumber = useRef(0);
  const pathname = window.location.pathname?.split('/');
  const projectId = pathname?.[2];
  const taskId = pathname?.[4];

  const [activeSelection, setActiveSelection] = useState(false);
  const [selectedPointImageName, setSelectedPointImageName] = useState<
    string[]
  >([]);
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
    (state: any) => state.droneOperatorTask.filesExifData,
  );
  const uploadProgress = useTypedSelector(
    state => state.droneOperatorTask.uploadProgress,
  );
  const modalState = useTypedSelector(state => state.common.showModal);
  const taskAreaPolygon = useTypedSelector(
    state => state.droneOperatorTask.taskAreaPolygon,
  );

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
      <div className="naxatw-flex naxatw-flex-col naxatw-items-start naxatw-gap-2">
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
          <p className="naxatw-text-base naxatw-font-medium naxatw-text-black">
            {popupData?.name}
          </p>
          <p>
            {popupData?.coordinates?.lat?.toFixed(8)},&nbsp;
            {popupData?.coordinates?.lng?.toFixed(8)}{' '}
          </p>
        </div>
        <img src={popupData?.fileBob} alt="Uploaded" />
      </div>
    );
  }, [popupData]);

  const { mutate: updateStatus } = useMutation<any, any, any, unknown>({
    mutationFn: postTaskStatus,
    onError: (err: any) => {
      toast.error(err.message);
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
      const files = filesExifData.map((file: any) => file.file);
      const chunkedFiles = chunkArray(files, 4);

      // this calls api simultaneously for each chunk of files
      // each chunk contains 4 files
      for (let index = 0; index < chunkedUrls.length; index++) {
        const urlChunk = chunkedUrls[index];

        await callApiSimultaneously(urlChunk, chunkedFiles[index]);
        uploadedFilesNumber.current += urlChunk.length;
        const width = widthCalulator(uploadedFilesNumber.current, files.length);
        setLoadingWidth(width);
        // maintain progress state for individual task
        dispatch(
          setUploadProgress({
            ...uploadProgress,
            [taskId]: {
              totalFiles: files.length,
              uploadedFiles: uploadedFilesNumber.current,
            },
          }),
        );
      }
      updateStatus({
        projectId,
        taskId,
        data: { event: 'image_upload', updated_at: new Date().toISOString() },
      });

      // clear progress state on success
      const currentUploadProgress = { ...uploadProgress };
      delete currentUploadProgress?.[taskId];
      dispatch(setUploadProgress(currentUploadProgress));
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
      image_name: filesExifData.map((file: any) => file.file.name),
      project_id: projectId,
    };
    mutate(filesData);
  }

  const pointsInsideTaskArea = useMemo(() => {
    let numberOfPointsInsideTaskArea = 0;
    filesExifData?.forEach((element: any) => {
      const imagePoint = point([
        element.coordinates.longitude,
        element.coordinates.latitude,
      ]);

      if (booleanPointInPolygon(imagePoint, taskAreaPolygon?.features[0])) {
        numberOfPointsInsideTaskArea++;
      }
    });
    return numberOfPointsInsideTaskArea;
  }, [filesExifData, taskAreaPolygon]);

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
              interactions={activeSelection ? ['feature'] : []}
              layerOptions={{
                type: 'circle',
                paint: {
                  'circle-color': '#176149',
                  'circle-radius': 6,
                  'circle-stroke-width': 4,
                  // 'circle-stroke-color': 'red',
                  'circle-stroke-color': [
                    'case',
                    [
                      'in',
                      ['get', 'name'],
                      ['literal', selectedPointImageName],
                    ],
                    '#3f704d',
                    '#FF0000 ',
                  ],
                  'circle-stroke-opacity': 1,
                },
              }}
              onFeatureSelect={data => {
                setSelectedPointImageName(prev => [
                  ...new Set([...prev, String(data.name)]),
                ]);
              }}
              zoomToExtent
            />
            <VectorLayer
              map={map as Map}
              isMapLoaded={isMapLoaded}
              id="image-lines"
              geojson={imageFilesLineStringData as GeojsonType}
              visibleOnMap={!!imageFilesLineStringData}
              layerOptions={{
                type: 'line',
                paint: {
                  'line-color': '#000000',
                  'line-width': 2,
                },
              }}
              symbolPlacement="line"
              iconAnchor="center"
            />

            <div className="naxatw-absolute naxatw-left-[calc(50%-9rem)] naxatw-top-2 naxatw-z-30 naxatw-flex naxatw-w-72 naxatw-justify-center naxatw-gap-2">
              <Button
                className="naxatw-bg-gray-500 naxatw-px-3 naxatw-text-[#FFFFFF]"
                onClick={() => {
                  setActiveSelection(prev => !prev);
                }}
                size="sm"
              >
                {activeSelection ? 'Inactive Selection' : 'Active Selection'}
              </Button>
              {selectedPointImageName?.length ? (
                <Button
                  className="naxatw-bg-red naxatw-px-3 naxatw-text-[#FFFFFF]"
                  onClick={() => {
                    const newFilesData = filesExifData.filter(
                      (filex: any) =>
                        !selectedPointImageName.includes(filex.file.name),
                    );
                    dispatch(setFilesExifData(newFilesData));
                  }}
                  size="sm"
                >
                  Delete Selected
                </Button>
              ) : (
                <></>
              )}
            </div>
            {!activeSelection && (
              <AsyncPopup
                map={map as Map}
                showPopup={(feature: Record<string, any>) =>
                  feature?.source === 'image-points-map'
                }
                popupUI={getPopupUI}
                fetchPopupData={(properties: Record<string, any>) => {
                  setPopupData(properties);
                }}
                title="Image Preview"
                buttonText="Delete"
                handleBtnClick={fileData => {
                  const newFilesData = filesExifData.filter(
                    (filex: any) => filex.file.name !== fileData.name,
                  );
                  dispatch(setFilesExifData(newFilesData));
                }}
                closePopupOnButtonClick
              />
            )}

            <VectorLayer
              map={map as Map}
              id="task-polygon-image-selection"
              geojson={taskAreaPolygon as GeojsonType}
              layerOptions={{
                type: 'fill',
                paint: {
                  'fill-color': '#98BBC8',
                  'fill-outline-color': '#484848',
                  'fill-opacity': 0.6,
                },
              }}
            />
          </MapContainer>
          <p className="naxatw-text-lg naxatw-font-medium">
            {filesExifData.length} Images Selected
          </p>
          <p className="naxatw-text-lg naxatw-font-medium naxatw-text-yellow-600">
            {Number(
              100 - ((pointsInsideTaskArea / filesExifData.length) * 100 || 0),
            ).toFixed(0)}
            % of the uploaded images are from outside the project area.
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

export default hasErrorBoundary(ImageMapBox);
