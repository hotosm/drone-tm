/* eslint-disable jsx-a11y/interactive-supports-focus */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useGetProjectsDetailQuery } from '@Api/projects';
import BreadCrumb from '@Components/common/Breadcrumb';
import Tab from '@Components/common/Tabs';
import {
  Contributions,
  Instructions,
  MapSection,
  Tasks,
} from '@Components/IndividualProject';
import Skeleton from '@Components/RadixComponents/Skeleton';
import DescriptionSection from '@Components/RegulatorsApprovalPage/Description/DescriptionSection';
import { projectOptions } from '@Constants/index';
import { setProjectState } from '@Store/actions/project';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import centroid from '@turf/centroid';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import { useParams } from 'react-router-dom';

// function to render the content based on active tab
const getActiveTabContent = (
  activeTab: string,
  data: Record<string, any>,
  isProjectDataLoading: boolean,
  // eslint-disable-next-line no-unused-vars
  handleTableRowClick: (rowData: any) => {},
) => {
  if (activeTab === 'about')
    return <DescriptionSection projectData={data} page="project-description" />;
  if (activeTab === 'tasks')
    return (
      <Tasks
        isFetching={isProjectDataLoading}
        handleTableRowClick={handleTableRowClick}
      />
    );
  if (activeTab === 'instructions')
    return (
      <Instructions
        projectData={data}
        isProjectDataLoading={isProjectDataLoading}
      />
    );
  if (activeTab === 'contributions')
    return (
      <Contributions
        isFetching={isProjectDataLoading}
        handleTableRowClick={handleTableRowClick}
      />
    );
  return <></>;
};

const IndividualProject = () => {
  const { id } = useParams();
  const dispatch = useTypedDispatch();

  const individualProjectActiveTab = useTypedSelector(
    state => state.project.individualProjectActiveTab,
  );
  const tasksList = useTypedSelector(state => state.project.tasksData);

  const {
    data: projectData,
    isFetching: isProjectDataFetching,
  }: Record<string, any> = useGetProjectsDetailQuery(id as string, {
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

  const handleTableRowClick = (taskData: any) => {
    const clickedTask = tasksList?.find(
      (task: Record<string, any>) => taskData?.task_id === task?.id,
    );
    const taskDetailToSave = {
      id: clickedTask?.id,
      locked_user_id: clickedTask?.user_id,
      locked_user_name: clickedTask?.name,
      centroidCoordinates: centroid(clickedTask?.outline).geometry.coordinates,
    };

    dispatch(
      setProjectState({
        taskClickedOnTable: taskDetailToSave,
      }),
    );

    return {};
  };

  return (
    <section className="individual project naxatw-h-screen-nav naxatw-px-3 naxatw-py-8 lg:naxatw-px-20">
      <BreadCrumb
        data={[
          { name: 'Project', navLink: '/projects' },
          { name: projectData?.name || '--', navLink: '' },
        ]}
      />
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-6 md:naxatw-flex-row">
        <div className="naxatw-order-2 naxatw-w-full naxatw-max-w-[30rem]">
          <Tab
            orientation="row"
            className="naxatw-bg-transparent hover:naxatw-border-b-2 hover:naxatw-border-red"
            activeClassName="naxatw-border-b-2 naxatw-bg-transparent naxatw-border-red"
            onTabChange={(val: string | number) =>
              dispatch(
                setProjectState({ individualProjectActiveTab: String(val) }),
              )
            }
            tabOptions={projectOptions}
            activeTab={individualProjectActiveTab}
            clickable
          />
          <div className="naxatw-h-fit naxatw-max-h-[calc(200px)] naxatw-border-t">
            {getActiveTabContent(
              individualProjectActiveTab,
              projectData as Record<string, any>,
              isProjectDataFetching,
              handleTableRowClick,
            )}
          </div>
        </div>

        <div className="naxatw-order-1 naxatw-h-[calc(100vh-10rem)] naxatw-w-full md:naxatw-order-2">
          {isProjectDataFetching ? (
            <Skeleton className="naxatw-h-full naxatw-w-full" />
          ) : (
            <MapSection projectData={projectData as Record<string, any>} />
          )}
        </div>
      </div>
    </section>
  );
};

export default hasErrorBoundary(IndividualProject);
