/* eslint-disable import/prefer-default-export */
import { UseQueryOptions, useQuery, useMutation, UseMutationOptions } from '@tanstack/react-query';
import {
  getProjectsList,
  getProjectDetail,
  getProjectCentroid,
} from '@Services/createproject';
import { getTaskStates } from '@Services/project';
import { getUserProfileInfo, getUsers } from '@Services/common';
import {
  startProjectClassification,
  getProjectStatus,
  getProjectImages,
  BatchStatusSummary,
  ImageClassificationResult,
} from '@Services/classification';

export interface ProjectUser {
  id: number | string;
  name: string;
  profile_img?: string | null;
}

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
    queryKey: ['project-task-states', projectId],
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

export const useGetUsersQuery = (
  queryOptions?: Partial<UseQueryOptions<ProjectUser[]>>,
) => {
  return useQuery<ProjectUser[]>({
    queryKey: ['users-list'],
    queryFn: async () => {
      const res = await getUsers();
      return res.data as ProjectUser[];
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
    queryFn: () =>
      getProjectCentroid(
        queryOptions?.queryKey ? { ...queryOptions.queryKey } : {},
      ),
    select: (data: any) => data.data,
    ...queryOptions,
    queryKey: queryOptions?.queryKey
      ? [
          'all-projects-centroid',
          ...Object.values(queryOptions?.queryKey || {}),
        ]
      : ['all-projects-centroid'],
  });
};

// Project-scoped classification hooks
export const useStartProjectClassificationMutation = (
  mutationOptions?: UseMutationOptions<
    { job_id: string; message: string; project_id: string; image_count: number },
    Error,
    { projectId: string }
  >,
) => {
  return useMutation({
    mutationFn: ({ projectId }) =>
      startProjectClassification(projectId),
    ...mutationOptions,
  });
};

export const useGetProjectStatusQuery = (
  projectId: string,
  queryOptions?: Partial<UseQueryOptions<BatchStatusSummary>>,
) => {
  return useQuery<BatchStatusSummary>({
    queryKey: ['project-imagery-status', projectId],
    queryFn: async () => getProjectStatus(projectId),
    enabled: !!projectId,
    ...queryOptions,
  });
};

export const useGetProjectImagesQuery = (
  projectId: string,
  since?: string,
  queryOptions?: Partial<UseQueryOptions<ImageClassificationResult[]>>,
) => {
  return useQuery<ImageClassificationResult[]>({
    queryKey: ['project-images', projectId, since],
    queryFn: () => getProjectImages(projectId, since),
    enabled: !!projectId,
    ...queryOptions,
  });
};
