import { useTypedSelector } from '@Store/hooks';
import {
  ProjectCard,
  ProjectsHeader,
  ProjectsMapSection,
} from '@Components/Projects';
import { useGetProjectsListQuery } from '@Api/projects';
import ProjectCardSkeleton from '@Components/Projects/ProjectCardSkeleton';

export default function Projects() {
  const showMap = useTypedSelector(state => state.common.showMap);

  // fetch api for projectsList
  const { data: projectsList, isLoading } = useGetProjectsListQuery();

  return (
    <section className="naxatw-px-16 naxatw-pt-8">
      <ProjectsHeader />
      <div className="naxatw-flex naxatw-flex-col lg:naxatw-flex-row">
        <div className={`${showMap ? 'lg:naxatw-w-[70%]' : ''} `}>
          <div
            className={`naxatw-grid naxatw-gap-5 naxatw-px-[1rem] ${
              !showMap
                ? 'naxatw-grid-cols-1 sm:naxatw-grid-cols-2 md:naxatw-grid-cols-3 lg:naxatw-grid-cols-4 xl:naxatw-grid-cols-5 2xl:naxatw-grid-cols-6'
                : 'lg:scrollbar naxatw-grid-cols-1 sm:naxatw-grid-cols-2 md:naxatw-grid-cols-3 lg:naxatw-h-[75vh] lg:naxatw-grid-cols-2 lg:naxatw-overflow-y-scroll 2xl:naxatw-grid-cols-3'
            }`}
          >
            {isLoading ? (
              <>
                {Array.from({ length: 6 }, (_, index) => (
                  <ProjectCardSkeleton key={index} />
                ))}
              </>
            ) : (
              (projectsList as Record<string, any>[])?.map(
                (singleproject: Record<string, any>) => (
                  <ProjectCard
                    key={singleproject.id}
                    id={singleproject.id}
                    containerId={`map-libre-map-${singleproject.id}`}
                    title={singleproject.name}
                    description={singleproject.description}
                    geojson={singleproject.outline_geojson}
                  />
                ),
              )
            )}
          </div>
        </div>
        {showMap && <ProjectsMapSection />}
      </div>
    </section>
  );
}
