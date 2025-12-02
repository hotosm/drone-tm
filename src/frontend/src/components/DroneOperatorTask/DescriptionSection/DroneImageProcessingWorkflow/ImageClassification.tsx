import { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-toastify';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import {
  startClassification as startClassificationAction,
  completeClassification,
} from '@Store/slices/imageProcessingWorkflow';
import {
  useStartClassificationMutation,
  useGetBatchStatusQuery,
  useGetBatchImagesQuery,
} from '@Api/projects';
import type { ImageClassificationResult } from '@Services/classification';

interface ImageClassificationProps {
  projectId: string;
  batchId: string;
}

const ImageClassification = ({
  projectId,
  batchId,
}: ImageClassificationProps) => {
  const dispatch = useTypedDispatch();
  const { jobId } = useTypedSelector(
    (state) => state.imageProcessingWorkflow
  );
  const [images, setImages] = useState<Record<string, ImageClassificationResult>>({});
  const [lastUpdateTime, setLastUpdateTime] = useState<string | undefined>();
  const [isPolling, setIsPolling] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageClassificationResult | null>(null);

  // Mutation to start classification
  const startClassificationMutation = useStartClassificationMutation({
    onSuccess: (data) => {
      dispatch(startClassificationAction(data.job_id));
      setIsPolling(true);
      toast.info('Classification started. Processing images...');
    },
    onError: (error: any) => {
      toast.error(`Failed to start classification: ${error?.message || 'Unknown error'}`);
    },
  });

  // Query for batch status (summary counts) - poll every 10 seconds to handle race conditions
  const { data: batchStatus, isLoading: isLoadingStatus } = useGetBatchStatusQuery(
    projectId,
    batchId,
    {
      enabled: !!projectId && !!batchId,
      refetchInterval: 10000,
    },
  );

  // Query for batch images - fetch immediately and poll every 10 seconds to handle race conditions
  const { data: newImages, isLoading: isLoadingImages } = useGetBatchImagesQuery(
    projectId,
    batchId,
    lastUpdateTime,
    {
      enabled: !!projectId && !!batchId,
      refetchInterval: 10000,
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

      const latestTime = newImages.reduce((latest, img) => {
        return img.uploaded_at > latest ? img.uploaded_at : latest;
      }, lastUpdateTime || '');
      setLastUpdateTime(latestTime);
    }
  }, [newImages, lastUpdateTime]);

  // Stop polling when classification is complete
  useEffect(() => {
    if (batchStatus && isPolling) {
      const classified = (batchStatus.assigned ?? 0) + (batchStatus.rejected ?? 0) +
                        (batchStatus.unmatched ?? 0) + (batchStatus.invalid_exif ?? 0) +
                        (batchStatus.duplicate ?? 0);
      const toClassify = (batchStatus.uploaded ?? 0) + (batchStatus.classifying ?? 0);

      if (classified > 0 && toClassify === 0) {
        setIsPolling(false);
        dispatch(completeClassification());
        toast.success('Classification complete! Review the results below.');
      }
    }
  }, [batchStatus, isPolling, dispatch]);

  const handleStartClassification = useCallback(() => {
    startClassificationMutation.mutate({ projectId, batchId });
  }, [projectId, batchId, startClassificationMutation]);

  // Get status badge styles
  const getStatusBadgeClass = (status: string): string => {
    const baseClass = 'naxatw-inline-flex naxatw-items-center naxatw-rounded-full naxatw-px-2 naxatw-py-0.5 naxatw-text-xs naxatw-font-medium';
    switch (status) {
      case 'assigned':
        return `${baseClass} naxatw-bg-green-100 naxatw-text-green-800`;
      case 'rejected':
        return `${baseClass} naxatw-bg-red-100 naxatw-text-red-800`;
      case 'unmatched':
        return `${baseClass} naxatw-bg-yellow-100 naxatw-text-yellow-800`;
      case 'invalid_exif':
        return `${baseClass} naxatw-bg-orange-100 naxatw-text-orange-800`;
      case 'duplicate':
        return `${baseClass} naxatw-bg-gray-100 naxatw-text-gray-800`;
      case 'classifying':
        return `${baseClass} naxatw-bg-blue-100 naxatw-text-blue-800 naxatw-animate-pulse`;
      case 'uploaded':
        return `${baseClass} naxatw-bg-gray-100 naxatw-text-gray-600`;
      case 'staged':
      default:
        return `${baseClass} naxatw-bg-gray-50 naxatw-text-gray-500`;
    }
  };

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

  const getBorderColor = (status: string): string => {
    switch (status) {
      case 'assigned':
        return 'naxatw-border-green-400';
      case 'rejected':
        return 'naxatw-border-red-400';
      case 'unmatched':
        return 'naxatw-border-yellow-400';
      case 'invalid_exif':
        return 'naxatw-border-orange-400';
      case 'duplicate':
        return 'naxatw-border-gray-400';
      case 'classifying':
        return 'naxatw-border-blue-400';
      default:
        return 'naxatw-border-gray-300';
    }
  };

  const imagesList = Object.values(images);
  const showProcessingIndicator = (batchStatus?.classifying ?? 0) > 0 || isPolling;

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-6 naxatw-p-6">
      {/* Header Section */}
      <div className="naxatw-flex naxatw-items-center naxatw-justify-between">
        {!jobId && (
          <div className="naxatw-flex naxatw-items-center naxatw-gap-3">
            <button
              onClick={handleStartClassification}
              disabled={startClassificationMutation.isPending || isLoadingStatus || (batchStatus?.staged ?? 0) === 0}
              className="naxatw-rounded naxatw-bg-red naxatw-px-6 naxatw-py-2 naxatw-text-white hover:naxatw-bg-red-600 disabled:naxatw-bg-gray-400 disabled:naxatw-cursor-not-allowed naxatw-transition-colors"
            >
              {startClassificationMutation.isPending ? 'Starting...' : 'Start Classification'}
            </button>
            {isLoadingStatus && (
              <div className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-text-sm naxatw-text-gray-500">
                <div className="naxatw-h-4 naxatw-w-4 naxatw-animate-spin naxatw-rounded-full naxatw-border-2 naxatw-border-gray-300 naxatw-border-t-red"></div>
                <span>Fetching images...</span>
              </div>
            )}
          </div>
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
      {showProcessingIndicator && (
        <div className="naxatw-flex naxatw-items-center naxatw-gap-3 naxatw-rounded naxatw-bg-blue-50 naxatw-p-4">
          <div className="naxatw-h-5 naxatw-w-5 naxatw-animate-spin naxatw-rounded-full naxatw-border-4 naxatw-border-blue-600 naxatw-border-t-transparent"></div>
          <span className="naxatw-text-sm naxatw-text-blue-800">
            Classifying images... This may take a few minutes.
          </span>
        </div>
      )}

      {/* Image Grid */}
      <div className="naxatw-grid naxatw-grid-cols-4 naxatw-gap-3 md:naxatw-grid-cols-6 lg:naxatw-grid-cols-8">
        {imagesList.map((image) => (
          <div
            key={image.id}
            onClick={() => setSelectedImage(image)}
            className={`naxatw-group naxatw-relative naxatw-aspect-square naxatw-cursor-pointer naxatw-overflow-hidden naxatw-rounded-lg naxatw-border-2 ${getBorderColor(image.status)} naxatw-transition-all hover:naxatw-scale-105 hover:naxatw-shadow-lg`}
          >
            {/* Image thumbnail */}
            {image.url ? (
              <img
                src={image.url}
                alt={image.filename}
                className="naxatw-absolute naxatw-inset-0 naxatw-h-full naxatw-w-full naxatw-object-cover"
                loading="lazy"
              />
            ) : (
              <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-gray-200">
                <svg
                  className="naxatw-h-6 naxatw-w-6 naxatw-text-gray-400"
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
            )}

            {/* Status badge */}
            <div className="naxatw-absolute naxatw-top-1 naxatw-right-1">
              <span className={getStatusBadgeClass(image.status)}>
                {getStatusLabel(image.status)}
              </span>
            </div>

            {/* Filename on hover */}
            <div className="naxatw-absolute naxatw-inset-x-0 naxatw-bottom-0 naxatw-bg-black naxatw-bg-opacity-60 naxatw-p-1 naxatw-text-xs naxatw-text-white naxatw-opacity-0 naxatw-transition-opacity group-hover:naxatw-opacity-100">
              <div className="naxatw-truncate">{image.filename}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Loading state */}
      {imagesList.length === 0 && isLoadingImages && (
        <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center naxatw-rounded naxatw-border-2 naxatw-border-dashed naxatw-border-gray-300 naxatw-bg-gray-50">
          <div className="naxatw-text-center">
            <div className="naxatw-mx-auto naxatw-h-12 naxatw-w-12 naxatw-animate-spin naxatw-rounded-full naxatw-border-4 naxatw-border-gray-300 naxatw-border-t-red"></div>
            <p className="naxatw-mt-4 naxatw-text-gray-500">Fetching images...</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {imagesList.length === 0 && !isPolling && !isLoadingImages && (
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
            <p className="naxatw-mt-2 naxatw-text-gray-500">No images found</p>
            <p className="naxatw-text-sm naxatw-text-gray-400">Upload images first to start classification</p>
          </div>
        </div>
      )}

      {/* Image Detail Modal */}
      {selectedImage && (
        <div
          className="naxatw-fixed naxatw-inset-0 naxatw-z-50 naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-black naxatw-bg-opacity-75 naxatw-p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="naxatw-relative naxatw-max-h-[90vh] naxatw-w-full naxatw-max-w-4xl naxatw-overflow-hidden naxatw-rounded-lg naxatw-bg-white naxatw-shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-border-b naxatw-px-6 naxatw-py-4">
              <div className="naxatw-flex naxatw-items-center naxatw-gap-3">
                <h3 className="naxatw-text-lg naxatw-font-semibold naxatw-text-gray-900">
                  {selectedImage.filename}
                </h3>
                <span className={getStatusBadgeClass(selectedImage.status)}>
                  {getStatusLabel(selectedImage.status)}
                </span>
              </div>
              <button
                onClick={() => setSelectedImage(null)}
                className="naxatw-rounded-full naxatw-p-1 naxatw-text-gray-400 hover:naxatw-bg-gray-100 hover:naxatw-text-gray-600"
              >
                <svg className="naxatw-h-6 naxatw-w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div className="naxatw-flex naxatw-flex-col naxatw-gap-6 naxatw-p-6 md:naxatw-flex-row">
              {/* Image */}
              <div className="naxatw-flex-1">
                {selectedImage.url ? (
                  <img
                    src={selectedImage.url}
                    alt={selectedImage.filename}
                    className="naxatw-h-auto naxatw-max-h-[60vh] naxatw-w-full naxatw-rounded-lg naxatw-object-contain"
                  />
                ) : (
                  <div className="naxatw-flex naxatw-h-64 naxatw-items-center naxatw-justify-center naxatw-rounded-lg naxatw-bg-gray-100">
                    <svg className="naxatw-h-16 naxatw-w-16 naxatw-text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="naxatw-w-full naxatw-space-y-4 md:naxatw-w-72">
                <h4 className="naxatw-font-semibold naxatw-text-gray-900">Image Details</h4>

                <div className="naxatw-space-y-3">
                  <div>
                    <span className="naxatw-text-sm naxatw-text-gray-500">Status</span>
                    <div className="naxatw-mt-1">
                      <span className={getStatusBadgeClass(selectedImage.status)}>
                        {getStatusLabel(selectedImage.status)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <span className="naxatw-text-sm naxatw-text-gray-500">Filename</span>
                    <p className="naxatw-mt-1 naxatw-text-sm naxatw-font-medium naxatw-text-gray-900 naxatw-break-all">
                      {selectedImage.filename}
                    </p>
                  </div>

                  <div>
                    <span className="naxatw-text-sm naxatw-text-gray-500">GPS Data</span>
                    <p className="naxatw-mt-1 naxatw-text-sm naxatw-font-medium naxatw-text-gray-900">
                      {selectedImage.has_gps ? (
                        <span className="naxatw-text-green-600">Available</span>
                      ) : (
                        <span className="naxatw-text-red-600">Not Available</span>
                      )}
                    </p>
                  </div>

                  {selectedImage.task_id && (
                    <div>
                      <span className="naxatw-text-sm naxatw-text-gray-500">Assigned Task</span>
                      <p className="naxatw-mt-1 naxatw-text-sm naxatw-font-medium naxatw-text-gray-900">
                        {selectedImage.task_id}
                      </p>
                    </div>
                  )}

                  <div>
                    <span className="naxatw-text-sm naxatw-text-gray-500">Uploaded</span>
                    <p className="naxatw-mt-1 naxatw-text-sm naxatw-font-medium naxatw-text-gray-900">
                      {new Date(selectedImage.uploaded_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Rejection/Classification Reason */}
                {selectedImage.rejection_reason && (
                  <div className="naxatw-rounded-lg naxatw-border naxatw-border-red-200 naxatw-bg-red-50 naxatw-p-4">
                    <h5 className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-font-medium naxatw-text-red-800">
                      <svg className="naxatw-h-5 naxatw-w-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      Classification Issue
                    </h5>
                    <p className="naxatw-mt-2 naxatw-text-sm naxatw-text-red-700">
                      {selectedImage.rejection_reason}
                    </p>
                  </div>
                )}

                {/* Status-specific messages */}
                {selectedImage.status === 'unmatched' && !selectedImage.rejection_reason && (
                  <div className="naxatw-rounded-lg naxatw-border naxatw-border-yellow-200 naxatw-bg-yellow-50 naxatw-p-4">
                    <h5 className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-font-medium naxatw-text-yellow-800">
                      <svg className="naxatw-h-5 naxatw-w-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      No Task Match
                    </h5>
                    <p className="naxatw-mt-2 naxatw-text-sm naxatw-text-yellow-700">
                      The image coordinates do not fall within any task boundary in this project.
                    </p>
                  </div>
                )}

                {selectedImage.status === 'invalid_exif' && !selectedImage.rejection_reason && (
                  <div className="naxatw-rounded-lg naxatw-border naxatw-border-orange-200 naxatw-bg-orange-50 naxatw-p-4">
                    <h5 className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-font-medium naxatw-text-orange-800">
                      <svg className="naxatw-h-5 naxatw-w-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      Missing GPS Data
                    </h5>
                    <p className="naxatw-mt-2 naxatw-text-sm naxatw-text-orange-700">
                      The image does not contain valid GPS coordinates in its EXIF metadata.
                    </p>
                  </div>
                )}

                {selectedImage.status === 'duplicate' && !selectedImage.rejection_reason && (
                  <div className="naxatw-rounded-lg naxatw-border naxatw-border-gray-200 naxatw-bg-gray-50 naxatw-p-4">
                    <h5 className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-font-medium naxatw-text-gray-800">
                      <svg className="naxatw-h-5 naxatw-w-5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z" />
                        <path d="M3 8a2 2 0 012-2v10h8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                      </svg>
                      Duplicate Image
                    </h5>
                    <p className="naxatw-mt-2 naxatw-text-sm naxatw-text-gray-700">
                      This image has already been uploaded to the project.
                    </p>
                  </div>
                )}

                {selectedImage.status === 'assigned' && (
                  <div className="naxatw-rounded-lg naxatw-border naxatw-border-green-200 naxatw-bg-green-50 naxatw-p-4">
                    <h5 className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-font-medium naxatw-text-green-800">
                      <svg className="naxatw-h-5 naxatw-w-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Successfully Assigned
                    </h5>
                    <p className="naxatw-mt-2 naxatw-text-sm naxatw-text-green-700">
                      This image has been matched to a task and is ready for processing.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageClassification;
