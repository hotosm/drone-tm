import { useGetProjectsDetailQuery } from '@Api/projects';
import BindContentContainer from '@Components/common/BindContentContainer';
import BreadCrumb from '@Components/common/Breadcrumb';
import { MapSection } from '@Components/IndividualProject';
import Skeleton from '@Components/RadixComponents/Skeleton';
import DetailsTemplate from '@Components/RegulatorsApprovalPage';
import useAuth from '@Hooks/useAuth';
import { regulatorUser } from '@Services/createproject';
import { setProjectState } from '@Store/actions/project';
import { useTypedDispatch } from '@Store/hooks';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';

const RegulatorsApprovalPage = () => {
  const { id } = useParams();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const token = queryParams.get('token');
  const dispatch = useTypedDispatch();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!token) return;
    localStorage.setItem('token', token);
  }, [token]);

  const { mutate: userToken, isLoading } = useMutation({
    mutationFn: (payload: Record<string, any>) => regulatorUser(payload),
    onSuccess(response) {
      const { data } = response;
      // save tokens and role on localstorage
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('refresh', data.refresh_token);
      localStorage.setItem('signedInAs', data.role);
    },
  });

  // hit user token api to register user as regulator
  useEffect(() => {
    if (!token) return;
    userToken({ token });
  }, [token, userToken]);

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
    enabled: isAuthenticated(), // call only if the user is created and saved token on local storage
  });

  // logout and clear all localstorage value on component unmount
  useEffect(() => {
    const handleRedirection = () => {
      localStorage.clear();
      window.location.reload();
    };

    // trigger when the redirect using the url
    window.addEventListener('beforeunload', handleRedirection);
    return () => {
      // trigger when the redirect using the url
      window.removeEventListener('beforeunload', handleRedirection);
      // trigger when the redirect using navigate function
      handleRedirection();
    };
  }, []);

  // render this if user is creating
  if (isLoading)
    return (
      <BindContentContainer className="main-content naxatw-flex naxatw-items-center naxatw-justify-center">
        <h1 className="naxatw-text-3xlxl">Verifying...</h1>
      </BindContentContainer>
    );

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
