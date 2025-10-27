import { stepSwitcherData } from '@Constants/createProject';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import CreateprojectLayout from './CreateprojectLayout';
import StepSwitcher from './StepSwitcher';
import CreateProjectHeader from './CreateProjectHeader';

const CreateProject = () => {
  return (
    <section className="naxatw-flex naxatw-h-screen-nav naxatw-flex-col naxatw-bg-grey-50 naxatw-px-8 naxatw-pt-5 xl:naxatw-px-16">
      <CreateProjectHeader />
      <StepSwitcher data={stepSwitcherData} />
      <CreateprojectLayout />
    </section>
  );
};

export default hasErrorBoundary(CreateProject);
