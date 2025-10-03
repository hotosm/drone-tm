import { api, authenticated } from '.';

export const getTaskWaypoint = (
  projectId: string,
  taskId: string,
  mode: string,
  droneModel: string,
  rotationAngle: number,
  gimbalAngle: string,
) =>
  authenticated(api).post(
    `/waypoint/task/${taskId}/?project_id=${projectId}&download=false&mode=${mode}&drone_type=${droneModel}&rotation_angle=${rotationAngle}&gimbal_angle=${gimbalAngle}`,
  );

export const getIndividualTask = (taskId: string) =>
  authenticated(api).get(`/tasks/${taskId}`);

// TODO refactor this out and replace with getTaskWaypoint?
// This is used to update the take off point
export const postTaskWaypoint = (payload: Record<string, any>) => {
  const { taskId, projectId, mode, rotationAngle, droneModel, takeOffPoint, gimbalAngle } = payload;

  return authenticated(api).post(
    `/waypoint/task/${taskId}/?project_id=${projectId}&download=false&mode=${mode}&drone_type=${droneModel}&rotation_angle=${rotationAngle}&gimbal_angle=${gimbalAngle}`,
    takeOffPoint,
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
};
export const getTaskAssetsInfo = (projectId: string, taskId: string) =>
  authenticated(api).get(`/projects/assets/${projectId}/?task_id=${taskId}`);

export const postProcessImagery = (projectId: string, taskId: string) =>
  authenticated(api).post(`/projects/process_imagery/${projectId}/${taskId}/`);

export const postRotatedTaskWayPoint = (payload: Record<string, any>) => {
  const { taskId, data } = payload;
  return authenticated(api).post(`/waypoint/${taskId}/generate-kmz/`, data, {
    headers: { 'Content-Type': 'application/json' },
  });
};
