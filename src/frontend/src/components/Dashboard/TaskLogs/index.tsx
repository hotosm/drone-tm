import { useMemo } from 'react';
import { useGetTaskListQuery } from '@Api/dashboard';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import { taskStatusObj } from '@Constants/index';
import TaskLogsTable from './TaskLogsTable';

interface TaskLogsProps {
  title: string;
}

const getStatusListByTitle = (title: string): string[] => {
  if (title === 'Ongoing Tasks') return taskStatusObj.ongoing;
  if (title === 'Request Logs') return taskStatusObj.request_logs;
  if (title === 'Unflyable Tasks') return taskStatusObj.unflyable;
  if (title === 'Completed Tasks') return taskStatusObj.completed;
  return [];
};

const TaskLogs = ({ title }: TaskLogsProps) => {
  const { data: taskList }: any = useGetTaskListQuery();

  const filteredData = useMemo(
    () =>
      taskList?.filter((task: Record<string, any>) =>
        getStatusListByTitle(title)?.includes(task?.state),
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

export default hasErrorBoundary(TaskLogs);
