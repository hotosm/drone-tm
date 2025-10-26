import { useState } from 'react';
import Modal from '@Components/common/Modal';
import { Button } from '@Components/RadixComponents/Button';
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
  const [currentStep, setCurrentStep] = useState(1);

  const steps = [
    { id: 1, title: 'Image Upload', label: 'Upload' },
    { id: 2, title: 'Classification', label: 'Classify' },
    { id: 3, title: 'Review', label: 'Review' },
    { id: 4, title: 'Processing', label: 'Process' },
  ];

  const handleNext = () => {
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleClose = () => {
    setCurrentStep(1);
    onClose();
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return <ImageUpload projectId={projectId} />;
      case 2:
        return <ImageClassification />;
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
      className="!naxatw-max-w-[80vw] !naxatw-w-[80vw] !naxatw-max-h-[75vh] !naxatw-h-[75vh]"
    >
      <div className="naxatw-flex naxatw-h-full naxatw-flex-col naxatw-gap-4">
        {/* Step Indicator */}
        <div className="naxatw-flex naxatw-w-full naxatw-items-center naxatw-justify-between">
          {steps.map((step, index) => (
            <div key={step.id} className="naxatw-flex naxatw-flex-1 naxatw-items-center">
              <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-2">
                <div
                  className={`naxatw-flex naxatw-h-10 naxatw-w-10 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-border-2 ${
                    currentStep === step.id
                      ? 'naxatw-border-red naxatw-bg-red naxatw-text-white'
                      : currentStep > step.id
                        ? 'naxatw-border-green-500 naxatw-bg-green-500 naxatw-text-white'
                        : 'naxatw-border-gray-300 naxatw-bg-white naxatw-text-gray-400'
                  }`}
                >
                  {currentStep > step.id ? (
                    <span className="material-icons naxatw-text-[1.25rem]">check</span>
                  ) : (
                    <span className="naxatw-font-semibold">{step.id}</span>
                  )}
                </div>
                <p
                  className={`naxatw-text-xs naxatw-font-medium ${
                    currentStep === step.id
                      ? 'naxatw-text-[#D73F3F]'
                      : 'naxatw-text-gray-500'
                  }`}
                >
                  {step.label}
                </p>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`naxatw-mx-2 naxatw-h-0.5 naxatw-flex-1 ${
                    currentStep > step.id
                      ? 'naxatw-bg-green-500'
                      : 'naxatw-bg-gray-300'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

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
            disabled={currentStep === 1}
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
