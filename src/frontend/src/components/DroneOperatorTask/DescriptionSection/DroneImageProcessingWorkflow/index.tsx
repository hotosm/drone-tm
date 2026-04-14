import { useEffect, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import Modal from "@Components/common/Modal";
import { Button } from "@Components/RadixComponents/Button";
import { deleteBatch } from "@Services/classification";
import {
  useStartProjectClassificationMutation,
  useIngestExistingUploadsMutation,
  useGetProjectStatusQuery,
  useResetStaleClassificationMutation,
} from "@Api/projects";
import ImageUpload from "./ImageUpload";
import ImageReview from "./ImageReview";

// ─── Upload Imagery Dialog ───────────────────────────────────────────────────
// Upload-only: no step navigation, no classification, no review.
// On close, user can optionally delete the batch or keep images staged.

interface IUploadImageryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

export const UploadImageryDialog = ({ isOpen, onClose, projectId }: IUploadImageryDialogProps) => {
  const queryClient = useQueryClient();
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [hasUploaded, setHasUploaded] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showAbortConfirmation, setShowAbortConfirmation] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeletingBatches, setIsDeletingBatches] = useState(false);
  const [showIngestButton, setShowIngestButton] = useState(false);
  const [ingestTriggered, setIngestTriggered] = useState(false);

  const ingestMutation = useIngestExistingUploadsMutation({
    onSuccess: () => {
      toast.success(
        "Ingestion job started. Images will appear in the Classify dialog as they are processed.",
      );
      setIngestTriggered(true);
      setHasUploaded(true);
    },
    onError: (error: any) => {
      toast.error(`Ingest failed: ${error?.message || "Unknown error"}`);
    },
  });

  // Hold Ctrl to reveal the ingest button (same pattern as NodeODM server prompt)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control") setShowIngestButton(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") setShowIngestButton(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setShowAbortConfirmation(false);
      setShowDeleteConfirmation(false);
      setIngestTriggered(false);
    }
  }, [isOpen]);

  const handleUploadStart = useCallback(() => {
    setIsUploading(true);
  }, []);

  const handleUploadComplete = useCallback((_result: any, uploadedBatchId?: string) => {
    if (uploadedBatchId) {
      setBatchIds((prev) => (prev.includes(uploadedBatchId) ? prev : [...prev, uploadedBatchId]));
    }
    setIsUploading(false);
    setHasUploaded(true);
  }, []);

  const handleClose = () => {
    if (batchIds.length > 0 && hasUploaded) {
      setShowAbortConfirmation(true);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["project-task-states", projectId] });
    setBatchIds([]);
    setHasUploaded(false);
    onClose();
  };

  const handleKeepAndClose = () => {
    toast.success("Images uploaded. Open Classify Imagery to process them.");
    queryClient.invalidateQueries({ queryKey: ["project-task-states", projectId] });
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
        toast.success("Uploaded images deleted");
        setShowAbortConfirmation(false);
        setBatchIds([]);
        setHasUploaded(false);
        onClose();
      } catch (error: any) {
        toast.error(error?.message || "Failed to delete some batches");
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
              onUploadStart={handleUploadStart}
              onUploadComplete={handleUploadComplete}
            />
          </div>

          {hasUploaded && !isUploading && (
            <div className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-rounded naxatw-border naxatw-border-green-300 naxatw-bg-green-50 naxatw-px-4 naxatw-py-3 naxatw-text-sm naxatw-text-green-800">
              <span className="material-icons naxatw-text-base naxatw-text-green-600">
                check_circle
              </span>
              Upload successful. Click Continue to finalise.
            </div>
          )}

          <div className="naxatw-flex naxatw-w-full naxatw-flex-shrink-0 naxatw-items-center naxatw-justify-between naxatw-border-t naxatw-pt-4">
            {showIngestButton || ingestTriggered ? (
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
                  {ingestTriggered
                    ? "Ingestion Started"
                    : ingestMutation.isPending
                      ? "Starting..."
                      : "Ingest Existing S3 Imagery"}
                </Button>
              </div>
            ) : (
              <div />
            )}
            <Button
              variant="ghost"
              className="naxatw-bg-red naxatw-text-white"
              onClick={handleClose}
              disabled={isUploading || !hasUploaded}
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
              <span className="material-icons naxatw-text-3xl naxatw-text-amber-500">
                help_outline
              </span>
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
                  <span className="material-icons naxatw-text-base naxatw-text-red-500">
                    warning
                  </span>
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
                      {isDeletingBatches ? "Deleting..." : "Yes, Delete Images"}
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
                      {isDeletingBatches ? "Deleting..." : "Delete Images"}
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
// Shows only progress counts and status - no image thumbnails.

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
  const [isPolling, setIsPolling] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setIsPolling(false);
      setHasStarted(false);
      setIsComplete(false);
    }
  }, [isOpen]);

  const startClassificationMutation = useStartProjectClassificationMutation({
    onSuccess: () => {
      setHasStarted(true);
      setIsPolling(true);
      toast.info("Classification started. Processing images...");
    },
    onError: (error: any) => {
      toast.error(`Failed to start classification: ${error?.message || "Unknown error"}`);
    },
  });

  const resetStaleMutation = useResetStaleClassificationMutation({
    onSuccess: (data) => {
      if (data.reset_count > 0) {
        toast.success(`Reset ${data.reset_count} stuck image(s). You can now re-classify.`);
      } else {
        toast.info("No stuck images found. Try starting classification again.");
      }
      setIsPolling(false);
      setHasStarted(false);
      setIsComplete(false);
      queryClient.invalidateQueries({ queryKey: ["project-imagery-status", projectId] });
    },
    onError: (error: any) => {
      toast.error(`Failed to reset: ${error?.message || "Unknown error"}`);
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

  // Auto-start polling when dialog opens only if classification is already running
  useEffect(() => {
    if (projectStatus && !isPolling && !isComplete) {
      const currentlyClassifying = (projectStatus.classifying ?? 0) > 0;
      if (currentlyClassifying) {
        setIsPolling(true);
        setHasStarted(true);
      }
    }
  }, [projectStatus, isPolling, isComplete]);

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
        setIsPolling(false);
        setIsComplete(true);
        toast.success("Classification complete! Use the Verify dialog to review results.");
      }
    }
  }, [projectStatus, isPolling]);

  const handleStartClassification = useCallback(() => {
    startClassificationMutation.mutate({ projectId });
  }, [projectId, startClassificationMutation]);

  const handleClose = () => {
    queryClient.invalidateQueries({ queryKey: ["project-task-states", projectId] });
    onClose();
  };

  const isClassifying = (projectStatus?.classifying ?? 0) > 0 || isPolling;

  const computedStats = useMemo(() => {
    if (!projectStatus) return null;
    const uploaded = (projectStatus.staged ?? 0) + (projectStatus.uploaded ?? 0);
    const processing = projectStatus.classifying ?? 0;
    const complete = projectStatus.assigned ?? 0;
    const issues =
      (projectStatus.rejected ?? 0) +
      (projectStatus.unmatched ?? 0) +
      (projectStatus.invalid_exif ?? 0);
    const duplicates = projectStatus.duplicate ?? 0;
    const totalClassified = complete + issues + duplicates;
    const issuePercentage = totalClassified > 0 ? (issues / totalClassified) * 100 : 0;
    return { uploaded, processing, complete, issues, duplicates, totalClassified, issuePercentage };
  }, [projectStatus]);

  const isClassificationComplete =
    computedStats &&
    computedStats.processing === 0 &&
    computedStats.uploaded === 0 &&
    computedStats.totalClassified > 0;
  const hasHighIssueRate = isClassificationComplete && computedStats.issuePercentage >= 50;

  // Sync completion state
  useEffect(() => {
    if (isClassificationComplete && !isComplete && hasStarted) {
      setIsComplete(true);
    }
  }, [isClassificationComplete, isComplete, hasStarted]);

  const renderValue = (value: number, showSpinner: boolean, colorClass: string = "") => {
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
        className="!naxatw-max-w-[600px] !naxatw-w-[600px] !naxatw-flex !naxatw-flex-col"
        bodyScrollable={false}
      >
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-4 naxatw-pb-4">
          {/* Error States */}
          {isErrorStatus && (
            <div className="naxatw-flex naxatw-flex-shrink-0 naxatw-items-center naxatw-gap-3 naxatw-rounded naxatw-border naxatw-border-red-300 naxatw-bg-red-50 naxatw-p-4 naxatw-text-red-700">
              <span className="material-icons">error</span>
              <div>
                <p className="naxatw-font-semibold">Failed to fetch update</p>
                <p className="naxatw-text-sm">
                  {errorStatus?.message || "An unknown error occurred"}
                </p>
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
                    disabled={
                      startClassificationMutation.isPending ||
                      isLoadingStatus ||
                      isPolling ||
                      (projectStatus?.staged ?? 0) + (projectStatus?.uploaded ?? 0) === 0
                    }
                    className="naxatw-rounded naxatw-bg-red naxatw-px-8 naxatw-py-3 naxatw-text-lg naxatw-font-bold naxatw-text-white hover:naxatw-bg-red-600 disabled:naxatw-bg-gray-400 disabled:naxatw-cursor-not-allowed naxatw-transition-all naxatw-shadow-md active:naxatw-scale-95"
                  >
                    {startClassificationMutation.isPending ? (
                      <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                        <div className="naxatw-h-5 naxatw-w-5 naxatw-animate-spin naxatw-rounded-full naxatw-border-2 naxatw-border-white naxatw-border-t-transparent"></div>
                        <span>Starting...</span>
                      </div>
                    ) : (
                      "Start Classification"
                    )}
                  </button>
                  {isLoadingStatus && (
                    <div className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-text-sm naxatw-text-gray-500">
                      <div className="naxatw-h-4 naxatw-w-4 naxatw-animate-spin naxatw-rounded-full naxatw-border-2 naxatw-border-gray-300 naxatw-border-t-red"></div>
                      <span>Loading...</span>
                    </div>
                  )}
                  {(projectStatus?.staged ?? 0) + (projectStatus?.uploaded ?? 0) === 0 &&
                    !isLoadingStatus && (
                      <span className="naxatw-text-sm naxatw-text-gray-500">
                        No pending images to classify.
                      </span>
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
                      <span className="naxatw-text-sm naxatw-font-medium naxatw-text-blue-700">
                        Classifying images...
                      </span>
                    </div>
                    <span className="naxatw-text-sm naxatw-font-semibold naxatw-text-gray-700">
                      {computedStats.totalClassified} / {projectStatus.total ?? 0}
                    </span>
                  </div>
                  <div className="naxatw-w-full naxatw-bg-gray-200 naxatw-rounded-full naxatw-h-2.5 naxatw-overflow-hidden">
                    <div
                      className="naxatw-bg-blue-600 naxatw-h-2.5 naxatw-rounded-full naxatw-transition-all naxatw-duration-500"
                      style={{
                        width: `${Math.round((computedStats.totalClassified / (projectStatus.total ?? 1)) * 100)}%`,
                      }}
                    ></div>
                  </div>
                  <div className="naxatw-mt-1 naxatw-flex naxatw-items-center naxatw-justify-between">
                    <p className="naxatw-text-xs naxatw-text-gray-500">
                      {computedStats.processing > 0 &&
                        `${computedStats.processing} currently processing. `}
                      Updates every 10 seconds.
                    </p>
                    <button
                      onClick={() => resetStaleMutation.mutate({ projectId })}
                      disabled={resetStaleMutation.isPending}
                      className="naxatw-flex naxatw-items-center naxatw-gap-1 naxatw-rounded naxatw-border naxatw-border-amber-300 naxatw-bg-amber-50 naxatw-px-2 naxatw-py-1 naxatw-text-xs naxatw-font-medium naxatw-text-amber-700 hover:naxatw-bg-amber-100 disabled:naxatw-opacity-50 disabled:naxatw-cursor-not-allowed naxatw-transition-colors"
                      title="Reset images stuck in classification for more than 10 minutes"
                    >
                      <span className="material-icons naxatw-text-sm">refresh</span>
                      {resetStaleMutation.isPending ? "Resetting..." : "Reset Stuck"}
                    </button>
                  </div>
                </div>
              )}

              <div className="naxatw-grid naxatw-grid-cols-2 naxatw-gap-4 sm:naxatw-grid-cols-3 md:naxatw-grid-cols-5">
                <div className="naxatw-text-center">
                  {renderValue(computedStats.uploaded, isClassifying, "naxatw-text-gray-500")}
                  <div className="naxatw-text-sm naxatw-text-gray-600">Pending</div>
                </div>
                <div className="naxatw-text-center">
                  {renderValue(computedStats.processing, isClassifying, "naxatw-text-blue-600")}
                  <div className="naxatw-text-sm naxatw-text-gray-600">Processing</div>
                </div>
                <div className="naxatw-text-center">
                  {renderValue(computedStats.complete, isClassifying, "naxatw-text-green-600")}
                  <div className="naxatw-text-sm naxatw-text-gray-600">No Issues</div>
                </div>
                <div className="naxatw-text-center">
                  {renderValue(computedStats.issues, isClassifying, "naxatw-text-orange-600")}
                  <div className="naxatw-text-sm naxatw-text-gray-600">Issues</div>
                </div>
                <div className="naxatw-text-center">
                  {renderValue(computedStats.duplicates, isClassifying, "naxatw-text-gray-600")}
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
                <p className="naxatw-font-semibold naxatw-text-amber-800">
                  Dataset Quality Warning
                </p>
                <p className="naxatw-text-sm naxatw-text-amber-700">
                  {computedStats.issuePercentage.toFixed(0)}% of your images ({computedStats.issues}{" "}
                  out of {computedStats.totalClassified}) have issues.
                </p>
              </div>
            </div>
          )}

          {/* Completion message */}
          {isComplete && (
            <div className="naxatw-flex naxatw-items-center naxatw-gap-3 naxatw-rounded naxatw-border naxatw-border-green-300 naxatw-bg-green-50 naxatw-p-4">
              <span className="material-icons naxatw-text-green-600">check_circle</span>
              <div>
                <p className="naxatw-font-semibold naxatw-text-green-800">
                  Classification Complete
                </p>
                <p className="naxatw-text-sm naxatw-text-green-700">
                  Close this dialog and open Verify Imagery to review results and inspect any
                  issues.
                </p>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!computedStats && !isLoadingStatus && (
            <div className="naxatw-flex naxatw-items-center naxatw-justify-center naxatw-py-8">
              <div className="naxatw-text-center">
                <span className="material-icons naxatw-text-4xl naxatw-text-gray-400">
                  image_not_supported
                </span>
                <p className="naxatw-mt-2 naxatw-text-gray-500">No new imagery to classify.</p>
                <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-gray-400">
                  Upload images first, then return here to classify them.
                </p>
              </div>
            </div>
          )}

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

export const VerifyImageryDialog = ({ isOpen, onClose, projectId }: IVerifyImageryDialogProps) => {
  const queryClient = useQueryClient();

  const handleClose = () => {
    queryClient.invalidateQueries({ queryKey: ["project-task-states", projectId] });
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
