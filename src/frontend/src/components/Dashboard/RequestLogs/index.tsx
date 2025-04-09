import { useGetTaskListQuery } from '@Api/dashboard';
import NoDataComponent from '@Components/common/DataTable/NoDataFound';
import NoChartDataComponent from '@Components/common/DataTable/NoDataFound';
import { FlexColumn } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';
import { taskStatusObj } from '@Constants/index';
import { postTaskStatus } from '@Services/project';
import { setCommonState, toggleModal } from '@Store/actions/common';
import { documentDetailType } from '@Store/slices/common';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import { getFileExtension } from '@Utils/index';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';

const RequestLogs = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const { data: requestedTasks }: any = useGetTaskListQuery({
    select: (data: any) =>
      data?.data?.filter((task: Record<string, any>) =>
        taskStatusObj.request_logs.includes(task?.state),
      ),
  });

  const { mutate: respondToRequest } = useMutation<any, any, any, unknown>({
    mutationFn: postTaskStatus,
    onSuccess: () => {
      toast.success('Responded to the request');
      queryClient.invalidateQueries({ queryKey: ['task-list'] });
      queryClient.invalidateQueries({ queryKey: ['task-statistics'] });
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const handleReject = (taskId: string, projectId: string) => {
    respondToRequest({
      projectId,
      taskId,
      data: { event: 'reject' },
    });
  };

  const handleApprove = (taskId: string, projectId: string) => {
    respondToRequest({
      projectId,
      taskId,
      data: { event: 'map' },
    });
  };

  const getDocumentDetails = (url: string) => ({
    uri: url,
    fileType: getFileExtension(url),
  });

  return (
    <div className="naxatw-mt-8 naxatw-flex-col">
      <h4 className="naxatw-py-2 naxatw-text-base naxatw-font-bold naxatw-text-gray-800">
        Request Logs
      </h4>
      <FlexColumn className="naxatw-max-h-[24.4rem] naxatw-gap-2 naxatw-overflow-y-auto">
        {requestedTasks?.length ? (
          requestedTasks?.map((task: Record<string, any>) => (
            <>
              <div
                key={task.task_id}
                className="naxatw-flex naxatw-h-fit naxatw-w-full naxatw-items-center naxatw-justify-between naxatw-rounded-xl naxatw-border naxatw-border-gray-300 naxatw-px-3 naxatw-py-2"
              >
                <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
                  <div>
                    The <strong>Task# {task.project_task_index}</strong> from{' '}
                    <strong>{task?.project_name}</strong> project is requested
                    for Mapping.
                  </div>
                  <div className="naxatw-flex naxatw-gap-1">
                    {task?.certificate_url && (
                      <div
                        className="naxatw-group naxatw-flex naxatw-cursor-pointer naxatw-items-center naxatw-gap-1"
                        onClick={() => {
                          dispatch(
                            setCommonState({
                              selectedDocumentDetails: getDocumentDetails(
                                task?.certificate_url,
                              ) as documentDetailType,
                            }),
                          );
                          dispatch(toggleModal('document-preview'));
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={() => {}}
                      >
                        <i className="material-icons-outlined naxatw-text-red">
                          description
                        </i>
                        <p className="naxatw-text-sm group-hover:naxatw-underline">
                          Drone Operator Certificate
                        </p>
                      </div>
                    )}
                    {task?.registration_certificate_url && (
                      <div
                        className="naxatw-group naxatw-flex naxatw-cursor-pointer naxatw-items-center naxatw-gap-1"
                        onClick={() => {
                          dispatch(
                            setCommonState({
                              selectedDocumentDetails: getDocumentDetails(
                                task?.registration_certificate_url,
                              ) as documentDetailType,
                            }),
                          );
                          dispatch(toggleModal('document-preview'));
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={() => {}}
                      >
                        <i className="material-icons-outlined naxatw-text-red">
                          description
                        </i>
                        <p className="naxatw-text-sm group-hover:naxatw-underline">
                          Drone Registration Certificate
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="naxatw-flex naxatw-w-[172px] naxatw-gap-3">
                  <Button
                    variant="outline"
                    className="naxatw-text-red"
                    onClick={() => handleReject(task.task_id, task.project_id)}
                    leftIcon="close"
                  >
                    Reject
                  </Button>
                  <Button
                    className="!naxatw-bg-red naxatw-text-white"
                    onClick={() => handleApprove(task.task_id, task.project_id)}
                    leftIcon="check"
                  >
                    Approve
                  </Button>
                </div>
              </div>
            </>
          ))
        ) : (
          <NoDataComponent />
        )}
      </FlexColumn>
    </div>
  );
};
export default hasErrorBoundary(RequestLogs);
