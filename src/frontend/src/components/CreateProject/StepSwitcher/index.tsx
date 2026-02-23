/**
 * StepSwitcher wrapper for CreateProject that integrates with Redux
 * This component wraps the generic StepSwitcher and connects it to Redux state
 */
import { useTypedSelector } from '@Store/hooks';
import GenericStepSwitcher from '@Components/common/StepSwitcher';

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

const StepSwitcher = ({ data, switchSteps }: IStepSwitcherProps) => {
  const activeStep = useTypedSelector(state => state.createproject.activeStep);

  const handleStepClick = (step: number) => {
    if (switchSteps) {
      switchSteps(step);
    }
  };

  return (
    <GenericStepSwitcher
      data={data}
      activeStep={activeStep}
      onStepClick={switchSteps ? handleStepClick : undefined}
    />
  );
};

export default StepSwitcher;
