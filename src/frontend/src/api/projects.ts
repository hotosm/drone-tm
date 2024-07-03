import { UseQueryOptions, useQuery } from '@tanstack/react-query';
import { getProjectsList } from '@Services/createproject';

export const useGetProjectsListQuery = (
  id?: number,
  queryOptions?: Partial<UseQueryOptions>,
) => {
  return useQuery({
    queryKey: ['projects-list'],
    queryFn: () => getProjectsList(id),
    select: (res: any) => res.data,
    ...queryOptions,
  });
};
