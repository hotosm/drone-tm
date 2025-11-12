import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import {
  useStartClassificationMutation,
  useGetBatchStatusQuery,
  useGetBatchImagesQuery,
} from '@Api/projects';
import type { ImageClassificationResult, BatchStatusSummary } from '@Services/classification';

interface ImageClassificationProps {
  projectId: string;
  batchId: string;
  onClassificationComplete?: () => void;
}

const ImageClassification = ({
  projectId,
  batchId,
  onClassificationComplete,
}: ImageClassificationProps) => {
  const queryClient = useQueryClient();
  const [images, setImages] = useState<Record<string, ImageClassificationResult>>({});
  const [lastUpdateTime, setLastUpdateTime] = useState<string | undefined>();
  const [isPolling, setIsPolling] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  // Mutation to start classification
  const startClassificationMutation = useStartClassificationMutation({
    onSuccess: (data) => {
      setJobId(data.job_id);
      setIsPolling(true);
      toast.info('Classification started. Processing images...');
    },
    onError: (error: any) => {
      toast.error(`Failed to start classification: ${error?.message || 'Unknown error'}`);
    },
  });

  // Query for batch status (summary counts) - fetch immediately and poll during classification
  const { data: batchStatus, refetch: refetchStatus } = useGetBatchStatusQuery(
    projectId,
    batchId,
    {
      enabled: !!projectId && !!batchId, // Fetch immediately when component loads
      refetchInterval: isPolling ? 3000 : false, // Poll every 3 seconds during classification
    },
  );

  // Query for batch images - fetch immediately and poll during classification for incremental updates
  const { data: newImages, refetch: refetchImages } = useGetBatchImagesQuery(
    projectId,
    batchId,
    lastUpdateTime,
    {
      enabled: !!projectId && !!batchId, // Fetch immediately when component loads
      refetchInterval: isPolling ? 2000 : false, // Poll every 2 seconds during classification
    },
  );

  // Update images state when new data arrives
  useEffect(() => {
    if (newImages && newImages.length > 0) {
      setImages((prev) => {
        const updated = { ...prev };
        newImages.forEach((img) => {
          updated[img.id] = img;
        });
        return updated;
      });

      // Update last update time to the most recent image's upload time
      const latestTime = newImages.reduce((latest, img) => {
        return img.uploaded_at > latest ? img.uploaded_at : latest;
      }, lastUpdateTime || '');
      setLastUpdateTime(latestTime);
    }
  }, [newImages, lastUpdateTime]);

  // Stop polling when classification is complete
  useEffect(() => {
    if (batchStatus && isPolling) {
      // Count images that have been classified (final states)
      const classified = (batchStatus.assigned ?? 0) + (batchStatus.rejected ?? 0) +
                        (batchStatus.unmatched ?? 0) + (batchStatus.invalid_exif ?? 0) +
                        (batchStatus.duplicate ?? 0);

      // Count images that are ready for classification or being processed
      const toClassify = (batchStatus.uploaded ?? 0) + (batchStatus.classifying ?? 0);

      // Stop polling when there are no more images to classify and we have classified results
      if (classified > 0 && toClassify === 0) {
        setIsPolling(false);
        toast.success('Classification complete!');
        if (onClassificationComplete) {
          onClassificationComplete();
        }
      }
    }
  }, [batchStatus, isPolling, onClassificationComplete]);

  // Start classification
  const handleStartClassification = useCallback(() => {
    startClassificationMutation.mutate({ projectId, batchId });
  }, [projectId, batchId, startClassificationMutation]);

  // Get status color
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'assigned':
        return 'naxatw-bg-green-500';
      case 'rejected':
        return 'naxatw-bg-red-500';
      case 'unmatched':
        return 'naxatw-bg-yellow-500';
      case 'invalid_exif':
        return 'naxatw-bg-orange-500';
      case 'duplicate':
        return 'naxatw-bg-gray-500';
      case 'classifying':
        return 'naxatw-bg-blue-500 naxatw-animate-pulse';
      case 'uploaded':
        return 'naxatw-bg-gray-300';
      case 'staged':
      default:
        return 'naxatw-bg-gray-200';
    }
  };

  // Get status label
  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'assigned':
        return 'Assigned';
      case 'rejected':
        return 'Rejected';
      case 'unmatched':
        return 'No Match';
      case 'invalid_exif':
        return 'Invalid EXIF';
      case 'duplicate':
        return 'Duplicate';
      case 'classifying':
        return 'Processing...';
      case 'uploaded':
        return 'Ready';
      case 'staged':
      default:
        return 'Staged';
    }
  };

  const imagesList = Object.values(images);
  const isClassifying = (batchStatus?.classifying ?? 0) > 0 || isPolling;

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-6 naxatw-p-6">
      {/* Header Section */}
      <div className="naxatw-flex naxatw-items-center naxatw-justify-between">
        <h2 className="naxatw-text-xl naxatw-font-bold">Image Classification</h2>

        {!jobId && (
          <button
            onClick={handleStartClassification}
            disabled={startClassificationMutation.isPending}
            className="naxatw-rounded naxatw-bg-red naxatw-px-6 naxatw-py-2 naxatw-text-white hover:naxatw-bg-red-600 disabled:naxatw-bg-gray-400 disabled:naxatw-cursor-not-allowed naxatw-transition-colors"
          >
            {startClassificationMutation.isPending ? 'Starting...' : 'Start Classification'}
          </button>
        )}
      </div>

      {/* Status Summary */}
      {batchStatus && (
        <div className="naxatw-grid naxatw-grid-cols-5 naxatw-gap-4 naxatw-rounded naxatw-bg-gray-50 naxatw-p-4 md:naxatw-grid-cols-9">
          <div className="naxatw-text-center">
            <div className="naxatw-text-2xl naxatw-font-bold">{batchStatus.total}</div>
            <div className="naxatw-text-sm naxatw-text-gray-600">Total</div>
          </div>
          <div className="naxatw-text-center">
            <div className="naxatw-text-2xl naxatw-font-bold naxatw-text-gray-400">{batchStatus.staged ?? 0}</div>
            <div className="naxatw-text-sm naxatw-text-gray-600">Staged</div>
          </div>
          <div className="naxatw-text-center">
            <div className="naxatw-text-2xl naxatw-font-bold naxatw-text-gray-500">{batchStatus.uploaded ?? 0}</div>
            <div className="naxatw-text-sm naxatw-text-gray-600">Ready</div>
          </div>
          <div className="naxatw-text-center">
            <div className="naxatw-text-2xl naxatw-font-bold naxatw-text-blue-600">{batchStatus.classifying ?? 0}</div>
            <div className="naxatw-text-sm naxatw-text-gray-600">Processing</div>
          </div>
          <div className="naxatw-text-center">
            <div className="naxatw-text-2xl naxatw-font-bold naxatw-text-green-600">{batchStatus.assigned ?? 0}</div>
            <div className="naxatw-text-sm naxatw-text-gray-600">Assigned</div>
          </div>
          <div className="naxatw-text-center">
            <div className="naxatw-text-2xl naxatw-font-bold naxatw-text-red-600">{batchStatus.rejected ?? 0}</div>
            <div className="naxatw-text-sm naxatw-text-gray-600">Rejected</div>
          </div>
          <div className="naxatw-text-center">
            <div className="naxatw-text-2xl naxatw-font-bold naxatw-text-yellow-600">{batchStatus.unmatched ?? 0}</div>
            <div className="naxatw-text-sm naxatw-text-gray-600">Unmatched</div>
          </div>
          <div className="naxatw-text-center">
            <div className="naxatw-text-2xl naxatw-font-bold naxatw-text-orange-600">{batchStatus.invalid_exif ?? 0}</div>
            <div className="naxatw-text-sm naxatw-text-gray-600">Invalid EXIF</div>
          </div>
          <div className="naxatw-text-center">
            <div className="naxatw-text-2xl naxatw-font-bold naxatw-text-gray-600">{batchStatus.duplicate ?? 0}</div>
            <div className="naxatw-text-sm naxatw-text-gray-600">Duplicates</div>
          </div>
        </div>
      )}

      {/* Progress Indicator */}
      {isClassifying && (
        <div className="naxatw-flex naxatw-items-center naxatw-gap-3 naxatw-rounded naxatw-bg-blue-50 naxatw-p-4">
          <div className="naxatw-h-5 naxatw-w-5 naxatw-animate-spin naxatw-rounded-full naxatw-border-4 naxatw-border-blue-600 naxatw-border-t-transparent"></div>
          <span className="naxatw-text-sm naxatw-text-blue-800">
            Classifying images... This may take a few minutes.
          </span>
        </div>
      )}

      {/* 12x12 Image Grid */}
      <div className="naxatw-grid naxatw-grid-cols-6 naxatw-gap-3 md:naxatw-grid-cols-12">
        {imagesList.map((image) => (
          <div
            key={image.id}
            className="naxatw-group naxatw-relative naxatw-aspect-square naxatw-overflow-hidden naxatw-rounded naxatw-border-2 naxatw-border-gray-300 naxatw-transition-all hover:naxatw-scale-105 hover:naxatw-shadow-lg"
            title={`${image.filename}\nStatus: ${getStatusLabel(image.status)}${image.rejection_reason ? `\nReason: ${image.rejection_reason}` : ''}`}
          >
            {/* Status indicator */}
            <div className={`naxatw-absolute naxatw-inset-0 ${getStatusColor(image.status)} naxatw-opacity-60`} />

            {/* Image thumbnail placeholder */}
            <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center">
              <svg
                className="naxatw-h-6 naxatw-w-6 naxatw-text-white"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                  clipRule="evenodd"
                />
              </svg>
            </div>

            {/* Hover tooltip */}
            <div className="naxatw-absolute naxatw-inset-x-0 naxatw-bottom-0 naxatw-bg-black naxatw-bg-opacity-75 naxatw-p-1 naxatw-text-xs naxatw-text-white naxatw-opacity-0 naxatw-transition-opacity group-hover:naxatw-opacity-100">
              <div className="naxatw-truncate">{image.filename}</div>
              <div>{getStatusLabel(image.status)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {imagesList.length === 0 && !isPolling && (
        <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center naxatw-rounded naxatw-border-2 naxatw-border-dashed naxatw-border-gray-300 naxatw-bg-gray-50">
          <div className="naxatw-text-center">
            <svg
              className="naxatw-mx-auto naxatw-h-12 naxatw-w-12 naxatw-text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p className="naxatw-mt-2 naxatw-text-gray-500">No images classified yet</p>
            <p className="naxatw-text-sm naxatw-text-gray-400">Click to start classificationheck</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageClassification;
