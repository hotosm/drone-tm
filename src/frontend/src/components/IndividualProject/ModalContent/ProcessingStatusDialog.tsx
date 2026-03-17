import { useCallback, useEffect, useMemo, useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useGetProjectsDetailQuery } from '@Api/projects';
import { useGetAllTaskAssetsInfo } from '@Api/tasks';
import { postProcessImagery } from '@Services/tasks';
import { processAllImagery } from '@Services/project';
import { getProjectTaskImagerySummary, TaskImagerySummary } from '@Services/classification';
import { formatString } from '@Utils/index';
import { Button } from '@Components/RadixComponents/Button';
import Icon from '@Components/common/Icon';
import { toggleModal } from '@Store/actions/common';
import { setProjectState } from '@Store/actions/project';

const stateColors: Record<string, string> = {
  IMAGE_UPLOADED: '#9ec7ff',
  IMAGE_PROCESSING_STARTED: '#9C77B2',
  IMAGE_PROCESSING_FINISHED: '#ACD2C4',
  IMAGE_PROCESSING_FAILED: '#f00000',
  LOCKED_FOR_MAPPING: '#98BBC8',
  UNFLYABLE_TASK: '#9EA5AD',
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

const ProcessingStatusDialog = () => {
  const { pathname } = useLocation();
  const projectId = useMemo(() => {
    const projectMatch = matchPath('/projects/:id', pathname);
    const approvalMatch = matchPath('/projects/:id/approval', pathname);
    return projectMatch?.params.id || approvalMatch?.params.id || '';
  }, [pathname]);
  const dispatch = useDispatch();
  const queryClient = useQueryClient();

  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [processingTasks, setProcessingTasks] = useState<Set<string>>(
    new Set(),
  );

  // allTaskAssets: S3-based data (assets_url, image_count from disk, state)
  const { data: allTaskAssets } = useGetAllTaskAssetsInfo(projectId);
  const { data: projectDetail } = useGetProjectsDetailQuery(projectId) as {
    data?: ProcessingDialogProjectDetail;
  };

  // Backend summary: authoritative source for has_ready_imagery
  const { data: taskSummary } = useQuery<TaskImagerySummary[]>({
    queryKey: ['projectTaskImagerySummary', projectId],
    queryFn: () => getProjectTaskImagerySummary(projectId),
    enabled: !!projectId,
    refetchInterval: 30000,
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

  const { mutateAsync: processTask } = useMutation({
    mutationFn: ({ taskId }: { taskId: string }) =>
      postProcessImagery(projectId, taskId),
  });

  const { mutate: startAllImageProcessing, isPending: isProcessingAll } =
    useMutation({
      mutationFn: processAllImagery,
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['project-detail'] });
        queryClient.invalidateQueries({
          queryKey: ['all-task-assets-info', projectId],
        });
        queryClient.invalidateQueries({
          queryKey: ['projectTaskImagerySummary', projectId],
        });
        toast.success('Final processing started');
      },
    });

  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTasks(prev => {
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
    const results = await Promise.allSettled(
      taskIds.map(taskId => processTask({ taskId })),
    );
    let successCount = 0;
    let failCount = 0;
    results.forEach(result => {
      if (result.status === 'fulfilled') successCount++;
      else failCount++;
    });
    if (successCount > 0) {
      toast.success(`Processing started for ${successCount} task(s)`);
    }
    if (failCount > 0) {
      toast.error(`Failed to start processing for ${failCount} task(s)`);
    }
    const failedTaskIds = taskIds.filter(
      (_taskId, index) => results[index].status === 'rejected',
    );
    if (failedTaskIds.length > 0) {
      setProcessingTasks((prev) => {
        const next = new Set(prev);
        failedTaskIds.forEach((taskId) => next.delete(taskId));
        return next;
      });
    }
    queryClient.invalidateQueries({
      queryKey: ['all-task-assets-info', projectId],
    });
    queryClient.invalidateQueries({
      queryKey: ['projectTaskImagerySummary', projectId],
    });
  }, [selectedTasks, processTask, queryClient, projectId]);

  const handleProcessSingle = useCallback(
    async (taskId: string) => {
      setProcessingTasks(prev => new Set(prev).add(taskId));
      try {
        await processTask({ taskId });
        toast.success(`Task processing started`);
        queryClient.invalidateQueries({
          queryKey: ['all-task-assets-info', projectId],
        });
        queryClient.invalidateQueries({
          queryKey: ['projectTaskImagerySummary', projectId],
        });
      } catch {
        toast.error('Failed to start processing');
        setProcessingTasks(prev => {
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
      const link = document.createElement('a');
      link.href = assetsUrl;
      link.setAttribute('download', '');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error(`Download failed: ${error}`);
    }
  }, []);

  const handleStartFinalProcessing = useCallback(
    (withGcp: boolean) => {
      if (withGcp) {
        dispatch(setProjectState({ showGcpEditor: true }));
        dispatch(toggleModal());
      } else {
        startAllImageProcessing({ projectId });
        dispatch(toggleModal());
      }
    },
    [dispatch, startAllImageProcessing, projectId],
  );

  const totalTaskCount = useMemo(() => {
    if (typeof projectDetail?.total_task_count === 'number') {
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
            task.task_state === 'IMAGE_UPLOADED' ||
            task.task_state === 'IMAGE_PROCESSING_STARTED' ||
            task.task_state === 'IMAGE_PROCESSING_FINISHED' ||
            task.task_state === 'IMAGE_PROCESSING_FAILED',
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
          t.state === 'IMAGE_UPLOADED' ||
          t.state === 'IMAGE_PROCESSING_STARTED' ||
          t.state === 'IMAGE_PROCESSING_FINISHED' ||
          t.state === 'IMAGE_PROCESSING_FAILED',
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
        if (next.has(task.task_id) && task.state !== 'IMAGE_UPLOADED') {
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
      setSelectedTasks(
        new Set(processableTasks.map((task) => task.task_id)),
      );
    }
  }, [selectedTasks, processableTasks]);

  const processedCount = useMemo(
    () =>
      taskList.filter(
        (t: any) => t.state === 'IMAGE_PROCESSING_FINISHED',
      ).length,
    [taskList],
  );

  const allTasksProcessed = useMemo(
    () =>
      totalTaskCount > 0 &&
      Array.isArray(taskSummary) &&
      taskSummary.length === totalTaskCount &&
      taskSummary.every(
        (task) => task.task_state === 'IMAGE_PROCESSING_FINISHED',
      ),
    [taskSummary, totalTaskCount],
  );

  const finalProcessingDisabledReason = useMemo(() => {
    if (isProcessingAll) {
      return 'Final processing is already starting.';
    }
    if (!totalTaskCount) {
      return 'No project tasks are available yet.';
    }
    if (!Array.isArray(taskSummary) || taskSummary.length < totalTaskCount) {
      return 'Every task must have imagery and finish quick processing first.';
    }
    if (!allTasksProcessed) {
      return 'All tasks must reach Complete before final processing can start.';
    }
    return '';
  }, [isProcessingAll, totalTaskCount, taskSummary, allTasksProcessed]);

  const hasSavedGcp = Boolean(projectDetail?.has_gcp);

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-4">
      {/* Per-task processing section */}
      <div>
        <h3 className="naxatw-text-sm naxatw-font-semibold naxatw-text-gray-800">
          Task Processing (Quick Orthophoto)
        </h3>
        <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-gray-500">
          Processes images for each task individually to produce a quick
          preview orthophoto.
        </p>
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
                    processableTasks.length > 0 &&
                    selectedTasks.size === processableTasks.length
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
                task.state !== 'IMAGE_PROCESSING_STARTED';
              const isTaskProcessing =
                processingTasks.has(task.task_id) ||
                task.state === 'IMAGE_PROCESSING_STARTED';
              const displayState = isTaskProcessing
                ? 'IMAGE_PROCESSING_STARTED'
                : task.state;
              const stateColor =
                stateColors[displayState] || '#e5e7eb';

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
                            displayState === 'IMAGE_PROCESSING_FINISHED'
                              ? '#166534'
                              : displayState === 'IMAGE_PROCESSING_FAILED'
                                ? '#991b1b'
                                : '#374151',
                        }}
                      >
                        {isTaskProcessing && (
                          <Icon
                            name="sync"
                            className="naxatw-animate-spin !naxatw-text-sm"
                          />
                        )}
                        {displayState === 'IMAGE_PROCESSING_FINISHED' && '✓ '}
                        {formatString(displayState) || 'No images'}
                      </span>
                      {task.state === 'IMAGE_PROCESSING_FAILED' && task.failure_reason && (
                        <p className="naxatw-max-w-[320px] naxatw-text-xs naxatw-text-red-700">
                          {task.failure_reason}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="naxatw-px-3 naxatw-py-2 naxatw-text-right">
                    {isTaskProcessing ? (
                      <Icon
                        name="sync"
                        className="naxatw-animate-spin !naxatw-text-lg naxatw-text-gray-500"
                      />
                    ) : task.state === 'IMAGE_PROCESSING_FINISHED' &&
                      task.assets_url ? (
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
                    ) : canProcess ? (
                      <Button
                        variant="ghost"
                        className="naxatw-h-7 naxatw-bg-red naxatw-px-2 naxatw-text-xs naxatw-text-white hover:naxatw-bg-red/90"
                        leftIcon={
                          task.state === 'IMAGE_PROCESSING_FAILED'
                            ? 'replay'
                            : 'play_arrow'
                        }
                        iconClassname="!naxatw-text-sm"
                        onClick={() => handleProcessSingle(task.task_id)}
                      >
                        {task.state === 'IMAGE_PROCESSING_FAILED'
                          ? 'Retry'
                          : 'Process'}
                      </Button>
                    ) : null}
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
            onClick={handleProcessSelected}
            disabled={selectedTasks.size === 0}
          >
            Process Selected ({selectedTasks.size})
          </Button>
        </div>
      )}

      {/* Status summary */}
      <p className="naxatw-text-center naxatw-text-xs naxatw-text-gray-500">
        {processedCount}/{taskList.length} tasks processed
        {taskList.length < totalTaskCount && (
          <span className="naxatw-ml-1">
            ({totalTaskCount - taskList.length} tasks awaiting imagery)
          </span>
        )}
      </p>

      {taskList.length === 0 && (
        <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-2 naxatw-py-6 naxatw-text-gray-500">
          <span className="material-icons naxatw-text-4xl naxatw-text-gray-300">
            image_search
          </span>
          <p className="naxatw-text-sm">
            No tasks are ready for processing yet.
          </p>
          <p className="naxatw-text-xs">
            Upload imagery and mark tasks as fully flown in the Verify Imagery step first.
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
          Stitches all task images together into a single high-quality
          orthophoto and 3D model. This takes longer.
        </p>
      </div>

      <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-3">
        <div
          className={`naxatw-w-full naxatw-max-w-xl naxatw-rounded-lg naxatw-border naxatw-px-4 naxatw-py-3 naxatw-text-sm ${
            hasSavedGcp
              ? 'naxatw-border-green-200 naxatw-bg-green-50 naxatw-text-green-800'
              : 'naxatw-border-gray-200 naxatw-bg-gray-50 naxatw-text-gray-700'
          }`}
        >
          <div className="naxatw-flex naxatw-items-start naxatw-gap-2">
            <span className="material-icons !naxatw-text-base">
              {hasSavedGcp ? 'check_circle' : 'pin_drop'}
            </span>
            <div>
              <p className="naxatw-font-medium">
                {hasSavedGcp ? 'GCP points have been saved for this project.' : 'No saved GCP points yet.'}
              </p>
              <p className="naxatw-mt-1 naxatw-text-xs">
                {hasSavedGcp
                  ? 'Start Final Processing will automatically include the saved GCP file.'
                  : 'Use With GCP to add control points before starting final processing.'}
              </p>
            </div>
          </div>
        </div>

        {finalProcessingDisabledReason && (
          <p className="naxatw-text-center naxatw-text-xs naxatw-text-amber-700">
            {finalProcessingDisabledReason}
          </p>
        )}

        <div className="naxatw-flex naxatw-gap-2">
          <Button
            variant="ghost"
            className="naxatw-bg-red naxatw-text-white disabled:naxatw-bg-gray-400"
            leftIcon="play_arrow"
            onClick={() => handleStartFinalProcessing(false)}
            disabled={Boolean(finalProcessingDisabledReason)}
          >
            Start Final Processing
          </Button>
          <Button
            variant="outline"
            className="naxatw-border-red naxatw-text-red disabled:naxatw-border-gray-300 disabled:naxatw-text-gray-400"
            leftIcon="pin_drop"
            onClick={() => handleStartFinalProcessing(true)}
            disabled={Boolean(finalProcessingDisabledReason)}
          >
            {hasSavedGcp ? 'Edit GCP' : 'Add GCP'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProcessingStatusDialog;
