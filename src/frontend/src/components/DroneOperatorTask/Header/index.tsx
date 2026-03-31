import BreadCrumb from '@Components/common/Breadcrumb';
import useTaskParams from '@Hooks/useTaskParams';

const DroneOperatorTaskHeader = () => {
  const { projectSlug, taskIndex, taskData } = useTaskParams();

  return (
    <>
      <BreadCrumb
        data={[
          { name: 'Projects', navLink: '/projects' },
          {
            name:
              `${(taskData as any)?.project_name?.slice(0, 8)}${(taskData as any)?.project_name?.length > 8 ? '...' : ''}` ||
              '--',
            navLink: `/projects/${projectSlug}`,
          },
          {
            name: `#${taskIndex}` || '--',
            navLink: '',
          },
        ]}
      />
    </>
  );
};

export default DroneOperatorTaskHeader;
