import { useGetIndividualTaskQuery } from '@Api/tasks';
import { useNavigate, useParams } from 'react-router-dom';

const DroneOperatorTaskHeader = () => {
  const navigate = useNavigate();
  const { taskId } = useParams();

  const { data: taskDescription }: Record<string, any> =
    useGetIndividualTaskQuery(taskId as string);

  return (
    <>
      <div className="naxatw-self-stretch naxatw-py-3">
        <div className="naxatw-flex naxatw-items-center naxatw-gap-1">
          <p
            className="naxatw-cursor-pointer naxatw-text-sm naxatw-font-normal naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#212121] hover:naxatw-underline"
            role="presentation"
            onClick={() => navigate('/projects')}
          >
            Projects
          </p>
          <p className="naxatw-text-sm naxatw-font-normal naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#212121]">
            /
          </p>
          <p className="naxatw-text-sm naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#212121]">
            {taskDescription?.project_name || '-'}
          </p>
        </div>
      </div>
    </>
  );
};

export default DroneOperatorTaskHeader;
