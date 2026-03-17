import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

const ProcessingStatusDialog = () => {
  const { id } = useParams();
  const projectId = id as string;
  const dispatch = useDispatch();
  const queryClient = useQueryClient();

  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [processingTasks, setProcessingTasks] = useState<Set<string>>(
    new Set(),
  );

  // allTaskAssets: S3-based data (assets_url, image_count from disk, state)
  const { data: allTaskAssets } = useGetAllTaskAssetsInfo(projectId);

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

  const processableTasks = useMemo(
    () =>
      Array.isArray(allTaskAssets)
        ? allTaskAssets.filter((t: any) =>
            readinessMap.get(t.task_id) === true,
          )
        : [],
    [allTaskAssets, readinessMap],
  );

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

  const toggleSelectAll = useCallback(() => {
    if (selectedTasks.size === processableTasks.length) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(
        new Set(processableTasks.map((t: any) => t.task_id)),
      );
    }
  }, [selectedTasks, processableTasks]);

  const handleProcessSelected = useCallback(async () => {
    const taskIds = Array.from(selectedTasks);
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
    setSelectedTasks(new Set());
    queryClient.invalidateQueries({
      queryKey: ['all-task-assets-info', projectId],
    });
    queryClient.invalidateQueries({
      queryKey: ['projectTaskImagerySummary', projectId],
    });
    setProcessingTasks(new Set());
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
      }
      setProcessingTasks(prev => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
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

  const totalTaskCount = useMemo(
    () => (Array.isArray(allTaskAssets) ? allTaskAssets.length : 0),
    [allTaskAssets],
  );

  const taskList = useMemo(() => {
    if (!Array.isArray(allTaskAssets)) return [];
    // Only show tasks that have images or are in a processing/uploaded state
    return [...allTaskAssets]
      .filter(
        (t: any) =>
          t.image_count > 0 ||
          t.state === 'IMAGE_UPLOADED' ||
          t.state === 'IMAGE_PROCESSING_STARTED' ||
          t.state === 'IMAGE_PROCESSING_FINISHED' ||
          t.state === 'IMAGE_PROCESSING_FAILED',
      )
      .sort((a: any, b: any) => {
        const aIdx = a.task_id?.localeCompare?.(b.task_id) || 0;
        return aIdx;
      });
  }, [allTaskAssets]);

  const processedCount = useMemo(
    () =>
      taskList.filter(
        (t: any) => t.state === 'IMAGE_PROCESSING_FINISHED',
      ).length,
    [taskList],
  );

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
            {taskList.map((task: any, index: number) => {
              const canProcess = readinessMap.get(task.task_id) === true;
              const isTaskProcessing =
                processingTasks.has(task.task_id) ||
                task.state === 'IMAGE_PROCESSING_STARTED';
              const stateColor =
                stateColors[task.state] || '#e5e7eb';

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
                    Task {index + 1}
                  </td>
                  <td className="naxatw-px-3 naxatw-py-2 naxatw-text-gray-600">
                    {task.image_count} images
                  </td>
                  <td className="naxatw-px-3 naxatw-py-2">
                    <span
                      className="naxatw-inline-flex naxatw-items-center naxatw-gap-1 naxatw-rounded-full naxatw-px-2 naxatw-py-0.5 naxatw-text-xs naxatw-font-medium"
                      style={{
                        backgroundColor: `${stateColor}33`,
                        color:
                          task.state === 'IMAGE_PROCESSING_FINISHED'
                            ? '#166534'
                            : task.state === 'IMAGE_PROCESSING_FAILED'
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
                      {task.state === 'IMAGE_PROCESSING_FINISHED' && '✓ '}
                      {formatString(task.state) || 'No images'}
                    </span>
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
                        onClick={() => handleDownloadAssets(task.assets_url)}
                      >
                        Download
                      </Button>
                    ) : canProcess ? (
                      <Button
                        variant="ghost"
                        className="naxatw-h-7 naxatw-px-2 naxatw-text-xs naxatw-text-red-600 hover:naxatw-bg-red-50"
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
            className="naxatw-bg-red naxatw-text-white"
            leftIcon="play_arrow"
            onClick={handleProcessSelected}
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

      <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-2">
        <div className="naxatw-flex naxatw-gap-2">
          <Button
            variant="ghost"
            className="naxatw-bg-red naxatw-text-white disabled:naxatw-bg-gray-400"
            leftIcon="play_arrow"
            onClick={() => handleStartFinalProcessing(false)}
            disabled={isProcessingAll}
          >
            Start Final Processing
          </Button>
          <Button
            variant="outline"
            className="naxatw-border-red naxatw-text-red"
            leftIcon="pin_drop"
            onClick={() => handleStartFinalProcessing(true)}
            disabled={isProcessingAll}
          >
            With GCP
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProcessingStatusDialog;
