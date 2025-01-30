/* eslint-disable import/prefer-default-export */
import {
  getIndividualTask,
  getTaskAssetsInfo,
  getTaskWaypoint,
} from '@Services/tasks';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

export const useGetTaskWaypointQuery = (
  projectId: string,
  taskId: string,
  mode: string,
  rotationAngle: number,
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['task-waypoints', mode, rotationAngle],
    enabled: !!(projectId && taskId),
    queryFn: () => getTaskWaypoint(projectId, taskId, mode, rotationAngle),
    select: (res: any) => res.data,
    ...queryOptions,
  });
};

export const useGetIndividualTaskQuery = (
  taskId: string,
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['task-description'],
    enabled: !!taskId,
    queryFn: () => getIndividualTask(taskId),
    select: (res: any) => res.data,
    ...queryOptions,
  });
};

export const useGetTaskAssetsInfo = (
  projectId: string,
  taskId: string,
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['task-assets-info'],
    enabled: !!taskId,
    queryFn: () => getTaskAssetsInfo(projectId, taskId),
    select: (res: any) => res.data,
    ...queryOptions,
  });
};
