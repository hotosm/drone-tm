import { useEffect, useCallback } from 'react';
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

  // Set project ID when component mounts or projectId changes
  useEffect(() => {
    if (projectId) {
      dispatch(setProjectId(projectId));
    }
  }, [projectId, dispatch]);

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
    dispatch(resetWorkflow());
    onClose();
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
        return <ImageReview />;
      case 4:
        return <ImageProcessing />;
      default:
        return null;
    }
  };

  return (
    <Modal
      show={isOpen}
      onClose={handleClose}
      title="Drone Image Processing Workflow"
      className="!naxatw-max-w-[80vw] !naxatw-w-[80vw] !naxatw-max-h-[85vh] !naxatw-h-[85vh] !naxatw-flex !naxatw-flex-col"
    >
      <div className="naxatw-flex naxatw-h-[calc(85vh-8rem)] naxatw-flex-col naxatw-gap-4">
        {/* Step Indicator */}
        <StepSwitcher data={steps} activeStep={currentStep} />

        {/* Step Title */}
        <div className="naxatw-border-b naxatw-pb-3">
          <h3 className="naxatw-text-lg naxatw-font-semibold naxatw-text-[#D73F3F]">
            {steps[currentStep - 1].title}
          </h3>
        </div>

        {/* Content */}
        <div className="naxatw-flex-1 naxatw-min-h-0 naxatw-overflow-y-auto naxatw-pb-4">
          {renderStepContent()}
        </div>

        {/* Footer */}
        <div className="naxatw-flex naxatw-w-full naxatw-flex-shrink-0 naxatw-justify-between naxatw-border-t naxatw-pt-4">
          <Button
            variant="outline"
            className="naxatw-border-gray-300"
            onClick={handlePrevious}
            disabled={currentStep === 1 || isClassifying}
            leftIcon="chevron_left"
          >
            Previous
          </Button>
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
  );
};

export default DroneImageProcessingWorkflow;
