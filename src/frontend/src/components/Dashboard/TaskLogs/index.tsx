import { useMemo } from "react";
import { useGetTaskListQuery } from "@Api/dashboard";
import hasErrorBoundary from "@Utils/hasErrorBoundary";
import { taskStatusObj } from "@Constants/index";
import TaskLogsTable from "./TaskLogsTable";

interface TaskLogsProps {
  title: string;
  activeTab?: string;
}

const getStatusListByActiveTab = (activeTab?: string): string[] => {
  if (activeTab === "ongoing_tasks") return taskStatusObj.ongoing;
  if (activeTab === "request_logs") return taskStatusObj.request_logs;
  if (activeTab === "unflyable_tasks") return taskStatusObj.unflyable;
  if (activeTab === "completed_tasks") return taskStatusObj.completed;
  return [];
};

const TaskLogs = ({ title, activeTab }: TaskLogsProps) => {
  const { data: taskList }: any = useGetTaskListQuery();

  const filteredData = useMemo(
    () =>
      taskList?.filter((task: Record<string, any>) =>
        getStatusListByActiveTab(activeTab)?.includes(task?.state),
      ),
    [activeTab, taskList],
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
