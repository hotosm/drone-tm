import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import {
  useGetIndividualTaskQuery,
  useGetTaskAssetsInfo,
  useGetTaskWaypointQuery,
} from '@Api/tasks';
import { postTaskStatus } from '@Services/project';
import { formatString } from '@Utils/index';
import { Button } from '@Components/RadixComponents/Button';
import {
  resetFilesExifData,
  setSelectedTaskDetailToViewOrthophoto,
} from '@Store/actions/droneOperatorTask';
import { useTypedSelector } from '@Store/hooks';
import DescriptionBoxComponent from './DescriptionComponent';
import QuestionBox from '../QuestionBox';
import UploadsInformation from '../UploadsInformation';
import ProgressBar from './ProgessBar';

const DescriptionBox = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [flyable, setFlyable] = useState('yes');
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
  }: Record<string, any> = useGetTaskAssetsInfo(
    projectId as string,
    taskId as string,
  );

  useEffect(() => {
    dispatch(resetFilesExifData());
  }, [dispatch]);

  const { data: taskQueryData }: Record<string, any> =
    useGetIndividualTaskQuery(taskId as string, {
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

  const hasImages = taskAssetsInformation?.image_count > 0;
  const isLocked = taskAssetsInformation?.state === 'LOCKED';
  const isFullyFlown = taskAssetsInformation?.state === 'FULLY_FLOWN';
  const hasAssets = !!taskAssetsInformation?.assets_url;

  const { mutate: markFlown, isPending: isMarkingFlown } = useMutation<
    any,
    any,
    any,
    unknown
  >({
    mutationFn: postTaskStatus,
    onSuccess: () => {
      toast.success('Task marked as fully flown');
      queryClient.invalidateQueries({ queryKey: ['task-assets-info'] });
    },
    onError: (err: any) => {
      toast.error(
        err?.response?.data?.detail || err?.message || 'Failed to mark task as fully flown',
      );
    },
  });

  const { mutate: unmarkFlown, isPending: isUnmarkingFlown } = useMutation<
    any,
    any,
    any,
    unknown
  >({
    mutationFn: postTaskStatus,
    onSuccess: () => {
      toast.success('Task reverted to locked');
      queryClient.invalidateQueries({ queryKey: ['task-assets-info'] });
    },
    onError: (err: any) => {
      toast.error(
        err?.response?.data?.detail || err?.message || 'Failed to revert task',
      );
    },
  });

  const handleMarkFlown = () => {
    markFlown({
      projectId,
      taskId,
      data: { event: 'mark_flown', updated_at: new Date().toISOString() },
    });
  };

  const handleUnmarkFlown = () => {
    unmarkFlown({
      projectId,
      taskId,
      data: { event: 'unmark_flown', updated_at: new Date().toISOString() },
    });
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
        <p className="naxatw-text-[0.75rem] naxatw-text-[#212121]">
          *This flight time was calculated using an average ground speed of 11.5 m/s.
        </p>
      </div>

      {isLocked && (
        <Button
          variant="ghost"
          className="naxatw-mr-3 naxatw-mt-5 naxatw-w-[calc(100%-0.75rem)] naxatw-bg-red naxatw-py-3 naxatw-text-base naxatw-font-semibold naxatw-text-white hover:naxatw-opacity-90 disabled:naxatw-cursor-not-allowed disabled:naxatw-opacity-60"
          leftIcon="flight_land"
          iconClassname="naxatw-text-[1.375rem]"
          onClick={handleMarkFlown}
          disabled={isMarkingFlown}
        >
          {isMarkingFlown ? 'Marking...' : 'Mark as Fully Flown'}
        </Button>
      )}

      {isFullyFlown && (
        <Button
          variant="outline"
          className="naxatw-mr-3 naxatw-mt-5 naxatw-w-[calc(100%-0.75rem)] naxatw-border-red naxatw-py-3 naxatw-text-base naxatw-font-semibold naxatw-text-red hover:naxatw-bg-red hover:naxatw-text-white disabled:naxatw-cursor-not-allowed disabled:naxatw-opacity-60"
          leftIcon="undo"
          iconClassname="naxatw-text-[1.375rem]"
          onClick={handleUnmarkFlown}
          disabled={isUnmarkingFlown}
        >
          {isUnmarkingFlown ? 'Reverting...' : 'Not Fully Flown'}
        </Button>
      )}

      {(isLocked || isFullyFlown || hasImages) && (
        <div className="naxatw-mt-4 naxatw-rounded-lg naxatw-border naxatw-border-amber-200 naxatw-bg-amber-50 naxatw-p-4">
          <div className="naxatw-flex naxatw-items-start naxatw-gap-3">
            <span className="material-icons naxatw-text-[1.25rem] naxatw-text-amber-600">
              info
            </span>
            <div className="naxatw-flex-1">
              <p className="naxatw-text-sm naxatw-font-semibold naxatw-text-amber-900">
                Imagery processing moved to the project page
              </p>
              <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-amber-800">
                Upload imagery, verify coverage, and start processing from the
                main project page instead of the individual task page.
              </p>
              <Button
                variant="outline"
                className="naxatw-mt-3 naxatw-border-amber-300 naxatw-bg-white naxatw-text-amber-900"
                rightIcon="open_in_new"
                onClick={() => navigate(`/projects/${projectId}`)}
              >
                Open Project Page
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Upload progress bar */}
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

      {/* Uploads info and download section */}
      {hasImages && (
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-5">
          <UploadsInformation
            data={[
              {
                name: 'Image count',
                value: taskAssetsInformation?.image_count,
              },
              {
                name: 'Orthophoto available',
                value: hasAssets ? 'Yes' : 'No',
              },
              {
                name: 'Image Status',
                value:
                  isLocked && hasImages
                    ? 'Image Uploading Failed'
                    : formatString(taskAssetsInformation?.state),
              },
            ]}
          />

          {hasAssets && (
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
            </div>
          )}

          {progressDetails?.totalFiles && (
            <ProgressBar
              heading="Uploading Images"
              successCount={progressDetails?.uploadedFiles}
              totalCount={progressDetails.totalFiles}
            />
          )}
        </div>
      )}
    </>
  );
};

export default DescriptionBox;
