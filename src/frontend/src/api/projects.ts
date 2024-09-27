/* eslint-disable import/prefer-default-export */
import { UseQueryOptions, useQuery } from '@tanstack/react-query';
import { getProjectsList, getProjectDetail } from '@Services/createproject';
import { getTaskStates } from '@Services/project';
import { getUserProfileInfo } from '@Services/common';

export const useGetProjectsListQuery = (
  projectsFilterByOwner: 'yes' | 'no',
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['projects-list', projectsFilterByOwner],
    queryFn: () => getProjectsList(projectsFilterByOwner === 'yes'),
    select: (res: any) => res.data,
    ...queryOptions,
  });
};

export const useGetProjectsDetailQuery = (
  id: string,
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['project-detail'],
    queryFn: () => getProjectDetail(id),
    select: (res: any) => res.data,
    enabled: !!id,
    ...queryOptions,
  });
};

export const useGetTaskStatesQuery = (
  projectId: string,
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['project-task-states'],
    queryFn: () => getTaskStates(projectId),
    select: (res: any) => res.data,
    enabled: !!projectId,
    ...queryOptions,
  });
};

export const useGetUserDetailsQuery = (
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['user=profile'],
    queryFn: getUserProfileInfo,
    select: (res: any) => res.data,
    ...queryOptions,
  });
};
