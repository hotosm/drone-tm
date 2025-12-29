import { useState, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { Button } from '@Components/RadixComponents/Button';
import {
  getProcessingSummary,
  startBatchProcessing,
  ProcessingSummary,
} from '@Services/classification';

interface ImageProcessingProps {
  projectId: string;
  batchId: string;
}

// Minimum images required for ODM processing
const MIN_IMAGES_FOR_ODM = 3;

const ImageProcessing = ({ projectId, batchId }: ImageProcessingProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingJobId, setProcessingJobId] = useState<string | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());

  // Fetch processing summary
  const {
    data: summary,
    isLoading,
    error,
  } = useQuery<ProcessingSummary>({
    queryKey: ['processing-summary', projectId, batchId],
    queryFn: () => getProcessingSummary(projectId, batchId),
    enabled: !!projectId && !!batchId,
  });

  // Categorize tasks by processability
  const { processableTasks, insufficientTasks } = useMemo(() => {
    if (!summary?.tasks) {
      return { processableTasks: [], insufficientTasks: [] };
    }
    return {
      processableTasks: summary.tasks.filter(t => t.image_count >= MIN_IMAGES_FOR_ODM),
      insufficientTasks: summary.tasks.filter(t => t.image_count < MIN_IMAGES_FOR_ODM),
    };
  }, [summary]);

  // Initialize selected tasks with all processable tasks
  useState(() => {
    if (processableTasks.length > 0 && selectedTasks.size === 0) {
      setSelectedTasks(new Set(processableTasks.map(t => t.task_id)));
    }
  });

  // Update selected tasks when processable tasks change
  useMemo(() => {
    if (processableTasks.length > 0 && selectedTasks.size === 0) {
      setSelectedTasks(new Set(processableTasks.map(t => t.task_id)));
    }
  }, [processableTasks]);

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
      setIsProcessing(true);
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

  if (!summary || summary.total_images === 0) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <div className="naxatw-text-center">
          <span className="material-icons naxatw-text-4xl naxatw-text-yellow-500">warning</span>
          <p className="naxatw-mt-2 naxatw-text-gray-600">No assigned images to process</p>
          <p className="naxatw-text-sm naxatw-text-gray-400">Go back to the review step to assign images to tasks</p>
        </div>
      </div>
    );
  }

  const selectedImageCount = processableTasks
    .filter(t => selectedTasks.has(t.task_id))
    .reduce((sum, t) => sum + t.image_count, 0);

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-6">
      {/* Header */}
      <div>
        <h3 className="naxatw-text-lg naxatw-font-semibold naxatw-text-gray-800">
          Ready for Processing
        </h3>
        <p className="naxatw-text-sm naxatw-text-gray-500">
          Select tasks to process. Tasks need at least {MIN_IMAGES_FOR_ODM} images for ODM to generate orthophotos.
        </p>
      </div>

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
                {processableTasks.map((task) => (
                  <tr
                    key={task.task_id}
                    className={`naxatw-cursor-pointer hover:naxatw-bg-gray-50 ${
                      selectedTasks.has(task.task_id) ? 'naxatw-bg-red-50' : ''
                    }`}
                    onClick={() => !isProcessing && handleTaskToggle(task.task_id)}
                  >
                    <td className="naxatw-px-4 naxatw-py-3">
                      <input
                        type="checkbox"
                        checked={selectedTasks.has(task.task_id)}
                        onChange={() => handleTaskToggle(task.task_id)}
                        disabled={isProcessing}
                        onClick={(e) => e.stopPropagation()}
                        className="naxatw-h-4 naxatw-w-4 naxatw-rounded naxatw-border-gray-300 naxatw-text-red focus:naxatw-ring-red"
                      />
                    </td>
                    <td className="naxatw-px-4 naxatw-py-3">
                      <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                        <span className="material-icons naxatw-text-lg naxatw-text-green-500">
                          check_circle
                        </span>
                        <span className="naxatw-font-medium naxatw-text-gray-700">
                          Task #{task.task_index}
                        </span>
                      </div>
                    </td>
                    <td className="naxatw-px-4 naxatw-py-3 naxatw-text-right">
                      <span className="naxatw-rounded-full naxatw-bg-green-100 naxatw-px-2.5 naxatw-py-0.5 naxatw-text-sm naxatw-font-medium naxatw-text-green-700">
                        {task.image_count} images
                      </span>
                    </td>
                    <td className="naxatw-px-4 naxatw-py-3 naxatw-text-center">
                      {isProcessing && selectedTasks.has(task.task_id) ? (
                        <span className="naxatw-inline-flex naxatw-items-center naxatw-gap-1 naxatw-text-sm naxatw-text-yellow-600">
                          <span className="material-icons naxatw-animate-spin naxatw-text-base">sync</span>
                          Processing
                        </span>
                      ) : (
                        <span className="naxatw-inline-flex naxatw-items-center naxatw-gap-1 naxatw-text-sm naxatw-text-green-600">
                          <span className="material-icons naxatw-text-base">check</span>
                          Ready
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Insufficient Tasks (not selectable) */}
      {insufficientTasks.length > 0 && (
        <div className="naxatw-rounded-lg naxatw-border naxatw-border-gray-200 naxatw-bg-white naxatw-opacity-75">
          <div className="naxatw-border-b naxatw-border-gray-200 naxatw-px-4 naxatw-py-3">
            <h4 className="naxatw-font-medium naxatw-text-gray-500">
              Tasks with Insufficient Images ({insufficientTasks.length})
            </h4>
          </div>
          <div className="naxatw-max-h-[150px] naxatw-overflow-y-auto">
            <table className="naxatw-w-full">
              <thead className="naxatw-sticky naxatw-top-0 naxatw-bg-gray-50">
                <tr>
                  <th className="naxatw-w-12 naxatw-px-4 naxatw-py-2"></th>
                  <th className="naxatw-px-4 naxatw-py-2 naxatw-text-left naxatw-text-sm naxatw-font-medium naxatw-text-gray-400">
                    Task
                  </th>
                  <th className="naxatw-px-4 naxatw-py-2 naxatw-text-right naxatw-text-sm naxatw-font-medium naxatw-text-gray-400">
                    Images
                  </th>
                  <th className="naxatw-px-4 naxatw-py-2 naxatw-text-center naxatw-text-sm naxatw-font-medium naxatw-text-gray-400">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="naxatw-divide-y naxatw-divide-gray-100">
                {insufficientTasks.map((task) => (
                  <tr key={task.task_id} className="naxatw-bg-gray-50">
                    <td className="naxatw-px-4 naxatw-py-3">
                      <input
                        type="checkbox"
                        checked={false}
                        disabled
                        className="naxatw-h-4 naxatw-w-4 naxatw-rounded naxatw-border-gray-300 naxatw-opacity-50"
                      />
                    </td>
                    <td className="naxatw-px-4 naxatw-py-3">
                      <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                        <span className="material-icons naxatw-text-lg naxatw-text-yellow-500">
                          warning
                        </span>
                        <span className="naxatw-font-medium naxatw-text-gray-500">
                          Task #{task.task_index}
                        </span>
                      </div>
                    </td>
                    <td className="naxatw-px-4 naxatw-py-3 naxatw-text-right">
                      <span className="naxatw-rounded-full naxatw-bg-yellow-100 naxatw-px-2.5 naxatw-py-0.5 naxatw-text-sm naxatw-font-medium naxatw-text-yellow-700">
                        {task.image_count} image{task.image_count !== 1 ? 's' : ''}
                      </span>
                    </td>
                    <td className="naxatw-px-4 naxatw-py-3 naxatw-text-center">
                      <span className="naxatw-inline-flex naxatw-items-center naxatw-gap-1 naxatw-text-sm naxatw-text-yellow-600">
                        <span className="material-icons naxatw-text-base">block</span>
                        Needs {MIN_IMAGES_FOR_ODM - task.image_count} more
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Processing Status */}
      {isProcessing && (
        <div className="naxatw-rounded-lg naxatw-border naxatw-border-blue-200 naxatw-bg-blue-50 naxatw-p-4">
          <div className="naxatw-flex naxatw-items-start naxatw-gap-3">
            <span className="material-icons naxatw-animate-spin naxatw-text-blue-600">sync</span>
            <div>
              <p className="naxatw-font-medium naxatw-text-blue-800">Processing in Progress</p>
              <p className="naxatw-text-sm naxatw-text-blue-600">
                Images are being moved to task folders and ODM processing has been triggered.
                This may take a while depending on the number of images.
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

      {/* Action Button */}
      {!isProcessing && (
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
          {selectedTasks.size === 0 && processableTasks.length > 0 && (
            <p className="naxatw-text-sm naxatw-text-gray-500">
              Select at least one task to process
            </p>
          )}
          {processableTasks.length === 0 && (
            <p className="naxatw-text-sm naxatw-text-yellow-600">
              No tasks have enough images for processing
            </p>
          )}
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
