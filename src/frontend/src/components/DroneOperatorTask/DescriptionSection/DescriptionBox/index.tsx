import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  useGetIndividualTaskQuery,
  useGetTaskAssetsInfo,
  useGetTaskWaypointQuery,
} from '@Api/tasks';
import { Button } from '@Components/RadixComponents/Button';
import DescriptionBoxComponent from './DescriptionComponent';
import QuestionBox from '../QuestionBox';
import UploadsInformation from '../UploadsInformation';
import UploadsBox from '../UploadsBox';

const DescriptionBox = () => {
  const [flyable, setFlyable] = useState('yes');
  const { taskId, projectId } = useParams();

  const { data: taskWayPoints }: any = useGetTaskWaypointQuery(
    projectId as string,
    taskId as string,
    {
      select: (data: any) => {
        return data.data.features;
      },
    },
  );
  const { data: taskAssetsInformation }: Record<string, any> =
    useGetTaskAssetsInfo(projectId as string, taskId as string);

  const { data: taskDescription }: Record<string, any> =
    useGetIndividualTaskQuery(taskId as string, {
      enabled: !!taskWayPoints,
      select: (data: any) => {
        const { data: taskData } = data;

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
                value: taskData?.flight_time || null,
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

    // fetch(`${taskAssetsInformation?.assets_url}`, { method: 'GET' })
    //   .then(response => {
    //     if (!response.ok) {
    //       throw new Error(`Network response was ${response.statusText}`);
    //     }
    //     return response.blob();
    //   })
    //   .then(blob => {
    //     const url = window.URL.createObjectURL(blob);
    //     const link = document.createElement('a');
    //     link.href = url;
    //     link.download = 'assets.zip';
    //     document.body.appendChild(link);
    //     link.click();
    //     link.remove();
    //     window.URL.revokeObjectURL(url);
    //   })
    //   .catch(error =>
    //     toast.error(`There wan an error while downloading file
    //       ${error}`),
    //   );

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
              { name: 'Image Status', value: taskAssetsInformation?.state },
            ]}
          />

          {taskAssetsInformation?.assets_url && (
            <div className="">
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
          {taskAssetsInformation?.state === 'IMAGE_PROCESSING_FAILED' && (
            <div className="">
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white disabled:!naxatw-cursor-not-allowed disabled:naxatw-bg-gray-500 disabled:naxatw-text-white"
                leftIcon="replay"
                iconClassname="naxatw-text-[1.125rem]"
                onClick={() => handleDownloadResult()}
              >
                Re-run processing
              </Button>
            </div>
          )}
          {taskAssetsInformation?.state === 'IMAGE_PROCESSING_FAILED' && (
            <div className="">
              <UploadsBox label="Re-upload Raw Image" />
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default DescriptionBox;
