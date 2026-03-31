import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { Button } from '@Components/RadixComponents/Button';
import {
  getProcessingSummary,
  startBatchProcessing,
  ProcessingSummary,
  ProcessingTask,
} from '@Services/classification';

interface ImageProcessingProps {
  projectId: string;
  batchId: string;
}

// Minimum images required for ODM processing
const MIN_IMAGES_FOR_ODM = 3;

// Polling interval for checking processing status (10 seconds)
const POLLING_INTERVAL = 10000;

const getTaskStatusInfo = (task: ProcessingTask) => {
  switch (task.state) {
    case 'READY_FOR_PROCESSING':
      return {
        label: 'Ready',
        icon: 'check',
        iconClass: 'naxatw-text-green-500',
        badgeClass: 'naxatw-text-green-600',
        spinning: false,
      };
    case 'IMAGE_PROCESSING_STARTED':
      return {
        label: 'Processing',
        icon: 'sync',
        iconClass: 'naxatw-text-yellow-500',
        badgeClass: 'naxatw-text-yellow-600',
        spinning: true,
      };
    case 'IMAGE_PROCESSING_FINISHED':
      return {
        label: 'Completed',
        icon: 'check_circle',
        iconClass: 'naxatw-text-green-500',
        badgeClass: 'naxatw-text-green-600',
        spinning: false,
      };
    case 'IMAGE_PROCESSING_FAILED':
      return {
        label: 'Failed',
        icon: 'error',
        iconClass: 'naxatw-text-red-500',
        badgeClass: 'naxatw-text-red-600',
        spinning: false,
      };
    default:
      return {
        label: 'Unknown',
        icon: 'help',
        iconClass: 'naxatw-text-gray-500',
        badgeClass: 'naxatw-text-gray-600',
        spinning: false,
      };
  }
};

const ImageProcessing = ({ projectId, batchId }: ImageProcessingProps) => {
  const [processingJobId, setProcessingJobId] = useState<string | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());

  // Determine if any tasks are currently processing
  const hasProcessingTasks = (tasks: ProcessingTask[] | undefined) =>
    tasks?.some(t => t.state === 'IMAGE_PROCESSING_STARTED') ?? false;

  // Fetch processing summary with polling when tasks are processing
  const {
    data: summary,
    isLoading,
    error,
  } = useQuery<ProcessingSummary>({
    queryKey: ['processing-summary', projectId, batchId],
    queryFn: () => getProcessingSummary(projectId, batchId),
    enabled: !!projectId && !!batchId,
    // Poll when: (1) we just started processing OR (2) any task is in processing state
    refetchInterval: (query) => {
      const tasksProcessing = hasProcessingTasks(query.state.data?.tasks);
      const allDone = query.state.data?.tasks?.every(
        t => t.state === 'IMAGE_PROCESSING_FINISHED' || t.state === 'IMAGE_PROCESSING_FAILED'
      ) ?? false;

      // Poll if we have a job ID (just started) or tasks are processing, but not if all done
      if ((processingJobId || tasksProcessing) && !allDone) {
        return POLLING_INTERVAL;
      }
      return false;
    },
  });

  // Check if any task is processing or completed
  const isProcessing = hasProcessingTasks(summary?.tasks) || !!processingJobId;
  const allCompleted = summary?.tasks?.length ? summary.tasks.every(
    t => t.state === 'IMAGE_PROCESSING_FINISHED' || t.state === 'IMAGE_PROCESSING_FAILED'
  ) : false;

  // Categorize tasks by processability (only tasks that haven't started processing)
  const { processableTasks, insufficientTasks, processingTasks, completedTasks } = useMemo(() => {
    if (!summary?.tasks) {
      return { processableTasks: [], insufficientTasks: [], processingTasks: [], completedTasks: [] };
    }

    const readyTasks = summary.tasks.filter(t => t.state === 'READY_FOR_PROCESSING');
    const inProgress = summary.tasks.filter(t => t.state === 'IMAGE_PROCESSING_STARTED');
    const finished = summary.tasks.filter(
      t => t.state === 'IMAGE_PROCESSING_FINISHED' || t.state === 'IMAGE_PROCESSING_FAILED'
    );

    return {
      processableTasks: readyTasks.filter(t => t.image_count >= MIN_IMAGES_FOR_ODM),
      insufficientTasks: readyTasks.filter(t => t.image_count < MIN_IMAGES_FOR_ODM),
      processingTasks: inProgress,
      completedTasks: finished,
    };
  }, [summary]);

  // Initialize selected tasks with all processable tasks
  useMemo(() => {
    if (processableTasks.length > 0 && selectedTasks.size === 0) {
      setSelectedTasks(new Set(processableTasks.map(t => t.task_id)));
    }
  }, [processableTasks]);

  // Clear job ID when all tasks are completed
  useEffect(() => {
    if (allCompleted && processingJobId) {
      setProcessingJobId(null);
    }
  }, [allCompleted, processingJobId]);

  const handleTaskToggle = (taskId: string) => {
    const newSelected = new Set(selectedTasks);
    if (newSelected.has(taskId)) {
      newSelected.delete(taskId);
    } else {
      newSelected.add(taskId);
    }
    setSelectedTasks(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedTasks.size === processableTasks.length) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(new Set(processableTasks.map(t => t.task_id)));
    }
  };

  // Mutation to start processing
  const startProcessingMutation = useMutation({
    mutationFn: () => startBatchProcessing(projectId, batchId),
    onSuccess: (data) => {
      setProcessingJobId(data.job_id);
      toast.success(
        `Processing started for ${selectedTasks.size} task(s)! Images are being moved to task folders and ODM processing has been triggered.`
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to start processing');
    },
  });

  const handleStartProcessing = () => {
    if (selectedTasks.size === 0) {
      toast.warning('Please select at least one task to process');
      return;
    }
    startProcessingMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-3">
          <div className="naxatw-h-8 naxatw-w-8 naxatw-animate-spin naxatw-rounded-full naxatw-border-4 naxatw-border-gray-200 naxatw-border-t-red" />
          <p className="naxatw-text-gray-500">Loading processing summary...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <div className="naxatw-text-center">
          <span className="material-icons naxatw-text-4xl naxatw-text-red-500">error</span>
          <p className="naxatw-mt-2 naxatw-text-gray-600">Failed to load processing summary</p>
        </div>
      </div>
    );
  }

  if (!summary || summary.total_tasks === 0) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <div className="naxatw-text-center">
          <span className="material-icons naxatw-text-4xl naxatw-text-yellow-500">warning</span>
          <p className="naxatw-mt-2 naxatw-text-gray-600">No tasks ready for processing</p>
          <p className="naxatw-text-sm naxatw-text-gray-400">
            Go back to the review step and mark tasks as &quot;Fully Flown&quot; first
          </p>
        </div>
      </div>
    );
  }

  const selectedImageCount = processableTasks
    .filter(t => selectedTasks.has(t.task_id))
    .reduce((sum, t) => sum + t.image_count, 0);

  // Render a task row with status
  const renderTaskRow = (task: ProcessingTask, selectable: boolean = false) => {
    const status = getTaskStatusInfo(task);
    const isSelected = selectedTasks.has(task.task_id);
    const canSelect = selectable && task.state === 'READY_FOR_PROCESSING' && task.image_count >= MIN_IMAGES_FOR_ODM;
    const isFailed = task.state === 'IMAGE_PROCESSING_FAILED';

    return (
      <tr
        key={task.task_id}
        className={`${canSelect ? 'naxatw-cursor-pointer hover:naxatw-bg-gray-50' : ''} ${
          isSelected && canSelect ? 'naxatw-bg-red-50' : ''
        } ${isFailed ? 'naxatw-bg-red-50' : ''}`}
        onClick={() => canSelect && handleTaskToggle(task.task_id)}
      >
        {selectable && (
          <td className="naxatw-px-4 naxatw-py-3">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => handleTaskToggle(task.task_id)}
              disabled={!canSelect}
              onClick={(e) => e.stopPropagation()}
              className="naxatw-h-4 naxatw-w-4 naxatw-rounded naxatw-border-gray-300 naxatw-text-red focus:naxatw-ring-red disabled:naxatw-opacity-50"
            />
          </td>
        )}
        <td className="naxatw-px-4 naxatw-py-3">
          <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
            <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
              <span className={`material-icons naxatw-text-lg ${status.iconClass}`}>
                {task.state === 'READY_FOR_PROCESSING' ? 'check_circle' : status.icon}
              </span>
              <span className="naxatw-font-medium naxatw-text-gray-700">
                Task #{task.task_index}
              </span>
            </div>
            {isFailed && task.failure_reason && (
              <p className="naxatw-ml-7 naxatw-text-xs naxatw-text-red-600">
                {task.failure_reason}
              </p>
            )}
          </div>
        </td>
        <td className="naxatw-px-4 naxatw-py-3 naxatw-text-right naxatw-align-top">
          <span className={`naxatw-rounded-full naxatw-px-2.5 naxatw-py-0.5 naxatw-text-sm naxatw-font-medium ${
            task.image_count >= MIN_IMAGES_FOR_ODM
              ? 'naxatw-bg-green-100 naxatw-text-green-700'
              : 'naxatw-bg-yellow-100 naxatw-text-yellow-700'
          }`}>
            {task.image_count} images
          </span>
        </td>
        <td className="naxatw-px-4 naxatw-py-3 naxatw-text-center naxatw-align-top">
          <span className={`naxatw-inline-flex naxatw-items-center naxatw-gap-1 naxatw-text-sm ${status.badgeClass}`}>
            <span className={`material-icons naxatw-text-base ${status.spinning ? 'naxatw-animate-spin' : ''}`}>
              {status.icon}
            </span>
            {status.label}
          </span>
        </td>
      </tr>
    );
  };

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-6">
      {/* Header */}
      <div>
        <h3 className="naxatw-text-lg naxatw-font-semibold naxatw-text-gray-800">
          {allCompleted ? 'Processing Complete' : isProcessing ? 'Processing in Progress' : 'Ready for Processing'}
        </h3>
        <p className="naxatw-text-sm naxatw-text-gray-500">
          {allCompleted
            ? 'All tasks have been processed. Check the results below.'
            : isProcessing
              ? 'Tasks are being processed. This page will update automatically.'
              : `Select tasks to process. Tasks need at least ${MIN_IMAGES_FOR_ODM} images for ODM to generate orthophotos.`}
        </p>
      </div>

      {/* Processing Status Banner */}
      {isProcessing && (
        <div className="naxatw-rounded-lg naxatw-border naxatw-border-blue-200 naxatw-bg-blue-50 naxatw-p-4">
          <div className="naxatw-flex naxatw-items-start naxatw-gap-3">
            <span className="material-icons naxatw-animate-spin naxatw-text-blue-600">sync</span>
            <div>
              <p className="naxatw-font-medium naxatw-text-blue-800">Processing in Progress</p>
              <p className="naxatw-text-sm naxatw-text-blue-600">
                {processingTasks.length} task(s) are currently being processed.
                This page updates automatically every 10 seconds.
              </p>
              {processingJobId && (
                <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-blue-500">
                  Job ID: {processingJobId}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <div className="naxatw-rounded-lg naxatw-border naxatw-border-gray-200 naxatw-bg-white">
          <div className="naxatw-border-b naxatw-border-gray-200 naxatw-px-4 naxatw-py-3">
            <h4 className="naxatw-font-medium naxatw-text-gray-700">
              Completed Tasks ({completedTasks.length})
            </h4>
          </div>
          <div className="naxatw-max-h-[200px] naxatw-overflow-y-auto">
            <table className="naxatw-w-full">
              <thead className="naxatw-sticky naxatw-top-0 naxatw-bg-gray-50">
                <tr>
                  <th className="naxatw-px-4 naxatw-py-2 naxatw-text-left naxatw-text-sm naxatw-font-medium naxatw-text-gray-500">
                    Task
                  </th>
                  <th className="naxatw-px-4 naxatw-py-2 naxatw-text-right naxatw-text-sm naxatw-font-medium naxatw-text-gray-500">
                    Images
                  </th>
                  <th className="naxatw-px-4 naxatw-py-2 naxatw-text-center naxatw-text-sm naxatw-font-medium naxatw-text-gray-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="naxatw-divide-y naxatw-divide-gray-100">
                {completedTasks.map((task) => renderTaskRow(task, false))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Processing Tasks */}
      {processingTasks.length > 0 && (
        <div className="naxatw-rounded-lg naxatw-border naxatw-border-yellow-200 naxatw-bg-yellow-50">
          <div className="naxatw-border-b naxatw-border-yellow-200 naxatw-px-4 naxatw-py-3">
            <h4 className="naxatw-font-medium naxatw-text-yellow-800">
              Currently Processing ({processingTasks.length})
            </h4>
          </div>
          <div className="naxatw-max-h-[200px] naxatw-overflow-y-auto">
            <table className="naxatw-w-full">
              <thead className="naxatw-sticky naxatw-top-0 naxatw-bg-yellow-100">
                <tr>
                  <th className="naxatw-px-4 naxatw-py-2 naxatw-text-left naxatw-text-sm naxatw-font-medium naxatw-text-yellow-700">
                    Task
                  </th>
                  <th className="naxatw-px-4 naxatw-py-2 naxatw-text-right naxatw-text-sm naxatw-font-medium naxatw-text-yellow-700">
                    Images
                  </th>
                  <th className="naxatw-px-4 naxatw-py-2 naxatw-text-center naxatw-text-sm naxatw-font-medium naxatw-text-yellow-700">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="naxatw-divide-y naxatw-divide-yellow-200">
                {processingTasks.map((task) => renderTaskRow(task, false))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Warning for insufficient tasks */}
      {insufficientTasks.length > 0 && (
        <div className="naxatw-rounded-lg naxatw-border naxatw-border-yellow-200 naxatw-bg-yellow-50 naxatw-p-4">
          <div className="naxatw-flex naxatw-items-start naxatw-gap-3">
            <span className="material-icons naxatw-text-yellow-600">warning</span>
            <div>
              <p className="naxatw-font-medium naxatw-text-yellow-800">
                {insufficientTasks.length} task(s) cannot be processed
              </p>
              <p className="naxatw-text-sm naxatw-text-yellow-700">
                These tasks have fewer than {MIN_IMAGES_FOR_ODM} images. ODM requires at least {MIN_IMAGES_FOR_ODM} overlapping images to generate an orthophoto.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Processable Tasks */}
      {processableTasks.length > 0 && (
        <div className="naxatw-rounded-lg naxatw-border naxatw-border-gray-200 naxatw-bg-white">
          <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-border-b naxatw-border-gray-200 naxatw-px-4 naxatw-py-3">
            <h4 className="naxatw-font-medium naxatw-text-gray-700">
              Tasks Ready for Processing ({processableTasks.length})
            </h4>
            <label className="naxatw-flex naxatw-cursor-pointer naxatw-items-center naxatw-gap-2 naxatw-text-sm">
              <input
                type="checkbox"
                checked={selectedTasks.size === processableTasks.length && processableTasks.length > 0}
                onChange={handleSelectAll}
                disabled={isProcessing}
                className="naxatw-h-4 naxatw-w-4 naxatw-rounded naxatw-border-gray-300 naxatw-text-red focus:naxatw-ring-red"
              />
              Select All
            </label>
          </div>
          <div className="naxatw-max-h-[250px] naxatw-overflow-y-auto">
            <table className="naxatw-w-full">
              <thead className="naxatw-sticky naxatw-top-0 naxatw-bg-gray-50">
                <tr>
                  <th className="naxatw-w-12 naxatw-px-4 naxatw-py-2"></th>
                  <th className="naxatw-px-4 naxatw-py-2 naxatw-text-left naxatw-text-sm naxatw-font-medium naxatw-text-gray-500">
                    Task
                  </th>
                  <th className="naxatw-px-4 naxatw-py-2 naxatw-text-right naxatw-text-sm naxatw-font-medium naxatw-text-gray-500">
                    Images
                  </th>
                  <th className="naxatw-px-4 naxatw-py-2 naxatw-text-center naxatw-text-sm naxatw-font-medium naxatw-text-gray-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="naxatw-divide-y naxatw-divide-gray-100">
                {processableTasks.map((task) => renderTaskRow(task, true))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Action Button */}
      {!isProcessing && !allCompleted && processableTasks.length > 0 && (
        <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-2">
          <Button
            variant="ghost"
            className="naxatw-bg-red naxatw-px-8 naxatw-text-white disabled:naxatw-opacity-50"
            onClick={handleStartProcessing}
            disabled={startProcessingMutation.isPending || selectedTasks.size === 0}
            leftIcon={startProcessingMutation.isPending ? 'sync' : 'play_arrow'}
          >
            {startProcessingMutation.isPending
              ? 'Starting...'
              : `Process ${selectedTasks.size} Task${selectedTasks.size !== 1 ? 's' : ''} (${selectedImageCount} images)`}
          </Button>
          {selectedTasks.size === 0 && (
            <p className="naxatw-text-sm naxatw-text-gray-500">
              Select at least one task to process
            </p>
          )}
        </div>
      )}

      {/* All Completed Message */}
      {allCompleted && (
        <div className="naxatw-rounded-lg naxatw-border naxatw-border-green-200 naxatw-bg-green-50 naxatw-p-4">
          <div className="naxatw-flex naxatw-items-start naxatw-gap-3">
            <span className="material-icons naxatw-text-green-600">check_circle</span>
            <div>
              <p className="naxatw-font-medium naxatw-text-green-800">All Tasks Processed</p>
              <p className="naxatw-text-sm naxatw-text-green-600">
                Processing is complete. You can close this dialog and view the generated orthophotos.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Info Note */}
      <div className="naxatw-rounded-lg naxatw-bg-gray-50 naxatw-p-4">
        <div className="naxatw-flex naxatw-items-start naxatw-gap-2">
          <span className="material-icons naxatw-text-gray-400">info</span>
          <div className="naxatw-text-sm naxatw-text-gray-600">
            <p className="naxatw-font-medium">What happens during processing?</p>
            <ul className="naxatw-mt-1 naxatw-list-inside naxatw-list-disc naxatw-space-y-1">
              <li>Images are moved from staging to their assigned task folders</li>
              <li>OpenDroneMap (ODM) processes each task to generate orthophotos</li>
              <li>ODM requires at least {MIN_IMAGES_FOR_ODM} overlapping images per task</li>
              <li>Generated orthophotos will be available for viewing once complete</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageProcessing;
