import { stepSwticherData } from '@Constants/createProject';
import CreateprojectLayout from './CreateprojectLayout';
import StepSwitcher from './StepSwitcher';
import CreateProjectHeader from './CreateProjectHeader';

export default function CreateProject() {
  return (
    <section className="naxatw-h-screen-nav naxatw-bg-grey-50 naxatw-px-48 naxatw-pt-5">
      <CreateProjectHeader />
      <StepSwitcher data={stepSwticherData} />
      <CreateprojectLayout />
    </section>
  );
}
