import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import {
  resetFilesExifData,
  setSelectedTaskDetailToViewOrthophoto,
} from '@Store/actions/droneOperatorTask';
import { useTypedSelector } from '@Store/hooks';
import { postTaskStatus } from '@Services/project';
import DescriptionBoxComponent from './DescriptionComponent';
import QuestionBox from '../QuestionBox';
import UploadsInformation from '../UploadsInformation';
import ProgressBar from './ProgessBar';
import DroneImageProcessingWorkflow from '../DroneImageProcessingWorkflow';

const DescriptionBox = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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

  const { mutate: updateStatus, isPending: statusUpdating } = useMutation<
    any,
    any,
    any,
    unknown
  >({
    mutationFn: postTaskStatus,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-description'] });
      queryClient.invalidateQueries({ queryKey: ['task-assets-info'] });
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  useEffect(() => {
    dispatch(resetFilesExifData());
  }, [dispatch]);

  const { mutate: startImageryProcess, isPending: imageProcessingStarting } =
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
                Ready to process drone imagery?
              </p>
              <p className="naxatw-mb-3 naxatw-text-sm naxatw-text-red-700">
                Upload your drone images, classify them for quality, review results, and start processing.
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
            Drone Image Processing Workflow
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
            <div className="naxatw-flex naxatw-gap-1">
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
                Drone Image Processing Workflow
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
              {(taskAssetsInformation?.state === 'IMAGE_UPLOADED' ||
                (taskAssetsInformation?.state === 'LOCKED_FOR_MAPPING' &&
                  taskAssetsInformation?.image_count > 0)) && (
                <div className="naxatw-rounded-md naxatw-border naxatw-border-blue-200 naxatw-bg-blue-50 naxatw-px-3 naxatw-py-2">
                  <p className="naxatw-text-sm naxatw-text-blue-800">
                    {taskAssetsInformation?.image_count} images uploaded. Ready
                    to process.
                  </p>
                </div>
              )}

              {/* Start Processing / Re-run Processing button — prominent position */}
              {(taskAssetsInformation?.state === 'IMAGE_UPLOADED' ||
                (taskAssetsInformation?.state === 'LOCKED_FOR_MAPPING' &&
                  taskAssetsInformation?.image_count > 0)) && (
                <div>
                  <Button
                    variant="ghost"
                    className="naxatw-bg-red naxatw-text-white disabled:!naxatw-cursor-not-allowed disabled:naxatw-bg-gray-500 disabled:naxatw-text-white"
                    leftIcon="play_arrow"
                    iconClassname="naxatw-text-[1.125rem]"
                    onClick={() => startImageryProcess()}
                    disabled={imageProcessingStarting || statusUpdating}
                  >
                    Start Processing
                  </Button>
                  {taskAssetsInformation?.state === 'LOCKED_FOR_MAPPING' &&
                    taskAssetsInformation?.image_count > 0 && (
                      <p className="naxatw-px-1 naxatw-py-1 naxatw-text-xs naxatw-text-yellow-600">
                        Note: Some images may not have been uploaded due to an
                        issue during the upload process. However, you can
                        proceed with processing for the successfully uploaded
                        images.
                      </p>
                    )}
                </div>
              )}
              {taskAssetsInformation?.state === 'IMAGE_PROCESSING_FAILED' && (
                <div>
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

              {/* Collapsible upload section */}
              {(taskAssetsInformation?.state === 'IMAGE_PROCESSING_FAILED' ||
                taskAssetsInformation?.state === 'LOCKED_FOR_MAPPING' ||
                taskAssetsInformation?.state === 'IMAGE_UPLOADED') && (
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
                        Image uploads are now managed from the Project Details
                        page. Use the Drone Image Processing Workflow to upload,
                        classify, and process your drone imagery.
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    className="naxatw-w-fit naxatw-bg-blue-600 naxatw-text-white hover:naxatw-bg-blue-700"
                    leftIcon="arrow_forward"
                    iconClassname="naxatw-text-[1.125rem]"
                    onClick={() => navigate(`/projects/${projectId}`)}
                  >
                    Go to Project Details
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
