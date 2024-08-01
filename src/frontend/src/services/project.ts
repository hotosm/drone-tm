/* eslint-disable import/prefer-default-export */
import { authenticated, api } from '.';

export const getTaskStates = (projectId: string) =>
  api.get(`/tasks/states/${projectId}`);

export const postTaskStatus = (payload: Record<string, any>) => {
  const { projectId, taskId, data } = payload;
  return authenticated(api).post(`/tasks/event/${projectId}/${taskId}`, data, {
    headers: { 'Content-Type': 'application/json' },
  });
};
export const getRequestedTasks = () =>
  authenticated(api).get('/tasks/requested_tasks/pending');
