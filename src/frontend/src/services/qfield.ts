/* eslint-disable import/prefer-default-export */
import { authenticated, api } from ".";

export const generateQFieldProject = (projectId: string) =>
  authenticated(api).post(`/projects/${projectId}/generate-qfield-project`);

export const getQFieldProjectStatus = (projectId: string) =>
  authenticated(api).get(`/projects/${projectId}/qfield-project-status`);
