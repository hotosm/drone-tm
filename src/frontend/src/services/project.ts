/* eslint-disable import/prefer-default-export */
import { authenticated, api } from '.';

export const getTaskStates = (projectId: string) =>
  api.get(`/tasks/stated/${projectId}`);

export const postTaskStatus = (
  projectId: string,
  taskId: string,
  data: Record<string, any>,
) => authenticated(api).post(`/tasks/event/${projectId}/${taskId}`, data);
