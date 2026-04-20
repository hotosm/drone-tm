import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { matchPath, useLocation } from "react-router-dom";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetProjectsDetailQuery } from "@Api/projects";
import { useGetAllTaskAssetsInfo, useGetOdmQueueInfo } from "@Api/tasks";
import { postProcessImagery } from "@Services/tasks";
import { processAllImagery, saveGcpFile } from "@Services/project";
import { getProjectTaskImagerySummary, TaskImagerySummary } from "@Services/classification";
import { formatString, buildDownloadUrl } from "@Utils/index";
import { Button } from "@Components/RadixComponents/Button";
import Icon from "@Components/common/Icon";
import { toggleModal } from "@Store/actions/common";
import { setProjectState } from "@Store/actions/project";

const stateColors: Record<string, string> = {
  READY_FOR_PROCESSING: "#9ec7ff",
  IMAGE_PROCESSING_STARTED: "#9C77B2",
  IMAGE_PROCESSING_FINISHED: "#ACD2C4",
  IMAGE_PROCESSING_FAILED: "#D73F3F",
  LOCKED: "#98BBC8",
  HAS_ISSUES: "#D73F3F",
};

type ProcessingDialogTask = {
  task_id: string;
  task_index: number;
  image_count: number;
  state: string;
  failure_reason?: string | null;
  assets_url?: string | null;
};

type ProcessingDialogProjectDetail = {
  total_task_count?: number;
  has_gcp?: boolean;
};

type OdmQueueTask = {
  uuid: string;
  name?: string;
  images_count?: number;
  status_label: string;
  status_code: number;
  progress?: number;
  processing_time?: number;
  dtm_task_id?: string;
  task_index?: number;
};

type OdmStatusGroup = {
  status_code: number;
  status_label: string;
  count: number;
  tasks: OdmQueueTask[];
};

type OdmQueueInfo = {
  total_queued: number;
  total_running: number;
  total_failed: number;
  total_completed: number;
  total_canceled: number;
  total_tasks: number;
  queue_position?: number;
  groups: OdmStatusGroup[];
};

const ProcessingStatusDialog = () => {
  const { pathname } = useLocation();
  const projectRouteId = useMemo(() => {
    const projectMatch = matchPath("/projects/:id", pathname);
    const approvalMatch = matchPath("/projects/:id/approval", pathname);
    return projectMatch?.params.id || approvalMatch?.params.id || "";
  }, [pathname]);
  const dispatch = useDispatch();
  const queryClient = useQueryClient();

  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [processingTasks, setProcessingTasks] = useState<Set<string>>(new Set());
  const [showQueueInfo, setShowQueueInfo] = useState(false);

  // allTaskAssets: S3-based data (assets_url, image_count from disk, state)
  const { data: projectDetail } = useGetProjectsDetailQuery(projectRouteId) as {
    data?: ProcessingDialogProjectDetail;
  };
  const projectId = (projectDetail as any)?.id || projectRouteId;
  const { data: allTaskAssets } = useGetAllTaskAssetsInfo(projectId);

  // Backend summary: authoritative source for has_ready_imagery
  const {
    data: taskSummary,
    refetch: refetchTaskSummary,
    isFetching: isTaskSummaryFetching,
  } = useQuery<TaskImagerySummary[]>({
    queryKey: ["projectTaskImagerySummary", projectId],
    queryFn: () => getProjectTaskImagerySummary(projectId),
    enabled: !!projectId,
  });

  const {
    data: queueInfo,
    refetch: refetchQueueInfo,
    isFetching: isQueueFetching,
    dataUpdatedAt: queueUpdatedAt,
  } = useGetOdmQueueInfo(projectId, showQueueInfo) as {
    data?: OdmQueueInfo;
    refetch: () => Promise<any>;
    isFetching: boolean;
    dataUpdatedAt: number;
  };

  // Build a lookup from task_id → has_ready_imagery so the backend is the
  // single source of truth for readiness decisions.
  const readinessMap = useMemo(() => {
    const map = new Map<string, boolean>();
    if (taskSummary) {
      for (const t of taskSummary) {
        map.set(t.task_id, t.has_ready_imagery);
      }
    }
    return map;
  }, [taskSummary]);

  const { mutateAsync: processTask } = useMutation({
    mutationFn: ({ taskId, odmUrl }: { taskId: string; odmUrl?: string }) =>
      postProcessImagery(projectId, taskId, odmUrl),
  });

  const { mutate: startAllImageProcessing, isPending: isProcessingAll } = useMutation({
    mutationFn: processAllImagery,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-detail"] });
      queryClient.invalidateQueries({
        queryKey: ["all-task-assets-info", projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["projectTaskImagerySummary", projectId],
      });
      toast.success("Final processing started");
      dispatch(toggleModal());
    },
    onError: (error) => {
      const detail =
        axios.isAxiosError(error) &&
        typeof error.response?.data?.detail === "string" &&
        error.response.data.detail
          ? error.response.data.detail
          : "Failed to start final processing";
      toast.error(detail);
    },
  });

  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const handleProcessSelected = useCallback(async () => {
    const taskIds = Array.from(selectedTasks);
    setSelectedTasks(new Set());
    setProcessingTasks(new Set(taskIds));
    const results = await Promise.allSettled(taskIds.map((taskId) => processTask({ taskId })));
    let successCount = 0;
    let failCount = 0;
    results.forEach((result) => {
      if (result.status === "fulfilled") successCount++;
      else failCount++;
    });
    if (successCount > 0) {
      toast.success(`Processing started for ${successCount} task(s)`);
    }
    if (failCount > 0) {
      toast.error(`Failed to start processing for ${failCount} task(s)`);
    }
    const failedTaskIds = taskIds.filter((_taskId, index) => results[index].status === "rejected");
    if (failedTaskIds.length > 0) {
      setProcessingTasks((prev) => {
        const next = new Set(prev);
        failedTaskIds.forEach((taskId) => next.delete(taskId));
        return next;
      });
    }
    queryClient.invalidateQueries({
      queryKey: ["all-task-assets-info", projectId],
    });
    queryClient.invalidateQueries({
      queryKey: ["projectTaskImagerySummary", projectId],
    });
  }, [selectedTasks, processTask, queryClient, projectId]);

  const handleProcessSingle = useCallback(
    async (taskId: string, odmUrl?: string) => {
      setProcessingTasks((prev) => new Set(prev).add(taskId));
      try {
        await processTask({ taskId, odmUrl });
        toast.success(`Task processing started`);
        queryClient.invalidateQueries({
          queryKey: ["all-task-assets-info", projectId],
        });
        queryClient.invalidateQueries({
          queryKey: ["projectTaskImagerySummary", projectId],
        });
      } catch (error) {
        const detail =
          axios.isAxiosError(error) &&
          typeof error.response?.data?.detail === "string" &&
          error.response.data.detail
            ? error.response.data.detail
            : "Failed to start processing";
        toast.error(detail);
        setProcessingTasks((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    },
    [processTask, queryClient, projectId],
  );

  const handleDownloadAssets = useCallback((assetsUrl: string) => {
    try {
      const link = document.createElement("a");
      link.href = buildDownloadUrl(assetsUrl);
      link.setAttribute("download", "");
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error(`Download failed: ${error}`);
    }
  }, []);

  const getProcessButtonLabel = useCallback((task: ProcessingDialogTask) => {
    if (task.state === "IMAGE_PROCESSING_FAILED") {
      return "Retry";
    }
    if (task.state === "IMAGE_PROCESSING_FINISHED") {
      return "Re-run";
    }
    return "Process";
  }, []);

  const handleStartFinalProcessing = useCallback(
    (withGcp: boolean) => {
      if (withGcp) {
        dispatch(setProjectState({ showGcpEditor: true }));
        dispatch(toggleModal());
      } else {
        startAllImageProcessing({ projectId });
      }
    },
    [dispatch, startAllImageProcessing, projectId],
  );

  const gcpFileInputRef = useRef<HTMLInputElement>(null);

  const { mutate: uploadGcpFile, isPending: isUploadingGcp } = useMutation({
    mutationFn: saveGcpFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-detail"] });
      toast.success("GCP file uploaded");
    },
    onError: () => {
      toast.error("Failed to upload GCP file");
    },
  });

  const handleGcpFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      uploadGcpFile({ projectId, gcp_file: file });
      // Reset so the same file can be re-selected
      e.target.value = "";
    },
    [projectId, uploadGcpFile],
  );

  const totalTaskCount = useMemo(() => {
    if (typeof projectDetail?.total_task_count === "number") {
      return projectDetail.total_task_count;
    }
    if (Array.isArray(taskSummary) && taskSummary.length > 0) {
      return taskSummary.length;
    }
    return Array.isArray(allTaskAssets) ? allTaskAssets.length : 0;
  }, [allTaskAssets, taskSummary, projectDetail]);

  const taskList = useMemo<ProcessingDialogTask[]>(() => {
    const assetsByTaskId = new Map<string, any>();
    if (Array.isArray(allTaskAssets)) {
      allTaskAssets.forEach((task: any) => {
        assetsByTaskId.set(task.task_id, task);
      });
    }

    if (Array.isArray(taskSummary) && taskSummary.length > 0) {
      return taskSummary
        .filter(
          (task) =>
            task.assigned_images > 0 ||
            task.task_state === "READY_FOR_PROCESSING" ||
            task.task_state === "IMAGE_PROCESSING_STARTED" ||
            task.task_state === "IMAGE_PROCESSING_FINISHED" ||
            task.task_state === "IMAGE_PROCESSING_FAILED",
        )
        .map((task) => {
          const assetInfo = assetsByTaskId.get(task.task_id);
          return {
            task_id: task.task_id,
            task_index: task.project_task_index,
            image_count: task.assigned_images,
            state: task.task_state,
            failure_reason: task.failure_reason,
            assets_url: assetInfo?.assets_url,
          };
        })
        .sort((a, b) => a.task_index - b.task_index);
    }

    if (!Array.isArray(allTaskAssets)) return [];

    return [...allTaskAssets]
      .filter(
        (t: any) =>
          t.image_count > 0 ||
          t.state === "READY_FOR_PROCESSING" ||
          t.state === "IMAGE_PROCESSING_STARTED" ||
          t.state === "IMAGE_PROCESSING_FINISHED" ||
          t.state === "IMAGE_PROCESSING_FAILED",
      )
      .map((task: any) => ({
        task_id: task.task_id,
        task_index: task.task_index,
        image_count: task.image_count,
        state: task.state,
        failure_reason: task.failure_reason,
        assets_url: task.assets_url,
      }))
      .sort((a, b) => {
        const aIdx = a.task_id?.localeCompare?.(b.task_id) || 0;
        return aIdx;
      });
  }, [allTaskAssets, taskSummary]);

  const processableTasks = useMemo(
    () => taskList.filter((task) => readinessMap.get(task.task_id) === true),
    [taskList, readinessMap],
  );

  useEffect(() => {
    setProcessingTasks((prev) => {
      if (prev.size === 0) return prev;

      const next = new Set(prev);
      taskList.forEach((task) => {
        if (next.has(task.task_id) && task.state !== "READY_FOR_PROCESSING") {
          next.delete(task.task_id);
        }
      });

      return next.size === prev.size ? prev : next;
    });
  }, [taskList]);

  const toggleSelectAll = useCallback(() => {
    if (selectedTasks.size === processableTasks.length) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(new Set(processableTasks.map((task) => task.task_id)));
    }
  }, [selectedTasks, processableTasks]);

  const processedCount = useMemo(
    () => taskList.filter((t: any) => t.state === "IMAGE_PROCESSING_FINISHED").length,
    [taskList],
  );

  const allTasksProcessed = useMemo(
    () =>
      totalTaskCount > 0 &&
      Array.isArray(taskSummary) &&
      taskSummary.length === totalTaskCount &&
      taskSummary.every((task) => task.task_state === "IMAGE_PROCESSING_FINISHED"),
    [taskSummary, totalTaskCount],
  );

  const finalProcessingDisabledReason = useMemo(() => {
    if (isProcessingAll) {
      return "Final processing is already starting.";
    }
    if (!totalTaskCount) {
      return "No project tasks are available yet.";
    }
    if (!Array.isArray(taskSummary) || taskSummary.length < totalTaskCount) {
      return "Every task must have imagery and finish quick processing first.";
    }
    if (!allTasksProcessed) {
      return "All tasks must reach Complete before final processing can start.";
    }
    return "";
  }, [isProcessingAll, totalTaskCount, taskSummary, allTasksProcessed]);

  const hasSavedGcp = Boolean(projectDetail?.has_gcp);
  const queueLastUpdated = queueUpdatedAt ? new Date(queueUpdatedAt).toLocaleTimeString() : null;

  return (
    <>
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-4">
        {/* Per-task processing section */}
        <div className="naxatw-flex naxatw-items-start naxatw-justify-between naxatw-gap-3">
          <div>
            <h3 className="naxatw-text-sm naxatw-font-semibold naxatw-text-gray-800">
              Task Processing (Quick Orthophoto)
            </h3>
            <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-gray-500">
              Processes images for each task individually to produce a quick preview orthophoto.
            </p>
          </div>
          <Button
            variant="outline"
            className="naxatw-h-8 naxatw-shrink-0 naxatw-border-blue-300 naxatw-px-3 naxatw-text-xs naxatw-text-blue-700"
            leftIcon="queue"
            iconClassname="!naxatw-text-sm"
            onClick={() => setShowQueueInfo(true)}
          >
            View Queue
          </Button>
        </div>

        {/* Task table */}
        <div className="naxatw-max-h-[300px] naxatw-overflow-y-auto naxatw-rounded naxatw-border naxatw-border-gray-200">
          <table className="naxatw-w-full naxatw-text-sm">
            <thead className="naxatw-sticky naxatw-top-0 naxatw-bg-gray-50">
              <tr className="naxatw-border-b naxatw-border-gray-200">
                <th className="naxatw-px-3 naxatw-py-2 naxatw-text-left">
                  <input
                    type="checkbox"
                    checked={
                      processableTasks.length > 0 && selectedTasks.size === processableTasks.length
                    }
                    onChange={toggleSelectAll}
                    disabled={processableTasks.length === 0}
                    className="naxatw-cursor-pointer"
                  />
                </th>
                <th className="naxatw-px-3 naxatw-py-2 naxatw-text-left naxatw-font-medium naxatw-text-gray-600">
                  Task
                </th>
                <th className="naxatw-px-3 naxatw-py-2 naxatw-text-left naxatw-font-medium naxatw-text-gray-600">
                  Images
                </th>
                <th className="naxatw-px-3 naxatw-py-2 naxatw-text-left naxatw-font-medium naxatw-text-gray-600">
                  Status
                </th>
                <th className="naxatw-px-3 naxatw-py-2 naxatw-text-right naxatw-font-medium naxatw-text-gray-600">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {taskList.map((task, index: number) => {
                const canProcess =
                  readinessMap.get(task.task_id) === true &&
                  !processingTasks.has(task.task_id) &&
                  task.state !== "IMAGE_PROCESSING_STARTED";
                const isTaskProcessing =
                  processingTasks.has(task.task_id) || task.state === "IMAGE_PROCESSING_STARTED";
                const displayState = isTaskProcessing ? "IMAGE_PROCESSING_STARTED" : task.state;
                const stateColor = stateColors[displayState] || "#e5e7eb";

                return (
                  <tr
                    key={task.task_id}
                    className="naxatw-border-b naxatw-border-gray-100 last:naxatw-border-0"
                  >
                    <td className="naxatw-px-3 naxatw-py-2">
                      <input
                        type="checkbox"
                        checked={selectedTasks.has(task.task_id)}
                        onChange={() => toggleTaskSelection(task.task_id)}
                        disabled={!canProcess}
                        className="naxatw-cursor-pointer disabled:naxatw-cursor-not-allowed disabled:naxatw-opacity-50"
                      />
                    </td>
                    <td className="naxatw-px-3 naxatw-py-2 naxatw-font-medium">
                      Task {task.task_index ?? index + 1}
                    </td>
                    <td className="naxatw-px-3 naxatw-py-2 naxatw-text-gray-600">
                      {task.image_count} images
                    </td>
                    <td className="naxatw-px-3 naxatw-py-2">
                      <div className="naxatw-flex naxatw-flex-col naxatw-items-start naxatw-gap-1">
                        <span
                          className="naxatw-inline-flex naxatw-items-center naxatw-gap-1 naxatw-rounded-full naxatw-px-2 naxatw-py-0.5 naxatw-text-xs naxatw-font-medium"
                          style={{
                            backgroundColor: `${stateColor}33`,
                            color:
                              displayState === "IMAGE_PROCESSING_FINISHED"
                                ? "#166534"
                                : displayState === "IMAGE_PROCESSING_FAILED"
                                  ? "#991b1b"
                                  : "#374151",
                          }}
                        >
                          {isTaskProcessing && (
                            <Icon name="sync" className="naxatw-animate-spin !naxatw-text-sm" />
                          )}
                          {displayState === "IMAGE_PROCESSING_FINISHED" && "✓ "}
                          {formatString(displayState) || "No images"}
                        </span>
                        {task.state === "IMAGE_PROCESSING_FAILED" && task.failure_reason && (
                          <p className="naxatw-max-w-[320px] naxatw-text-xs naxatw-text-red-700">
                            {task.failure_reason}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="naxatw-px-3 naxatw-py-2">
                      {isTaskProcessing ? (
                        <div className="naxatw-flex naxatw-justify-end">
                          <Icon
                            name="sync"
                            className="naxatw-animate-spin !naxatw-text-lg naxatw-text-gray-500"
                          />
                        </div>
                      ) : (
                        <div className="naxatw-flex naxatw-justify-end naxatw-gap-2">
                          {task.state === "IMAGE_PROCESSING_FINISHED" && task.assets_url ? (
                            <Button
                              variant="ghost"
                              className="naxatw-h-7 naxatw-px-2 naxatw-text-xs naxatw-text-blue-600 hover:naxatw-bg-blue-50"
                              leftIcon="download"
                              iconClassname="!naxatw-text-sm"
                              onClick={() => {
                                if (task.assets_url) {
                                  handleDownloadAssets(task.assets_url);
                                }
                              }}
                            >
                              Download
                            </Button>
                          ) : null}
                          {canProcess ? (
                            <Button
                              variant="ghost"
                              className="naxatw-h-7 naxatw-bg-red naxatw-px-2 naxatw-text-xs naxatw-text-white hover:naxatw-bg-red/90"
                              leftIcon={
                                task.state === "IMAGE_PROCESSING_FAILED" ||
                                task.state === "IMAGE_PROCESSING_FINISHED"
                                  ? "replay"
                                  : "play_arrow"
                              }
                              iconClassname="!naxatw-text-sm"
                              onClick={(e) => {
                                const isReprocess =
                                  task.state === "IMAGE_PROCESSING_FINISHED" ||
                                  task.state === "IMAGE_PROCESSING_FAILED";
                                if (
                                  isReprocess &&
                                  !window.confirm(
                                    "Are you sure? This will re-process the entire task.",
                                  )
                                ) {
                                  return;
                                }
                                if (e.ctrlKey || e.metaKey) {
                                  const odmUrl = window.prompt(
                                    "Enter a NodeODM server URL for processing\n(e.g. https://odm.example.com/?token=YOUR_TOKEN)",
                                  );
                                  if (odmUrl !== null) {
                                    handleProcessSingle(task.task_id, odmUrl || undefined);
                                  }
                                } else {
                                  handleProcessSingle(task.task_id);
                                }
                              }}
                            >
                              {getProcessButtonLabel(task)}
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Process Selected button */}
        {selectedTasks.size > 0 && (
          <div className="naxatw-flex naxatw-justify-center">
            <Button
              variant="ghost"
              className="naxatw-bg-red naxatw-text-white disabled:naxatw-bg-gray-400"
              leftIcon="play_arrow"
              onClick={() => {
                if (
                  !window.confirm(
                    `Are you sure you want to process ${selectedTasks.size} task(s)? Any previously processed tasks will be re-processed.`,
                  )
                ) {
                  return;
                }
                handleProcessSelected();
              }}
              disabled={selectedTasks.size === 0}
            >
              Process Selected ({selectedTasks.size})
            </Button>
          </div>
        )}

        {/* Status summary */}
        <div className="naxatw-flex naxatw-items-center naxatw-justify-center naxatw-gap-2">
          <p className="naxatw-text-center naxatw-text-xs naxatw-text-gray-500">
            {processedCount}/{taskList.length} tasks processed
            {taskList.length < totalTaskCount && (
              <span className="naxatw-ml-1">
                ({totalTaskCount - taskList.length} tasks awaiting imagery)
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => refetchTaskSummary()}
            disabled={isTaskSummaryFetching}
            className="naxatw-inline-flex naxatw-items-center naxatw-rounded naxatw-p-0.5 naxatw-text-gray-400 hover:naxatw-text-gray-600 disabled:naxatw-opacity-50"
            title="Refresh task status"
          >
            <Icon
              name="refresh"
              className={`!naxatw-text-sm ${isTaskSummaryFetching ? "naxatw-animate-spin" : ""}`}
            />
          </button>
        </div>

        {taskList.length === 0 && (
          <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-2 naxatw-py-6 naxatw-text-gray-500">
            <span className="material-icons naxatw-text-4xl naxatw-text-gray-300">
              image_search
            </span>
            <p className="naxatw-text-sm">No tasks are ready for processing yet.</p>
            <p className="naxatw-text-xs">
              Upload imagery and mark tasks ready for processing in the Verify Imagery step first.
            </p>
          </div>
        )}

        {/* Divider */}
        <hr className="naxatw-border-gray-200" />

        {/* Final Processing section */}
        <div>
          <h3 className="naxatw-text-sm naxatw-font-semibold naxatw-text-gray-800">
            Final Project Processing
          </h3>
          <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-gray-500">
            Stitches all task images together into a single high-quality orthophoto and 3D model.
            This takes longer.
          </p>
        </div>

        {/* GCP status card with actions */}
        <div
          className={`naxatw-w-full naxatw-rounded-lg naxatw-border naxatw-px-4 naxatw-py-3 naxatw-text-sm ${
            hasSavedGcp
              ? "naxatw-border-green-200 naxatw-bg-green-50 naxatw-text-green-800"
              : "naxatw-border-gray-200 naxatw-bg-gray-50 naxatw-text-gray-700"
          }`}
        >
          <div className="naxatw-flex naxatw-items-start naxatw-justify-between naxatw-gap-3">
            <div className="naxatw-flex naxatw-items-start naxatw-gap-2">
              <span className="material-icons !naxatw-text-base naxatw-mt-0.5">
                {hasSavedGcp ? "check_circle" : "pin_drop"}
              </span>
              <div>
                <p className="naxatw-font-medium">
                  {hasSavedGcp ? "GCP file saved for this project." : "No GCP file yet (optional)."}
                </p>
                <p className="naxatw-mt-1 naxatw-text-xs naxatw-opacity-80">
                  {hasSavedGcp
                    ? "The saved gcp.txt will be included in final processing."
                    : "Mark points on images with the GCP Editor, or upload an existing gcp.txt."}
                </p>
              </div>
            </div>
            <div className="naxatw-flex naxatw-shrink-0 naxatw-gap-2">
              <Button
                variant="outline"
                className="naxatw-h-8 naxatw-border-red naxatw-px-3 naxatw-text-xs naxatw-text-red"
                leftIcon="pin_drop"
                iconClassname="!naxatw-text-sm"
                onClick={() => {
                  dispatch(setProjectState({ showGcpEditor: true }));
                  dispatch(toggleModal());
                }}
              >
                {hasSavedGcp ? "Edit GCP" : "GCP Editor"}
              </Button>
              <Button
                variant="outline"
                className="naxatw-h-8 naxatw-border-gray-400 naxatw-px-3 naxatw-text-xs naxatw-text-gray-700"
                leftIcon="upload_file"
                iconClassname="!naxatw-text-sm"
                onClick={() => gcpFileInputRef.current?.click()}
                disabled={isUploadingGcp}
              >
                {isUploadingGcp
                  ? "Uploading..."
                  : hasSavedGcp
                    ? "Replace gcp.txt"
                    : "Upload gcp.txt"}
              </Button>
              <input
                ref={gcpFileInputRef}
                type="file"
                accept=".txt"
                className="naxatw-hidden"
                onChange={handleGcpFileUpload}
              />
            </div>
          </div>
        </div>

        {/* Start Final Processing CTA */}
        <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-2">
          {finalProcessingDisabledReason && (
            <p className="naxatw-text-center naxatw-text-xs naxatw-text-amber-700">
              {finalProcessingDisabledReason}
            </p>
          )}
          <Button
            variant="ghost"
            className="naxatw-bg-red naxatw-px-8 naxatw-py-2 naxatw-text-white disabled:naxatw-bg-gray-400"
            leftIcon="play_arrow"
            onClick={() => {
              if (
                !window.confirm(
                  "Are you sure? This will re-process all task imagery into a single orthophoto and 3D model. This may take a long time.",
                )
              ) {
                return;
              }
              handleStartFinalProcessing(false);
            }}
            disabled={Boolean(finalProcessingDisabledReason)}
          >
            Start Final Processing
          </Button>
        </div>
      </div>

      {showQueueInfo && (
        <>
          <button
            type="button"
            aria-label="Close queue panel"
            className="naxatw-fixed naxatw-inset-0 naxatw-z-[11111] naxatw-bg-black/20"
            onClick={() => setShowQueueInfo(false)}
          />
          <div className="naxatw-fixed naxatw-inset-y-0 naxatw-right-0 naxatw-z-[11112] naxatw-flex naxatw-w-full naxatw-justify-end">
            <div className="naxatw-flex naxatw-h-full naxatw-w-full naxatw-max-w-xl naxatw-flex-col naxatw-border-l naxatw-border-gray-200 naxatw-bg-white naxatw-shadow-2xl">
              <div className="naxatw-flex naxatw-items-start naxatw-justify-between naxatw-border-b naxatw-border-gray-200 naxatw-px-5 naxatw-py-4">
                <div>
                  <h3 className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-900">
                    ODM Processing Queue
                  </h3>
                  <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-gray-500">
                    Monitor active processing and refresh to see queue movement. Note: newly
                    submitted tasks may take a few minutes to appear here while images are being
                    prepared and uploaded.
                  </p>
                </div>
                <button
                  type="button"
                  className="naxatw-rounded-full naxatw-p-2 naxatw-text-gray-500 hover:naxatw-bg-gray-100"
                  onClick={() => setShowQueueInfo(false)}
                >
                  <span className="material-icons">close</span>
                </button>
              </div>

              <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-gap-3 naxatw-border-b naxatw-border-gray-100 naxatw-bg-gray-50 naxatw-px-5 naxatw-py-3">
                <div className="naxatw-flex naxatw-flex-wrap naxatw-items-center naxatw-gap-2 naxatw-text-xs">
                  {(queueInfo?.total_running ?? 0) > 0 && (
                    <span className="naxatw-rounded-full naxatw-bg-purple-100 naxatw-px-2.5 naxatw-py-1 naxatw-font-medium naxatw-text-purple-800">
                      {queueInfo?.total_running} running
                    </span>
                  )}
                  {(queueInfo?.total_queued ?? 0) > 0 && (
                    <span className="naxatw-rounded-full naxatw-bg-yellow-100 naxatw-px-2.5 naxatw-py-1 naxatw-font-medium naxatw-text-yellow-800">
                      {queueInfo?.total_queued} queued
                    </span>
                  )}
                  {(queueInfo?.total_failed ?? 0) > 0 && (
                    <span className="naxatw-rounded-full naxatw-bg-red-100 naxatw-px-2.5 naxatw-py-1 naxatw-font-medium naxatw-text-red-800">
                      {queueInfo?.total_failed} failed
                    </span>
                  )}
                  <span className="naxatw-rounded-full naxatw-bg-gray-200 naxatw-px-2.5 naxatw-py-1 naxatw-font-medium naxatw-text-gray-700">
                    {queueInfo?.total_tasks ?? 0} total
                  </span>
                </div>
                <div className="naxatw-flex naxatw-items-center naxatw-gap-3">
                  {queueLastUpdated && (
                    <span className="naxatw-text-xs naxatw-text-gray-500">
                      Updated {queueLastUpdated}
                    </span>
                  )}
                  <Button
                    variant="outline"
                    className="naxatw-h-8 naxatw-border-blue-300 naxatw-px-3 naxatw-text-xs naxatw-text-blue-700"
                    leftIcon={isQueueFetching ? "sync" : "refresh"}
                    iconClassname={
                      isQueueFetching ? "naxatw-animate-spin !naxatw-text-sm" : "!naxatw-text-sm"
                    }
                    onClick={() => refetchQueueInfo()}
                    disabled={isQueueFetching}
                  >
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="naxatw-flex-1 naxatw-overflow-y-auto naxatw-px-5 naxatw-py-4">
                {!queueInfo && isQueueFetching ? (
                  <p className="naxatw-text-sm naxatw-text-gray-500">Loading queue info...</p>
                ) : !queueInfo || queueInfo.groups.length === 0 ? (
                  <div className="naxatw-flex naxatw-h-full naxatw-flex-col naxatw-items-center naxatw-justify-center naxatw-gap-2 naxatw-text-center">
                    <span className="material-icons naxatw-text-4xl naxatw-text-gray-300">
                      queue
                    </span>
                    <p className="naxatw-text-sm naxatw-text-gray-700">
                      No tasks on the processing server.
                    </p>
                    <p className="naxatw-text-xs naxatw-text-gray-500">
                      Refresh this panel to check for queue changes.
                    </p>
                  </div>
                ) : (
                  <div className="naxatw-flex naxatw-flex-col naxatw-gap-4">
                    {queueInfo.groups.map((group: OdmStatusGroup) => {
                      const groupStyles: Record<
                        number,
                        { bg: string; text: string; headerBg: string; icon?: string }
                      > = {
                        20: {
                          bg: "naxatw-bg-purple-50",
                          text: "naxatw-text-purple-800",
                          headerBg: "naxatw-bg-purple-100",
                          icon: "sync",
                        },
                        10: {
                          bg: "naxatw-bg-yellow-50",
                          text: "naxatw-text-yellow-800",
                          headerBg: "naxatw-bg-yellow-100",
                          icon: "schedule",
                        },
                        30: {
                          bg: "naxatw-bg-red-50",
                          text: "naxatw-text-red-800",
                          headerBg: "naxatw-bg-red-100",
                          icon: "error_outline",
                        },
                        40: {
                          bg: "naxatw-bg-green-50",
                          text: "naxatw-text-green-800",
                          headerBg: "naxatw-bg-green-100",
                          icon: "check_circle",
                        },
                        50: {
                          bg: "naxatw-bg-gray-50",
                          text: "naxatw-text-gray-600",
                          headerBg: "naxatw-bg-gray-100",
                          icon: "cancel",
                        },
                      };
                      const style = groupStyles[group.status_code] || {
                        bg: "naxatw-bg-gray-50",
                        text: "naxatw-text-gray-700",
                        headerBg: "naxatw-bg-gray-100",
                      };

                      return (
                        <div
                          key={group.status_code}
                          className={`naxatw-overflow-hidden naxatw-rounded-lg naxatw-border naxatw-border-gray-200 ${style.bg}`}
                        >
                          <div
                            className={`naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-px-3 naxatw-py-2 ${style.headerBg}`}
                          >
                            {style.icon && (
                              <Icon
                                name={style.icon}
                                className={`!naxatw-text-base ${style.text} ${group.status_code === 20 ? "naxatw-animate-spin" : ""}`}
                              />
                            )}
                            <span className={`naxatw-text-sm naxatw-font-semibold ${style.text}`}>
                              {group.status_label}
                            </span>
                            <span
                              className={`naxatw-rounded-full naxatw-px-2 naxatw-py-0.5 naxatw-text-xs naxatw-font-medium ${style.headerBg} ${style.text}`}
                            >
                              {group.count}
                            </span>
                          </div>
                          <table className="naxatw-w-full naxatw-text-sm">
                            <thead>
                              <tr className="naxatw-border-b naxatw-border-gray-200">
                                <th className="naxatw-px-3 naxatw-py-1.5 naxatw-text-left naxatw-text-xs naxatw-font-medium naxatw-text-gray-500">
                                  #
                                </th>
                                <th className="naxatw-px-3 naxatw-py-1.5 naxatw-text-left naxatw-text-xs naxatw-font-medium naxatw-text-gray-500">
                                  Name
                                </th>
                                <th className="naxatw-px-3 naxatw-py-1.5 naxatw-text-left naxatw-text-xs naxatw-font-medium naxatw-text-gray-500">
                                  Images
                                </th>
                                <th className="naxatw-px-3 naxatw-py-1.5 naxatw-text-right naxatw-text-xs naxatw-font-medium naxatw-text-gray-500">
                                  {group.status_code === 20 ? "Progress" : "Time"}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.tasks.map((task: OdmQueueTask, index: number) => (
                                <tr
                                  key={task.uuid}
                                  className="naxatw-border-b naxatw-border-gray-100 last:naxatw-border-0"
                                >
                                  <td className="naxatw-px-3 naxatw-py-2 naxatw-text-gray-500">
                                    {index + 1}
                                  </td>
                                  <td className="naxatw-max-w-[220px] naxatw-truncate naxatw-px-3 naxatw-py-2 naxatw-font-medium naxatw-text-gray-900">
                                    {task.task_index != null
                                      ? `Task ${task.task_index}`
                                      : task.name || task.uuid.slice(0, 8)}
                                  </td>
                                  <td className="naxatw-px-3 naxatw-py-2 naxatw-text-gray-600">
                                    {task.images_count ?? "-"}
                                  </td>
                                  <td className="naxatw-px-3 naxatw-py-2 naxatw-text-right naxatw-text-gray-600">
                                    {group.status_code === 20 && task.progress != null
                                      ? `${Math.round(task.progress)}%`
                                      : task.processing_time != null
                                        ? `${Math.round(task.processing_time / 1000)}s`
                                        : "-"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="naxatw-border-t naxatw-border-gray-200 naxatw-bg-gray-50 naxatw-px-5 naxatw-py-3">
                {queueInfo?.queue_position != null ? (
                  <p className="naxatw-text-sm naxatw-font-medium naxatw-text-blue-800">
                    Your project is approximately #{queueInfo.queue_position} in the queue.
                  </p>
                ) : (
                  <p className="naxatw-text-sm naxatw-text-gray-500">
                    Queue position will appear here when this project has an active ODM job.
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default ProcessingStatusDialog;
