/* eslint-disable no-nested-ternary */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LngLatBoundsLike, Map } from "maplibre-gl";
import { FeatureCollection } from "geojson";
import { toast } from "react-toastify";
import { useGetTaskStatesQuery, useGetUserDetailsQuery } from "@Api/projects";
import lock from "@Assets/images/lock.png";
import areaIcon from "@Assets/images/area-icon.png";
import BaseLayerSwitcherUI from "@Components/common/BaseLayerSwitcher";
import { useMapLibreGLMap } from "@Components/common/MapLibreComponents";
import AsyncPopup from "@Components/common/MapLibreComponents/AsyncPopup";
import VectorLayer from "@Components/common/MapLibreComponents/Layers/VectorLayer";
import LocateUser from "@Components/common/MapLibreComponents/LocateUser";
import MapContainer from "@Components/common/MapLibreComponents/MapContainer";
import { GeojsonType } from "@Components/common/MapLibreComponents/types";
import { postTaskStatus } from "@Services/project";
import { setProjectState } from "@Store/actions/project";
import { useTypedDispatch, useTypedSelector } from "@Store/hooks";
import { useMutation } from "@tanstack/react-query";
import getBbox from "@turf/bbox";
import hasErrorBoundary from "@Utils/hasErrorBoundary";
import { commentMentionsUserId, renderCommentMentions } from "@Utils/mentions";
import COGOrthophotoViewer from "@Components/common/MapLibreComponents/COGOrthophotoViewer";
import { getLayerOptionsByStatus } from "@Constants/projectDescription";
import { Button } from "@Components/RadixComponents/Button";
import ToolTip from "@Components/RadixComponents/ToolTip";
import Legend from "./Legend";
import ProjectPromptDialog from "../ModalContent";
import UnlockTaskPromptDialog from "../ModalContent/UnlockTaskPromptDialog";
import LockTaskDialog from "../ModalContent/LockTaskDialog";
import Icon from "@Components/common/Icon";
import { m } from "@/paraglide/messages";

const MapSection = ({ projectData }: { projectData: Record<string, any> }) => {
  const { id: urlId } = useParams();
  const navigate = useNavigate();
  const dispatch = useTypedDispatch();
  // Use UUID from project data for API calls, URL param (slug) for navigation
  const projectUuid = projectData?.id || urlId;
  const [taskStatusObj, setTaskStatusObj] = useState<Record<string, any> | null>(null);
  const [lockedUser, setLockedUser] = useState<Record<string, any> | null>(null);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [showLockDialog, setShowLockDialog] = useState(false);
  const pendingLockCommentRef = useRef<string>("");
  const [showTaskArea, setShowTaskArea] = useState(true);
  const [selectedTaskIndex, setSelectedTaskIndex] = useState<number | null>(null);

  const { data: userDetails }: Record<string, any> = useGetUserDetailsQuery();

  const { map, isMapLoaded } = useMapLibreGLMap({
    mapOptions: {
      zoom: 5,
      center: [84.124, 28.3949],
      maxZoom: 19,
    },
    disableRotation: true,
  });

  const selectedTaskId = useTypedSelector((state) => state.project.selectedTaskId);
  const tasksData = useTypedSelector((state) => state.project.tasksData);
  const projectArea = useTypedSelector((state) => state.project.projectArea);
  const taskClickedOnTable = useTypedSelector((state) => state.project.taskClickedOnTable);
  const visibleTaskOrthophoto = useTypedSelector((state) => state.project.visibleOrthophotoList);

  const { data: taskStates } = useGetTaskStatesQuery(projectUuid as string, {
    enabled: !!tasksData && !!projectUuid,
  });
  const signedInAs = localStorage.getItem("signedInAs");

  const { mutate: lockTask } = useMutation<any, any, any, unknown>({
    mutationFn: postTaskStatus,
    onSuccess: (res: any) => {
      const taskId = res.data.task_id;
      const newState =
        projectData?.requires_approval_from_manager_for_locking &&
        userDetails?.id !== projectData?.author_id
          ? "AWAITING_APPROVAL"
          : "LOCKED";
      setTaskStatusObj({
        ...taskStatusObj,
        [taskId]: newState,
      });
      // Update tasksData in Redux so map feature properties reflect the new lock info immediately
      if (tasksData) {
        const commentText = pendingLockCommentRef.current;
        dispatch(
          setProjectState({
            tasksData: tasksData.map((task: Record<string, any>) =>
              task.id === taskId
                ? {
                    ...task,
                    user_id: userDetails?.id,
                    name: userDetails?.name,
                    comment: commentText || undefined,
                    outline: {
                      ...task.outline,
                      properties: {
                        ...task.outline.properties,
                        locked_user_id: userDetails?.id,
                        locked_user_name: userDetails?.name,
                        lock_comment: commentText || undefined,
                      },
                    },
                  }
                : task,
            ),
          }),
        );
      }
      pendingLockCommentRef.current = "";
      // Close the popup so it reopens with fresh data on next click
      document.getElementById("close-popup")?.click();
      if (newState === "AWAITING_APPROVAL") {
        toast.success(m.map_lock_approval_requested());
      } else {
        toast.success(m.map_task_locked_for_flight());
        setLockedUser({ name: userDetails?.name, id: userDetails?.id });
      }
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || err?.message || "");
    },
  });

  const { mutate: unLockTask } = useMutation<any, any, any, unknown>({
    mutationFn: postTaskStatus,
    onSuccess: (res: any) => {
      const taskId = res.data.task_id;
      setTaskStatusObj({
        ...taskStatusObj,
        [taskId]: "UNLOCKED",
      });
      // Clear lock info from tasksData in Redux
      if (tasksData) {
        dispatch(
          setProjectState({
            tasksData: tasksData.map((task: Record<string, any>) =>
              task.id === taskId
                ? {
                    ...task,
                    user_id: undefined,
                    name: undefined,
                    comment: undefined,
                    outline: {
                      ...task.outline,
                      properties: {
                        ...task.outline.properties,
                        locked_user_id: undefined,
                        locked_user_name: undefined,
                        lock_comment: undefined,
                      },
                    },
                  }
                : task,
            ),
          }),
        );
      }
      // Close the popup so it reopens with fresh data on next click
      document.getElementById("close-popup")?.click();
      toast.success(m.map_task_unlocked_success());
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || err?.message || "");
    },
  });

  useEffect(() => {
    if (!map || !taskStates) return;
    // @ts-ignore
    const taskStatus: Record<string, any> = taskStates?.reduce(
      (acc: Record<string, any>, task: Record<string, any>) => {
        acc[task.task_id] = task.state;
        return acc;
      },
      {},
    );
    setTaskStatusObj(taskStatus);
  }, [map, taskStates]);

  // Compute set of task IDs where the current user is @mentioned in the lock comment
  const mentionedTaskIds = useMemo(() => {
    if (!tasksData || !userDetails?.id) return new Set<string>();
    return new Set(
      tasksData
        .filter((task: Record<string, any>) => {
          const comment = task?.comment || task?.outline?.properties?.lock_comment;
          return commentMentionsUserId(comment, userDetails.id);
        })
        .map((task: Record<string, any>) => task.id),
    );
  }, [tasksData, userDetails?.id]);

  // zoom to layer in the project area
  const bbox = useMemo(() => {
    if (tasksData && tasksData.length > 0) {
      const tasksCollectiveGeojson = tasksData.reduce(
        (acc, curr) => ({ ...acc, features: [...acc.features, curr.outline] }),
        { type: "FeatureCollection", features: [] },
      );
      return getBbox(tasksCollectiveGeojson as FeatureCollection);
    }
    // No tasks yet - fall back to the project outline bbox
    return projectData?.outline?.properties?.bbox ?? null;
  }, [tasksData, projectData?.outline]);

  useEffect(() => {
    if (!bbox) return;
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25, duration: 500 });
  }, [map, bbox]);

  // Update selected task index when selectedTaskId changes
  useEffect(() => {
    if (!selectedTaskId || !tasksData) {
      setSelectedTaskIndex(null);
      return;
    }
    const task = tasksData.find((t: Record<string, any>) => t.id === selectedTaskId);
    setSelectedTaskIndex(task?.project_task_index || null);
  }, [selectedTaskId, tasksData]);

  // end zoom to layer

  const getPopupUI = useCallback(
    (properties: Record<string, any>) => {
      const status = taskStatusObj?.[properties?.id];
      const lockerName =
        userDetails?.id === properties?.locked_user_id
          ? m.map_popup_locker_you()
          : properties?.locked_user_name;
      const byLocker = properties.locked_user_name
        ? ` ${m.map_popup_by_locker({ locker: lockerName })}`
        : "";
      const lockComment = properties?.lock_comment;

      const statusLabel = (taskStatus: string) => {
        switch (taskStatus) {
          case "UNLOCKED":
            return m.legend_available();
          case "AWAITING_APPROVAL":
            return m.legend_awaiting_approval();
          case "LOCKED":
            return m.legend_in_progress();
          case "FULLY_FLOWN":
            return m.legend_fully_flown();
          case "HAS_IMAGERY":
            return m.legend_in_progress();
          case "HAS_ISSUES":
            return m.legend_has_issues();
          case "READY_FOR_PROCESSING":
            return m.legend_ready_for_processing();
          case "IMAGE_PROCESSING_STARTED":
            return m.legend_processing();
          case "IMAGE_PROCESSING_FINISHED":
            return m.legend_completed();
          case "IMAGE_PROCESSING_FAILED":
            return m.legend_has_issues();
          default:
            return m.map_popup_status_unknown();
        }
      };

      const statusColor = (taskStatus: string) => {
        switch (taskStatus) {
          case "UNLOCKED":
            return { bg: "#f0f0f0", text: "#484848" };
          case "AWAITING_APPROVAL":
            return { bg: "#F3C5C5", text: "#7a2020" };
          case "LOCKED":
            return { bg: "#98BBC8", text: "#1a3a4a" };
          case "FULLY_FLOWN":
            return { bg: "#176149", text: "#ffffff" };
          case "HAS_IMAGERY":
            return { bg: "#98BBC8", text: "#1a3a4a" };
          case "HAS_ISSUES":
            return { bg: "#D73F3F", text: "#ffffff" };
          case "READY_FOR_PROCESSING":
            return { bg: "#9ec7ff", text: "#1a3a6a" };
          case "IMAGE_PROCESSING_STARTED":
            return { bg: "#9C77B2", text: "#ffffff" };
          case "IMAGE_PROCESSING_FINISHED":
            return { bg: "#ACD2C4", text: "#1a3a2a" };
          case "IMAGE_PROCESSING_FAILED":
            return { bg: "#D73F3F", text: "#ffffff" };
          default:
            return { bg: "#e0e0e0", text: "#484848" };
        }
      };

      const popupDescription = (taskStatus: string) => {
        if (projectData?.regulator_approval_status === "PENDING")
          return m.map_popup_regulator_pending();
        if (projectData?.regulator_approval_status === "REJECTED")
          return m.map_popup_regulator_rejected();
        switch (taskStatus) {
          case "UNLOCKED":
            return m.map_popup_desc_unlocked();
          case "AWAITING_APPROVAL":
            return m.map_popup_desc_awaiting_approval({ byLocker });
          case "LOCKED":
            return m.map_popup_desc_locked({ byLocker });
          case "FULLY_FLOWN":
            return m.map_popup_desc_fully_flown({ byLocker });
          case "HAS_IMAGERY":
            return m.map_popup_desc_has_imagery({ byLocker });
          case "HAS_ISSUES":
            return m.map_popup_desc_has_issues();
          case "READY_FOR_PROCESSING":
            return m.map_popup_desc_ready_for_processing({ byLocker });
          case "IMAGE_PROCESSING_STARTED":
            return m.map_popup_desc_image_processing_started({ byLocker });
          case "IMAGE_PROCESSING_FINISHED":
            return m.map_popup_desc_image_processing_finished({ byLocker });
          case "IMAGE_PROCESSING_FAILED":
            return m.map_popup_desc_image_processing_failed({ byLocker });
          default:
            return "";
        }
      };

      const colors = statusColor(status);
      const description = popupDescription(status);
      const showComment = lockComment && status !== "UNLOCKED";
      const renderedComment = renderCommentMentions(lockComment);

      return (
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
          <span
            className="naxatw-inline-block naxatw-w-fit naxatw-rounded-full naxatw-px-2.5 naxatw-py-0.5 naxatw-text-xs naxatw-font-semibold"
            style={{ backgroundColor: colors.bg, color: colors.text }}
          >
            {statusLabel(status)}
          </span>
          {description && <p className="naxatw-text-xs naxatw-text-grey-800">{description}</p>}
          {showComment && (
            <p className="naxatw-text-xs naxatw-italic naxatw-text-grey-600">{renderedComment}</p>
          )}
        </div>
      );
    },
    [taskStatusObj, userDetails, projectData],
  );

  const handleTaskLockClick = () => {
    pendingLockCommentRef.current = "";
    lockTask({
      projectId: projectUuid,
      taskId: selectedTaskId,
      data: { event: "request", updated_at: new Date().toISOString() },
    });
  };

  const handleTaskLockWithCommentClick = () => {
    setShowLockDialog(true);
  };

  const handleLockTaskWithComment = (comment: string) => {
    pendingLockCommentRef.current = comment;
    lockTask({
      projectId: projectUuid,
      taskId: selectedTaskId,
      data: {
        event: "request",
        comment: comment || undefined,
        updated_at: new Date().toISOString(),
      },
    });
  };

  const handleTaskUnLockClick = () => {
    unLockTask({
      projectId: projectUuid,
      taskId: selectedTaskId,
      data: { event: "unlock", updated_at: new Date().toISOString() },
    });
  };

  const handleZoomToExtent = () => {
    if (!bbox) return;
    map?.fitBounds(bbox as LngLatBoundsLike, { padding: 25, duration: 500 });
  };

  const handleToggleTaskArea = () => {
    const taskLayerIds = map
      ?.getStyle()
      .layers?.filter((layer) => layer.id.includes("tasks-layer"));

    taskLayerIds?.forEach((layerId) => {
      map?.setLayoutProperty(`${layerId.id}`, "visibility", showTaskArea ? "none" : "visible");
    });
    setShowTaskArea((prev) => !prev);
  };

  return (
    <>
      <MapContainer
        map={map}
        isMapLoaded={isMapLoaded}
        style={{
          width: "100%",
          height: "100%",
        }}
      >
        <BaseLayerSwitcherUI />
        <LocateUser />
        {projectArea && showTaskArea && (
          <VectorLayer
            map={map as Map}
            id="project-area"
            visibleOnMap
            geojson={
              {
                type: "FeatureCollection",
                features: [projectArea],
              } as GeojsonType
            }
            layerOptions={{
              type: "line",
              paint: {
                "line-color": "#D73F3F",
                "line-width": 2,
              },
            }}
          />
        )}
        {projectData?.no_fly_zones_geojson && showTaskArea && (
          <VectorLayer
            map={map as Map}
            id="no-fly-zone-area"
            visibleOnMap
            geojson={
              {
                type: "FeatureCollection",
                features: [projectData?.no_fly_zones_geojson],
              } as GeojsonType
            }
            layerOptions={{
              type: "fill",
              paint: {
                "fill-color": "#9EA5AD",
                "fill-outline-color": "#484848",
                "fill-opacity": 0.8,
              },
            }}
          />
        )}
        {taskStatusObj &&
          tasksData &&
          tasksData?.map((task: Record<string, any>) => {
            return (
              <VectorLayer
                key={task?.id}
                map={map as Map}
                id={`tasks-layer-${task?.id}-${taskStatusObj?.[task?.id]}`}
                visibleOnMap={task?.id && taskStatusObj}
                geojson={{
                  ...task.outline,
                  properties: {
                    ...task.outline.properties,
                    project_task_index: task?.project_task_index,
                  },
                }}
                interactions={["feature"]}
                layerOptions={getLayerOptionsByStatus(taskStatusObj?.[`${task?.id}`])}
                hasImage={
                  taskStatusObj?.[`${task?.id}`] === "LOCKED" ||
                  taskStatusObj?.[`${task?.id}`] === "HAS_IMAGERY" ||
                  false
                }
                image={lock}
              />
            );
          })}
        {/* @mention highlight: dashed outline for tasks mentioning current user */}
        {taskStatusObj &&
          tasksData &&
          tasksData
            ?.filter((task: Record<string, any>) => mentionedTaskIds.has(task?.id))
            .map((task: Record<string, any>) => (
              <VectorLayer
                key={`mention-${task?.id}`}
                map={map as Map}
                id={`mention-highlight-${task?.id}`}
                visibleOnMap
                geojson={{
                  ...task.outline,
                  properties: {
                    ...task.outline.properties,
                    project_task_index: task?.project_task_index,
                  },
                }}
                layerOptions={{
                  type: "line",
                  paint: {
                    "line-color": "#FFD700",
                    "line-width": 3,
                    "line-dasharray": [3, 2],
                  },
                }}
              />
            ))}
        {/* visualize tasks orthophoto */}
        {visibleTaskOrthophoto?.map((orthophotoDetails) => (
          <COGOrthophotoViewer
            key={orthophotoDetails.taskId}
            id={orthophotoDetails.taskId}
            source={orthophotoDetails.source}
            visibleOnMap
            zoomToLayer
          />
        ))}
        {/* visualize tasks orthophoto end */}
        {/* additional controls */}
        <div className="naxatw-absolute naxatw-left-[0.575rem] naxatw-top-[5.75rem] naxatw-z-30 naxatw-flex naxatw-h-fit naxatw-w-fit naxatw-flex-col naxatw-gap-3">
          <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
            <Button
              variant="ghost"
              className={`naxatw-flex naxatw-h-[1.85rem] naxatw-w-[] naxatw-items-center naxatw-justify-center naxatw-border !naxatw-p-[0.315rem] ${showTaskArea ? "naxatw-border-red naxatw-bg-[#ffe0e0]" : "naxatw-border-gray-400 naxatw-bg-[#F5F5F5]"}`}
              onClick={() => handleToggleTaskArea()}
              title={m.map_button_task_area()}
            >
              <div className="naxatw-h-4 naxatw-w-4">
                <img src={areaIcon} alt="area-icon" />
              </div>
            </Button>
            <ToolTip message={m.map_button_zoom_to_project_area()} className="naxatw-mt-[-4px]">
              <button
                className="naxatw-grid naxatw-h-[1.85rem] naxatw-place-items-center naxatw-border naxatw-border-gray-400 naxatw-bg-[#F5F5F5] !naxatw-p-[0.315rem]"
                onClick={() => handleZoomToExtent()}
              >
                <Icon
                  name="zoom_out_map"
                  iconSymbolType="material-icons"
                  className="!naxatw-text-xl !naxatw-text-black"
                />
              </button>
            </ToolTip>
          </div>
        </div>
        {/*  additional controls */}
        <AsyncPopup
          map={map as Map}
          popupUI={getPopupUI}
          title={
            selectedTaskIndex !== null
              ? m.map_popup_task_title({ index: selectedTaskIndex })
              : m.map_popup_task_title({ index: selectedTaskId })
          }
          showPopup={(feature: Record<string, any>) => {
            if (!userDetails) return false;

            return (
              feature?.source?.includes("tasks-layer") &&
              !(
                (
                  (userDetails?.role?.length === 1 && userDetails?.role?.includes("REGULATOR")) ||
                  signedInAs === "REGULATOR"
                ) // Don't show popup if user role is regulator any and no other roles
              )
            );
          }}
          fetchPopupData={(properties: Record<string, any>) => {
            dispatch(
              setProjectState({
                taskClickedOnTable: null,
              }),
            );
            dispatch(setProjectState({ selectedTaskId: properties.id }));
            setSelectedTaskIndex(properties?.project_task_index || null);
            setLockedUser({
              id: properties?.locked_user_id || userDetails?.id || "",
              name: properties?.locked_user_name || userDetails?.name || "",
            });
          }}
          hideButton={
            projectData?.regulator_approval_status === "REJECTED" || // Don't task lock button if regulator rejected the approval
            projectData?.regulator_approval_status === "PENDING"
          }
          buttonText={
            taskStatusObj?.[selectedTaskId] === "UNLOCKED" || !taskStatusObj?.[selectedTaskId]
              ? m.individual_project_lock_task()
              : m.map_popup_go_to_task()
          }
          handleBtnClick={() =>
            taskStatusObj?.[selectedTaskId] === "UNLOCKED" || !taskStatusObj?.[selectedTaskId]
              ? handleTaskLockClick()
              : navigate(`/projects/${projectData?.slug || urlId}/tasks/${selectedTaskIndex}`)
          }
          hasSecondaryButton={
            taskStatusObj?.[selectedTaskId] === "UNLOCKED" ||
            !taskStatusObj?.[selectedTaskId] ||
            (taskStatusObj?.[selectedTaskId] === "LOCKED" &&
              (lockedUser?.id === userDetails?.id || projectData?.author_id === userDetails?.id))
          }
          secondaryButtonText={
            taskStatusObj?.[selectedTaskId] === "UNLOCKED" || !taskStatusObj?.[selectedTaskId]
              ? m.map_popup_lock_with_comment()
              : m.map_popup_unlock_task()
          }
          handleSecondaryBtnClick={() =>
            taskStatusObj?.[selectedTaskId] === "UNLOCKED" || !taskStatusObj?.[selectedTaskId]
              ? handleTaskLockWithCommentClick()
              : setShowUnlockDialog(true)
          }
          // trigger from popup outside
          openPopupFor={
            projectData?.regulator_approval_status === "REJECTED" // ignore click if the regulator rejected the approval
              ? null
              : taskClickedOnTable
          }
          popupCoordinate={taskClickedOnTable?.centroidCoordinates}
          onClose={() =>
            dispatch(
              setProjectState({
                taskClickedOnTable: null,
              }),
            )
          }
        />
        <Legend />
      </MapContainer>

      <ProjectPromptDialog
        title={m.individual_project_lock_task()}
        show={showLockDialog}
        onClose={() => setShowLockDialog(false)}
      >
        <LockTaskDialog
          handleLockTask={handleLockTaskWithComment}
          setShowLockDialog={setShowLockDialog}
        />
      </ProjectPromptDialog>

      <ProjectPromptDialog
        title={m.map_dialog_task_unlock_title()}
        show={showUnlockDialog}
        onClose={() => setShowUnlockDialog(false)}
      >
        <UnlockTaskPromptDialog
          handleUnlockTask={handleTaskUnLockClick}
          setShowUnlockDialog={setShowUnlockDialog}
        />
      </ProjectPromptDialog>
    </>
  );
};

export default hasErrorBoundary(MapSection);
