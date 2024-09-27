import { useTypedSelector } from '@Store/hooks';
import {
  ProjectCard,
  ProjectsHeader,
  ProjectsMapSection,
} from '@Components/Projects';
import { useGetProjectsListQuery, useGetUserDetailsQuery } from '@Api/projects';
import ProjectCardSkeleton from '@Components/Projects/ProjectCardSkeleton';
import { useEffect } from 'react';
import { getLocalStorageValue } from '@Utils/getLocalStorageValue';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import { setCreateProjectState } from '@Store/actions/createproject';
import { useDispatch } from 'react-redux';

const Projects = () => {
  const dispatch = useDispatch();
  const showMap = useTypedSelector(state => state.common.showMap);
  const projectsFilterByOwner = useTypedSelector(
    state => state.createproject.ProjectsFilterByOwner,
  );

  // fetch api for projectsList
  const { data: projectsList, isLoading }: Record<string, any> =
    useGetProjectsListQuery(projectsFilterByOwner);

  const { data: userDetails } = useGetUserDetailsQuery();
  const localStorageUserDetails = getLocalStorageValue('userprofile');

  useEffect(() => {
    if (!userDetails || !localStorageUserDetails) return;
    const userDetailsString = JSON.stringify(userDetails);
    localStorage.setItem('userprofile', userDetailsString as string);
  }, [userDetails, localStorageUserDetails]);

  useEffect(() => {
    return () => {
      dispatch(setCreateProjectState({ ProjectsFilterByOwner: 'no' }));
    };
  }, [dispatch]);

  return (
    <section className="naxatw-px-3 naxatw-pt-2 lg:naxatw-px-16">
      <ProjectsHeader />
      <div className="naxatw-grid naxatw-gap-2 md:naxatw-flex md:naxatw-h-[calc(100vh-8.5rem)]">
        <div
          className={`scrollbar naxatw-grid naxatw-grid-rows-[16rem] naxatw-gap-3 naxatw-overflow-y-auto naxatw-py-2 ${showMap ? 'naxatw-w-full naxatw-grid-cols-1 md:naxatw-w-1/2 md:naxatw-grid-cols-2 lg:naxatw-grid-cols-3' : 'naxatw-w-full naxatw-grid-cols-1 sm:naxatw-grid-cols-2 md:naxatw-grid-cols-4 lg:naxatw-grid-cols-6'}`}
          style={{ gridAutoRows: '16rem' }}
        >
          {isLoading ? (
            <>
              {Array.from({ length: 6 }, (_, index) => (
                <ProjectCardSkeleton key={index} />
              ))}
            </>
          ) : (
            <>
              {!projectsList?.length && <div>No projects available</div>}
              {(projectsList as Record<string, any>[])?.map(
                (project: Record<string, any>) => (
                  <ProjectCard
                    key={project.id}
                    id={project.id}
                    imageUrl={project?.image_url}
                    title={project.name}
                    description={project.description}
                  />
                ),
              )}
            </>
          )}
        </div>
        {showMap && (
          <div className="naxatw-h-[70vh] naxatw-w-full naxatw-py-2 md:naxatw-h-full md:naxatw-w-1/2">
            <ProjectsMapSection />
          </div>
        )}
      </div>
    </section>
  );
};

export default hasErrorBoundary(Projects);
