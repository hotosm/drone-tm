/* eslint-disable no-nested-ternary */
import { useEffect, useRef, useState, type Dispatch } from "react";
import { useTypedSelector } from "@Store/hooks";
import { toast } from "react-toastify";
import { Button } from "@Components/RadixComponents/Button";
import Modal from "@Components/common/Modal";
import useWindowDimensions from "@Hooks/useWindowDimensions";
import { sendDjiGoFileViaAdb, sendPotensicProFileViaAdb } from "@Utils/adb";
import hasErrorBoundary from "@Utils/hasErrorBoundary";
import useTaskParams from "@Hooks/useTaskParams";
import { getRuntimeConfig } from "@/runtimeConfig";
import { m } from "@/paraglide/messages";
import MapSection from "../MapSection/MapSection";
import DescriptionBox from "./DescriptionBox";

const API_URL = getRuntimeConfig("VITE_API_URL", "/api");

const DroneOperatorDescriptionBox = () => {
  const { projectId, taskId, projectSlug, taskIndex, taskData: taskDescription } = useTaskParams();
  const [showDownloadOptions, setShowDownloadOptions] = useState<boolean>(false);
  const [showMissingDemModal, setShowMissingDemModal] = useState<boolean>(false);
  const missingDemResolveRef = useRef<Dispatch<boolean> | null>(null);
  const { width } = useWindowDimensions();
  const Token = localStorage.getItem("token");
  const waypointMode = useTypedSelector((state) => state.droneOperatorTask.waypointMode);
  const rotationAngle = useTypedSelector((state) => state.droneOperatorTask.rotationAngle);
  const droneModel = useTypedSelector((state) => state.droneOperatorTask.droneModel);
  const gimbalAngle = useTypedSelector((state) => state.droneOperatorTask.gimbalAngle);

  const rotatedFlightPlanData = useTypedSelector(
    (state) => state.droneOperatorTask.rotatedFlightPlan,
  );

  const buildFlightPlanUrl = (allowMissingDem = false) =>
    `${API_URL}/waypoint/task/${taskId}/?project_id=${projectId}&download=true&mode=${waypointMode}&drone_type=${droneModel}&rotation_angle=${rotationAngle}&gimbal_angle=${gimbalAngle}&allow_missing_dem=${allowMissingDem}`;

  const askMissingDemOverride = async (): Promise<boolean> =>
    new Promise((resolve) => {
      missingDemResolveRef.current = resolve;
      setShowMissingDemModal(true);
    });

  useEffect(
    () => () => {
      missingDemResolveRef.current?.(false);
      missingDemResolveRef.current = null;
    },
    [],
  );

  const fetchFlightPlanFile = async (
    allowMissingDem = false,
  ): Promise<{ filename: string; blob: Blob }> => {
    const response = await fetch(buildFlightPlanUrl(allowMissingDem), {
      method: "POST",
    });

    if (response.status === 409) {
      let payload: any = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (payload?.detail?.code === "MISSING_TERRAIN_DEM") {
        const shouldProceed = await askMissingDemOverride();
        if (!shouldProceed) {
          throw new Error(m.drone_task_missing_dem_canceled());
        }
        return fetchFlightPlanFile(true);
      }
    }

    if (!response.ok) {
      throw new Error(
        m.drone_task_request_failed({
          status: response.status,
          statusText: response.statusText,
        }),
      );
    }

    const disposition = response.headers.get("content-disposition");
    const match = disposition?.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] ?? `${taskIndex}.kmz`;
    const blob = await response.blob();
    return { filename, blob };
  };

  const downloadFlightPlanKmz = () => {
    fetchFlightPlanFile()
      .then(({ filename, blob }) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch((error) => toast.error(`${error}`));
  };

  const sendFlightPlanViaAdb = async () => {
    try {
      const { blob } = await fetchFlightPlanFile();

      // TODO improve this logic to be more generic
      if (droneModel === "POTENSIC_ATOM_1") {
        await sendPotensicProFileViaAdb(blob);
        // TODO add handling to send Potensic JSON to device too
        // if (droneModel === 'POTENSIC_ATOM_2') {
        //   await sendPotensicEveFileViaAdb(blob);
      } else {
        await sendDjiGoFileViaAdb(blob);
      }

      toast.success(m.drone_task_flight_plan_sent());
    } catch (error) {
      toast.error(m.drone_task_send_file_error({ error: `${error}` }));
    }
  };

  const downloadFlightPlanGeojson = () => {
    if (!rotatedFlightPlanData?.geojsonListOfPoints) return;

    const waypointGeojson = rotatedFlightPlanData?.geojsonListOfPoints;
    const fileBlob = new Blob([JSON.stringify(waypointGeojson)], {
      type: "application/json",
    });
    const url = window.URL.createObjectURL(fileBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `flight_plan-${projectSlug}-${taskIndex}-${waypointMode}.geojson`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const downloadTaskAreaKml = () => {
    fetch(
      `${API_URL}/projects/${projectId}/download-boundaries?&task_id=${taskId}&split_area=true&export_type=kml`,
      {
        method: "GET",
        headers: { "Access-token": Token || "" },
        credentials: "include",
      },
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            m.drone_task_network_response_error({
              statusText: response.statusText,
            }),
          );
        }
        return response.blob();
      })
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `task_area-${projectSlug}-${taskIndex}.kml`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch((error) => toast.error(m.drone_task_download_error({ error: `${error}` })));
  };

  const downloadTaskAreaGeojson = () => {
    fetch(
      `${API_URL}/projects/${projectId}/download-boundaries?&task_id=${taskId}&split_area=true&export_type=geojson`,
      {
        method: "GET",
        headers: { "Access-token": Token || "" },
        credentials: "include",
      },
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            m.drone_task_network_response_error({
              statusText: response.statusText,
            }),
          );
        }
        return response.blob();
      })
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `task_area-${projectSlug}-${taskIndex}.geojson`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch((error) => toast.error(m.drone_task_download_error({ error: `${error}` })));
  };

  return (
    <>
      <Modal
        show={showMissingDemModal}
        title={m.drone_task_no_dem_found()}
        className="naxatw-w-[92vw] naxatw-max-w-[32rem]"
        onClose={() => {
          setShowMissingDemModal(false);
          missingDemResolveRef.current?.(false);
          missingDemResolveRef.current = null;
        }}
      >
        <div className="naxatw-space-y-4">
          <p className="naxatw-text-sm naxatw-text-[#7A7676]">
            {m.drone_task_missing_dem_blocked()}
          </p>
          <p className="naxatw-text-sm naxatw-text-[#7A7676]">
            {m.drone_task_missing_dem_override()}
          </p>
          <div className="naxatw-flex naxatw-justify-end naxatw-gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowMissingDemModal(false);
                missingDemResolveRef.current?.(false);
                missingDemResolveRef.current = null;
              }}
            >
              {m.common_cancel()}
            </Button>
            <Button
              className="naxatw-bg-red"
              onClick={() => {
                setShowMissingDemModal(false);
                missingDemResolveRef.current?.(true);
                missingDemResolveRef.current = null;
              }}
            >
              {m.drone_task_generate_anyway()}
            </Button>
          </div>
        </div>
      </Modal>

      <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-items-start naxatw-gap-3 lg:naxatw-gap-5">
        <div className="naxatw-flex naxatw-w-full naxatw-items-center naxatw-justify-between naxatw-self-stretch">
          <p className="naxatw-text-[0.875rem] naxatw-font-normal naxatw-leading-normal naxatw-text-[#484848]">
            {m.common_task_number({
              index: (taskDescription as any)?.project_task_index,
            })}
          </p>

          <div className="naxatw-relative">
            <Button
              variant="ghost"
              className="naxatw-border naxatw-border-[#D73F3F] naxatw-text-[0.875rem] naxatw-text-[#D73F3F]"
              leftIcon="download"
              iconClassname="naxatw-text-[1.125rem]"
              onClick={() => setShowDownloadOptions((prev) => !prev)}
            >
              {m.drone_task_download()}
            </Button>
            {showDownloadOptions && (
              <div className="naxatw-absolute naxatw-right-0 naxatw-top-10 naxatw-z-20 naxatw-w-[200px] naxatw-rounded-sm naxatw-border naxatw-bg-white naxatw-shadow-2xl">
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
                  {"💾 "}
                  {m.drone_task_download_flightplan_controller()}
                </div>
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
                  {"📨 "}
                  {m.drone_task_send_flightplan_controller()}
                </div>
                <hr />
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
                  {"🔎 "}
                  {m.drone_task_inspect_flightplan_geojson()}
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
                  {"📍 "}
                  {m.drone_task_area_kml()}
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
                  {"📍 "}
                  {m.drone_task_area_geojson()}
                </div>
              </div>
            )}
          </div>
        </div>
        {width < 640 && <MapSection />}
        <div className="scrollbar naxatw-flex naxatw-max-h-[calc(100vh-15rem)] naxatw-w-full naxatw-flex-col naxatw-gap-3 naxatw-overflow-y-auto naxatw-pr-3">
          <DescriptionBox />
        </div>
      </div>
    </>
  );
};

export default hasErrorBoundary(DroneOperatorDescriptionBox);
