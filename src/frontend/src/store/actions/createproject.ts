/* eslint-disable import/prefer-default-export */
import { createProjectSlice } from '@Store/slices/createproject';

export const {
  setCreateProjectState,
  resetUploadedAndDrawnAreas,
  saveProjectImageFile,
  setDemType,
} = createProjectSlice.actions;
