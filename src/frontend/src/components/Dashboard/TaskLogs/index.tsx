import { useMemo } from 'react';
import { useGetTaskListQuery } from '@Api/dashboard';
import TaskLogsTable from './TaskLogsTable';

interface TaskLogsProps {
  title: string;
}

const getStatusByTitle = (title: string): string => {
  if (title === 'Ongoing Tasks') return 'ongoing';
  if (title === 'Request Logs') return 'request logs';
  if (title === 'Unflyable Tasks') return 'unflyable task';
  if (title === 'Completed Tasks') return 'completed';

  return '';
};

const TaskLogs = ({ title }: TaskLogsProps) => {
  const { data: taskList }: any = useGetTaskListQuery();

  const filteredData = useMemo(
    () =>
      taskList?.filter(
        (task: Record<string, any>) => task?.state === getStatusByTitle(title),
      ),
    [title, taskList],
  );

  return (
    <div className="naxatw-mt-8 naxatw-flex-col">
      <h4 className="naxatw-py-2 naxatw-text-base naxatw-font-bold naxatw-text-gray-800">
        {title}
      </h4>
      <TaskLogsTable data={filteredData} />
    </div>
  );
};

export default TaskLogs;
