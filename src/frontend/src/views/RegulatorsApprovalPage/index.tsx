import { useGetProjectsDetailQuery } from '@Api/projects';
import BindContentContainer from '@Components/common/BindContentContainer';
import BreadCrumb from '@Components/common/Breadcrumb';
import { MapSection } from '@Components/IndividualProject';
import Skeleton from '@Components/RadixComponents/Skeleton';
import DetailsTemplate from '@Components/RegulatorsApprovalPage';
import { setProjectState } from '@Store/actions/project';
import { useTypedDispatch } from '@Store/hooks';
import { useParams } from 'react-router-dom';

const RegulatorsApprovalPage = () => {
  const { id } = useParams();
  const dispatch = useTypedDispatch();

  const { data: projectData, isFetching: isProjectDataFetching }: any =
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
    <BindContentContainer className="naxatw-h-screen-nav naxatw-px-3 naxatw-py-8 lg:naxatw-px-20">
      <BreadCrumb
        data={[
          { name: 'Project', navLink: '/projects' },
          { name: projectData?.name || '', navLink: '' },
        ]}
      />
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-6 md:naxatw-flex-row">
        <DetailsTemplate projectData={projectData} />
        <div className="naxatw-h-[calc(100vh-10rem)] naxatw-w-full">
          {isProjectDataFetching ? (
            <Skeleton className="naxatw-h-full naxatw-w-full" />
          ) : (
            <MapSection projectData={projectData as Record<string, any>} />
          )}
        </div>
      </div>
    </BindContentContainer>
  );
};

export default RegulatorsApprovalPage;
