import { useNavigate } from 'react-router-dom';
import MapSection from './MapSection';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';

interface IProjectCardProps {
  containerId: string;
  id: number;
  title: string;
  description: string;
  geojson: GeojsonType;
}

export default function ProjectCard({
  containerId,
  id,
  title,
  description,
  geojson,
}: IProjectCardProps) {
  const navigate = useNavigate();

  const onProjectCardClick = () => {
    navigate(`/project/${id}`);
  };

  return (
    <div
      onClick={onProjectCardClick}
      className="!naxatw-col-span-1 naxatw-max-h-[19.25rem] naxatw-cursor-pointer naxatw-rounded-md naxatw-border naxatw-border-grey-400 naxatw-p-[0.625rem] hover:naxatw-shadow-lg"
    >
      <MapSection containerId={containerId} geojson={geojson} />
      <p className="naxatw-mt-2 naxatw-text-body-sm">ID: #{id}</p>
      <p className="naxatw-text-body-btn naxatw-text-grey-800">{title}</p>
      <p className="naxatw-line-clamp-4 naxatw-text-body-sm">{description}</p>
    </div>
  );
}
