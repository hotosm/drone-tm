/* eslint-disable jsx-a11y/interactive-supports-focus */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useGetProjectsDetailQuery } from '@Api/projects';
import Tab from '@Components/common/Tabs';
import {
  Contributions,
  Instructions,
  MapSection,
  Tasks,
} from '@Components/IndividualProject';
import { projectOptions } from '@Constants/index';
import { setProjectState } from '@Store/actions/project';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import { useNavigate, useParams } from 'react-router-dom';

// function to render the content based on active tab
const getActiveTabContent = (
  activeTab: string,
  data: Record<string, any>,
  isProjectDataLoading: boolean,
) => {
  if (activeTab === 'tasks') return <Tasks />;
  if (activeTab === 'instructions')
    return (
      <Instructions
        projectData={data}
        isProjectDataLoading={isProjectDataLoading}
      />
    );
  if (activeTab === 'contributions') return <Contributions />;
  return <></>;
};

const IndividualProject = () => {
  const { id } = useParams();
  const dispatch = useTypedDispatch();
  const navigate = useNavigate();

  const individualProjectActiveTab = useTypedSelector(
    state => state.project.individualProjectActiveTab,
  );

  const { data: projectData, isLoading: isProjectDataLoading } =
    useGetProjectsDetailQuery(id as string, {
      onSuccess: (res: any) => {
        dispatch(
          setProjectState({
            // modify each task geojson and set locked user id and name to properties and save to redux state called taskData
            tasksData: res.tasks?.map((task: Record<string, any>) => ({
              ...task,
              outline: {
                ...task.outline,
                properties: {
                  ...task.outline.properties,
                  locked_user_id: task?.user_id,
                  locked_user_name: task?.name,
                },
              },
            })),
            projectArea: res.outline,
          }),
        );
      },
    });

  return (
    <section className="individual project naxatw-h-screen-nav naxatw-px-3 naxatw-py-8 lg:naxatw-px-20">
      {/* <----------- temporary breadcrumb -----------> */}
      <div className="breadcrumb naxatw-line-clamp-1 naxatw-flex naxatw-py-4">
        <span
          role="button"
          className="naxatw-cursor-pointer naxatw-whitespace-nowrap naxatw-text-body-md"
          onClick={() => {
            navigate('/projects');
          }}
        >
          Project /
        </span>
        <span className="naxatw-ml-1 naxatw-line-clamp-1 naxatw-text-body-md naxatw-font-semibold">
          {
            // @ts-ignore
            projectData?.name || '--'
          }
        </span>
        {/* <----------- temporary breadcrumb -----------> */}
      </div>
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-6 md:naxatw-flex-row">
        <div className="naxatw-order-2 naxatw-w-full naxatw-max-w-[30rem]">
          <Tab
            orientation="row"
            className="naxatw-bg-transparent hover:naxatw-border-b-2 hover:naxatw-border-red"
            activeClassName="naxatw-border-b-2 naxatw-bg-transparent naxatw-border-red"
            onTabChange={(val: any) =>
              dispatch(setProjectState({ individualProjectActiveTab: val }))
            }
            tabOptions={projectOptions}
            activeTab={individualProjectActiveTab}
            clickable
          />
          <div className="naxatw-h-fit naxatw-max-h-[calc(200px)] naxatw-border-t">
            {getActiveTabContent(
              individualProjectActiveTab,
              projectData as Record<string, any>,
              isProjectDataLoading,
            )}
          </div>
        </div>
        <div className="naxatw-order-1 naxatw-h-[calc(100vh-10rem)] naxatw-w-full md:naxatw-order-2">
          <MapSection />
        </div>
      </div>
    </section>
  );
};

export default hasErrorBoundary(IndividualProject);
