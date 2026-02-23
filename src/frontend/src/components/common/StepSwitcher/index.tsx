/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import Icon from '@Components/common/Icon';
import hasErrorBoundary from '@Utils/hasErrorBoundary';

interface IIndividualStep {
  url?: string;
  step: number;
  label: string;
  name: string;
}

interface IStepSwitcherProps {
  data: IIndividualStep[];
  activeStep: number;
  onStepClick?: (step: number) => void;
}

/**
 * Generic StepSwitcher component that works with both local state and Redux.
 *
 * @param data - Array of step objects with label and name
 * @param activeStep - Current active step number (can be from local state or Redux)
 * @param onStepClick - Optional callback when a step is clicked (for enabling step navigation)
 */
const StepSwitcher = ({
  data,
  activeStep,
  onStepClick,
}: IStepSwitcherProps) => {
  return (
    <div className="naxatw-flex naxatw-w-full naxatw-justify-center">
      <div className="naxatw-flex naxatw-w-full naxatw-max-w-[1350px] naxatw-grid-cols-5 naxatw-flex-wrap naxatw-justify-evenly naxatw-gap-3 naxatw-py-4">
        {data?.map((step: IIndividualStep, i = 1) => {
          const index = i + 1;
          return (
            <div
              key={step.step}
              style={{ animationDelay: `${i * 0.15}s` }}
              className="appear-animation"
            >
              <div className="naxatw-flex naxatw-w-full naxatw-items-center">
                <div className="naxatw-flex naxatw-w-full naxatw-flex-col">
                  <div className="naxatw-flex naxatw-items-end naxatw-gap-3">
                    <p className="naxatw-ml-2 naxatw-font-semibold lg:naxatw-text-xl xl:naxatw-text-2xl">
                      {step.label}
                    </p>
                    <p className="naxatw-text-lg naxatw-text-gray-500">
                      {step.name}
                    </p>
                  </div>
                  <div className="naxatw-flex naxatw-items-center">
                    <div
                      className={`${
                        activeStep === index
                          ? 'currentstep-pointer pulse-animation naxatw-border-red'
                          : ''
                      } naxatw-flex naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-border-[0.15rem] lg:naxatw-h-7 lg:naxatw-w-7 xl:naxatw-h-9 xl:naxatw-w-9 ${
                        activeStep > index
                          ? 'naxatw-border-red naxatw-bg-red'
                          : 'naxatw-bg-transparent'
                      } ${onStepClick ? 'naxatw-cursor-pointer' : ''}`}
                      onClick={() => {
                        if (onStepClick) {
                          onStepClick(index);
                        }
                      }}
                    >
                      {activeStep >= index && (
                        <Icon
                          name="check"
                          className={`${
                            activeStep > index
                              ? 'naxatw-text-white'
                              : 'naxatw-text-red'
                          } lg:naxatw-text-lg xl:naxatw-text-xl`}
                        />
                      )}
                    </div>
                    {data?.length > index && (
                      <div
                        className={`naxatw-mx-4 naxatw-w-[6rem] naxatw-border-t-[3px] xl:naxatw-w-[9rem] 2xl:naxatw-w-[12rem] ${
                          activeStep - 1 >= index
                            ? 'naxatw-border-solid naxatw-border-red'
                            : 'naxatw-border-dashed'
                        }`}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default hasErrorBoundary(StepSwitcher);
