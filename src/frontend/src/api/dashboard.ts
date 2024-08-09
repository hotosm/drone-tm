/* eslint-disable import/prefer-default-export */
import { UseQueryOptions, useQuery } from '@tanstack/react-query';
import { getRequestedTasks } from '@Services/project';
import { getTaskStatistics } from '@Services/dashboard';

export const useGetRequestedTasksListQuery = (
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['requested-task-list'],
    queryFn: getRequestedTasks,
    select: (res: any) => res.data,
    ...queryOptions,
  });
};

export const useGetDashboardTaskStaticsQuery = (
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['task-statistics'],
    queryFn: getTaskStatistics,
    select: (res: any) => res.data,
    ...queryOptions,
  });
};
