import { useParams } from "react-router-dom";
import { useGetProjectsDetailQuery } from "@Api/projects";
import { useGetIndividualTaskQuery, useGetTaskByIndexQuery } from "@Api/tasks";

export default function useTaskParams() {
  const { projectId: urlProjectId, taskId: urlTaskId } = useParams();
  const { data: projectData, isFetching: isProjectFetching } = useGetProjectsDetailQuery(
    urlProjectId as string,
  );
  const projectUuid = (projectData as any)?.id || "";
  const isTaskUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      urlTaskId || "",
    );

  const { data: taskDataByIndex, isFetching: isTaskByIndexFetching } = useGetTaskByIndexQuery(
    projectUuid,
    urlTaskId as string,
    {
      enabled: !!(projectUuid && urlTaskId && !isTaskUuid),
    },
  );

  const { data: taskDataById, isFetching: isTaskByIdFetching } = useGetIndividualTaskQuery(
    urlTaskId as string,
    {
      enabled: !!(urlTaskId && isTaskUuid),
    },
  );

  const taskData = (isTaskUuid ? taskDataById : taskDataByIndex) as any;
  const taskUuid = taskData?.outline?.id || taskData?.id || "";
  const resolvedProjectId = taskData?.project_id || projectUuid;

  return {
    projectSlug: urlProjectId || "",
    taskIndex: taskData?.project_task_index?.toString?.() || urlTaskId || "",
    projectId: resolvedProjectId,
    taskId: taskUuid,
    taskData,
    isResolving: isProjectFetching || isTaskByIndexFetching || isTaskByIdFetching,
  };
}
