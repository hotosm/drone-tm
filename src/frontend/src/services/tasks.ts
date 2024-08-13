/* eslint-disable import/prefer-default-export */
import { api, authenticated } from '.';

export const getTaskWaypoint = (projectId: string, taskId: string) =>
  authenticated(api).get(
    `/waypoint/task/${taskId}/?project_id=${projectId}&download=false`,
  );
