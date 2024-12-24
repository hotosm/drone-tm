import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import {
  useGetIndividualTaskQuery,
  useGetTaskAssetsInfo,
  useGetTaskWaypointQuery,
} from '@Api/tasks';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postProcessImagery } from '@Services/tasks';
import { formatString } from '@Utils/index';
import { Button } from '@Components/RadixComponents/Button';
import { Label } from '@Components/common/FormUI';
import SwitchTab from '@Components/common/SwitchTab';
import {
  resetFilesExifData,
  setSelectedTaskDetailToViewOrthophoto,
  setUploadedImagesType,
} from '@Store/actions/droneOperatorTask';
import { useTypedSelector } from '@Store/hooks';
// import { toggleModal } from '@Store/actions/common';
import { postTaskStatus } from '@Services/project';
import Skeleton from '@Components/RadixComponents/Skeleton';
import DescriptionBoxComponent from './DescriptionComponent';
import QuestionBox from '../QuestionBox';
import UploadsInformation from '../UploadsInformation';
import UploadsBox from '../UploadsBox';

const DescriptionBox = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const [flyable, setFlyable] = useState('yes');
  const { taskId, projectId } = useParams();
  const uploadedImageType = useTypedSelector(
    state => state.droneOperatorTask.uploadedImagesType,
  );
  const waypointMode = useTypedSelector(
    state => state.droneOperatorTask.waypointMode,
  );

  const { data: taskWayPoints }: any = useGetTaskWaypointQuery(
    projectId as string,
    taskId as string,
    waypointMode as string,
    {
      select: (data: any) => {
        return data.data.features;
      },
    },
  );
  const {
    data: taskAssetsInformation,
    isFetching: taskAssetsInfoLoading,
  }: Record<string, any> = useGetTaskAssetsInfo(
    projectId as string,
    taskId as string,
  );

  const { mutate: updateStatus, isLoading: statusUpdating } = useMutation<
    any,
    any,
    any,
    unknown
  >({
    mutationFn: postTaskStatus,
    onSuccess: () => {
      queryClient.invalidateQueries(['task-assets-info']);
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  useEffect(() => {
    dispatch(resetFilesExifData());
  }, [dispatch]);

  const { mutate: startImageryProcess, isLoading: imageProcessingStarting } =
    useMutation({
      mutationFn: () =>
        postProcessImagery(projectId as string, taskId as string),
      onSuccess: () => {
        updateStatus({
          projectId,
          taskId,
          data: {
            event: 'image_processing_start',
            updated_at: new Date().toISOString(),
          },
        });
        toast.success('Image processing started');
      },
    });

  const { data: flightTimeData }: any = useGetTaskWaypointQuery(
    projectId as string,
    taskId as string,
    waypointMode as string,
    {
      select: ({ data }: any) => data.flight_data,
    },
  );

  const { data: taskDescription }: Record<string, any> =
    useGetIndividualTaskQuery(taskId as string, {
      enabled: !!taskWayPoints,
      select: (data: any) => {
        const { data: taskData } = data;

        dispatch(
          dispatch(
            setSelectedTaskDetailToViewOrthophoto({
              outline: taskData?.outline,
            }),
          ),
        );

        return [
          {
            id: 1,
            title: 'Task Description',
            data: [
              {
                name: 'Created date',
                value: taskData?.created_at
                  ? taskData?.created_at?.slice(0, 10) || '-'
                  : null,
              },
              {
                name: 'Task locked date',
                value: taskData?.updated_at
                  ? taskData?.updated_at?.slice(0, 10) || '-'
                  : null,
              },
              {
                name: 'Total task area',
                value: taskData?.task_area
                  ? `${Number(taskData?.task_area)?.toFixed(3)} km²`
                  : null,
              },
              { name: 'Total points', value: taskWayPoints?.length },
              {
                name: 'Est. flight time',
                value: flightTimeData?.total_flight_time || null,
              },
              {
                name: 'Est. flight time in seconds',
                value: flightTimeData?.total_flight_time_seconds || null,
              },
            ],
          },
          {
            id: 2,
            title: 'Flight Parameters',
            data: [
              { name: 'Altitude', value: taskData?.altitude || null },
              {
                name: 'Gimble Angle',
                value: taskData?.gimble_angles_degrees
                  ? `${taskData?.gimble_angles_degrees} degree`
                  : null,
              },
              {
                name: 'Front Overlap',
                value: taskData?.front_overlap
                  ? `${taskData?.front_overlap}%`
                  : null,
              },
              {
                name: 'Side Overlap',
                value: taskData?.side_overlap
                  ? `${taskData?.side_overlap}%`
                  : null,
              },
              {
                name: 'GSD',
                value: taskData?.gsd_cm_px ? `${taskData?.gsd_cm_px} cm` : null,
              },
              {
                name: 'Starting Point Altitude',
                value: taskData?.starting_point_altitude
                  ? `${taskData?.starting_point_altitude}`
                  : null,
              },
            ],
          },
        ];
      },
    });

  const handleDownloadResult = () => {
    if (!taskAssetsInformation?.assets_url) return;

    try {
      const link = document.createElement('a');
      link.href = taskAssetsInformation?.assets_url;
      link.download = 'assets.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error(`There wan an error while downloading file ${error}`);
    }
  };

  return (
    <>
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-5">
        {taskDescription?.map((description: Record<string, any>) => (
          <DescriptionBoxComponent
            key={description.id}
            title={description.title}
            data={description?.data}
          />
        ))}
      </div>
      {taskAssetsInformation?.image_count === 0 && (
        <QuestionBox
          setFlyable={setFlyable}
          flyable={flyable}
          haveNoImages={taskAssetsInformation?.image_count === 0}
        />
      )}

      {taskAssetsInformation?.image_count > 0 && (
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-5">
          <UploadsInformation
            data={[
              {
                name: 'Image count',
                value: taskAssetsInformation?.image_count,
              },
              {
                name: 'Orthophoto available',
                value: taskAssetsInformation?.assets_url ? 'Yes' : 'No',
              },
              {
                name: 'Image Status',
                value: formatString(taskAssetsInformation?.state),
              },
            ]}
          />

          {taskAssetsInfoLoading && <Skeleton className="naxatw-h-48" />}

          {taskAssetsInformation?.assets_url && (
            <div className="naxatw-flex naxatw-gap-1">
              {/* <Button
                variant="outline"
                className="naxatw-border-red naxatw-text-red"
                leftIcon="visibility"
                iconClassname="naxatw-text-[1.125rem]"
                onClick={() =>
                  dispatch(toggleModal('task-ortho-photo-preview'))
                }
              >
                View Orthophoto
              </Button> */}
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white disabled:!naxatw-cursor-not-allowed disabled:naxatw-bg-gray-500 disabled:naxatw-text-white"
                leftIcon="download"
                iconClassname="naxatw-text-[1.125rem]"
                onClick={() => handleDownloadResult()}
              >
                Download Result
              </Button>
            </div>
          )}
          {taskAssetsInformation?.state === 'IMAGE_UPLOADED' && (
            <div className="">
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white disabled:!naxatw-cursor-not-allowed disabled:naxatw-bg-gray-500 disabled:naxatw-text-white"
                leftIcon="replay"
                iconClassname="naxatw-text-[1.125rem]"
                onClick={() => startImageryProcess()}
                disabled={imageProcessingStarting || statusUpdating}
              >
                Start Processing
              </Button>
            </div>
          )}
          {taskAssetsInformation?.state === 'IMAGE_PROCESSING_FAILED' && (
            <div className="">
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white disabled:!naxatw-cursor-not-allowed disabled:naxatw-bg-gray-500 disabled:naxatw-text-white"
                leftIcon="replay"
                iconClassname="naxatw-text-[1.125rem]"
                onClick={() => startImageryProcess()}
                disabled={imageProcessingStarting || statusUpdating}
              >
                Re-run processing
              </Button>
            </div>
          )}
          {taskAssetsInformation?.state === 'IMAGE_PROCESSING_FAILED' ||
            (taskAssetsInformation?.state === 'IMAGE_UPLOADED' && (
              <div className="naxatw-flex naxatw-flex-col naxatw-gap-1 naxatw-pb-4">
                <Label>
                  <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
                    Upload Images
                  </p>
                </Label>
                <SwitchTab
                  options={[
                    {
                      name: 'image-upload-for',
                      value: 'add',
                      label: 'Add to existing',
                    },
                    {
                      name: 'image-upload-for',
                      value: 'replace',
                      label: 'Replace existing',
                    },
                  ]}
                  valueKey="value"
                  selectedValue={uploadedImageType}
                  activeClassName="naxatw-bg-red naxatw-text-white"
                  onChange={(selected: Record<string, any>) => {
                    dispatch(setUploadedImagesType(selected.value));
                  }}
                />
                <p className="naxatw-px-1 naxatw-py-1 naxatw-text-xs">
                  Note:{' '}
                  {uploadedImageType === 'add'
                    ? 'Uploaded images will be added with the existing images.'
                    : 'Uploaded images will be replaced with all the existing images and starts processing.'}
                </p>
                <UploadsBox label="" />
              </div>
            ))}
        </div>
      )}
    </>
  );
};

export default DescriptionBox;
