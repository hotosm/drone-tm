/* eslint-disable no-nested-ternary */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTypedSelector } from '@Store/hooks';
import { toast } from 'react-toastify';
import { useGetIndividualTaskQuery } from '@Api/tasks';
import { Button } from '@Components/RadixComponents/Button';
import useWindowDimensions from '@Hooks/useWindowDimensions';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import MapSection from '../MapSection/MapSection';
import DescriptionBox from './DescriptionBox';
import { sendDjiGoFileViaAdb, sendPotensicProFileViaAdb } from '@Utils/adb';

const { BASE_URL } = process.env;

const DroneOperatorDescriptionBox = () => {
  const { taskId, projectId } = useParams();
  const [showDownloadOptions, setShowDownloadOptions] =
    useState<boolean>(false);
  const { width } = useWindowDimensions();
  const Token = localStorage.getItem('token');
  const waypointMode = useTypedSelector(
    state => state.droneOperatorTask.waypointMode,
  );
  const rotationAngle = useTypedSelector(
    state => state.droneOperatorTask.rotationAngle,
  );
  const droneModel = useTypedSelector(
    state => state.droneOperatorTask.droneModel,
  );

  const { data: taskDescription }: Record<string, any> =
    useGetIndividualTaskQuery(taskId as string);
  const rotatedFlightPlanData = useTypedSelector(
    state => state.droneOperatorTask.rotatedFlightPlan,
  );

  const downloadFlightPlanKmz = () => {
    fetch(
      `${BASE_URL}/waypoint/task/${taskId}/?project_id=${projectId}&download=true&mode=${waypointMode}&drone_type=${droneModel}&rotation_angle=${rotationAngle}`,
      { method: 'POST' },
    )
      .then(response => {
        if (!response.ok) {
          throw new Error(`Network response was ${response.statusText}`);
        }
        const filename = response.headers.get('content-disposition')
          ?.split('filename=')[1]
          ?.trim()
          .replace(/^"|"$/g, '')!;
        return response.blob().then(blob => ({ filename, blob }));
      })
      .then(({ filename, blob }) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch(error =>
        toast.error(`There was an error while downloading file
        ${error}`),
      );
  };

  const sendFlightPlanViaAdb = async () => {
    try {
      const response = await fetch(
        `${BASE_URL}/waypoint/task/${taskId}/?project_id=${projectId}&download=true&mode=${waypointMode}&drone_type=${droneModel}&rotation_angle=${rotationAngle}`,
        { method: 'POST' },
      );

      if (!response.ok) {
        throw new Error(`Network response was ${response.statusText}`);
      }

      const blob = await response.blob();

      // TODO improve this logic to be more generic
      if (droneModel === 'POTENSIC_ATOM_2') {
        await sendPotensicProFileViaAdb(blob);
      } else {
        await sendDjiGoFileViaAdb(blob);
      }

      toast.success(`Flight plan sent to device!`);
    } catch (error) {
      console.error(error);
      toast.error(`There was an error while sending file: ${error}`);
    }
  };

  const downloadFlightPlanGeojson = () => {
    if (!rotatedFlightPlanData?.geojsonListOfPoint) return;

    const waypointGeojson = rotatedFlightPlanData?.geojsonListOfPoint;
    const fileBlob = new Blob([JSON.stringify(waypointGeojson)], {
      type: 'application/json',
    });
    const url = window.URL.createObjectURL(fileBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `flight_plan-${projectId}-${taskId}-${waypointMode}.geojson`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const downloadTaskAreaKml = () => {
    fetch(
      `${BASE_URL}/projects/${projectId}/download-boundaries?&task_id=${taskId}&split_area=true&export_type=kml`,
      { method: 'GET', headers: { 'Access-token': Token || '' } },
    )
      .then(response => {
        if (!response.ok) {
          throw new Error(`Network response was ${response.statusText}`);
        }
        return response.blob();
      })
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `task_area-${projectId}-${taskId}.kml`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch(error =>
        toast.error(`There was an error while downloading file
        ${error}`),
      );
  };

  const downloadTaskAreaGeojson = () => {
    fetch(
      `${BASE_URL}/projects/${projectId}/download-boundaries?&task_id=${taskId}&split_area=true&export_type=geojson`,
      { method: 'GET', headers: { 'Access-token': Token || '' } },
    )
      .then(response => {
        if (!response.ok) {
          throw new Error(`Network response was ${response.statusText}`);
        }
        return response.blob();
      })
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `task_area-${projectId}-${taskId}.geojson`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch(error =>
        toast.error(`There was an error while downloading file
        ${error}`),
      );
  };

  return (
    <>
      <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-items-start naxatw-gap-3 lg:naxatw-gap-5">
        <div className="naxatw-flex naxatw-w-full naxatw-items-center naxatw-justify-between naxatw-self-stretch">
          <p className="naxatw-text-[0.875rem] naxatw-font-normal naxatw-leading-normal naxatw-text-[#484848]">
            Task #{taskDescription?.project_task_index}
          </p>

          <div className="naxatw-relative">
            <Button
              variant="ghost"
              className="naxatw-border naxatw-border-[#D73F3F] naxatw-text-[0.875rem] naxatw-text-[#D73F3F]"
              leftIcon="download"
              iconClassname="naxatw-text-[1.125rem]"
              onClick={() => setShowDownloadOptions(prev => !prev)}
            >
              Download
            </Button>
            {showDownloadOptions && (
              <div className="naxatw-absolute naxatw-right-0 naxatw-top-10 naxatw-z-20 naxatw-w-[200px] naxatw-rounded-sm naxatw-border naxatw-bg-white naxatw-shadow-2xl">
                <div
                  className="naxatw-cursor-pointer naxatw-px-3 naxatw-py-2 hover:naxatw-bg-redlight"
                  role="button"
                  tabIndex={0}
                  onKeyDown={() => sendFlightPlanViaAdb()}
                  onClick={() => {
                    sendFlightPlanViaAdb();
                    setShowDownloadOptions(false);
                  }}
                >
                  Send flight plan file to controller
                </div>
                <div
                  className="naxatw-cursor-pointer naxatw-px-3 naxatw-py-2 hover:naxatw-bg-redlight"
                  role="button"
                  tabIndex={0}
                  onKeyDown={() => downloadFlightPlanKmz()}
                  onClick={() => {
                    downloadFlightPlanKmz();
                    setShowDownloadOptions(false);
                  }}
                >
                  Download flight plan file for drone
                </div>
                <div
                  className="naxatw-cursor-pointer naxatw-px-3 naxatw-py-2 hover:naxatw-bg-redlight"
                  role="button"
                  tabIndex={0}
                  onKeyDown={() => downloadFlightPlanGeojson()}
                  onClick={() => {
                    downloadFlightPlanGeojson();
                    setShowDownloadOptions(false);
                  }}
                >
                  Download flight plan geojson for inspection
                </div>
                <div
                  className="naxatw-cursor-pointer naxatw-px-3 naxatw-py-2 hover:naxatw-bg-redlight"
                  role="button"
                  tabIndex={0}
                  onKeyDown={() => downloadTaskAreaKml()}
                  onClick={() => {
                    downloadTaskAreaKml();
                    setShowDownloadOptions(false);
                  }}
                >
                  Download task area as kml
                </div>
                <div
                  className="naxatw-cursor-pointer naxatw-px-3 naxatw-py-2 hover:naxatw-bg-redlight"
                  role="button"
                  tabIndex={0}
                  onKeyDown={() => downloadTaskAreaGeojson()}
                  onClick={() => {
                    downloadTaskAreaGeojson();
                    setShowDownloadOptions(false);
                  }}
                >
                  Download task area as geojson
                </div>
              </div>
            )}
          </div>
        </div>
        {width < 640 && <MapSection />}
        <div className="scrollbar naxatw-flex naxatw-max-h-[calc(100vh-15rem)] naxatw-w-full naxatw-flex-col naxatw-gap-3 naxatw-overflow-y-auto">
          <DescriptionBox />
        </div>
      </div>
    </>
  );
};

export default hasErrorBoundary(DroneOperatorDescriptionBox);
