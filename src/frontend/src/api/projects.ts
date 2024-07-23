/* eslint-disable import/prefer-default-export */
import { UseQueryOptions, useQuery } from '@tanstack/react-query';
import { getProjectsList, getProjectDetail } from '@Services/createproject';

export const useGetProjectsListQuery = (
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['projects-list'],
    queryFn: getProjectsList,
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
