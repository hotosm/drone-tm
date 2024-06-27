/* eslint-disable import/prefer-default-export */
import { authenticated, api } from '.';

export const postCreateProject = (data: any) =>
  authenticated(api).post('/projects/create_project', data, {
    headers: { 'Content-Type': 'application/json' },
  });

export const postPreviewSplitBySquare = (data: any) =>
  authenticated(api).post('/projects/preview-split-by-square/', data);

export const postTaskBoundary = ({ id, data }: {id: number; data: any}) => 
  authenticated(api).post(`/projects/${id}/upload-task-boundaries/`, data);
