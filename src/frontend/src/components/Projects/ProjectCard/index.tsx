import { useNavigate } from 'react-router-dom';

interface IProjectCardProps {
  id: number;
  title: string;
  description: string;
  slug: string;
  imageUrl: string | null;
}

export default function ProjectCard({
  id,
  title,
  description,
  slug,
  imageUrl,
}: IProjectCardProps) {
  const navigate = useNavigate();
  const onProjectCardClick = () => {
    navigate(`/projects/${id}`);
  };

  return (
    <div
      role="presentation"
      onClick={onProjectCardClick}
      className="!naxatw-col-span-1 naxatw-h-[16rem] naxatw-cursor-pointer naxatw-rounded-md naxatw-border naxatw-border-grey-400 naxatw-p-[0.625rem] naxatw-transition-all naxatw-duration-300 naxatw-ease-in-out hover:-naxatw-translate-y-1 hover:naxatw-scale-100 hover:naxatw-shadow-xl"
    >
      <p className="naxatw-flex naxatw-h-[10rem] naxatw-w-full naxatw-items-center naxatw-justify-center naxatw-bg-grey-50">
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
      <p className="naxatw-mt-2 naxatw-line-clamp-1 naxatw-text-body-sm">
        {slug}
      </p>
      <p className="naxatw-line-clamp-1 naxatw-text-body-btn naxatw-text-grey-800">
        {title}
      </p>
      <p className="naxatw-line-clamp-2 naxatw-text-body-sm">{description}</p>
    </div>
  );
}
