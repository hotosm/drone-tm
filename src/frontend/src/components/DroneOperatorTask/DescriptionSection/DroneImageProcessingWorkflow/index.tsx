import { useEffect, useCallback, useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import {
  setCurrentStep,
  setBatchId,
  setProjectId,
  resetWorkflow,
} from '@Store/slices/imageProcessingWorkflow';
import Modal from '@Components/common/Modal';
import { Button } from '@Components/RadixComponents/Button';
import StepSwitcher from '@Components/common/StepSwitcher';
import ToolTip from '@Components/RadixComponents/ToolTip';
import { deleteBatch } from '@Services/classification';
import ImageUpload from './ImageUpload';
import ImageClassification from './ImageClassification';
import ImageReview from './ImageReview';

// ─── Upload Imagery Dialog ───────────────────────────────────────────────────
// Steps: Upload → Classify → Review → Finish (moves images to task folders)

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
  const dispatch = useTypedDispatch();
  const { currentStep, batchId, isClassifying, isClassificationComplete } = useTypedSelector(
    (state) => state.imageProcessingWorkflow
  );
  const [showAbortConfirmation, setShowAbortConfirmation] = useState(false);

  const deleteBatchMutation = useMutation({
    mutationFn: () => deleteBatch(projectId, batchId!),
    onSuccess: () => {
      toast.success('Batch deleted successfully');
      setShowAbortConfirmation(false);
      dispatch(resetWorkflow());
      onClose();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete batch');
    },
  });

  useEffect(() => {
    if (projectId) {
      dispatch(setProjectId(projectId));
    }
  }, [projectId, dispatch]);

  useEffect(() => {
    if (isOpen) {
      setShowAbortConfirmation(false);
    }
  }, [isOpen]);

  const steps = [
    { url: '', step: 1, label: '01', name: 'Image Upload', title: 'Upload' },
    { url: '', step: 2, label: '02', name: 'Classification', title: 'Classify' },
    { url: '', step: 3, label: '03', name: 'Review', title: 'Review' },
  ];

  const handleNext = () => {
    if (currentStep < steps.length) {
      dispatch(setCurrentStep(currentStep + 1));
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      dispatch(setCurrentStep(currentStep - 1));
    }
  };

  const handleClose = () => {
    if (batchId && currentStep > 1) {
      setShowAbortConfirmation(true);
      return;
    }
    dispatch(resetWorkflow());
    onClose();
  };

  const handleConfirmAbort = () => {
    if (batchId) {
      deleteBatchMutation.mutate();
    } else {
      dispatch(resetWorkflow());
      onClose();
    }
  };

  const handleFinish = async () => {
    // Images are moved to task folders only when tasks are marked as verified
    // in the Verify Imagery dialog, so no finalization needed here.
    toast.success('Upload complete. Open Verify Imagery to review and mark tasks as fully flown.');
    dispatch(resetWorkflow());
    onClose();
  };

  const handleUploadComplete = useCallback((result: any, uploadedBatchId?: string) => {
    if (uploadedBatchId) {
      dispatch(setBatchId(uploadedBatchId));
      dispatch(setCurrentStep(2));
    }
  }, [dispatch]);

  // Handle upload cancel - clean up batch from database when user cancels via Uppy UI
  const handleUploadCancel = useCallback(async (cancelledBatchId: string) => {
    try {
      await deleteBatch(projectId, cancelledBatchId);
      toast.info('Upload cancelled and batch cleaned up');
    } catch (error) {
      console.error('Failed to clean up cancelled batch:', error);
    }
  }, [projectId]);

  const navigationInfo = useMemo(() => {
    if (currentStep === 1 && !batchId) {
      return { disabled: true, reason: 'Please upload images first' };
    }
    if (currentStep === 2) {
      if (isClassifying) {
        return { disabled: true, reason: 'Classification in progress...' };
      }
      if (!isClassificationComplete) {
        return { disabled: true, reason: 'Please start and complete classification first' };
      }
    }
    if (currentStep === 3 && !isClassificationComplete) {
      return { disabled: true, reason: 'Please complete classification first' };
    }
    return { disabled: false, reason: '' };
  }, [currentStep, batchId, isClassifying, isClassificationComplete]);

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <ImageUpload
            projectId={projectId}
            onUploadComplete={handleUploadComplete}
          />
        );
      case 2:
        return batchId ? (
          <ImageClassification projectId={projectId} batchId={batchId} />
        ) : (
          <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center naxatw-text-gray-500">
            No batch ID available. Please upload images first.
          </div>
        );
      case 3:
        return batchId ? (
          <ImageReview projectId={projectId} batchId={batchId} />
        ) : (
          <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center naxatw-text-gray-500">
            No batch ID available. Please complete classification first.
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
    <Modal
      show={isOpen}
      onClose={handleClose}
      title="Upload Imagery"
      className="!naxatw-max-w-[88vw] !naxatw-w-[88vw] !naxatw-max-h-[90vh] !naxatw-h-[90vh] !naxatw-flex !naxatw-flex-col"
      bodyScrollable={false}
    >
      <div className="naxatw-flex naxatw-h-[calc(90vh-8rem)] naxatw-flex-col naxatw-gap-4">
        <StepSwitcher data={steps} activeStep={currentStep} />

        <div className="naxatw-flex-1 naxatw-min-h-0 naxatw-overflow-y-auto naxatw-pb-4">
          {renderStepContent()}
        </div>

        <div className="naxatw-flex naxatw-w-full naxatw-flex-shrink-0 naxatw-justify-between naxatw-border-t naxatw-pt-4">
          <div className="naxatw-flex naxatw-gap-2">
            <Button
              variant="outline"
              className="naxatw-border-gray-300"
              onClick={handlePrevious}
              disabled={currentStep === 1 || isClassifying}
              leftIcon="chevron_left"
            >
              Previous
            </Button>
            {batchId && currentStep > 1 && (
              <Button
                variant="outline"
                className="naxatw-border-red-300 naxatw-text-red-600 hover:naxatw-bg-red-50"
                onClick={() => setShowAbortConfirmation(true)}
                leftIcon="cancel"
              >
                Abort Process
              </Button>
            )}
          </div>
          <div className="naxatw-flex naxatw-gap-2">
            <Button variant="outline" className="naxatw-border-gray-300" onClick={handleClose}>
              Cancel
            </Button>
            {currentStep < steps.length ? (
              <ToolTip message={navigationInfo.disabled ? navigationInfo.reason : undefined} side="top">
                <div className="naxatw-inline-block">
                  <Button
                    variant="ghost"
                    className="naxatw-bg-red naxatw-text-white"
                    onClick={handleNext}
                    disabled={navigationInfo.disabled}
                    rightIcon="chevron_right"
                  >
                    Next
                  </Button>
                </div>
              </ToolTip>
            ) : (
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white"
                leftIcon="check"
                onClick={handleFinish}
              >
                Finish
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>

      {showAbortConfirmation && (
        <div className="naxatw-fixed naxatw-inset-0 naxatw-z-[10000] naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-black naxatw-bg-opacity-50">
          <div className="naxatw-w-full naxatw-max-w-md naxatw-rounded-lg naxatw-bg-white naxatw-p-6 naxatw-shadow-xl">
            <div className="naxatw-mb-4 naxatw-flex naxatw-items-center naxatw-gap-3">
              <span className="material-icons naxatw-text-3xl naxatw-text-red-500">warning</span>
              <h3 className="naxatw-text-lg naxatw-font-semibold naxatw-text-gray-900">
                Abort Process?
              </h3>
            </div>
            <p className="naxatw-mb-6 naxatw-text-gray-600">
              Are you sure you want to abort? This will permanently delete all images
              in this batch from both the database and storage. This action cannot be undone.
            </p>
            <div className="naxatw-flex naxatw-justify-end naxatw-gap-3">
              <Button
                variant="outline"
                className="naxatw-border-gray-300"
                onClick={() => setShowAbortConfirmation(false)}
                disabled={deleteBatchMutation.isPending}
              >
                Continue Processing
              </Button>
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white hover:naxatw-bg-red-600"
                onClick={handleConfirmAbort}
                disabled={deleteBatchMutation.isPending}
              >
                {deleteBatchMutation.isPending ? 'Deleting...' : 'Delete Batch'}
              </Button>
            </div>
          </div>
        </div>
      )}
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
  if (!isOpen) return null;

  return (
    <Modal
      show={isOpen}
      onClose={onClose}
      title="Verify Imagery"
      className="!naxatw-max-w-[88vw] !naxatw-w-[88vw] !naxatw-max-h-[90vh] !naxatw-h-[90vh] !naxatw-flex !naxatw-flex-col"
      bodyScrollable={false}
    >
      <div className="naxatw-flex naxatw-h-[calc(90vh-8rem)] naxatw-flex-col naxatw-gap-4">
        <div className="naxatw-flex-1 naxatw-min-h-0 naxatw-overflow-y-auto naxatw-pb-4">
          <ImageReview projectId={projectId} />
        </div>

        <div className="naxatw-flex naxatw-w-full naxatw-flex-shrink-0 naxatw-justify-end naxatw-border-t naxatw-pt-4">
          <Button variant="outline" className="naxatw-border-gray-300" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};
