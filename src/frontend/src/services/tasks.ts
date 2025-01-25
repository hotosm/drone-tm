import { api, authenticated } from '.';

export const getTaskWaypoint = (
  projectId: string,
  taskId: string,
  mode: string,
  rotationAngle: number,
) =>
  authenticated(api).post(
    `/waypoint/task/${taskId}/?project_id=${projectId}&download=false&mode=${mode}&rotation_angle=${rotationAngle}`,
  );

export const getIndividualTask = (taskId: string) =>
  authenticated(api).get(`/tasks/${taskId}`);

export const postTaskWaypoint = (payload: Record<string, any>) => {
  const { taskId, projectId, data } = payload;
  return authenticated(api).post(
    `/waypoint/task/${taskId}/?project_id=${projectId}&download=false`,
    data,
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
};
// export const getTaskAssetsInfo = (projectId: string, taskId: string) =>
//   authenticated(api).get(`/projects/assets/${projectId}/?task_id=${taskId}`);

export const postProcessImagery = (projectId: string, taskId: string) =>
  authenticated(api).post(`/projects/process_imagery/${projectId}/${taskId}/`);

export const postRotatedTaskWayPoint = (payload: Record<string, any>) => {
  const { taskId, data } = payload;
  return authenticated(api).post(`/waypoint/${taskId}/generate-kmz/`, data, {
    headers: { 'Content-Type': 'application/json' },
  });
};
