import { useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { useGetTaskAssetsInfo, useGetTaskWaypointQuery } from "@Api/tasks";
import { postTaskStatus } from "@Services/project";
import { buildDownloadUrl } from "@Utils/index";
import getTaskStateLabel from "@Utils/taskStateLabel";
import { Button } from "@Components/RadixComponents/Button";
import {
  resetFilesExifData,
  setSelectedTaskDetailToViewOrthophoto,
} from "@Store/actions/droneOperatorTask";
import { useTypedSelector } from "@Store/hooks";
import useTaskParams from "@Hooks/useTaskParams";
import { m } from "@/paraglide/messages";
import DescriptionBoxComponent from "./DescriptionComponent";
import QuestionBox from "../QuestionBox";
import UploadsInformation from "../UploadsInformation";
import ProgressBar from "./ProgressBar";
import ManualOverrideSection from "./ManualOverrideSection";

const DescriptionBox = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const [flyable, setFlyable] = useState("yes");
  const { taskId, projectId, projectSlug, taskData } = useTaskParams();
  const waypointMode = useTypedSelector((state) => state.droneOperatorTask.waypointMode);
  const uploadProgress = useTypedSelector((state) => state.droneOperatorTask.uploadProgress);
  const droneModel = useTypedSelector((state) => state.droneOperatorTask.droneModel);
  const gimbalAngle = useTypedSelector((state) => state.droneOperatorTask.gimbalAngle);

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

  const { data: taskAssetsInformation }: Record<string, any> = useGetTaskAssetsInfo(
    projectId as string,
    taskId as string,
  );

  useEffect(() => {
    dispatch(resetFilesExifData());
  }, [dispatch]);

  const taskQueryData = useMemo(() => {
    const resolvedTaskData = taskData as any;

    const state = taskAssetsInformation?.state;
    const hasImageryUploaded = (taskAssetsInformation?.image_count ?? 0) > 0;
    const statusValue = state
      ? state === "LOCKED" && hasImageryUploaded
        ? m.drone_task_image_uploading_failed()
        : getTaskStateLabel(state)
      : null;

    const taskDescription = [
      {
        id: 1,
        title: m.drone_task_description_heading(),
        data: [
          {
            name: m.drone_task_status_label(),
            value: statusValue,
          },
          {
            name: m.drone_task_id_label(),
            value: resolvedTaskData?.id || taskId || null,
          },
          {
            name: m.drone_task_created_date_label(),
            value: resolvedTaskData?.created_at
              ? resolvedTaskData?.created_at?.slice(0, 10) || "-"
              : null,
          },
          {
            name: m.drone_task_locked_date_label(),
            value: resolvedTaskData?.updated_at
              ? resolvedTaskData?.updated_at?.slice(0, 10) || "-"
              : null,
          },
          {
            name: m.drone_task_total_area_label(),
            value: resolvedTaskData?.total_area_sqkm
              ? m.drone_task_area_sqkm({
                  area: Number(resolvedTaskData?.total_area_sqkm)?.toFixed(3),
                })
              : null,
          },
          {
            name: m.drone_task_total_waypoints_count_label(),
            value: taskWayPoints?.length,
          },
          {
            name: m.drone_task_est_flight_time_label(),
            value: resolvedTaskData?.flight_time_minutes
              ? m.drone_task_minutes_value({
                  minutes: Number(resolvedTaskData?.flight_time_minutes)?.toFixed(3),
                })
              : null,
          },
        ],
      },
      {
        id: 2,
        title: m.drone_task_flight_parameters_heading(),
        data: [
          {
            name: m.drone_task_altitude_label(),
            value: resolvedTaskData?.altitude || null,
          },
          {
            name: m.drone_task_gimbal_angle_label(),
            value: resolvedTaskData?.gimble_angles_degrees
              ? m.drone_task_degrees_value({
                  degrees: resolvedTaskData?.gimble_angles_degrees,
                })
              : null,
          },
          {
            name: m.drone_task_front_overlap_label(),
            value: resolvedTaskData?.front_overlap
              ? m.drone_task_percent_value({
                  value: resolvedTaskData?.front_overlap,
                })
              : null,
          },
          {
            name: m.drone_task_side_overlap_label(),
            value: resolvedTaskData?.side_overlap
              ? m.drone_task_percent_value({
                  value: resolvedTaskData?.side_overlap,
                })
              : null,
          },
          {
            name: m.drone_task_gsd_label(),
            value: resolvedTaskData?.gsd_cm_px
              ? m.drone_task_centimeters_value({
                  value: resolvedTaskData?.gsd_cm_px,
                })
              : null,
          },
          {
            name: m.drone_task_starting_point_altitude_label(),
            value: resolvedTaskData?.starting_point_altitude
              ? `${resolvedTaskData?.starting_point_altitude}`
              : null,
          },
        ],
      },
    ];

    return { taskDescription, taskData: resolvedTaskData };
  }, [
    taskData,
    taskId,
    taskWayPoints,
    taskAssetsInformation?.state,
    taskAssetsInformation?.image_count,
  ]);

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
      const link = document.createElement("a");
      link.href = buildDownloadUrl(taskAssetsInformation.assets_url);
      link.setAttribute("download", "");
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error(m.drone_task_download_error({ error: `${error}` }));
    }
  };

  const progressDetails = useMemo(() => uploadProgress?.[taskId || ""], [taskId, uploadProgress]);

  const hasImages = taskAssetsInformation?.image_count > 0;
  const isLocked = taskAssetsInformation?.state === "LOCKED";
  const isHasImagery = taskAssetsInformation?.state === "HAS_IMAGERY";
  const isFullyFlown = taskAssetsInformation?.state === "FULLY_FLOWN";
  const hasAssets = !!taskAssetsInformation?.assets_url;

  const { mutate: markFlown, isPending: isMarkingFlown } = useMutation<any, any, any, unknown>({
    mutationFn: postTaskStatus,
    onSuccess: () => {
      toast.success(m.drone_task_marked_fully_flown_success());
      queryClient.invalidateQueries({ queryKey: ["task-assets-info"] });
    },
    onError: (err: any) => {
      toast.error(
        err?.response?.data?.detail || err?.message || m.drone_task_mark_fully_flown_error(),
      );
    },
  });

  const { mutate: unmarkFlown, isPending: isUnmarkingFlown } = useMutation<any, any, any, unknown>({
    mutationFn: postTaskStatus,
    onSuccess: () => {
      toast.success(m.drone_task_reverted_to_locked_success());
      queryClient.invalidateQueries({ queryKey: ["task-assets-info"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || err?.message || m.drone_task_revert_task_error());
    },
  });

  const handleMarkFlown = () => {
    markFlown({
      projectId,
      taskId,
      data: { event: "mark_flown", updated_at: new Date().toISOString() },
    });
  };

  const handleUnmarkFlown = () => {
    unmarkFlown({
      projectId,
      taskId,
      data: { event: "unmark_flown", updated_at: new Date().toISOString() },
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
          {m.drone_task_flight_time_note()}
        </p>
      </div>

      {(isLocked || isHasImagery) && (
        <Button
          variant="ghost"
          className="naxatw-mt-5 naxatw-w-full naxatw-bg-red naxatw-py-3 naxatw-text-base naxatw-font-semibold naxatw-text-white hover:naxatw-opacity-90 disabled:naxatw-cursor-not-allowed disabled:naxatw-opacity-60"
          leftIcon="flight_land"
          iconClassname="naxatw-text-[1.375rem]"
          onClick={handleMarkFlown}
          disabled={isMarkingFlown}
        >
          {isMarkingFlown ? m.drone_task_marking() : m.drone_task_mark_as_fully_flown()}
        </Button>
      )}

      {isFullyFlown && (
        <Button
          variant="outline"
          className="naxatw-mt-5 naxatw-w-full naxatw-border-red naxatw-py-3 naxatw-text-base naxatw-font-semibold naxatw-text-red hover:naxatw-bg-red hover:naxatw-text-white disabled:naxatw-cursor-not-allowed disabled:naxatw-opacity-60"
          leftIcon="undo"
          iconClassname="naxatw-text-[1.375rem]"
          onClick={handleUnmarkFlown}
          disabled={isUnmarkingFlown}
        >
          {isUnmarkingFlown ? m.drone_task_reverting() : m.drone_task_not_fully_flown()}
        </Button>
      )}

      {/* Upload progress bar */}
      {taskAssetsInformation?.image_count === 0 &&
        (progressDetails?.totalFiles ? (
          <ProgressBar
            heading={m.drone_task_uploading_images()}
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
                name: m.drone_task_image_count_label(),
                value: taskAssetsInformation?.image_count,
              },
              {
                name: m.drone_task_orthophoto_available_label(),
                value: hasAssets ? m.common_yes() : m.common_no(),
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
                {m.drone_task_download_result()}
              </Button>
            </div>
          )}

          {progressDetails?.totalFiles && (
            <ProgressBar
              heading={m.drone_task_uploading_images()}
              successCount={progressDetails?.uploadedFiles}
              totalCount={progressDetails.totalFiles}
            />
          )}
        </div>
      )}

      <ManualOverrideSection
        projectSlug={projectSlug || ""}
        projectId={projectId || ""}
        taskId={taskId || ""}
        currentState={taskAssetsInformation?.state}
      />
    </>
  );
};

export default DescriptionBox;
