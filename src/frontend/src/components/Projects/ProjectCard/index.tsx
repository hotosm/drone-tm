/* eslint-disable no-nested-ternary */
import StatusChip from '@Components/common/Chip/StatusChip';
import { useNavigate } from 'react-router-dom';

interface IProjectCardProps {
  id: number;
  title: string;
  description: string;
  imageUrl: string | null;
  totalTasks: number;
  status: string;
  slug: string;
  completedTask: number;
}

export default function ProjectCard({
  id,
  title,
  description,
  imageUrl,
  totalTasks,
  status,
  slug,
  completedTask,
}: IProjectCardProps) {
  const navigate = useNavigate();
  const onProjectCardClick = () => {
    navigate(`/projects/${id}`);
  };

  return (
    <div
      role="presentation"
      onClick={onProjectCardClick}
      className="naxatw-relative !naxatw-col-span-1 naxatw-cursor-pointer naxatw-rounded-md naxatw-border naxatw-border-grey-400 naxatw-p-[0.625rem] naxatw-transition-all naxatw-duration-300 naxatw-ease-in-out hover:-naxatw-translate-y-1 hover:naxatw-scale-100 hover:naxatw-shadow-xl"
    >
      <p className="naxatw-flex naxatw-h-[10rem] naxatw-w-full naxatw-items-center naxatw-justify-center naxatw-overflow-hidden naxatw-rounded-lg naxatw-bg-grey-50">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="project-boundary"
            className="naxatw-h-full naxatw-w-full naxatw-object-cover"
          />
        ) : (
          <i className="material-icons-outlined naxatw-text-[140px] naxatw-text-gray-500">
            image
          </i>
        )}
      </p>
      <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-py-2">
        <p className="naxatw-mt-2 naxatw-line-clamp-1 naxatw-flex-grow naxatw-text-body-sm">
          ID:#{slug}
        </p>
        <div className="naxatw-flex naxatw-w-20 naxatw-items-center naxatw-justify-end">
          {status === 'not-started' ? (
            <StatusChip color="#808080" text={status} />
          ) : status === 'ongoing' ? (
            <StatusChip color="#417EC9" text={status} />
          ) : (
            <StatusChip color="#028a0f" text={status} />
          )}
        </div>
      </div>
      <p className="naxatw-line-clamp-1 naxatw-text-body-btn naxatw-text-grey-800">
        {title}
      </p>
      <p className="naxatw-line-clamp-2 naxatw-text-body-sm">{description}</p>
      <div className="naxatw-absolute naxatw-bottom-2 naxatw-left-0 naxatw-w-full naxatw-px-3 naxatw-py-1">
        <div className="naxatw-flex naxatw-items-end naxatw-justify-start naxatw-px-1">
          <p className="naxatw-font-semibold naxatw-text-red">
            {completedTask}
          </p>{' '}
          <p>/</p>
          <p>{totalTasks}</p> <p className="naxatw-pl-2">Tasks Completed</p>
        </div>
        <div className="naxatw-h-1 naxatw-w-full naxatw-overflow-hidden naxatw-rounded-xl naxatw-bg-gray-200">
          <div
            className="naxatw-h-1 naxatw-bg-red"
            style={{ width: `${(completedTask / totalTasks) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
