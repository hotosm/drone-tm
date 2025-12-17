/* eslint-disable no-param-reassign */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface IImageProcessingWorkflowState {
  currentStep: number;
  batchId: string | null;
  projectId: string | null;
  isClassifying: boolean;
  jobId: string | null;
}

const initialState: IImageProcessingWorkflowState = {
  currentStep: 1,
  batchId: null,
  projectId: null,
  isClassifying: false,
  jobId: null,
};

export const imageProcessingWorkflowSlice = createSlice({
  name: 'imageProcessingWorkflow',
  initialState,
  reducers: {
    setCurrentStep: (state, action: PayloadAction<number>) => {
      state.currentStep = action.payload;
    },
    setBatchId: (state, action: PayloadAction<string | null>) => {
      state.batchId = action.payload;
    },
    setProjectId: (state, action: PayloadAction<string | null>) => {
      state.projectId = action.payload;
    },
    setIsClassifying: (state, action: PayloadAction<boolean>) => {
      state.isClassifying = action.payload;
    },
    setJobId: (state, action: PayloadAction<string | null>) => {
      state.jobId = action.payload;
    },
    startClassification: (state, action: PayloadAction<string>) => {
      state.isClassifying = true;
      state.jobId = action.payload;
    },
    completeClassification: (state) => {
      state.isClassifying = false;
    },
    resetWorkflow: (state) => {
      state.currentStep = 1;
      state.batchId = null;
      state.isClassifying = false;
      state.jobId = null;
    },
  },
});

export const {
  setCurrentStep,
  setBatchId,
  setProjectId,
  setIsClassifying,
  setJobId,
  startClassification,
  completeClassification,
  resetWorkflow,
} = imageProcessingWorkflowSlice.actions;

export default imageProcessingWorkflowSlice.reducer;
