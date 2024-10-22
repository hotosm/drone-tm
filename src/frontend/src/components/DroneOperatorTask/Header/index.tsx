import { useGetIndividualTaskQuery } from '@Api/tasks';
import BreadCrumb from '@Components/common/Breadcrumb';
import { useParams } from 'react-router-dom';

const DroneOperatorTaskHeader = () => {
  const { taskId, projectId } = useParams();

  const { data: taskDescription }: Record<string, any> =
    useGetIndividualTaskQuery(taskId as string);

  return (
    <>
      <BreadCrumb
        data={[
          { name: 'Projects', navLink: '/projects' },
          {
            name:
              `${taskDescription?.project_name?.slice(0, 8)}${taskDescription?.project_name?.length > 8 ? '...' : ''}` ||
              '--',
            navLink: `/projects/${projectId}`,
          },
          {
            name: `#${taskDescription?.project_task_index}` || '--',
            navLink: '',
          },
        ]}
      />
    </>
  );
};

export default DroneOperatorTaskHeader;
