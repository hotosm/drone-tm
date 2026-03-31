/* eslint-disable import/prefer-default-export */
import {
  getAllTaskAssetsInfo,
  getIndividualTask,
  getTaskAssetsInfo,
  getTaskByProjectAndIndex,
  getTaskWaypoint,
} from '@Services/tasks';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

export const useGetTaskWaypointQuery = (
  projectId: string,
  taskId: string,
  mode: string,
  droneModel: string,
  rotationAngle: number,
  gimbalAngle: string,
  queryOptions?: Partial<UseQueryOptions>,
  allowMissingDem = false,
) => {
  return useQuery({
    queryKey: [
      'task-waypoints',
      projectId,
      taskId,
      mode,
      droneModel,
      rotationAngle,
      gimbalAngle,
      allowMissingDem,
    ],
    enabled: !!(projectId && taskId),
    queryFn: () =>
      getTaskWaypoint(
        projectId,
        taskId,
        mode,
        droneModel,
        rotationAngle,
        gimbalAngle,
        allowMissingDem,
      ),
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

export const useGetTaskByIndexQuery = (
  projectId: string,
  taskIndex: string,
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['task-by-index', projectId, taskIndex],
    enabled: !!(projectId && taskIndex),
    queryFn: () => getTaskByProjectAndIndex(projectId, taskIndex),
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

export const useGetAllTaskAssetsInfo = (
  projectId: string,
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['all-task-assets-info', projectId],
    enabled: !!projectId,
    queryFn: () => getAllTaskAssetsInfo(projectId),
    select: (res: any) => res.data,
    refetchInterval: (query: any) => {
      const data = query?.state?.data?.data;
      const hasProcessing = Array.isArray(data) && data.some(
        (t: any) => t.state === 'IMAGE_PROCESSING_STARTED',
      );
      return hasProcessing ? 10000 : 30000;
    },
    ...queryOptions,
  });
};
