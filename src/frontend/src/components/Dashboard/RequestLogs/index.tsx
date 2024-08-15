import { useGetTaskListQuery } from '@Api/dashboard';
import { FlexColumn } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';
import { postTaskStatus } from '@Services/project';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'react-toastify';

const RequestLogs = () => {
  const { data: requestedTasks }: any = useGetTaskListQuery({
    select: (data: any) =>
      data?.data?.filter(
        (task: Record<string, any>) => task?.state === 'request logs',
      ),
  });

  const { mutate: respondToRequest } = useMutation<any, any, any, unknown>({
    mutationFn: postTaskStatus,
    onSuccess: () => {
      toast.success('Responded to the request');
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const handleReject = (taskId: string, projectId: string) => {
    respondToRequest({
      projectId,
      taskId,
      data: { event: 'bad' },
    });
  };

  const handleApprove = (taskId: string, projectId: string) => {
    respondToRequest({
      projectId,
      taskId,
      data: { event: 'map' },
    });
  };

  return (
    <div className="naxatw-mt-8 naxatw-flex-col">
      <h4 className="naxatw-py-2 naxatw-text-base naxatw-font-bold naxatw-text-gray-800">
        Request Logs
      </h4>
      <FlexColumn className="naxatw-max-h-[24.4rem] naxatw-gap-2 naxatw-overflow-y-auto">
        {requestedTasks?.map((task: Record<string, any>) => (
          <div
            key={task.task_id}
            className="naxatw-flex naxatw-h-fit naxatw-w-full naxatw-items-center naxatw-justify-between naxatw-rounded-xl naxatw-border naxatw-border-gray-300 naxatw-p-3"
          >
            <div>
              The Task <strong>#{task.task_id}</strong> is requested for Mapping
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
        ))}
      </FlexColumn>
    </div>
  );
};
export default RequestLogs;
