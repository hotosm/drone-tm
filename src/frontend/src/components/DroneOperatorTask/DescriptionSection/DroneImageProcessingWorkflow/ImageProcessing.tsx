import { useState } from 'react';
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

const ImageProcessing = ({ projectId, batchId }: ImageProcessingProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingJobId, setProcessingJobId] = useState<string | null>(null);

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

  // Mutation to start processing
  const startProcessingMutation = useMutation({
    mutationFn: () => startBatchProcessing(projectId, batchId),
    onSuccess: (data) => {
      setIsProcessing(true);
      setProcessingJobId(data.job_id);
      toast.success('Processing started! Images are being moved to task folders and ODM processing has been triggered.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to start processing');
    },
  });

  const handleStartProcessing = () => {
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

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-6">
      {/* Header */}
      <div>
        <h3 className="naxatw-text-lg naxatw-font-semibold naxatw-text-gray-800">
          Ready for Processing
        </h3>
        <p className="naxatw-text-sm naxatw-text-gray-500">
          Review the summary below and start processing to generate orthophotos for each task.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="naxatw-grid naxatw-grid-cols-2 naxatw-gap-4 md:naxatw-grid-cols-3">
        <div className="naxatw-rounded-lg naxatw-border naxatw-border-gray-200 naxatw-bg-white naxatw-p-4 naxatw-shadow-sm">
          <div className="naxatw-flex naxatw-items-center naxatw-gap-3">
            <span className="material-icons naxatw-text-2xl naxatw-text-blue-500">grid_view</span>
            <div>
              <p className="naxatw-text-2xl naxatw-font-bold naxatw-text-gray-800">
                {summary.total_tasks}
              </p>
              <p className="naxatw-text-sm naxatw-text-gray-500">Tasks</p>
            </div>
          </div>
        </div>

        <div className="naxatw-rounded-lg naxatw-border naxatw-border-gray-200 naxatw-bg-white naxatw-p-4 naxatw-shadow-sm">
          <div className="naxatw-flex naxatw-items-center naxatw-gap-3">
            <span className="material-icons naxatw-text-2xl naxatw-text-green-500">photo_library</span>
            <div>
              <p className="naxatw-text-2xl naxatw-font-bold naxatw-text-gray-800">
                {summary.total_images}
              </p>
              <p className="naxatw-text-sm naxatw-text-gray-500">Images</p>
            </div>
          </div>
        </div>

        <div className="naxatw-rounded-lg naxatw-border naxatw-border-gray-200 naxatw-bg-white naxatw-p-4 naxatw-shadow-sm">
          <div className="naxatw-flex naxatw-items-center naxatw-gap-3">
            <span className="material-icons naxatw-text-2xl naxatw-text-purple-500">calculate</span>
            <div>
              <p className="naxatw-text-2xl naxatw-font-bold naxatw-text-gray-800">
                {summary.total_tasks > 0 ? Math.round(summary.total_images / summary.total_tasks) : 0}
              </p>
              <p className="naxatw-text-sm naxatw-text-gray-500">Avg/Task</p>
            </div>
          </div>
        </div>
      </div>

      {/* Task List */}
      <div className="naxatw-rounded-lg naxatw-border naxatw-border-gray-200 naxatw-bg-white">
        <div className="naxatw-border-b naxatw-border-gray-200 naxatw-px-4 naxatw-py-3">
          <h4 className="naxatw-font-medium naxatw-text-gray-700">Tasks to Process</h4>
        </div>
        <div className="naxatw-max-h-[300px] naxatw-overflow-y-auto">
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
              {summary.tasks.map((task) => (
                <tr key={task.task_id} className="hover:naxatw-bg-gray-50">
                  <td className="naxatw-px-4 naxatw-py-3">
                    <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                      <span className="material-icons naxatw-text-lg naxatw-text-gray-400">
                        crop_square
                      </span>
                      <span className="naxatw-font-medium naxatw-text-gray-700">
                        Task #{task.task_index}
                      </span>
                    </div>
                  </td>
                  <td className="naxatw-px-4 naxatw-py-3 naxatw-text-right">
                    <span className="naxatw-rounded-full naxatw-bg-blue-100 naxatw-px-2.5 naxatw-py-0.5 naxatw-text-sm naxatw-font-medium naxatw-text-blue-700">
                      {task.image_count} images
                    </span>
                  </td>
                  <td className="naxatw-px-4 naxatw-py-3 naxatw-text-center">
                    {isProcessing ? (
                      <span className="naxatw-inline-flex naxatw-items-center naxatw-gap-1 naxatw-text-sm naxatw-text-yellow-600">
                        <span className="material-icons naxatw-animate-spin naxatw-text-base">sync</span>
                        Processing
                      </span>
                    ) : (
                      <span className="naxatw-inline-flex naxatw-items-center naxatw-gap-1 naxatw-text-sm naxatw-text-gray-500">
                        <span className="material-icons naxatw-text-base">schedule</span>
                        Pending
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
        <div className="naxatw-flex naxatw-justify-center">
          <Button
            variant="ghost"
            className="naxatw-bg-red naxatw-px-8 naxatw-text-white"
            onClick={handleStartProcessing}
            disabled={startProcessingMutation.isPending}
            leftIcon={startProcessingMutation.isPending ? 'sync' : 'play_arrow'}
          >
            {startProcessingMutation.isPending ? 'Starting...' : 'Start Processing'}
          </Button>
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
              <li>Generated orthophotos will be available for viewing once complete</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageProcessing;
