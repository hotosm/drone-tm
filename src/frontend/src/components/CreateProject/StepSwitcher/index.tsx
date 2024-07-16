/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import Icon from '@Components/common/Icon';
import { useTypedSelector } from '@Store/hooks';

interface IIndividualStep {
  url: string;
  step: number;
  label: string;
  name: string;
}

interface IStepSwitcherProps {
  data: IIndividualStep[];
  switchSteps?: any;
}

export default function StepSwitcher({
  data,
  switchSteps,
}: IStepSwitcherProps) {
  const activeStep = useTypedSelector(state => state.createproject.activeStep);
  const toggleStep = () => {};
  return (
    <div className="naxatw-flex naxatw-w-fit naxatw-flex-wrap naxatw-justify-center naxatw-gap-3 naxatw-py-8">
      {data?.map((step: IIndividualStep, i = 1) => {
        const index = i + 1;
        return (
          <div
            key={step.step}
            style={{ animationDelay: `${i * 0.15}s` }}
            className="appear-animation"
          >
            <div className="naxatw-flex naxatw-items-center">
              <div className="naxatw-flex naxatw-flex-col">
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
                    }`}
                    onClick={() => {
                      if (switchSteps) {
                        toggleStep();
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
  );
}
