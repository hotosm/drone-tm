/* eslint-disable import/prefer-default-export */
import { UseQueryOptions, useQuery } from '@tanstack/react-query';
import {
  getProjectsList,
  getProjectDetail,
  getProjectCentroid,
} from '@Services/createproject';
import { getTaskStates } from '@Services/project';
import { getUserProfileInfo } from '@Services/common';

export const useGetProjectsListQuery = (
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryFn: () =>
      getProjectsList(
        queryOptions?.queryKey ? { ...queryOptions.queryKey } : {},
      ),
    select: (res: any) => res.data,
    ...queryOptions,
    queryKey: queryOptions?.queryKey
      ? ['projects-list', ...Object.values(queryOptions?.queryKey || {})]
      : ['projects-list'],
  });
};

export const useGetProjectsDetailQuery = (
  id: string,
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['project-detail', id],
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
    queryKey: ['user-profile'],
    queryFn: getUserProfileInfo,
    select: (res: any) => {
      const userDetails = res.data;
      const userDetailsString = JSON.stringify(userDetails);
      localStorage.setItem('userprofile', userDetailsString as string);
      return userDetails;
    },
    ...queryOptions,
  });
};

// export const useGetAllAssetsUrlQuery = (
//   projectId: string,
//   queryOptions?: Partial<UseQueryOptions>,
// ) => {
//   return useQuery({
//     queryKey: ['all-assets-url'],
//     queryFn: () => getAllAssetsUrl(projectId),
//     select: (data: any) => data.data,
//     ...queryOptions,
//   });
// };

export const useGetProjectCentroidQuery = (
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: queryOptions?.queryKey
      ? [
          'all-projects-centroid',
          ...Object.values(queryOptions?.queryKey || {}),
        ]
      : ['all-projects-centroid'],
    queryFn: () =>
      getProjectCentroid(
        queryOptions?.queryKey ? { ...queryOptions.queryKey } : {},
      ),
    select: (data: any) => data.data,
    ...queryOptions,
  });
};
