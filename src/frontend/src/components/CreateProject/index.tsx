import { stepSwticherData } from '@Constants/createProject';
import CreateprojectLayout from './CreateprojectLayout';
import StepSwitcher from './StepSwitcher';
import CreateProjectHeader from './CreateProjectHeader';

export default function CreateProject() {
  return (
    <section className="naxatw-flex naxatw-h-screen-nav naxatw-flex-col naxatw-bg-grey-50 naxatw-px-32 naxatw-pt-5 xl:naxatw-px-48">
      <CreateProjectHeader />
      <StepSwitcher data={stepSwticherData} />
      <CreateprojectLayout />
    </section>
  );
}
