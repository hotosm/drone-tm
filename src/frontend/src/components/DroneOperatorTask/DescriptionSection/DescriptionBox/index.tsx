import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import {
  useGetIndividualTaskQuery,
  useGetTaskAssetsInfo,
  useGetTaskWaypointQuery,
} from '@Api/tasks';
import { formatString } from '@Utils/index';
import { Button } from '@Components/RadixComponents/Button';
import {
  resetFilesExifData,
  setSelectedTaskDetailToViewOrthophoto,
} from '@Store/actions/droneOperatorTask';
import { toggleModal } from '@Store/actions/common';
import { useTypedSelector } from '@Store/hooks';
import DescriptionBoxComponent from './DescriptionComponent';
import QuestionBox from '../QuestionBox';
import UploadsInformation from '../UploadsInformation';
import ProgressBar from './ProgessBar';
import DroneImageProcessingWorkflow from '../DroneImageProcessingWorkflow';

const DescriptionBox = () => {
  const dispatch = useDispatch();
  const [flyable, setFlyable] = useState('yes');
  const [isWorkflowModalOpen, setIsWorkflowModalOpen] = useState(false);
  const { taskId, projectId } = useParams();
  const waypointMode = useTypedSelector(
    state => state.droneOperatorTask.waypointMode,
  );
  const uploadProgress = useTypedSelector(
    state => state.droneOperatorTask.uploadProgress,
  );
  const droneModel = useTypedSelector(
    state => state.droneOperatorTask.droneModel,
  );
  const gimbalAngle = useTypedSelector(
    state => state.droneOperatorTask.gimbalAngle,
  );

  const { data: taskWayPoints }: any = useGetTaskWaypointQuery(
    projectId as string,
    taskId as string,
    waypointMode as string,
    droneModel as string,
    0,
    gimbalAngle as string,
    {
      select: (data: any) => {
        return data.data.results.features;
      },
    },
  );

  const {
    data: taskAssetsInformation,
    // isFetching: taskAssetsInfoLoading,
  }: Record<string, any> = useGetTaskAssetsInfo(
    projectId as string,
    taskId as string,
  );

  useEffect(() => {
    dispatch(resetFilesExifData());
  }, [dispatch]);

  const { data: taskQueryData }: Record<string, any> =
    useGetIndividualTaskQuery(taskId as string, {
      // enabled: !!taskWayPoints,
      select: (data: any) => {
        const { data: taskData } = data;

        const taskDescription = [
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
                value: taskData?.total_area_sqkm
                  ? `${Number(taskData?.total_area_sqkm)?.toFixed(3)} km²`
                  : null,
              },
              {
                name: 'Total waypoints count',
                value: taskWayPoints?.length,
              },
              {
                name: 'Est. flight time*',
                value: taskData?.flight_time_minutes
                  ? `${Number(taskData?.flight_time_minutes)?.toFixed(3)} minutes`
                  : null,
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
          // {
         //   total_image_uploaded: taskData?.total_image_uploaded || 0,
         //   assets_url: taskData?.assets_url,
         //   state: taskData?.state,
         // },
        ];
        return { taskDescription, taskData };
      },
    });

  const taskDescription = taskQueryData?.taskDescription;

  useEffect(() => {
    if (taskQueryData?.taskData) {
      dispatch(
        setSelectedTaskDetailToViewOrthophoto({
          outline: taskQueryData.taskData.outline,
        }),
      );
    }
  }, [dispatch, taskQueryData]);

  // const taskAssetsInformation = useMemo(() => {
  //   if (!taskDescription) return {};
  //   dispatch(setTaskAssetsInformation(taskDescription?.[2]));
  //   return taskDescription?.[2];
  // }, [taskDescription, dispatch]);

  const handleDownloadResult = () => {
    if (!taskAssetsInformation?.assets_url) return;
    try {
      const link = document.createElement('a');
      link.href = taskAssetsInformation?.assets_url;
      link.setAttribute('download', '');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error(`There was an error while downloading file ${error}`);
    }
  };

  const progressDetails = useMemo(
    () => uploadProgress?.[taskId || ''],
    [taskId, uploadProgress],
  );
  const showProcessingStatusAction = useMemo(
    () => (
      taskAssetsInformation?.state === 'IMAGE_UPLOADED' ||
      taskAssetsInformation?.state === 'IMAGE_PROCESSING_STARTED' ||
      taskAssetsInformation?.state === 'IMAGE_PROCESSING_FAILED' ||
      taskAssetsInformation?.state === 'IMAGE_PROCESSING_FINISHED' ||
      (taskAssetsInformation?.state === 'LOCKED_FOR_MAPPING' &&
        taskAssetsInformation?.image_count > 0)
    ),
    [taskAssetsInformation],
  );
  const canUploadMoreImagery = useMemo(
    () => (
      taskAssetsInformation?.state === 'IMAGE_UPLOADED' ||
      taskAssetsInformation?.state === 'IMAGE_PROCESSING_FAILED' ||
      taskAssetsInformation?.state === 'IMAGE_PROCESSING_STARTED' ||
      taskAssetsInformation?.state === 'IMAGE_PROCESSING_FINISHED' ||
      (taskAssetsInformation?.state === 'LOCKED_FOR_MAPPING' &&
        taskAssetsInformation?.image_count > 0)
    ),
    [taskAssetsInformation],
  );

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
        <p className="naxatw-text-[0.75rem] naxatw-text-[#212121]">
          {/* TODO - we might need to change this value if a drone is added which cannot
          achieve this speed */}
          *This flight time was calculated using an average ground speed of 11.5 m/s.
        </p>
      </div>

      {/* Prominent Drone Image Processing Workflow Button */}
      {taskAssetsInformation?.state === 'LOCKED_FOR_MAPPING' && (
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-3 naxatw-rounded-lg naxatw-border-2 naxatw-border-red-200 naxatw-bg-red-50 naxatw-p-6">
          <div className="naxatw-flex naxatw-items-start naxatw-gap-3">
            <span className="material-icons naxatw-text-2xl naxatw-text-red-600">
              cloud_upload
            </span>
            <div className="naxatw-flex-1">
              <p className="naxatw-mb-1 naxatw-text-base naxatw-font-semibold naxatw-text-red-900">
                Ready to upload drone imagery?
              </p>
              <p className="naxatw-mb-3 naxatw-text-sm naxatw-text-red-700">
                Upload your drone images, classify them for quality, review task coverage, and mark tasks ready for processing.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="naxatw-w-full naxatw-bg-red naxatw-py-3 naxatw-text-base naxatw-font-semibold naxatw-text-white hover:naxatw-bg-red-700"
            leftIcon="settings"
            iconClassname="naxatw-text-xl"
            onClick={() => setIsWorkflowModalOpen(true)}
          >
            Upload Imagery
          </Button>
        </div>
      )}

      {/* Drone Image Processing Workflow Modal */}
      <DroneImageProcessingWorkflow
        isOpen={isWorkflowModalOpen}
        onClose={() => setIsWorkflowModalOpen(false)}
        projectId={projectId as string}
      />

      {taskAssetsInformation?.image_count === 0 &&
        (progressDetails?.totalFiles ? (
          <ProgressBar
            heading="Uploading Images"
            successCount={progressDetails?.uploadedFiles}
            totalCount={progressDetails.totalFiles}
          />
        ) : (
          <QuestionBox
            setFlyable={setFlyable}
            flyable={flyable}
            haveNoImages={taskAssetsInformation?.image_count === 0}
          />
        ))}

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
                value:
                  // if the state is LOCKED_FOR_MAPPING and has a image count it means the images are not fully uploaded
                  taskAssetsInformation?.state === 'LOCKED_FOR_MAPPING' &&
                  taskAssetsInformation?.image_count > 0
                    ? 'Image Uploading Failed'
                    : formatString(taskAssetsInformation?.state),
              },
            ]}
          />

          {taskAssetsInformation?.assets_url && (
            <div className="naxatw-flex naxatw-flex-wrap naxatw-gap-1">
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white disabled:!naxatw-cursor-not-allowed disabled:naxatw-bg-gray-500 disabled:naxatw-text-white"
                leftIcon="download"
                iconClassname="naxatw-text-[1.125rem]"
                onClick={() => handleDownloadResult()}
              >
                Download Result
              </Button>
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white"
                leftIcon="upload"
                iconClassname="naxatw-text-[1.125rem]"
                onClick={() => setIsWorkflowModalOpen(true)}
              >
                Upload Imagery
              </Button>
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white"
                leftIcon="monitoring"
                iconClassname="naxatw-text-[1.125rem]"
                onClick={() => dispatch(toggleModal('processing-status'))}
              >
                Processing Status
              </Button>
            </div>
          )}

          {progressDetails?.totalFiles ? (
            <ProgressBar
              heading="Uploading Images"
              successCount={progressDetails?.uploadedFiles}
              totalCount={progressDetails.totalFiles}
            />
          ) : (
            <>
              {/* Info banner for returning users */}
              {showProcessingStatusAction && (
                <div className="naxatw-rounded-md naxatw-border naxatw-border-blue-200 naxatw-bg-blue-50 naxatw-px-3 naxatw-py-2">
                  <p className="naxatw-text-sm naxatw-text-blue-800">
                    {taskAssetsInformation?.image_count} images linked to this task. Use Processing Status to start or monitor per-task processing.
                  </p>
                </div>
              )}

              {/* Upload imagery and processing status actions */}
              {(canUploadMoreImagery || showProcessingStatusAction) && (
                <div className="naxatw-flex naxatw-flex-wrap naxatw-gap-2">
                  {canUploadMoreImagery && (
                    <Button
                      variant="ghost"
                      className="naxatw-bg-red naxatw-text-white"
                      leftIcon="upload"
                      iconClassname="naxatw-text-[1.125rem]"
                      onClick={() => setIsWorkflowModalOpen(true)}
                    >
                      Upload More Imagery
                    </Button>
                  )}
                  {showProcessingStatusAction && (
                    <Button
                      variant="ghost"
                      className="naxatw-bg-red naxatw-text-white"
                      leftIcon="monitoring"
                      iconClassname="naxatw-text-[1.125rem]"
                      onClick={() => dispatch(toggleModal('processing-status'))}
                    >
                      Processing Status
                    </Button>
                  )}
                </div>
              )}

              {canUploadMoreImagery && (
                <div className="naxatw-flex naxatw-flex-col naxatw-gap-3 naxatw-rounded-lg naxatw-border naxatw-border-blue-200 naxatw-bg-blue-50 naxatw-p-4">
                  <div className="naxatw-flex naxatw-items-start naxatw-gap-2">
                    <span className="material-icons naxatw-text-blue-600">
                      info
                    </span>
                    <div>
                      <p className="naxatw-font-medium naxatw-text-blue-800">
                        Need to upload more images?
                      </p>
                      <p className="naxatw-text-sm naxatw-text-blue-600">
                        You can reopen Upload Imagery any time. Additional uploads are reviewed against the task area and duplicates are filtered out.
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    className="naxatw-w-fit naxatw-bg-blue-600 naxatw-text-white hover:naxatw-bg-blue-700"
                    leftIcon="upload"
                    iconClassname="naxatw-text-[1.125rem]"
                    onClick={() => setIsWorkflowModalOpen(true)}
                  >
                    Upload Imagery
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
};

export default DescriptionBox;
