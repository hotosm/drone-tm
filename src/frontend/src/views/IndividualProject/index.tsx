/* eslint-disable jsx-a11y/interactive-supports-focus */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import centroid from '@turf/centroid';
import html2canvas from 'html2canvas';
import {
  useGetProjectsDetailQuery,
  useGetUserDetailsQuery,
} from '@Api/projects';
import BreadCrumb from '@Components/common/Breadcrumb';
import Tab from '@Components/common/Tabs';
import {
  Contributions,
  Instructions,
  MapSection,
  Tasks,
} from '@Components/IndividualProject';
import ExportSection from '@Components/IndividualProject/ExportSection';
import GcpEditor from '@Components/IndividualProject/GcpEditor';
import ProjectPromptDialog from '@Components/IndividualProject/ModalContent';
import DeleteProjectPromptDialog from '@Components/IndividualProject/ModalContent/DeleteProjectConfirmation';
import { Button } from '@Components/RadixComponents/Button';
import Skeleton from '@Components/RadixComponents/Skeleton';
import DescriptionSection from '@Components/RegulatorsApprovalPage/Description/DescriptionSection';
import { projectOptions } from '@Constants/index';
import { deleteProject } from '@Services/project';
import { setProjectState } from '@Store/actions/project';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import hasErrorBoundary from '@Utils/hasErrorBoundary';

// eslint-disable-next-line camelcase
const { BASE_URL } = process.env;

// function to render the content based on active tab
const getActiveTabContent = (
  activeTab: string,
  data: Record<string, any>,
  isProjectDataLoading: boolean,
  // eslint-disable-next-line no-unused-vars
  handleTableRowClick: (rowData: any) => {},
) => {
  if (activeTab === 'about')
    return (
      <DescriptionSection
        projectData={data}
        isProjectDataLoading={isProjectDataLoading}
        page="project-description"
      />
    );
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const dispatch = useTypedDispatch();
  const exportRef = useRef<any>(null);
  const [exportingContent, setExportingContent] = useState(false);
  const [showProjectDeletePrompt, setShowProjectDeletePrompt] = useState(false);

  const individualProjectActiveTab = useTypedSelector(
    state => state.project.individualProjectActiveTab,
  );
  const tasksList = useTypedSelector(state => state.project.tasksData);
  const showGcpEditor = useTypedSelector(state => state.project.showGcpEditor);

  const { data: userDetails }: Record<string, any> = useGetUserDetailsQuery();

  const {
    data: projectData,
    isFetching: isProjectDataFetching,
  }: Record<string, any> = useGetProjectsDetailQuery(id as string);
  useEffect(() => {
    if (projectData) {
      dispatch(
        setProjectState({
          // modify each task geojson and set locked user id and name to properties and save to redux state called taskData
          tasksData: projectData.tasks?.map((task: Record<string, any>) => ({
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
          projectArea: projectData.outline,
        }),
      );
    }
  }, [projectData, dispatch]);

  const { mutate, isPending } = useMutation({
    mutationFn: (projectId: string) => deleteProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects-list'] });
      toast.error('Project Deleted Successfully');
      navigate('/projects');
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

  useEffect(() => {
    return () => {
      dispatch(setProjectState({}));
      dispatch(setProjectState({ showGcpEditor: false }));
      queryClient.removeQueries({ queryKey: ['project-detail', id] });
    };
  }, [dispatch, queryClient, id]);

  const handleDeleteProject = () => {
    mutate(id as string);
  };

  return (
    <>
      <section className="individual project naxatw-h-screen-nav naxatw-px-3 naxatw-py-8 lg:naxatw-px-20">
        <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-py-3">
          <BreadCrumb
            data={[
              { name: 'Project', navLink: '/projects' },
              { name: projectData?.name || '--', navLink: '' },
            ]}
          />
          <div className="naxatw-flex naxatw-gap-5">
            <Button
              leftIcon="download"
              size="sm"
              className="naxatw-border naxatw-bg-redlight !naxatw-text-red hover:naxatw-border-red"
              title="Download Project Details"
              withLoader
              isLoading={exportingContent}
              onClick={() => {
                setExportingContent(true);
                setTimeout(() => {
                  html2canvas(exportRef?.current).then((canvas: any) => {
                    const link = document.createElement('a');
                    link.download = `${projectData?.name}.png`;
                    link.href = canvas.toDataURL();
                    link.click();
                  });
                  setExportingContent(false);
                }, 1000);
              }}
            >
              Export
            </Button>
          </div>
        </div>
        {showGcpEditor ? (
          <div className="naxatw-relative naxatw-h-full naxatw-bg-slate-300">
            <button
              type="button"
              className="material-icons naxatw-absolute naxatw-right-4 naxatw-top-2 naxatw-cursor-pointer hover:naxatw-text-red"
              onClick={() => {
                dispatch(setProjectState({ showGcpEditor: false }));
              }}
            >
              close
            </button>
            <GcpEditor
              finalButtonText="Start Final Processing"
              // handleProcessingStart={handleStartProcessingClick}
              // eslint-disable-next-line camelcase
              rawImageUrl={`${BASE_URL}/gcp/find-project-images/?project_id=${id}`}
            />
          </div>
        ) : (
          <div className="naxatw-flex naxatw-flex-col naxatw-gap-6 md:naxatw-flex-row">
            <div className="naxatw-relative naxatw-order-2 naxatw-w-full naxatw-max-w-[30rem] naxatw-pb-20">
              <Tab
                orientation="row"
                className="naxatw-bg-transparent hover:naxatw-border-b-2 hover:naxatw-border-red"
                activeClassName="naxatw-border-b-2 naxatw-bg-transparent naxatw-border-red"
                onTabChange={(val: string | number) =>
                  dispatch(
                    setProjectState({
                      individualProjectActiveTab: String(val),
                    }),
                  )
                }
                tabOptions={projectOptions}
                activeTab={individualProjectActiveTab}
                clickable
              />
              <div className="naxatw-h-fit naxatw-max-h-[calc(100vh-280px)] naxatw-overflow-y-auto naxatw-border-t">
                {getActiveTabContent(
                  individualProjectActiveTab,
                  projectData as Record<string, any>,
                  isProjectDataFetching,
                  handleTableRowClick,
                )}
              </div>
              <div className="naxatw-absolute naxatw-bottom-0 naxatw-flex naxatw-w-full naxatw-justify-center">
                {projectData?.author_id === userDetails?.id && (
                  <Button
                    leftIcon="delete"
                    size="default"
                    className="naxatw-border naxatw-bg-gray-500 naxatw-px-2"
                    title="Delete Project"
                    withLoader
                    isLoading={exportingContent}
                    onClick={() => {
                      setShowProjectDeletePrompt(true);
                    }}
                  >
                    Delete Project
                  </Button>
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
        )}
      </section>
      <div
        className={`naxatw-absolute naxatw-left-0 naxatw-top-0 naxatw-h-full naxatw-w-full naxatw-opacity-0 ${exportingContent ? 'naxatw-flex' : 'naxatw-hidden'}`}
      >
        <div
          className="naxatw-flex naxatw-w-full naxatw-max-w-[600px] naxatw-justify-center"
          ref={exportRef}
        >
          <ExportSection projectData={projectData} />
        </div>
      </div>

      <ProjectPromptDialog
        title="Delete Project"
        show={showProjectDeletePrompt}
        onClose={() => setShowProjectDeletePrompt(false)}
      >
        <DeleteProjectPromptDialog
          projectName={projectData?.name || ''}
          isLoading={isPending}
          handleDeleteProject={handleDeleteProject}
          setShowUnlockDialog={setShowProjectDeletePrompt}
        />
      </ProjectPromptDialog>
    </>
  );
};

export default hasErrorBoundary(IndividualProject);
