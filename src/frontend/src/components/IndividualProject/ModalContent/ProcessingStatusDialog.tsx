import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { matchPath, useLocation } from "react-router-dom";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetProjectsDetailQuery } from "@Api/projects";
import { useGetAllTaskAssetsInfo } from "@Api/tasks";
import { postProcessImagery } from "@Services/tasks";
import { processAllImagery, saveGcpFile } from "@Services/project";
import {
  getProjectTaskImagerySummary,
  getProjectCoverage,
  TaskImagerySummary,
  ProjectCoverage,
} from "@Services/classification";
import { formatString, buildDownloadUrl } from "@Utils/index";
import { Button } from "@Components/RadixComponents/Button";
import Icon from "@Components/common/Icon";
import { toggleModal } from "@Store/actions/common";
import { setProjectState } from "@Store/actions/project";
import { m } from "@/paraglide/messages";

// Lazy-loaded so the ~150KB OpenLayers chunk only ships when a user
// actually clicks View on a finished task.
const TaskOrthoCogViewer = lazy(() => import("./TaskOrthoCogViewer"));

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
  orthophoto_url?: string | null;
};

type ProcessingDialogProjectDetail = {
  total_task_count?: number;
  has_gcp?: boolean;
  image_processing_status?: string;
  orthophoto_url?: string | null;
  dsm_url?: string | null;
  dtm_url?: string | null;
  pointcloud_url?: string | null;
  assets_url?: string | null;
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
  // When non-null, render the OL COG viewer overlay for this task's
  // signed orthophoto URL. Cleared by clicking the close button, the
  // backdrop, or pressing Escape (handled inside the viewer).
  const [viewerTask, setViewerTask] = useState<{
    url: string;
    title: string;
  } | null>(null);

  // allTaskAssets: S3-based data (assets_url, image_count from disk, state)
  const { data: projectDetail } = useGetProjectsDetailQuery(projectRouteId) as {
    data?: ProcessingDialogProjectDetail;
  };
  const projectId = (projectDetail as any)?.id || projectRouteId;
  const isProjectProcessing = projectDetail?.image_processing_status === "PROCESSING";
  const {
    data: allTaskAssets,
    refetch: refetchAllTaskAssets,
    isFetching: isAllTasksFetching,
  } = useGetAllTaskAssetsInfo(projectId);

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

  // Spatial coverage: actual PostGIS-computed percentage of project area covered
  const {
    data: projectCoverage,
    refetch: refetchCoverage,
    isFetching: isCoverageFetching,
  } = useQuery<ProjectCoverage>({
    queryKey: ["projectCoverage", projectId],
    queryFn: () => getProjectCoverage(projectId),
    enabled: !!projectId,
  });

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

  // Pending-transfer lookup - used to gate re-runs of FINISHED/FAILED tasks.
  // For re-processing, the imagery is already in the task folder; only an
  // in-flight staging→task move should block, matching the backend check at
  // POST /process_imagery/{project_id}/{task_id}/.
  const pendingTransferMap = useMemo(() => {
    const map = new Map<string, boolean>();
    if (taskSummary) {
      for (const t of taskSummary) {
        map.set(t.task_id, t.imagery_transfer_pending === true);
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
      toast.success(m.processing_dialog_final_started_success());
    },
    onError: (error) => {
      const detail =
        axios.isAxiosError(error) &&
        typeof error.response?.data?.detail === "string" &&
        error.response.data.detail
          ? error.response.data.detail
          : m.processing_dialog_final_start_failed();
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
      toast.success(m.processing_dialog_started_count_success({ count: successCount }));
    }
    if (failCount > 0) {
      toast.error(m.processing_dialog_start_failed_count({ count: failCount }));
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
        toast.success(m.processing_dialog_task_processing_started());
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
            : m.processing_dialog_processing_start_failed();
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
      toast.error(m.processing_dialog_download_failed({ error: String(error) }));
    }
  }, []);

  const handleDownloadOrtho = useCallback((assetsUrl: string) => {
    try {
      const orthoUrl = assetsUrl.replace(/\/$/, "/orthophoto/");
      const link = document.createElement("a");
      link.href = buildDownloadUrl(orthoUrl);
      link.setAttribute("download", "");
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error(m.processing_dialog_download_failed({ error: String(error) }));
    }
  }, []);

  const handleDownloadProjectFile = useCallback((url: string, filename: string) => {
    try {
      const link = document.createElement("a");
      link.href = buildDownloadUrl(url);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error(m.processing_dialog_download_failed({ error: String(error) }));
    }
  }, []);

  const getProcessButtonLabel = useCallback((task: ProcessingDialogTask) => {
    if (task.state === "IMAGE_PROCESSING_FAILED") {
      return m.processing_dialog_button_retry();
    }
    if (task.state === "IMAGE_PROCESSING_FINISHED") {
      return m.processing_dialog_button_rerun();
    }
    return m.processing_dialog_button_process();
  }, []);

  const handleStartFinalProcessing = useCallback(
    (withGcp: boolean, capacityType?: string) => {
      if (withGcp) {
        dispatch(setProjectState({ showGcpEditor: true }));
        dispatch(toggleModal());
      } else {
        startAllImageProcessing({ projectId, capacityType });
      }
    },
    [dispatch, startAllImageProcessing, projectId],
  );

  const gcpFileInputRef = useRef<HTMLInputElement>(null);

  const { mutate: uploadGcpFile, isPending: isUploadingGcp } = useMutation({
    mutationFn: saveGcpFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-detail"] });
      toast.success(m.processing_dialog_gcp_uploaded());
    },
    onError: () => {
      toast.error(m.processing_dialog_gcp_upload_failed());
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

  const handleRefreshProcessingStatus = useCallback(async () => {
    if (!projectId) return;

    await Promise.allSettled([
      refetchTaskSummary(),
      refetchCoverage(),
      refetchAllTaskAssets(),
      queryClient.invalidateQueries({ queryKey: ["project-detail", projectId] }),
    ]);
  }, [projectId, queryClient, refetchAllTaskAssets, refetchCoverage, refetchTaskSummary]);

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
            orthophoto_url: assetInfo?.orthophoto_url,
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
        orthophoto_url: task.orthophoto_url,
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

  const coveragePercentage = projectCoverage?.coverage_percentage ?? 0;

  const tasksReady = useMemo(() => {
    if (!Array.isArray(taskSummary)) return 0;
    return taskSummary.filter((t) => t.has_ready_imagery).length;
  }, [taskSummary]);

  const tasksWithImagery = useMemo(() => {
    if (!Array.isArray(taskSummary)) return 0;
    return taskSummary.filter((t) => t.task_state === "HAS_IMAGERY" && t.assigned_images > 0)
      .length;
  }, [taskSummary]);

  const totalProcessable = tasksReady + tasksWithImagery;

  const isFinalProcessingRunning = isProjectProcessing || isProcessingAll;

  const finalProcessingDisabledReason = useMemo(() => {
    if (isFinalProcessingRunning) {
      return m.processing_dialog_already_in_progress();
    }
    if (!totalTaskCount) {
      return m.processing_dialog_no_tasks_available();
    }
    if (totalProcessable === 0) {
      return m.processing_dialog_no_imagery_available();
    }
    return "";
  }, [isFinalProcessingRunning, totalTaskCount, totalProcessable]);

  const hasSavedGcp = Boolean(projectDetail?.has_gcp);

  return (
    <>
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-4">
        {/* Per-task processing section */}
        <div className="naxatw-flex naxatw-items-start naxatw-justify-between naxatw-gap-3">
          <div>
            <h3 className="naxatw-text-sm naxatw-font-semibold naxatw-text-gray-800">
              {m.processing_dialog_task_processing_title()}
            </h3>
            <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-gray-500">
              {m.processing_dialog_task_processing_desc()}
            </p>
          </div>
          <a
            href="https://processing.drone.hotosm.org"
            target="_blank"
            rel="noopener noreferrer"
            className="naxatw-shrink-0 naxatw-text-xs naxatw-font-semibold naxatw-text-blue-700 naxatw-underline-offset-2 hover:naxatw-underline"
          >
            {m.processing_dialog_view_queue()}
          </a>
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
                  {m.processing_dialog_table_task()}
                </th>
                <th className="naxatw-px-3 naxatw-py-2 naxatw-text-left naxatw-font-medium naxatw-text-gray-600">
                  {m.processing_dialog_table_images()}
                </th>
                <th className="naxatw-px-3 naxatw-py-2 naxatw-text-left naxatw-font-medium naxatw-text-gray-600">
                  {m.processing_dialog_table_status()}
                </th>
                <th className="naxatw-px-3 naxatw-py-2 naxatw-text-right naxatw-font-medium naxatw-text-gray-600">
                  {m.processing_dialog_table_action()}
                </th>
              </tr>
            </thead>
            <tbody>
              {taskList.map((task, index: number) => {
                const isReprocess =
                  task.state === "IMAGE_PROCESSING_FINISHED" ||
                  task.state === "IMAGE_PROCESSING_FAILED";
                const canProcess =
                  (isReprocess
                    ? pendingTransferMap.get(task.task_id) !== true
                    : readinessMap.get(task.task_id) === true) &&
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
                      {m.processing_dialog_task_row_label({
                        index: task.task_index ?? index + 1,
                      })}
                    </td>
                    <td className="naxatw-px-3 naxatw-py-2 naxatw-text-gray-600">
                      {m.processing_dialog_images_count({ count: task.image_count })}
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
                          {formatString(displayState) || m.processing_dialog_no_images_state()}
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
                            <>
                              {task.orthophoto_url ? (
                                <button
                                  type="button"
                                  title={m.processing_dialog_view_orthophoto_title()}
                                  className="naxatw-flex naxatw-h-7 naxatw-w-7 naxatw-items-center naxatw-justify-center naxatw-rounded naxatw-text-emerald-600 hover:naxatw-bg-emerald-50"
                                  onClick={() => {
                                    setViewerTask({
                                      url: task.orthophoto_url!,
                                      title: `Task ${task.task_index} orthophoto`,
                                    });
                                  }}
                                >
                                  <Icon name="visibility" className="!naxatw-text-base" />
                                </button>
                              ) : null}
                              <button
                                type="button"
                                title={m.processing_dialog_download_orthophoto_title()}
                                className="naxatw-flex naxatw-h-7 naxatw-w-7 naxatw-items-center naxatw-justify-center naxatw-rounded naxatw-text-blue-600 hover:naxatw-bg-blue-50"
                                onClick={() => {
                                  if (task.assets_url) {
                                    handleDownloadOrtho(task.assets_url);
                                  }
                                }}
                              >
                                <Icon name="download" className="!naxatw-text-base" />
                              </button>
                              <button
                                type="button"
                                title={m.processing_dialog_download_assets_title()}
                                className="naxatw-flex naxatw-h-7 naxatw-w-7 naxatw-items-center naxatw-justify-center naxatw-rounded naxatw-text-gray-400 hover:naxatw-bg-gray-100"
                                onClick={() => {
                                  if (task.assets_url) {
                                    handleDownloadAssets(task.assets_url);
                                  }
                                }}
                              >
                                <Icon name="folder_zip" className="!naxatw-text-base" />
                              </button>
                            </>
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
                                if (
                                  isReprocess &&
                                  !window.confirm(m.processing_dialog_reprocess_confirm())
                                ) {
                                  return;
                                }
                                if (e.ctrlKey || e.metaKey) {
                                  const odmUrl = window.prompt(
                                    m.processing_dialog_scaleodm_prompt(),
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
                    m.processing_dialog_process_selected_confirm({ count: selectedTasks.size }),
                  )
                ) {
                  return;
                }
                handleProcessSelected();
              }}
              disabled={selectedTasks.size === 0}
            >
              {m.processing_dialog_process_selected({ count: selectedTasks.size })}
            </Button>
          </div>
        )}

        {/* Status summary */}
        <div className="naxatw-flex naxatw-items-center naxatw-justify-center naxatw-gap-2">
          <p className="naxatw-text-center naxatw-text-xs naxatw-text-gray-500">
            {m.processing_dialog_tasks_processed({
              processed: processedCount,
              total: taskList.length,
            })}
            {taskList.length < totalTaskCount && (
              <span className="naxatw-ml-1">
                {m.processing_dialog_tasks_awaiting_imagery({
                  count: totalTaskCount - taskList.length,
                })}
              </span>
            )}
          </p>
          <Button
            variant="outline"
            className="naxatw-h-8 naxatw-shrink-0 naxatw-border-blue-300 naxatw-px-3 naxatw-text-xs naxatw-text-blue-700"
            leftIcon="refresh"
            iconClassname={`!naxatw-text-sm ${isTaskSummaryFetching || isCoverageFetching || isAllTasksFetching ? "naxatw-animate-spin" : ""}`}
            onClick={handleRefreshProcessingStatus}
            disabled={isTaskSummaryFetching || isCoverageFetching || isAllTasksFetching}
          >
            {m.common_refresh()}
          </Button>
        </div>

        {taskList.length === 0 && (
          <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-2 naxatw-py-6 naxatw-text-gray-500">
            <span className="material-icons naxatw-text-4xl naxatw-text-gray-300">
              image_search
            </span>
            <p className="naxatw-text-sm">{m.processing_dialog_no_tasks_ready_title()}</p>
            <p className="naxatw-text-xs">{m.processing_dialog_no_tasks_ready_help()}</p>
          </div>
        )}

        {/* Divider */}
        <hr className="naxatw-border-gray-200" />

        {/* Final Processing section */}
        <div>
          <h3 className="naxatw-text-sm naxatw-font-semibold naxatw-text-gray-800">
            {m.processing_dialog_final_processing_title()}
          </h3>
          <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-gray-500">
            {m.processing_dialog_final_processing_desc()}
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
                  {hasSavedGcp
                    ? m.processing_dialog_gcp_saved()
                    : m.processing_dialog_gcp_not_yet()}
                </p>
                <p className="naxatw-mt-1 naxatw-text-xs naxatw-opacity-80">
                  {hasSavedGcp
                    ? m.processing_dialog_gcp_saved_help()
                    : m.processing_dialog_gcp_not_yet_help()}
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
                {hasSavedGcp ? m.processing_dialog_edit_gcp() : m.processing_dialog_gcp_editor()}
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
                  ? m.common_uploading()
                  : hasSavedGcp
                    ? m.processing_dialog_replace_gcp_txt()
                    : m.processing_dialog_upload_gcp_txt()}
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
          {!finalProcessingDisabledReason && !allTasksProcessed && (
            <div
              className={`naxatw-w-full naxatw-rounded-lg naxatw-border naxatw-px-4 naxatw-py-3 naxatw-text-xs ${
                coveragePercentage < 90
                  ? "naxatw-border-amber-200 naxatw-bg-amber-50 naxatw-text-amber-800"
                  : "naxatw-border-blue-200 naxatw-bg-blue-50 naxatw-text-blue-800"
              }`}
            >
              <p className="naxatw-font-semibold">
                {m.processing_dialog_coverage_percentage({
                  percentage: coveragePercentage,
                })}
                {isCoverageFetching && ` ${m.processing_dialog_coverage_calculating()}`}
              </p>
              <p className="naxatw-mt-0.5">
                {m.processing_dialog_tasks_ready_for_processing({
                  ready: tasksReady,
                  total: totalTaskCount,
                })}
              </p>
              {coveragePercentage < 90 && (
                <p className="naxatw-mt-1">{m.processing_dialog_coverage_below_warning()}</p>
              )}
            </div>
          )}
          {isFinalProcessingRunning && (
            <div className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-text-sm naxatw-text-gray-600">
              <Icon name="sync" className="naxatw-animate-spin !naxatw-text-base" />
              <span>
                {isProcessingAll
                  ? m.processing_dialog_final_submitting()
                  : m.processing_dialog_final_in_progress()}
              </span>
            </div>
          )}
          <Button
            variant="ghost"
            className="naxatw-bg-red naxatw-px-8 naxatw-py-2 naxatw-text-white disabled:naxatw-bg-gray-400"
            leftIcon={isFinalProcessingRunning ? "sync" : "play_arrow"}
            iconClassname={isFinalProcessingRunning ? "naxatw-animate-spin" : ""}
            onClick={(e) => {
              const onDemand = e.ctrlKey || e.metaKey;
              let confirmMessage: string = m.processing_dialog_final_confirm_intro({
                processable: totalProcessable,
                total: totalTaskCount,
              });

              if (tasksWithImagery > 0) {
                confirmMessage += m.processing_dialog_final_confirm_unverified({
                  count: tasksWithImagery,
                });
              }

              if (!allTasksProcessed && coveragePercentage < 90) {
                confirmMessage += m.processing_dialog_final_confirm_coverage_warning({
                  percentage: coveragePercentage,
                });
              }

              if (onDemand) {
                confirmMessage += m.processing_dialog_final_confirm_ondemand();
              }

              confirmMessage += m.processing_dialog_final_confirm_proceed();

              if (!window.confirm(confirmMessage)) return;
              handleStartFinalProcessing(false, onDemand ? "on-demand" : undefined);
            }}
            disabled={
              Boolean(finalProcessingDisabledReason) ||
              isFinalProcessingRunning ||
              isTaskSummaryFetching ||
              isCoverageFetching
            }
          >
            {isFinalProcessingRunning
              ? m.common_processing_ellipsis()
              : isTaskSummaryFetching || isCoverageFetching
                ? m.common_refreshing()
                : m.processing_dialog_start_final_processing()}
          </Button>
        </div>

        {/* Final processing results - shown once processing is complete */}
        {projectDetail?.image_processing_status === "SUCCESS" && (
          <>
            <hr className="naxatw-border-gray-200" />
            <div>
              <h3 className="naxatw-text-sm naxatw-font-semibold naxatw-text-gray-800">
                {m.processing_dialog_final_results_title()}
              </h3>
              <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-gray-500">
                {m.processing_dialog_final_results_desc()}
              </p>
            </div>
            <div className="naxatw-flex naxatw-flex-wrap naxatw-gap-2">
              {projectDetail.orthophoto_url && (
                <Button
                  variant="outline"
                  className="naxatw-h-8 naxatw-border-blue-300 naxatw-px-3 naxatw-text-xs naxatw-text-blue-700"
                  leftIcon="download"
                  iconClassname="!naxatw-text-sm"
                  onClick={() =>
                    handleDownloadProjectFile(
                      projectDetail.orthophoto_url!,
                      `orthophoto_${projectId}.tif`,
                    )
                  }
                >
                  {m.processing_dialog_orthophoto_tif()}
                </Button>
              )}
              {projectDetail.dsm_url && (
                <Button
                  variant="outline"
                  className="naxatw-h-8 naxatw-border-blue-300 naxatw-px-3 naxatw-text-xs naxatw-text-blue-700"
                  leftIcon="download"
                  iconClassname="!naxatw-text-sm"
                  onClick={() =>
                    handleDownloadProjectFile(projectDetail.dsm_url!, `dsm_${projectId}.tif`)
                  }
                >
                  {m.processing_dialog_dsm_tif()}
                </Button>
              )}
              {projectDetail.dtm_url && (
                <Button
                  variant="outline"
                  className="naxatw-h-8 naxatw-border-blue-300 naxatw-px-3 naxatw-text-xs naxatw-text-blue-700"
                  leftIcon="download"
                  iconClassname="!naxatw-text-sm"
                  onClick={() =>
                    handleDownloadProjectFile(projectDetail.dtm_url!, `dtm_${projectId}.tif`)
                  }
                >
                  {m.processing_dialog_dtm_tif()}
                </Button>
              )}
              {projectDetail.pointcloud_url && (
                <Button
                  variant="outline"
                  className="naxatw-h-8 naxatw-border-blue-300 naxatw-px-3 naxatw-text-xs naxatw-text-blue-700"
                  leftIcon="download"
                  iconClassname="!naxatw-text-sm"
                  onClick={() =>
                    handleDownloadProjectFile(
                      projectDetail.pointcloud_url!,
                      `pointcloud_${projectId}.laz`,
                    )
                  }
                >
                  {m.processing_dialog_pointcloud_laz()}
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {viewerTask ? (
        <Suspense fallback={null}>
          <TaskOrthoCogViewer
            signedUrl={viewerTask.url}
            title={viewerTask.title}
            onClose={() => setViewerTask(null)}
          />
        </Suspense>
      ) : null}
    </>
  );
};

export default ProcessingStatusDialog;
