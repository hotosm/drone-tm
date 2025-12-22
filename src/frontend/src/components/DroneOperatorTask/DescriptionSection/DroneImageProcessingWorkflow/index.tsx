import { useEffect, useCallback, useState } from 'react';
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
import { deleteBatch } from '@Services/classification';
import ImageUpload from './ImageUpload';
import ImageClassification from './ImageClassification';
import ImageReview from './ImageReview';
import ImageProcessing from './ImageProcessing';

interface IDroneImageProcessingWorkflowProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

const DroneImageProcessingWorkflow = ({
  isOpen,
  onClose,
  projectId,
}: IDroneImageProcessingWorkflowProps) => {
  const dispatch = useTypedDispatch();
  const { currentStep, batchId, isClassifying } = useTypedSelector(
    (state) => state.imageProcessingWorkflow
  );
  const [showAbortConfirmation, setShowAbortConfirmation] = useState(false);

  // Mutation to delete batch
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

  // Set project ID when component mounts or projectId changes
  useEffect(() => {
    if (projectId) {
      dispatch(setProjectId(projectId));
    }
  }, [projectId, dispatch]);

  // Reset abort confirmation state when modal opens
  useEffect(() => {
    if (isOpen) {
      setShowAbortConfirmation(false);
    }
  }, [isOpen]);

  const steps = [
    { url: '', step: 1, label: '01', name: 'Image Upload', title: 'Upload' },
    { url: '', step: 2, label: '02', name: 'Classification', title: 'Classify' },
    { url: '', step: 3, label: '03', name: 'Review', title: 'Review' },
    { url: '', step: 4, label: '04', name: 'Processing', title: 'Process' },
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
    // If there's a batch in progress (after upload step), show confirmation
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

  const handleCancelAbort = () => {
    setShowAbortConfirmation(false);
  };

  // Handle upload complete - store batch ID and move to classification
  const handleUploadComplete = useCallback((result: any, uploadedBatchId?: string) => {
    if (uploadedBatchId) {
      dispatch(setBatchId(uploadedBatchId));
      // Automatically move to classification step
      dispatch(setCurrentStep(2));
    }
  }, [dispatch]);

  // Should proceed to the next step
  const handleNextButton = () => {
    // Disable Next button on step 1 if no batch ID
    if (currentStep === 1 && !batchId) {
      return true;
    }
    // Disable Next button if currently classifying
    if (isClassifying) {
      return true;
    }
    return false;
  }

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
          <ImageClassification
            projectId={projectId}
            batchId={batchId}
          />
        ) : (
          <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center naxatw-text-gray-500">
            No batch ID available. Please upload images first.
          </div>
        );
      case 3:
        return batchId ? (
          <ImageReview
            projectId={projectId}
            batchId={batchId}
          />
        ) : (
          <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center naxatw-text-gray-500">
            No batch ID available. Please complete classification first.
          </div>
        );
      case 4:
        return batchId ? (
          <ImageProcessing
            projectId={projectId}
            batchId={batchId}
          />
        ) : (
          <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center naxatw-text-gray-500">
            No batch ID available. Please complete the previous steps first.
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
      title="Drone Image Processing Workflow"
      className="!naxatw-max-w-[80vw] !naxatw-w-[80vw] !naxatw-max-h-[85vh] !naxatw-h-[85vh] !naxatw-flex !naxatw-flex-col"
    >
      <div className="naxatw-flex naxatw-h-[calc(85vh-8rem)] naxatw-flex-col naxatw-gap-4">
        {/* Step Indicator */}
        <StepSwitcher data={steps} activeStep={currentStep} />

        {/* Content */}
        <div className="naxatw-flex-1 naxatw-min-h-0 naxatw-overflow-y-auto naxatw-pb-4">
          {renderStepContent()}
        </div>

        {/* Footer */}
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
            <Button
              variant="outline"
              className="naxatw-border-gray-300"
              onClick={handleClose}
            >
              Cancel
            </Button>
            {currentStep < steps.length ? (
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white"
                onClick={handleNext}
                disabled={handleNextButton()}
                rightIcon="chevron_right"
              >
                Next
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white"
                leftIcon="check"
                onClick={handleClose}
              >
                Finish
              </Button>
            )}
          </div>
        </div>
      </div>

    </Modal>

      {/* Abort Confirmation Dialog */}
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
                onClick={handleCancelAbort}
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

export default DroneImageProcessingWorkflow;
