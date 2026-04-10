import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useVirtualizer } from '@tanstack/react-virtual';
import Modal from '@Components/common/Modal';
import { Button } from '@Components/RadixComponents/Button';
import { deleteBatch } from '@Services/classification';
import type { ImageClassificationResult } from '@Services/classification';
import {
  useStartProjectClassificationMutation,
  useIngestExistingUploadsMutation,
  useGetProjectStatusQuery,
  useGetProjectImagesQuery,
} from '@Api/projects';
import ImageUpload from './ImageUpload';
import ImageReview from './ImageReview';

// ─── Upload Imagery Dialog ───────────────────────────────────────────────────
// Upload-only: no step navigation, no classification, no review.
// On close, user can optionally delete the batch or keep images staged.

interface IUploadImageryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

export const UploadImageryDialog = ({
  isOpen,
  onClose,
  projectId,
}: IUploadImageryDialogProps) => {
  const queryClient = useQueryClient();
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [hasUploaded, setHasUploaded] = useState(false);
  const [showAbortConfirmation, setShowAbortConfirmation] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeletingBatches, setIsDeletingBatches] = useState(false);
  const [showIngestButton, setShowIngestButton] = useState(false);
  const [ingestTriggered, setIngestTriggered] = useState(false);

  const ingestMutation = useIngestExistingUploadsMutation({
    onSuccess: () => {
      toast.success('Ingestion job started. Images will appear in the Classify dialog as they are processed.');
      setIngestTriggered(true);
      setHasUploaded(true);
    },
    onError: (error: any) => {
      toast.error(`Ingest failed: ${error?.message || 'Unknown error'}`);
    },
  });

  // Hold Ctrl to reveal the ingest button (same pattern as NodeODM server prompt)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') setShowIngestButton(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') setShowIngestButton(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setShowAbortConfirmation(false);
      setShowDeleteConfirmation(false);
      setIngestTriggered(false);
    }
  }, [isOpen]);

  const handleUploadComplete = useCallback((_result: any, uploadedBatchId?: string) => {
    if (uploadedBatchId) {
      setBatchIds((prev) => prev.includes(uploadedBatchId) ? prev : [...prev, uploadedBatchId]);
    }
    setHasUploaded(true);
  }, []);

  const handleClose = () => {
    if (batchIds.length > 0 && hasUploaded) {
      setShowAbortConfirmation(true);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['project-task-states', projectId] });
    setBatchIds([]);
    setHasUploaded(false);
    onClose();
  };

  const handleKeepAndClose = () => {
    toast.success('Images uploaded. Open Classify Imagery to process them.');
    queryClient.invalidateQueries({ queryKey: ['project-task-states', projectId] });
    setShowAbortConfirmation(false);
    setBatchIds([]);
    setHasUploaded(false);
    onClose();
  };

  const handleDeleteAndClose = async () => {
    if (!showDeleteConfirmation) {
      setShowDeleteConfirmation(true);
      return;
    }
    setShowDeleteConfirmation(false);
    if (batchIds.length > 0) {
      setIsDeletingBatches(true);
      try {
        await Promise.all(batchIds.map((id) => deleteBatch(projectId, id)));
        toast.success('Uploaded images deleted');
        setShowAbortConfirmation(false);
        setBatchIds([]);
        setHasUploaded(false);
        onClose();
      } catch (error: any) {
        toast.error(error?.message || 'Failed to delete some batches');
      } finally {
        setIsDeletingBatches(false);
      }
    } else {
      setBatchIds([]);
      setHasUploaded(false);
      onClose();
    }
  };

  return (
    <>
      <Modal
        show={isOpen}
        onClose={handleClose}
        title="Upload Imagery"
        className="!naxatw-max-w-[88vw] !naxatw-w-[88vw] !naxatw-max-h-[90vh] !naxatw-flex !naxatw-flex-col"
        bodyScrollable={false}
      >
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-4">
          <div className="naxatw-overflow-y-auto naxatw-pb-4">
            <ImageUpload
              projectId={projectId}
              onUploadComplete={handleUploadComplete}
            />
          </div>

          <div className="naxatw-flex naxatw-w-full naxatw-flex-shrink-0 naxatw-items-center naxatw-justify-between naxatw-border-t naxatw-pt-4">
            {(showIngestButton || ingestTriggered) ? (
              <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
                <p className="naxatw-text-xs naxatw-text-gray-500">
                  Already uploaded imagery directly to S3 that you need to ingest?
                </p>
                <Button
                  variant="outline"
                  className="naxatw-w-fit naxatw-border-gray-300 naxatw-text-sm"
                  onClick={() => ingestMutation.mutate({ projectId })}
                  disabled={ingestMutation.isPending || ingestTriggered}
                  leftIcon="cloud_sync"
                >
                  {ingestTriggered ? 'Ingestion Started' : ingestMutation.isPending ? 'Starting...' : 'Ingest Existing S3 Imagery'}
                </Button>
              </div>
            ) : (
              <div />
            )}
            <Button
              variant="ghost"
              className="naxatw-bg-red naxatw-text-white"
              onClick={handleClose}
            >
              Continue
            </Button>
          </div>
        </div>
      </Modal>

      {showAbortConfirmation && (
        <div className="naxatw-fixed naxatw-inset-0 naxatw-z-[10000] naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-black naxatw-bg-opacity-50">
          <div className="naxatw-w-full naxatw-max-w-md naxatw-rounded-lg naxatw-bg-white naxatw-p-6 naxatw-shadow-xl">
            <div className="naxatw-mb-4 naxatw-flex naxatw-items-center naxatw-gap-3">
              <span className="material-icons naxatw-text-3xl naxatw-text-amber-500">help_outline</span>
              <h3 className="naxatw-text-lg naxatw-font-semibold naxatw-text-gray-900">
                Keep uploaded images?
              </h3>
            </div>
            <p className="naxatw-mb-6 naxatw-text-gray-600">
              You have uploaded images in this session. Would you like to keep them for
              classification later, or delete them?
            </p>
            <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
              {showDeleteConfirmation && (
                <div className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-rounded naxatw-border naxatw-border-red-300 naxatw-bg-red-50 naxatw-p-3 naxatw-text-sm naxatw-text-red-700">
                  <span className="material-icons naxatw-text-base naxatw-text-red-500">warning</span>
                  Are you sure? This cannot be undone.
                </div>
              )}
              <div className="naxatw-flex naxatw-justify-end naxatw-gap-3">
                {showDeleteConfirmation ? (
                  <>
                    <Button
                      variant="outline"
                      className="naxatw-border-gray-300"
                      onClick={() => setShowDeleteConfirmation(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteAndClose}
                      disabled={isDeletingBatches}
                      leftIcon="delete_forever"
                    >
                      {isDeletingBatches ? 'Deleting...' : 'Yes, Delete Images'}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="naxatw-border-red-300 naxatw-text-red-600 hover:naxatw-bg-red-50"
                      onClick={handleDeleteAndClose}
                      disabled={isDeletingBatches}
                      leftIcon="delete"
                    >
                      {isDeletingBatches ? 'Deleting...' : 'Delete Images'}
                    </Button>
                    <Button
                      variant="ghost"
                      className="naxatw-bg-red naxatw-text-white"
                      onClick={handleKeepAndClose}
                      leftIcon="check"
                    >
                      Keep Images
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};


// ─── Classify Imagery Dialog ─────────────────────────────────────────────────
// Project-scoped classification: classifies ALL staged images across all batches.

const COLUMNS = 8;
const ROW_HEIGHT = 120;

interface IClassifyImageryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

export const ClassifyImageryDialog = ({
  isOpen,
  onClose,
  projectId,
}: IClassifyImageryDialogProps) => {
  const queryClient = useQueryClient();
  const [images, setImages] = useState<Record<string, ImageClassificationResult>>({});
  const [lastUpdateTime, setLastUpdateTime] = useState<string | undefined>();
  const [isPolling, setIsPolling] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setImages({});
      setLastUpdateTime(undefined);
      setIsPolling(false);
      setHasStarted(false);
      setIsComplete(false);
    }
  }, [isOpen]);

  const startClassificationMutation = useStartProjectClassificationMutation({
    onSuccess: () => {
      // Set a floor timestamp so post-start polling only fetches images
      // classified after this moment, not the entire project history.
      setLastUpdateTime(new Date().toISOString());
      setHasStarted(true);
      setIsPolling(true);
      toast.info('Classification started. Processing images...');
    },
    onError: (error: any) => {
      toast.error(`Failed to start classification: ${error?.message || 'Unknown error'}`);
    },
  });

  // Query for project status - only poll while classification is running
  const {
    data: projectStatus,
    isLoading: isLoadingStatus,
    isError: isErrorStatus,
    error: errorStatus,
  } = useGetProjectStatusQuery(projectId, {
    enabled: !!projectId && isOpen,
    refetchInterval: isPolling ? 10000 : false,
  });

  // Before classification: only fetch pending images (cheap).
  // During/after polling: no status filter - the classified_at cursor handles incremental updates.
  const imageStatusFilter = useMemo(
    () => (hasStarted ? undefined : ['staged', 'uploaded', 'classifying']),
    [hasStarted],
  );

  // Query for project images - only poll while classification is running
  const {
    data: newImages,
    isLoading: isLoadingImages,
    isError: isErrorImages,
    error: errorImages,
  } = useGetProjectImagesQuery(projectId, lastUpdateTime, {
    enabled: !!projectId && isOpen,
    refetchInterval: isPolling ? 10000 : false,
  }, imageStatusFilter);

  // Update images state when new data arrives
  useEffect(() => {
    if (newImages && newImages.length > 0) {
      setImages((prev) => {
        const updated = { ...prev };
        newImages.forEach((img) => { updated[img.id] = img; });
        return updated;
      });

      // Advance the polling cursor using classified_at (matches backend filter).
      // Only consider images that have a classified_at timestamp.
      const latestClassifiedAt = newImages.reduce((latest, img) => {
        const ts = img.classified_at;
        if (ts && ts > latest) return ts;
        return latest;
      }, lastUpdateTime || '');
      if (latestClassifiedAt) {
        setLastUpdateTime(latestClassifiedAt);
      }
    }
  }, [newImages, lastUpdateTime]);

  // Stop polling when classification is complete
  useEffect(() => {
    if (projectStatus && isPolling) {
      const total = projectStatus.total ?? 0;
      const classified =
        (projectStatus.assigned ?? 0) +
        (projectStatus.rejected ?? 0) +
        (projectStatus.unmatched ?? 0) +
        (projectStatus.invalid_exif ?? 0) +
        (projectStatus.duplicate ?? 0);
      const remaining =
        (projectStatus.staged ?? 0) +
        (projectStatus.uploaded ?? 0) +
        (projectStatus.classifying ?? 0);

      if (total > 0 && classified === total && remaining === 0) {
        // Fire one final images fetch so the last batch of results lands
        // before we stop the polling interval.
        queryClient.invalidateQueries({ queryKey: ['project-images', projectId] });
        setIsPolling(false);
        setIsComplete(true);
        toast.success('Classification complete! Review the results below.');
      }
    }
  }, [projectStatus, isPolling, queryClient, projectId]);

  const handleStartClassification = useCallback(() => {
    startClassificationMutation.mutate({ projectId });
  }, [projectId, startClassificationMutation]);

  const handleClose = () => {
    queryClient.invalidateQueries({ queryKey: ['project-task-states', projectId] });
    onClose();
  };

  // Status badge helpers
  const getStatusBadgeClass = (status: string): string => {
    const baseClass = 'naxatw-inline-flex naxatw-items-center naxatw-rounded-full naxatw-px-2 naxatw-py-0.5 naxatw-text-xs naxatw-font-medium naxatw-shadow-sm';
    switch (status) {
      case 'assigned': return `${baseClass} naxatw-bg-green-500 naxatw-text-white`;
      case 'rejected': return `${baseClass} naxatw-bg-red naxatw-text-white`;
      case 'unmatched': return `${baseClass} naxatw-bg-yellow-500 naxatw-text-white`;
      case 'invalid_exif': return `${baseClass} naxatw-bg-orange-500 naxatw-text-white`;
      case 'duplicate': return `${baseClass} naxatw-bg-gray-500 naxatw-text-white`;
      case 'classifying': return `${baseClass} naxatw-bg-blue-500 naxatw-text-white naxatw-animate-pulse`;
      case 'uploaded': return `${baseClass} naxatw-bg-gray-400 naxatw-text-white`;
      case 'staged':
      default: return `${baseClass} naxatw-bg-gray-300 naxatw-text-gray-700`;
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'assigned': return 'Assigned';
      case 'rejected': return 'Rejected';
      case 'unmatched': return 'No Match';
      case 'invalid_exif': return 'Invalid EXIF';
      case 'duplicate': return 'Duplicate';
      case 'classifying': return 'Processing...';
      case 'uploaded': return 'Ready';
      case 'staged':
      default: return 'Staged';
    }
  };

  const getBorderColor = (status: string): string => {
    switch (status) {
      case 'assigned': return 'naxatw-border-green-400';
      case 'rejected': return 'naxatw-border-red-400';
      case 'unmatched': return 'naxatw-border-yellow-400';
      case 'invalid_exif': return 'naxatw-border-orange-400';
      case 'duplicate': return 'naxatw-border-gray-400';
      case 'classifying': return 'naxatw-border-blue-400';
      default: return 'naxatw-border-gray-300';
    }
  };

  const ACTIVE_STATUSES = new Set(['staged', 'uploaded', 'classifying']);
  const allImages = Object.values(images);
  // Before classification: only show pending images (from status-filtered fetch).
  // After classification starts: show all images in local state - the classified_at
  // cursor ensures only this run's results accumulate, and the pre-start pending
  // images are already present from the initial fetch.
  const imagesList = hasStarted
    ? allImages
    : allImages.filter((img) => ACTIVE_STATUSES.has(img.status));
  const isClassifying = (projectStatus?.classifying ?? 0) > 0 || isPolling;

  const computedStats = useMemo(() => {
    if (!projectStatus) return null;
    const uploaded = (projectStatus.staged ?? 0) + (projectStatus.uploaded ?? 0);
    const processing = projectStatus.classifying ?? 0;
    const complete = projectStatus.assigned ?? 0;
    const issues = (projectStatus.rejected ?? 0) + (projectStatus.unmatched ?? 0) + (projectStatus.invalid_exif ?? 0);
    const duplicates = projectStatus.duplicate ?? 0;
    const totalClassified = complete + issues + duplicates;
    const issuePercentage = totalClassified > 0 ? (issues / totalClassified) * 100 : 0;
    return { uploaded, processing, complete, issues, duplicates, totalClassified, issuePercentage };
  }, [projectStatus]);

  const isClassificationComplete = computedStats && computedStats.processing === 0 && computedStats.uploaded === 0 && computedStats.totalClassified > 0;
  const hasHighIssueRate = isClassificationComplete && computedStats.issuePercentage >= 50;

  // Sync completion state
  useEffect(() => {
    if (isClassificationComplete && !isComplete && hasStarted) {
      setIsComplete(true);
    }
  }, [isClassificationComplete, isComplete, hasStarted]);

  // Virtualization
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const result: ImageClassificationResult[][] = [];
    for (let i = 0; i < imagesList.length; i += COLUMNS) {
      result.push(imagesList.slice(i, i + COLUMNS));
    }
    return result;
  }, [imagesList]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
  });

  const renderValue = (value: number, showSpinner: boolean, colorClass: string = '') => {
    if (value === 0 && showSpinner) {
      return (
        <div className="naxatw-flex naxatw-items-center naxatw-justify-center">
          <div className="naxatw-h-5 naxatw-w-5 naxatw-animate-spin naxatw-rounded-full naxatw-border-2 naxatw-border-gray-300 naxatw-border-t-blue-600"></div>
        </div>
      );
    }
    return <div className={`naxatw-text-2xl naxatw-font-bold ${colorClass}`}>{value}</div>;
  };

  if (!isOpen) return null;

  return (
    <>
      <Modal
        show={isOpen}
        onClose={handleClose}
        title="Classify Imagery"
        className="!naxatw-max-w-[88vw] !naxatw-w-[88vw] !naxatw-max-h-[90vh] !naxatw-h-[90vh] !naxatw-flex !naxatw-flex-col"
        bodyScrollable={false}
      >
        <div className="naxatw-flex naxatw-h-[calc(90vh-8rem)] naxatw-flex-col naxatw-gap-4">
          <div className="naxatw-flex naxatw-flex-1 naxatw-min-h-0 naxatw-flex-col naxatw-gap-6 naxatw-pb-4">
              {/* Error States */}
              {(isErrorStatus || isErrorImages) && (
                <div className="naxatw-flex naxatw-flex-shrink-0 naxatw-items-center naxatw-gap-3 naxatw-rounded naxatw-border naxatw-border-red-300 naxatw-bg-red-50 naxatw-p-4 naxatw-text-red-700">
                  <span className="material-icons">error</span>
                  <div>
                    <p className="naxatw-font-semibold">Failed to fetch update</p>
                    <p className="naxatw-text-sm">{(errorStatus || errorImages)?.message || 'An unknown error occurred'}</p>
                  </div>
                </div>
              )}

              {/* Header Section */}
              <div className="naxatw-flex naxatw-flex-shrink-0 naxatw-items-center naxatw-justify-between">
                {!hasStarted && (
                  <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
                    <div className="naxatw-mb-2 naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-text-amber-600">
                      <span className="material-icons naxatw-text-sm">info</span>
                      <span className="naxatw-text-sm naxatw-font-medium">
                        This will classify all pending images in the project across all upload sessions.
                      </span>
                    </div>
                    <div className="naxatw-flex naxatw-items-center naxatw-gap-3">
                      <button
                        onClick={handleStartClassification}
                        disabled={startClassificationMutation.isPending || isLoadingStatus || isLoadingImages || isPolling || ((projectStatus?.staged ?? 0) + (projectStatus?.uploaded ?? 0)) === 0}
                        className="naxatw-rounded naxatw-bg-red naxatw-px-8 naxatw-py-3 naxatw-text-lg naxatw-font-bold naxatw-text-white hover:naxatw-bg-red-600 disabled:naxatw-bg-gray-400 disabled:naxatw-cursor-not-allowed naxatw-transition-all naxatw-shadow-md active:naxatw-scale-95"
                      >
                        {startClassificationMutation.isPending ? (
                          <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                            <div className="naxatw-h-5 naxatw-w-5 naxatw-animate-spin naxatw-rounded-full naxatw-border-2 naxatw-border-white naxatw-border-t-transparent"></div>
                            <span>Starting...</span>
                          </div>
                        ) : (
                          'Start Classification'
                        )}
                      </button>
                      {(isLoadingStatus || isLoadingImages) && (
                        <div className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-text-sm naxatw-text-gray-500">
                          <div className="naxatw-h-4 naxatw-w-4 naxatw-animate-spin naxatw-rounded-full naxatw-border-2 naxatw-border-gray-300 naxatw-border-t-red"></div>
                          <span>Fetching images...</span>
                        </div>
                      )}
                      {((projectStatus?.staged ?? 0) + (projectStatus?.uploaded ?? 0)) === 0 && !isLoadingStatus && (
                        <span className="naxatw-text-sm naxatw-text-gray-500">No pending images to classify.</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Status Summary */}
              {computedStats && (
                <div className="naxatw-flex-shrink-0 naxatw-rounded naxatw-bg-gray-50 naxatw-p-4">
                  {isClassifying && projectStatus && (projectStatus.total ?? 0) > 0 && (
                    <div className="naxatw-mb-4">
                      <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-mb-2">
                        <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                          <div className="naxatw-h-4 naxatw-w-4 naxatw-animate-spin naxatw-rounded-full naxatw-border-2 naxatw-border-gray-300 naxatw-border-t-blue-600"></div>
                          <span className="naxatw-text-sm naxatw-font-medium naxatw-text-blue-700">Classifying images...</span>
                        </div>
                        <span className="naxatw-text-sm naxatw-font-semibold naxatw-text-gray-700">
                          {computedStats.totalClassified} / {projectStatus.total ?? 0}
                        </span>
                      </div>
                      <div className="naxatw-w-full naxatw-bg-gray-200 naxatw-rounded-full naxatw-h-2.5 naxatw-overflow-hidden">
                        <div
                          className="naxatw-bg-blue-600 naxatw-h-2.5 naxatw-rounded-full naxatw-transition-all naxatw-duration-500"
                          style={{ width: `${Math.round((computedStats.totalClassified / (projectStatus.total ?? 1)) * 100)}%` }}
                        ></div>
                      </div>
                      <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-gray-500">
                        {computedStats.processing > 0 && `${computedStats.processing} currently processing. `}
                        Updates every 10 seconds.
                      </p>
                    </div>
                  )}

                  <div className="naxatw-grid naxatw-grid-cols-2 naxatw-gap-4 sm:naxatw-grid-cols-3 md:naxatw-grid-cols-5">
                    <div className="naxatw-text-center">
                      {renderValue(computedStats.uploaded, isClassifying, 'naxatw-text-gray-500')}
                      <div className="naxatw-text-sm naxatw-text-gray-600">Pending</div>
                    </div>
                    <div className="naxatw-text-center">
                      {renderValue(computedStats.processing, isClassifying, 'naxatw-text-blue-600')}
                      <div className="naxatw-text-sm naxatw-text-gray-600">Processing</div>
                    </div>
                    <div className="naxatw-text-center">
                      {renderValue(computedStats.complete, isClassifying, 'naxatw-text-green-600')}
                      <div className="naxatw-text-sm naxatw-text-gray-600">No Issues</div>
                    </div>
                    <div className="naxatw-text-center">
                      {renderValue(computedStats.issues, isClassifying, 'naxatw-text-orange-600')}
                      <div className="naxatw-text-sm naxatw-text-gray-600">Issues</div>
                    </div>
                    <div className="naxatw-text-center">
                      {renderValue(computedStats.duplicates, isClassifying, 'naxatw-text-gray-600')}
                      <div className="naxatw-text-sm naxatw-text-gray-600">Duplicates</div>
                    </div>
                  </div>
                </div>
              )}

              {/* High issue rate warning */}
              {hasHighIssueRate && computedStats && (
                <div className="naxatw-flex naxatw-flex-shrink-0 naxatw-items-start naxatw-gap-3 naxatw-rounded naxatw-border naxatw-border-amber-300 naxatw-bg-amber-50 naxatw-p-4">
                  <span className="material-icons naxatw-text-amber-600">warning</span>
                  <div>
                    <p className="naxatw-font-semibold naxatw-text-amber-800">Dataset Quality Warning</p>
                    <p className="naxatw-text-sm naxatw-text-amber-700">
                      {computedStats.issuePercentage.toFixed(0)}% of your images ({computedStats.issues} out of {computedStats.totalClassified}) have issues.
                    </p>
                  </div>
                </div>
              )}

              {/* Virtualized Image Grid */}
              {imagesList.length > 0 && (
                <p className="naxatw-mb-2 naxatw-flex-shrink-0 naxatw-text-xs naxatw-text-gray-500">
                  Classification results shown below. Use the Verify dialog to inspect and handle issues.
                </p>
              )}
              {imagesList.length > 0 && (
                <div
                  ref={parentRef}
                  className="naxatw-flex-1 naxatw-min-h-0 naxatw-overflow-auto naxatw-rounded naxatw-border naxatw-border-gray-200"
                >
                  <div
                    style={{
                      height: `${rowVirtualizer.getTotalSize()}px`,
                      width: '100%',
                      position: 'relative',
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const rowImages = rows[virtualRow.index];
                      return (
                        <div
                          key={virtualRow.key}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                          className="naxatw-flex naxatw-gap-3 naxatw-px-2"
                        >
                          {rowImages.map((image) => (
                            <div
                              key={image.id}
                              className={`naxatw-group naxatw-relative naxatw-h-[108px] naxatw-w-[calc(12.5%-10px)] naxatw-overflow-hidden naxatw-rounded-lg naxatw-border-2 ${getBorderColor(image.status)} naxatw-transition-all hover:naxatw-scale-105 hover:naxatw-shadow-lg`}
                            >
                              {(image.thumbnail_url || image.url) ? (
                                <>
                                  <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-gray-100">
                                    <div className="naxatw-h-6 naxatw-w-6 naxatw-animate-spin naxatw-rounded-full naxatw-border-2 naxatw-border-gray-300 naxatw-border-t-red"></div>
                                  </div>
                                  <img
                                    src={image.thumbnail_url || image.url}
                                    alt={image.filename}
                                    className="naxatw-absolute naxatw-inset-0 naxatw-h-full naxatw-w-full naxatw-object-cover naxatw-bg-white"
                                    loading="lazy"
                                  />
                                </>
                              ) : (
                                <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-gray-200">
                                  <svg className="naxatw-h-6 naxatw-w-6 naxatw-text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                                  </svg>
                                </div>
                              )}
                              <div className="naxatw-absolute naxatw-top-1 naxatw-right-1">
                                <span className={getStatusBadgeClass(image.status)}>{getStatusLabel(image.status)}</span>
                              </div>
                              <div className="naxatw-absolute naxatw-inset-x-0 naxatw-bottom-0 naxatw-bg-black naxatw-bg-opacity-60 naxatw-p-1 naxatw-text-xs naxatw-text-white naxatw-opacity-0 naxatw-transition-opacity group-hover:naxatw-opacity-100">
                                <div className="naxatw-truncate">{image.filename}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {imagesList.length === 0 && (
                <div className="naxatw-flex naxatw-flex-1 naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
                  {isLoadingStatus ? (
                    <div className="naxatw-text-center">
                      <div className="naxatw-mx-auto naxatw-h-12 naxatw-w-12 naxatw-animate-spin naxatw-rounded-full naxatw-border-4 naxatw-border-gray-300 naxatw-border-t-red"></div>
                      <p className="naxatw-mt-4 naxatw-text-gray-500">Loading images...</p>
                    </div>
                  ) : (
                    <div className="naxatw-text-center">
                      <span className="material-icons naxatw-text-4xl naxatw-text-gray-400">image_not_supported</span>
                      <p className="naxatw-mt-2 naxatw-text-gray-500">No new imagery to classify.</p>
                      <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-gray-400">
                        Upload images first, then return here to classify them.
                      </p>
                    </div>
                  )}
                </div>
              )}
          </div>

          <div className="naxatw-flex naxatw-w-full naxatw-flex-shrink-0 naxatw-justify-end naxatw-border-t naxatw-pt-4">
            <Button variant="outline" className="naxatw-border-gray-300" onClick={handleClose}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

    </>
  );
};


// ─── Verify Imagery Dialog ───────────────────────────────────────────────────
// Standalone dialog that shows project-level ImageReview (aggregated across all
// batches) with task verification capabilities.

interface IVerifyImageryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

export const VerifyImageryDialog = ({
  isOpen,
  onClose,
  projectId,
}: IVerifyImageryDialogProps) => {
  const queryClient = useQueryClient();

  const handleClose = () => {
    queryClient.invalidateQueries({ queryKey: ['project-task-states', projectId] });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal
      show={isOpen}
      onClose={handleClose}
      title="Verify Imagery"
      className="!naxatw-max-w-[88vw] !naxatw-w-[88vw] !naxatw-max-h-[90vh] !naxatw-h-[90vh] !naxatw-flex !naxatw-flex-col"
      bodyScrollable={false}
    >
      <div className="naxatw-flex naxatw-h-[calc(90vh-8rem)] naxatw-flex-col naxatw-gap-4">
        <div className="naxatw-flex-1 naxatw-min-h-0 naxatw-overflow-y-auto naxatw-pb-4">
          <ImageReview projectId={projectId} />
        </div>

        <div className="naxatw-flex naxatw-w-full naxatw-flex-shrink-0 naxatw-justify-end naxatw-border-t naxatw-pt-4">
          <Button variant="outline" className="naxatw-border-gray-300" onClick={handleClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};
